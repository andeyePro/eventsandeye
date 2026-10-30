// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import { type Env, emailFrom, isDev, notifyEmail } from './env';
import { nowIso, sha256 } from './util';

export interface Attachment {
	filename: string;
	/** e.g. 'text/calendar; method=REQUEST; charset=UTF-8' */
	content_type: string;
	/** UTF-8 text content (calendar files). */
	content: string;
}

export interface OutgoingEmail {
	to: string;
	subject: string;
	text: string;
	html: string;
	attachments?: Attachment[];
	/** Where replies go, if not NOTIFY_EMAIL (poll suggestions: the address routed to the cron Worker). */
	replyTo?: string;
	/** Extra headers, e.g. Auto-Submitted on automatic answers, so out-of-office replies leave them alone. */
	headers?: Record<string, string>;
}

const RESEND_URL = 'https://api.resend.com';

/** The idempotency key was used before for a different body: whether those emails went is unknown. */
export class IdempotencyConflict extends Error {
	constructor() {
		super('Resend error 409 (invalid_idempotent_request)');
	}
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST to Resend, pacing to its default limit of 2 requests a second and retrying on 429 or 5xx
 * (honouring retry-after), so a calendar update to everyone does not fail part way.
 */
async function resendPost(env: Env, path: string, body: unknown, idempotencyKey?: string): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(`${RESEND_URL}${path}`, {
			method: 'POST',
			// The same key on a retry (here, or a later run finishing a message) makes Resend send it once only.
			headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			await sleep(550);
			return res;
		}
		// A retry with the same key and body gets Resend's stored answer (above). A 409 means the key is in use: by a request
		// still in flight (wait and try again), or by an earlier one with a different body, which may or may not have gone.
		// That is reported as such, never taken as sent and never sent again under a new key.
		let conflict = false;
		if (res.status === 409 && idempotencyKey) {
			let name = '';
			try { name = String(((await res.clone().json()) as { name?: string }).name ?? ''); } catch {}
			if (name !== 'concurrent_idempotent_requests') throw new IdempotencyConflict();
			conflict = true;
		}
		if ((res.status === 429 || res.status >= 500 || conflict) && attempt < 5) {
			const after = Number(res.headers.get('retry-after'));
			await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** attempt);
			continue;
		}
		// Only Resend's error name is kept: its message can repeat the recipient's address, and this ends up in logs.
		let name = '';
		try { name = String(((await res.json()) as { name?: string }).name ?? ''); } catch {}
		throw new Error(`Resend error ${res.status}${name ? ` (${name})` : ''}`);
	}
}

const toBase64 = (s: string) => {
	const bytes = new TextEncoder().encode(s);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
};

/**
 * Sends via Resend when RESEND_API_KEY is set. Without it, only DEV_MODE is allowed: the email is written to
 * the dev_outbox table and the console. On the live site a missing key is an error, never a silent skip.
 */
export async function sendEmail(env: Env, email: OutgoingEmail, idempotencyKey?: string): Promise<string> {
	const [id] = await sendBatch(env, [email], idempotencyKey);
	return id;
}

/** idempotencyKey: a key for this exact set of emails, so a retry never sends them twice. */
export async function sendBatch(env: Env, emails: OutgoingEmail[], idempotencyKey?: string): Promise<string[]> {
	if (!emails.length) return [];
	if (!env.RESEND_API_KEY) {
		if (!isDev(env)) throw new Error('RESEND_API_KEY is not set; refusing to drop email on the live site');
		// Like Resend: a whole send is refused or accepted (tests use a "fail-send" address to see a refusal, "fail-500" for
		// an outage, "crash-after-send" for a send that went but was never heard back), and a key already used sends
		// nothing again (or, with a different body, is a conflict).
		if (emails.some((e) => e.to.includes('fail-send'))) throw new Error('Resend error 422 (validation_error)');
		if (emails.some((e) => e.to.includes('fail-500'))) throw new Error('Resend error 500 (internal_server_error)');
		// The key with a hash of the body, as Resend compares them: the same body is a repeat, another is a conflict.
		const stamp = idempotencyKey ? `${idempotencyKey}|${await sha256(JSON.stringify(emails.map((e) => [e.to, e.subject, e.text, e.html, e.attachments ?? []])))}` : null;
		if (idempotencyKey) {
			// An exact prefix, not LIKE: keys hold _ and are long (D1 calls such patterns too complex).
			const was = await env.DB.prepare(`SELECT idempotency_key AS k FROM dev_outbox WHERE substr(idempotency_key, 1, length(?1) + 1) = ?1 || '|' LIMIT 1`).bind(idempotencyKey).first<{ k: string }>();
			if (was) {
				if (was.k !== stamp) throw new IdempotencyConflict();
				return emails.map(() => 'dev:repeat');
			}
		}
		const results = await env.DB.batch(emails.map((e) => env.DB.prepare('INSERT INTO dev_outbox (to_addr, subject, text_body, html_body, attachments, created_at, reply_to, idempotency_key) VALUES (?,?,?,?,?,?,?,?)')
			.bind(e.to, e.subject, e.text, e.html, JSON.stringify(e.attachments ?? []), nowIso(), e.replyTo || notifyEmail(env), stamp)));
		// "crash-after-send": accepted, then the request dies before the caller hears back (the retry finds the key).
		if (emails.some((e) => e.to.includes('crash-after-send'))) throw new Error('Resend error 500 (dev: cut off after sending)');
		for (const e of emails) {
			const att = (e.attachments ?? []).map((a) => a.filename).join(', ');
			console.log(`\n[dev email] To: ${e.to}\nSubject: ${e.subject}${att ? `\nAttachments: ${att}` : ''}\n\n${e.text}\n[/dev email]\n`);
		}
		return results.map((r) => `dev:${r.meta.last_row_id}`);
	}
	const ids: string[] = [];
	const one = (e: OutgoingEmail) => ({
		from: emailFrom(env),
		to: [e.to],
		reply_to: e.replyTo || notifyEmail(env),
		...(e.headers ? { headers: e.headers } : {}),
		subject: e.subject,
		text: e.text,
		html: e.html,
		...(e.attachments?.length ? { attachments: e.attachments.map((a) => ({ filename: a.filename, content: toBase64(a.content), content_type: a.content_type })) } : {}),
	});
	// Resend's batch endpoint does not take attachments, so emails with calendar files go one by one.
	const plain = emails.map((e, i) => ({ e, i })).filter((x) => !x.e.attachments?.length);
	const withFiles = emails.map((e, i) => ({ e, i })).filter((x) => x.e.attachments?.length);
	const out: string[] = new Array(emails.length);
	for (let i = 0; i < plain.length; i += 100) {
		const chunk = plain.slice(i, i + 100);
		// One key per request: the bare key when the emails make one request (a message piece, or a single email whichever
		// endpoint it takes), so a retry of fewer of them uses the same key.
		const key = idempotencyKey && (plain.length <= 100 && !withFiles.length ? idempotencyKey : `${idempotencyKey}:${i}`);
		const res = await resendPost(env, '/emails/batch', chunk.map((x) => one(x.e)), key);
		const body = (await res.json()) as { data?: { id: string }[] };
		(body.data ?? []).forEach((d, k) => (out[chunk[k].i] = d.id));
	}
	for (const x of withFiles) {
		const res = await resendPost(env, '/emails', one(x.e), idempotencyKey && (emails.length === 1 ? idempotencyKey : `${idempotencyKey}:a${x.i}`));
		out[x.i] = ((await res.json()) as { id: string }).id;
	}
	for (const id of out) ids.push(id);
	return ids;
}

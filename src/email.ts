// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import { type Env, emailFrom, isDev, notifyEmail } from './env';
import { nowIso } from './util';

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
}

const RESEND_URL = 'https://api.resend.com';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST to Resend, pacing to its default limit of 2 requests a second and retrying on 429 or 5xx
 * (honouring retry-after), so a calendar update to everyone does not fail part way.
 */
async function resendPost(env: Env, path: string, body: unknown): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(`${RESEND_URL}${path}`, {
			method: 'POST',
			headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			await sleep(550);
			return res;
		}
		if ((res.status === 429 || res.status >= 500) && attempt < 5) {
			const after = Number(res.headers.get('retry-after'));
			await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** attempt);
			continue;
		}
		throw new Error(`Resend error ${res.status}: ${(await res.text()).slice(0, 300)}`);
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
export async function sendEmail(env: Env, email: OutgoingEmail): Promise<string> {
	const [id] = await sendBatch(env, [email]);
	return id;
}

export async function sendBatch(env: Env, emails: OutgoingEmail[]): Promise<string[]> {
	if (!emails.length) return [];
	if (!env.RESEND_API_KEY) {
		if (!isDev(env)) throw new Error('RESEND_API_KEY is not set; refusing to drop email on the live site');
		const ids: string[] = [];
		for (const e of emails) {
			const r = await env.DB.prepare('INSERT INTO dev_outbox (to_addr, subject, text_body, html_body, attachments, created_at) VALUES (?,?,?,?,?,?)')
				.bind(e.to, e.subject, e.text, e.html, JSON.stringify(e.attachments ?? []), nowIso())
				.run();
			const att = (e.attachments ?? []).map((a) => a.filename).join(', ');
			console.log(`\n[dev email] To: ${e.to}\nSubject: ${e.subject}${att ? `\nAttachments: ${att}` : ''}\n\n${e.text}\n[/dev email]\n`);
			ids.push(`dev:${r.meta.last_row_id}`);
		}
		return ids;
	}
	const ids: string[] = [];
	const one = (e: OutgoingEmail) => ({
		from: emailFrom(env),
		to: [e.to],
		reply_to: notifyEmail(env),
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
		const res = await resendPost(env, '/emails/batch', chunk.map((x) => one(x.e)));
		const body = (await res.json()) as { data?: { id: string }[] };
		(body.data ?? []).forEach((d, k) => (out[chunk[k].i] = d.id));
	}
	for (const x of withFiles) {
		const res = await resendPost(env, '/emails', one(x.e));
		out[x.i] = ((await res.json()) as { id: string }).id;
	}
	for (const id of out) ids.push(id);
	return ids;
}

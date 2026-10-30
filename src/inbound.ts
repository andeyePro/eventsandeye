// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import { type Env, notifyEmail } from './env';
import { sendEmail } from './email';
import { adminPollsUrl, decideSuggestion, type Decision } from './polls';
import { brand, UserError } from './rsvp';
import { suggestionReplyEmail } from './templates';
import { readSuggestionRef } from './tokens';

/**
 * Replies to poll-suggestion emails, delivered by Cloudflare Email Routing to the cron Worker's email() handler.
 * A reply acts only if its From address is an organiser's (NOTIFY_EMAIL or ADMIN_EMAILS) and it carries a suggestion
 * reference signed with TOKEN_SECRET, which only ever appears in the email to the organiser. The From header alone
 * proves little (see the README), so the reference is what really guards a decision. Anything else is refused at
 * SMTP time, so a stranger's mail sends nothing back to anyone. Just enough MIME to read a reply: no dependencies.
 *
 * The raw message is a "binary string" (one character per byte, see binaryString), so each part is decoded with its own
 * charset. Only the headers are read until the sender and reference check out, and only the start of the body after
 * that (the answer is its first line), so a large or hostile message costs next to nothing.
 */

export const MAX_INBOUND_BYTES = 1_000_000;
const MAX_BODY_CHARS = 64_000;

/** Bytes as a string of the same length, one character per byte, for parsing before the charset is known. */
export function binaryString(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
	return s;
}

interface Part { headers: Map<string, string>; body: string }

function splitPart(raw: string): Part {
	const m = /\r?\n\r?\n/.exec(raw);
	const head = m ? raw.slice(0, m.index) : raw;
	const body = m ? raw.slice(m.index + m[0].length) : '';
	const headers = new Map<string, string>();
	// Folded header lines continue with whitespace.
	for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
		const i = line.indexOf(':');
		if (i > 0) {
			const k = line.slice(0, i).trim().toLowerCase();
			if (!headers.has(k)) headers.set(k, line.slice(i + 1).trim());
		}
	}
	return { headers, body };
}

const param = (header: string, name: string) => new RegExp(`;\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i').exec(header)?.slice(1).find((x) => x !== undefined) ?? null;

const latin1Bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

function bytesToText(bytes: Uint8Array, charset: string | null) {
	const cs = (charset || 'utf-8').toLowerCase();
	// By hand: not every runtime's TextDecoder has the legacy charsets. (Windows-1252's extra 0x80–0x9F punctuation
	// comes out as control characters, which cannot change the meaning of yes, no or use.)
	if (/^(us-ascii|ascii|iso-8859-1|latin-?1|windows-1252|cp1252)$/.test(cs)) {
		let s = '';
		for (const b of bytes) s += String.fromCharCode(b);
		return s;
	}
	try {
		return new TextDecoder(cs).decode(bytes);
	} catch {
		return new TextDecoder('utf-8').decode(bytes);
	}
}

function decodeQP(s: string): Uint8Array {
	return latin1Bytes(s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
}
function decodeB64(s: string): Uint8Array {
	try {
		return latin1Bytes(atob(s.replace(/[^A-Za-z0-9+/=]/g, '')));
	} catch {
		return new Uint8Array();
	}
}

/** A header's value: raw UTF-8 (RFC 6532) and RFC 2047 encoded words, e.g. =?UTF-8?Q?Caf=C3=A9?= or =?utf-8?B?Q2Fmw6k=?=. */
export function decodeHeader(v: string): string {
	return bytesToText(latin1Bytes(v), 'utf-8').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s+(?==\?))?/g, (_, cs: string, enc: string, text: string) =>
		bytesToText(enc.toUpperCase() === 'B' ? decodeB64(text) : decodeQP(text.replace(/_/g, ' ')), cs));
}

/**
 * The one address in a From header, or null if there is not exactly one. Quoted display names and comments are
 * removed first, so `"<organiser@example.org>" <someone@else.example>` is someone@else.example. Encoded words cannot
 * hold an address, so they are left encoded here.
 */
export function mailbox(header: string): string | null {
	const bare = header.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\((?:[^()\\]|\\.)*\)/g, '');
	if (bare.includes(',') || bare.includes(';')) return null;
	const angles = [...bare.matchAll(/<([^<>]*)>/g)];
	const addr = angles.length === 1 ? angles[0][1] : angles.length ? null : bare;
	const a = addr?.trim().toLowerCase() ?? '';
	return /^[^\s@<>"]+@[^\s@<>"]+$/.test(a) ? a : null;
}

function decodeBody(p: Part): string {
	const cte = (p.headers.get('content-transfer-encoding') ?? '').toLowerCase();
	const charset = param(p.headers.get('content-type') ?? '', 'charset');
	if (cte === 'base64') return bytesToText(decodeB64(p.body), charset);
	if (cte === 'quoted-printable') return bytesToText(decodeQP(p.body), charset);
	return bytesToText(latin1Bytes(p.body), charset);
}

/** Linear in the length of the input, whatever it holds: no pattern here can backtrack. */
function htmlToText(h: string): string {
	const quote = h.search(/<blockquote/i); // everything from the quoted original on
	if (quote >= 0) h = h.slice(0, quote);
	const lower = h.toLowerCase();
	let out = '', i = 0;
	while (i < h.length) {
		const tag = /^<(style|script)\b/.exec(lower.slice(i, i + 8));
		if (tag) {
			const end = lower.indexOf(`</${tag[1]}`, i);
			i = end < 0 ? h.length : end + 2;
			continue;
		}
		out += h[i++];
	}
	return out
		.replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
		.replace(/<[^<>]*>/g, '')
		.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/** The first text/plain part (or, failing that, text/html as text), searching nested multiparts. */
function findText(p: Part, depth = 0): { text: string; html: boolean } | null {
	const ct = (p.headers.get('content-type') ?? 'text/plain').toLowerCase();
	if (ct.startsWith('multipart/') && depth < 5) {
		const boundary = param(p.headers.get('content-type') ?? '', 'boundary');
		if (!boundary) return null;
		const parts = p.body.split(`--${boundary}`).slice(1).filter((x) => !x.startsWith('--') && x.trim())
			.map((x) => splitPart(x.replace(/^[ \t]*\r?\n/, '')));
		let html: { text: string; html: boolean } | null = null;
		for (const part of parts) {
			const found = findText(part, depth + 1);
			if (found && !found.html) return found;
			html ??= found;
		}
		return html;
	}
	if (ct.startsWith('text/plain')) return { text: decodeBody(p), html: false };
	if (ct.startsWith('text/html')) return { text: htmlToText(decodeBody(p)), html: true };
	return null;
}

export interface ParsedHeaders { from: string | null; subject: string; automatic: boolean }

/** The headers alone: enough to decide whether to read any further. */
export function parseHeaders(raw: string): ParsedHeaders {
	const end = /\r?\n\r?\n/.exec(raw);
	const { headers } = splitPart(end ? raw.slice(0, end.index) : raw);
	// Out-of-office and other automatic replies (RFC 3834, and the older headers some mail servers still use).
	const automatic = (headers.get('auto-submitted') ?? 'no').toLowerCase() !== 'no' || /^(auto_reply|bulk|junk|list)$/i.test(headers.get('precedence') ?? '')
		|| headers.has('x-autoreply') || headers.has('x-autorespond');
	return { from: mailbox(headers.get('from') ?? ''), subject: decodeHeader(headers.get('subject') ?? ''), automatic };
}

/** The text of the message, from the start of its body only. */
export function bodyText(raw: string): string {
	const end = /\r?\n\r?\n/.exec(raw);
	const cut = end ? raw.slice(0, end.index + end[0].length + MAX_BODY_CHARS) : raw;
	return findText(splitPart(cut))?.text ?? '';
}

export function parseEmail(raw: string) {
	return { ...parseHeaders(raw), text: bodyText(raw) };
}

/** The reply's own words: everything before the quoted original. */
export function replyText(text: string): string {
	const out: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const l = line.trim();
		if (/^>/.test(l) || /^On .{0,200} wrote:?$/i.test(l) || /^-{2,}\s*Original Message\s*-{2,}$/i.test(l) || /^_{10,}$/.test(l) || /^From: /i.test(l)) break;
		if (/^--\s*$/.test(line)) break; // signature
		out.push(line);
	}
	return out.join('\n').trim();
}

const YES = ['yes', 'y', 'yep', 'yeah', 'ok', 'okay', 'add', 'add it', 'approve', 'approved', 'accept'];
const NO = ['no', 'n', 'nope', 'reject', 'decline', "don't", 'do not', "don't add it", 'do not add it'];

/**
 * yes, no, or "use <wording>", from the first line of the reply. The whole line must be the answer, give or take
 * punctuation and "please" or "thanks": "No problem, add it" must not turn a suggestion down. Anything else is null.
 */
export function parseCommand(reply: string): Decision | null {
	const first = reply.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
	const use = /^use\s*[:\-–]?\s+(.+)$/i.exec(first);
	if (use) {
		const label = use[1].trim().replace(/^["'“‘](.*)["'”’]$/, '$1').replace(/[.!]+$/, '').trim();
		return label ? { decision: 'use', label } : null;
	}
	const words = first.toLowerCase().replace(/[’]/g, "'").replace(/[.,!:;\s]+/g, ' ').trim()
		.replace(/^(please|thanks|thank you) /, '').replace(/ (please|thanks|thank you)$/, '');
	if (YES.includes(words)) return { decision: 'add' };
	if (NO.includes(words)) return { decision: 'reject' };
	return null;
}

const organisers = (env: Env) => new Set([notifyEmail(env), ...(env.ADMIN_EMAILS ?? '').split(',')].map((e) => e.trim().toLowerCase()).filter(Boolean));

export type InboundResult = { action: 'rejected'; reason: string } | { action: 'ignored'; reason: string } | { action: 'decided'; outcome: string; already: boolean } | { action: 'not-understood' };

/** Our own emails back to an organiser; a failure is logged, never thrown, once a decision has been made. */
async function tell(env: Env, to: string, subject: string, lines: string[]) {
	try {
		await sendEmail(env, suggestionReplyEmail(brand(env), to, subject, lines));
	} catch (e) {
		console.error('suggestion reply email failed', e);
	}
}

/** Handles one inbound email. reject() refuses it at SMTP time (Email Routing bounces it to the sender's server). */
export async function handleInbound(env: Env, raw: string, reject: (reason: string) => void): Promise<InboundResult> {
	const no = (reason: string): InboundResult => { reject(reason); return { action: 'rejected', reason }; };
	if (raw.length > MAX_INBOUND_BYTES) return no('Message too large.');
	const head = parseHeaders(raw);
	if (!head.from || !organisers(env).has(head.from)) return no('This address only accepts replies from the organisers.');
	// An organiser's out-of-office could start with "No…": it must never decide anything, nor be answered. Dropped
	// quietly: refusing it would bounce into the organiser's own inbox.
	if (head.automatic) return { action: 'ignored', reason: 'automatic reply' };
	const text = bodyText(raw);
	// The subject first; the quoted original as a fallback, for mail apps that rewrite subjects.
	const optionId = (await readSuggestionRef(env, head.subject)) ?? (await readSuggestionRef(env, text));
	if (!optionId) return no('No valid poll suggestion reference found.');
	const reply = replyText(text);
	const command = parseCommand(reply);
	if (!command) {
		await tell(env, head.from, 'Poll suggestion: reply not understood', [
			'Your reply did not start with just yes, no or "use <your wording>", so nothing has changed.',
			`You said: "${reply.split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 200) ?? ''}"`,
			'Reply to the suggestion email again, or decide on the admin page.',
		]);
		return { action: 'not-understood' };
	}
	let r;
	try {
		r = await decideSuggestion(env, optionId, command, `${head.from} (email)`);
	} catch (e) {
		if (e instanceof UserError && e.status === 404) return no('That poll suggestion no longer exists.');
		throw e;
	}
	const lines = r.already
		? [`"${r.option.suggested_label ?? r.option.label}" had already been decided: ${r.outcome}. Your reply changed nothing.`]
		: [`Done: "${r.option.suggested_label ?? r.option.label}" ${r.outcome}.`, r.option.status === 'active' ? 'Everyone who opens their registration can now rank it.' : 'The person who suggested it will see this when they next open their registration.'];
	const poll = await env.DB.prepare('SELECT p.event_id FROM polls p JOIN poll_options o ON o.poll_id = p.id WHERE o.id = ?').bind(optionId).first<{ event_id: string }>();
	if (poll) lines.push(`Results and other suggestions: ${adminPollsUrl(env, poll.event_id)}`);
	await tell(env, head.from, `Poll suggestion ${r.already ? 'already decided' : r.outcome}`, lines);
	return { action: 'decided', outcome: r.outcome, already: r.already };
}

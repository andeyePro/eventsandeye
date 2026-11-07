// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
export const nowIso = () => new Date().toISOString();

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
	});
}

export const bad = (message: string, status = 400, field?: string) => json({ ok: false, error: message, ...(field ? { field } : {}) }, status);

/** 32 random bytes, base64url. Used for self-service and confirmation links. */
export function randomToken(bytes = 32): string {
	const b = new Uint8Array(bytes);
	crypto.getRandomValues(b);
	return base64url(b);
}

export function base64url(bytes: Uint8Array): string {
	let s = '';
	for (const x of bytes) s += String.fromCharCode(x);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(s: string): Uint8Array {
	const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
	const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function sha256(text: string): Promise<string> {
	const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Edits (insert, delete, replace one character) between two strings: how far a typed address is from another. */
export function editDistance(a: string, b: string): number {
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		prev = row;
	}
	return prev[b.length];
}

export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** Trim, strip control characters (line breaks and tabs stay), cap length. Returns null for empty. */
export function cleanText(v: unknown, max: number): string | null {
	if (typeof v !== 'string') return null;
	// eslint-disable-next-line no-control-regex
	// Control characters, and invisible format characters (zero-width, bidirectional overrides) that can disguise a name or address.
	const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '').trim();
	if (!s) return null;
	return s.slice(0, max);
}

/** As cleanText, for fields that are one line (names, labels, subjects, locations): a line break typed into a name would
 * otherwise appear as extra lines in plain-text host lists, notifications and calendar files. */
export function cleanLine(v: unknown, max: number): string | null {
	const s = cleanText(v, max);
	return s === null ? null : s.replace(/\s+/g, ' ').trim().slice(0, max) || null;
}

export function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Format an ISO time for UK readers, e.g. "Friday, 13 November 2026 at 10:30" (the punctuation follows the runtime's ICU version). */
export function ukDateTime(iso: string, timeZone = 'Europe/London'): string {
	return new Intl.DateTimeFormat('en-GB', {
		weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone,
	}).format(new Date(iso));
}

/** Format an ISO time as a UK date only, e.g. "Friday 13 November 2026". */
export function ukDate(iso: string, timeZone = 'Europe/London'): string {
	return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(new Date(iso)).replace(',', '');
}

/**
 * When an event runs, for emails: "Friday 13 November 2026" for one day, otherwise a range that leaves out what both
 * ends share, e.g. "Saturday 7 to Sunday 8 November 2026" or "Saturday 31 October to Sunday 1 November 2026".
 */
export function ukDates(startIso: string, endIso: string, timeZone = 'Europe/London'): string {
	const part = (iso: string) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
	// An event that runs past midnight (a late dinner, say) belongs to the day it started: an end before 6am counts as
	// the evening before.
	const endHour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(endIso)));
	const a = part(startIso), late = part(new Date(Date.parse(endIso) - 1).toISOString());
	const nextDay = late.year !== a.year || late.month !== a.month || late.day !== a.day;
	const b = nextDay && endHour < 6 ? part(new Date(Date.parse(endIso) - (endHour + 1) * 3600_000).toISOString()) : late;
	if (a.year === b.year && a.month === b.month && a.day === b.day) return ukDate(startIso, timeZone);
	if (a.year !== b.year) return `${a.weekday} ${a.day} ${a.month} ${a.year} to ${b.weekday} ${b.day} ${b.month} ${b.year}`;
	if (a.month !== b.month) return `${a.weekday} ${a.day} ${a.month} to ${b.weekday} ${b.day} ${b.month} ${b.year}`;
	return `${a.weekday} ${a.day} to ${b.weekday} ${b.day} ${b.month} ${b.year}`;
}

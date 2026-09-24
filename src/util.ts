// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
export const nowIso = () => new Date().toISOString();

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
	});
}

export const bad = (message: string, status = 400) => json({ ok: false, error: message }, status);

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

export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** Trim, collapse whitespace, strip control characters, cap length. Returns null for empty. */
export function cleanText(v: unknown, max: number): string | null {
	if (typeof v !== 'string') return null;
	// eslint-disable-next-line no-control-regex
	const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
	if (!s) return null;
	return s.slice(0, max);
}

export function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Format an ISO time for UK readers, e.g. "Friday 13 November 2026, 10:30". */
export function ukDateTime(iso: string, timeZone = 'Europe/London'): string {
	return new Intl.DateTimeFormat('en-GB', {
		weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone,
	}).format(new Date(iso));
}

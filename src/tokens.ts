// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import type { Env } from './env';
import { base64url, base64urlDecode } from './util';

/**
 * Link tokens are `<registration id>.<expiry>.<HMAC-SHA256(TOKEN_SECRET, purpose:id:expiry)>`, so no token is stored
 * and links can be regenerated for any email (e.g. admin broadcasts) without keeping secrets in D1. Registration ids
 * are 128-bit random, and the MAC makes tokens unguessable. The expiry (unix seconds, base 36) bounds a leaked link:
 * a confirm link outlives the longest hold (48 hours) with room to spare, and manage and calendar links outlive any
 * registration, which is deleted 30 days after its event anyway.
 */
/** manage: view, change or cancel (sent only in emails to a confirmed address). confirm: the double opt-in link.
 * calendar: read-only .ics download, safe to appear inside calendar entries. */
type Purpose = 'manage' | 'confirm' | 'calendar';

const LIFETIME_S: Record<Purpose, number> = { confirm: 3 * 86400, manage: 180 * 86400, calendar: 180 * 86400 };

async function key(env: Env): Promise<CryptoKey> {
	if (!env.TOKEN_SECRET || env.TOKEN_SECRET.length < 32) throw new Error('TOKEN_SECRET is missing or too short');
	return crypto.subtle.importKey('raw', new TextEncoder().encode(env.TOKEN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function makeToken(env: Env, purpose: Purpose, id: string, now = Date.now()): Promise<string> {
	const exp = (Math.floor(now / 1000) + LIFETIME_S[purpose]).toString(36);
	const sig = await crypto.subtle.sign('HMAC', await key(env), new TextEncoder().encode(`${purpose}:${id}:${exp}`));
	return `${id}.${exp}.${base64url(new Uint8Array(sig))}`;
}

/** Returns the registration id if the token is valid for this purpose and unexpired, else null. Constant-time via subtle.verify. */
export async function readToken(env: Env, purpose: Purpose, token: unknown, now = Date.now()): Promise<string | null> {
	if (typeof token !== 'string' || token.length > 200) return null;
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	const [id, exp, mac] = parts;
	if (!/^[A-Za-z0-9_-]{16,64}$/.test(id) || !/^[0-9a-z]{1,10}$/.test(exp)) return null;
	let sig: Uint8Array;
	try {
		sig = base64urlDecode(mac);
	} catch {
		return null;
	}
	const ok = await crypto.subtle.verify('HMAC', await key(env), sig, new TextEncoder().encode(`${purpose}:${id}:${exp}`));
	if (!ok) return null;
	return parseInt(exp, 36) * 1000 > now ? id : null;
}

/**
 * Reference for a poll suggestion in the email to the organiser, `<option id>.<first 16 characters of
 * HMAC-SHA256(TOKEN_SECRET, suggestion:id)>`. It goes in the subject, so a reply carries it back. Only the organiser's
 * mailbox ever sees it, and a reply must also come from an organiser's address (see inbound.ts), so 96 bits is ample.
 */
export async function suggestionRef(env: Env, optionId: string): Promise<string> {
	const sig = await crypto.subtle.sign('HMAC', await key(env), new TextEncoder().encode(`suggestion:${optionId}`));
	return `${optionId}.${base64url(new Uint8Array(sig)).slice(0, 16)}`;
}

/** Finds a valid suggestion reference in the text and returns its option id, or null. */
export async function readSuggestionRef(env: Env, text: string): Promise<string | null> {
	for (const m of text.matchAll(/ref ([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{16})(?![A-Za-z0-9_-])/g)) {
		const expected = (await suggestionRef(env, m[1])).split('.')[1];
		// Compared as HMACs of both, so the time taken says nothing about how much of the reference matched.
		const [a, b] = await Promise.all([m[2], expected].map(async (s) => base64url(new Uint8Array(await crypto.subtle.sign('HMAC', await key(env), new TextEncoder().encode(s))))));
		if (a === b) return m[1];
	}
	return null;
}

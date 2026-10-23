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

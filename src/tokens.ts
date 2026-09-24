// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import type { Env } from './env';
import { base64url, base64urlDecode } from './util';

/**
 * Link tokens are `<registration id>.<HMAC-SHA256(TOKEN_SECRET, purpose:id)>`, so no token is stored
 * and links can be regenerated for any email (e.g. admin broadcasts) without keeping secrets in D1.
 * Registration ids are 128-bit random, and the MAC makes tokens unguessable.
 */
type Purpose = 'manage' | 'confirm';

async function key(env: Env): Promise<CryptoKey> {
	if (!env.TOKEN_SECRET || env.TOKEN_SECRET.length < 32) throw new Error('TOKEN_SECRET is missing or too short');
	return crypto.subtle.importKey('raw', new TextEncoder().encode(env.TOKEN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function makeToken(env: Env, purpose: Purpose, id: string): Promise<string> {
	const sig = await crypto.subtle.sign('HMAC', await key(env), new TextEncoder().encode(`${purpose}:${id}`));
	return `${id}.${base64url(new Uint8Array(sig))}`;
}

/** Returns the registration id if the token is valid for this purpose, else null. Constant-time via subtle.verify. */
export async function readToken(env: Env, purpose: Purpose, token: unknown): Promise<string | null> {
	if (typeof token !== 'string' || token.length > 200) return null;
	const dot = token.indexOf('.');
	if (dot < 1) return null;
	const id = token.slice(0, dot);
	if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return null;
	let sig: Uint8Array;
	try {
		sig = base64urlDecode(token.slice(dot + 1));
	} catch {
		return null;
	}
	const ok = await crypto.subtle.verify('HMAC', await key(env), sig, new TextEncoder().encode(`${purpose}:${id}`));
	return ok ? id : null;
}

// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import { type Env, isDev } from './env';
import { base64urlDecode } from './util';

/**
 * Verifies the Cloudflare Access JWT (Cf-Access-Jwt-Assertion header) as defence in depth behind the Access policy.
 * Checks RS256 signature against the team's published keys, audience, issuer and expiry.
 * Returns the authenticated email, or null. Fails closed if Access is not configured.
 */
interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }
let cache: { url: string; keys: Jwk[]; at: number } | null = null;

async function keys(env: Env): Promise<Jwk[]> {
	if (isDev(env) && env.ACCESS_JWKS_JSON) return (JSON.parse(env.ACCESS_JWKS_JSON) as { keys: Jwk[] }).keys;
	if (!env.ACCESS_TEAM_DOMAIN) return [];
	const url = `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
	if (cache && cache.url === url && Date.now() - cache.at < 3600_000) return cache.keys;
	const res = await fetch(url);
	if (!res.ok) return cache?.keys ?? [];
	const body = (await res.json()) as { keys: Jwk[] };
	cache = { url, keys: body.keys, at: Date.now() };
	return body.keys;
}

export async function verifyAccess(env: Env, request: Request): Promise<string | null> {
	const token = request.headers.get('cf-access-jwt-assertion');
	if (!token || !env.ACCESS_AUD) return null;
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	let header: { kid?: string; alg?: string }, payload: { aud?: string | string[]; exp?: number; nbf?: number; iss?: string; email?: string };
	try {
		header = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[0])));
		payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));
	} catch {
		return null;
	}
	if (header.alg !== 'RS256') return null;
	const jwk = (await keys(env)).find((k) => k.kid === header.kid);
	if (!jwk) return null;
	const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
	const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64urlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
	if (!ok) return null;
	const now = Math.floor(Date.now() / 1000);
	const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
	if (!auds.includes(env.ACCESS_AUD)) return null;
	if (!payload.exp || payload.exp < now - 30) return null;
	if (payload.nbf && payload.nbf > now + 30) return null;
	if (!isDev(env) && env.ACCESS_TEAM_DOMAIN && payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
	return payload.email ?? 'unknown';
}

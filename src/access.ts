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

async function keys(env: Env, force = false): Promise<Jwk[]> {
	if (isDev(env) && env.ACCESS_JWKS_JSON) return (JSON.parse(env.ACCESS_JWKS_JSON) as { keys: Jwk[] }).keys;
	if (!env.ACCESS_TEAM_DOMAIN) return [];
	const url = `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
	if (!force && cache && cache.url === url && Date.now() - cache.at < 3600_000) return cache.keys;
	// After a key rotation, refetch at most once a minute.
	if (force && cache && cache.url === url && Date.now() - cache.at < 60_000) return cache.keys;
	const res = await fetch(url);
	if (!res.ok) return cache?.keys ?? [];
	const body = (await res.json()) as { keys: Jwk[] };
	cache = { url, keys: body.keys, at: Date.now() };
	return body.keys;
}

/** True only for requests to this machine: the local-development shortcuts never apply to a deployed host. */
export function isLocalRequest(request: Request): boolean {
	const h = new URL(request.url).hostname;
	return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

/**
 * Authentication methods that count as a second factor, as reported in the Access token's `amr` claim.
 * Cloudflare's email one-time PIN is not a second factor, so a policy must add Access's own MFA (TOTP or a
 * security key) or use an identity provider that enforces it. Override with ACCESS_MFA_METHODS (comma-separated).
 */
const DEFAULT_MFA_METHODS = ['mfa', 'hwk', 'swk', 'totp', 'webauthn', 'u2f', 'fido'];

export type AccessResult = { email: string } | { email: null; reason: string };

export async function verifyAccess(env: Env, request: Request): Promise<string | null> {
	const r = await checkAccess(env, request);
	return r.email;
}

export async function checkAccess(env: Env, request: Request): Promise<AccessResult> {
	// Local development only: with DEV_MODE, no Access keys configured and a request to localhost, the admin page opens
	// for a demo. A deployed host never qualifies, whatever its settings. The e2e tests set ACCESS_JWKS_JSON, so they
	// still exercise the JWT path.
	if (isDev(env) && !env.ACCESS_JWKS_JSON && isLocalRequest(request)) return { email: 'dev@localhost' };
	try {
		return await checkJwt(env, request);
	} catch {
		// A malformed token (bad key material, bad base64) is refused, never a server error.
		return { email: null, reason: 'invalid token' };
	}
}

async function checkJwt(env: Env, request: Request): Promise<AccessResult> {
	const token = request.headers.get('cf-access-jwt-assertion');
	if (!token || !env.ACCESS_AUD) return { email: null, reason: 'not signed in through Cloudflare Access' };
	const parts = token.split('.');
	if (parts.length !== 3) return { email: null, reason: 'not signed in through Cloudflare Access' };
	let header: { kid?: string; alg?: string }, payload: { aud?: string | string[]; exp?: number; nbf?: number; iat?: number; iss?: string; email?: string; amr?: unknown; type?: string };
	try {
		header = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[0])));
		payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));
	} catch {
		return { email: null, reason: 'not signed in through Cloudflare Access' };
	}
	if (header.alg !== 'RS256') return { email: null, reason: 'not signed in through Cloudflare Access' };
	const jwk = (await keys(env)).find((k) => k.kid === header.kid) ?? (await keys(env, true)).find((k) => k.kid === header.kid);
	if (!jwk) return { email: null, reason: 'not signed in through Cloudflare Access' };
	const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
	const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64urlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
	if (!ok) return { email: null, reason: 'not signed in through Cloudflare Access' };
	const now = Math.floor(Date.now() / 1000);
	const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
	if (!auds.includes(env.ACCESS_AUD)) return { email: null, reason: 'not signed in through Cloudflare Access' };
	if (!payload.exp || payload.exp < now - 30) return { email: null, reason: 'not signed in through Cloudflare Access' };
	if (payload.nbf && payload.nbf > now + 30) return { email: null, reason: 'not signed in through Cloudflare Access' };
	if (!isDev(env) && env.ACCESS_TEAM_DOMAIN && payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return { email: null, reason: 'not signed in through Cloudflare Access' };
	// Application tokens only: not a service token or an organisation-level identity token.
	if (payload.type !== undefined && payload.type !== 'app') return { email: null, reason: 'not an application sign-in' };
	// A sign-in older than ACCESS_MAX_AGE_HOURS (default 12) must be repeated, whatever the Access session length.
	const maxAgeS = (Number(env.ACCESS_MAX_AGE_HOURS) > 0 ? Number(env.ACCESS_MAX_AGE_HOURS) : 12) * 3600;
	if (!payload.iat || payload.iat < now - maxAgeS) return { email: null, reason: 'sign-in too old, please sign in again' };
	// The two-factor requirement can be switched off only for local development, never on a deployed host.
	const mfaOff = env.ACCESS_REQUIRE_MFA === 'false' && isDev(env) && isLocalRequest(request);
	if (env.ACCESS_REQUIRE_MFA === 'false' && !mfaOff) console.error('ACCESS_REQUIRE_MFA=false is ignored outside local development');
	// Cloudflare's per-application ("independent") MFA is enforced by Access before any token is issued, but the
	// token's amr still says only how the person first signed in (e.g. "onetimepin"). With ACCESS_MFA=application
	// the deployment declares that the Access application requires MFA, and the claim is not checked.
	const mfaByApp = env.ACCESS_MFA === 'application';
	if (!mfaOff && !mfaByApp) {
		const allowed = (env.ACCESS_MFA_METHODS || DEFAULT_MFA_METHODS.join(',')).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
		const amr = (Array.isArray(payload.amr) ? payload.amr : []).map((x) => String(x).toLowerCase());
		if (!amr.some((m) => allowed.includes(m))) {
			return { email: null, reason: `two-factor sign-in required (this sign-in reported: ${amr.join(', ') || 'no methods'})` };
		}
	}
	const email = (payload.email ?? '').toLowerCase();
	// Defence in depth behind the Access policy: when ADMIN_EMAILS is set, only those addresses are admitted.
	const admins = (env.ADMIN_EMAILS ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
	if (admins.length && !admins.includes(email)) return { email: null, reason: `${email || 'this account'} is not an admin` };
	return { email: email || 'unknown' };
}

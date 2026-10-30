// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
// Unit tests for the Cloudflare Access check on a live site (the e2e test runs in DEV_MODE), with the team's published
// keys stubbed. Run: node --test eventsandeye/tests/access.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { build } from 'esbuild';

const out = await build({ entryPoints: [new URL('../src/access.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, platform: 'neutral' });
const { checkAccess } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' }] };
const b64u = (x) => Buffer.from(x).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
function token(claims = {}) {
	const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1' }));
	const p = b64u(JSON.stringify({ aud: ['aud'], iss: 'https://team.cloudflareaccess.com', exp: now() + 600, iat: now(), type: 'app', email: 'organiser@example.org', amr: ['mfa'], ...claims }));
	return `${h}.${p}.${b64u(sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey))}`;
}
const env = { ACCESS_AUD: 'aud', ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com/', ADMIN_EMAILS: 'organiser@example.org' };
const request = (t) => new Request('https://events.example.org/admin/rsvps/', { headers: t ? { 'cf-access-jwt-assertion': t } : {} });
const quiet = async (f) => { const e = console.error; console.error = () => {}; try { return await f(); } finally { console.error = e; } };
globalThis.fetch = async (url) => (String(url) === 'https://team.cloudflareaccess.com/cdn-cgi/access/certs' ? new Response(JSON.stringify(jwks)) : new Response('no', { status: 404 }));

test('an organiser listed in ADMIN_EMAILS is let in, with the team domain pasted as a URL', async () => {
	assert.deepEqual(await checkAccess(env, request(token())), { email: 'organiser@example.org' });
});

test('without ADMIN_EMAILS nobody is let in on a live site, and the reason says why', async () => {
	const r = await checkAccess({ ...env, ADMIN_EMAILS: '' }, request(token()));
	assert.equal(r.email, null);
	assert.match(r.reason, /ADMIN_EMAILS is not set/);
});

test('a token for another application names ACCESS_AUD; the set-up is not described before the signature is checked', async () => {
	assert.match((await checkAccess(env, request(token({ aud: ['other'] })))).reason, /ACCESS_AUD/);
	const forged = `${b64u(JSON.stringify({ alg: 'RS256', kid: 'unknown' }))}.${b64u('{}')}.${b64u('x')}`;
	const r = await quiet(() => checkAccess({ ...env, ACCESS_TEAM_DOMAIN: 'wrong.cloudflareaccess.com' }, request(forged)));
	assert.doesNotMatch(r.reason, /wrong\.cloudflareaccess\.com/);
	assert.doesNotMatch((await quiet(() => checkAccess({ ...env, ACCESS_AUD: '' }, request(forged)))).reason, /ACCESS_AUD/);
});

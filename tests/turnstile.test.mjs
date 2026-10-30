// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
// Unit tests for the Turnstile check, with Cloudflare's siteverify answer stubbed. Run: node --test eventsandeye/tests/turnstile.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({ entryPoints: [new URL('../src/turnstile.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, platform: 'neutral' });
const { verifyTurnstile, TURNSTILE_ACTION } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

const env = { TURNSTILE_SECRET_KEY: 'live-secret' };
const answer = (body) => { globalThis.fetch = async () => new Response(JSON.stringify(body)); };

test('a token solved on this site for the booking form passes', async () => {
	answer({ success: true, action: TURNSTILE_ACTION, hostname: 'example.org' });
	assert.equal(await verifyTurnstile(env, 'tok', null, 'Example.org'), true);
});

test('a token solved on another site, or for another form, using the same key is refused', async () => {
	answer({ success: true, action: TURNSTILE_ACTION, hostname: 'other.example' });
	assert.equal(await verifyTurnstile(env, 'tok', null, 'example.org'), false);
	answer({ success: true, action: 'contact-form', hostname: 'example.org' });
	assert.equal(await verifyTurnstile(env, 'tok', null, 'example.org'), false);
	answer({ success: true, hostname: 'example.org' });
	assert.equal(await verifyTurnstile(env, 'tok', null, 'example.org'), false);
	answer({ success: false, action: TURNSTILE_ACTION, hostname: 'example.org' });
	assert.equal(await verifyTurnstile(env, 'tok', null, 'example.org'), false);
});

// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
// Unit tests for the registration time floor (the e2e test runs in DEV_MODE with a shorter one).
// Run: node --test eventsandeye/tests/register.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({ entryPoints: [new URL('../src/routes/rsvp/register.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, platform: 'neutral' });
const { minMs } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

test('a live site always waits 1.5 s, whatever REGISTER_MIN_MS says', () => {
	assert.equal(minMs({ REGISTER_MIN_MS: '0' }), 1500);
	assert.equal(minMs({}), 1500);
});

test('local development may shorten it, and a value that is not a number is ignored', () => {
	assert.equal(minMs({ DEV_MODE: 'true', REGISTER_MIN_MS: '200' }), 200);
	assert.equal(minMs({ DEV_MODE: 'true', REGISTER_MIN_MS: 'abc' }), 1500);
});

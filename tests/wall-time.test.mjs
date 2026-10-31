// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
// Unit tests for reading a wall-clock time in an event's zone (src/setup.ts). Run: node --test tests/wall-time.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({ entryPoints: [new URL('../src/setup.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, platform: 'neutral' });
const { wallToIso } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

test('ordinary times, in winter and summer, east and west of UTC', () => {
	assert.equal(wallToIso('20271113T103000', 'Europe/London'), '2027-11-13T10:30:00.000Z');
	assert.equal(wallToIso('20270613T103000', 'Europe/London'), '2027-06-13T09:30:00.000Z');
	assert.equal(wallToIso('20270613T103000', 'America/New_York'), '2027-06-13T14:30:00.000Z');
	assert.equal(wallToIso('20270613T103000', 'Asia/Tokyo'), '2027-06-13T01:30:00.000Z');
});

test('a time in the skipped spring hour is read forward, whichever side of UTC the zone is', () => {
	assert.equal(wallToIso('20270328T013000', 'Europe/London'), '2027-03-28T01:30:00.000Z'); // 02:30 BST
	assert.equal(wallToIso('20270328T023000', 'Europe/Berlin'), '2027-03-28T01:30:00.000Z'); // 03:30 CEST
	assert.equal(wallToIso('20270314T023000', 'America/New_York'), '2027-03-14T07:30:00.000Z'); // 03:30 EDT
});

test('a time in the repeated autumn hour is its first occurrence, whichever side of UTC the zone is', () => {
	assert.equal(wallToIso('20271031T013000', 'Europe/London'), '2027-10-31T00:30:00.000Z'); // 01:30 BST, the first
	assert.equal(wallToIso('20271107T013000', 'America/New_York'), '2027-11-07T05:30:00.000Z'); // 01:30 EDT, the first
});

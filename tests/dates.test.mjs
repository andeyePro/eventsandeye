// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
// Unit tests for how emails give an event's dates. Run: node --test eventsandeye/tests/dates.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({ entryPoints: [new URL('../src/util.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, platform: 'neutral' });
const { ukDates } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

test('one day, a weekend, across a month and across a year', () => {
	assert.equal(ukDates('2026-11-13T10:30:00Z', '2026-11-13T22:00:00Z'), 'Friday 13 November 2026');
	assert.equal(ukDates('2026-11-07T10:00:00Z', '2026-11-08T16:00:00Z'), 'Saturday 7 to Sunday 8 November 2026');
	assert.equal(ukDates('2026-10-31T10:00:00Z', '2026-11-01T16:00:00Z'), 'Saturday 31 October to Sunday 1 November 2026');
	assert.equal(ukDates('2026-12-31T10:00:00Z', '2027-01-01T16:00:00Z'), 'Thursday 31 December 2026 to Friday 1 January 2027');
});

test('an event ending at midnight belongs to the day before, in its own time zone', () => {
	assert.equal(ukDates('2026-06-12T17:00:00Z', '2026-06-12T23:00:00Z'), 'Friday 12 June 2026');
	assert.equal(ukDates('2026-11-13T15:00:00Z', '2026-11-14T03:00:00Z', 'America/New_York'), 'Friday 13 November 2026');
});

test('an event that runs past midnight is still one day', () => {
	assert.equal(ukDates('2026-11-13T10:30:00Z', '2026-11-14T00:30:00Z'), 'Friday 13 November 2026');
	assert.equal(ukDates('2026-11-13T10:30:00Z', '2026-11-14T09:00:00Z'), 'Friday 13 to Saturday 14 November 2026');
});

test('an event entirely in the small hours is one day, not a backwards range', () => {
	assert.equal(ukDates('2026-11-14T00:30:00Z', '2026-11-14T03:00:00Z'), 'Saturday 14 November 2026');
});

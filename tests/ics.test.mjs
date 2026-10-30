// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
// Unit tests for calendar files in time zones other than Europe/London. Run: node --test eventsandeye/tests/ics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({ entryPoints: [new URL('../src/ics.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, platform: 'neutral' });
const { buildIcs, vtimezone } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

const entry = (start, end) => ({ key: 'day', uid: 'u@x', summary: 'S', description: '', location: '', start, end, alarms: [] });
const ics = (tz, start = '2026-11-13T15:00:00Z', end = '2026-11-13T17:00:00Z') => buildIcs({ method: 'PUBLISH', entry: entry(start, end), sequence: 0, organizer: { name: 'O', email: 'o@example.org' }, tz, now: '2026-10-30T00:00:00Z' });

/** The offset an RFC 5545 reader would apply to a local time, from the observances (latest DTSTART not after it). */
function offsetAt(lines, local) {
	const obs = [];
	for (let i = 0; i < lines.length; i++) if (/^BEGIN:(STANDARD|DAYLIGHT)$/.test(lines[i])) obs.push({ to: lines[i + 2].split(':')[1], start: lines[i + 3].split(':')[1] });
	return obs.filter((o) => o.start <= local).sort((a, b) => a.start.localeCompare(b.start)).at(-1)?.to;
}

test('New York: local times with a TZID, and both changes of the year around the event', () => {
	const s = ics('America/New_York');
	assert.match(s, /DTSTART;TZID=America\/New_York:20261113T100000/);
	assert.match(s, /DTEND;TZID=America\/New_York:20261113T120000/);
	const tz = vtimezone('America/New_York', '2026-11-13T15:00:00Z');
	assert.ok(tz.includes('DTSTART:20260308T020000') && tz.includes('DTSTART:20261101T020000'), tz.join('\n'));
	assert.equal(offsetAt(tz, '20261113T100000'), '-0500');
	assert.equal(offsetAt(tz, '20260701T100000'), '-0400');
});

test('half-hour zones and zones without summer time', () => {
	const tz = vtimezone('Asia/Kolkata', '2026-11-13T15:00:00Z');
	assert.equal(tz.filter((l) => /^BEGIN:(STANDARD|DAYLIGHT)$/.test(l)).length, 1);
	assert.equal(offsetAt(tz, '20261113T203000'), '+0530');
	assert.match(ics('Asia/Kolkata'), /DTSTART;TZID=Asia\/Kolkata:20261113T203000/);
});

test('southern hemisphere: summer time across the new year', () => {
	const tz = vtimezone('Australia/Sydney', '2026-12-01T00:00:00Z');
	assert.equal(offsetAt(tz, '20261201T110000'), '+1100');
	assert.equal(offsetAt(tz, '20260701T110000'), '+1000');
});

test('Europe/London keeps its rule-based block; an unknown zone falls back to UTC', () => {
	assert.match(ics('Europe/London'), /RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU/);
	const s = ics('Not/AZone');
	assert.match(s, /DTSTART:20261113T150000Z/);
	assert.doesNotMatch(s, /VTIMEZONE/);
});

test('building zones is quick enough for a calendar update to everyone', () => {
	const t = Date.now();
	for (let i = 0; i < 200; i++) ics('America/New_York', new Date(Date.parse('2026-11-13T15:00:00Z') + (i % 3) * 3600_000).toISOString(), '2026-11-13T18:00:00Z');
	vtimezone('Pacific/Chatham', '2027-06-01T12:34:56Z');
	assert.ok(Date.now() - t < 1500, `took ${Date.now() - t} ms`);
	assert.ok(vtimezone('America/New_York', '2026-11-13T15:30:15Z').includes('DTSTART:20261101T020000'), 'changes found on whole minutes whatever the event time');
});

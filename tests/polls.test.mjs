// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
// Unit tests for the poll tally. Run: node --test eventsandeye/tests/polls.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({ entryPoints: [new URL('../src/polls.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, platform: 'neutral' });
const { tally } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

const o = (id, label, status = 'active', extra = {}) => ({ id, label, status, merged_into: null, ...extra });
const ballot = (registration_id, ranking, bar) => ({ registration_id, ranking: JSON.stringify(ranking), bar });
const row = (t, label) => t.results.find((r) => r.label === label);

test('above the line counts as joining, below as staying at home, with first choices and a preference score', () => {
	const t = tally([o('s', 'Skiing'), o('c', 'Camping'), o('h', 'Hiking'), o('f', 'Football')], [ballot('p', ['s', 'c', 'h', 'f'], 3), ballot('q', ['h', 'c', 's', 'f'], 2)]);
	assert.deepEqual([row(t, 'Camping').willing, row(t, 'Skiing').willing, row(t, 'Skiing').out, row(t, 'Football').out], [2, 1, 1, 2]);
	assert.deepEqual([row(t, 'Skiing').first, row(t, 'Hiking').first, row(t, 'Camping').score, row(t, 'Hiking').score], [1, 1, 3, 3]);
	assert.equal(t.results.at(-1).label, 'Football');
});

test('a ballot saved before a merge still counts for the option it was merged into, once, at its higher place', () => {
	const options = [o('f', 'Football'), o('h', 'Hiking'), o('x', 'Footy', 'rejected', { merged_into: 'f' })];
	const t = tally(options, [ballot('q', ['x', 'h', 'f'], 2)]);
	assert.deepEqual([row(t, 'Football').willing, row(t, 'Football').first, row(t, 'Football').out, row(t, 'Hiking').willing], [1, 1, 0, 1]);
});

test('turned-down, removed and unranked options count for nothing; a waiting suggestion is not "none of them"', () => {
	const options = [o('a', 'A'), o('r', 'R', 'rejected'), o('p', 'P', 'pending'), o('n', 'New')];
	const t = tally(options, [ballot('1', ['r', 'gone', 'a'], 2), ballot('2', ['p', 'a'], 1), ballot('3', ['a'], 0)]);
	assert.deepEqual([row(t, 'A').willing, row(t, 'A').out, row(t, 'New').willing, row(t, 'New').out], [0, 3, 0, 0]);
	assert.equal(t.nothing, 2, 'ballots 1 and 3 join nothing; ballot 2 is waiting on its own suggestion');
});

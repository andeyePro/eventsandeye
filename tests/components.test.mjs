// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
// The plain HTML components match the Astro ones, and every element a script looks up by id is in its markup.
// Run: node --test eventsandeye/tests/components.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(root + p, 'utf8');

test('html/*.html is up to date with the Astro components', () => {
	execFileSync('node', [root + 'scripts/build-html.mjs', '--check'], { stdio: 'pipe' });
});

for (const [name, mod] of [['RsvpForm', 'rsvp-form'], ['ConfirmPanel', 'confirm-panel'], ['ManagePanel', 'manage-panel']]) {
	test(`${mod}: every id its script needs is in both versions of the markup`, () => {
		const src = read(`astro/${mod}.ts`);
		// Looked up directly, or through a list of [id, text] pairs (the event's own wording).
		const ids = [...src.matchAll(/getElementById\('([^']+)'\)/g), ...src.matchAll(/\['((?:m|rsvp|confirm)-[\w-]+)', /g)].map((m) => m[1]);
		assert.ok(ids.length > 3);
		for (const markup of [read(`astro/${name}.astro`), read(`html/${mod}.html`)]) {
			for (const id of ids) assert.ok(markup.includes(`id="${id}"`), `${id} missing`);
		}
	});
}

test('sent-to: the plain version has the line its script fills in', () => {
	assert.ok(read('html/sent-to.html').includes('id="sent-to"') && read('html/sent-to.html').includes("getElementById('sent-to')"));
});

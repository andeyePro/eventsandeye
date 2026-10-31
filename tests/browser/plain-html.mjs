#!/usr/bin/env node
// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../LICENSE.
/**
 * Browser test of the plain HTML components in html/, as a site without Astro would use them: the generated fragments,
 * with their placeholders filled in, pasted into bare pages beside their scripts and the stylesheet. One person
 * registers, confirms and changes their registration through them alone. Run from the repository root (see harness.mjs):
 *
 *   SITE_DIR=<built starter site> PORT=8796 node tests/browser/plain-html.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import * as h from './harness.mjs';

const { check, BASE, EVENT, sql } = h;

// The scripts are build output, so build them as a site would.
execFileSync('node', ['scripts/build-html.mjs'], { stdio: 'ignore' });
const fill = (html) => html.replaceAll('YOUR-EVENT-ID', EVENT).replaceAll('YOUR-CONTACT-LINK', 'mailto:events@example.org')
	.replaceAll('YOUR ORGANISATION', 'AMYBO').replaceAll('YOUR-TURNSTILE-SITE-KEY', '1x00000000000000000000AA');
const page = (title, body) => `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${title}</title><link rel="stylesheet" href="../events-and-i.css"></head><body><main><h1>${title}</h1>\n${body}\n</main></body></html>`;
const dist = join(h.SITE, 'dist', 'plain');
for (const [dir, file, title] of [['book', 'rsvp-form', 'Register'], ['confirm', 'confirm-panel', 'Your registration'], ['manage', 'manage-panel', 'Manage your registration']]) {
	mkdirSync(join(dist, dir), { recursive: true });
	writeFileSync(join(dist, dir, 'index.html'), page(title, fill(readFileSync(`html/${file}.html`, 'utf8'))));
	copyFileSync(`html/${file}.js`, join(dist, dir, `${file}.js`));
}
copyFileSync('html/events-and-i.css', join(dist, 'events-and-i.css'));

const pageErrors = [];
await h.start();
try {
	const ctx = await h.context();
	const p = await ctx.newPage();
	p.on('pageerror', (e) => pageErrors.push(String(e)));
	p.on('crash', () => pageErrors.push('the page crashed'));
	p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && pageErrors.push(m.text()));

	console.log('Booking form');
	await p.goto(`${BASE}/plain/book/`);
	await p.waitForFunction(() => /closes/.test(document.getElementById('rsvp-availability').textContent));
	check('plain form: the live availability line and the event\'s wording', (await p.textContent('#rsvp-in-person-label')) === 'In person at White City');
	check('plain form: the stylesheet applies (hidden parts stay hidden)', await p.$eval('#rsvp-form', (f) => getComputedStyle(f).display === 'grid'));
	const v = await h.axe(p);
	check('plain form: axe finds no violations', v.length === 0, JSON.stringify(v));
	await p.fill('#rsvp-name', 'Plain Person');
	await p.fill('#rsvp-email', 'plain@example.org');
	await p.check('input[name=attendance][value=in_person]');
	await p.check('#rsvp-consent');
	await p.click('button[type=submit]');
	await p.waitForURL(/\/events\/check-email\//, { timeout: 10_000 });
	const reg = sql(`SELECT status, attendance FROM registrations WHERE email='plain@example.org'`, true)[0];
	check('plain form: registered, pending confirmation', reg?.status === 'pending' && reg.attendance === 'in_person', JSON.stringify(reg));

	console.log('Confirm panel');
	const confirm = (await h.linkFor('plain@example.org', 'confirm'))?.replace('/events/confirm/', '/plain/confirm/');
	check('confirm link sent', !!confirm);
	await p.goto(confirm);
	check('plain confirm: the token leaves the address bar', !/[?&]t=/.test(p.url()));
	await p.click('#confirm-btn');
	await p.waitForFunction(() => document.getElementById('confirm-result').textContent !== '');
	check('plain confirm: confirmed', sql(`SELECT status FROM registrations WHERE email='plain@example.org'`, true)[0]?.status === 'confirmed', await p.textContent('#confirm-result'));

	console.log('Manage panel');
	const manage = (await h.linkFor('plain@example.org', 'manage'))?.replace('/events/manage/', '/plain/manage/');
	check('manage link sent', !!manage);
	await p.goto(manage);
	await p.waitForSelector('#manage-form:not([hidden])');
	check('plain manage: the registration loads', (await p.inputValue('#m-name')) === 'Plain Person');
	await p.fill('#m-name', 'Plain P. Person');
	await p.click('#m-save');
	await p.waitForFunction(() => document.getElementById('manage-result').textContent !== '');
	check('plain manage: a change is saved', sql(`SELECT name FROM registrations WHERE email='plain@example.org'`, true)[0]?.name === 'Plain P. Person', await p.textContent('#manage-result'));
	await p.reload();
	await p.waitForSelector('#manage-form:not([hidden])');
	check('plain manage: a reload keeps working (the link is kept for the tab)', (await p.inputValue('#m-name')) === 'Plain P. Person');
	await ctx.close();

	check('no script errors on any page', pageErrors.length === 0, pageErrors.join(' | '));
	check('no requests to third parties', h.thirdParty.length === 0, h.thirdParty.join(' '));
} catch (e) {
	check('test ran to the end', false, e.stack);
} finally {
	await h.stop();
}
const { passes, failures } = h.results();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

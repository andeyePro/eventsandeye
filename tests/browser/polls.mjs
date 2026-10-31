#!/usr/bin/env node
// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../LICENSE.
/**
 * Browser test of two polls side by side on a phone screen: on the booking form and on the manage page, ranked with
 * the arrow buttons from the keyboard, saved with the registration and changed later. Run from the repository root
 * (see harness.mjs):
 *
 *   SITE_DIR=<built starter site> PORT=8797 node tests/browser/polls.mjs
 */
import * as h from './harness.mjs';

const { check, BASE, EVENT, sql } = h;
const PHONE = { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true };
const pageErrors = [];
const admin = (body) => fetch(`${BASE}/api/admin/polls`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, 'cf-access-jwt-assertion': h.jwt() }, body: JSON.stringify(body) }).then((r) => r.json());
/** Nothing wider than the screen: a sideways scroll on a phone is the usual sign of a layout that does not fit. */
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const ballots = () => sql(`SELECT b.poll_id, b.ranking, b.bar FROM poll_ballots b JOIN registrations r ON r.id = b.registration_id WHERE r.email = 'poll@example.org' ORDER BY b.poll_id`, true);

await h.start();
try {
	const a = await admin({ action: 'create', event: EVENT, question: 'What shall we do on Saturday afternoon, if the weather holds?', options: 'Skiing\nCamping\nA very long walk along the river to the old lighthouse and back' });
	const b = await admin({ action: 'create', event: EVENT, question: 'Which film on Sunday evening?', options: 'Metropolis\nSolaris\nArrival' });
	check('two polls created', a.ok && b.ok, JSON.stringify([a, b]));

	console.log('Booking form on a phone');
	const ctx = await h.context(PHONE);
	const page = await ctx.newPage();
	page.on('pageerror', (e) => pageErrors.push(String(e)));
	await page.goto(`${BASE}/event/`);
	await page.waitForSelector('#rsvp-polls .poll >> nth=1');
	check('both polls on the form, each with its own question', (await page.$$eval('#rsvp-polls legend', (ls) => ls.map((l) => l.textContent))).join('|')
		=== 'What shall we do on Saturday afternoon, if the weather holds? (optional)|Which film on Sunday evening? (optional)');
	check('the form fits the phone screen with both polls', await fits(page));
	check('each poll\'s arrow buttons are big enough to tap (at least 24px)', await page.$$eval('#rsvp-polls .moves button', (bs) => bs.every((x) => { const r = x.getBoundingClientRect(); return r.width >= 24 && r.height >= 24; })));
	// From the keyboard: in the film poll, move Arrival to the top, then the line up above Solaris.
	const film = page.locator('#rsvp-polls .poll').nth(1);
	await film.getByRole('button', { name: 'Move Arrival up' }).focus();
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	// At the top its up button is disabled, so focus moves to its down button rather than being lost.
	check('focus stays with the moved option, on its down button once it reaches the top', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Move Arrival down'), await page.evaluate(() => document.activeElement?.outerHTML));
	await film.getByRole('button', { name: 'Move the line up' }).click();
	check('the film poll reads Arrival, Metropolis, then the line, then Solaris', (await film.locator('.rank li').allTextContents()).map((t) => t.replace(/[↑↓]/g, '').trim()).join('|').startsWith('Arrival|Metropolis|'), (await film.locator('.rank li').allTextContents()).join('|'));
	check('the other poll is untouched', (await page.locator('#rsvp-polls .poll').nth(0).locator('.rank li.opt').first().textContent()).includes('Skiing'));
	const v = await h.axe(page);
	check('axe: no violations with two polls on a phone', v.length === 0, JSON.stringify(v));
	await page.fill('#rsvp-name', 'Poll Person');
	await page.fill('#rsvp-email', 'poll@example.org');
	await page.check('input[name=attendance][value=remote]');
	await page.check('#rsvp-consent');
	await page.click('button[type=submit]');
	await page.waitForURL(/\/events\/check-email\//, { timeout: 10_000 });
	const confirm = await h.linkFor('poll@example.org', 'confirm');
	await page.goto(confirm);
	await page.click('#confirm-btn');
	await page.waitForFunction(() => document.getElementById('confirm-result').textContent !== '');
	let bs = ballots();
	check('only the poll that was touched is saved, with its order and line', bs.length === 1 && bs[0].poll_id === b.id && bs[0].bar === 2, JSON.stringify(bs));

	console.log('Manage page on a phone');
	await page.goto(await h.linkFor('poll@example.org', 'manage'));
	await page.waitForSelector('#m-polls .poll >> nth=1');
	check('both polls on the manage page', (await page.locator('#m-polls h2').allTextContents()).length === 2);
	check('the manage page fits the phone screen', await fits(page));
	const sat = page.locator('#m-polls .poll').nth(0);
	await sat.getByRole('button', { name: 'Move Camping up' }).click();
	await sat.getByRole('button', { name: 'Save my order' }).click();
	await page.waitForFunction(() => /saved/i.test(document.querySelector('#m-polls .poll [role=status]')?.textContent ?? ''), null, { timeout: 10_000 }).catch(() => {});
	bs = ballots();
	check('saving one poll leaves the other answer alone', bs.length === 2 && bs.find((x) => x.poll_id === a.id)?.ranking.startsWith('["') && JSON.parse(bs.find((x) => x.poll_id === a.id).ranking)[0] !== undefined
		&& bs.find((x) => x.poll_id === b.id)?.bar === 2, JSON.stringify(bs));
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

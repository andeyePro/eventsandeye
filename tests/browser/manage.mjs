// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../LICENSE.
/**
 * Browser test of everything an attendee does after registering, through the links in their emails: the confirm page,
 * the "I did not register" link, the manage page (view, change, cancel), the calendar files and add-to-calendar links,
 * bad and reused links, the waiting list, and the emails themselves rendered at phone and desktop widths.
 *
 *   SITE_DIR=… PORT=… node tests/browser/manage.mjs      (see harness.mjs; SHOTS=<folder> also saves screenshots)
 */
import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as h from './harness.mjs';

const { BASE, EVENT, check } = h;
const TOUR1 = `${EVENT}-tour-1030`, TOUR2 = `${EVENT}-tour-1115`, DINNER = `${EVENT}-pub`;
const PHONE = { width: 375, height: 667 };
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); };

// The server's token secret, so the test can make an expired link as the server would have made it a while ago.
const secret = () => /^TOKEN_SECRET=(.*)$/m.exec(readFileSync(join(h.SITE, '.dev.vars'), 'utf8'))[1];
const tokenWithExpiry = (purpose, id, expS) => { const exp = expS.toString(36); return `${id}.${exp}.${createHmac('sha256', secret()).update(`${purpose}:${id}:${exp}`).digest('base64url')}`; };
const tokenOf = (link) => decodeURIComponent(new URL(link).searchParams.get('t'));
const idOf = (link) => tokenOf(link).split('.')[0];
const q = (s) => s.replace(/'/g, "''");
const row = (email) => h.sql(`SELECT * FROM registrations WHERE email='${q(email)}'`, true)[0];
const addr = (tag) => `${tag}-${randomUUID().slice(0, 8)}@example.org`;

/** Registers as the booking form would, straight to the API: quicker than the form, which another test covers. */
async function register(over = {}) {
	const r = await fetch(`${BASE}/api/rsvp/register`, {
		method: 'POST', headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ event: EVENT, name: 'Test Person', attendance: 'in_person', tour_id: 'none', consent: true, website: '', 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX', ...over }),
	});
	const d = await r.json();
	if (!d.ok) throw new Error(`register failed: ${d.error}`);
}
/** Confirms through the confirm page with the keyboard only, and returns what the page then says. */
async function confirmInBrowser(page, link) {
	await page.goto(link);
	await page.locator('#confirm-btn').focus();
	await page.keyboard.press('Enter');
	await page.locator('#confirm-result p').first().waitFor();
	return page.locator('#confirm-result').innerText();
}
async function openManage(page, link) {
	await page.goto(link);
	await page.waitForFunction(() => !document.getElementById('manage-form').hidden || document.getElementById('manage-loading').textContent !== 'Loading your registration…');
}
const saved = async (page) => {
	await page.locator('#m-save').click();
	await page.waitForFunction(() => document.getElementById('manage-result').textContent !== '');
	return page.locator('#manage-result').innerText();
};
const pageWidth = (page) => page.evaluate(() => document.documentElement.scrollWidth);
const noOverflow = async (page) => (await pageWidth(page)) <= page.viewportSize().width;
const axeOk = async (page, name) => {
	// The starter's layout leaves the page background to the browser's canvas (dark in dark mode), which axe cannot see:
	// it would judge light text against white. Paint the same canvas colour explicitly so axe measures what people see.
	await page.evaluate(() => { const r = document.documentElement; if (getComputedStyle(r).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)') r.style.background = 'Canvas'; });
	const v = await h.axe(page);
	check(`axe: ${name}`, !v.length, JSON.stringify(v));
};
const disabled = (page, sel) => page.locator(sel).evaluate((el) => el.disabled);
/** Changes one character in the middle of a token's MAC (the last base64 character carries spare bits, so may not count). */
const tamper = (token) => { const i = token.length - 10; return token.slice(0, i) + (token[i] === 'A' ? 'B' : 'A') + token.slice(i + 1); };

let errors = [];
async function newPage(ctx) {
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[349]/.test(m.text())) errors.push(m.text()); });
	return page;
}

try {
	await h.start();
	const light = await h.context({ viewport: PHONE });
	const dark = await h.context({ viewport: PHONE, colorScheme: 'dark' });
	const wide = await h.context({ viewport: { width: 1280, height: 900 } });
	const noJs = await h.context({ viewport: PHONE, javaScriptEnabled: false });

	// ---- the confirm page ----
	console.log('Confirm page');
	const amy = addr('amy');
	await register({ email: amy, name: 'Amy Attendee', tour_id: TOUR1, optins: [DINNER], needs: 'Step-free access', extra_answer: 'A walk' });
	const amyConfirm = await h.linkFor(amy, 'confirm');
	check('the confirmation email has a confirm link', !!amyConfirm);
	let page = await newPage(light);
	await page.goto(amyConfirm);
	check('the confirm link is taken out of the address bar', !page.url().includes('t='), page.url());
	await axeOk(page, 'confirm page, before confirming (phone, light)');
	await shot(page, 'confirm-before');
	const confirmed = await confirmInBrowser(page, amyConfirm);
	check('confirming by keyboard completes the registration', /registration is complete/.test(confirmed), confirmed);
	check('the confirm page names the place, the tour and the next step', /in-person place/.test(confirmed) && /10:30 lab tour/.test(confirmed) && /Manage my registration/.test(confirmed), confirmed);
	check('focus moves to the outcome once confirmed', await page.evaluate(() => document.activeElement?.id === 'confirm-result'));
	check('the button is gone once confirmed', !(await page.locator('#confirm-btn').isVisible()));
	await axeOk(page, 'confirm page, confirmed (phone, light)');
	check('the confirm page fits a phone screen', await noOverflow(page));
	await shot(page, 'confirm-after');
	check('joining instructions with a manage link follow', !!(await h.linkFor(amy, 'manage')));
	check('confirmed in the database', row(amy).status === 'confirmed');

	page = await newPage(dark);
	const again = await confirmInBrowser(page, amyConfirm);
	check('using the confirm link twice says it was already confirmed', /already confirmed/.test(again), again);
	await axeOk(page, 'confirm page, already confirmed (dark)');
	await shot(page, 'confirm-again-dark');
	check('a second confirm sends no second set of instructions', (await h.mailsTo(amy)).filter((m) => m.subject.startsWith('Joining instructions')).length === 1);

	// Tampered, expired and incomplete links.
	const tok = tokenOf(amyConfirm);
	const tampered = `${BASE}/events/confirm/?t=${encodeURIComponent(tamper(tok))}`;
	page = await newPage(light);
	await page.goto(tampered);
	await page.locator('#confirm-btn').click();
	await page.waitForFunction(() => /not valid/.test(document.getElementById('confirm-result').textContent));
	check('a tampered confirm link is refused in plain words', /This confirmation link is not valid/.test(await page.locator('#confirm-result').innerText()));
	check('after a refusal the button can be tried again', await page.locator('#confirm-btn').isEnabled());
	const bea = addr('bea');
	await register({ email: bea, name: 'Bea Late' });
	const beaId = idOf(await h.linkFor(bea, 'confirm'));
	await page.goto(`${BASE}/events/confirm/?t=${encodeURIComponent(tokenWithExpiry('confirm', beaId, Math.floor(Date.now() / 1000) - 60))}`);
	await page.locator('#confirm-btn').click();
	await page.waitForFunction(() => document.getElementById('confirm-result').textContent.length > 0 && !/Confirming/.test(document.getElementById('confirm-result').textContent));
	check('an expired confirm link is refused', /not valid/.test(await page.locator('#confirm-result').innerText()), await page.locator('#confirm-result').innerText());
	check('an expired confirm link leaves the registration unconfirmed', row(bea).status === 'pending');
	await page.goto(`${BASE}/events/confirm/`);
	check('a confirm page with no token says the link is incomplete, with no button', /incomplete/.test(await page.locator('#confirm-intro').innerText()) && !(await page.locator('#confirm-btn').isVisible()));
	await axeOk(page, 'confirm page, incomplete link');

	// A manage-purpose token must not confirm, nor a confirm token manage: the purposes are separate.
	const amyManage = await h.linkFor(amy, 'manage');
	const cross = await fetch(`${BASE}/api/rsvp/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: tokenOf(amyManage) }) });
	check('a manage token does not work as a confirm token', cross.status === 404);

	// "I did not register".
	const cat = addr('cat');
	await register({ email: cat, name: 'Cat Mistaken', optins: [DINNER] });
	const catConfirm = await h.linkFor(cat, 'confirm');
	const catMail = (await h.mailsTo(cat))[0];
	const notMe = /href="([^"]*not-me=1[^"]*)"/.exec(catMail.html_body)?.[1]?.replace(/&amp;/g, '&');
	check('the confirmation email has an "I did not register" link to the confirm page', !!notMe && notMe.includes('/events/confirm/?t=') && notMe.endsWith('&not-me=1'), notMe);
	page = await newPage(light);
	await page.goto(notMe.replace(/^https?:\/\/[^/]+/, BASE));
	check('the "did not register" page offers a delete button, not a confirm one', (await page.locator('#confirm-panel button').innerText()) === 'Delete the registration');
	await axeOk(page, 'did-not-register page');
	await shot(page, 'not-me');
	await page.locator('#confirm-panel button').press('Enter');
	await page.locator('#confirm-result strong').waitFor();
	check('deleting says so and sends a final email', /Deleted/.test(await page.locator('#confirm-result').innerText()) && (await h.mailsTo(cat)).some((m) => m.subject.startsWith('Registration deleted')));
	check('the declined registration is gone', !row(cat));
	page = await newPage(light);
	await page.goto(catConfirm);
	await page.locator('#confirm-btn').click();
	await page.waitForFunction(() => /no longer exists/.test(document.getElementById('confirm-result').textContent));
	check('the confirm link of a deleted registration says it no longer exists', true);
	const declineConfirmed = await fetch(`${BASE}/api/rsvp/decline`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: tokenOf(amyConfirm) }) });
	check('"did not register" cannot delete a confirmed registration', declineConfirmed.status === 409 && row(amy));

	// Without JavaScript the confirm page should explain, not show a button that does nothing.
	page = await newPage(noJs);
	await page.goto(`${BASE}/events/confirm/?t=${encodeURIComponent(tokenOf(amyConfirm))}`);
	check('without JavaScript the confirm page says JavaScript is needed', /needs JavaScript/.test(await page.locator('main').innerText()));
	// Fixed 2026-10-30, kept as a regression check: confirm-nojs-button – the "Complete registration" button is still shown, and does nothing when pressed.
	check('without JavaScript there is no dead "Complete registration" button', !(await page.locator('#confirm-btn').isVisible()));
	await shot(page, 'confirm-nojs');

	// ---- the manage page ----
	console.log('Manage page');
	page = await newPage(light);
	await openManage(page, amyManage);
	check('the manage link is taken out of the address bar', !page.url().includes('t='), page.url());
	check('the manage page shows the registration', await page.locator('#manage-form').isVisible());
	check('the summary names the place, the tour and dinner', /In-person place\..*Booked on the 10:30 lab tour\..*Signed up for: Dinner/.test(await page.locator('#manage-summary').innerText()), await page.locator('#manage-summary').innerText());
	check('the form is filled in from the registration',
		(await page.locator('#m-name').inputValue()) === 'Amy Attendee' && (await page.locator('#m-email').innerText()) === amy
		&& (await page.locator('input[name=attendance][value=in_person]').isChecked()) && (await page.locator(`input[name=tour_id][value="${TOUR1}"]`).isChecked())
		&& (await page.locator(`input[name=optins][value="${DINNER}"]`).isChecked()) && (await page.locator('#m-needs').inputValue()) === 'Step-free access'
		&& (await page.locator('#m-extra').inputValue()) === 'A walk');
	check("the event's own wording labels the choices and the extra question",
		(await page.locator('#m-in-person-label').innerText()) === 'In person at White City' && /Staying on for Saturday/.test(await page.locator('#m-extra-label').innerText()));
	check('the manage page fits a phone screen', await noOverflow(page));
	await axeOk(page, 'manage page (phone, light)');
	await shot(page, 'manage-light');

	// Calendar files linked from the page.
	const icsLinks = await page.locator('#m-calendar a').evaluateAll((as) => as.map((a) => a.href));
	check('the manage page links a calendar file for the day and for dinner', icsLinks.length === 2, icsLinks.join(' '));
	for (const link of icsLinks) {
		const r = await fetch(link);
		const body = await r.text();
		const key = new URL(link).searchParams.get('entry');
		check(`calendar file ${key} is served as an attachment that is not cached`, r.status === 200 && /^text\/calendar/.test(r.headers.get('content-type')) && /^attachment/.test(r.headers.get('content-disposition') ?? '') && r.headers.get('cache-control') === 'no-store',
			`${r.status} ${r.headers.get('content-type')} ${r.headers.get('content-disposition')}`);
		check(`calendar file ${key} is one published event with a time zone`, body.startsWith('BEGIN:VCALENDAR\r\n') && /METHOD:PUBLISH/.test(body) && (body.match(/BEGIN:VEVENT/g) ?? []).length === 1 && /DTSTART;TZID=Europe\/London:/.test(body) && /\r\nEND:VCALENDAR\r\n?$/.test(body));
		check(`calendar file ${key} carries no manage link`, !/events\/manage/.test(body.replace(/\r\n /g, '')));
	}
	const names = await Promise.all(icsLinks.map(async (l) => (await fetch(l)).headers.get('content-disposition')));
	// Fixed 2026-10-30, kept as a regression check: ics-filename – every entry downloads as "event.ics", so the day and dinner files land as event.ics and event (1).ics.
	check('each calendar file has its own name', new Set(names).size === names.length, names.join(' | '));
	const badIcs = new URL(icsLinks[0]);
	badIcs.searchParams.set('t', tamper(badIcs.searchParams.get('t')));
	check('a tampered calendar link is refused', (await fetch(badIcs)).status === 404);
	const otherEntry = new URL(icsLinks[0]);
	otherEntry.searchParams.set('entry', 'nonsense');
	check('an unknown calendar entry is refused', (await fetch(otherEntry)).status === 404);
	check('a manage token does not open calendar files', (await fetch(`${BASE}/api/rsvp/calendar?t=${encodeURIComponent(tokenOf(amyManage))}&entry=day`)).status === 404);

	// Details that change nothing for anyone else: saved quietly.
	let before = (await h.outbox()).length;
	await page.locator('#m-needs').fill('Step-free access, and a vegetarian dinner');
	await page.locator('#m-extra').fill('A museum');
	check('saving details says so', /saved/.test(await saved(page)));
	let r = row(amy);
	check('needs and the extra answer are saved', r.needs === 'Step-free access, and a vegetarian dinner' && r.extra_answer === 'A museum');
	check('saving needs and answers emails nobody', (await h.outbox()).length === before, JSON.stringify((await h.outbox()).slice(before).map((m) => m.subject)));

	// Changing tour, by keyboard: arrow keys move between the radios of a group.
	before = (await h.outbox()).length;
	await page.locator(`input[name=tour_id][value="${TOUR1}"]`).focus();
	await page.keyboard.press('ArrowDown');
	check('arrow keys move to the next tour', await page.locator(`input[name=tour_id][value="${TOUR2}"]`).isChecked());
	await page.locator('#m-save').focus();
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => /11:15/.test(document.getElementById('manage-summary').textContent));
	r = row(amy);
	check('the tour change is saved with a place', r.tour_id === TOUR2 && r.tour_place === 'place');
	const calMail = (await h.outbox()).slice(before).find((m) => m.to_addr === amy);
	check('a tour change sends a calendar update', calMail?.subject.startsWith('Calendar update'), (await h.outbox()).slice(before).map((m) => m.subject).join(' | '));

	// Dropping dinner.
	before = (await h.outbox()).length;
	await page.locator(`input[name=optins][value="${DINNER}"]`).uncheck();
	await saved(page);
	r = row(amy);
	check('unticking dinner drops it', !r.optins);
	const dropMail = (await h.outbox()).slice(before).find((m) => m.to_addr === amy);
	check('dropping dinner cancels its calendar entry', dropMail && dropMail.att.some((a) => /METHOD=CANCEL/i.test(a.content_type)));
	check('the calendar list now has just the day', (await page.locator('#m-calendar a').count()) === 1);

	// Switching to remote: tour and dinner are put out of reach, and the instructions change.
	before = (await h.outbox()).length;
	await page.locator('input[name=attendance][value=remote]').check();
	check('choosing remote disables the tour and dinner choices', await disabled(page, '#m-tour-fs') && await disabled(page, '#m-optins-fieldset'));
	await saved(page);
	r = row(amy);
	check('switching to remote drops the place and tour', r.attendance === 'remote' && !r.place && !r.tour_id);
	const remoteMail = (await h.outbox()).slice(before).find((m) => m.to_addr === amy);
	check('switching to remote sends remote instructions', /changed to joining remotely/.test(remoteMail?.text_body ?? ''), remoteMail?.subject);
	check('remote attendees get a calendar file per online session', (await page.locator('#m-calendar a').count()) === 2);
	await axeOk(page, 'manage page, remote');

	// Just the dinner.
	await page.locator('input[name=attendance][value=extras]').check();
	check('"just the dinner" ticks dinner for you', await page.locator(`input[name=optins][value="${DINNER}"]`).isChecked());
	await saved(page);
	r = row(amy);
	check('"just the dinner" is saved as in person, no day place, dinner', r.attendance === 'in_person' && !r.place && r.optins === DINNER, JSON.stringify(r));
	check('the summary says dinner only', /Joining us for dinner only/.test(await page.locator('#manage-summary').innerText()), await page.locator('#manage-summary').innerText());

	// Back in person.
	await page.locator('input[name=attendance][value=in_person]').check();
	await saved(page);
	check('back in person with a place', row(amy).place === 'place');

	// Dark mode.
	const dpage = await newPage(dark);
	await openManage(dpage, amyManage);
	await axeOk(dpage, 'manage page (phone, dark)');
	await shot(dpage, 'manage-dark');
	const wpage = await newPage(wide);
	await openManage(wpage, amyManage);
	await axeOk(wpage, 'manage page (desktop)');
	await shot(wpage, 'manage-wide');

	// Keyboard: every control can be reached by Tab, in order, ending at the cancel button.
	const order = [];
	await wpage.locator('#m-name').focus();
	for (let i = 0; i < 40; i++) {
		const id = await wpage.evaluate(() => { const a = document.activeElement; return a.id || `${a.name}=${a.value}`; });
		order.push(id);
		if (id === 'm-cancel') break;
		await wpage.keyboard.press('Tab');
	}
	check('Tab reaches name, attendance, tour, dinner, needs, save and cancel in order',
		['m-name', 'attendance=in_person', `tour_id=none`, `optins=${DINNER}`, 'm-affiliation', 'm-needs', 'm-extra', 'm-share', 'm-save', 'm-cancel'].every((x, i, a) => order.indexOf(x) >= 0 && (i === 0 || order.indexOf(x) > order.indexOf(a[i - 1]))), order.join(' '));
	const ring = await wpage.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0; });
	check('the focused button shows a focus ring', ring);

	// A reload keeps working: people reload, and phones restore tabs.
	await wpage.reload();
	await wpage.waitForFunction(() => document.getElementById('manage-loading').textContent !== 'Loading your registration…' || !document.getElementById('manage-form').hidden);
	// Fixed 2026-10-30, kept as a regression check: manage-reload – the token is dropped from the address bar and kept nowhere, so a reload says "This link is not valid."
	check('reloading the manage page still shows the registration', (await wpage.locator('#m-name').inputValue()) === 'Amy Attendee', await wpage.locator('#manage-loading').innerText());

	// Without JavaScript.
	page = await newPage(noJs);
	await page.goto(amyManage);
	check('without JavaScript the manage page says JavaScript is needed', /needs JavaScript/.test(await page.locator('main').innerText()));
	// Fixed 2026-10-30, kept as a regression check: manage-nojs-loading – "Loading your registration…" stays on screen for good above the explanation.
	check('without JavaScript it does not claim to be loading', !(await page.locator('#manage-loading').isVisible()));
	await shot(page, 'manage-nojs');

	// Bad links.
	page = await newPage(light);
	await openManage(page, `${BASE}/events/manage/?t=${encodeURIComponent(tamper(tokenOf(amyManage)))}`);
	check('a tampered manage link says it is not valid', (await page.locator('#manage-loading').innerText()) === 'This link is not valid.');
	// Fixed 2026-10-30, kept as a regression check: hidden-shown – the panel's own display rules (#manage-form, .field, .choice) beat the hidden attribute, so an
	// empty form with "Save changes" and "Cancel my registration" shows under the error (and while loading, and without JavaScript).
	check('a bad manage link shows no empty form to save or cancel', !(await page.locator('#manage-form').isVisible()));
	await shot(page, 'manage-bad-link');
	await axeOk(page, 'manage page, bad link');
	await openManage(page, `${BASE}/events/manage/?t=${encodeURIComponent(tokenWithExpiry('manage', idOf(amyManage), Math.floor(Date.now() / 1000) - 1))}`);
	check('an expired manage link says it is not valid', (await page.locator('#manage-loading').innerText()) === 'This link is not valid.');
	await openManage(page, `${BASE}/events/manage/?t=${encodeURIComponent(tokenWithExpiry('confirm', idOf(amyManage), Math.floor(Date.now() / 1000) + 3600))}`);
	check('a confirm token does not open the manage page', (await page.locator('#manage-loading').innerText()) === 'This link is not valid.');
	await openManage(page, `${BASE}/events/manage/`);
	check('the manage page with no token says the link is not valid', (await page.locator('#manage-loading').innerText()) === 'This link is not valid.');

	// ---- the waiting list ----
	console.log('Waiting list');
	const held = h.sql(`SELECT COUNT(*) AS n FROM registrations WHERE event_id='${EVENT}' AND place='place' AND status IN ('confirmed','pending')`, true)[0].n;
	h.sql(`UPDATE events SET in_person_max=${held} WHERE id='${EVENT}'`);
	const dan = addr('dan');
	await register({ email: dan, name: 'Dan Waiting' });
	page = await newPage(light);
	const danSays = await confirmInBrowser(page, await h.linkFor(dan, 'confirm'));
	check('confirming when full says waiting list', /waiting list/.test(danSays) && !/in-person place\./.test(danSays), danSays);
	await shot(page, 'confirm-waitlist');
	const danMails = await h.mailsTo(dan);
	check('a waiting-list confirmation gets a manage link but no joining instructions', danMails.some((m) => m.subject.startsWith('Your registration')) && !danMails.some((m) => m.subject.startsWith('Joining instructions')));
	const danManage = await h.linkFor(dan, 'manage');
	await openManage(page, danManage);
	check('the waiting-list view says so', /On the in-person waiting list/.test(await page.locator('#manage-summary').innerText()), await page.locator('#manage-summary').innerText());
	check('nobody on the waiting list is offered calendar files', (await page.locator('#m-calendar a').count()) === 0);
	await axeOk(page, 'manage page, waiting list');
	await shot(page, 'manage-waitlist');
	// From the waiting list to remote: a place to join from, so joining instructions now.
	before = (await h.outbox()).length;
	await page.locator('input[name=attendance][value=remote]').check();
	await saved(page);
	check('leaving the waiting list for remote sends joining instructions', (await h.outbox()).slice(before).some((m) => m.to_addr === dan && /changed to joining remotely/.test(m.text_body)));
	h.sql(`UPDATE events SET in_person_max=20 WHERE id='${EVENT}'`);

	// ---- after registration closes ----
	console.log('After registration closes');
	const eve = addr('eve');
	await register({ email: eve, name: 'Eve Closing', attendance: 'remote' });
	const fay = addr('fay');
	await register({ email: fay, name: 'Fay Pending' });
	const eveConfirm = await h.linkFor(eve, 'confirm');
	page = await newPage(light);
	await confirmInBrowser(page, eveConfirm);
	const deadline = h.sql(`SELECT deadline FROM events WHERE id='${EVENT}'`, true)[0].deadline;
	h.sql(`UPDATE events SET deadline='${new Date(Date.now() - 60_000).toISOString()}' WHERE id='${EVENT}'`);
	const faySays = await confirmInBrowser(page, await h.linkFor(fay, 'confirm'));
	check('someone who registered in time can still confirm after the deadline', /registration is complete/.test(faySays), faySays);
	await openManage(page, await h.linkFor(eve, 'manage'));
	check('after the deadline the manage page says registration has closed', await page.locator('#m-closed').isVisible());
	check('after the deadline a remote attendee cannot pick in person', await page.locator('input[name=attendance][value=in_person]').isDisabled());
	await page.locator('#m-needs').fill('Captions please');
	check('after the deadline details can still be saved', /saved/.test(await saved(page)) && row(eve).needs === 'Captions please');
	const lateMove = await fetch(`${BASE}/api/rsvp/manage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: tokenOf(await h.linkFor(eve, 'manage')), name: 'Eve Closing', attendance: 'in_person' }) });
	check('after the deadline the server refuses a move to in person too', lateMove.status === 409);
	await axeOk(page, 'manage page, registration closed');
	await shot(page, 'manage-closed');
	// Fixed 2026-10-30, kept as a regression check: closed-extras – the page disables "just the dinner" once registration closes, but the server still lets a remote
	// attendee take a new dinner place that way.
	const lateExtras = await fetch(`${BASE}/api/rsvp/manage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: tokenOf(await h.linkFor(eve, 'manage')), name: 'Eve Closing', attendance: 'extras', optins: [DINNER] }) });
	check('after the deadline the server refuses a move from remote to just the dinner', lateExtras.status === 409, `${lateExtras.status} ${JSON.stringify(await lateExtras.json())}`);
	h.sql(`UPDATE events SET deadline='${deadline}' WHERE id='${EVENT}'`);

	// An event without an extra question: its answer field must not appear.
	h.sql(`UPDATE events SET extra_question=NULL WHERE id='${EVENT}'`);
	await openManage(page, await h.linkFor(eve, 'manage'));
	// Fixed 2026-10-30, kept as a regression check: hidden-shown – "Anything else (optional)" shows although the event asks nothing.
	check('with no extra question there is no extra answer field', !(await page.locator('#m-extra').isVisible()));
	h.sql(`UPDATE events SET extra_question='Staying on for Saturday?' WHERE id='${EVENT}'`);

	// ---- cancelling ----
	console.log('Cancelling');
	page = await newPage(light);
	await openManage(page, amyManage);
	page.once('dialog', (d) => d.dismiss());
	await page.locator('#m-cancel').click();
	check('saying no to "Cancel your registration?" keeps it', !!row(amy) && await page.locator('#manage-form #m-save').isVisible());
	before = (await h.outbox()).length;
	page.once('dialog', (d) => d.accept());
	await page.locator('#m-cancel').focus();
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => /has been cancelled/.test(document.getElementById('manage-form').textContent));
	check('cancelling says so, with focus on the outcome', await page.evaluate(() => /has been cancelled/.test(document.activeElement?.textContent ?? '')));
	check('the cancelled registration is deleted', !row(amy));
	const cancelMail = (await h.outbox()).slice(before).find((m) => m.to_addr === amy);
	check('a cancellation email follows, cancelling the calendar entry', cancelMail?.subject.startsWith('Registration cancelled') && cancelMail.att.some((a) => /METHOD=CANCEL/i.test(a.content_type)));
	await axeOk(page, 'manage page, cancelled');
	await shot(page, 'manage-cancelled');
	await openManage(page, amyManage);
	check('the manage link of a cancelled registration says it no longer exists', /no longer exists/.test(await page.locator('#manage-loading').innerText()));
	check('the calendar link of a cancelled registration is refused', (await fetch(icsLinks[0])).status === 404);

	// ---- the emails ----
	console.log('Emails');
	const mails = (await h.outbox()).filter((m) => [amy, dan, cat, eve].includes(m.to_addr));
	const kinds = new Map();
	for (const m of mails) { const k = m.subject.split(':')[0]; if (!kinds.has(k)) kinds.set(k, m); }
	check('emails of each kind were sent', ['Complete your registration', 'Joining instructions', 'Calendar update', 'Your registration', 'Registration cancelled', 'Registration deleted'].every((k) => kinds.has(k)), [...kinds.keys()].join(' | '));
	for (const [kind, m] of kinds) {
		for (const [ctx, w, label] of [[light, 375, 'phone'], [wide, 800, 'desktop'], [dark, 375, 'phone, dark']]) {
			const p = await ctx.newPage();
			await p.setViewportSize({ width: w, height: 800 });
			await p.setContent(m.html_body);
			// Fixed 2026-10-30, kept as a regression check: mail-long-link – the confirm email's "copy this link" URL wraps only where its random token happens to
			// have a break, so on a phone the email usually scrolls sideways (627px wide at 375px).
			check(`email "${kind}" fits ${label} width`, await noOverflow(p), `${await pageWidth(p)}px wide at ${w}px`);
			// Whether it overflows depends on the token's characters, so also check that a link written out in full may break.
			const stiff = await p.evaluate(() => [...document.querySelectorAll('a')].filter((a) => /^https?:\/\/\S{60,}$/.test(a.textContent.trim()))
				.filter((a) => { const s = getComputedStyle(a); return s.overflowWrap === 'normal' && s.wordBreak !== 'break-all'; }).length);
			check(`email "${kind}" lets long links wrap (${label})`, !stiff, `${stiff} unbreakable`);
			if (label !== 'desktop') await shot(p, `mail-${kind.replace(/\W+/g, '-')}-${label.replace(/\W+/g, '-')}`);
			await p.close();
		}
		// Every link in the email goes where it says: our pages answer, and nothing points at another host's copy of ours.
		for (const href of [...m.html_body.matchAll(/href="([^"]+)"/g)].map((x) => x[1].replace(/&amp;/g, '&'))) {
			if (href.startsWith('mailto:')) continue;
			const u = new URL(href);
			if (u.origin !== new URL(BASE).origin) {
				check(`email "${kind}" links elsewhere only to calendars or the project`, /^(calendar\.google\.com|outlook\.live\.com|outlook\.office\.com|calendar\.yahoo\.com|github\.com)$/.test(u.hostname), href);
				continue;
			}
			if (/\/api\/rsvp\/calendar/.test(u.pathname) && kind === 'Registration cancelled') continue;
			const res = await fetch(u, { redirect: 'manual' });
			check(`email "${kind}" link ${u.pathname} answers`, res.status === 200 || (u.pathname.startsWith('/api/rsvp/calendar') && res.status === 404 && !row(m.to_addr)), `${res.status} ${href}`);
		}
	}
	// The confirm email lists what is being confirmed: nothing is had yet, only held.
	const confirmMail = (await h.mailsTo(amy)).find((m) => m.subject.startsWith('Complete your registration'));
	// Fixed 2026-10-30, kept as a regression check: confirm-dinner-wording – it says "You have a place at dinner." beside "An in-person place is held for you."
	check('the confirm email says dinner is held, not had', !/You have a place at/.test(confirmMail.text_body) && /held/.test(confirmMail.text_body), confirmMail.text_body.split('\n').filter((l) => /place/.test(l)).join(' / '));

	// The add-to-calendar links, from the joining instructions.
	const instr = kinds.get('Joining instructions');
	const g = [...instr.html_body.matchAll(/href="(https:\/\/calendar\.google\.com[^"]+)"/g)].map((x) => new URL(x[1].replace(/&amp;/g, '&')));
	check('the joining instructions have an add-to-Google link per entry', g.length >= 1);
	for (const u of g) check('the Google link has a title, UTC times and a place', u.searchParams.get('action') === 'TEMPLATE' && !!u.searchParams.get('text') && /^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/.test(u.searchParams.get('dates') ?? '') && !!u.searchParams.get('location'), u.href);
	const ol = [...instr.html_body.matchAll(/href="(https:\/\/outlook\.(?:live|office)\.com[^"]+)"/g)].map((x) => new URL(x[1].replace(/&amp;/g, '&')));
	for (const u of ol) check(`the ${u.hostname} link has ISO times`, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(u.searchParams.get('startdt') ?? '') && u.searchParams.get('rru') === 'addevent', u.href);
	const y = [...instr.html_body.matchAll(/href="(https:\/\/calendar\.yahoo\.com[^"]+)"/g)].map((x) => new URL(x[1].replace(/&amp;/g, '&')));
	for (const u of y) check('the Yahoo link has times and a title', /^\d{8}T\d{6}Z$/.test(u.searchParams.get('st') ?? '') && !!u.searchParams.get('title'), u.href);
	check('calendar links carry no manage link', ![...g, ...ol, ...y].some((u) => /events\/manage/.test(decodeURIComponent(u.href))));

	check('no script errors on any page', !errors.length, errors.join(' | '));
	check('nothing was fetched from another site', !h.thirdParty.length, h.thirdParty.join(' '));
} catch (e) {
	console.error(e);
	check('the test ran to the end', false, e.stack);
} finally {
	await h.stop();
}
const { passes, failures } = h.results();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

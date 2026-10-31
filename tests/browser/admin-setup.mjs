#!/usr/bin/env node
// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../LICENSE.
/**
 * Browser test of the admin page's set-up half (/admin/rsvps/): events (edit, time zones, new, clone), settings,
 * the sessions editor and its two save buttons, joining-instruction versions and polls, as an organiser would use
 * them. The registrations half (promote, export, messages, sent log) is tested elsewhere.
 *
 *   SITE_DIR=… PORT=8794 node tests/browser/admin-setup.mjs     (see harness.mjs; OUT=dir keeps screenshots)
 */
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as h from './harness.mjs';

const { BASE, EVENT, check } = h;
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });
const ADMIN = '/admin/rsvps/';
const TOUR1 = `${EVENT}-tour-1030`, TALKS_AM = `${EVENT}-talks-am`, TALKS_PM = `${EVENT}-talks-pm`, DINNER = `${EVENT}-pub`;
const HOST = 'host@example.org';

const post = async (path, body) => {
	const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	return { status: r.status, data: await r.json().catch(() => null) };
};
const register = (over) => post('/api/rsvp/register', {
	event: EVENT, name: 'Test Person', attendance: 'in_person', tour_id: 'none', consent: true, website: '', 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX', ...over,
});
const tokenOf = (url) => (url ? decodeURIComponent(new URL(url).searchParams.get('t')) : null);
async function registerAndConfirm(over) {
	const r = await register(over);
	if (r.status !== 200) throw new Error(`register ${over.email}: ${JSON.stringify(r.data)}`);
	await post('/api/rsvp/confirm', { t: tokenOf(await h.linkFor(over.email, 'confirm')) });
	return tokenOf(await h.linkFor(over.email, 'manage'));
}
const row = (q) => h.sql(q, true)[0];
/** UTC in winter, so the UK wall-clock time the editor shows. */
const isoToWall = (iso) => iso.slice(0, 16);
const sessionRow = (id) => row(`SELECT * FROM sessions WHERE id='${id}'`);

let page, dialogs = [], promptAnswer = null, dismissNext = false;
const errors = [];
async function newPage(opts = {}) {
	const ctx = await h.context({ admin: true, ...opts });
	const p = await ctx.newPage();
	p.setDefaultTimeout(8000);
	p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
	p.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
	p.on('dialog', async (d) => {
		dialogs.push({ type: d.type(), message: d.message() });
		if (d.type() === 'prompt') await d.accept(promptAnswer ?? '');
		else if (dismissNext) { dismissNext = false; await d.dismiss(); } else await d.accept();
	});
	return p;
}
/** Opens the admin page for an event and waits until load() has filled it in. */
async function open(p, event = EVENT) {
	await p.goto(`${BASE}${ADMIN}?event=${encodeURIComponent(event)}`);
	await p.waitForFunction(() => document.getElementById('ev-pick').options.length > 0 || document.getElementById('new-details').open, null, { timeout: 15000 });
	await p.waitForTimeout(400);
	// Every form open, as an organiser working down the page would have them.
	await p.evaluate(() => document.querySelectorAll('#events details, section details').forEach((d) => { if (!d.hidden) d.open = true; }));
}
/** Runs an action and returns the toast it leaves (the page reloads its data after most of them, so wait for that too). */
async function toastAfter(action, p = page) {
	await p.evaluate(() => { document.getElementById('toast').textContent = ''; });
	await action();
	await p.waitForFunction(() => document.getElementById('toast').textContent.trim() !== '', null, { timeout: 10000 }).catch(() => {});
	await p.waitForTimeout(700);
	return p.evaluate(() => document.getElementById('toast').textContent);
}
const openDetails = (summary) => page.locator('summary', { hasText: summary }).first().evaluate((s) => { s.parentElement.open = true; });
const shot = (name, p = page) => (OUT ? p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }) : null);
const sx = (field, id) => `#sx-${field}-${id}`;
const mailCount = async () => (await h.outbox()).length;
const mailsSince = async (n) => (await h.outbox()).slice(n);

try {
	await h.start();
	const ann = `ann-${randomUUID().slice(0, 8)}@example.org`, ben = `ben-${randomUUID().slice(0, 8)}@example.org`, cat = `cat-${randomUUID().slice(0, 8)}@example.org`;
	const attendees = [ann, ben, cat];
	const annManage = await registerAndConfirm({ name: 'Ann', email: ann, tour_id: TOUR1, optins: [DINNER] });
	await registerAndConfirm({ name: 'Ben', email: ben, attendance: 'remote' });
	await registerAndConfirm({ name: 'Cat', email: cat });
	check('three people registered and confirmed', !!annManage && row(`SELECT COUNT(*) AS n FROM registrations WHERE status='confirmed'`).n === 3);

	page = await newPage();
	await open(page);

	let mails, t;
	console.log('\nThe page');
	check('the admin page loads the seeded event', (await page.inputValue('#e-title')).length > 0 && (await page.locator('#sessions-box fieldset').count()) === 5);
	// VERSION already ends in -beta: the header once added "(beta)" after it.
	check('the header names the version without saying beta twice', !/beta \(beta\)/.test(await page.locator('header').textContent()), await page.locator('header').textContent());
	check('times are labelled UK time', (await page.locator('.tzl').first().textContent()) === 'UK time');
	for (const s of ['Edit this event', 'Clone this event', 'New event', 'Add a session', 'New poll']) await openDetails(s);
	await shot('admin-desktop');
	{
		const v = await h.axe(page);
		check('axe: no serious or critical violations on the admin page, every form open', !v.some((x) => ['serious', 'critical'].includes(x.impact)), JSON.stringify(v));
		if (v.length) console.log('    axe (all):', JSON.stringify(v));
	}

	console.log('\nSessions: save with emails');
	mails = await mailCount();
	{
		// An online link is only in remote attendees' calendar entries, so only Ben's change.
		await page.fill(sx('url', TALKS_AM), 'https://meet.example.org/talks-am');
		t = await toastAfter(() => page.click('#sess-dry'));
		check('"How many would get a calendar update?" counts only the remote attendee', /^1 person\(s\) would get updated calendar invitations\./.test(t), t);
		check('…and changes nothing', !sessionRow(TALKS_AM).online_url && (await mailCount()) === mails);
		dialogs = [];
		t = await toastAfter(() => page.click('#sessions-form button[type=submit]'));
		check('Save sessions asks first, with the count', dialogs.length === 1 && /1 person\(s\) will get updated calendar invitations/.test(dialogs[0].message), JSON.stringify(dialogs));
		check('…then says one update was sent', /Sessions saved\. 1 calendar update\(s\) sent\./.test(t), t);
		const sent = await mailsSince(mails);
		check('only Ben, who attends remotely, is emailed', sent.length === 1 && sent[0].to_addr === ben, sent.map((m) => `${m.to_addr}: ${m.subject}`).join(' | '));
		check('…with the new link in his calendar update', sent.length === 1 && /Calendar update/.test(sent[0].subject) && sent[0].att.some((a) => /\.ics$/.test(a.filename || '')) && /meet\.example\.org\/talks-am/.test(JSON.stringify(sent[0].att)), JSON.stringify(sent[0]?.att?.map((a) => a.filename)));

		mails = await mailCount();
		dismissNext = true;
		await page.fill(sx('loc', DINNER), 'Somewhere else');
		t = await toastAfter(() => page.click('#sessions-form button[type=submit]'));
		check('cancelling the confirm saves nothing and emails nobody', sessionRow(DINNER).location !== 'Somewhere else' && (await mailCount()) === mails, t);
		await open(page);
	}

	console.log('\nSessions: save without emailing attendees');
	mails = await mailCount();
	{
		// Dinner is in Ann's own entry and in the schedule of every in-person day entry (Ann's and Cat's), not Ben's.
		const dl = await page.inputValue(sx('start', DINNER));
		await page.fill(sx('start', DINNER), dl.replace(/T(\d\d):(\d\d)/, (_, hh, mm) => `T${hh}:${mm === '00' ? '30' : '00'}`));
		await page.fill(sx('hname', TALKS_PM), 'Hana Host');
		await page.fill(sx('hemail', TALKS_PM), HOST);
		dialogs = [];
		t = await toastAfter(() => page.click('#sess-quiet'));
		check('the quiet save asks first and says nobody was emailed', dialogs.length === 1 && /without emailing attendees/.test(dialogs[0].message) && /Nobody was emailed|No attendee was emailed/.test(t), t);
		const sent = await mailsSince(mails);
		check('no attendee is emailed by the quiet save', !sent.some((m) => attendees.includes(m.to_addr)), sent.map((m) => m.to_addr).join());
		check('…but the new host gets their list, with all three', sent.length === 1 && sent[0].to_addr === HOST && ['Ann', 'Ben', 'Cat'].every((n) => sent[0].text_body.includes(n)), sent.map((m) => `${m.to_addr}: ${m.subject}`).join(' | '));
		check('the dinner time and host are stored', sessionRow(DINNER).starts_at !== undefined && isoToWall(sessionRow(DINNER).starts_at) !== dl && sessionRow(TALKS_PM).host_email === HOST);
		// The quiet save left the in-person calendars behind; the dry run now counts Ann and Cat.
		t = await toastAfter(() => page.click('#sess-dry'));
		check('after a quiet save, the dry run counts the two in-person attendees still to be updated', /^2 person/.test(t), t);
	}

	console.log('\nEditing the event');
	mails = await mailCount();
	await page.fill('#e-title', 'AMYBO Event, London (edited)');
	await page.fill('#e-loc', 'Room 516, I-HUB, 84 Wood Lane, London W12 0BZ');
	t = await toastAfter(() => page.click('#ev-form button[type=submit]'));
	check('saving the event says nobody was emailed', /Event saved\. Nobody has been emailed\./.test(t), t);
	check('…and nobody was', (await mailCount()) === mails);
	check('…and the title is stored', row(`SELECT title FROM events WHERE id='${EVENT}'`).title === 'AMYBO Event, London (edited)');

	const start = await page.inputValue('#e-start'), end = await page.inputValue('#e-end');
	await page.fill('#e-end', start.replace(/T.*/, 'T09:00'));
	t = await toastAfter(() => page.click('#ev-form button[type=submit]'));
	check('an end before the start is refused in plain words', /must end after it starts/.test(t), t);
	await page.fill('#e-end', end);

	await page.fill('#e-tz', 'Mars/Olympus');
	t = await toastAfter(() => page.click('#ev-form button[type=submit]'));
	check('an unknown time zone is refused with an example of a good one', /Unknown time zone: use a name such as Europe\/London/.test(t), t);
	await page.fill('#e-tz', '+01:00');
	t = await toastAfter(() => page.click('#ev-form button[type=submit]'));
	check('a fixed offset is refused (it knows nothing of summer time)', /Unknown time zone/.test(t), t);

	await page.fill('#e-tz', 'Europe/London');
	await page.fill('#e-page', 'events/london');
	t = await toastAfter(() => page.click('#ev-form button[type=submit]'));
	check('an event page that is not a path on the site is refused', /must be a path on your site, starting with \//.test(t), t);
	await open(page);

	// A new zone keeps every instant and changes only how times are shown.
	const before = row(`SELECT starts_at, ends_at FROM events WHERE id='${EVENT}'`), amBefore = sessionRow(TALKS_AM).starts_at;
	await page.fill('#e-tz', 'America/New_York');
	t = await toastAfter(() => page.click('#ev-form button[type=submit]'));
	const after = row(`SELECT starts_at, ends_at, timezone FROM events WHERE id='${EVENT}'`);
	check('changing the time zone keeps the event at the same moment', after.timezone === 'America/New_York' && after.starts_at === before.starts_at && after.ends_at === before.ends_at, JSON.stringify([before, after, t]));
	check('…and its sessions', sessionRow(TALKS_AM).starts_at === amBefore);
	const nyAm = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' }).format(new Date(amBefore)).replace(' ', 'T');
	check('…the labels say New York time and the session times are shown in it', (await page.locator('.tzl').first().textContent()) === 'New York time' && (await page.inputValue(sx('start', TALKS_AM))) === nyAm, `${await page.inputValue(sx('start', TALKS_AM))} vs ${nyAm}`);
	await page.fill('#e-tz', 'Europe/London');
	await toastAfter(() => page.click('#ev-form button[type=submit]'));
	check('…and back to Europe/London', row(`SELECT timezone FROM events WHERE id='${EVENT}'`).timezone === 'Europe/London' && (await page.locator('.tzl').first().textContent()) === 'UK time');

	// Moving the event a week on once moved none of its sessions, so everyone's calendar kept the old day while the
	// page showed the new one. Now the sessions (and the registration deadline) move with it, by whole days.
	{
		const deadlineBefore = row(`SELECT deadline FROM events WHERE id='${EVENT}'`).deadline;
		const shift = (v) => { const d = new Date(v + 'Z'); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 16); };
		await page.fill('#e-start', shift(await page.inputValue('#e-start')));
		await page.fill('#e-end', shift(await page.inputValue('#e-end')));
		t = await toastAfter(() => page.click('#ev-form button[type=submit]'));
		const moved = Date.parse(row(`SELECT starts_at FROM events WHERE id='${EVENT}'`).starts_at) !== Date.parse(before.starts_at);
		const week = (iso) => new Date(Date.parse(iso) + 7 * 86400_000).toISOString();
		check('moving the event a week moves its sessions with it, to the same time a week on', moved && sessionRow(TALKS_AM).starts_at === week(amBefore), JSON.stringify([sessionRow(TALKS_AM).starts_at, t]));
		check('…and its registration deadline, saying so and emailing nobody', row(`SELECT deadline FROM events WHERE id='${EVENT}'`).deadline === week(deadlineBefore) && /moved with it/.test(t) && /Nobody has been emailed/.test(t), t);
		if (moved) { await page.fill('#e-start', start); await page.fill('#e-end', end); await toastAfter(() => page.click('#ev-form button[type=submit]')); }
		// By instant: the seed writes times without milliseconds, and moved times are written back with them.
		const same = (a, b) => Date.parse(a) === Date.parse(b);
		const now = () => [row(`SELECT starts_at FROM events WHERE id='${EVENT}'`).starts_at, sessionRow(TALKS_AM).starts_at, row(`SELECT deadline FROM events WHERE id='${EVENT}'`).deadline];
		check('moving it back brings the sessions and deadline back too', same(now()[0], before.starts_at) && same(now()[1], amBefore) && same(now()[2], deadlineBefore), JSON.stringify([now(), before.starts_at, amBefore, deadlineBefore]));
		// A new start time on the same day is a correction, not a move: the sessions stay where they are.
		await page.fill('#e-start', start.replace(/T\d\d:\d\d/, 'T07:00'));
		await toastAfter(() => page.click('#ev-form button[type=submit]'));
		check('changing only the start time leaves the sessions alone', same(sessionRow(TALKS_AM).starts_at, amBefore) && !same(row(`SELECT starts_at FROM events WHERE id='${EVENT}'`).starts_at, before.starts_at));
		await page.fill('#e-start', start);
		await toastAfter(() => page.click('#ev-form button[type=submit]'));
	}

	console.log('\nSettings');
	{
		const endsAt = row(`SELECT ends_at FROM events WHERE id='${EVENT}'`).ends_at;
		const late = new Date(Date.parse(endsAt) + 3 * 86400_000).toISOString().slice(0, 16);
		const was = await page.inputValue('#s-deadline');
		await page.fill('#s-deadline', late);
		t = await toastAfter(() => page.click('#settings-form button[type=submit]'));
		// "Edit this event" refuses a deadline after the end, and so does the settings form, the only place it is edited.
		check('a registration deadline after the event ends is refused', /before the event ends/.test(t) && row(`SELECT deadline FROM events WHERE id='${EVENT}'`).deadline < endsAt, t);
		await page.fill('#s-deadline', was);
		await toastAfter(() => page.click('#settings-form button[type=submit]'));
		await page.fill('#s-max', '-1');
		check('a negative in-person maximum is stopped by the browser', !(await page.locator('#s-max').evaluate((i) => i.checkValidity())));
		await open(page);
	}

	console.log('\nSessions: what an organiser might type wrong');
	{
		const tryQuiet = async (sel, value) => {
			await open(page);
			await page.fill(sel, value);
			return toastAfter(() => page.click('#sess-quiet'));
		};
		t = await tryQuiet(sx('hemail', TALKS_AM), 'not-an-email');
		check('a host email that is not an address is refused', /Invalid host email/.test(t), t);
		t = await tryQuiet(sx('url', TALKS_AM), 'meet.google.com/abc-defg-hij');
		check('an online link without https:// is refused, saying why', /must start with https:\/\//.test(t), t);
		t = await tryQuiet(sx('cap', TOUR1), '-3');
		check('a negative capacity is refused', /Capacity must be a whole number/.test(t), t);
		await open(page);
		const s = await page.inputValue(sx('start', TALKS_AM));
		await page.fill(sx('end', TALKS_AM), s.replace(/T.*/, 'T08:00'));
		t = await toastAfter(() => page.click('#sess-quiet'));
		check('a session ending before it starts is refused, naming it', /Welcome and talks: the end must be after the start/.test(t), t);
		// The Save button checks the form first, so a bad address never reaches the server.
		await open(page);
		await page.fill(sx('hemail', TALKS_AM), 'not-an-email');
		check('the browser stops "Save sessions" with a bad host address', !(await page.locator('#sessions-form').evaluate((f) => f.checkValidity())));

		// Adding a session refuses one more than a day outside the event; so does moving an existing one there.
		await open(page);
		const nextYear = (v) => v.replace(/^(\d{4})/, (y) => String(+y + 1));
		const amWas = sessionRow(TALKS_AM).starts_at;
		await page.fill(sx('start', TALKS_AM), nextYear(await page.inputValue(sx('start', TALKS_AM))));
		await page.fill(sx('end', TALKS_AM), nextYear(await page.inputValue(sx('end', TALKS_AM))));
		t = await toastAfter(() => page.click('#sess-quiet'));
		check('moving a session a year outside the event is refused', /during the event/.test(t) && sessionRow(TALKS_AM).starts_at === amWas, t);
		if (sessionRow(TALKS_AM).starts_at !== amWas) h.sql(`UPDATE sessions SET starts_at='${amWas}', ends_at='${new Date(Date.parse(amWas) + 90 * 60000).toISOString()}' WHERE id='${TALKS_AM}'`);

		// Booking deadline for a tour: blank means at its start.
		await open(page);
		const tourStart = await page.inputValue(sx('start', TOUR1));
		const dayBefore = new Date(Date.parse(tourStart + 'Z') - 86400_000).toISOString().slice(0, 16);
		await page.fill(sx('dl', TOUR1), dayBefore);
		await toastAfter(() => page.click('#sess-quiet'));
		check('a tour\'s booking deadline is saved (UK time = UTC in November)', sessionRow(TOUR1).booking_deadline?.startsWith(dayBefore), sessionRow(TOUR1).booking_deadline);
		check('core sessions have no booking deadline field', (await page.locator(sx('dl', TALKS_AM)).count()) === 0 && (await page.locator(sx('dl', DINNER)).count()) === 1);
	}

	console.log('\nAdding and deleting sessions');
	await open(page);
	await openDetails('Add a session');
	mails = await mailCount();
	{
		const day = (await page.inputValue(sx('start', DINNER))).slice(0, 10);
		await page.fill('#a-label', 'Drinks');
		await page.selectOption('#a-kind', 'social');
		await page.selectOption('#a-type', 'optin');
		await page.fill('#a-start', `${day}T21:00`);
		await page.fill('#a-end', `${day}T20:00`);
		t = await toastAfter(() => page.click('#addsess-form button[type=submit]'));
		check('a new session ending before it starts is refused', /Drinks: the end must be after the start/.test(t), t);
		await page.fill('#a-end', `${String(+day.slice(0, 4) + 1)}${day.slice(4)}T23:00`);
		await page.fill('#a-start', `${String(+day.slice(0, 4) + 1)}${day.slice(4)}T21:00`);
		t = await toastAfter(() => page.click('#addsess-form button[type=submit]'));
		check('a new session a year away is refused', /during the event, give or take a day/.test(t), t);

		// Unsaved edits in the sessions editor while adding a session.
		await page.fill(sx('loc', TALKS_PM), 'Lecture theatre 2 (unsaved)');
		await page.fill('#a-start', `${day}T21:00`);
		await page.fill('#a-end', `${day}T23:00`);
		await page.fill('#a-cap', '12');
		t = await toastAfter(() => page.click('#addsess-form button[type=submit]'));
		check('adding a session says nobody was emailed', /Session added\. Nobody has been emailed\./.test(t), t);
		check('…and nobody was', (await mailCount()) === mails);
		const drinks = row(`SELECT * FROM sessions WHERE event_id='${EVENT}' AND label='Drinks'`);
		check('…stored as an opt-in social at 21:00 UK time, capacity 12', drinks && drinks.optin === 1 && drinks.kind === 'social' && drinks.starts_at.startsWith(`${day}T21:00`) && drinks.capacity === 12, JSON.stringify(drinks));
		check('…and it appears in the editor with a booking deadline field', drinks && (await page.locator(sx('dl', drinks.id)).count()) === 1);
		// Every save on the page reloads the sessions editor from the server; typing in it must survive that.
		check('an unsaved edit in the sessions editor survives adding a session', (await page.inputValue(sx('loc', TALKS_PM))) === 'Lecture theatre 2 (unsaved)', await page.inputValue(sx('loc', TALKS_PM)));

		dialogs = [];
		t = await toastAfter(() => page.click(`button[data-delsess="${drinks.id}"]`));
		check('deleting an unbooked session asks first, by name, then deletes it', /Delete Drinks\?/.test(dialogs[0]?.message) && /Session deleted/.test(t) && !row(`SELECT 1 AS x FROM sessions WHERE id='${drinks.id}'`), t);
		t = await toastAfter(() => page.click(`button[data-delsess="${TOUR1}"]`));
		check('a booked tour cannot be deleted, and the organiser is told why', /People have booked or signed up for this session/.test(t), t);
		t = await toastAfter(() => page.click(`button[data-delsess="${TALKS_AM}"]`));
		check('a core session already in people\'s calendars cannot be deleted', /Calendar invitations have gone out/.test(t), t);
		check('nobody was emailed by any of that', (await mailCount()) === mails);
	}

	console.log('\nUnsaved changes');
	{
		await open(page);
		await page.fill(sx('loc', TALKS_PM), 'Typed but not saved');
		dialogs = [];
		await page.close({ runBeforeUnload: true });
		await new Promise((r) => setTimeout(r, 800));
		// Leaving the page (or picking another event) with typed, unsaved session changes asks first.
		check('leaving the page with unsaved session edits asks first', dialogs.some((d) => d.type === 'beforeunload'), JSON.stringify(dialogs));
		page = await newPage();
		await open(page);
	}

	console.log('\nJoining instructions');
	mails = await mailCount();
	{
		check('version 1 is listed and prefilled', /Version 1/.test(await page.locator('#instr-versions').textContent()) && (await page.inputValue('#i-subject')).length > 0);
		await page.fill('#i-body', (await page.inputValue('#i-body')) + '\n\n**New:** bring photo ID.');
		await page.fill('#i-note', 'Bring photo ID');
		await page.click('button[data-preview="i-body"]');
		await page.waitForSelector('#i-body-preview:not([hidden]) strong');
		check('Preview shows the markdown as it will look', /bring photo ID/.test(await page.locator('#i-body-preview').textContent()) && (await page.locator('#i-body-preview strong', { hasText: 'New:' }).count()) === 1);
		t = await toastAfter(() => page.click('#instr-form button[type=submit]'));
		check('saving a new version says existing registrants were not emailed', /Saved as version 2\..*existing registrants have not been emailed/.test(t), t);
		check('…and nobody was', (await mailCount()) === mails);
		check('version 2 is listed first with its change note', /^Version 2 .* – Bring photo ID/.test((await page.locator('#instr-versions summary').first().textContent()).trim()), await page.locator('#instr-versions summary').first().textContent());
		check('the message form offers version 2', /version 2\)/.test(await page.locator('#m-instr').locator('..').textContent()));
		await page.fill('#i-body', '   ');
		t = await toastAfter(() => page.locator('#instr-form').evaluate((f) => f.requestSubmit()));
		check('an empty body is refused', /Subject and body are required/.test(t) || !(await page.locator('#i-body').evaluate((x) => x.checkValidity())), t);
		check('…and makes no version 3', row(`SELECT MAX(version) AS v FROM instructions WHERE event_id='${EVENT}'`).v === 2);
	}

	console.log('\nPolls');
	await open(page);
	await openDetails('New poll');
	mails = await mailCount();
	let poll;
	{
		await page.fill('#p-q', 'What shall we do on Saturday?');
		await page.fill('#p-opts', 'Hiking\nPub quiz\n  hiking \n\nMuseum');
		t = await toastAfter(() => page.click('#poll-form button[type=submit]'));
		check('creating a poll says nobody was emailed', /Poll created\. Nobody has been emailed\./.test(t), t);
		poll = row(`SELECT * FROM polls WHERE event_id='${EVENT}'`);
		const opts = h.sql(`SELECT label FROM poll_options WHERE poll_id='${poll?.id}' ORDER BY sort`, true).map((o) => o.label);
		check('…with its options, the repeated one once', JSON.stringify(opts) === '["Hiking","Pub quiz","Museum"]', JSON.stringify(opts));
		check('the poll shows on the page, open, with no answers yet', /Open, closes when the event ends\. 0 answer\(s\)/.test(await page.locator(`fieldset[data-poll="${poll.id}"]`).textContent()));

		const ids = Object.fromEntries(h.sql(`SELECT id, label FROM poll_options WHERE poll_id='${poll.id}'`, true).map((o) => [o.label, o.id]));
		let r = await post('/api/rsvp/poll', { t: annManage, poll: poll.id, ranking: [ids.Museum, ids.Hiking, ids['Pub quiz']], bar: 2 });
		check('Ann answers the poll', r.status === 200, JSON.stringify(r.data));
		r = await post('/api/rsvp/poll', { t: annManage, poll: poll.id, suggest: 'Karaoke' });
		check('Ann suggests karaoke', r.status === 200 && r.data.option?.pending, JSON.stringify(r.data));
		await open(page);
		const fs = page.locator(`fieldset[data-poll="${poll.id}"]`);
		check('the results show Ann would join the museum and hiking', /1 answer\(s\)/.test(await fs.textContent()) && /Museum\s*1\s*0\s*1/.test((await fs.locator('tbody tr').first().innerText()).replace(/\t/g, ' ')) && /Ann/.test(await fs.locator('tbody tr').first().textContent()), await fs.locator('tbody').innerText());
		check('Ann\'s suggestion waits for a decision, with her name', /Karaoke from Ann/.test(await fs.textContent()));
		promptAnswer = 'Karaoke night';
		dialogs = [];
		t = await toastAfter(() => fs.locator('button[data-poll-decide="use"]').click());
		check('"Add in my words…" asks for the wording and adds it', dialogs[0]?.type === 'prompt' && /^Done: /.test(t) && /Karaoke night/.test(await page.locator(`fieldset[data-poll="${poll.id}"] tbody`).textContent()), `${t} ${JSON.stringify(dialogs)}`);

		await page.fill(`#po-${poll.id}`, 'Board games');
		t = await toastAfter(() => page.click(`button[data-poll-add="${poll.id}"]`));
		check('adding an option', /Option added/.test(t) && /Board games/.test(await page.locator(`fieldset[data-poll="${poll.id}"] tbody`).textContent()), t);
		await page.fill(`#po-${poll.id}`, ' HIKING');
		t = await toastAfter(() => page.click(`button[data-poll-add="${poll.id}"]`));
		check('an option that is already there is refused', /already an option/.test(t), t);
		// The "Add an option" box is not in a form, so Enter is wired to its button for keyboard users.
		await page.fill(`#po-${poll.id}`, 'Cinema');
		t = await toastAfter(() => page.press(`#po-${poll.id}`, 'Enter'));
		check('Enter in "Add an option" adds it', /Cinema/.test(await page.locator(`fieldset[data-poll="${poll.id}"] tbody`).textContent()), t);

		t = await toastAfter(() => page.click(`button[data-poll-close="${poll.id}"]`));
		check('"Close now" closes the poll', /^Closed,/.test((await page.locator(`fieldset[data-poll="${poll.id}"] p.small`).first().textContent()).trim()));
		t = await toastAfter(() => page.click(`button[data-poll-close="${poll.id}"]`));
		check('…and it can be reopened', /^Open,/.test((await page.locator(`fieldset[data-poll="${poll.id}"] p.small`).first().textContent()).trim()));
		const sent = await mailsSince(mails);
		check('no registrant was emailed by any poll action (only the organiser, about the suggestion)', !sent.some((m) => attendees.includes(m.to_addr)) && sent.every((m) => m.to_addr === 'events@example.org'), sent.map((m) => `${m.to_addr}: ${m.subject}`).join(' | '));
	}

	console.log('\nCloning to a summer date');
	await open(page);
	await openDetails('Clone this event');
	{
		await page.fill('#c-id', '2027-07-16-london');
		await page.fill('#c-title', 'AMYBO Summer Event');
		await page.fill('#c-start', '2027-07-16T10:30');
		await page.fill('#c-page', row(`SELECT page_path FROM events WHERE id='${EVENT}'`).page_path);
		t = await toastAfter(() => page.click('#clone-form button[type=submit]'));
		check('cloning onto the same event page is refused, saying why', /Give the new event its own page/.test(t), `${t} ${page.url()} ${JSON.stringify(h.sql('SELECT id, page_path FROM events', true))}`);
		await page.fill('#c-page', '/events/2027-07-16-london/');
		await page.fill('#c-id', EVENT);
		t = await toastAfter(() => page.click('#clone-form button[type=submit]'));
		check('cloning onto an id in use is refused', /already exists/.test(t), t);
		await page.fill('#c-id', '2027-07-16-london');
		mails = await mailCount();
		await Promise.all([page.waitForURL(/event=2027-07-16-london/), page.click('#clone-form button[type=submit]')]);
		await open(page, '2027-07-16-london');
		const sess = h.sql(`SELECT label, starts_at, ends_at, host_email, online_url FROM sessions WHERE event_id='2027-07-16-london' ORDER BY sort`, true);
		check('the clone opens, with five sessions', (await page.inputValue('#e-title')) === 'AMYBO Summer Event' && sess.length === 5, JSON.stringify(sess));
		// The seed's 10:30 GMT tour stays a 10:30 tour in July, which is 09:30 UTC in summer time.
		check('times keep their UK wall-clock time across the change to summer time', sess[0]?.starts_at === '2027-07-16T09:30:00.000Z' && sess[2]?.starts_at === '2027-07-16T11:00:00.000Z', JSON.stringify(sess.map((s) => s.starts_at)));
		check('…and show as 10:30 UK time in the editor', (await page.inputValue(sx('start', '2027-07-16-london-tour-1030'))) === '2027-07-16T10:30');
		check('no hosts or online links are copied', sess.every((s) => !s.host_email && !s.online_url));
		const iv = h.sql(`SELECT version, change_note FROM instructions WHERE event_id='2027-07-16-london'`, true);
		check('the latest joining instructions are copied as version 1', iv.length === 1 && iv[0].version === 1 && /version 2/.test(iv[0].change_note), JSON.stringify(iv));
		const cp = h.sql(`SELECT o.label, o.suggested_label FROM poll_options o JOIN polls p ON p.id = o.poll_id WHERE p.event_id='2027-07-16-london' ORDER BY o.sort`, true).map((o) => o.label);
		check('the poll is copied with the organiser\'s options only, not Ann\'s suggestion', cp.includes('Hiking') && cp.includes('Board games') && !cp.includes('Karaoke night'), JSON.stringify(cp));
		check('nobody is registered for the clone, and nobody was emailed', row(`SELECT COUNT(*) AS n FROM registrations WHERE event_id='2027-07-16-london'`).n === 0 && (await mailCount()) === mails);
		check('the event picker lists both events', (await page.locator('#ev-pick option').count()) === 2);
	}

	console.log('\nA new event in New York, from a browser in London');
	await open(page);
	await openDetails('New event');
	{
		const fill = async (v) => { for (const [k, x] of Object.entries(v)) await page.fill(`#n-${k}`, x); };
		await fill({ id: 'NYC Meetup', title: 'NYC meetup', tz: 'America/New_York', start: '2027-10-30T18:00', end: '2027-10-30T23:30', deadline: '2027-10-29T12:00', max: '30', page: '/events/nyc/', loc: '1 Main St, New York' });
		// Browsers compile pattern attributes with the v flag, where an unescaped "-" in a class is a syntax error and the
		// pattern is ignored (with a console warning): the page escapes it.
		check('the browser itself flags an id with capitals and a space', await page.locator('#n-id').evaluate((i) => i.validity.patternMismatch), errors.filter((e) => /pattern/i.test(e)).join(' | '));
		// So the form never reaches the server, whose own refusal is checked in tests/e2e.mjs.
		const created = await page.evaluate(() => { const f = document.getElementById('new-form'); f.requestSubmit(); return f.checkValidity(); });
		check('…and stops the form being sent', !created);
		await fill({ id: '2027-10-30-nyc', deadline: '2027-10-31T12:00' });
		t = await toastAfter(() => page.locator('#new-form').evaluate((f) => f.requestSubmit()));
		check('a deadline after the end is refused', /Registration must close before the event ends/.test(t), t);
		await fill({ deadline: '2027-10-29T12:00', tz: 'New York' });
		t = await toastAfter(() => page.locator('#new-form').evaluate((f) => f.requestSubmit()));
		// The page converts the times in the zone typed before the server sees it, so it checks the zone itself first
		// rather than show the browser's "Invalid time zone specified: New York".
		check('a mistyped time zone gets the plain message with an example', /use a name such as Europe\/London or America\/New_York/.test(t), t);
		await fill({ tz: 'America/New_York' });
		await Promise.all([page.waitForURL(/event=2027-10-30-nyc/), page.locator('#new-form').evaluate((f) => f.requestSubmit())]);
		await open(page, '2027-10-30-nyc');
		const ev = row(`SELECT * FROM events WHERE id='2027-10-30-nyc'`);
		check('the event is created and shown, labelled New York time', !!ev && (await page.locator('.tzl').first().textContent()) === 'New York time');
		check('18:00 New York (summer time) is stored as 22:00 UTC', ev?.starts_at === '2027-10-30T22:00:00.000Z', ev?.starts_at);
		// ukLocalToIso once parsed toLocaleString() output in the browser's own zone, an hour out when the browser's clocks
		// change on a different day from the event's (London on 31 October, New York a week later).
		check('23:30 New York on 30 Oct 2027 is stored as 03:30 UTC from a London browser', ev?.ends_at === '2027-10-31T03:30:00.000Z', ev?.ends_at);
		check('…and shown back as 23:30 as typed', (await page.inputValue('#e-end')) === '2027-10-30T23:30', await page.inputValue('#e-end'));
		check('a new event has no sessions, polls or instructions yet, and the page still works', (await page.locator('#sessions-box fieldset').count()) === 0 && /No polls yet/.test(await page.locator('#polls-box').textContent()));
		await openDetails('Add a session');
		await page.fill('#a-label', 'Late drinks');
		await page.fill('#a-start', '2027-10-30T22:00');
		await page.fill('#a-end', '2027-10-30T23:00');
		await toastAfter(() => page.click('#addsess-form button[type=submit]'));
		const late = row(`SELECT starts_at FROM sessions WHERE event_id='2027-10-30-nyc'`);
		check('a 22:00 New York session on 30 Oct 2027 is stored as 02:00 UTC', late?.starts_at === '2027-10-31T02:00:00.000Z', late?.starts_at);
		// The same page from a browser on UTC gets it right, which is what makes the bug hard to notice.
		const utc = await newPage({ timezoneId: 'UTC' });
		await open(utc, '2027-10-30-nyc');
		const v = await utc.evaluate(() => ukLocalToIso('2027-10-30T23:30'));
		check('(from a browser on UTC, 23:30 New York is 03:30 UTC)', v === '2027-10-31T03:30:00.000Z', v);
		await utc.close();
	}

	console.log('\nPhone and dark mode');
	{
		const phone = await newPage({ viewport: { width: 375, height: 667 }, colorScheme: 'dark', isMobile: true, hasTouch: true });
		await open(phone);
		await phone.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
		const wide = await phone.evaluate(() => [...document.querySelectorAll('main *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && !el.closest('[style*="overflow-x"]'); }).slice(0, 5).map((el) => `${el.tagName}#${el.id}.${el.className}`));
		// With an auto grid column, the tables' width (in overflow-x boxes, which do not shrink a grid item) once widened
		// every section to ~670px, cutting each card off at the right edge.
		check('nothing on the phone-sized page is wider than the screen (tables scroll in their own box)', (await phone.evaluate(() => document.documentElement.scrollWidth)) <= 375 && !wide.length, JSON.stringify(wide));
		if (OUT) await phone.screenshot({ path: `${OUT}/admin-phone-dark.png`, fullPage: true });
		const v = await h.axe(phone);
		check('axe on the phone in dark mode: no serious or critical violations', !v.some((x) => ['serious', 'critical'].includes(x.impact)), JSON.stringify(v));
		await phone.close();
	}

	console.log('\nKeyboard');
	{
		await open(page);
		await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = false; }));
		await page.locator('#ev-pick').focus();
		await page.keyboard.press('Tab');
		const summary = await page.evaluate(() => document.activeElement.textContent);
		await page.keyboard.press('Enter');
		check('Tab from the event picker reaches "Edit this event", and Enter opens it', summary === 'Edit this event' && (await page.locator('#ev-form').isVisible()), summary);
		await page.keyboard.press('Tab');
		check('…then Tab goes into its first field', await page.evaluate(() => document.activeElement.id) === 'e-title');
	}

	console.log('\nA first-time organiser, with no events yet');
	{
		h.sql('DELETE FROM events');
		const p = await newPage();
		await open(p, '');
		check('only the Events section shows, with the New event form open', await p.locator('#new-details').evaluate((d) => d.open) && !(await p.locator('#h-sessions').isVisible()) && /No events yet/.test(await p.locator('#events').textContent()));
		if (OUT) await p.screenshot({ path: `${OUT}/admin-empty.png`, fullPage: true });
		for (const [k, x] of Object.entries({ id: '2027-03-12-london', title: 'Spring meetup', start: '2027-03-12T18:00', end: '2027-03-12T21:00', deadline: '2027-03-11T12:00', max: '25', page: '/event/' })) await p.fill(`#n-${k}`, x);
		await Promise.all([p.waitForURL(/event=2027-03-12-london/), p.click('#new-form button[type=submit]')]);
		await open(p, '2027-03-12-london');
		check('creating the first event opens it, with every section back', (await p.inputValue('#e-title')) === 'Spring meetup' && await p.locator('#h-sessions').isVisible());
		check('stored at 18:00 UK time (GMT in March)', row(`SELECT starts_at FROM events WHERE id='2027-03-12-london'`).starts_at === '2027-03-12T18:00:00.000Z');
		await p.close();
	}

	console.log('\nConsole');
	// Refusals come back as 4xx, which Chrome logs. No pattern warnings: the id pattern is valid under the v flag.
	const unexpected = errors.filter((e) => !/status of 4(00|09)/.test(e));
	check('no other errors or warnings in the browser console', !unexpected.length, unexpected.join(' | '));
	check('no third-party requests', !h.thirdParty.length, h.thirdParty.join());
} catch (e) {
	console.error(e);
	check('the test ran to the end', false, e.stack);
} finally {
	await h.stop();
}
const { passes, failures } = h.results();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

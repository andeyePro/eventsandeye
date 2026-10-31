#!/usr/bin/env node
// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../LICENSE.
/**
 * Browser test of the admin page's day-to-day half (/admin/rsvps/): the set-up check, the summary and registrations
 * table, promoting from the waiting lists, removing people, the CSV and sent-log downloads, and messages (preview,
 * counting, sending, scheduling, cancelling). Every admin action is checked against the dev outbox, because nothing may
 * email anyone without an explicit, confirmed action. Also: keyboard use, a phone-sized screen, dark mode, axe, and
 * what happens when the Access token runs out mid-session.
 *
 *   SITE_DIR=… PORT=8793 node tests/browser/admin.mjs
 *
 * Screenshots go to SHOTS (default: a temporary folder) for a person to look at; nothing here judges them.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as h from './harness.mjs';

const { BASE, EVENT, check } = h;
const SHOTS = process.env.SHOTS || join(tmpdir(), 'eventsandeye-admin-shots');
mkdirSync(SHOTS, { recursive: true });
const ADMIN_URL = `${BASE}/admin/rsvps/?event=${EVENT}`;
const TOUR = `${EVENT}-tour-1030`, TOUR2 = `${EVENT}-tour-1115`, DINNER = `${EVENT}-pub`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const register = (over) => post('/api/rsvp/register', {
	event: EVENT, name: 'Test Person', email: `${randomUUID()}@example.org`, attendance: 'in_person', tour_id: 'none',
	consent: true, website: '', 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX', ...over,
});
/** Registers and follows the confirm link, as the person would. */
async function registerAndConfirm(over) {
	const r = await register(over);
	if (!r.ok) throw new Error(`register ${over.email}: ${JSON.stringify(r)}`);
	const t = new URL(await h.linkFor(over.email, 'confirm')).searchParams.get('t');
	const c = await post('/api/rsvp/confirm', { t });
	if (!c.ok) throw new Error(`confirm ${over.email}: ${JSON.stringify(c)}`);
	return c;
}
const count = async () => (await h.outbox()).length;
const reg = (email) => h.sql(`SELECT * FROM registrations WHERE email='${email}'`, true)[0];

/** A page on the admin, with console errors and dialogs recorded; dialogs are accepted unless told otherwise. */
async function adminPage(opts = {}) {
	const ctx = await h.context({ admin: true, ...opts });
	const page = await ctx.newPage();
	page.errors = [];
	page.dialogs = [];
	page.answer = true;
	page.on('pageerror', (e) => page.errors.push(String(e)));
	page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
	page.on('dialog', async (d) => { page.dialogs.push(d.message()); if (page.answer) await d.accept(); else await d.dismiss(); });
	await page.goto(ADMIN_URL);
	// load() fills the messages table last; until then it is still running.
	await page.waitForSelector('#msgs tbody tr');
	return { ctx, page };
}
/** Waits for the toast to say something, and returns it. */
async function toast(page, re = /./) {
	await page.waitForFunction((src) => new RegExp(src).test(document.getElementById('toast').textContent), re.source, { timeout: 15000 });
	return page.textContent('#toast');
}
const shot = (page, name, full = true) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: full });
const row = (page, name) => page.locator('#regs tbody tr', { hasText: name });

// The people: names and answers an organiser might really see, including ones that test escaping.
const P = (name, over = {}) => ({ name, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@example.org`, ...over });
const people = [
	P('Aisha Khan', { tour_id: TOUR, optins: [DINNER], affiliation: 'Imperial College' }),
	P('Ben Okafor', { tour_id: TOUR, optins: [DINNER] }),
	P('Chloé Martin', { tour_id: TOUR, needs: 'Step-free access please' }), // tour full: waits
	P("Siobhán O'Neill", { optins: [DINNER] }), // dinner full: waits
	P('Dev Patel', { tour_id: TOUR2, affiliation: '=HYPERLINK("http://x.example","click")' }),
	P('Emma Jones'),
	P('<b>Bold</b> Tester', { extra_answer: '<img src=x onerror=alert(1)>' }), // last in-person place
	P('Farid Haddad'), // waiting list 1
	P('Grace Lee', { tour_id: TOUR2 }), // waiting list 2
	P('Hiro Tanaka'), // waiting list 3
	P('Ines Silva', { attendance: 'remote' }),
	P('Jakub Nowak', { attendance: 'remote', affiliation: 'Warsaw, "Poland"' }),
	P('Kemi Adeyemi', { attendance: 'remote' }),
	P('Lena Fischer', { attendance: 'extras', optins: [DINNER] }),
];
const em = (name) => P(name).email;
const unconfirmed = P('Max Unconfirmed', { attendance: 'remote' });

let failed = false;
try {
	console.log(`Starting the server on ${BASE}…`);
	await h.start();
	// Small capacities so that a handful of people fill them: 6 in-person places, 2 on the 10:30 tour, 2 at dinner.
	h.sql(`UPDATE events SET in_person_max=6 WHERE id='${EVENT}'; UPDATE sessions SET capacity=2 WHERE id IN ('${TOUR}','${DINNER}')`);
	for (const p of people) await registerAndConfirm(p);
	await register(unconfirmed);

	// ================================================================== the page as it opens
	console.log('Summary and registrations');
	let before = await count();
	const { ctx, page } = await adminPage();
	await shot(page, 'desktop');
	check('opening the page emails nobody', (await count()) === before);
	const stats = await page.textContent('#stats');
	check('summary: 6 / 6 in person', /6 \/ 6\s*in person confirmed/.test(stats), stats);
	check('summary: 4 waiting for an in-person place', /4\s*in-person waiting list/.test(stats), stats);
	check('summary: 3 remote', /3\s*remote confirmed/.test(stats), stats);
	check('summary: 1 unconfirmed', /1\s*unconfirmed/.test(stats), stats);
	check('summary: 10:30 tour full with one waiting', /2 \/ 2\s*10:30 lab tour \(waiting 1\)/.test(stats), stats);
	check('summary: dinner full with two waiting', /2 \/ 2\s*Dinner signed up \(waiting 2\)/.test(stats), stats);
	check('table lists everyone', (await page.locator('#regs tbody tr').count()) === people.length + 1);
	check('names are shown as text, not markup', (await row(page, '<b>Bold</b> Tester').count()) === 1 && (await page.locator('#regs tbody b').count()) === 0);
	check('no script ran from an answer', !page.dialogs.length, page.dialogs.join(' | '));
	check('the unconfirmed person is marked so', /unconfirmed/.test(await row(page, 'Max Unconfirmed').textContent()));
	check('Farid waits for an in-person place', /waiting since/.test(await row(page, 'Farid Haddad').textContent()));
	check('Chloé waits for the tour', /10:30 lab tour: waiting/.test(await row(page, 'Chloé Martin').textContent()));
	check("Siobhán waits for dinner", /Dinner: waiting/.test(await row(page, "Siobhán O'Neill").textContent()));
	check('Lena is shown as coming to dinner only', /Dinner only/.test(await row(page, 'Lena Fischer').textContent()));
	check('promote buttons only for people waiting', (await page.locator('[data-promote]').count()) === 7, await page.locator('[data-promote]').allTextContents());
	// Fixed 2026-10-30, kept as a regression check: promote-all-shown – the button's hidden attribute loses to button { display: inline-block }.
	check('"Promote all who fit" hidden while the room is full', await page.locator('#promote-all').isHidden());
	// Fixed 2026-10-30, kept as a regression check: dinner-only-tag – someone waiting for every opt-in they chose has no place yet, so not the green "ok" tag.
	check("Lena's dinner-only tag does not look like a confirmed place while she waits", !(await row(page, 'Lena Fischer').locator('.tag.ok').count()));
	check('no console errors on load', !page.errors.length, page.errors.join(' | '));
	check('the set-up check says the cron Worker has not run', /cron Worker has not run/.test(await page.textContent('#setup')) && await page.locator('#setup').isVisible());
	check('download links point at this event', (await page.getAttribute('#csv-link', 'href')).endsWith(`event=${EVENT}`) && (await page.getAttribute('#log-link', 'href')).endsWith(`event=${EVENT}`));

	// ================================================================== promoting
	console.log('Promoting from the waiting lists');
	const farid = reg('farid.haddad@example.org');
	before = await count();
	page.answer = false;
	await row(page, 'Farid Haddad').locator('[data-promote="event"]').click();
	await sleep(500);
	check('Promote asks first', /Promote this person\? They will be emailed/.test(page.dialogs.at(-1)), page.dialogs.at(-1));
	check('saying no to Promote emails nobody and changes nothing', (await count()) === before && reg('farid.haddad@example.org').place === 'waitlist');
	page.answer = true;
	await row(page, 'Farid Haddad').locator('[data-promote="event"]').click();
	check('Promote says it emailed them', /Promoted and emailed/.test(await toast(page, /Promoted|rror|ot /)));
	await row(page, 'Farid Haddad').locator('[data-promote]').waitFor({ state: 'detached' });
	let mails = (await h.outbox()).slice(before);
	check('promoting Farid emails Farid, once', mails.filter((m) => m.to_addr === farid.email).length === 1 && mails.filter((m) => m.to_addr !== farid.email && m.to_addr !== 'events@example.org').length === 0, mails.map((m) => `${m.to_addr}: ${m.subject}`).join(' | '));
	check('Farid now has a place', reg(farid.email).place === 'place');
	check('the summary moves on: 7 / 6 in person, 3 waiting', /7 \/ 6\s*in person confirmed/.test(await page.textContent('#stats')) && /3\s*in-person waiting list/.test(await page.textContent('#stats')), await page.textContent('#stats'));
	// Fixed 2026-10-30, kept as a regression check: promote-focus – the table is redrawn, so a keyboard or screen-reader user is thrown back to the top of the page.
	check('after promoting, focus is not lost to the top of the page', await page.waitForFunction(() => document.activeElement && document.activeElement !== document.body, null, { timeout: 3000 }).then(() => true, () => false), await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));

	before = await count();
	await row(page, 'Chloé Martin').locator('[data-promote="tour"]').click();
	await toast(page, /Promoted|rror/);
	mails = (await h.outbox()).slice(before);
	check('promoting Chloé to the tour emails only Chloé', mails.length >= 1 && mails.every((m) => m.to_addr === em('Chloé Martin') || m.to_addr === 'events@example.org'), mails.map((m) => m.to_addr).join(' | '));
	check('Chloé has a tour place', reg(em('Chloé Martin')).tour_place === 'place');
	before = await count();
	await row(page, "Siobhán O'Neill").locator('[data-promote="optin"]').click();
	// The toast from Chloé's promotion may still be up, so wait for the email itself.
	for (let i = 0; i < 50 && (await count()) === before; i++) await page.waitForTimeout(100);
	mails = (await h.outbox()).slice(before);
	check("promoting Siobhán to dinner emails only Siobhán", mails.length >= 1 && mails.every((m) => m.to_addr === em("Siobhán O'Neill") || m.to_addr === 'events@example.org'), mails.map((m) => m.to_addr).join(' | '));
	check("Siobhán is no longer waiting for dinner", !reg(em("Siobhán O'Neill")).optins_waiting);

	// A bigger room: two more places, so two of the three waiting fit.
	h.sql(`UPDATE events SET in_person_max=9 WHERE id='${EVENT}'`);
	await page.reload(); await page.waitForSelector('#regs tbody tr');
	check('"Promote all who fit" shows when there is room', await page.locator('#promote-all').isVisible());
	before = await count();
	page.answer = false;
	await page.click('#promote-all');
	await sleep(500);
	check('Promote all says how many it will promote', /Promote 2 person\(s\)/.test(page.dialogs.at(-1)), page.dialogs.at(-1));
	check('saying no to Promote all emails nobody', (await count()) === before);
	page.answer = true;
	await page.click('#promote-all');
	const pa = await toast(page, /Promoted and emailed|rror/);
	check('Promote all reports 2 promoted, 1 still waiting', /Promoted and emailed 2; 1 still waiting/.test(pa), pa);
	mails = (await h.outbox()).slice(before).filter((m) => m.to_addr !== 'events@example.org');
	check('Promote all emails the first two in waiting-list order, once each', mails.map((m) => m.to_addr).sort().join() === [em('<b>Bold</b> Tester'), 'grace.lee@example.org'].join(), mails.map((m) => m.to_addr).join(' | '));
	check('Hiro, last in the queue, still waits', reg('hiro.tanaka@example.org').place === 'waitlist');

	// ================================================================== removing
	console.log('Removing people');
	before = await count();
	page.answer = false;
	await row(page, 'Max Unconfirmed').getByRole('button', { name: 'Remove' }).click();
	await sleep(400);
	check('Remove of an unconfirmed person says no email is sent', /never confirmed, so no email is sent/.test(page.dialogs.at(-1)), page.dialogs.at(-1));
	check('saying no to Remove keeps them', !!reg('max.unconfirmed@example.org'));
	page.answer = true;
	await row(page, 'Max Unconfirmed').getByRole('button', { name: 'Remove' }).click();
	await toast(page, /Removed|rror/);
	check('the unconfirmed person is gone, and nobody was emailed', !reg('max.unconfirmed@example.org') && (await count()) === before);
	before = await count();
	await row(page, 'Kemi Adeyemi').getByRole('button', { name: 'Remove' }).click();
	await toast(page, /Removed|rror/);
	check('Remove of a confirmed person warns they will be emailed', /they will be emailed/.test(page.dialogs.at(-1)), page.dialogs.at(-1));
	mails = (await h.outbox()).slice(before);
	check('Kemi is told her registration was cancelled, and the organiser is told', mails.some((m) => m.to_addr === 'kemi.adeyemi@example.org' && /cancel/i.test(m.subject)) && mails.some((m) => m.to_addr === 'events@example.org' && /removed by an organiser/.test(m.text_body)), mails.map((m) => `${m.to_addr}: ${m.subject}`).join(' | '));
	check('nobody else is emailed by a removal', mails.every((m) => ['kemi.adeyemi@example.org', 'events@example.org'].includes(m.to_addr)));
	check('Kemi is gone from the table', await row(page, 'Kemi Adeyemi').waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false));
	// ================================================================== downloads
	console.log('Downloads');
	before = await count();
	let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csv-link')]);
	const csv = readFileSync(await dl.path(), 'utf8');
	check('the CSV downloads with the event in its name', dl.suggestedFilename() === `${EVENT}-registrations.csv`, dl.suggestedFilename());
	const lines = csv.trim().split(/\r\n/);
	check('the CSV has a header and one line per registration', lines[0].startsWith('name,email,attendance') && lines.length === 1 + 13, `${lines.length} lines`);
	check('the CSV defuses a formula in an answer', csv.includes(`"'=HYPERLINK(""http://x.example"",""click"")"`), lines.find((l) => l.includes('HYPERLINK')));
	check('the CSV quotes commas and quotes', csv.includes(`"Warsaw, ""Poland"""`));
	check('the CSV keeps accents (UTF-8)', csv.includes("Siobhán O'Neill") && csv.includes('Chloé Martin'));
	check('the CSV says who is waiting for what', /Hiro Tanaka,[^,]*,in_person,confirmed,waitlist/.test(csv) && /Lena Fischer[^\r\n]*opt-in sessions only/.test(csv));
	[dl] = await Promise.all([page.waitForEvent('download'), page.click('#log-link')]);
	const log = readFileSync(await dl.path(), 'utf8');
	check('the sent log downloads as markdown', dl.suggestedFilename() === `${EVENT}-sent-log.md` && log.startsWith('# Sent log: '), dl.suggestedFilename());
	check('the sent log names nobody', !people.some((p) => log.includes(p.email) || log.includes(p.name)));
	check('downloading emails nobody', (await count()) === before);

	// ================================================================== messages
	console.log('Messages');
	await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
	const clearToast = (p = page) => p.evaluate(() => { document.getElementById('toast').textContent = ''; });
	before = await count();
	await page.fill('#m-subject', 'Room change');
	await page.fill('#m-body', 'We have moved to **Room 7**.\n\n- bring a pen\n\n[map](javascript:alert(1)) <script>alert(2)</script> <img src=x onerror="alert(3)">');
	await page.locator('#msg-form [data-preview="m-body"]').click();
	await page.waitForSelector('#m-body-preview:not([hidden]) strong');
	const prev = await page.innerHTML('#m-body-preview');
	check('preview renders the markdown', /<strong>Room 7<\/strong>/.test(prev) && /<li>bring a pen<\/li>/.test(prev), prev);
	check('preview runs no script and keeps no javascript: link', !page.dialogs.some((d) => /^[123]$/.test(d)) && !/<script|<img|href="javascript/i.test(prev), prev);
	const counted = async (setup) => { await setup(); await page.click('#m-count'); const t = await toast(page, /recipient|rror/); await clearToast(); return t; };
	// Confirmed after the promotions and the removal: 11 (Lena , still waiting for dinner, and Hiro, waiting for a place, are left out).
	const c1 = await counted(() => page.selectOption('#m-att', 'all'));
	check('count: everyone confirmed, without the waiting list', /^11 recipient/.test(c1), c1);
	const c2 = await counted(() => page.selectOption('#m-att', 'remote'));
	check('count: remote only', /^2 recipient/.test(c2), c2);
	const c3 = await counted(async () => { await page.selectOption('#m-att', 'all'); await page.selectOption('#m-optin', DINNER); });
	check('count: dinner', /^3 recipient/.test(c3), c3);
	const c4 = await counted(async () => { await page.selectOption('#m-optin', ''); await page.check('#m-wait'); });
	check('count: everyone with the waiting lists', /^13 recipient/.test(c4), c4);
	await page.uncheck('#m-wait');
	await page.click('#m-bcc');
	const bt = await toast(page, /Copied|rror/);
	const clip = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => String(e));
	check('BCC copies the addresses and says to use BCC', /Copied 11 address/.test(bt) && clip.split(', ').length === 11 && !clip.includes('hiro'), `${bt} / ${clip.slice(0, 120)}`);
	await clearToast();
	check('preview, counting and BCC email nobody', (await count()) === before);

	// Send now to remote attendees; saying no first.
	await page.selectOption('#m-att', 'remote');
	page.answer = false;
	await page.click('#msg-form button[type=submit]');
	await sleep(600);
	check('Send asks first, with the number of recipients', /^Send now to 2 recipient/.test(page.dialogs.at(-1)), page.dialogs.at(-1));
	check('saying no to Send emails nobody and keeps the draft', (await count()) === before && (await page.inputValue('#m-subject')) === 'Room change');
	page.answer = true;
	await page.click('#msg-form button[type=submit]');
	check('Send says it was sent', /Sent|Sending/.test(await toast(page, /Sent|Sending|rror/)));
	await clearToast();
	mails = (await h.outbox()).slice(before);
	check('the message reaches the two remote attendees, once each, and nobody else', mails.map((m) => m.to_addr).sort().join() === [em('Ines Silva'), em('Jakub Nowak')].join() && mails.every((m) => m.subject === 'Room change'), mails.map((m) => m.to_addr).join(' | '));
	check('each copy greets its person and has their manage link', mails.every((m) => /Hello (Ines|Jakub)/.test(m.text_body) && /\/events\/manage\/\?t=/.test(m.text_body)), mails[0]?.text_body.slice(0, 300));
	check('the sent message carries no script', mails.every((m) => !/<script|<img|href="javascript/i.test(m.html_body || '')));
	check('the form is cleared after sending', (await page.inputValue('#m-subject')) === '');
	await page.waitForSelector('#msgs tbody tr:has-text("Room change")');
	check('the message is listed as sent to 2', /sent\s*2/.test(await page.locator('#msgs tbody tr', { hasText: 'Room change' }).textContent()), await page.textContent('#msgs tbody'));

	// Schedule two messages for tomorrow; cancel one.
	const LOCAL = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
	const local = (ms) => LOCAL.format(new Date(ms)).replace(' ', 'T');
	const tomorrow = Date.now() + 86400_000;
	for (const subject of ['Reminder to cancel', 'Reminder to keep']) {
		await page.fill('#m-subject', subject); await page.fill('#m-body', 'See you soon.'); await page.fill('#m-when', local(tomorrow));
		before = await count();
		await page.click('#msg-form button[type=submit]');
		const t = await toast(page, /Scheduled|Sent|rror/);
		check(`scheduling "${subject}" says so and emails nobody yet`, /Scheduled/.test(t) && (await count()) === before && /^Schedule for /.test(page.dialogs.at(-1)), `${t} / ${page.dialogs.at(-1)}`);
		await clearToast();
		await page.waitForSelector(`#msgs tbody tr:has-text("${subject}")`);
	}
	const msgRow = (subject) => page.locator('#msgs tbody tr', { hasText: subject });
	check('a scheduled message shows as scheduled, with Cancel', /scheduled/.test(await msgRow('Reminder to cancel').textContent()) && (await msgRow('Reminder to cancel').locator('[data-cancel]').count()) === 1);
	page.dialogs.length = 0;
	page.answer = false;
	await msgRow('Reminder to cancel').locator('[data-cancel]').click();
	await sleep(800);
	// Fixed 2026-10-30, kept as a regression check: cancel-no-confirm – one stray click (or Enter) cancels a scheduled message, with no way to undo it.
	check('Cancel asks first', page.dialogs.length === 1 && /scheduled/.test(await msgRow('Reminder to cancel').textContent()), `dialogs: ${page.dialogs.length}; row: ${await msgRow('Reminder to cancel').textContent()}`);
	page.answer = true;
	if (/scheduled/.test(await msgRow('Reminder to cancel').textContent())) {
		await msgRow('Reminder to cancel').locator('[data-cancel]').click();
		await toast(page, /cancelled|rror/);
	}
	await page.waitForFunction(() => /cancelled/.test([...document.querySelectorAll('#msgs tbody tr')].find((r) => r.textContent.includes('Reminder to cancel'))?.textContent));
	check('the cancelled message keeps its row, marked cancelled, without Cancel', !(await msgRow('Reminder to cancel').locator('[data-cancel]').count()));
	before = await count();
	await h.cron(tomorrow + 600_000);
	mails = (await h.outbox()).slice(before);
	const kept = mails.filter((m) => m.subject === 'Reminder to keep');
	check('the cancelled message is never sent', !mails.some((m) => m.subject === 'Reminder to cancel'));
	check('the kept one goes at its time, to the 11 confirmed, not the waiting list', kept.length === 11 && !kept.some((m) => m.to_addr === em('Hiro Tanaka')), kept.length);

	// A "send at" time already past: the confirmation says "Schedule for …", but the server sends it at once.
	await page.reload(); await page.waitForSelector('#regs tbody tr');
	await page.fill('#m-subject', 'Past time'); await page.fill('#m-body', 'Typo in the date.'); await page.fill('#m-when', local(Date.now() - 3 * 3600_000));
	page.dialogs.length = 0;
	page.answer = false;
	await page.click('#msg-form button[type=submit]');
	await sleep(800);
	// Fixed 2026-10-30, kept as a regression check: past-schedule – createMessage sends a scheduled_at in the past (or under a minute ahead) at once, while the page asked "Schedule for …".
	check('a send-at time in the past is refused, or asked about as sending now', !page.dialogs.length || /^Send now|past/i.test(page.dialogs.at(-1)), page.dialogs.at(-1));
	page.answer = true;
	await page.evaluate(() => document.getElementById('msg-form').reset());

	// ================================================================== choosing an event
	console.log('Choosing an event');
	h.sql(`INSERT INTO events (id, title, starts_at, ends_at, timezone, location, in_person_max, deadline, travel_minutes, page_path)
		VALUES ('2027-03-12-leeds', 'Spring meet-up, Leeds', '2027-03-12T10:00:00Z', '2027-03-12T17:00:00Z', 'Europe/London', 'Leeds', 30, '2027-03-05T12:00:00Z', 30, '/event/')`);
	await page.reload(); await page.waitForSelector('#regs tbody tr');
	check('the event picker lists both events', (await page.locator('#ev-pick option').count()) === 2);
	before = await count();
	await Promise.all([page.waitForURL(/event=2027-03-12-leeds/), page.selectOption('#ev-pick', '2027-03-12-leeds')]);
	await page.waitForSelector('#regs tbody tr');
	await page.waitForFunction(() => /Nothing sent yet/.test(document.querySelector('#msgs tbody').textContent));
	check('choosing the other event shows it, empty', /Spring meet-up/.test(await page.textContent('#ev-title')) && /No registrations yet/.test(await page.textContent('#regs tbody')));
	check('switching events emails nobody', (await count()) === before);
	await page.goto(ADMIN_URL); await page.waitForSelector('#regs tbody tr');

	// ================================================================== the set-up check clears
	await h.cron();
	await page.reload(); await page.waitForSelector('#regs tbody tr');
	check('the set-up check disappears once the cron Worker has run', await page.locator('#setup').isHidden(), await page.textContent('#setup'));

	// ================================================================== keyboard
	console.log('Keyboard');
	check('table actions and downloads can be reached with Tab', await page.evaluate(() => [...document.querySelectorAll('#regs tbody button, #csv-link, #m-count')].every((el) => el.tabIndex >= 0)));
	await page.focus('#m-subject');
	await page.keyboard.press('Tab');
	check('the focused control shows a focus ring', await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0; }));
	page.dialogs.length = 0;
	page.answer = false;
	await row(page, 'Hiro Tanaka').getByRole('button', { name: 'Remove' }).focus();
	await page.keyboard.press('Enter');
	await sleep(500);
	check('Enter on Remove asks first, and "no" keeps them', page.dialogs.length === 1 && !!reg(em('Hiro Tanaka')));
	page.answer = true;
	await row(page, 'Hiro Tanaka').getByRole('button', { name: 'Promote to place' }).focus();
	await page.keyboard.press('Enter');
	await toast(page, /Promoted|rror/);
	check('Enter on Promote works', reg(em('Hiro Tanaka')).place === 'place');
	await shot(page, 'focus', false);

	// ================================================================== axe, dark mode, phone
	console.log('Accessibility, dark mode, phone');
	// Fixed 2026-10-30, kept as a regression check: summary-target-size – the <summary> toggles (Edit, Clone, New event) are under 24 px high (WCAG 2.5.8).
	const v = await h.axe(page);
	check('axe: no violations on the admin page', !v.length, JSON.stringify(v));
	await ctx.close();

	for (const [name, opts] of [['dark', { colorScheme: 'dark' }], ['phone', { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
		const { ctx: c, page: p } = await adminPage(opts);
		await shot(p, name);
		await shot(p, `${name}-top`, false);
		await p.locator('#h-regs').scrollIntoViewIfNeeded();
		await shot(p, `${name}-regs`, false);
		const cs = await p.evaluate(() => { const b = getComputedStyle(document.documentElement); const s = getComputedStyle(document.querySelector('section')); return { fg: b.color, sbg: s.backgroundColor }; });
		check(`${name}: dark text on white panels (the page has no dark theme, so it must not half-switch)`, cs.fg === 'rgb(17, 17, 17)' && cs.sbg === 'rgb(255, 255, 255)', JSON.stringify(cs));
		check(`${name}: no console errors`, !p.errors.length, p.errors.join(' | '));
		if (name === 'dark') {
			const av = await h.axe(p);
			check('dark: axe finds no contrast problems', !av.some((x) => x.id === 'color-contrast'), JSON.stringify(av));
		}
		if (name === 'phone') {
			const wide = await p.evaluate(() => document.documentElement.scrollWidth);
			const culprits = await p.evaluate(() => [...document.querySelectorAll('main > section > *')].filter((e) => e.getBoundingClientRect().right > 380).map((e) => `${e.closest('section').getAttribute('aria-labelledby')} ${e.tagName}#${e.id} ${Math.round(e.getBoundingClientRect().width)}px`).slice(0, 8));
			// Fixed 2026-10-30, kept as a regression check: phone-overflow – main is a grid, so its sections take the table's full width instead of letting its box scroll.
			check('phone: the page does not scroll sideways', wide <= 375, `${wide}px; ${culprits.join(', ')}`);
			const small = await p.evaluate(() => [...document.querySelectorAll('#regs button, #msg-form button')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 24).length);
			check('phone: buttons are big enough to tap (24 px)', !small, `${small} small`);
			const remove = row(p, 'Ines Silva').getByRole('button', { name: 'Remove' });
			await remove.scrollIntoViewIfNeeded();
			check('phone: Remove can be reached in the sideways-scrolling table', await remove.isVisible());
		}
		await c.close();
	}

	// ================================================================== the token runs out mid-session
	console.log('Expired Access token');
	{
		const { ctx: c, page: p } = await adminPage();
		const expired = h.jwt({ exp: Math.floor(Date.now() / 1000) - 60 });
		await p.route('**/api/admin/**', (r) => r.continue({ headers: { ...r.request().headers(), 'cf-access-jwt-assertion': expired } }));
		before = await count();
		await p.fill('#m-subject', 'Draft after lunch'); await p.fill('#m-body', 'Long careful text.');
		await p.click('#msg-form button[type=submit]');
		const t = await toast(p, /./);
		check('an expired token: the page says to sign in again', /sign in again/i.test(t), t);
		check('an expired token: nothing is sent, nothing asked, and the draft is kept', (await count()) === before && (await p.inputValue('#m-body')) === 'Long careful text.' && !p.dialogs.length);
		await p.unroute('**/api/admin/**');
		// What Cloudflare Access does once its session has gone: a redirect to its sign-in page on another origin, which
		// fetch cannot follow (no CORS), so the page only sees a network error.
		await p.route('**/api/admin/**', (r) => r.fulfill({ status: 302, headers: { location: 'https://e2e.cloudflareaccess.com/cdn-cgi/access/login/127.0.0.1' } }));
		await clearToast(p);
		await p.click('#m-count');
		const t2 = await toast(p, /./);
		// Fixed 2026-10-30, kept as a regression check: access-redirect – the toast reads "Failed to fetch", which tells the organiser nothing; say the sign-in has run out and to reload.
		check('an Access sign-in redirect: the page says to sign in again', /sign in|reload/i.test(t2), t2);
		await shot(p, 'expired', false);
		await c.close();
	}
	check('nothing went to a third party', !h.thirdParty.filter((u) => !u.includes('cloudflareaccess.com')).length, h.thirdParty.join(' | '));
} catch (e) {
	failed = true;
	console.error(e);
	console.error(h.log().slice(-3000));
} finally {
	await h.stop();
}
const { passes, failures } = h.results();
console.log(`\n${passes} passed, ${failures} failed. Screenshots in ${SHOTS}.`);
process.exit(failures || failed ? 1 : 0);

#!/usr/bin/env node
// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../LICENSE.
/**
 * Browser test of the public booking form (/event/, astro/RsvpForm.astro and astro/rsvp-form.ts), as attendees use it:
 * each way to attend, the browser's own validation and the server's, the check-email page, registering twice, the
 * honeypot, a closed or full event, the hold limit, keyboard only, small screens, dark mode, large text and no
 * JavaScript. Run from the repository root (see harness.mjs):
 *
 *   SITE_DIR=<built starter site> PORT=8791 node tests/browser/registration.mjs
 *
 * Checks introduced by "Fixed …" comments guard against bugs this test found.
 */
import * as h from './harness.mjs';

const { check, BASE, EVENT, sql } = h;
const OUT = process.env.SHOTS_DIR; // set to keep screenshots for a person to look at
const shot = (page, name) => (OUT ? page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }) : null);
const TOUR = `${EVENT}-tour-1030`;
const DINNER = `${EVENT}-pub`;

const pageErrors = [];
async function open(opts = {}) {
	const ctx = await h.context(opts);
	const page = await ctx.newPage();
	page.on('pageerror', (e) => pageErrors.push(String(e)));
	return { ctx, page };
}
/** Loads the form and waits for the availability line to replace its placeholder. */
async function ready(page) {
	await page.goto(`${BASE}/event/`);
	await page.waitForFunction(() => !/Checking availability/.test(document.getElementById('rsvp-availability').textContent));
}
async function fillForm(page, { name = 'Ada Lovelace', email, attendance = 'in_person', consent = true } = {}) {
	await page.fill('#rsvp-name', name);
	await page.fill('#rsvp-email', email);
	if (attendance) await page.check(`input[name=attendance][value=${attendance}]`);
	if (consent) await page.check('#rsvp-consent');
}
const landed = (page) => page.waitForURL(/\/events\/check-email\//, { timeout: 10_000 })
	.catch(async (e) => { throw new Error(`did not reach check-email: ${await page.textContent('#rsvp-result').catch(() => '?')} (${e.message.split('\n')[0]})`); });
const submitAndLand = async (page) => { await page.click('button[type=submit]'); await landed(page); };
/** Whether an element is actually drawn: the hidden attribute only counts if the page's CSS lets it. */
const shown = (page, sel) => page.$eval(sel, (e) => e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none');
const row = (email) => sql(`SELECT * FROM registrations WHERE email='${email}'`, true)[0];
const axeClean = async (page, state) => { const v = await h.axe(page); check(`axe: no violations (${state})`, v.length === 0, JSON.stringify(v)); };
/** Without a background of its own the page is painted with the browser's Canvas, which axe cannot see and takes as white. */
const paintCanvas = (page) => page.addStyleTag({ content: 'html { background: Canvas; }' });

await h.start();
try {
	// ---------- the form as it loads ----------
	console.log('The form as it loads');
	{
		const { ctx, page } = await open();
		await ready(page);
		const deadline = sql(`SELECT deadline FROM events WHERE id='${EVENT}'`, true)[0].deadline;
		const want = new Date(deadline).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/London' });
		// The harness moved the event about 20 days ahead, so a date baked into the page at build time would differ.
		check('availability line shows the live deadline from the database', (await page.textContent('#rsvp-availability')) === `Registration closes ${want} (UK time).`, await page.textContent('#rsvp-availability'));
		check('the event\'s own wording replaces the default labels', (await page.textContent('#rsvp-in-person-label')) === 'In person at White City' && (await page.textContent('#rsvp-tour-legend')) === 'Optional lab tour (in person only)');
		check('"just the dinner" choice is offered', (await shown(page, '#rsvp-extras-choice')) && (await page.textContent('#rsvp-extras-label')) === 'Just the dinner');
		check('extra question shown with (optional)', /^Staying on for Saturday.*\(optional\)$/.test(await page.textContent('#rsvp-extra-label')));
		check('tours and dinner listed', (await page.$$('input[name=tour_id]')).length === 3 && (await page.$$('input[name=optins]')).length === 1);
		check('register button enabled once the script runs', !(await page.$eval('button[type=submit]', (b) => b.disabled)));
		check('honeypot is off-screen and out of the tab order', (await page.$eval('#rsvp-website', (e) => e.tabIndex === -1 && e.getBoundingClientRect().right < 0)));
		check('tour and dinner are disabled until a way to attend is chosen', await page.evaluate(() => document.getElementById('rsvp-tour-fieldset').disabled && document.getElementById('rsvp-optins-fieldset').disabled));
		await shot(page, 'initial');
		await axeClean(page, 'empty form');

		const state = () => page.evaluate(() => ({
			tourOff: document.getElementById('rsvp-tour-fieldset').disabled, dinnerOff: document.getElementById('rsvp-optins-fieldset').disabled,
			legend: document.getElementById('rsvp-optins-legend').textContent, dinner: document.querySelector('input[name=optins]').checked,
			tour: document.querySelector('input[name=tour_id]:checked').value,
		}));
		await page.check('input[name=attendance][value=in_person]');
		await page.check(`input[name=tour_id][value="${TOUR}"]`);
		let s = await state();
		check('in person: tour and dinner can be chosen', !s.tourOff && !s.dinnerOff && s.tour === TOUR && s.legend === 'Also joining us for (in person only)');
		await page.check('input[name=optins]');
		await page.check('input[name=attendance][value=remote]');
		s = await state();
		check('remote: tour and dinner disabled and cleared', s.tourOff && s.dinnerOff && s.tour === 'none' && !s.dinner, JSON.stringify(s));
		await page.check('input[name=attendance][value=extras]');
		s = await state();
		check('just the dinner: dinner ticked for you, tour off, legend reworded', s.tourOff && !s.dinnerOff && s.dinner && s.tour === 'none' && s.legend === 'Joining us for', JSON.stringify(s));
		await ctx.close();
	}

	// ---------- validation ----------
	console.log('Validation');
	{
		const { ctx, page } = await open();
		await ready(page);
		let posts = 0;
		page.on('request', (r) => r.url().includes('/api/rsvp/register') && posts++);
		const focus = () => page.evaluate(() => ({ id: document.activeElement.id || document.activeElement.name || document.activeElement.tagName, msg: document.activeElement.validationMessage || '' }));
		await page.click('button[type=submit]');
		let f = await focus();
		check('empty form: focus on name with a message, nothing sent', f.id === 'rsvp-name' && f.msg !== '' && posts === 0, JSON.stringify(f));
		await page.fill('#rsvp-name', 'Ada');
		await page.fill('#rsvp-email', 'not-an-email');
		await page.click('button[type=submit]');
		f = await focus();
		check('bad email: focus on email with a message', f.id === 'rsvp-email' && /@/.test(f.msg) && posts === 0, JSON.stringify(f));
		await page.fill('#rsvp-email', 'ada@example.org');
		await page.click('button[type=submit]');
		f = await focus();
		check('no way to attend chosen: focus on the choice', f.id === 'attendance' && f.msg !== '' && posts === 0, JSON.stringify(f));
		await page.check('input[name=attendance][value=remote]');
		await page.click('button[type=submit]');
		f = await focus();
		check('consent not ticked: focus on the consent box', f.id === 'rsvp-consent' && f.msg !== '' && posts === 0, JSON.stringify(f));

		// The browser accepts "ada@example"; the server wants a dot in the domain.
		await page.check('#rsvp-consent');
		await page.fill('#rsvp-email', 'ada@example');
		await page.click('button[type=submit]');
		await page.waitForFunction(() => document.getElementById('rsvp-result').textContent !== '');
		check('server refuses an address without a domain ending', (await page.textContent('#rsvp-result')) === 'Please enter a valid email address.' && posts === 1);
		check('button usable again after an error', !(await page.$eval('button[type=submit]', (b) => b.disabled)));
		// Fixed 2026-10-30, kept as a regression check: error-focus. The button is disabled while sending, which drops focus to <body>; after an error a
		// keyboard or screen-reader user is left at the top of the page with the message below the button.
		f = await focus();
		check('after a server error, focus is on the field at fault, marked invalid and described by the message', f.id === 'rsvp-email'
			&& (await page.$eval('#rsvp-email', (e) => e.getAttribute('aria-invalid') === 'true' && e.getAttribute('aria-describedby') === 'rsvp-result')), JSON.stringify(f));
		await shot(page, 'server-error');
		await axeClean(page, 'server error shown');

		await page.fill('#rsvp-email', 'ada@example.org');
		await page.fill('#rsvp-name', '   ');
		await page.click('button[type=submit]');
		// The form trims the name first, so the browser itself asks for one and nothing is sent.
		await page.waitForFunction(() => document.activeElement?.id === 'rsvp-name');
		check('a name of spaces is caught in the browser, before anything is sent', posts === 1);
		check('nothing stored for refused registrations', sql(`SELECT COUNT(*) AS n FROM registrations`, true)[0].n === 0);

		// maxlength stops typing at the limit; the server cuts anything longer too.
		await page.fill('#rsvp-name', '');
		await page.type('#rsvp-name', 'x'.repeat(125));
		check('name stops at 120 characters when typed', (await page.inputValue('#rsvp-name')).length === 120);
		await page.$eval('#rsvp-name', (e) => { e.removeAttribute('maxlength'); e.value = 'L'.repeat(500); });
		await page.$eval('#rsvp-needs', (e) => { e.removeAttribute('maxlength'); e.value = 'n'.repeat(3000); });
		await submitAndLand(page);
		const r = row('ada@example.org');
		check('overlong input (past maxlength) is cut, not refused', r?.name.length === 120 && r?.needs.length === 1000, `${r?.name.length}/${r?.needs?.length}`);
		await ctx.close();
	}

	// ---------- registering ----------
	console.log('Registering');
	sql('DELETE FROM registrations; DELETE FROM deliveries');
	{
		const { ctx, page } = await open();
		await ready(page);
		let posts = 0;
		page.on('request', (r) => r.url().includes('/api/rsvp/register') && posts++);
		await fillForm(page, { email: 'grace@example.org' });
		await page.check(`input[name=tour_id][value="${TOUR}"]`);
		await page.check('input[name=optins]');
		await page.fill('#rsvp-affiliation', 'Navy');
		await page.fill('#rsvp-needs', 'Vegetarian');
		await page.check('#rsvp-share');
		// A double click must send once: the server pads its answer, so there is time for a second click.
		await page.dblclick('button[type=submit]');
		await page.waitForURL(/\/events\/check-email\//);
		check('double click sends one registration', posts === 1, `${posts} requests`);
		check('check-email page names the address', (await page.textContent('#sent-to')) === "We've sent an email to grace@example.org.");
		await shot(page, 'check-email');
		await axeClean(page, 'check-email page');
		const r = row('grace@example.org');
		check('stored as asked', r && r.status === 'pending' && r.attendance === 'in_person' && r.place === 'place' && r.tour_id === TOUR && r.tour_place === 'place'
			&& r.optins === DINNER && r.affiliation === 'Navy' && r.needs === 'Vegetarian' && r.share_contact === 1, JSON.stringify(r));
		const mails = await h.mailsTo('grace@example.org');
		check('one confirm email', mails.length === 1 && /^Complete your registration/.test(mails[0].subject) && (await h.linkFor('grace@example.org', 'confirm')) !== null);

		// Enter pressed repeatedly in a field submits once.
		await ready(page);
		await fillForm(page, { email: 'remy@example.org', attendance: 'remote' });
		posts = 0;
		await page.focus('#rsvp-email');
		for (let i = 0; i < 3; i++) await page.keyboard.press('Enter');
		await page.waitForURL(/\/events\/check-email\//);
		check('Enter three times sends one registration', posts === 1, `${posts} requests`);
		const rr = row('remy@example.org');
		check('remote registration has no place, tour or dinner', rr?.attendance === 'remote' && rr.place === null && rr.tour_id === null && rr.optins === null, JSON.stringify(rr));

		await ready(page);
		await fillForm(page, { email: 'dot@example.org', attendance: 'extras' });
		await submitAndLand(page);
		const rd = row('dot@example.org');
		check('just the dinner: in person, no place, dinner only', rd?.attendance === 'in_person' && rd.place === null && rd.optins === DINNER, JSON.stringify(rd));

		// The same address again, in other letters' case: the answer looks the same, the newer details replace the older.
		await ready(page);
		await fillForm(page, { name: 'Grace Hopper', email: 'Grace@Example.org', attendance: 'remote' });
		await submitAndLand(page);
		const again = sql(`SELECT * FROM registrations WHERE email='grace@example.org'`, true);
		check('registering again replaces the unconfirmed registration', again.length === 1 && again[0].name === 'Grace Hopper' && again[0].attendance === 'remote' && again[0].resends === 1, JSON.stringify(again));
		check('a fresh confirm email goes out', (await h.mailsTo('grace@example.org')).filter((m) => /^Complete your registration/.test(m.subject)).length === 2);

		// Once confirmed, registering again sends a reminder rather than a new confirm email.
		sql(`UPDATE registrations SET status='confirmed' WHERE email='grace@example.org'`);
		await ready(page);
		await fillForm(page, { email: 'grace@example.org', attendance: 'in_person' });
		await submitAndLand(page);
		check('confirmed address: same page, reminder email, registration unchanged', row('grace@example.org').attendance === 'remote'
			&& sql(`SELECT COUNT(*) AS n FROM deliveries WHERE kind='already_registered'`, true)[0].n === 1);

		// Honeypot: a bot is told it worked; nothing is stored or sent.
		await ready(page);
		await fillForm(page, { email: 'bot@example.org', attendance: 'remote' });
		await page.$eval('#rsvp-website', (e) => (e.value = 'http://spam.example'));
		await submitAndLand(page);
		check('honeypot: looks like success, nothing stored or emailed', !row('bot@example.org') && (await h.mailsTo('bot@example.org')).length === 0);
		await ctx.close();
	}

	// ---------- keyboard only ----------
	console.log('Keyboard only');
	sql('DELETE FROM registrations');
	{
		const { ctx, page } = await open();
		await ready(page);
		const at = () => page.evaluate(() => { const e = document.activeElement; return e.id || (e.name ? `${e.name}=${e.value}` : e.tagName); });
		await page.keyboard.press('Tab');
		check('first Tab lands on the name', (await at()) === 'rsvp-name');
		await page.keyboard.type('Kim Keys');
		await page.keyboard.press('Tab');
		await page.keyboard.type('kim@example.org');
		await page.keyboard.press('Tab');
		await page.keyboard.press('Space');
		check('Space chooses the first way to attend', (await page.evaluate(() => document.querySelector('input[name=attendance]:checked')?.value)) === 'in_person');
		const order = [];
		for (let i = 0; i < 10; i++) { await page.keyboard.press('Tab'); order.push(await at()); }
		const want = ['tour_id=none', `optins=${DINNER}`, 'rsvp-affiliation', 'rsvp-needs', 'rsvp-extra', 'rsvp-consent', 'A', 'rsvp-share', 'rsvp-no-images', 'BUTTON'];
		check('Tab order follows the page', JSON.stringify(order) === JSON.stringify(want), order.join(' > '));
		const ring = await page.$eval('#rsvp-consent', (e) => { e.focus(); const c = getComputedStyle(e); return c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0; });
		check('focused checkbox has a visible focus ring', ring);
		await page.keyboard.press('Space');
		await page.focus('button[type=submit]');
		await page.keyboard.press('Enter');
		await landed(page);
		check('registered with the keyboard alone', row('kim@example.org')?.place === 'place');
		await ctx.close();
	}

	// ---------- full sessions, waiting list, hold limit ----------
	console.log('Full, waiting list and hold limit');
	sql(`DELETE FROM registrations; UPDATE sessions SET capacity=0 WHERE id='${TOUR}' OR optin=1`);
	{
		const { ctx, page } = await open();
		await ready(page);
		check('full tour says so', /10:30 lab tour \(full: waiting list\)/.test(await page.innerText('#rsvp-tour-fieldset')));
		check('full dinner says so', /\(full: waiting list\)$/.test((await page.innerText('#rsvp-optins')).trim()));
		await fillForm(page, { email: 'dina@example.org', attendance: 'extras' });
		await submitAndLand(page);
		check('just the dinner when full: waiting list for dinner', row('dina@example.org')?.optins_waiting === DINNER
			&& /joining the waiting list for dinner/.test((await h.mailsTo('dina@example.org'))[0].text_body));
		await ctx.close();
	}
	sql(`DELETE FROM registrations; UPDATE sessions SET capacity=10 WHERE id='${TOUR}' OR optin=1; UPDATE events SET in_person_max=1 WHERE id='${EVENT}';
		INSERT INTO registrations (id, event_id, name, email, attendance, status, place, consent_at, created_at, updated_at, share_contact)
		VALUES ('full1', '${EVENT}', 'Fay', 'fay@example.org', 'in_person', 'confirmed', 'place', '2026-01-01', '2026-01-01', '2026-01-01', 0)`);
	{
		const { ctx, page } = await open();
		await ready(page);
		// On purpose: a full room is not announced, so people still join the waiting list.
		check('a full room is not announced on the form', /^Registration closes /.test(await page.textContent('#rsvp-availability')));
		await fillForm(page, { email: 'wait@example.org' });
		await submitAndLand(page);
		const m = (await h.mailsTo('wait@example.org'))[0];
		check('full room: waiting list, and the email says so', row('wait@example.org')?.place === 'waitlist' && /joining the waiting list for an in-person place/.test(m?.text_body));
		await ctx.close();
	}
	// Five unconfirmed in-person registrations (the hold limit for 20 places) hold places; the sixth holds nothing yet.
	sql(`DELETE FROM registrations; UPDATE events SET in_person_max=20 WHERE id='${EVENT}'`);
	for (let i = 0; i < 5; i++) {
		await fetch(`${BASE}/api/rsvp/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ event: EVENT, name: `P${i}`, email: `p${i}@example.org`, attendance: 'in_person', consent: true, 'cf-turnstile-response': 'x' }) });
	}
	{
		const { ctx, page } = await open();
		await ready(page);
		await fillForm(page, { email: 'held@example.org' });
		await submitAndLand(page);
		check('beyond the hold limit: nothing held, email explains a place comes on confirming', row('held@example.org')?.place === 'waitlist'
			&& /one can be held only once you confirm/.test((await h.mailsTo('held@example.org'))[0]?.text_body));
		await ctx.close();
	}

	// ---------- screens, colours and text size ----------
	console.log('Small screens, dark mode, large text');
	for (const width of [375, 320]) {
		const { ctx, page } = await open({ viewport: { width, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
		await ready(page);
		await page.check('input[name=attendance][value=in_person]');
		const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
		check(`${width}px wide: no sideways scrolling`, sw <= cw, `${sw} > ${cw}`);
		const small = await page.$$eval('input[type=radio], input[type=checkbox]', (els) => els.filter((e) => { const l = e.closest('label').getBoundingClientRect(); return l.height < 24; }).length);
		check(`${width}px wide: choices have targets at least 24px high`, small === 0, `${small} too small`);
		await shot(page, `phone-${width}`);
		await axeClean(page, `${width}px`);
		await ctx.close();
	}
	{
		const { ctx, page } = await open({ colorScheme: 'dark' });
		await ready(page);
		await fillForm(page, { email: 'ada@example' });
		await page.click('button[type=submit]');
		await page.waitForFunction(() => document.getElementById('rsvp-result').textContent !== '');
		await paintCanvas(page);
		await shot(page, 'dark');
		await axeClean(page, 'dark mode with an error');
		await ctx.close();
	}
	{
		// 200% text in a 640px window is what a 1280px screen at 200% zoom looks like.
		const { ctx, page } = await open({ viewport: { width: 640, height: 800 } });
		await ready(page);
		await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
		const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
		check('200% text: no sideways scrolling', sw <= cw, `${sw} > ${cw}`);
		await shot(page, 'large-text');
		await ctx.close();
	}

	// ---------- without JavaScript, or without the status ----------
	console.log('No JavaScript, no status');
	{
		const { ctx, page } = await open({ javaScriptEnabled: false });
		await page.goto(`${BASE}/event/`);
		check('no JavaScript: register button stays disabled', await page.$eval('button[type=submit]', (b) => b.disabled));
		check('no JavaScript: the page says registering needs it', /Registering needs JavaScript/.test(await page.innerText('#rsvp-form')));
		// Fixed 2026-10-30, kept as a regression check: nojs-status. The line says "Checking availability…" for ever, above a form that cannot be sent.
		check('no JavaScript: no "Checking availability…" that never ends', !/Checking availability/.test(await page.innerText('#rsvp-form')));
		// Fixed 2026-10-30, kept as a regression check: hidden-shown. CSS display on .field and .choice overrides the hidden attribute (RsvpForm.astro styles).
		check('no JavaScript: hidden parts stay hidden', !(await shown(page, '#rsvp-extras-choice')) && !(await shown(page, '#rsvp-tour-fieldset')) && !(await shown(page, '#rsvp-extra-field')));
		await shot(page, 'no-js');
		await ctx.close();
	}
	{
		const { ctx, page } = await open();
		await ctx.route('**/api/rsvp/status*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"error":"x"}' }));
		await page.goto(`${BASE}/event/`);
		await page.waitForFunction(() => !/Checking availability/.test(document.getElementById('rsvp-availability').textContent));
		check('status unavailable: says so and offers contact', /^Could not check availability\. You can still try to register/.test(await page.textContent('#rsvp-availability')));
		await fillForm(page, { email: 'nostatus@example.org', attendance: 'remote' });
		await submitAndLand(page);
		check('status unavailable: can still register', !!row('nostatus@example.org'));
		await ctx.close();
	}

	// ---------- an event without tours, dinner or extra question ----------
	console.log('An event without tours or dinner');
	sql(`DELETE FROM registrations; UPDATE events SET extra_question=NULL WHERE id='${EVENT}'; UPDATE sessions SET choice_group=NULL, optin=0 WHERE event_id='${EVENT}'`);
	{
		const { ctx, page } = await open();
		await ready(page);
		await shot(page, 'no-tours');
		// Fixed 2026-10-30, kept as a regression check: hidden-shown. A "No tour, thanks" fieldset, an empty "Also joining us for" legend, "Anything else" and a
		// "Just the optional sessions" choice that can only fail all show.
		check('no tours: tour choice not shown', !(await shown(page, '#rsvp-tour-fieldset')));
		check('no opt-in sessions: the "also joining us for" box is not shown', !(await shown(page, '#rsvp-optins-fieldset')));
		check('no opt-in sessions: "just the optional sessions" is not offered', !(await shown(page, '#rsvp-extras-choice')));
		check('no extra question: its field is not shown', !(await shown(page, '#rsvp-extra-field')));
		await axeClean(page, 'no tours');
		await ctx.close();
	}
	sql(`UPDATE events SET extra_question='Anything else?' WHERE id='${EVENT}'; UPDATE sessions SET choice_group='tour' WHERE kind='tour'; UPDATE sessions SET optin=1 WHERE id='${DINNER}'`);

	// ---------- a tour closes while the form is open ----------
	console.log('A tour closes');
	{
		const { ctx, page } = await open();
		await ready(page);
		await fillForm(page, { email: 'tourlate@example.org' });
		await page.check(`input[name=tour_id][value="${TOUR}"]`);
		const was = sql(`SELECT booking_deadline FROM sessions WHERE id='${TOUR}'`, true)[0].booking_deadline;
		sql(`UPDATE sessions SET booking_deadline='2020-01-01T00:00:00Z' WHERE id='${TOUR}'`);
		await page.click('button[type=submit]');
		await page.waitForFunction(() => document.getElementById('rsvp-result').textContent !== '');
		// The server's words for a closed tour also say "closed"; only the event's own deadline closes the whole form.
		check('a tour closing mid-form is refused, but the form stays open to choose again', /^Booking for the .* has closed\.$/.test(await page.textContent('#rsvp-result'))
			&& !/has closed/.test(await page.textContent('#rsvp-availability')) && !(await page.$eval('#rsvp-name', (e) => e.disabled)) && !(await page.$eval('button[type=submit]', (b) => b.disabled)), await page.textContent('#rsvp-availability'));
		sql(`UPDATE sessions SET booking_deadline=${was ? `'${was}'` : 'NULL'} WHERE id='${TOUR}'`);
		await ctx.close();
	}

	// ---------- registration closed ----------
	console.log('Registration closed');
	{
		const { ctx, page } = await open();
		await ready(page);
		await fillForm(page, { email: 'late@example.org', attendance: 'remote' });
		// Closes while the form is open.
		sql(`UPDATE events SET deadline='2020-01-01T00:00:00Z' WHERE id='${EVENT}'`);
		await page.click('button[type=submit]');
		await page.waitForFunction(() => document.getElementById('rsvp-result').textContent !== '');
		check('closed while filling in: the server says so', (await page.textContent('#rsvp-result')) === 'Registration for this event has closed.' && !row('late@example.org'));
		await ready(page);
		check('closed: the page says so', (await page.textContent('#rsvp-availability')) === 'Registration for this event has closed.');
		check('closed: every field and the button disabled', await page.$$eval('#rsvp-form input, #rsvp-form textarea, #rsvp-form button', (els) => els.every((e) => e.disabled)));
		// Fixed 2026-10-30, kept as a regression check: hidden-shown. The tour box (only "No tour, thanks"), an empty opt-ins legend, "Anything else" and "Just
		// the optional sessions" are drawn, because the script stops before filling them in.
		check('closed: half-built choices not shown', !(await shown(page, '#rsvp-extras-choice')) && !(await shown(page, '#rsvp-optins-fieldset')));
		await shot(page, 'closed');
		await axeClean(page, 'closed');
		await ctx.close();
	}

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

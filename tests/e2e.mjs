#!/usr/bin/env node
// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
/**
 * End-to-end test of Events&I against a local D1 database with `wrangler pages dev ./dist`.
 * Emails go to the dev outbox (DEV_MODE), Turnstile uses Cloudflare's always-pass test secret, and the admin
 * tests mint their own Access JWTs with a throwaway RSA key. Replies to poll suggestions go through /api/dev/inbound, as
 * Cloudflare Email Routing would hand them to the cron Worker.
 *
 * Configure with environment variables (defaults suit the amybo.org site):
 *   E2E_DB      D1 database name in wrangler.toml          (amybo-rsvp-eu)
 *   E2E_SEED    SQL file that creates the event under test  (seed/2026-11-13-london.sql)
 *   E2E_EVENT   event id                                    (2026-11-13-london)
 *   E2E_NOTIFY  NOTIFY_EMAIL written to .dev.vars           (hello@amybo.org)
 *   E2E_PAGES   comma-separated site pages that must load   (/,/privacy/,/events/confirm/,/events/manage/)
 * The checks expect AMYBO's event; the generated .dev.vars sets AMYBO as the organiser and E2E_NOTIFY as NOTIFY_EMAIL.
 * From another site, set E2E_SEED=eventsandeye/examples/seed.example.sql (a copy of that event) and E2E_DB to your own.
 * The seed must define a 'tour' choice group with at least two sessions, and hybrid core sessions. Its dates are moved
 * so the event starts about 20 days from now, so the test does not depend on when it runs.
 */
import { spawn, execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign, randomUUID, randomBytes, createHmac } from 'node:crypto';
import { existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';

const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}`;
const PERSIST = '.wrangler/e2e-state';
const DB = process.env.E2E_DB || 'amybo-rsvp-eu';
const SEED = process.env.E2E_SEED || 'seed/2026-11-13-london.sql';
const EVENT = process.env.E2E_EVENT || '2026-11-13-london';
const NOTIFY = process.env.E2E_NOTIFY || 'hello@amybo.org';
const PAGES = (process.env.E2E_PAGES || '/,/privacy/,/events/confirm/,/events/manage/').split(',').filter(Boolean);

if (!existsSync('dist/index.html')) {
	console.error('Build first with PUBLIC_TURNSTILE_ALLOW_TEST_KEY=true (npm run build:test on amybo.org).');
	process.exit(1);
}

// ---- keys and .dev.vars ----
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'e2e', alg: 'RS256' };
const devVarsBackup = existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8') : null;
const TOKEN_SECRET = randomBytes(32).toString('hex');
writeFileSync('.dev.vars', [
	'DEV_MODE=true',
	`SITE_URL=${BASE}`,
	`TOKEN_SECRET=${TOKEN_SECRET}`,
	'TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA',
	'ACCESS_AUD=e2e-aud',
	'ACCESS_TEAM_DOMAIN=e2e.cloudflareaccess.com',
	'ADMIN_EMAILS=admin@example.org',
	'ORG_NAME=AMYBO',
	'EMAIL_FROM=AMYBO <hello@amybo.org>',
	`NOTIFY_EMAIL=${NOTIFY}`,
	// Check the token's own methods here (the live site relies on the Access application's MFA instead).
	'ACCESS_MFA=claim',
	'POLL_REPLY_EMAIL=polls@example.org',
	// Registrations are answered no sooner than this (1.5 s on a live site), so timing cannot tell who is registered.
	'REGISTER_MIN_MS=200',
	`ACCESS_JWKS_JSON=${JSON.stringify({ keys: [jwk] })}`,
	'',
].join('\n'));
const restoreDevVars = () => { if (devVarsBackup !== null) writeFileSync('.dev.vars', devVarsBackup); else rmSync('.dev.vars', { force: true }); };
let server;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
	restoreDevVars();
	try { process.kill(-server.pid, 'SIGKILL'); } catch {}
	process.exit(130);
});

/** A link token as the server makes it, with a chosen expiry (unix seconds), to test that expired links are refused. */
const tokenWithExpiry = (purpose, id, expS) => { const exp = expS.toString(36); return `${id}.${exp}.${createHmac('sha256', TOKEN_SECRET).update(`${purpose}:${id}:${exp}`).digest('base64url')}`; };
const b64u = (b) => Buffer.from(b).toString('base64url');
function jwt({ key = privateKey, kid = 'e2e', aud = 'e2e-aud', exp = Math.floor(Date.now() / 1000) + 600, email = 'admin@example.org', amr = ['pwd', 'mfa'], type = 'app', iat = Math.floor(Date.now() / 1000) } = {}) {
	const h = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
	const p = b64u(JSON.stringify({ aud: [aud], email, exp, iat, iss: 'https://e2e.cloudflareaccess.com', type, ...(amr ? { amr } : {}) }));
	return `${h}.${p}.${b64u(sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key))}`;
}
const ADMIN = { 'cf-access-jwt-assertion': jwt(), origin: BASE };

const wr = (args, stdout = 'ignore') => execFileSync('npx', ['wrangler', ...args], { stdio: ['ignore', stdout, 'inherit'], env: { ...process.env, CI: '1' }, encoding: 'utf8' });
const sql = (command, json = false) => wr(['d1', 'execute', DB, '--local', '--persist-to', PERSIST, '--command', command, ...(json ? ['--json'] : [])], json ? 'pipe' : 'ignore');
let serverLog = '';
/** An instant as Europe/London local time, YYYYMMDDTHHMMSS, as the invitations' TZID-qualified DTSTART and DTEND show it. */
const LONDON = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const local = (iso) => { const p = Object.fromEntries(LONDON.formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`; };

let failures = 0, passes = 0;
function check(name, cond, detail = '') {
	if (cond) { passes++; console.log(`  ✓ ${name}`); }
	else { failures++; console.log(`  ✗ ${name}${detail ? ` – ${String(detail).slice(0, 600)}` : ''}`); }
}
async function req(method, path, body, headers = {}) {
	const res = await fetch(BASE + path, {
		method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
		body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual',
	});
	const text = await res.text();
	let data; try { data = JSON.parse(text); } catch { data = text; }
	return { status: res.status, data, headers: res.headers };
}
const outbox = async () => (await req('GET', '/api/dev/outbox')).data.emails.map((e) => ({ ...e, att: JSON.parse(e.attachments || '[]') }));
const mailsTo = async (to) => (await outbox()).filter((e) => e.to_addr === to);
const last = async (to) => (await mailsTo(to)).at(-1);
/** The manage link from the newest email to this address that has one (only confirmed registrants get it). */
async function manageOf(addr) {
	const ms = await mailsTo(addr);
	for (let i = ms.length - 1; i >= 0; i--) { const t = tokenFrom(ms[i].text_body, 'manage'); if (t) return t; }
	return null;
}
const tokenFrom = (text, kind) => {
	const m = new RegExp(`/events/${kind}/\\?t=([^\\s"&<]+)`).exec(text);
	return m ? decodeURIComponent(m[1]) : null;
};
const register = (over = {}) => req('POST', '/api/rsvp/register', {
	event: EVENT, name: 'Test Person', email: `${randomUUID()}@example.org`, attendance: 'in_person', tour_id: 'none',
	consent: true, website: '', 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX', ...over,
});
const cron = (atMs) => req('POST', `/api/dev/cron${atMs ? `?at=${new Date(atMs).toISOString()}` : ''}`);
const unfold = (ics) => ics.replace(/\r\n /g, '');
const icsProp = (ics, name) => (unfold(ics).match(new RegExp(`^${name}[;:][^\\r\\n]*`, 'gm')) || []);
async function registerAndConfirm(over) {
	await register(over);
	const m = (await mailsTo(over.email))[0];
	const t = tokenFrom(m.text_body, 'confirm');
	const r = await req('POST', '/api/rsvp/confirm', { t });
	return { confirm: t, manage: await manageOf(over.email), result: r.data };
}

async function waitReady() {
	try { await fetch(`${BASE}/`); throw new Error(`Port ${PORT} is already in use: stop the other server first.`); } catch (e) { if (String(e.message).startsWith('Port')) throw e; }
	for (let i = 0; i < 120; i++) {
		try { const r = await fetch(`${BASE}/api/rsvp/status?event=${EVENT}`); if (r.status < 500) return; } catch {}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`wrangler pages dev did not start:\n${serverLog.slice(-3000)}`);
}

try {
	// ---- fresh local database, the event moved to about 20 days from now ----
	rmSync(PERSIST, { recursive: true, force: true });
	wr(['d1', 'migrations', 'apply', DB, '--local', '--persist-to', PERSIST]);
	wr(['d1', 'execute', DB, '--local', '--persist-to', PERSIST, '--file', SEED]);
	{ const out = sql(`SELECT starts_at FROM events WHERE id='${EVENT}'`, true);
	  const seedStart = JSON.parse(out.slice(out.indexOf('[')))[0].results[0].starts_at;
	  const days = Math.round((Date.now() + 20 * 86400_000 - Date.parse(seedStart)) / 86400_000);
	  const sh = (col) => `strftime('%Y-%m-%dT%H:%M:%SZ', ${col}, '${days >= 0 ? '+' : ''}${days} days')`;
	  sql(`UPDATE events SET starts_at=${sh('starts_at')}, ends_at=${sh('ends_at')}, deadline=${sh('deadline')} WHERE id='${EVENT}'; `
		+ `UPDATE sessions SET starts_at=${sh('starts_at')}, ends_at=${sh('ends_at')}, booking_deadline=CASE WHEN booking_deadline IS NULL THEN NULL ELSE ${sh('booking_deadline')} END WHERE event_id='${EVENT}'`); }

	// ---- server ----
	server = spawn('npx', ['wrangler', 'pages', 'dev', './dist', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST], {
		stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' }, detached: true,
	});
	server.stdout.on('data', (d) => (serverLog += d));
	server.stderr.on('data', (d) => (serverLog += d));
	await waitReady();
	console.log('\nPublic pages');
	for (const p of PAGES) {
		const r = await fetch(BASE + p);
		check(`GET ${p} → 200`, r.status === 200, String(r.status));
	}
	{
		const r = await req('GET', '/events/next');
		const loc = r.headers.get('location') || '';
		const to = new URL(loc, BASE).pathname;
		check('/events/next redirects to the next event\'s page, which exists', r.status === 302 && to !== '/events/next/' && to.endsWith('/') && (await req('GET', to)).status === 200, `${r.status} ${loc}`);
	}

	console.log('\nAdmin protection (Cloudflare Access JWT)');
	for (const p of ['/admin/rsvps/', `/api/admin/summary?event=${EVENT}`, `/api/admin/export?format=csv&event=${EVENT}`, `/api/admin/sent-log?event=${EVENT}`]) {
		check(`${p} without JWT → 401`, (await req('GET', p)).status === 401);
		check(`${p} with JWT signed by wrong key → 401`, (await req('GET', p, undefined, { 'cf-access-jwt-assertion': jwt({ key: otherKey }) })).status === 401);
		check(`${p} with wrong audience → 401`, (await req('GET', p, undefined, { 'cf-access-jwt-assertion': jwt({ aud: 'someone-else' }) })).status === 401);
		check(`${p} with expired JWT → 401`, (await req('GET', p, undefined, { 'cf-access-jwt-assertion': jwt({ exp: Math.floor(Date.now() / 1000) - 3600 }) })).status === 401);
		check(`${p} with garbage JWT → 401`, (await req('GET', p, undefined, { 'cf-access-jwt-assertion': 'a.b.c' })).status === 401);
		check(`${p} with a malformed key id and signature → 401, not 500`, (await req('GET', p, undefined, { 'cf-access-jwt-assertion': `${b64u('{"alg":"RS256","kid":"e2e"}')}.${b64u('{}')}.%%%` })).status === 401);
		check(`${p} signed in with a one-time PIN only (no second factor) → 401`, (await req('GET', p, undefined, { 'cf-access-jwt-assertion': jwt({ amr: ['email'] }) })).status === 401);
		check(`${p} signed in as someone not on ADMIN_EMAILS → 401`, (await req('GET', p, undefined, { 'cf-access-jwt-assertion': jwt({ email: 'someone@example.org' }) })).status === 401);
		check(`${p} with a service or identity token, not an app token → 401`, (await req('GET', p, undefined, { 'cf-access-jwt-assertion': jwt({ type: 'org' }) })).status === 401);
		check(`${p} signed in more than 12 hours ago → 401`, (await req('GET', p, undefined, { 'cf-access-jwt-assertion': jwt({ iat: Math.floor(Date.now() / 1000) - 13 * 3600 }) })).status === 401);
		check(`${p} with no authentication methods reported → 401`, (await req('GET', p, undefined, { 'cf-access-jwt-assertion': jwt({ amr: null }) })).status === 401);
		check(`${p} with valid JWT → 200`, (await req('GET', p, undefined, ADMIN)).status === 200);
	}
	{ const refused = await req('GET', '/admin/rsvps/', undefined, { 'cf-access-jwt-assertion': jwt({ iat: Math.floor(Date.now() / 1000) - 13 * 3600 }) });
	  check('a refused admin page explains why, in a sentence, and links to sign in again', refused.status === 401 && /<p>Sign-in too old/.test(refused.data) && /\/cdn-cgi\/access\/logout/.test(refused.data) && /<main>/.test(refused.data), String(refused.data).slice(0, 200)); }
	{ const wrongApp = await req('GET', '/admin/rsvps/', undefined, { 'cf-access-jwt-assertion': jwt({ aud: 'someone-else' }) });
	  check('a token for another Access application names ACCESS_AUD as the thing to check', /ACCESS_AUD/.test(wrongApp.data), String(wrongApp.data).slice(0, 300));
	  const none = await req('GET', '/admin/rsvps/');
	  check('no token at all says the Access application may not cover this address', /no Access token reached the site/.test(none.data), String(none.data).slice(0, 300)); }
	const page = await req('GET', '/admin/rsvps/', undefined, ADMIN);
	check('the admin page cannot be framed by another site, and sends no referrer', /frame-ancestors 'none'/.test(page.headers.get('content-security-policy') || '') && page.headers.get('x-frame-options') === 'DENY' && page.headers.get('referrer-policy') === 'no-referrer');
	check('admin page is HTML with the sessions editor', typeof page.data === 'string' && /id="sessions-form"/.test(page.data) && /Events&amp;I/.test(page.data));
	check('the quiet save says it is attendees who are not emailed (hosts still get their lists)', /Save without emailing attendees/.test(page.data) && /hosts are still sent/.test(page.data) && !/without emailing anyone/.test(page.data));
	{
		const setup = async () => (await req('GET', '/api/admin/events', undefined, ADMIN)).data.setup;
		let f = await setup();
		check('set-up check: before the cron has run, the admin page says to deploy it', f.some((x) => x.level === 'error' && /cron Worker has not run yet/.test(x.text)), JSON.stringify(f));
		check('set-up check: no complaint about migrations when all are applied', !f.some((x) => /migrations/.test(x.text)), JSON.stringify(f));
		await cron();
		f = await setup();
		check('…and after a cron run, nothing about the cron', !f.some((x) => /cron Worker/.test(x.text)), JSON.stringify(f));
		const real = JSON.parse(sql(`SELECT value FROM status WHERE key = 'cron'`, true))[0].results[0].value;
		const v = JSON.parse(real);
		sql(`UPDATE status SET value = '${JSON.stringify({ ...v, secret: 'something-else', site: 'https://elsewhere.example', at: new Date(Date.now() - 3600_000).toISOString() })}' WHERE key = 'cron'`);
		f = await setup();
		check('a cron Worker with another TOKEN_SECRET or SITE_URL, or not run for an hour, is named on the admin page', f.some((x) => x.level === 'error' && /TOKEN_SECRET is not the same/.test(x.text)) && f.some((x) => x.level === 'error' && /SITE_URL \(https:\/\/elsewhere\.example\)/.test(x.text)) && f.some((x) => x.level === 'warning' && /last ran 60 minutes ago/.test(x.text)), JSON.stringify(f));
		check('the summary carries the same check', Array.isArray((await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN)).data.setup));
		await cron();
	}
	check('admin POST without JWT → 401', (await req('POST', '/api/admin/settings', { event: EVENT, in_person_max: 999 })).status === 401);
	check('admin POST from another origin → 403', (await req('POST', '/api/admin/settings', { event: EVENT }, { ...ADMIN, origin: 'https://evil.example' })).status === 403);
	check('admin POST with neither Origin nor Sec-Fetch-Site → 403', (await req('POST', '/api/admin/settings', { event: EVENT }, { 'cf-access-jwt-assertion': jwt() })).status === 403);
	check('admin POST marked cross-site by the browser → 403', (await req('POST', '/api/admin/settings', { event: EVENT }, { ...ADMIN, 'sec-fetch-site': 'cross-site' })).status === 403);
	check('admin POST as a form, not JSON → 415', (await fetch(`${BASE}/api/admin/settings`, { method: 'POST', headers: { ...ADMIN, 'content-type': 'application/x-www-form-urlencoded' }, body: 'event=x' })).status === 415);

	console.log('\nSeed and settings');
	let r = await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN);
	const seeded = r.data;
	const tours = seeded.tours;
	const TOUR1 = tours[0].id, TOUR2 = tours[1].id;
	const core = seeded.sessions.filter((s) => !s.choice_group && s.kind !== 'social');
	const AM = core[0], PM = core[1];
	const DINNER = seeded.sessions.find((x) => x.optin)?.id;
	const YEAR = seeded.event.starts_at.slice(0, 4);
	check('seeded in-person maximum and tour capacities', seeded.event.in_person_max === 20 && tours.every((t) => t.capacity === 10), JSON.stringify({ max: seeded.event.in_person_max, tours: tours.map((t) => t.capacity) }));
	sql(`UPDATE events SET remote_label = 'Remotely, on Meet' WHERE id = '${EVENT}'`);
	check('the form gets the event\'s own wording for attending', (await req('GET', `/api/rsvp/status?event=${EVENT}`)).data.event.remote_label === 'Remotely, on Meet');
	sql(`UPDATE events SET remote_label = NULL WHERE id = '${EVENT}'`);
	check('the form and the admin page get the event\'s time zone', (await req('GET', `/api/rsvp/status?event=${EVENT}`)).data.event.timezone === 'Europe/London' && seeded.event.timezone === 'Europe/London' && /class="tzl"/.test(page.data));
	check('summary without an event id falls back to the latest event', (await req('GET', '/api/admin/summary', undefined, ADMIN)).data.event?.id === EVENT);
	r = await req('POST', '/api/admin/settings', { event: EVENT, in_person_max: 1 }, ADMIN);
	check('in-person maximum set to 1', r.data.ok, JSON.stringify(r.data));
	r = await req('POST', '/api/admin/sessions', { event: EVENT, sessions: [
		{ id: TOUR1, capacity: 1, host_name: 'Tour Host', host_email: 'host1@example.org' },
		{ id: TOUR2, capacity: 1, host_email: 'host2@example.org' },
		{ id: DINNER, host_email: 'dinnerhost@example.org' },
	] }, ADMIN);
	check('tour capacities 1 and hosts set, nobody emailed yet', r.data.ok && r.data.calendar_updates === 0 && !(await mailsTo('host1@example.org')).length && !(await mailsTo('dinnerhost@example.org')).length, JSON.stringify(r.data));
	check('invalid online link refused', (await req('POST', '/api/admin/sessions', { event: EVENT, sessions: [{ id: AM.id, online_url: 'http://insecure.example' }] }, ADMIN)).status === 400);
	r = await req('GET', `/api/rsvp/status?event=${EVENT}`);
	check('status shows open with places and open tours', r.data.ok && r.data.event.open && r.data.in_person_available === true && r.data.tours.every((t) => t.open));

	console.log('\nValidation and spam protection');
	const before = (await outbox()).length;
	check('missing consent → 400', (await register({ consent: false })).status === 400);
	check('bad email → 400', (await register({ email: 'not-an-email' })).status === 400);
	check('missing Turnstile token → 403', (await register({ 'cf-turnstile-response': '' })).status === 403);
	const honeyStart = Date.now();
	r = await register({ website: 'http://spam.example', email: 'bot@example.org' });
	check('honeypot → fake success, in the usual time (so a bot cannot tell it was caught)', r.status === 200 && r.data.ok && Date.now() - honeyStart >= 200, Date.now() - honeyStart);
	check('honeypot and rejects send no email', (await outbox()).length === before);
	check('non-JSON body → 415', (await fetch(`${BASE}/api/rsvp/register`, { method: 'POST', body: 'name=x' })).status === 415);

	{ const big = await fetch(`${BASE}/api/rsvp/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: EVENT, name: 'x'.repeat(60_000) }) });
	  check('a request body over 50 KB is refused → 413', big.status === 413); }

	console.log('\nConfirm → place, joining instructions and calendar invitation');
	const alice = 'alice@example.org', bob = 'bob@example.org', carol = 'carol@example.org';
	check('the seed has an opt-in session (dinner)', !!DINNER);
	check('public status lists opt-in sessions', ((await req('GET', `/api/rsvp/status?event=${EVENT}`)).data.optins || []).some((o) => o.id === DINNER));
	r = await register({ name: 'Alice', email: alice, tour_id: TOUR1, affiliation: 'Lab A', needs: 'Vegan', share_contact: true, extra_answer: 'A walk on Saturday', optins: [DINNER, 'not-a-session'] });
	check('Alice registers', r.status === 200 && r.data.ok, JSON.stringify(r.data));
	let mails = await mailsTo(alice);
	check('Alice gets one confirm-your-email message', mails.length === 1 && /Complete your registration/.test(mails[0].subject));
	check('confirm email states until when the place is held', /If you don't complete your registration, your place will be released on \w+day, \d+ \w+ \d{4} at \d\d:\d\d\./.test(mails[0].text_body), mails[0].text_body.slice(0, 400));
	check('confirm email says registration is not complete, and carries the Events&I beta footer', /NOT COMPLETE YET/.test(mails[0].text_body) && /Complete registration/.test(mails[0].html_body) && /Events&amp;I<\/a> \(beta\)/.test(mails[0].html_body) && /Events&I \(beta\)/.test(mails[0].text_body));
	const aliceConfirm = tokenFrom(mails[0].text_body, 'confirm');
	check('confirm link present; no manage link before the address is confirmed', !!aliceConfirm && !tokenFrom(mails[0].text_body, 'manage'));
	check('confirm email lists the choices being confirmed, without repeating the typed name', /You are confirming:/.test(mails[0].text_body) && /10:30 lab tour/.test(mails[0].text_body) && /share your email address with the hosts/.test(mails[0].text_body) && !/Alice/.test(mails[0].text_body));
	// The link is one long word: unbroken, it widens the email past a phone screen.
	check('the confirm email\'s copy-this-link fallback wraps on a phone', /<p style="[^"]*word-break:break-all">If the button does not work/.test(mails[0].html_body));
	check('confirm email offers a link to delete a registration the recipient did not make', /not-me=1/.test(mails[0].text_body) && /click here to delete the registration/.test(mails[0].html_body));

	console.log('\nJust the dinner');
	const dina = 'dina@example.org';
	check('dinner only without ticking dinner → 400', (await register({ name: 'Dina', email: dina, attendance: 'extras', optins: [] })).status === 400);
	const heldBefore = (await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN)).data.capacity.inPerson.held;
	r = await register({ name: 'Dina', email: dina, attendance: 'extras', optins: [DINNER], tour_id: TOUR1 });
	check('dinner only registers', r.status === 200 && r.data.ok, JSON.stringify(r.data));
	let dm = await last(dina);
	check('its confirm email says dinner only, and that the registration (not a place) would be deleted', /You are joining us for dinner only\./.test(dm.text_body) && /it will be deleted on/.test(dm.text_body) && !/place will be released/.test(dm.text_body), dm.text_body.slice(0, 500));
	r = await req('POST', '/api/rsvp/confirm', { t: tokenFrom(dm.text_body, 'confirm') });
	check('confirm page result knows it is dinner only', r.data.ok && r.data.registration.mode === 'extras' && r.data.registration.place === null, JSON.stringify(r.data));
	dm = await last(dina);
	check('dinner-only instructions: the dinner section, not the day (no room, no tour)', /Joining instructions/.test(dm.subject) && /The Hawk's Nest/.test(dm.text_body) && !/Room 516|Closed shoes/.test(dm.text_body) && !/lab tour/.test(dm.text_body), dm.text_body.slice(0, 900));
	check('one calendar invitation, for the dinner, at the dinner\'s place', dm.att.length === 1 && /SUMMARY:[^\r\n]*Dinner/.test(dm.att[0].content) && /LOCATION:[^\r\n]*Hawk/.test(dm.att[0].content), dm.att.map((x) => (/SUMMARY:[^\r\n]*/.exec(x.content) || [''])[0]).join(' | '));
	let sumD = (await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN)).data;
	check('dinner only takes no room place and joins no waiting list', sumD.capacity.inPerson.held === heldBefore && sumD.registrations.find((x) => x.email === dina).place === null && sumD.registrations.find((x) => x.email === dina).tour_id === null);
	const dinaManage = await manageOf(dina);
	r = await req('GET', `/api/rsvp/manage?t=${encodeURIComponent(dinaManage)}`);
	check('manage view says dinner only', r.data.ok && r.data.registration.mode === 'extras', JSON.stringify(r.data.registration));
	r = await req('POST', '/api/rsvp/manage', { t: dinaManage, name: 'Dina', attendance: 'remote', tour_id: 'none' });
	dm = await last(dina);
	check('dinner only → remote: says the dinner sign-up is deleted; dinner invitation cancelled, talks added', r.data.ok && /You have changed to joining remotely\. Your sign-up for dinner has been deleted/.test(dm.text_body) && dm.att.some((x) => /METHOD:CANCEL/.test(x.content) && /Dinner/.test(x.content)) && dm.att.some((x) => /METHOD:REQUEST/.test(x.content) && /\(online\)/.test(x.content)), dm.text_body.slice(0, 300));
	const dinaCancel = dm.att.find((x) => /METHOD:CANCEL/.test(x.content) && /Dinner/.test(x.content))?.content ?? '';
	check('the cancelled dinner entry is at SEQUENCE:1', /SEQUENCE:1/.test(dinaCancel), dinaCancel.slice(0, 300));
	r = await req('POST', '/api/rsvp/manage', { t: dinaManage, name: 'Dina', attendance: 'extras', optins: [DINNER] });
	dm = await last(dina);
	check('remote → dinner only: says so', r.data.ok && /You have changed to joining us for dinner only\./.test(dm.text_body), dm.text_body.slice(0, 300));
	{ const again = dm.att.find((x) => /METHOD:REQUEST/.test(x.content) && /SUMMARY:[^\r\n]*Dinner/.test(x.content))?.content ?? '';
	  check('the re-added dinner entry keeps its UID and continues at SEQUENCE:2', /SEQUENCE:2/.test(again) && !!icsProp(dinaCancel, 'UID')[0] && icsProp(again, 'UID')[0] === icsProp(dinaCancel, 'UID')[0], icsProp(again, 'UID').concat(icsProp(dinaCancel, 'UID'), icsProp(again, 'SEQUENCE')).join(' ')); }
	await req('DELETE', '/api/rsvp/manage', { t: dinaManage });

	console.log('\nDinner capacity and waiting list');
	const dinnerCap = async () => (await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN)).data.capacity.optins.find((o) => o.id === DINNER);
	const capBefore = await dinnerCap();
	const maxBefore = (await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN)).data.event.in_person_max;
	await req('POST', '/api/admin/settings', { event: EVENT, in_person_max: 50 }, ADMIN);
	await req('POST', '/api/admin/sessions', { event: EVENT, quiet: true, sessions: [{ id: DINNER, capacity: capBefore.held + 1 }] }, ADMIN);
	const ed = 'ed@example.org', fay = 'fay@example.org', gus = 'gus@example.org';
	const e1 = await registerAndConfirm({ name: 'Ed', email: ed, attendance: 'extras', optins: [DINNER] });
	check('dinner with one place left: a place', e1.result.ok && !(e1.result.registration.optin_waiting_labels || []).length, JSON.stringify(e1.result));
	check('public status now shows the dinner as full', (await req('GET', `/api/rsvp/status?event=${EVENT}`)).data.optins.find((o) => o.id === DINNER).available === false);
	r = await register({ name: 'Fay', email: fay, optins: [DINNER] });
	check('the next dinner sign-up is told in the confirm email it is joining the dinner waiting list', /You are joining the waiting list for dinner\./.test((await last(fay)).text_body), (await last(fay)).text_body.slice(0, 600));
	await req('POST', '/api/rsvp/confirm', { t: tokenFrom((await last(fay)).text_body, 'confirm') });
	let fm = await last(fay);
	check('…keeps her in-person place: joining instructions, saying she is waiting for dinner', /Joining instructions/.test(fm.subject) && /You are on the waiting list for dinner\./.test(fm.text_body), fm.text_body.slice(0, 600));
	check('…with no calendar invitation for the dinner', fm.att.length >= 1 && !fm.att.some((a) => /SUMMARY:[^\r\n]*Dinner/.test(a.content)), fm.att.map((x) => (/SUMMARY:[^\r\n]*/.exec(x.content) || [''])[0]).join(' | '));
	const g = await registerAndConfirm({ name: 'Gus', email: gus, attendance: 'extras', optins: [DINNER] });
	let gm = await last(gus);
	check('dinner only, dinner full: waiting list, no joining instructions or invitation', g.result.ok && (g.result.registration.optin_waiting_labels || []).includes('Dinner') && !/Joining instructions/.test(gm.subject) && /waiting list for dinner/.test(gm.text_body) && !gm.att?.length, gm.subject + ' ' + gm.text_body.slice(0, 400));
	check('organiser told about the dinner waiting list', (await mailsTo(NOTIFY)).some((m) => /waiting-list/.test(m.subject) && /Gus/.test(m.text_body) && /Dinner waiting list/.test(m.text_body)));
	let dc = await dinnerCap();
	check('admin counts: dinner full, two waiting', dc.held === dc.capacity && dc.waiting === 2, JSON.stringify(dc));
	r = await req('GET', `/api/rsvp/manage?t=${encodeURIComponent(g.manage)}`);
	check('manage view shows Gus waiting for dinner', r.data.ok && r.data.registration.optins_waiting.includes(DINNER), JSON.stringify(r.data.registration));
	await req('DELETE', '/api/rsvp/manage', { t: e1.manage });
	dc = await dinnerCap();
	check('a freed dinner place is not handed out automatically', dc.waiting === 2 && dc.available === false, JSON.stringify(dc));
	const gusId = (await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN)).data.registrations.find((x) => x.email === gus).id;
	r = await req('POST', '/api/admin/promote', { id: gusId, what: 'optin', session: DINNER }, ADMIN);
	gm = await last(gus);
	check('promoting Gus to dinner sends the dinner instructions and invitation, opening with the good news', r.data.ok && /Joining instructions/.test(gm.subject) && /Good news: a place has become available/.test(gm.text_body) && gm.att.length === 1 && /SUMMARY:[^\r\n]*Dinner/.test(gm.att[0].content), gm.subject);
	check('promoting someone not waiting → 400', (await req('POST', '/api/admin/promote', { id: gusId, what: 'optin', session: DINNER }, ADMIN)).status === 400);
	const fayManage = await manageOf(fay);
	r = await req('POST', '/api/rsvp/manage', { t: fayManage, name: 'Fay', attendance: 'in_person', optins: [] });
	check('unticking dinner leaves its waiting list', r.data.ok && !r.data.registration.optins_waiting.length && (await dinnerCap()).waiting === 0, JSON.stringify(r.data.registration));
	for (const t of [fayManage, g.manage]) await req('DELETE', '/api/rsvp/manage', { t });
	await req('POST', '/api/admin/sessions', { event: EVENT, quiet: true, sessions: [{ id: DINNER, capacity: capBefore.capacity }] }, ADMIN);
	await req('POST', '/api/admin/settings', { event: EVENT, in_person_max: maxBefore }, ADMIN);

	console.log('\nSomeone registered my address: delete it');
	const mallory = 'not-me@example.org';
	await register({ name: 'Someone else', email: mallory });
	const malloryConfirm = tokenFrom((await mailsTo(mallory))[0].text_body, 'confirm');
	check('a GET of the delete link does nothing', (await req('GET', `/api/rsvp/decline?t=${malloryConfirm}`)).status === 405 || (await req('GET', `/api/rsvp/decline?t=${malloryConfirm}`)).status === 404);
	r = await req('POST', '/api/rsvp/decline', { t: malloryConfirm });
	check('the delete button removes an unconfirmed registration', r.status === 200 && r.data.ok && r.data.gone === false, JSON.stringify(r.data));
	const gone = await last(mallory);
	check('and sends one last email saying it is deleted, naming nobody', /Registration deleted/.test(gone.subject) && !/Someone else/.test(gone.text_body), gone.subject);
	r = await req('POST', '/api/rsvp/confirm', { t: malloryConfirm });
	check('and it can no longer be confirmed', r.status === 404);
	check('a bad token is refused', (await req('POST', '/api/rsvp/decline', { t: 'nope' })).status === 404);

	let aliceManage = null;
	r = await register({ name: 'Bob', email: bob, tour_id: TOUR1 });
	const bobMail = (await mailsTo(bob))[0];
	const bobConfirm = tokenFrom(bobMail.text_body, 'confirm');
	let bobManage = null;
	check('confirm via GET does nothing (link scanners)', [404, 405].includes((await req('GET', `/api/rsvp/confirm?t=${encodeURIComponent(aliceConfirm)}`)).status));
	check('tampered confirm token → 404', (await req('POST', '/api/rsvp/confirm', { t: aliceConfirm.slice(0, -2) + 'xx' })).status === 404);
	r = await req('POST', '/api/rsvp/confirm', { t: aliceConfirm });
	check('Alice confirms → place + tour place', r.data.ok && r.data.registration.place === 'place' && r.data.registration.tour_place === 'place', JSON.stringify(r.data));
	check('confirm response carries no contact details or needs', !('email' in r.data.registration) && !('needs' in r.data.registration) && !('name' in r.data.registration) && !('affiliation' in r.data.registration));
	aliceManage = await manageOf(alice);
	check('manage link arrives with the joining instructions', !!aliceManage);
	check('manage token cannot confirm', (await req('POST', '/api/rsvp/confirm', { t: aliceManage })).status === 404);
	{ const aid = aliceManage.split('.')[0];
	  check('a manage link with a valid signature but past its expiry is refused', (await req('GET', `/api/rsvp/manage?t=${encodeURIComponent(tokenWithExpiry('manage', aid, Math.floor(Date.now() / 1000) - 60))}`)).status === 404);
	  check('the same link before its expiry works', (await req('GET', `/api/rsvp/manage?t=${encodeURIComponent(tokenWithExpiry('manage', aid, Math.floor(Date.now() / 1000) + 3600))}`)).status === 200); }
	let m = await last(alice);
	check('Alice receives joining instructions', /Joining instructions/.test(m.subject) && /You have an in-person place/.test(m.text_body));
	check('instructions open with thanks, then her status, including dinner', new RegExp(String.raw`Thank you for registering for the [^\n]+, on \w+day \d+ \w+ ${YEAR}\.\n\nYou have an in-person place\.\nYou are booked on the 10:30 lab tour\.\nYou have a place at dinner\.`).test(m.text_body), JSON.stringify(m.text_body.slice(0, 400)));
	check('in-person instructions carry the in-person section only', /Room 516/.test(m.text_body) && !/Joining remotely/.test(m.text_body) && !/:::/.test(m.text_body));
	check('…with a calendar invitation for the day, and one for the dinner she signed up for', m.att.length === 2 && m.att.every((a) => /method=REQUEST/.test(a.content_type)) && m.att.some((a) => /SUMMARY:[^\r\n]*Dinner/.test(a.content) && /LOCATION:[^\r\n]*Hawk/.test(a.content)), JSON.stringify(m.att.map((a) => a.filename)));
	let ics = m.att.find((a) => !/SUMMARY:[^\r\n]*Dinner/.test(a.content)).content;
	check('invitation: METHOD:REQUEST, SEQUENCE:0, Europe/London VTIMEZONE', /METHOD:REQUEST/.test(ics) && /SEQUENCE:0/.test(ics) && /TZID:Europe\/London/.test(ics));
	check('calendar entries never carry the manage link', !/\/events\/manage\//.test(unfold(ics)) && !/events\/manage/.test(decodeURIComponent(m.html_body.match(/calendar\.google\.com[^"]*/)?.[0] ?? '')));
	{ const icsT = decodeURIComponent((/\/api\/rsvp\/calendar\?t=([^&"]+)/.exec(m.html_body) || [])[1] ?? '');
	  check('the .ics download token cannot open or change the registration', !!icsT && (await req('GET', `/api/rsvp/manage?t=${encodeURIComponent(icsT)}`)).status === 404); }
	check('invitation starts at her 10:30 tour and ends when the talks end', icsProp(ics, 'DTSTART').at(-1)?.endsWith(local(tours[0].starts_at)) && icsProp(ics, 'DTEND').at(-1)?.endsWith(local(PM.ends_at)), icsProp(ics, 'DTSTART').concat(icsProp(ics, 'DTEND')).join(' '));
	check('in-person reminders: week, day, travel + 15 min, 15 min', ['-P7D', '-P1D', '-PT75M', '-PT15M'].every((t) => ics.includes(`TRIGGER:${t}`)));
	check('organiser and attendee set, lines folded to 75 octets', /ORGANIZER;CN="AMYBO":mailto:hello@amybo\.org/.test(unfold(ics)) && /ATTENDEE;[^\r\n]*mailto:alice@example\.org/.test(unfold(ics)) && ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
	check('email has add-to-calendar links for Google, Outlook, Office 365 and Yahoo plus .ics', /calendar\.google\.com\/calendar\/render/.test(m.html_body) && /outlook\.live\.com/.test(m.html_body) && /outlook\.office\.com/.test(m.html_body) && /calendar\.yahoo\.com/.test(m.html_body) && /\/api\/rsvp\/calendar\?t=/.test(m.html_body));
	let host1 = await mailsTo('host1@example.org');
	check('tour host gets the list with Alice in bold and her shared email', host1.length === 1 && /<strong>Alice \(Lab A\) – booked – <a href="mailto:alice@example\.org"/.test(host1[0].html_body) && /\*\*Alice \(Lab A\) – booked – alice@example\.org\*\*/.test(host1[0].text_body), host1[0]?.text_body);
	r = await req('POST', '/api/rsvp/confirm', { t: aliceConfirm });
	check('confirming twice is idempotent and sends nothing more', r.data.ok && r.data.already === true && (await mailsTo(alice)).length === 2);

	r = await req('POST', '/api/rsvp/confirm', { t: bobConfirm });
	bobManage = await manageOf(bob);
	check('Bob confirms → in-person waiting list and tour waiting list', r.data.registration.place === 'waitlist' && r.data.registration.tour_place === 'waitlist', JSON.stringify(r.data));
	{ const bc = (await mailsTo(bob))[0]; check('on the waiting list, the confirm email says confirming joins the waiting list and no place is held', /join the waiting list: we will email you if a place comes up/.test(bc.text_body) && /it will be deleted on/.test(bc.text_body) && !/place will be released/.test(bc.text_body) && /You are joining the waiting list for an in-person place\./.test(bc.text_body), bc.text_body.slice(0, 600)); }
	{ const bm = await mailsTo(bob); check('Bob gets his manage link but no joining instructions or calendar while waiting', bm.length === 2 && /Thank you for confirming/.test(bm[1].text_body) && /waiting list/.test(bm[1].text_body) && !/Joining instructions/.test(bm[1].subject) && bm[1].att.length === 0 && !!tokenFrom(bm[1].text_body, 'manage'), bm.map((x) => x.subject).join(' | ')); }
	let hello = await mailsTo(NOTIFY);
	check('organiser told about the new waiting-list registration with totals', hello.some((x) => /waiting-list registration/.test(x.subject) && /In person: 1 confirmed of 1 places, 1 on the waiting list/.test(x.text_body)), hello.map((x) => x.subject).join(' | '));
	host1 = await mailsTo('host1@example.org');
	check('tour host list updated: Bob added in bold as waiting list, no email shown', host1.length === 2 && /\*\*Bob – waiting list\*\*/.test(host1[1].text_body) && !/bob@example/.test(host1[1].text_body) && /1\. Alice/.test(host1[1].text_body), host1.at(-1)?.text_body);
	{ const dh = await last('dinnerhost@example.org');
	  check('dinner host list has Alice, signed up, and not Bob (in person, no dinner)', !!dh && /Alice[^\n]*signed up/.test(dh.text_body) && !/Bob/.test(dh.text_body), dh?.text_body); }

	console.log('\nRegistering again with a confirmed address');
	let t0 = Date.now();
	r = await register({ name: 'Alice again', email: alice });
	check('duplicate returns the same generic success', r.status === 200 && r.data.ok);
	check('…no sooner than a new registration would (REGISTER_MIN_MS), so timing does not reveal it', Date.now() - t0 >= 200, Date.now() - t0);
	m = await last(alice);
	check('reminder confirms name, event, email and when registered, then the joining instructions', (await mailsTo(alice)).length === 3 && /already registered/.test(m.text_body) && /Name: Alice\. Email: alice@example\.org\. Registered: /.test(m.text_body) && /Schedule \(UK time\)/.test(m.text_body));
	check('reminder re-attaches the current calendar invitations (same sequence)', m.att.length === 2 && m.att.every((a) => /SEQUENCE:0/.test(a.content)));
	await register({ name: 'Bob', email: bob });
	m = await last(bob);
	check('waitlisted duplicate gets a reminder of their status, no instructions or calendar', (await mailsTo(bob)).length === 3 && /already registered/.test(m.text_body) && /waiting list/.test(m.text_body) && !/Schedule \(UK time\)/.test(m.text_body) && m.att.length === 0);

	{
		const aliceId = JSON.parse(sql(`SELECT id FROM registrations WHERE email = '${alice}'`, true))[0].results[0].id;
		const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString();
		// The reminder above is moved out of the ten-minute cooldown; with two more today, that makes three.
		sql(`UPDATE deliveries SET sent_at = '${ago(1)}' WHERE registration_id = '${aliceId}' AND kind = 'already_registered'`);
		sql(`INSERT INTO deliveries (registration_id, kind, sent_at, provider_id) VALUES ('${aliceId}', 'already_registered', '${ago(2)}', 'x'), ('${aliceId}', 'already_registered', '${ago(30)}', 'x')`);
		let n = (await mailsTo(alice)).length;
		await register({ name: 'Alice', email: alice });
		check('after the cooldown, a confirmed address registering again gets another reminder', (await mailsTo(alice)).length === n + 1);
		sql(`UPDATE deliveries SET sent_at = '${ago(3)}' WHERE registration_id = '${aliceId}' AND kind = 'already_registered' AND sent_at > '${ago(0.5)}'`);
		n = (await mailsTo(alice)).length;
		await register({ name: 'Alice', email: alice });
		check('…but no more than three a day, however the form is used', (await mailsTo(alice)).length === n);
	}

	console.log('\nRegistering again before confirming');
	const frank = 'frank@example.org';
	const fr1 = await register({ name: 'Frank', email: frank, attendance: 'in_person', tour_id: 'none', share_contact: true });
	check('Frank registers', fr1.status === 200, JSON.stringify(fr1.data));
	const frank1 = tokenFrom((await mailsTo(frank))[0].text_body, 'confirm');
	const fr2 = await register({ name: 'Frank', email: frank, attendance: 'remote', tour_id: 'none', share_contact: false });
	check('Frank registers again, remote', fr2.status === 200, JSON.stringify(fr2.data));
	const frankMails = await mailsTo(frank);
	const frank2 = tokenFrom(frankMails[1].text_body, 'confirm');
	check('the second registration replaces the first: old confirm link dead', frankMails.length === 2 && frank1 !== frank2 && (await req('POST', '/api/rsvp/confirm', { t: frank1 })).status === 404);
	r = await req('POST', '/api/rsvp/confirm', { t: frank2 });
	check('what is confirmed is the latest submission', r.data.ok && r.data.registration.attendance === 'remote', JSON.stringify(r.data));
	r = await req('DELETE', '/api/rsvp/manage', { t: await manageOf(frank) });
	check('Frank cancels', r.data.ok);
	{ const rita = `rita-${randomUUID()}@example.org`;
	  for (let i = 0; i < 5; i++) await register({ name: 'Rita', email: rita, attendance: 'remote' });
	  check('registering an unconfirmed address again and again: emails stop after the fourth', (await mailsTo(rita)).length === 4, String((await mailsTo(rita)).length)); }

	console.log('\nSelf-service changes and calendar updates');
	r = await req('GET', `/api/rsvp/manage?t=${encodeURIComponent(aliceManage)}`);
	check('manage view with calendar download', r.data.ok && r.data.registration.name === 'Alice' && r.data.registration.share_contact === true && r.data.calendar.length === 2 && r.data.calendar[0].key === 'day' && /Dinner/.test(r.data.calendar[1].summary));
	check('confirm token cannot manage', (await req('GET', `/api/rsvp/manage?t=${encodeURIComponent(aliceConfirm)}`)).status === 404);
	const dl = await fetch(r.data.calendar[0].url);
	const dlText = await dl.text();
	check('.ics download works (METHOD:PUBLISH, text/calendar, with the organiser)', dl.status === 200 && /text\/calendar/.test(dl.headers.get('content-type')) && /METHOD:PUBLISH/.test(dlText) && /BEGIN:VALARM/.test(dlText) && /ORGANIZER;CN="AMYBO"/.test(unfold(dlText)));
	let n = (await mailsTo(alice)).length;
	r = await req('POST', '/api/rsvp/manage', { t: aliceManage, name: 'Alice', attendance: 'in_person', tour_id: TOUR1, affiliation: 'Lab A', needs: 'Vegan, step-free access', share_contact: true });
	check('changing only dietary needs sends no calendar email', r.data.ok && (await mailsTo(alice)).length === n);
	r = await req('POST', '/api/rsvp/manage', { t: aliceManage, name: 'Alice A', attendance: 'in_person', tour_id: TOUR2, affiliation: 'Lab A', needs: 'Vegan, step-free access', share_contact: true });
	check('Alice moves to the free 11:15 tour', r.data.ok && r.data.registration.tour_id === TOUR2 && r.data.registration.tour_place === 'place', JSON.stringify(r.data));
	m = await last(alice);
	check('…and gets a calendar update: SEQUENCE:1, new start time', /Calendar update/.test(m.subject) && m.att.length === 1 && /SEQUENCE:1/.test(m.att[0].content) && icsProp(m.att[0].content, 'DTSTART').at(-1)?.endsWith(local(tours[1].starts_at)), m.subject + ' ' + (m.att[0] ? icsProp(m.att[0].content, 'DTSTART') : ''));
	host1 = await mailsTo('host1@example.org');
	check('10:30 host sees Alice struck through (removed)', /~~Alice \(Lab A\) – booked~~/.test(host1.at(-1).text_body) && /<s>Alice \(Lab A\) – booked<\/s>/.test(host1.at(-1).html_body), host1.at(-1)?.text_body);
	check('11:15 host gets a list with Alice A in bold', /\*\*Alice A \(Lab A\) – booked – alice@example\.org\*\*/.test((await last('host2@example.org'))?.text_body ?? ''));
	r = await req('GET', `/api/rsvp/status?event=${EVENT}`);
	check('freed 10:30 tour place is not offered while someone waits for it', r.data.tours.find((t) => t.id === TOUR1).available === false);

	console.log('\nRemote attendee: one calendar entry per online session');
	const c = await registerAndConfirm({ name: 'Carol "CJ" Jones, PhD', email: carol, attendance: 'remote', optins: [DINNER] });
	{ const cm = (await mailsTo(carol)).find((x) => /Joining instructions/.test(x.subject));
	  check('remote instructions carry the remote section only, and no dinner sign-up', !!cm && /Joining remotely/.test(cm.text_body) && !/Room 516/.test(cm.text_body) && !/join us for dinner|place at dinner/.test(cm.text_body), cm?.text_body.slice(0, 600)); }
	m = await last(carol);
	const remoteIcs = m.att.map((a) => a.content);
	check('two invitations, one per online session', m.att.length === 2 && m.att[0].filename === 'invite-1.ics', JSON.stringify(m.att.map((a) => a.filename)));
	check('online reminders: day, hour, 10 minutes', remoteIcs.every((x) => ['-P1D', '-PT1H', '-PT10M'].every((t) => x.includes(`TRIGGER:${t}`)) && !x.includes('TRIGGER:-P7D')));
	check('one entry per talk session, at its start time, with a link-to-follow location', icsProp(remoteIcs[0], 'DTSTART').at(-1)?.endsWith(local(AM.starts_at)) && icsProp(remoteIcs[1], 'DTSTART').at(-1)?.endsWith(local(PM.starts_at)) && /LOCATION:Online – the link will follow/.test(unfold(remoteIcs[0])));
	check('distinct stable UIDs', new Set(remoteIcs.map((x) => icsProp(x, 'UID')[0])).size === 2);
	check('attendee name with comma and quotes is a quoted parameter without escapes', unfold(remoteIcs[0]).includes('ATTENDEE;CN="Carol CJ Jones, PhD";ROLE='), icsProp(remoteIcs[0], 'ATTENDEE')[0]);

	console.log('\nAdmin session edits → calendar updates only where entries change');
	const meet = 'https://meet.google.com/abc-defg-hij';
	r = await req('POST', '/api/admin/sessions', { event: EVENT, dry_run: true, sessions: [{ id: AM.id, online_url: meet }] }, ADMIN);
	check('dry run: adding the morning Meet link affects only the remote attendee', r.data.calendar_updates === 1, JSON.stringify(r.data));
	n = (await mailsTo(alice)).length;
	r = await req('POST', '/api/admin/sessions', { event: EVENT, sessions: [{ id: AM.id, online_url: meet }] }, ADMIN);
	m = await last(carol);
	check('Carol gets one calendar update with the link, SEQUENCE:1', r.data.calendar_updates === 1 && /Calendar update/.test(m.subject) && m.att.length === 1 && /SEQUENCE:1/.test(m.att[0].content) && unfold(m.att[0].content).includes(`LOCATION:${meet}`));
	check('in-person Alice gets nothing (her entry did not change)', (await mailsTo(alice)).length === n);
	const pub = seeded.sessions.find((x) => x.kind === 'social');
	r = await req('POST', '/api/admin/sessions', { event: EVENT, sessions: [{ id: pub.id, location: 'The Broadcaster; 89 Wood Lane, London' }] }, ADMIN);
	m = await last(alice);
	check('pub location change updates only the in-person entry, with ; and , escaped', r.data.calendar_updates === 1 && /Calendar update/.test(m.subject) && unfold(m.att[0].content).includes('The Broadcaster\\; 89 Wood Lane\\, London') && /SEQUENCE:2/.test(m.att[0].content), JSON.stringify(r.data));
	check('the update email says where it is now', /now at The Broadcaster/.test(m.text_body), m.text_body.slice(0, 400));
	const pmEnd = new Date(Date.parse(PM.ends_at) + 30 * 60000).toISOString();
	r = await req('POST', '/api/admin/sessions', { event: EVENT, dry_run: true, sessions: [{ id: PM.id, ends_at: pmEnd }] }, ADMIN);
	check('dry run: moving the afternoon end affects in-person and remote (not waitlisted Bob)', r.data.calendar_updates === 2, JSON.stringify(r.data));
	r = await req('POST', '/api/admin/sessions', { event: EVENT, sessions: [{ id: PM.id, ends_at: pmEnd }] }, ADMIN);
	check('both updated; Alice now ends half an hour later with SEQUENCE:3', r.data.calendar_updates === 2 && icsProp((await last(alice)).att[0].content, 'DTEND')[0]?.endsWith(local(pmEnd)) && /SEQUENCE:3/.test((await last(alice)).att[0].content));
	check('saving unchanged sessions sends nothing', (await req('POST', '/api/admin/sessions', { event: EVENT, sessions: [{ id: PM.id, ends_at: pmEnd }] }, ADMIN)).data.calendar_updates === 0);
	n = (await outbox()).length;
	r = await req('POST', '/api/admin/sessions', { event: EVENT, sessions: [{ id: DINNER, location: 'provisionally at The Broadcaster, 89 Wood Lane, London W12 7FX (~£45 a head)' }], quiet: true }, ADMIN);
	check('save without emailing: saved, nobody emailed', r.data.ok && r.data.calendar_updates === 0 && (await outbox()).length === n, JSON.stringify(r.data));
	{ const travelBefore = (await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN)).data.event.travel_minutes;
	  n = (await outbox()).length;
	  r = await req('POST', '/api/admin/settings', { event: EVENT, travel_minutes: 45 }, ADMIN);
	  check('changing the travel time emails nobody', r.data.ok && r.data.calendar_updates === 0 && (await outbox()).length === n, JSON.stringify(r.data));
	  await req('POST', '/api/admin/settings', { event: EVENT, travel_minutes: travelBefore }, ADMIN); }

	console.log('\nAdmin: promote, instructions versions, messages');
	r = await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN);
	check('summary counts, no calendar internals exposed', r.data.capacity.inPerson.confirmed === 1 && r.data.capacity.inPerson.waiting === 1 && !('calendar_state' in r.data.registrations[0]), JSON.stringify(r.data.capacity));
	const bobId = r.data.registrations.find((x) => x.email === bob).id;
	r = await req('POST', '/api/admin/promote', { id: bobId, what: 'tour' }, ADMIN);
	check('promote Bob to the 10:30 tour (still waiting for a place → no email yet)', r.data.ok && (await mailsTo(bob)).length === 3);
	r = await req('POST', '/api/admin/promote-all', { event: EVENT }, ADMIN);
	check('promote all does nothing while the maximum is reached', r.data.ok && r.data.promoted === 0 && r.data.still_waiting === 1, JSON.stringify(r.data));
	await req('POST', '/api/admin/settings', { event: EVENT, in_person_max: 2 }, ADMIN);
	const hostsBefore = (await outbox()).filter((x) => /Attendee list changed/.test(x.subject)).length;
	r = await req('POST', '/api/admin/promote-all', { event: EVENT }, ADMIN);
	check('promote all sends each host at most one list', (await outbox()).filter((x) => /Attendee list changed/.test(x.subject)).length - hostsBefore <= 3);
	check('raising the maximum then promote all gives the waiting list places, in order', r.data.ok && r.data.promoted === 1 && r.data.still_waiting === 0, JSON.stringify(r.data));
	await req('POST', '/api/admin/settings', { event: EVENT, in_person_max: 1 }, ADMIN);
	check('promote all needs Access', (await req('POST', '/api/admin/promote-all', { event: EVENT })).status === 401);
	m = await last(bob);
	check('promote Bob to a place → joining instructions opening with the good news, with an invitation starting 10:30', r.data.ok && /Good news: a place has become available/.test(m.text_body) && /You have an in-person place/.test(m.text_body) && /booked on the 10:30 lab tour/.test(m.text_body) && m.att.length === 1 && icsProp(m.att[0].content, 'DTSTART').at(-1)?.endsWith(local(tours[0].starts_at)), m.text_body.slice(0, 300));
	check('10:30 host list now shows Bob booked (changed, in bold)', /\*\*Bob – booked(, but waiting for an in-person place)?\*\*/.test((await last('host1@example.org')).text_body));
	check('promoting again is refused', (await req('POST', '/api/admin/promote', { id: bobId, what: 'event' }, ADMIN)).status === 400);

	r = await req('POST', '/api/admin/instructions', { event: EVENT, subject: 'Joining instructions v2', body_md: 'Room **G01**, sign in at reception.\n\n- Bring ID', change_note: 'Added room' }, ADMIN);
	const V = r.data.version; // the seed may already carry several versions
	check('new instructions version saved as the next number', r.data.ok && V >= 2);
	n = (await outbox()).length;
	check('saving a version emails nobody', (await outbox()).length === n);
	r = await req('POST', '/api/admin/messages', { event: EVENT, dry_run: true, audience: { below_version: V } }, ADMIN);
	check('dry run: 3 people on an older version', r.data.count === 3, JSON.stringify(r.data));
	r = await req('POST', '/api/admin/messages', { event: EVENT, subject: 'Room confirmed', body_md: "What's changed: we are in room **G01**.", audience: { below_version: V }, marks_instructions_version: V }, ADMIN);
	check('send now', r.data.ok && r.data.message.status === 'sent' && r.data.message.recipients_count === 3, JSON.stringify(r.data));
	m = await last(alice);
	check('each recipient gets a personal copy with their manage link and the beta footer', /Hello Alice A/.test(m.text_body) && /<strong>G01<\/strong>/.test(m.html_body) && m.text_body.includes('/events/manage/?t=') && /Events&I \(beta\)/.test(m.text_body));
	check('with "include the latest joining instructions", the message opens a full copy of them under its own subject', m.subject === 'Room confirmed' && /Room \*\*G01\*\*|Room G01/.test(m.text_body) && /Bring ID/.test(m.text_body) && /What's changed/.test(m.text_body), m.subject + ' | ' + m.text_body.slice(0, 300));
	check('…and carries calendar changes saved quietly earlier (the new dinner location)', m.att.some((x) => /METHOD:REQUEST/.test(x.content) && /provisionally at The Broadcaster/.test(x.content.replace(/\r\n /g, ''))), m.att.map((x) => (/LOCATION:[^\r\n]*/.exec(x.content) || [''])[0]).join(' | '));
	check('recipients now recorded as having the new version', (await req('POST', '/api/admin/messages', { event: EVENT, dry_run: true, audience: { below_version: V } }, ADMIN)).data.count === 0);
	{
		const regs = (await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN)).data.registrations.filter((x) => x.status === 'confirmed');
		const has = (list, id) => (list || '').split(',').includes(id);
		const count = async (audience) => (await req('POST', '/api/admin/messages', { event: EVENT, dry_run: true, audience }, ADMIN)).data.count;
		const dinner = regs.filter((x) => x.attendance === 'in_person' && has(x.optins, DINNER) && !has(x.optins_waiting, DINNER) && x.place !== 'waitlist').length;
		const dinnerAll = regs.filter((x) => x.attendance === 'in_person' && has(x.optins, DINNER)).length;
		const extras = regs.filter((x) => x.attendance === 'in_person' && !x.place && !(x.optins || '').split(',').filter(Boolean).every((o) => has(x.optins_waiting, o))).length;
		const day = regs.filter((x) => x.attendance === 'in_person' && x.place === 'place').length;
		check('filter by opt-in session: just the people with a dinner place', dinner > 0 && (await count({ optin: DINNER })) === dinner, `${dinner} vs ${await count({ optin: DINNER })}`);
		check('…and with the waiting list ticked, those waiting for it too', (await count({ optin: DINNER, include_waitlist: true })) === dinnerAll, `${dinnerAll}`);
		check('"in person for the day" and "only coming to opt-in sessions" split "in person"', (await count({ attendance: 'extras' })) === extras && (await count({ attendance: 'day' })) === day && (await count({ attendance: 'in_person' })) === extras + day, `${extras} ${day}`);
	}
	check('filter by tour: 11:15 → 1 person', (await req('POST', '/api/admin/messages', { event: EVENT, dry_run: true, audience: { tour_id: TOUR2 } }, ADMIN)).data.count === 1);
	check('HTML in messages is escaped', !/<script>/.test((await req('POST', '/api/admin/preview', { body_md: '<script>alert(1)</script>' }, ADMIN)).data.html));
	const inAnHour = new Date(Date.now() + 3600_000).toISOString();
	r = await req('POST', '/api/admin/messages', { event: EVENT, subject: 'Reminder', body_md: 'See you soon', audience: { attendance: 'in_person' }, scheduled_at: inAnHour }, ADMIN);
	const schedId = r.data.message.id;
	check('schedule a message', r.data.message.status === 'scheduled');
	r = await req('POST', '/api/admin/messages', { event: EVENT, subject: 'To cancel', body_md: 'x', audience: {}, scheduled_at: inAnHour }, ADMIN);
	check('cancel a scheduled message', (await req('POST', '/api/admin/messages/cancel', { id: r.data.message.id }, ADMIN)).data.ok);
	n = (await outbox()).length;
	await cron(Date.now());
	check('cron does not send before the scheduled time', (await outbox()).length === n);
	await cron(Date.now() + 2 * 3600_000);
	check('cron sends the due scheduled message once, cancelled one never', (await outbox()).filter((x) => x.subject === 'Reminder').length === 2 && !(await outbox()).some((x) => x.subject === 'To cancel'));
	await cron(Date.now() + 3 * 3600_000);
	check('scheduled message is not sent twice', (await outbox()).filter((x) => x.subject === 'Reminder').length === 2);
	r = await req('GET', `/api/admin/messages?event=${EVENT}`, undefined, ADMIN);
	check('sent log lists sent, scheduled and cancelled messages', r.data.messages.some((x) => x.id === schedId && x.status === 'sent') && r.data.messages.some((x) => x.status === 'cancelled'));
	r = await req('GET', `/api/admin/sent-log?event=${EVENT}`, undefined, ADMIN);
	check('markdown sent log includes versions, sessions and messages', typeof r.data === 'string' && r.data.includes(`Version ${V}`) && /Room confirmed/.test(r.data) && r.data.includes(`Version ${V}: 3 confirmed`) && /## Sessions/.test(r.data) && /online link set/.test(r.data));

	console.log('\nExports');
	await register({ name: '=HYPERLINK("http://x")', email: 'formula@example.org', attendance: 'remote' });
	r = await req('GET', `/api/admin/export?format=csv&event=${EVENT}`, undefined, ADMIN);
	check('CSV has registrants, sharing consent, and defuses formulas', typeof r.data === 'string' && /Alice A/.test(r.data) && /"'=HYPERLINK/.test(r.data) && /share_contact/.test(r.data), String(r.data).slice(0, 300));
	r = await req('GET', `/api/admin/export?format=bcc&event=${EVENT}&audience=${encodeURIComponent('{}')}`, undefined, ADMIN);
	check('BCC list has confirmed attendees only', r.data.count === 3 && r.data.bcc.includes(alice) && !r.data.bcc.includes('formula@'));
	check('BCC with a malformed audience does not crash', (await req('GET', `/api/admin/export?format=bcc&event=${EVENT}&audience=%7Bnot-json`, undefined, ADMIN)).status === 200);

	console.log('\nChanges that join a waiting list');
	const dan = 'dan@example.org';
	const d = await registerAndConfirm({ name: 'Dan', email: dan, attendance: 'remote' });
	r = await req('POST', '/api/rsvp/manage', { t: d.manage, name: 'Dan', attendance: 'in_person', tour_id: TOUR2 });
	check('confirmed remote → in person when full: waiting list for place and tour', r.data.registration.place === 'waitlist' && r.data.registration.tour_place === 'waitlist', JSON.stringify(r.data));
	check('organiser told about the waiting-list change', (await mailsTo(NOTIFY)).some((x) => /Dan changed their registration and joined the in-person waiting list and the 11:15 lab tour waiting list/.test(x.text_body)));
	m = await last(dan);
	check('Dan\'s online calendar entries are cancelled while he waits for an in-person place', /Calendar update/.test(m.subject) && m.att.length === 2 && m.att.every((a) => /METHOD:CANCEL/.test(a.content) && /SEQUENCE:1/.test(a.content)), m.subject + JSON.stringify(m.att.map((a) => a.filename)));
	n = (await mailsTo(NOTIFY)).length;
	await req('POST', '/api/rsvp/manage', { t: d.manage, name: 'Dan D', attendance: 'in_person', tour_id: TOUR2 });
	check('editing other details while waiting does not re-notify the organiser', (await mailsTo(NOTIFY)).length === n);
	await req('DELETE', '/api/rsvp/manage', { t: d.manage });

	console.log('\nUnconfirmed holds');
	const eve = 'eve@example.org';
	await register({ name: 'Eve', email: eve, attendance: 'remote' });
	await register({ name: 'Evan', email: 'evan@example.org', attendance: 'remote' });
	const created = Date.now();
	await cron(created + 23 * 3600_000);
	check('before half the hold: no warning', !(await mailsTo(NOTIFY)).some((x) => /Eve/.test(x.text_body)));
	await cron(created + 25 * 3600_000);
	check('after half the hold: organiser warned once', (await mailsTo(NOTIFY)).filter((x) => /half way/.test(x.subject) && /Eve/.test(x.text_body)).length === 1);
	check('…in one email for all the holds half way through, not one each', (await mailsTo(NOTIFY)).some((x) => /\d+ unconfirmed registrations half way/.test(x.subject) && /Eve registered/.test(x.text_body) && /Evan registered/.test(x.text_body)));
	await cron(created + 26 * 3600_000);
	check('warning not repeated', (await mailsTo(NOTIFY)).filter((x) => /half way/.test(x.subject) && /Eve/.test(x.text_body)).length === 1);
	await cron(created + 49 * 3600_000);
	const eveConfirm = tokenFrom((await mailsTo(eve))[0].text_body, 'confirm');
	check('after the hold: unconfirmed registration deleted', (await req('POST', '/api/rsvp/confirm', { t: eveConfirm })).status === 404);

	console.log('\nTour booking deadlines (separate from the registration deadline)');
	r = await req('POST', '/api/admin/sessions', { event: EVENT, sessions: [{ id: TOUR1, booking_deadline: new Date(Date.now() - 60_000).toISOString() }] }, ADMIN);
	check('10:30 tour booking closed by its own deadline, no calendar emails', r.data.ok && r.data.calendar_updates === 0);
	r = await req('GET', `/api/rsvp/status?event=${EVENT}`);
	check('status shows the 10:30 tour closed, registration still open', r.data.event.open === true && r.data.tours.find((t) => t.id === TOUR1).open === false && r.data.tours.find((t) => t.id === TOUR2).open === true);
	check('Alice cannot move into the closed tour', (await req('POST', '/api/rsvp/manage', { t: aliceManage, name: 'Alice A', attendance: 'in_person', tour_id: TOUR1 })).status === 409);
	check('Bob cannot leave the closed tour either', (await req('POST', '/api/rsvp/manage', { t: bobManage, name: 'Bob', attendance: 'in_person', tour_id: 'none' })).status === 409);
	r = await req('POST', '/api/rsvp/manage', { t: bobManage, name: 'Bob', attendance: 'in_person', share_contact: false });
	check('with his tour closed, Bob can still save other changes (closed tour kept)', r.data.ok && r.data.registration.tour_id === TOUR1 && r.data.registration.share_contact === false, JSON.stringify(r.data));
	check('closed tour: same refusal for a registered and an unregistered address', (await register({ email: bob, tour_id: TOUR1 })).status === 409 && (await register({ email: `${randomUUID()}@example.org`, tour_id: TOUR1 })).status === 409);
	r = await req('POST', '/api/admin/sessions', { event: EVENT, quiet: true, sessions: [{ id: DINNER, booking_deadline: new Date(Date.now() - 60_000).toISOString() }] }, ADMIN);
	check('dinner sign-up closed by its own deadline', r.data.ok, JSON.stringify(r.data));
	check('a new registration ticking the closed dinner → 409', (await register({ email: `${randomUUID()}@example.org`, optins: [DINNER] })).status === 409);
	check('ticking the closed dinner on the manage page → 409', (await req('POST', '/api/rsvp/manage', { t: bobManage, name: 'Bob', attendance: 'in_person', optins: [DINNER] })).status === 409);
	await req('POST', '/api/admin/sessions', { event: EVENT, quiet: true, sessions: [{ id: DINNER, booking_deadline: null }] }, ADMIN);
	console.log('\nPolls');
	{
		const POLLS = '/api/admin/polls';
		check('polls API without JWT → 401', (await req('GET', `${POLLS}?event=${EVENT}`)).status === 401);
		check('a poll needs a question', (await req('POST', POLLS, { action: 'create', event: EVENT, question: '', options: 'Skiing' }, ADMIN)).status === 400);
		let before = (await outbox()).length;
		r = await req('POST', POLLS, { action: 'create', event: EVENT, question: 'What shall we do on Saturday?', options: 'Skiing\nCamping\nHiking\n skiing \nFootball\nRugby' }, ADMIN);
		const POLL = r.data.id;
		let ap = (await req('GET', `${POLLS}?event=${EVENT}`, undefined, ADMIN)).data.polls.find((p) => p.id === POLL);
		check('organiser creates a poll; a repeated option is dropped; nobody is emailed', r.data.ok && ap.options.map((o) => o.label).join() === 'Skiing,Camping,Hiking,Football,Rugby' && (await outbox()).length === before, JSON.stringify(r.data));
		const opt = (label, p = ap) => p.options.find((o) => o.label === label)?.id;
		const [SKI, CAMP, HIKE, FOOT, RUGBY] = ['Skiing', 'Camping', 'Hiking', 'Football', 'Rugby'].map((l) => opt(l));
		const pat = await registerAndConfirm({ name: 'Pat', email: 'pat@example.org', attendance: 'remote' });
		const quinn = await registerAndConfirm({ name: 'Quinn', email: 'quinn@example.org', attendance: 'remote' });
		const view = async (who) => (await req('GET', `/api/rsvp/manage?t=${encodeURIComponent(who.manage)}`)).data.polls.find((p) => p.id === POLL);
		const patMail = (await mailsTo('pat@example.org')).at(-1);
		check('joining instructions invite someone who has not answered an open poll, in the same email', /Joining instructions/.test(patMail.subject) && /Have your say: "What shall we do on Saturday\?"\. Put the options in order on your registration page\./.test(patMail.text_body) && /Manage my registration and answer/.test(patMail.html_body), patMail.text_body.slice(-700));
		let pv = await view(pat);
		check('the manage view lists the poll, unanswered, with no results yet', pv && pv.open && pv.options.length === 5 && pv.ballot === null && pv.results === null, JSON.stringify(pv));
		const vote = (who, ranking, bar) => req('POST', '/api/rsvp/poll', { t: who.manage, poll: POLL, ranking, bar });
		r = await vote(pat, [SKI, CAMP, HIKE, FOOT, RUGBY], 3);
		check('Pat ranks skiing, camping, hiking, then the line, then football and rugby', r.data.ok && r.data.polls.find((p) => p.id === POLL).ballot.bar === 3 && r.data.polls.find((p) => p.id === POLL).ballot.ranking[0] === SKI && r.data.polls.find((p) => p.id === POLL).results.find((x) => x.label === 'Skiing').willing === 1, JSON.stringify(r.data));
		check('an unknown option → 409', (await vote(pat, [SKI, 'nope'], 1)).status === 409);
		check('an option twice → 409', (await vote(pat, [SKI, SKI], 1)).status === 409);
		check('the line beyond the end → 400', (await vote(pat, [SKI], 2)).status === 400);
		check('a ranking without a valid manage link → 404', (await req('POST', '/api/rsvp/poll', { t: 'x.y.z', poll: POLL, ranking: [SKI], bar: 1 })).status === 404);
		r = await vote(quinn, [HIKE, CAMP, SKI, FOOT, RUGBY], 2);
		await register({ name: 'Quinn', email: 'quinn@example.org', attendance: 'remote' });
		const qm = await last('quinn@example.org');
		check('once answered, the reminder of their registration has no poll line', !/Have your say/.test(qm.text_body), qm.subject);
		ap = (await req('GET', `${POLLS}?event=${EVENT}`, undefined, ADMIN)).data.polls.find((p) => p.id === POLL);
		const row = (label) => ap.tally.results.find((x) => x.label === label);
		check('tally: who would join, who would stay at home, first choices, preference', ap.tally.voters === 2 && row('Camping').willing === 2 && row('Hiking').willing === 2 && row('Skiing').willing === 1 && row('Skiing').out === 1 && row('Football').out === 2 && row('Skiing').first === 1 && row('Camping').score === 3 && row('Hiking').score === 3, JSON.stringify(ap.tally));
		check('tally sorted by who would join, and the organiser sees names', ['Camping', 'Hiking'].includes(ap.tally.results[0].label) && ap.tally.results.at(-1).willing === 0 && row('Camping').names.join() === 'Pat,Quinn', JSON.stringify(ap.tally.results.map((x) => x.label)));

		r = await req('GET', `/api/rsvp/status?event=${EVENT}`);
		const sp = (r.data.polls || []).find((p) => p.id === POLL);
		check('the booking form gets the open poll and its options', sp && sp.options.map((o) => o.label).join() === 'Skiing,Camping,Hiking,Football,Rugby', JSON.stringify(r.data.polls));
		check('malformed booking-form poll answers → 400, and no registration', (await register({ name: 'Rosa', email: 'rosa@example.org', attendance: 'remote', polls: [{ poll: POLL, ranking: [SKI, SKI], bar: 1 }] })).status === 400 && !(await mailsTo('rosa@example.org')).length);
		const tallyNow = async () => JSON.stringify((await req('GET', `${POLLS}?event=${EVENT}`, undefined, ADMIN)).data.polls.find((p) => p.id === POLL).tally);
		const t0 = await tallyNow();
		r = await register({ name: 'Sam', email: 'sam@example.org', attendance: 'remote', polls: [{ poll: POLL, ranking: [RUGBY, 'gone-option'], bar: 2 }, { poll: 'closed-or-gone', ranking: [], bar: 0 }] });
		check('an out-of-date booking-form ranking is dropped, and the registration still goes through', r.status === 200 && (await mailsTo('sam@example.org')).length === 1, JSON.stringify(r.data));
		await register({ name: 'Una', email: 'una@example.org', attendance: 'remote', polls: [{ poll: POLL, ranking: [RUGBY, FOOT], bar: 2 }] });
		check('a ranking from an unconfirmed registration does not count until the address is confirmed', (await tallyNow()) === t0);
		const rosa = await registerAndConfirm({ name: 'Rosa', email: 'rosa@example.org', attendance: 'remote', polls: [{ poll: POLL, ranking: [RUGBY, FOOT, SKI, CAMP, HIKE], bar: 2 }] });
		const rv = await view(rosa);
		const rosaMail = (await mailsTo('rosa@example.org')).at(-1);
		check('ranking on the booking form is saved with the registration, and the joining instructions do not ask again', rv.ballot && rv.ballot.ranking[0] === RUGBY && rv.ballot.bar === 2 && !/Have your say/.test(rosaMail.text_body), JSON.stringify(rv.ballot));
		await req('DELETE', '/api/rsvp/manage', { t: rosa.manage });

		console.log('\nPoll suggestions');
		before = (await mailsTo(NOTIFY)).length;
		const suggest = (who, label) => req('POST', '/api/rsvp/poll', { t: who.manage, poll: POLL, suggest: label });
		r = await suggest(pat, 'Paddle boarding');
		const PADDLE = r.data.option?.id;
		let note = (await mailsTo(NOTIFY)).slice(before);
		check('Pat suggests paddle boarding: pending, and the organiser is emailed once', r.data.ok && r.data.option.pending && !r.data.existing && note.length === 1, JSON.stringify(r.data));
		const sm = note[0];
		const refOf = (m) => /\(ref ([A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{16})\)/.exec(m.subject)?.[1];
		check('the suggestion email names Pat and the option, explains yes / no / use, replies go to the poll address, and it carries a reference', /Poll suggestion: Paddle boarding/.test(sm.subject) && !!refOf(sm) && /Pat suggested an option for "What shall we do on Saturday\?"/.test(sm.text_body) && /yes: add it/.test(sm.text_body) && /use <your wording>/.test(sm.text_body) && sm.reply_to === 'polls@example.org' && /\/admin\/rsvps\/\?event=/.test(sm.text_body), sm.subject + ' | ' + sm.reply_to + ' | ' + sm.text_body.slice(0, 600));
		check('Pat sees the suggestion as theirs, waiting; Quinn does not see it', (await view(pat)).options.some((o) => o.id === PADDLE && o.pending && o.mine) && !(await view(quinn)).options.some((o) => o.id === PADDLE));
		before = (await mailsTo(NOTIFY)).length;
		r = await suggest(pat, '  skiing ');
		check('suggesting an existing option returns it, and emails nobody', r.data.ok && r.data.existing && r.data.option.id === SKI && (await mailsTo(NOTIFY)).length === before, JSON.stringify(r.data));
		r = await vote(pat, [PADDLE, SKI, CAMP, HIKE, FOOT, RUGBY], 4);
		check('Pat ranks their own suggestion first', r.data.ok && r.data.polls.find((p) => p.id === POLL).ballot.ranking[0] === PADDLE, JSON.stringify(r.data));
		check('Quinn cannot rank Pat\'s pending suggestion → 409', (await vote(quinn, [PADDLE, HIKE], 1)).status === 409);
		check('the organiser sees the pending suggestion and who made it', (await req('GET', `${POLLS}?event=${EVENT}`, undefined, ADMIN)).data.polls.find((p) => p.id === POLL).options.some((o) => o.id === PADDLE && o.status === 'pending' && o.suggested_by_name === 'Pat'));

		console.log('\nReplying to a suggestion by email');
		const inbound = async (raw) => (await (await fetch(`${BASE}/api/dev/inbound`, { method: 'POST', body: raw })).json());
		const mail = ({ from = NOTIFY, subject, body, headers = '' }) => `From: Organiser <${from}>\r\nTo: polls@example.org\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\n${headers}\r\n${body}`;
		const plain = (o) => mail({ ...o, headers: 'Content-Type: text/plain; charset=utf-8\r\n' });
		const ref = refOf(sm);
		before = (await outbox()).length;
		r = await inbound(plain({ from: 'stranger@example.org', subject: `Re: ${sm.subject}`, body: 'yes\r\n' }));
		check('a reply from someone who is not an organiser is refused, and changes nothing', r.result.action === 'rejected' && !!r.rejected && (await view(pat)).options.find((o) => o.id === PADDLE).pending && (await outbox()).length === before, JSON.stringify(r));
		r = await inbound(plain({ subject: `Re: ${sm.subject}`, body: 'yes\r\n' }).replace('From:', 'Authentication-Results: mx.cloudflare.net; dkim=none; spf=fail; dmarc=fail header.from=amybo.org\r\nFrom:'));
		check('an organiser\'s address that fails DMARC is refused, and nothing is sent', r.result.action === 'rejected' && /DMARC fail/.test(r.rejected) && (await view(pat)).options.find((o) => o.id === PADDLE).pending && (await outbox()).length === before, JSON.stringify(r));
		r = await inbound(plain({ subject: `Re: ${sm.subject}`, body: 'Maybe\r\n' }).replace('From:', 'Authentication-Results: mx.cloudflare.net; dmarc=pass header.from=amybo.org\r\nAuthentication-Results: evil.example; dmarc=fail\r\nFrom:'));
		check('a DMARC pass recorded by Cloudflare (topmost) lets the reply through; headers further down are ignored', r.result.action === 'not-understood', JSON.stringify(r));
		r = await inbound(plain({ subject: `Re: ${sm.subject}`, body: 'Maybe\r\n' }).replace('From:', 'Authentication-Results: mx.cloudflare.net; dmarc=none header.from=amybo.org\r\nFrom:'));
		check('a domain without a DMARC policy (dmarc=none) is not refused', r.result.action === 'not-understood', JSON.stringify(r));
		before = (await outbox()).length;
		r = await inbound(plain({ subject: `Re: [AMYBO] Poll suggestion (ref ${ref.slice(0, 17)}AAAAAAAAAAAAAAAA)`, body: 'yes\r\n' }));
		check('a reply with a forged reference is refused', r.result.action === 'rejected' && (await outbox()).length === before, JSON.stringify(r));
		r = await inbound(mail({ subject: `Automatic reply: ${sm.subject}`, headers: 'Content-Type: text/plain\r\nAuto-Submitted: auto-replied\r\n', body: 'No one is in the office until Monday.\r\n' }));
		check('an out-of-office reply that starts with "No" decides nothing, and is neither answered nor bounced', r.result.action === 'ignored' && !r.rejected && (await view(pat)).options.find((o) => o.id === PADDLE).pending && (await outbox()).length === before, JSON.stringify(r));
		r = await inbound(mail({ from: 'stranger@example.org', subject: `Re: ${sm.subject}`, body: 'yes\r\n' }).replace(`From: Organiser <stranger@example.org>`, `From: "<${NOTIFY}>" <stranger@example.org>`));
		check('an organiser\'s address hidden in the display name does not pass for the sender', r.result.action === 'rejected' && (await view(pat)).options.find((o) => o.id === PADDLE).pending, JSON.stringify(r));
		r = await inbound(plain({ subject: `Re: ${sm.subject}`, body: 'No problem, add it\r\n' }));
		check('"No problem, add it" is not read as no', r.result.action === 'not-understood' && (await view(pat)).options.find((o) => o.id === PADDLE).pending, JSON.stringify(r));
		r = await inbound(plain({ subject: `Re: ${sm.subject}`, body: 'maybe, let me think\r\n\r\nOn Fri, someone wrote:\r\n> yes: add it\r\n' }));
		let back = await last(NOTIFY);
		check('a reply that is not yes, no or use: nothing changes and the organiser is told', r.result.action === 'not-understood' && /reply not understood/.test(back.subject) && /maybe, let me think/.test(back.text_body) && (await view(pat)).options.find((o) => o.id === PADDLE).pending, JSON.stringify(r));
		// A typical HTML mail app reply: multipart/alternative, quoted-printable, the answer above the quoted original.
		const qp = 'use Paddleboarding on the Thames=0D=0A=0D=0AOn Fri, 13 Nov 2026, AMYBO wrote:=0D=0A> Pat suggested an opti=\r\non';
		r = await inbound(mail({ subject: `=?UTF-8?Q?Re:_[AMYBO]_Poll_suggestion:_Paddle_boarding?= (ref ${ref})`, headers: 'Content-Type: multipart/alternative; boundary="b1"\r\n',
			body: `--b1\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qp}\r\n--b1\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n<div>use Paddleboarding on the Thames</div><blockquote>yes</blockquote>\r\n--b1--\r\n` }));
		back = await last(NOTIFY);
		pv = await view(pat);
		check('"use <wording>" adds the suggestion for everyone in the organiser\'s words', r.result.action === 'decided' && !r.result.already && pv.options.some((o) => o.id === PADDLE && !o.pending && o.label === 'Paddleboarding on the Thames'), JSON.stringify(r));
		check('the organiser gets a confirmation; Pat is not emailed and sees it on their page', /Done: "Paddle boarding" added as "Paddleboarding on the Thames"/.test(back.text_body) && (await mailsTo('pat@example.org')).every((m) => !/Paddle/.test(m.text_body)) && pv.notes.some((n) => /"Paddle boarding" was added for everyone as "Paddleboarding on the Thames"/.test(n)), back.text_body + JSON.stringify(pv.notes));
		const qv = await view(quinn);
		check('Quinn now sees it, as new and not yet in their order', qv.options.some((o) => o.id === PADDLE && !o.pending) && !qv.ballot.ranking.includes(PADDLE), JSON.stringify(qv.ballot));
		r = await inbound(plain({ subject: `Re: ${sm.subject}`, body: 'no\r\n' }));
		check('a second answer changes nothing and says it was already decided', r.result.action === 'decided' && r.result.already && (await view(pat)).options.some((o) => o.id === PADDLE && !o.pending) && /already been decided/.test((await last(NOTIFY)).text_body), JSON.stringify(r));

		r = await suggest(quinn, 'Footy');
		const FOOTY = r.data.option.id;
		await vote(quinn, [FOOTY, HIKE, CAMP, SKI, FOOT, RUGBY], 3);
		r = await req('POST', POLLS, { action: 'decide', option: FOOTY, decision: 'use', label: 'football' }, ADMIN);
		let qb = (await view(quinn));
		check('on the admin page, "use" with an existing option\'s name merges the suggestion into it, keeping Quinn\'s ranking', r.data.ok && /merged into "Football"/.test(r.data.outcome) && qb.ballot.ranking[0] === FOOT && qb.ballot.bar === 3 && qb.ballot.ranking.filter((x) => x === FOOT).length === 1 && qb.notes.some((n) => /"Footy" is already an option, as "Football"/.test(n)), JSON.stringify([r.data, qb.ballot, qb.notes]));
		r = await suggest(quinn, 'Darts');
		const darts = (await mailsTo(NOTIFY)).filter((m) => /Poll suggestion: Darts/.test(m.subject)).at(-1);
		await vote(quinn, [r.data.option.id, FOOT, HIKE, CAMP, SKI, RUGBY], 4);
		r = await inbound(mail({ subject: `RE: ${darts.subject}`, headers: 'Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n', body: Buffer.from('No thanks.\r\n\r\n-----Original Message-----\r\nyes\r\n').toString('base64') + '\r\n' }));
		qb = await view(quinn);
		check('"no" turns a suggestion down; it leaves Quinn\'s order, the line moving up with it', r.result.action === 'decided' && /not added/.test(r.result.outcome) && qb.ballot.ranking[0] === FOOT && qb.ballot.bar === 3 && qb.notes.some((n) => /"Darts" was not added/.test(n)), JSON.stringify([r, qb.ballot]));
		before = (await mailsTo(NOTIFY)).length;
		const burst = await Promise.all(['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((l) => suggest(pat, `Pat idea ${l}`)));
		check('six suggestions at once: three wait for the organisers, three are refused, three emails', burst.filter((x) => x.status === 200).length === 3 && burst.filter((x) => x.status === 429).length === 3 && (await mailsTo(NOTIFY)).length === before + 3, burst.map((x) => x.status).join());
		check('a fourth suggestion waiting at once → 429', (await suggest(pat, 'Pat idea Seven')).status === 429);

		console.log('\nOrganising a poll');
		pv = await view(pat);
		const patBar = pv.ballot.bar;
		r = await req('POST', POLLS, { action: 'remove_option', option: CAMP }, ADMIN);
		pv = await view(pat);
		check('removing an option takes it off everyone\'s order; Pat\'s line moves up with it', r.data.ok && !pv.options.some((o) => o.id === CAMP) && !pv.ballot.ranking.includes(CAMP) && pv.ballot.bar === patBar - 1, JSON.stringify(pv.ballot));
		r = await req('POST', POLLS, { action: 'add_option', poll: POLL, label: 'hiking' }, ADMIN);
		check('adding an option that exists → 409', r.status === 409);
		r = await req('POST', POLLS, { action: 'rename_option', option: HIKE, label: 'Hill walking' }, ADMIN);
		check('renaming an option keeps everyone\'s ranking', r.data.ok && (await view(quinn)).options.find((o) => o.id === HIKE).label === 'Hill walking' && (await view(quinn)).ballot.ranking.includes(HIKE));
		r = await req('POST', POLLS, { action: 'update', poll: POLL, closes_at: new Date(Date.now() - 1000).toISOString() }, ADMIN);
		check('closing the poll: no more rankings or suggestions → 409', r.data.ok && (await view(pat)).open === false && (await vote(pat, [SKI], 1)).status === 409 && (await suggest(pat, 'Late idea')).status === 409);
		const log = (await req('GET', `/api/admin/sent-log?event=${EVENT}`, undefined, ADMIN)).data;
		check('the sent log has the poll totals, without names', /## Polls/.test(log) && /### What shall we do on Saturday\?/.test(log) && /- Football: 1 would join \(1 first choice\), 1 would stay at home/.test(log) && !/Quinn/.test(log), String(log).split('## Polls')[1]);
		const page = await req('GET', '/admin/rsvps/', undefined, ADMIN);
		check('the admin page has a polls section', /id="polls"/.test(page.data) && /id="poll-form"/.test(page.data));
		r = await req('DELETE', '/api/rsvp/manage', { t: pat.manage });
		ap = (await req('GET', `${POLLS}?event=${EVENT}`, undefined, ADMIN)).data.polls.find((p) => p.id === POLL);
		check('cancelling deletes the ballot; Pat\'s suggestions stay, without their name', r.data.ok && ap.tally.voters === 1 && ap.options.find((o) => o.id === PADDLE)?.suggested_by === null && ap.options.find((o) => o.id === PADDLE)?.suggested_by_name === null, JSON.stringify(ap.tally));
		await req('DELETE', '/api/rsvp/manage', { t: quinn.manage });
	}

	console.log('\nHost changes');
	{
		const sentBefore = (await mailsTo('dinnerhost@example.org')).length;
		check('the dinner host has been sent a list', sentBefore > 0);
		await req('POST', '/api/admin/sessions', { event: EVENT, dry_run: true, sessions: [{ id: DINNER, host_email: 'dinner2@example.org' }] }, ADMIN);
		check('a dry run of a host change emails nobody', (await mailsTo('dinnerhost@example.org')).length === sentBefore && !(await mailsTo('dinner2@example.org')).length);
		r = await req('POST', '/api/admin/sessions', { event: EVENT, sessions: [{ id: DINNER, host_email: 'dinner2@example.org' }] }, ADMIN);
		const gone = await last('dinnerhost@example.org');
		check('a replaced host is asked to delete the lists they were sent', r.data.ok && /You are no longer hosting: Dinner/.test(gone.subject) && /Please delete the lists we sent you/.test(gone.text_body), gone.subject);
		check('the new host gets the whole list', /Attendee list changed: Dinner/.test((await last('dinner2@example.org'))?.subject ?? ''));
		const n2 = (await mailsTo('dinner2@example.org')).length;
		await req('POST', '/api/admin/sessions', { event: EVENT, sessions: [{ id: AM.id, host_email: 'talkhost@example.org' }] }, ADMIN);
		await req('POST', '/api/admin/sessions', { event: EVENT, sessions: [{ id: DINNER, host_email: 'dinner2@example.org' }] }, ADMIN);
		check('saving the same host again sends no note', (await mailsTo('dinner2@example.org')).length === n2 && !(await mailsTo('dinner2@example.org')).some((m) => /no longer hosting/.test(m.subject)));
		r = await req('POST', '/api/admin/settings', { event: EVENT, host_list_minutes: 60 }, ADMIN);
		check('host lists can be limited to one an hour', r.data.ok && (await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN)).data.event.host_list_minutes === 60);
		const hostMails = async () => (await mailsTo('talkhost@example.org')).length;
		const h0 = await hostMails();
		await registerAndConfirm({ name: 'Vic', email: 'vic@example.org', attendance: 'remote' });
		await registerAndConfirm({ name: 'Wyn', email: 'wyn@example.org', attendance: 'remote' });
		check('changes within the hour are held back', (await hostMails()) === h0);
		await cron(Date.now() + 30 * 60_000);
		check('…still held half an hour on', (await hostMails()) === h0);
		await cron(Date.now() + 61 * 60_000);
		const gathered = await last('talkhost@example.org');
		check('…and gathered into one list once the hour has passed', (await hostMails()) === h0 + 1 && /\*\*Vic – remote\*\*/.test(gathered.text_body) && /\*\*Wyn – remote\*\*/.test(gathered.text_body), gathered.text_body.slice(0, 400));
		await registerAndConfirm({ name: 'Xan', email: 'xan@example.org', attendance: 'remote' });
		const h1 = await hostMails();
		await req('POST', '/api/admin/settings', { event: EVENT, host_list_minutes: 0 }, ADMIN);
		check('removing the gap sends a list held back under it at once', (await hostMails()) === h1 + 1 && /\*\*Xan – remote\*\*/.test((await last('talkhost@example.org')).text_body));
		await req('DELETE', '/api/rsvp/manage', { t: await manageOf('xan@example.org') });
		check('a negative gap is refused', (await req('POST', '/api/admin/settings', { event: EVENT, host_list_minutes: -1 }, ADMIN)).status === 400);
		await req('POST', '/api/admin/settings', { event: EVENT, host_list_minutes: 0 }, ADMIN);
		for (const who of ['vic@example.org', 'wyn@example.org']) await req('DELETE', '/api/rsvp/manage', { t: await manageOf(who) });
		await req('POST', '/api/admin/sessions', { event: EVENT, sessions: [{ id: AM.id, host_email: '' }] }, ADMIN);
	}

	console.log('\nEvent set-up');
	{
		const EV = '/api/admin/events';
		const before = (await outbox()).length;
		const start = new Date(Date.now() + 60 * 86400_000);
		const at = (h) => new Date(start.getTime() + h * 3600_000).toISOString();
		const base = { action: 'create', id: 'e2e-new-event', title: 'New Event, Leeds', timezone: 'Europe/London', starts_at: at(0), ends_at: at(6), deadline: at(-48), in_person_max: 12, page_path: '/events/e2e-new-event/', location: 'Leeds' };
		check('an event id must be a slug', (await req('POST', EV, { ...base, id: 'Bad Id!' }, ADMIN)).status === 400);
		check('an unknown time zone is refused', (await req('POST', EV, { ...base, timezone: 'Mars/Olympus' }, ADMIN)).status === 400);
		check('an event must end after it starts', (await req('POST', EV, { ...base, ends_at: at(-1) }, ADMIN)).status === 400);
		check('an event page with a backslash (read by browsers as another site) is refused', (await req('POST', EV, { ...base, page_path: '/\\evil.example/' }, ADMIN)).status === 400);
		r = await req('POST', EV, base, ADMIN);
		check('an organiser creates an event', r.data.ok && r.data.id === 'e2e-new-event', JSON.stringify(r.data));
		check('the same id twice → 409', (await req('POST', EV, base, ADMIN)).status === 409);
		check('the event list includes it', (await req('GET', EV, undefined, ADMIN)).data.events.some((x) => x.id === 'e2e-new-event'));
		r = await req('POST', EV, { action: 'add_session', event: 'e2e-new-event', label: 'Talks', kind: 'talk', mode: 'hybrid', starts_at: at(1), ends_at: at(3) }, ADMIN);
		const S1 = r.data.id;
		await req('POST', EV, { action: 'add_session', event: 'e2e-new-event', label: 'Dinner', kind: 'social', mode: 'in_person', optin: true, capacity: 8, starts_at: at(4), ends_at: at(6) }, ADMIN);
		let sum = (await req('GET', `/api/admin/summary?event=e2e-new-event`, undefined, ADMIN)).data;
		check('sessions added: a core talk and an opt-in dinner with a capacity', r.data.ok && sum.sessions.length === 2 && sum.sessions.find((x) => x.label === 'Dinner').optin === 1 && sum.sessions.find((x) => x.label === 'Dinner').capacity === 8, JSON.stringify(sum.sessions));
		r = await req('POST', EV, { action: 'update', event: 'e2e-new-event', title: 'New Event, York', remote_label: 'Online' }, ADMIN);
		sum = (await req('GET', `/api/admin/summary?event=e2e-new-event`, undefined, ADMIN)).data;
		check('editing an event changes only what was sent', r.data.ok && sum.event.title === 'New Event, York' && sum.event.remote_label === 'Online' && sum.event.in_person_max === 12 && sum.event.location === 'Leeds', JSON.stringify(sum.event));
		check('an unused session can be deleted', (await req('POST', EV, { action: 'delete_session', session: S1 }, ADMIN)).data.ok);
		check('a session people have booked cannot be deleted → 409', (await req('POST', EV, { action: 'delete_session', session: TOUR2 }, ADMIN)).status === 409);
		const newStart = new Date(Date.parse(seeded.event.starts_at) + 364 * 86400_000).toISOString();
		r = await req('POST', EV, { action: 'clone', event: EVENT, id: 'e2e-clone', title: 'Next Year', starts_at: newStart, page_path: '/events/e2e-clone/' }, ADMIN);
		const cl = (await req('GET', `/api/admin/summary?event=e2e-clone`, undefined, ADMIN)).data;
		const orig = (await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN)).data;
		const shift = Date.parse(newStart) - Date.parse(orig.event.starts_at);
		check('cloning copies the programme, moved to the new start, without hosts, links or people', r.data.ok && cl.event.title === 'Next Year' && cl.sessions.length === orig.sessions.length
			&& cl.sessions.every((x, i) => Date.parse(x.starts_at) - Date.parse(orig.sessions[i].starts_at) === shift && !x.host_email && !x.online_url) && cl.registrations.length === 0, JSON.stringify(cl.sessions.map((x) => x.starts_at)));
		const clInstr = (await req('GET', `/api/admin/instructions?event=e2e-clone`, undefined, ADMIN)).data.versions;
		const clPolls = (await req('GET', `/api/admin/polls?event=e2e-clone`, undefined, ADMIN)).data.polls;
		check('…with the latest joining instructions as version 1, and the polls\' options but no answers or suggestions', clInstr.length === 1 && clInstr[0].version === 1 && clPolls.length >= 1 && clPolls.every((p) => p.tally.voters === 0 && p.options.every((o) => o.status === 'active' && !o.suggested_by)), JSON.stringify(clPolls.map((p) => p.options.length)));
		check('an offset is not a time zone', (await req('POST', EV, { ...base, id: 'e2e-offset', timezone: '+01:00' }, ADMIN)).status === 400);
		check('registration must close before the event ends', (await req('POST', EV, { ...base, id: 'e2e-late', deadline: at(7) }, ADMIN)).status === 400);
		check('a session days away from the event is refused', (await req('POST', EV, { action: 'add_session', event: 'e2e-new-event', label: 'Lost', starts_at: at(24 * 10), ends_at: at(24 * 10 + 1) }, ADMIN)).status === 400);
		r = await req('POST', EV, { action: 'update', event: EVENT, ends_at: new Date(Date.now() - 31 * 86400_000).toISOString(), starts_at: new Date(Date.now() - 32 * 86400_000).toISOString(), deadline: new Date(Date.now() - 33 * 86400_000).toISOString() }, ADMIN);
		check('an event with registrations cannot have its end moved into the past (retention would delete everyone)', r.status === 409 && (await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN)).data.event.ends_at === seeded.event.ends_at, JSON.stringify(r.data));
		check('an opt-in session someone signed up for cannot be deleted', (await req('POST', EV, { action: 'delete_session', session: DINNER }, ADMIN)).status === 409);
		check('a core session in invitations already sent cannot be deleted', (await req('POST', EV, { action: 'delete_session', session: AM.id }, ADMIN)).status === 409);
		check('a clone needs its own page', (await req('POST', EV, { action: 'clone', event: EVENT, id: 'e2e-clone-2', starts_at: newStart, page_path: orig.event.page_path }, ADMIN)).status === 400
			&& (await req('POST', EV, { action: 'clone', event: EVENT, id: 'e2e-clone-2', starts_at: newStart }, ADMIN)).status === 400);
		// From November (GMT) to June (BST): every session keeps its London wall-clock time.
		const june = new Date(Date.parse(orig.event.starts_at) + 210 * 86400_000);
		const juneStart = new Date(Date.UTC(june.getUTCFullYear(), june.getUTCMonth(), june.getUTCDate(), +local(orig.event.starts_at).slice(9, 11) - 1, +local(orig.event.starts_at).slice(11, 13))).toISOString();
		r = await req('POST', EV, { action: 'clone', event: EVENT, id: 'e2e-clone-summer', starts_at: juneStart, page_path: '/events/e2e-clone-summer/' }, ADMIN);
		const summer = (await req('GET', `/api/admin/summary?event=e2e-clone-summer`, undefined, ADMIN)).data;
		check('a clone across a change to summer time keeps every session at the same local time', r.data.ok && summer.sessions.every((x, i) => local(x.starts_at).slice(9) === local(orig.sessions[i].starts_at).slice(9) && local(x.ends_at).slice(9) === local(orig.sessions[i].ends_at).slice(9)),
			JSON.stringify(summer.sessions?.map((x) => local(x.starts_at))));
		check('setting up events emailed nobody', (await outbox()).length === before);

		// A weekend event: one calendar entry per day, and the dates as a range in the emails.
		const sat = new Date(Date.now() + 40 * 86400_000);
		sat.setUTCDate(sat.getUTCDate() + ((6 - sat.getUTCDay() + 7) % 7));
		const on = (dayOffset, h) => new Date(Date.UTC(sat.getUTCFullYear(), sat.getUTCMonth(), sat.getUTCDate() + dayOffset, h)).toISOString();
		await req('POST', EV, { action: 'create', id: 'e2e-weekend', title: 'Weekend Camp', timezone: 'Europe/London', starts_at: on(0, 10), ends_at: on(1, 16), deadline: on(-2, 12), in_person_max: 10, page_path: '/events/e2e-weekend/', location: 'A field' }, ADMIN);
		await req('POST', EV, { action: 'add_session', event: 'e2e-weekend', label: 'Saturday walks', starts_at: on(0, 10), ends_at: on(0, 16) }, ADMIN);
		await req('POST', EV, { action: 'add_session', event: 'e2e-weekend', label: 'Sunday talks', starts_at: on(1, 10), ends_at: on(1, 16) }, ADMIN);
		await registerAndConfirm({ event: 'e2e-weekend', name: 'Yan', email: 'yan@example.org', attendance: 'in_person', tour_id: 'none' });
		const ym = await mailsTo('yan@example.org');
		const satName = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', timeZone: 'Europe/London' }).format(new Date(on(0, 10))).replace(',', '');
		check('a weekend event\'s emails give its dates as a range', ym.length === 2 && ym.every((m) => new RegExp(`on ${satName} to Sunday \\d+ \\w+ \\d{4}`).test(m.text_body)), ym.map((m) => m.text_body.slice(0, 200)).join(' | '));
		const days = ym[1].att.filter((a) => /METHOD:REQUEST/.test(a.content));
		const dt = (a, p) => (new RegExp(`${p};TZID=Europe/London:(\\d{8})T(\\d{6})`).exec(unfold(a.content)) || []).slice(1).join('T');
		check('…and one calendar entry per day, each within its own day', days.length === 2 && days.every((a) => dt(a, 'DTSTART').slice(0, 8) === dt(a, 'DTEND').slice(0, 8)) && dt(days[0], 'DTSTART').slice(0, 8) !== dt(days[1], 'DTSTART').slice(0, 8)
			&& days.some((a) => /SUMMARY:Weekend Camp: Saturday/.test(unfold(a.content))) && days.some((a) => /Sunday talks/.test(unfold(a.content).replace(/\\n/g, ' '))), days.map((a) => dt(a, 'DTSTART') + '-' + dt(a, 'DTEND')).join(', '));
		// An earlier day added: the Saturday entry keeps its place, Friday arrives as a new one.
		await req('POST', EV, { action: 'add_session', event: 'e2e-weekend', label: 'Friday welcome', starts_at: on(-1, 18), ends_at: on(-1, 20) }, ADMIN);
		await req('POST', '/api/admin/sessions', { event: 'e2e-weekend', sessions: [] }, ADMIN);
		let upd = await last('yan@example.org');
		const reqs = upd.att.filter((a) => /METHOD:REQUEST/.test(a.content));
		check('adding an earlier day sends just the new day; the existing entries stay put', reqs.length === 1 && /Friday welcome/.test(unfold(reqs[0].content).replace(/\\n/g, ' ')) && /SEQUENCE:0/.test(reqs[0].content) && !upd.att.some((a) => /METHOD:CANCEL/.test(a.content)), upd.att.map((a) => (/SUMMARY:[^\r\n]*/.exec(unfold(a.content)) || [''])[0]).join(' | '));
		// Sunday's session moved to Saturday afternoon: the Sunday entry is cancelled, Saturday's updated.
		const wk = (await req('GET', `/api/admin/summary?event=e2e-weekend`, undefined, ADMIN)).data.sessions;
		await req('POST', '/api/admin/sessions', { event: 'e2e-weekend', sessions: [{ id: wk.find((x) => x.label === 'Sunday talks').id, starts_at: on(0, 16), ends_at: on(0, 17) }] }, ADMIN);
		upd = await last('yan@example.org');
		check('folding a day into another cancels its entry and updates the other', upd.att.some((a) => /METHOD:CANCEL/.test(a.content) && /Sunday/.test(unfold(a.content))) && upd.att.some((a) => /METHOD:REQUEST/.test(a.content) && /SEQUENCE:1/.test(a.content) && /Saturday/.test(unfold(a.content))), upd.att.map((a) => (/METHOD:\w+/.exec(a.content) || [''])[0] + ' ' + (/SUMMARY:[^\r\n]*/.exec(unfold(a.content)) || [''])[0]).join(' | '));
		await req('DELETE', '/api/rsvp/manage', { t: await manageOf('yan@example.org') });
	}

	console.log('\nSending to a whole event, in pieces');
	{
		const EV = '/api/admin/events', B = 'e2e-bulk';
		const t0 = Date.now() + 50 * 86400_000;
		const at = (h) => new Date(t0 + h * 3600_000).toISOString();
		await req('POST', EV, { action: 'create', id: B, title: 'Bulk Day', timezone: 'Europe/London', starts_at: at(0), ends_at: at(8), deadline: at(-24), in_person_max: 50, page_path: '/events/e2e-bulk/', location: 'Hall' }, ADMIN);
		const S = (await req('POST', EV, { action: 'add_session', event: B, label: 'Talks', mode: 'hybrid', starts_at: at(1), ends_at: at(3) }, ADMIN)).data.id;
		await req('POST', '/api/admin/instructions', { event: B, subject: 'Bulk Day instructions', body_md: 'Hello all.' }, ADMIN);
		const people = Array.from({ length: 12 }, (_, i) => `bulk${i}@example.org`);
		for (const [i, email] of people.entries()) await registerAndConfirm({ event: B, name: `Bulk ${i}`, email, attendance: 'remote' });
		const count = async (re) => { let n = 0; for (const p of people) n += (await mailsTo(p)).filter((m) => re.test(m.subject)).length; return n; };
		r = await req('POST', '/api/admin/sessions', { event: B, sessions: [{ id: S, starts_at: at(2), ends_at: at(4) }] }, ADMIN);
		check('a session change for 12 people: 8 calendar updates now, 4 queued', r.data.calendar_updates === 12 && r.data.calendar_queued === 4 && (await count(/Calendar update/)) === 8, JSON.stringify(r.data));
		await cron();
		const updates = []; for (const p of people) updates.push((await mailsTo(p)).filter((m) => /Calendar update/.test(m.subject)).length);
		check('…and the cron sends the other 4, nobody twice', updates.every((n) => n === 1), JSON.stringify(updates));
		const V = (await req('GET', `/api/admin/instructions?event=${B}`, undefined, ADMIN)).data.versions[0].version;
		r = await req('POST', '/api/admin/messages', { event: B, subject: 'Bulk news', body_md: 'News.', audience: {}, marks_instructions_version: V }, ADMIN);
		let msg = r.data.message;
		check('a message with joining instructions to 12: the first 3 go at once, the rest are left sending', msg.status === 'sending' && (await count(/Bulk news/)) === 3, JSON.stringify(msg));
		await cron(); await cron(); await cron();
		msg = (await req('GET', `/api/admin/messages?event=${B}`, undefined, ADMIN)).data.messages.find((x) => x.id === msg.id);
		const each = []; for (const p of people) each.push((await mailsTo(p)).filter((m) => /Bulk news/.test(m.subject)).length);
		check('…the cron finishes it over three runs: everyone has exactly one copy, and the count is right', msg.status === 'sent' && msg.recipients_count === 12 && each.every((n) => n === 1), JSON.stringify([msg.status, msg.recipients_count, each]));
		r = await req('POST', '/api/admin/messages', { event: B, subject: 'Bulk stop', body_md: 'x', audience: {}, marks_instructions_version: V }, ADMIN);
		check('a message part sent can be cancelled', (await req('POST', '/api/admin/messages/cancel', { id: r.data.message.id }, ADMIN)).data.ok);
		await cron();
		msg = (await req('GET', `/api/admin/messages?event=${B}`, undefined, ADMIN)).data.messages.find((x) => x.id === r.data.message.id);
		check('…and no more of it goes out', msg.status === 'cancelled' && msg.recipients_count === 3 && (await count(/Bulk stop/)) === 3, JSON.stringify(msg));
		// One refused address does not stop a message: pieces get smaller until that person is set aside.
		const fakeReg = (rid, email) => sql(`INSERT INTO registrations (id, event_id, name, email, attendance, status, place, consent_at, created_at, updated_at, confirmed_at) VALUES ('${rid}', '${B}', 'Odd', '${email}', 'remote', 'confirmed', NULL, '${at(-100)}', '${at(-100)}', '${at(-100)}', '${at(-100)}')`);
		fakeReg('e2e-fail-send-reg', 'fail-send@example.org');
		r = await req('POST', '/api/admin/messages', { event: B, subject: 'Bulk refused', body_md: 'x', audience: {} }, ADMIN);
		check('a piece Resend refuses: nobody gets a copy yet, and the message carries on', r.data.message.status === 'sending' && /422/.test(r.data.message.error) && (await count(/Bulk refused/)) === 0, JSON.stringify(r.data.message).slice(0, 300));
		for (let i = 0; i < 12; i++) await cron(Date.now() + i * 1000);
		let refused = (await req('GET', `/api/admin/messages?event=${B}`, undefined, ADMIN)).data.messages.find((x) => x.subject === 'Bulk refused');
		const got = []; for (const p of people) got.push((await mailsTo(p)).filter((m) => /Bulk refused/.test(m.subject)).length);
		check('…in smaller pieces everyone else gets exactly one copy, and the refused address is left out', refused.status === 'sent' && refused.recipients_count === 12 && got.every((n) => n === 1), JSON.stringify([refused.status, refused.recipients_count, got]));
		sql(`DELETE FROM registrations WHERE id = 'e2e-fail-send-reg'`);
		// Refused for everyone it is tried on (a wrong sender, say): it stops with its error rather than setting everyone aside.
		for (const n of [1, 2]) sql(`INSERT INTO registrations (id, event_id, name, email, attendance, status, consent_at, created_at, updated_at, confirmed_at) VALUES ('e2e-refused-${n}', 'e2e-weekend', 'R', 'fail-send-${n}@example.org', 'remote', 'confirmed', '${at(-100)}', '${at(-100)}', '${at(-100)}', '${at(-100)}')`);
		r = await req('POST', '/api/admin/messages', { event: 'e2e-weekend', subject: 'All refused', body_md: 'x', audience: {} }, ADMIN);
		for (let i = 0; i < 4; i++) await cron(Date.now() + i * 1000);
		const allRefused = (await req('GET', `/api/admin/messages?event=e2e-weekend`, undefined, ADMIN)).data.messages.find((x) => x.subject === 'All refused');
		check('a message refused for everyone tried is marked failed with its error, not "sent"', allRefused.status === 'failed' && /refused for everyone tried/.test(allRefused.error), JSON.stringify([allRefused.status, allRefused.error]));
		sql(`DELETE FROM registrations WHERE id IN ('e2e-refused-1', 'e2e-refused-2')`);
		// A piece that went but was never recorded (the request cut off): the retry sends nobody a second copy.
		fakeReg('e2e-crash-reg', 'crash-after-send@example.org');
		r = await req('POST', '/api/admin/messages', { event: B, subject: 'Bulk crash', body_md: 'x', audience: {} }, ADMIN);
		await cron(Date.now() + 1000);
		let crash = (await req('GET', `/api/admin/messages?event=${B}`, undefined, ADMIN)).data.messages.find((x) => x.subject === 'Bulk crash');
		const crashCopies = (await outbox()).filter((m) => m.subject === 'Bulk crash').length;
		check('a piece cut off after sending is retried without a second copy to anyone', crash.status === 'sent' && crash.recipients_count === 13 && crashCopies === 13 && !crash.uncertain, JSON.stringify([crash.status, crash.recipients_count, crashCopies, crash.uncertain]));
		// …and when the retry would differ (the person answered a poll meanwhile, so their instructions copy changes), they
		// are marked as uncertain rather than sent a second copy.
		sql(`UPDATE registrations SET attendance = 'in_person', place = 'place' WHERE id = 'e2e-crash-reg'`);
		const BP = (await req('POST', '/api/admin/polls', { action: 'create', event: B, question: 'Lunch?', options: 'Soup\nSalad' }, ADMIN)).data.id;
		const BV = (await req('GET', `/api/admin/instructions?event=${B}`, undefined, ADMIN)).data.versions[0].version;
		r = await req('POST', '/api/admin/messages', { event: B, subject: 'Bulk differs', body_md: 'x', audience: { attendance: 'in_person' }, marks_instructions_version: BV }, ADMIN);
		sql(`INSERT INTO poll_ballots (poll_id, registration_id, ranking, bar, updated_at) VALUES ('${BP}', 'e2e-crash-reg', '[]', 0, '${at(-1)}')`);
		await cron(Date.now() + 1000);
		const differs = (await req('GET', `/api/admin/messages?event=${B}`, undefined, ADMIN)).data.messages.find((x) => x.subject === 'Bulk differs');
		check('a retry that would differ marks the person uncertain instead of sending again', differs.status === 'sent' && differs.uncertain >= 1 && (await outbox()).filter((m) => m.subject === 'Bulk differs' && m.to_addr === 'crash-after-send@example.org').length === 1, JSON.stringify([differs.status, differs.uncertain, differs.recipients_count]));
		sql(`DELETE FROM registrations WHERE id = 'e2e-crash-reg'`);
		await req('POST', '/api/admin/polls', { action: 'delete', poll: BP }, ADMIN);
		sql(`UPDATE registrations SET attendance = 'remote', place = NULL WHERE event_id = '${B}' AND attendance = 'in_person'`);
		// An outage: the message stops after five tries, others still go, and it can be resumed.
		fakeReg('e2e-fail-500-reg', 'fail-500@example.org');
		r = await req('POST', '/api/admin/messages', { event: B, subject: 'Bulk doomed', body_md: 'x', audience: {} }, ADMIN);
		r = await req('POST', '/api/admin/messages', { event: B, subject: 'Bulk later', body_md: 'x', audience: { attendance: 'in_person' }, scheduled_at: new Date(Date.now() + 120_000).toISOString() }, ADMIN);
		sql(`UPDATE registrations SET attendance = 'in_person', place = 'place' WHERE id = '${(await req('GET', `/api/admin/summary?event=${B}`, undefined, ADMIN)).data.registrations.find((x) => x.email === people[0]).id}'`);
		await cron(Date.now() + 180_000);
		check('…a message falling due meanwhile still goes out', (await count(/Bulk later/)) === 1);
		for (let i = 0; i < 6; i++) await cron(Date.now() + 240_000 + i * 1000);
		let doomed = (await req('GET', `/api/admin/messages?event=${B}`, undefined, ADMIN)).data.messages.find((x) => x.subject === 'Bulk doomed');
		check('…after five failed tries it is marked failed, and nobody had a copy', doomed.status === 'failed' && (await count(/Bulk doomed/)) === 0, JSON.stringify([doomed.status, doomed.attempts, doomed.error]));
		sql(`DELETE FROM registrations WHERE id = 'e2e-fail-500-reg'`);
		r = await req('POST', '/api/admin/messages', { event: B, action: 'resume', id: doomed.id }, ADMIN);
		doomed = (await req('GET', `/api/admin/messages?event=${B}`, undefined, ADMIN)).data.messages.find((x) => x.subject === 'Bulk doomed');
		const gotD = []; for (const p of people) gotD.push((await mailsTo(p)).filter((m) => /Bulk doomed/.test(m.subject)).length);
		check('…and resumed once the outage is over, everyone gets one copy', r.data.ok && doomed.status === 'sent' && gotD.every((n) => n === 1), JSON.stringify([doomed.status, gotD]));

		for (const p of people) await req('DELETE', '/api/rsvp/manage', { t: await manageOf(p) });
	}

	console.log('\nPlaces held for unconfirmed registrations');
	{
		const EV = '/api/admin/events', H = 'e2e-holds';
		const t0 = Date.now() + 40 * 86400_000;
		const at = (h) => new Date(t0 + h * 3600_000).toISOString();
		await req('POST', EV, { action: 'create', id: H, title: 'Small Room', timezone: 'Europe/London', starts_at: at(0), ends_at: at(4), deadline: at(-24), in_person_max: 8, page_path: '/events/e2e-holds/', location: 'Room' }, ADMIN);
		await req('POST', EV, { action: 'add_session', event: H, label: 'Talk', mode: 'in_person', starts_at: at(1), ends_at: at(2) }, ADMIN);
		const who = Array.from({ length: 9 }, (_, i) => `hold${i}@example.org`);
		const confirmOf = async (e) => tokenFrom((await mailsTo(e))[0].text_body, 'confirm');
		for (const e of who.slice(0, 5)) await register({ event: H, name: 'Held', email: e });
		const status = async () => (await req('GET', `/api/admin/summary?event=${H}`, undefined, ADMIN)).data;
		check('five unconfirmed registrations (the limit for 8 places) each hold a place', (await mailsTo(who[0]))[0].text_body.includes('An in-person place is held for you'));
		await register({ event: H, name: 'Sixth', email: who[5] });
		const sixth = (await mailsTo(who[5]))[0];
		check('the sixth holds nothing yet: told places are filling up and one is theirs if free when they confirm', /places are filling up/.test(sixth.text_body) && /take a place if one is still free/.test(sixth.text_body) && !/held for you/.test(sixth.text_body), sixth.text_body.slice(0, 900));
		r = await req('POST', '/api/rsvp/confirm', { t: await confirmOf(who[5]) });
		check('…and on confirming gets a place, as three were free', r.data.registration?.place === 'place', JSON.stringify(r.data));
		for (const e of who.slice(6)) await register({ event: H, name: 'Later', email: e });
		for (const e of who.slice(6, 8)) await req('POST', '/api/rsvp/confirm', { t: await confirmOf(e) });
		r = await req('POST', '/api/rsvp/confirm', { t: await confirmOf(who[8]) });
		const sum = await status();
		check('the first to confirm take the free places; once the five holds and three confirmed fill the room, the next joins the waiting list', r.data.registration?.place === 'waitlist' && sum.capacity.inPerson.confirmed === 3 && sum.capacity.inPerson.held === 8, JSON.stringify([r.data, sum.capacity.inPerson]));
		for (const e of who.slice(0, 5)) await req('POST', '/api/rsvp/decline', { t: await confirmOf(e) });

		// One place left and two people, neither holding it, confirming at the same moment: exactly one gets it.
		const H2 = 'e2e-holds-race';
		await req('POST', EV, { action: 'create', id: H2, title: 'Smaller Room', timezone: 'Europe/London', starts_at: at(24), ends_at: at(28), deadline: at(0), in_person_max: 6, page_path: '/events/e2e-holds-race/', location: 'Room' }, ADMIN);
		await req('POST', EV, { action: 'add_session', event: H2, label: 'Talk', mode: 'in_person', starts_at: at(25), ends_at: at(26) }, ADMIN);
		const race = Array.from({ length: 7 }, (_, i) => `race${i}@example.org`);
		for (const e of race) await register({ event: H2, name: 'Racer', email: e });
		const [x, y] = await Promise.all(race.slice(5).map(async (e) => (await req('POST', '/api/rsvp/confirm', { t: await confirmOf(e) })).data.registration?.place));
		check('two people confirming into the last place at once: one gets it, the other the waiting list', [x, y].sort().join() === 'place,waitlist', JSON.stringify([x, y]));
		for (const e of race.slice(0, 5)) await req('POST', '/api/rsvp/decline', { t: await confirmOf(e) });
	}

	console.log('\nAdmin removal');
	const gina = 'gina@example.org', hal = 'hal@example.org';
	await registerAndConfirm({ name: 'Gina', email: gina, attendance: 'remote' });
	let sumR = await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN);
	r = await req('DELETE', '/api/admin/registration', { id: sumR.data.registrations.find((x) => x.email === gina).id }, ADMIN);
	m = await last(gina);
	check('removing a confirmed registration tells them, and cancels their calendar entries', r.data.ok && /Registration cancelled/.test(m.subject) && /cancelled by the organisers/.test(m.text_body) && m.att.length > 0 && m.att.every((x) => /METHOD:CANCEL/.test(x.content)), m.subject + ' | ' + m.text_body.slice(0, 200));
	await register({ name: 'Hal', email: hal, attendance: 'remote' });
	sumR = await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN);
	n = (await mailsTo(hal)).length;
	r = await req('DELETE', '/api/admin/registration', { id: sumR.data.registrations.find((x) => x.email === hal).id }, ADMIN);
	check('removing an unconfirmed one (spam, typos) sends nothing', r.data.ok && (await mailsTo(hal)).length === n);

	r = await req('POST', '/api/admin/settings', { event: EVENT, deadline: new Date(Date.now() - 60_000).toISOString() }, ADMIN);
	check('registration deadline moved into the past', r.data.ok);
	check('new registration refused after the deadline', (await register({ email: 'late@example.org' })).status === 409);
	check('status shows registration closed', (await req('GET', `/api/rsvp/status?event=${EVENT}`)).data.event.open === false);
	r = await req('POST', '/api/rsvp/manage', { t: aliceManage, name: 'Alice A', attendance: 'in_person', tour_id: 'none', share_contact: true });
	check('after the registration deadline, leaving an open tour still works', r.data.ok && r.data.registration.tour_id === null, JSON.stringify(r.data));
	r = await req('POST', '/api/rsvp/manage', { t: aliceManage, name: 'Alice A', attendance: 'in_person', tour_id: TOUR2, share_contact: true });
	check('…and so does rebooking the 11:15 tour before it starts, if a place remains', r.data.ok && r.data.registration.tour_id === TOUR2 && r.data.registration.tour_place === 'place', JSON.stringify(r.data));

	console.log('\nCancel');
	n = (await mailsTo('host2@example.org')).length;
	r = await req('DELETE', '/api/rsvp/manage', { t: c.manage });
	check('Carol cancels', r.data.ok);
	m = await last(carol);
	check('cancellation confirmation cancels both calendar entries', /Registration cancelled/.test(m.subject) && m.att.length === 2 && m.att.every((a) => /METHOD:CANCEL/.test(a.content) && /STATUS:CANCELLED/.test(a.content)) && /SEQUENCE:2/.test(m.att.find((a) => a.content.includes(AM.id))?.content ?? ''));
	check('organiser notified of the cancellation', (await mailsTo(NOTIFY)).some((x) => /Cancellation/.test(x.subject) && /Carol/.test(x.text_body)));
	r = await req('POST', '/api/rsvp/manage', { t: bobManage, name: 'Bob', attendance: 'remote', tour_id: 'none' });
	check('switching to remote drops a tour whose booking has closed', r.data.ok && r.data.registration.attendance === 'remote' && r.data.registration.tour_id === null, JSON.stringify(r.data));
	m = await last(bob);
	check('switching to remote says so, releases the in-person place, and sends the remote instructions', /You have changed to joining remotely/.test(m.text_body) && /in-person place has been deleted/.test(m.text_body) && /Joining instructions/.test(m.subject), m.subject);
	check('online calendar entries drop the place from the event name', m.att.some((a) => /METHOD:REQUEST/.test(a.content) && /SUMMARY:[^\r\n]*\(online\)/.test(a.content) && !/SUMMARY:[^\r\n]*, London/.test(a.content)) && m.att.some((a) => /METHOD:CANCEL/.test(a.content)), m.att.map((a) => (/SUMMARY:[^\r\n]*/.exec(a.content) || [''])[0]).join(' | '));
	r = await req('DELETE', '/api/rsvp/manage', { t: aliceManage });
	check('Alice cancels; 11:15 host sees her struck through', r.data.ok && /~~Alice A – booked~~/.test((await last('host2@example.org')).text_body));
	check('Alice\'s row is gone', (await req('GET', `/api/rsvp/manage?t=${encodeURIComponent(aliceManage)}`)).status === 404);

	console.log('\nRetention');
	await cron(Date.parse(seeded.event.ends_at) + 29 * 24 * 3600_000);
	check('registrations kept until 30 days after the event', (await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN)).data.registrations.length > 0);
	await cron(Date.parse(seeded.event.ends_at) + 31 * 24 * 3600_000);
	check('all registrations deleted 30 days after the event', (await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN)).data.registrations.length === 0);
	check('messages deleted 30 days after the event', (await req('GET', `/api/admin/messages?event=${EVENT}`, undefined, ADMIN)).data.messages.length === 0);
	check('polls deleted 30 days after the event', (await req('GET', `/api/admin/polls?event=${EVENT}`, undefined, ADMIN)).data.polls.length === 0);
} catch (e) {
	failures++;
	console.error(e);
} finally {
	if (server) {
		try { process.kill(-server.pid, 'SIGTERM'); } catch {}
		await new Promise((r) => setTimeout(r, 1500));
		try { process.kill(-server.pid, 'SIGKILL'); } catch {}
	}
	restoreDevVars();
}
console.log(`\n${passes} passed, ${failures} failed`);
if (failures) {
	console.log('\n--- server log (tail) ---\n' + serverLog.slice(-4000));
	process.exit(1);
}

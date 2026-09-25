#!/usr/bin/env node
// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
/**
 * End-to-end test of Events&I against a local D1 database with `wrangler pages dev ./dist`.
 * Emails go to the dev outbox (DEV_MODE), Turnstile uses Cloudflare's always-pass test secret, and the admin
 * tests mint their own Access JWTs with a throwaway RSA key.
 *
 * Configure with environment variables (defaults suit the amybo.org site):
 *   E2E_DB      D1 database name in wrangler.toml          (amybo-rsvp)
 *   E2E_SEED    SQL file that creates the event under test  (seed/2026-11-13-london.sql)
 *   E2E_EVENT   event id                                    (2026-11-13-london)
 *   E2E_NOTIFY  NOTIFY_EMAIL configured in wrangler.toml    (hello@amybo.org)
 *   E2E_PAGES   comma-separated site pages that must load   (/,/privacy/,/events/confirm/,/events/manage/)
 * The seed must define a 'tour' choice group with at least two sessions, and hybrid core sessions.
 */
import { spawn, execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign, randomUUID, randomBytes } from 'node:crypto';
import { existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';

const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}`;
const PERSIST = '.wrangler/e2e-state';
const DB = process.env.E2E_DB || 'amybo-rsvp';
const SEED = process.env.E2E_SEED || 'seed/2026-11-13-london.sql';
const EVENT = process.env.E2E_EVENT || '2026-11-13-london';
const NOTIFY = process.env.E2E_NOTIFY || 'hello@amybo.org';
const PAGES = (process.env.E2E_PAGES || '/,/privacy/,/events/confirm/,/events/manage/').split(',').filter(Boolean);

if (!existsSync('dist/index.html')) {
	console.error('Run `npm run build:test` first.');
	process.exit(1);
}

// ---- keys and .dev.vars ----
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'e2e', alg: 'RS256' };
const devVarsBackup = existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8') : null;
writeFileSync('.dev.vars', [
	'DEV_MODE=true',
	`SITE_URL=${BASE}`,
	`TOKEN_SECRET=${randomBytes(32).toString('hex')}`,
	'TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA',
	'ACCESS_AUD=e2e-aud',
	'ACCESS_TEAM_DOMAIN=e2e.cloudflareaccess.com',
	`ACCESS_JWKS_JSON=${JSON.stringify({ keys: [jwk] })}`,
	'',
].join('\n'));

const b64u = (b) => Buffer.from(b).toString('base64url');
function jwt({ key = privateKey, kid = 'e2e', aud = 'e2e-aud', exp = Math.floor(Date.now() / 1000) + 600, email = 'admin@example.org' } = {}) {
	const h = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
	const p = b64u(JSON.stringify({ aud: [aud], email, exp, iat: Math.floor(Date.now() / 1000), iss: 'https://e2e.cloudflareaccess.com' }));
	return `${h}.${p}.${b64u(sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key))}`;
}
const ADMIN = { 'cf-access-jwt-assertion': jwt() };

// ---- fresh local database ----
rmSync(PERSIST, { recursive: true, force: true });
const wr = (args) => execFileSync('npx', ['wrangler', ...args], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, CI: '1' } });
wr(['d1', 'migrations', 'apply', DB, '--local', '--persist-to', PERSIST]);
wr(['d1', 'execute', DB, '--local', '--persist-to', PERSIST, '--file', SEED]);

// ---- server ----
const server = spawn('npx', ['wrangler', 'pages', 'dev', './dist', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST], {
	stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' }, detached: true,
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

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
	return { confirm: t, manage: tokenFrom(m.text_body, 'manage'), result: r.data };
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
	await waitReady();
	console.log('\nPublic pages');
	for (const p of PAGES) {
		const r = await fetch(BASE + p);
		check(`GET ${p} → 200`, r.status === 200, String(r.status));
	}

	console.log('\nAdmin protection (Cloudflare Access JWT)');
	for (const p of ['/admin/rsvps/', `/api/admin/summary?event=${EVENT}`, `/api/admin/export?format=csv&event=${EVENT}`, `/api/admin/sent-log?event=${EVENT}`]) {
		check(`${p} without JWT → 401`, (await req('GET', p)).status === 401);
		check(`${p} with JWT signed by wrong key → 401`, (await req('GET', p, undefined, { 'cf-access-jwt-assertion': jwt({ key: otherKey }) })).status === 401);
		check(`${p} with wrong audience → 401`, (await req('GET', p, undefined, { 'cf-access-jwt-assertion': jwt({ aud: 'someone-else' }) })).status === 401);
		check(`${p} with expired JWT → 401`, (await req('GET', p, undefined, { 'cf-access-jwt-assertion': jwt({ exp: Math.floor(Date.now() / 1000) - 3600 }) })).status === 401);
		check(`${p} with garbage JWT → 401`, (await req('GET', p, undefined, { 'cf-access-jwt-assertion': 'a.b.c' })).status === 401);
		check(`${p} with valid JWT → 200`, (await req('GET', p, undefined, ADMIN)).status === 200);
	}
	const page = await req('GET', '/admin/rsvps/', undefined, ADMIN);
	check('admin page is HTML with the sessions editor', typeof page.data === 'string' && /id="sessions-form"/.test(page.data) && /Events&amp;I/.test(page.data));
	check('admin POST without JWT → 401', (await req('POST', '/api/admin/settings', { event: EVENT, in_person_max: 999 })).status === 401);
	check('admin POST from another origin → 403', (await req('POST', '/api/admin/settings', { event: EVENT }, { ...ADMIN, origin: 'https://evil.example' })).status === 403);

	console.log('\nSeed and settings');
	let r = await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN);
	const seeded = r.data;
	const tours = seeded.tours;
	const TOUR1 = tours[0].id, TOUR2 = tours[1].id;
	const core = seeded.sessions.filter((s) => !s.choice_group && s.kind !== 'social');
	const AM = core[0], PM = core[1];
	check('seeded in-person maximum and tour capacities', seeded.event.in_person_max === 20 && tours.every((t) => t.capacity === 10), JSON.stringify({ max: seeded.event.in_person_max, tours: tours.map((t) => t.capacity) }));
	check('summary without an event id falls back to the latest event', (await req('GET', '/api/admin/summary', undefined, ADMIN)).data.event?.id === EVENT);
	r = await req('POST', '/api/admin/settings', { event: EVENT, in_person_max: 1 }, ADMIN);
	check('in-person maximum set to 1', r.data.ok, JSON.stringify(r.data));
	r = await req('POST', '/api/admin/sessions', { event: EVENT, sessions: [
		{ id: TOUR1, capacity: 1, host_name: 'Tour Host', host_email: 'host1@example.org' },
		{ id: TOUR2, capacity: 1, host_email: 'host2@example.org' },
	] }, ADMIN);
	check('tour capacities 1 and hosts set, nobody emailed yet', r.data.ok && r.data.calendar_updates === 0 && !(await mailsTo('host1@example.org')).length, JSON.stringify(r.data));
	check('invalid online link refused', (await req('POST', '/api/admin/sessions', { event: EVENT, sessions: [{ id: AM.id, online_url: 'http://insecure.example' }] }, ADMIN)).status === 400);
	r = await req('GET', `/api/rsvp/status?event=${EVENT}`);
	check('status shows open with places and open tours', r.data.ok && r.data.event.open && r.data.in_person_available === true && r.data.tours.every((t) => t.open));

	console.log('\nValidation and spam protection');
	const before = (await outbox()).length;
	check('missing consent → 400', (await register({ consent: false })).status === 400);
	check('bad email → 400', (await register({ email: 'not-an-email' })).status === 400);
	check('missing Turnstile token → 403', (await register({ 'cf-turnstile-response': '' })).status === 403);
	r = await register({ website: 'http://spam.example', email: 'bot@example.org' });
	check('honeypot → fake success', r.status === 200 && r.data.ok);
	check('honeypot and rejects send no email', (await outbox()).length === before);
	check('non-JSON body → 415', (await fetch(`${BASE}/api/rsvp/register`, { method: 'POST', body: 'name=x' })).status === 415);

	console.log('\nConfirm → place, joining instructions and calendar invitation');
	const alice = 'alice@example.org', bob = 'bob@example.org', carol = 'carol@example.org';
	r = await register({ name: 'Alice', email: alice, tour_id: TOUR1, affiliation: 'Lab A', needs: 'Vegan', share_contact: true, extra_answer: 'A walk on Saturday' });
	check('Alice registers', r.status === 200 && r.data.ok, JSON.stringify(r.data));
	let mails = await mailsTo(alice);
	check('Alice gets one confirm-your-email message', mails.length === 1 && /Complete your registration/.test(mails[0].subject));
	check('confirm email states until when the place is held', /We are holding your place until \w+day, \d+ \w+ 2026/.test(mails[0].text_body), mails[0].text_body.slice(0, 400));
	check('confirm email says registration is not complete, and carries the Events&I beta footer', /NOT COMPLETE YET/.test(mails[0].text_body) && /Complete registration/.test(mails[0].html_body) && /Events&amp;I<\/a> \(beta\)/.test(mails[0].html_body) && /Events&I \(beta\)/.test(mails[0].text_body));
	const aliceConfirm = tokenFrom(mails[0].text_body, 'confirm');
	const aliceManage = tokenFrom(mails[0].text_body, 'manage');
	check('confirm and manage links present', !!aliceConfirm && !!aliceManage);
	r = await register({ name: 'Bob', email: bob, tour_id: TOUR1 });
	const bobMail = (await mailsTo(bob))[0];
	const bobConfirm = tokenFrom(bobMail.text_body, 'confirm');
	const bobManage = tokenFrom(bobMail.text_body, 'manage');
	check('confirm via GET does nothing (link scanners)', [404, 405].includes((await req('GET', `/api/rsvp/confirm?t=${encodeURIComponent(aliceConfirm)}`)).status));
	check('tampered confirm token → 404', (await req('POST', '/api/rsvp/confirm', { t: aliceConfirm.slice(0, -2) + 'xx' })).status === 404);
	check('manage token cannot confirm', (await req('POST', '/api/rsvp/confirm', { t: aliceManage })).status === 404);
	r = await req('POST', '/api/rsvp/confirm', { t: aliceConfirm });
	check('Alice confirms → place + tour place', r.data.ok && r.data.registration.place === 'place' && r.data.registration.tour_place === 'place', JSON.stringify(r.data));
	let m = await last(alice);
	check('Alice receives joining instructions v1', /Joining instructions/.test(m.subject) && /You have an in-person place/.test(m.text_body));
	check('…with exactly one calendar invitation', m.att.length === 1 && m.att[0].filename === 'invite.ics' && /method=REQUEST/.test(m.att[0].content_type), JSON.stringify(m.att.map((a) => a.filename)));
	let ics = m.att[0].content;
	check('invitation: METHOD:REQUEST, SEQUENCE:0, Europe/London VTIMEZONE', /METHOD:REQUEST/.test(ics) && /SEQUENCE:0/.test(ics) && /TZID:Europe\/London/.test(ics));
	check('invitation starts at her 10:30 tour and ends when the talks end', icsProp(ics, 'DTSTART').at(-1)?.endsWith('20261113T103000') && icsProp(ics, 'DTEND').at(-1)?.endsWith('20261113T163000'), icsProp(ics, 'DTSTART').concat(icsProp(ics, 'DTEND')).join(' '));
	check('in-person reminders: week, day, travel + 15 min, 15 min', ['-P7D', '-P1D', '-PT75M', '-PT15M'].every((t) => ics.includes(`TRIGGER:${t}`)));
	check('organiser and attendee set, lines folded to 75 octets', /ORGANIZER;CN="AMYBO":mailto:hello@amybo\.org/.test(unfold(ics)) && /ATTENDEE;[^\r\n]*mailto:alice@example\.org/.test(unfold(ics)) && ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
	check('email has add-to-calendar links for Google, Outlook, Office 365 and Yahoo plus .ics', /calendar\.google\.com\/calendar\/render/.test(m.html_body) && /outlook\.live\.com/.test(m.html_body) && /outlook\.office\.com/.test(m.html_body) && /calendar\.yahoo\.com/.test(m.html_body) && /\/api\/rsvp\/calendar\?t=/.test(m.html_body));
	let host1 = await mailsTo('host1@example.org');
	check('tour host gets the list with Alice in bold and her shared email', host1.length === 1 && /<strong>Alice \(Lab A\) – booked – <a href="mailto:alice@example\.org"/.test(host1[0].html_body) && /\*\*Alice \(Lab A\) – booked – alice@example\.org\*\*/.test(host1[0].text_body), host1[0]?.text_body);
	r = await req('POST', '/api/rsvp/confirm', { t: aliceConfirm });
	check('confirming twice is idempotent and sends nothing more', r.data.ok && r.data.already === true && (await mailsTo(alice)).length === 2);

	r = await req('POST', '/api/rsvp/confirm', { t: bobConfirm });
	check('Bob confirms → in-person waiting list and tour waiting list', r.data.registration.place === 'waitlist' && r.data.registration.tour_place === 'waitlist', JSON.stringify(r.data));
	check('Bob gets no joining instructions or calendar while waiting', (await mailsTo(bob)).length === 1);
	let hello = await mailsTo(NOTIFY);
	check('organiser told about the new waiting-list registration with totals', hello.some((x) => /waiting-list registration/.test(x.subject) && /In person: 1 confirmed of 1 places, 1 on the waiting list/.test(x.text_body)), hello.map((x) => x.subject).join(' | '));
	host1 = await mailsTo('host1@example.org');
	check('tour host list updated: Bob added in bold as waiting list, no email shown', host1.length === 2 && /\*\*Bob – waiting list\*\*/.test(host1[1].text_body) && !/bob@example/.test(host1[1].text_body) && /1\. Alice/.test(host1[1].text_body), host1.at(-1)?.text_body);

	console.log('\nRegistering again with a confirmed address');
	r = await register({ name: 'Alice again', email: alice });
	check('duplicate returns the same generic success', r.status === 200 && r.data.ok);
	m = await last(alice);
	check('reminder confirms name, event, email and when registered, then the joining instructions', (await mailsTo(alice)).length === 3 && /already registered/.test(m.text_body) && /Name: Alice\. Email: alice@example\.org\. Registered: /.test(m.text_body) && /Draft schedule/.test(m.text_body));
	check('reminder re-attaches the current calendar invitation (same sequence)', m.att.length === 1 && /SEQUENCE:0/.test(m.att[0].content));
	await register({ name: 'Bob', email: bob });
	m = await last(bob);
	check('waitlisted duplicate gets a reminder of their status, no instructions or calendar', (await mailsTo(bob)).length === 2 && /already registered/.test(m.text_body) && /waiting list/.test(m.text_body) && !/Draft schedule/.test(m.text_body) && m.att.length === 0);

	console.log('\nSelf-service changes and calendar updates');
	r = await req('GET', `/api/rsvp/manage?t=${encodeURIComponent(aliceManage)}`);
	check('manage view with calendar download', r.data.ok && r.data.registration.name === 'Alice' && r.data.registration.share_contact === true && r.data.calendar.length === 1 && r.data.calendar[0].key === 'day');
	check('confirm token cannot manage', (await req('GET', `/api/rsvp/manage?t=${encodeURIComponent(aliceConfirm)}`)).status === 404);
	const dl = await fetch(r.data.calendar[0].url);
	const dlText = await dl.text();
	check('.ics download works (METHOD:PUBLISH, text/calendar)', dl.status === 200 && /text\/calendar/.test(dl.headers.get('content-type')) && /METHOD:PUBLISH/.test(dlText) && /BEGIN:VALARM/.test(dlText));
	let n = (await mailsTo(alice)).length;
	r = await req('POST', '/api/rsvp/manage', { t: aliceManage, name: 'Alice', attendance: 'in_person', tour_id: TOUR1, affiliation: 'Lab A', needs: 'Vegan, step-free access', share_contact: true });
	check('changing only dietary needs sends no calendar email', r.data.ok && (await mailsTo(alice)).length === n);
	r = await req('POST', '/api/rsvp/manage', { t: aliceManage, name: 'Alice A', attendance: 'in_person', tour_id: TOUR2, affiliation: 'Lab A', needs: 'Vegan, step-free access', share_contact: true });
	check('Alice moves to the free 11:15 tour', r.data.ok && r.data.registration.tour_id === TOUR2 && r.data.registration.tour_place === 'place', JSON.stringify(r.data));
	m = await last(alice);
	check('…and gets a calendar update: SEQUENCE:1, new start time', /Calendar update/.test(m.subject) && m.att.length === 1 && /SEQUENCE:1/.test(m.att[0].content) && icsProp(m.att[0].content, 'DTSTART').at(-1)?.endsWith('20261113T111500'), m.subject + ' ' + (m.att[0] ? icsProp(m.att[0].content, 'DTSTART') : ''));
	host1 = await mailsTo('host1@example.org');
	check('10:30 host sees Alice struck through (removed)', /~~Alice \(Lab A\) – booked~~/.test(host1.at(-1).text_body) && /<s>Alice \(Lab A\) – booked<\/s>/.test(host1.at(-1).html_body), host1.at(-1)?.text_body);
	check('11:15 host gets a list with Alice A in bold', /\*\*Alice A \(Lab A\) – booked – alice@example\.org\*\*/.test((await last('host2@example.org'))?.text_body ?? ''));
	r = await req('GET', `/api/rsvp/status?event=${EVENT}`);
	check('freed 10:30 tour place is not offered while someone waits for it', r.data.tours.find((t) => t.id === TOUR1).available === false);

	console.log('\nRemote attendee: one calendar entry per online session');
	const c = await registerAndConfirm({ name: 'Carol "CJ" Jones, PhD', email: carol, attendance: 'remote' });
	m = await last(carol);
	const remoteIcs = m.att.map((a) => a.content);
	check('two invitations, one per online session', m.att.length === 2 && m.att[0].filename === 'invite-1.ics', JSON.stringify(m.att.map((a) => a.filename)));
	check('online reminders: day, hour, 10 minutes', remoteIcs.every((x) => ['-P1D', '-PT1H', '-PT10M'].every((t) => x.includes(`TRIGGER:${t}`)) && !x.includes('TRIGGER:-P7D')));
	check('sessions at 12:00 and 14:00 with a link-to-follow location', icsProp(remoteIcs[0], 'DTSTART').at(-1)?.endsWith('T120000') && icsProp(remoteIcs[1], 'DTSTART').at(-1)?.endsWith('T140000') && /LOCATION:Online – the link will follow/.test(unfold(remoteIcs[0])));
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
	r = await req('POST', '/api/admin/sessions', { event: EVENT, dry_run: true, sessions: [{ id: PM.id, ends_at: '2026-11-13T17:00:00Z' }] }, ADMIN);
	check('dry run: moving the afternoon end affects in-person and remote (not waitlisted Bob)', r.data.calendar_updates === 2, JSON.stringify(r.data));
	r = await req('POST', '/api/admin/sessions', { event: EVENT, sessions: [{ id: PM.id, ends_at: '2026-11-13T17:00:00Z' }] }, ADMIN);
	check('both updated; Alice now ends 17:00 with SEQUENCE:3', r.data.calendar_updates === 2 && icsProp((await last(alice)).att[0].content, 'DTEND')[0]?.endsWith('T170000') && /SEQUENCE:3/.test((await last(alice)).att[0].content));
	check('saving unchanged sessions sends nothing', (await req('POST', '/api/admin/sessions', { event: EVENT, sessions: [{ id: PM.id, ends_at: '2026-11-13T17:00:00Z' }] }, ADMIN)).data.calendar_updates === 0);

	console.log('\nAdmin: promote, instructions versions, messages');
	r = await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN);
	check('summary counts, no calendar internals exposed', r.data.capacity.inPerson.confirmed === 1 && r.data.capacity.inPerson.waiting === 1 && !('calendar_state' in r.data.registrations[0]), JSON.stringify(r.data.capacity));
	const bobId = r.data.registrations.find((x) => x.email === bob).id;
	r = await req('POST', '/api/admin/promote', { id: bobId, what: 'tour' }, ADMIN);
	check('promote Bob to the 10:30 tour (still waiting for a place → no email yet)', r.data.ok && (await mailsTo(bob)).length === 2);
	r = await req('POST', '/api/admin/promote', { id: bobId, what: 'event' }, ADMIN);
	m = await last(bob);
	check('promote Bob to a place → joining instructions with an invitation starting 10:30', r.data.ok && /You have an in-person place/.test(m.text_body) && /booked on the 10:30 lab tour/.test(m.text_body) && m.att.length === 1 && icsProp(m.att[0].content, 'DTSTART').at(-1)?.endsWith('T103000'));
	check('10:30 host list now shows Bob booked (changed, in bold)', /\*\*Bob – booked(, but waiting for an in-person place)?\*\*/.test((await last('host1@example.org')).text_body));
	check('promoting again is refused', (await req('POST', '/api/admin/promote', { id: bobId, what: 'event' }, ADMIN)).status === 400);

	r = await req('POST', '/api/admin/instructions', { event: EVENT, subject: 'Joining instructions v2', body_md: 'Room **G01**, sign in at reception.\n\n- Bring ID', change_note: 'Added room' }, ADMIN);
	check('new instructions version 2', r.data.ok && r.data.version === 2);
	n = (await outbox()).length;
	check('saving a version emails nobody', (await outbox()).length === n);
	r = await req('POST', '/api/admin/messages', { event: EVENT, dry_run: true, audience: { below_version: 2 } }, ADMIN);
	check('dry run: 3 people on an older version', r.data.count === 3, JSON.stringify(r.data));
	r = await req('POST', '/api/admin/messages', { event: EVENT, subject: 'Room confirmed', body_md: "What's changed: we are in room **G01**.", audience: { below_version: 2 }, marks_instructions_version: 2 }, ADMIN);
	check('send now', r.data.ok && r.data.message.status === 'sent' && r.data.message.recipients_count === 3, JSON.stringify(r.data));
	m = await last(alice);
	check('each recipient gets a personal copy with their manage link and the beta footer', /Hello Alice A/.test(m.text_body) && /<strong>G01<\/strong>/.test(m.html_body) && m.text_body.includes('/events/manage/?t=') && /Events&I \(beta\)/.test(m.text_body));
	check('recipients now recorded as having version 2', (await req('POST', '/api/admin/messages', { event: EVENT, dry_run: true, audience: { below_version: 2 } }, ADMIN)).data.count === 0);
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
	check('markdown sent log includes versions, sessions and messages', typeof r.data === 'string' && /Version 2/.test(r.data) && /Room confirmed/.test(r.data) && /Version 2: 3 confirmed/.test(r.data) && /## Sessions/.test(r.data) && /online link set/.test(r.data));

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
	const created = Date.now();
	await cron(created + 23 * 3600_000);
	check('before half the hold: no warning', !(await mailsTo(NOTIFY)).some((x) => /Eve/.test(x.text_body)));
	await cron(created + 25 * 3600_000);
	check('after half the hold: organiser warned once', (await mailsTo(NOTIFY)).filter((x) => /half way/.test(x.subject) && /Eve/.test(x.text_body)).length === 1);
	await cron(created + 26 * 3600_000);
	check('warning not repeated', (await mailsTo(NOTIFY)).filter((x) => /half way/.test(x.subject) && /Eve/.test(x.text_body)).length === 1);
	await cron(created + 49 * 3600_000);
	const eveManage = tokenFrom((await mailsTo(eve))[0].text_body, 'manage');
	check('after the hold: unconfirmed registration deleted', (await req('GET', `/api/rsvp/manage?t=${encodeURIComponent(eveManage)}`)).status === 404);

	console.log('\nTour booking deadlines (separate from the registration deadline)');
	r = await req('POST', '/api/admin/sessions', { event: EVENT, sessions: [{ id: TOUR1, booking_deadline: new Date(Date.now() - 60_000).toISOString() }] }, ADMIN);
	check('10:30 tour booking closed by its own deadline, no calendar emails', r.data.ok && r.data.calendar_updates === 0);
	r = await req('GET', `/api/rsvp/status?event=${EVENT}`);
	check('status shows the 10:30 tour closed, registration still open', r.data.event.open === true && r.data.tours.find((t) => t.id === TOUR1).open === false && r.data.tours.find((t) => t.id === TOUR2).open === true);
	check('Alice cannot move into the closed tour', (await req('POST', '/api/rsvp/manage', { t: aliceManage, name: 'Alice A', attendance: 'in_person', tour_id: TOUR1 })).status === 409);
	check('Bob cannot leave the closed tour either', (await req('POST', '/api/rsvp/manage', { t: bobManage, name: 'Bob', attendance: 'in_person', tour_id: 'none' })).status === 409);
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
	r = await req('DELETE', '/api/rsvp/manage', { t: aliceManage });
	check('Alice cancels; 11:15 host sees her struck through', r.data.ok && /~~Alice A – booked~~/.test((await last('host2@example.org')).text_body));
	check('Alice\'s row is gone', (await req('GET', `/api/rsvp/manage?t=${encodeURIComponent(aliceManage)}`)).status === 404);

	console.log('\nRetention');
	await cron(Date.parse(seeded.event.ends_at) + 29 * 24 * 3600_000);
	check('registrations kept until 30 days after the event', (await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN)).data.registrations.length > 0);
	await cron(Date.parse(seeded.event.ends_at) + 31 * 24 * 3600_000);
	check('all registrations deleted 30 days after the event', (await req('GET', `/api/admin/summary?event=${EVENT}`, undefined, ADMIN)).data.registrations.length === 0);
} catch (e) {
	failures++;
	console.error(e);
} finally {
	try { process.kill(-server.pid, 'SIGTERM'); } catch {}
	await new Promise((r) => setTimeout(r, 1500));
	try { process.kill(-server.pid, 'SIGKILL'); } catch {}
	if (devVarsBackup !== null) writeFileSync('.dev.vars', devVarsBackup); else rmSync('.dev.vars', { force: true });
}
console.log(`\n${passes} passed, ${failures} failed`);
if (failures) {
	console.log('\n--- server log (tail) ---\n' + serverLog.slice(-4000));
	process.exit(1);
}

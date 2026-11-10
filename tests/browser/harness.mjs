// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../LICENSE.
/**
 * Shared set-up for the browser tests: a local server on its own port and database, a headless browser, and helpers
 * for the dev outbox and the admin page's Access token. Run from the repository root with SITE_DIR set to a built
 * copy of the starter site (sh scripts/starter-e2e.sh with STARTER_DIR set leaves one).
 *
 *   SITE_DIR       built site with eventsandeye/ inside it (required)
 *   PORT           port for wrangler pages dev (8790)
 *   CHROMIUM_PATH  a Chromium to drive instead of Playwright's own (npx playwright-core install chromium)
 *
 * Turnstile's script comes from Cloudflare; the tests answer it with a stand-in that fills in a dummy token, which the
 * server's always-pass test secret accepts. So the widget itself is not tested here, only the form around it.
 */
import { spawn, execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import { existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
export const SITE = process.env.SITE_DIR;
if (!SITE || !existsSync(join(SITE, 'dist/index.html'))) throw new Error('Set SITE_DIR to a built starter site (see tests/browser/harness.mjs).');
export const PORT = Number(process.env.PORT || 8790);
export const BASE = `http://127.0.0.1:${PORT}`;
export const EVENT = process.env.E2E_EVENT || '2026-11-13-london';
const DB = process.env.E2E_DB || 'events';
const SEED = process.env.E2E_SEED || 'eventsandeye/examples/seed.example.sql';
const PERSIST = `.wrangler/browser-${PORT}`;

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const TOKEN_SECRET = randomBytes(32).toString('hex');
const b64u = (b) => Buffer.from(b).toString('base64url');
/** An Access application token for the admin page, as Cloudflare Access would send it. */
export function jwt({ email = 'admin@example.org', exp = Math.floor(Date.now() / 1000) + 3600 } = {}) {
	const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'e2e', typ: 'JWT' }));
	const p = b64u(JSON.stringify({ aud: ['e2e-aud'], email, exp, iat: Math.floor(Date.now() / 1000), iss: 'https://e2e.cloudflareaccess.com', type: 'app', amr: ['pwd', 'mfa'] }));
	return `${h}.${p}.${b64u(sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey))}`;
}

/**
 * Runs wrangler. The dev server holds the same local database, so a write from here can meet "database is locked";
 * that passes in a moment, so it is tried again a few times before giving up.
 */
function wr(args, stdout = 'ignore') {
	for (let attempt = 1; ; attempt++) {
		try {
			return execFileSync('npx', ['wrangler', ...args], { cwd: SITE, stdio: ['ignore', stdout, 'pipe'], env: { ...process.env, CI: '1' }, encoding: 'utf8' });
		} catch (e) {
			const said = `${e.stdout ?? ''}${e.stderr ?? ''}`;
			if (attempt >= 5 || !/database is locked|SQLITE_BUSY/.test(said)) { process.stderr.write(said); throw e; }
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300 * attempt);
		}
	}
}
/** Runs SQL against the test database; with json, returns the rows. */
export function sql(command, json = false) {
	const out = wr(['d1', 'execute', DB, '--local', '--persist-to', PERSIST, '--command', command, ...(json ? ['--json'] : [])], json ? 'pipe' : 'ignore');
	return json ? JSON.parse(out.slice(out.indexOf('[')))[0].results : undefined;
}

let server, serverLog = '';
/** Fresh database with the example event moved to about 20 days from now, and a server on PORT. */
export async function start() {
	// A server left over from an interrupted run answers on the port, and this one would fail to start behind it.
	if (await fetch(BASE).then(() => true, () => false)) throw new Error(`Something is already listening on port ${PORT}: stop it (an earlier run's wrangler?) or set PORT.`);
	// wrangler pages dev reads .dev.vars from the site folder, so each tester needs its own copy of the site.
	writeFileSync(join(SITE, '.dev.vars'), [
		'DEV_MODE=true', `SITE_URL=${BASE}`, `TOKEN_SECRET=${TOKEN_SECRET}`,
		'TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA',
		'ACCESS_AUD=e2e-aud', 'ACCESS_TEAM_DOMAIN=e2e.cloudflareaccess.com', 'ADMIN_EMAILS=admin@example.org', 'ACCESS_MFA=claim',
		'ORG_NAME=AMYBO', 'EMAIL_FROM=AMYBO <hello@amybo.org>', 'NOTIFY_EMAIL=events@example.org', 'POLL_REPLY_EMAIL=polls@example.org',
		'REGISTER_MIN_MS=200',
		// AMYBO's badges: Avery 4822 holders, its tag line and brand colours (README, settings reference). Colours are
		// quoted: in .dev.vars a bare # starts a comment.
		'BADGE_TEMPLATE=avery-4822', 'BADGE_AFFILIATION_COLOUR="#007CBB"', 'BADGE_TAG=EVENT’26', 'BADGE_TAG_COLOUR="#007CBB"', 'BADGE_TAG_WIDTH=0.64', 'BADGE_ACCENT_COLOUR="#87BD25"',
		// Served only by tests/browser/badges.mjs, which routes it to a font file on the machine.
		'BADGE_FONT_URL=/fonts/badge-test.ttf', 'BADGE_FONT_FAMILY=Badge Test',
		`ACCESS_JWKS_JSON=${JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'e2e', alg: 'RS256' }] })}`, '',
	].join('\n'));
	rmSync(join(SITE, PERSIST), { recursive: true, force: true });
	wr(['d1', 'migrations', 'apply', DB, '--local', '--persist-to', PERSIST]);
	wr(['d1', 'execute', DB, '--local', '--persist-to', PERSIST, '--file', SEED]);
	const seedStart = sql(`SELECT starts_at FROM events WHERE id='${EVENT}'`, true)[0].starts_at;
	const days = Math.round((Date.now() + 20 * 86400_000 - Date.parse(seedStart)) / 86400_000);
	const sh = (col) => `strftime('%Y-%m-%dT%H:%M:%SZ', ${col}, '${days >= 0 ? '+' : ''}${days} days')`;
	sql(`UPDATE events SET starts_at=${sh('starts_at')}, ends_at=${sh('ends_at')}, deadline=${sh('deadline')} WHERE id='${EVENT}'; `
		+ `UPDATE sessions SET starts_at=${sh('starts_at')}, ends_at=${sh('ends_at')}, booking_deadline=CASE WHEN booking_deadline IS NULL THEN NULL ELSE ${sh('booking_deadline')} END WHERE event_id='${EVENT}'`);
	server = spawn('npx', ['wrangler', 'pages', 'dev', './dist', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST,
		'--inspector-port', String(PORT + 1000)], { cwd: SITE, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' }, detached: true });
	server.stdout.on('data', (d) => (serverLog += d));
	server.stderr.on('data', (d) => (serverLog += d));
	for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopServer(); process.exit(130); });
	for (let i = 0; i < 120; i++) {
		try { if ((await fetch(`${BASE}/api/rsvp/status?event=${EVENT}`)).status < 500) return; } catch {}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`wrangler pages dev did not start:\n${serverLog.slice(-3000)}`);
}
function stopServer() { try { process.kill(-server.pid, 'SIGKILL'); } catch {} }
export const log = () => serverLog;

// ---- the dev outbox ----
export async function outbox() {
	const r = await fetch(`${BASE}/api/dev/outbox`);
	return (await r.json()).emails.map((e) => ({ ...e, att: JSON.parse(e.attachments || '[]') }));
}
export const mailsTo = async (to) => (await outbox()).filter((e) => e.to_addr === to);
/** A link of this kind (confirm, manage, decline, poll…) from the newest email to this address that has one. */
export async function linkFor(to, kind) {
	const ms = await mailsTo(to);
	for (let i = ms.length - 1; i >= 0; i--) {
		const m = new RegExp(`https?://[^\\s"<>]*/events/${kind}/\\?t=[^\\s"<>]+`).exec(ms[i].text_body);
		if (m) return m[0].replace(/^https?:\/\/[^/]+/, BASE);
	}
	return null;
}
export const cron = (at) => fetch(`${BASE}/api/dev/cron${at ? `?at=${new Date(at).toISOString()}` : ''}`, { method: 'POST' }).then((r) => r.json());

// ---- the browser ----
// Cloudflare's Turnstile script, as the form uses it: a hidden field with the token, and reset/getResponse.
const TURNSTILE = `(() => {
	const token = 'XXXX.DUMMY.TOKEN.XXXX';
	const fill = (el) => { if (el.querySelector('input')) return; const i = document.createElement('input'); i.type = 'hidden';
		i.name = el.dataset.responseFieldName || 'cf-turnstile-response'; i.value = token; el.append(i); };
	window.turnstile = { render: (el) => fill(typeof el === 'string' ? document.querySelector(el) : el), reset: () => {}, getResponse: () => token, remove: () => {}, isExpired: () => false, ready: (f) => f() };
	const all = () => document.querySelectorAll('.cf-turnstile').forEach(fill);
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', all); else all();
})();`;

let browser;
/** A browser context; admin: true sends the Access token, as Cloudflare Access would in front of /admin/ and /api/admin/. */
export async function context({ admin = false, ...opts } = {}) {
	browser ??= await chromium.launch({
		executablePath: process.env.CHROMIUM_PATH || undefined, headless: true,
		args: ['--no-sandbox', '--disable-gpu', '--use-gl=disabled', '--disable-dev-shm-usage'],
	});
	const ctx = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/London', ...opts, ...(admin ? { extraHTTPHeaders: { 'cf-access-jwt-assertion': jwt() } } : {}) });
	await ctx.route('https://challenges.cloudflare.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: TURNSTILE }));
	// Nothing else may leave the machine: a request elsewhere is a third-party call the privacy rules forbid.
	await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|challenges\.cloudflare\.com)/, (r) => { thirdParty.push(r.request().url()); r.abort(); });
	return ctx;
}
export const thirdParty = [];
/** Runs axe-core on the page and returns its violations (WCAG 2.2 A and AA). */
export async function axe(page) {
	await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
	return (await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }))).violations
		.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
}
export async function stop() { try { await browser?.close(); } catch {} stopServer(); }

// ---- checks ----
let failures = 0, passes = 0;
export function check(name, cond, detail = '') {
	if (cond) { passes++; console.log(`  ✓ ${name}`); }
	else { failures++; console.log(`  ✗ ${name}${detail ? ` – ${String(detail).slice(0, 600)}` : ''}`); }
}
export const results = () => ({ passes, failures });

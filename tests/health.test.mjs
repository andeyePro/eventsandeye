// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
// Unit tests for the admin page's set-up check on a live site (the e2e test runs in DEV_MODE), with D1 stubbed.
// Run: node --test eventsandeye/tests/health.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({ entryPoints: [new URL('../src/health.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, platform: 'neutral' });
const { setupChecks, recordCronRun, LATEST_MIGRATION } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

/** A D1 stand-in: answers the two reads, and keeps what recordCronRun writes. */
function db({ migration = LATEST_MIGRATION, cron = null } = {}) {
	const state = { cron };
	return {
		state,
		prepare: (sql) => ({
			bind: (...args) => ({ run: async () => { state.cron = args[0]; } }),
			first: async () => /d1_migrations/.test(sql) ? (migration ? { name: migration } : null) : state.cron ? { value: state.cron } : null,
		}),
	};
}
const good = {
	SITE_URL: 'https://events.example.net', EMAIL_FROM: 'Us <events@example.net>', NOTIFY_EMAIL: 'events@example.net', ORG_NAME: 'Us', ORG_FOOTER: 'Us Ltd',
	TOKEN_SECRET: 'a'.repeat(64), RESEND_API_KEY: 're_x', TURNSTILE_SECRET_KEY: '0x4AAAAAAA-real', ACCESS_TEAM_DOMAIN: 'us.cloudflareaccess.com', ACCESS_AUD: 'aud', ADMIN_EMAILS: 'events@example.net',
};
const req = (host = 'events.example.net') => new Request(`https://${host}/api/admin/events`);
async function withCron(env, at = Date.now()) {
	const d = db();
	await recordCronRun({ ...env, DB: d }, at);
	return d;
}

test('a correct live set-up with a running cron Worker has nothing to report', async () => {
	const d = await withCron(good);
	assert.deepEqual(await setupChecks({ ...good, DB: d }, req()), []);
});

test('example values, test keys and DEV_MODE on a live site are reported', async () => {
	const env = { ...good, SITE_URL: 'https://example.org', TURNSTILE_SECRET_KEY: `1x${'0'.repeat(31)}AA`, DEV_MODE: 'true' };
	const f = await setupChecks({ ...env, DB: await withCron(env) }, req('example.org'));
	assert.ok(f.some((x) => x.level === 'error' && /DEV_MODE is set on a live site/.test(x.text)), JSON.stringify(f));
	const live = { ...env, DEV_MODE: undefined };
	const g = await setupChecks({ ...live, DB: await withCron(live) }, req('example.org'));
	assert.ok(g.some((x) => x.level === 'error' && /test keys/.test(x.text)), JSON.stringify(g));
	assert.ok(g.some((x) => x.level === 'warning' && /SITE_URL still has the example value/.test(x.text)), JSON.stringify(g));
});

test('missing secrets, a missing migration and a cron Worker that never ran are errors', async () => {
	const env = { ...good, RESEND_API_KEY: undefined, TOKEN_SECRET: 'short' };
	const f = await setupChecks({ ...env, DB: db({ migration: '0009_chunked_sending.sql' }) }, req());
	for (const re of [/RESEND_API_KEY is not set/, /TOKEN_SECRET is missing or shorter/, /missing migrations.*0009_chunked_sending.*0010_status/, /cron Worker has not run yet/]) {
		assert.ok(f.some((x) => x.level === 'error' && re.test(x.text)), `${re}: ${JSON.stringify(f)}`);
	}
});

test('a cron Worker with another secret, site or no Resend key, or not run lately, is reported', async () => {
	const d = await withCron({ ...good, TOKEN_SECRET: 'b'.repeat(64), SITE_URL: 'https://old.example.net', RESEND_API_KEY: undefined }, Date.now() - 3600_000);
	const f = await setupChecks({ ...good, DB: d }, req());
	for (const re of [/TOKEN_SECRET is not the same/, /SITE_URL \(https:\/\/old\.example\.net\)/, /has no RESEND_API_KEY/]) assert.ok(f.some((x) => x.level === 'error' && re.test(x.text)), `${re}: ${JSON.stringify(f)}`);
	assert.ok(f.some((x) => x.level === 'warning' && /last ran 60 minutes ago/.test(x.text)), JSON.stringify(f));
});

test('the admin page on another address than SITE_URL is a warning that explains, not an error', async () => {
	const f = await setupChecks({ ...good, DB: await withCron(good) }, req('my-site.pages.dev'));
	assert.deepEqual(f.map((x) => x.level), ['warning']);
	assert.match(f[0].text, /second address for the same site/);
});

test('a database without the status table does not stop the cron run', async () => {
	const broken = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('no such table: status'); } }) }) };
	const errors = console.error; console.error = () => {};
	try { await recordCronRun({ ...good, DB: broken }); } finally { console.error = errors; }
});

// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import { isLocalRequest, teamDomain } from './access';
import { type Env, isDev, siteUrl } from './env';

/**
 * The admin page's set-up check: settings left at their example values or missing, a cron Worker that is not running or
 * is set up differently from the site, and database migrations not yet applied. Each finding says what to do.
 */
export interface SetupFinding { level: 'error' | 'warning' | 'note'; text: string }

/** The newest migration this version needs: the check asks for `wrangler d1 migrations apply` until it is there. */
export const LATEST_MIGRATION = '0010_status.sql';
/** The cron is expected every five minutes; a few missed runs are worth a warning. */
const CRON_LATE_MS = 20 * 60_000;

/** A short HMAC of a fixed string: equal on the site and the cron Worker only when their TOKEN_SECRETs are. */
async function secretPrint(env: Env): Promise<string> {
	if (!env.TOKEN_SECRET) return '';
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.TOKEN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('events-and-i settings check')));
	return [...sig.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface CronStatus { at: string; secret: string; site: string; from: string; resend: boolean }

/** Called by the cron Worker on every run. A database without migration 0010 must not stop the run. */
export async function recordCronRun(env: Env, now = Date.now()) {
	const v: CronStatus = { at: new Date(now).toISOString(), secret: await secretPrint(env), site: env.SITE_URL ?? '', from: env.EMAIL_FROM ?? '', resend: !!env.RESEND_API_KEY };
	try {
		await env.DB.prepare(`INSERT INTO status (key, value, updated_at) VALUES ('cron', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ?2`).bind(JSON.stringify(v), v.at).run();
	} catch (e) { console.error('could not record the cron run (apply the database migrations)', e); }
}

const EXAMPLES = /REPLACE_WITH|(^|[@./\s])example\.(org|cloudflareaccess\.com)\b|Example Organisers|SC000000/;

export async function setupChecks(env: Env, request: Request, now = Date.now()): Promise<SetupFinding[]> {
	const out: SetupFinding[] = [];
	const error = (text: string) => out.push({ level: 'error', text });
	const warning = (text: string) => out.push({ level: 'warning', text });
	const dev = isDev(env);
	const host = new URL(request.url).host;

	if (dev && !isLocalRequest(request)) error('DEV_MODE is set on a live site: emails go to the dev outbox instead of to people. Remove it from the site\'s settings.');
	if (!env.TOKEN_SECRET || env.TOKEN_SECRET.length < 32) error('TOKEN_SECRET is missing or shorter than 32 characters: set it to the output of `openssl rand -hex 32` (README step 8).');
	if (!dev) {
		if (!env.RESEND_API_KEY) error('RESEND_API_KEY is not set, so no email can be sent (README step 8).');
		if (!env.TURNSTILE_SECRET_KEY) error('TURNSTILE_SECRET_KEY is not set, so every registration is refused (README step 8).');
		else if (/^[123]x0{20,}/.test(env.TURNSTILE_SECRET_KEY)) error('TURNSTILE_SECRET_KEY is one of Cloudflare\'s test keys: set your widget\'s secret key (README step 6).');
	}
	if (!env.SITE_URL) warning('SITE_URL is not set, so links in emails point to localhost.');
	else {
		let u: URL | null = null;
		try { u = new URL(env.SITE_URL); } catch {}
		if (!u) error(`SITE_URL (${env.SITE_URL}) is not an address: set it to your site's, such as https://example.org.`);
		else if (!dev && u.protocol !== 'https:') warning(`SITE_URL (${env.SITE_URL}) is not https.`);
		else if (!dev && u.host !== host) warning(`SITE_URL is ${u.host} but this page is on ${host}: links in emails go to ${u.host}. That is right if ${host} is only a second address for the same site.`);
	}
	for (const k of ['SITE_URL', 'EMAIL_FROM', 'NOTIFY_EMAIL', 'ORG_NAME', 'ORG_FOOTER', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'ADMIN_EMAILS', 'POLL_REPLY_EMAIL'] as const) {
		if (!dev && EXAMPLES.test(env[k] ?? '')) warning(`${k} still has the example value (${env[k]}): set your own in wrangler.toml.`);
	}
	if (!env.EMAIL_FROM) warning('EMAIL_FROM is not set: emails are sent from NOTIFY_EMAIL, which must then be on a domain verified in Resend.');
	if (!env.NOTIFY_EMAIL) warning('NOTIFY_EMAIL is not set, so organiser notifications go nowhere useful.');
	if (!env.ORG_NAME) warning('ORG_NAME is not set: emails and calendar entries say "Events&I" instead of your organisation.');
	if (env.ACCESS_TEAM_DOMAIN && teamDomain(env) !== env.ACCESS_TEAM_DOMAIN) out.push({ level: 'note', text: `ACCESS_TEAM_DOMAIN is read as ${teamDomain(env)}; it needs no https:// or slash.` });
	if (env.ACCESS_MFA === 'application') out.push({ level: 'note', text: 'ACCESS_MFA is "application": the two-factor check relies on the Access application requiring MFA. Keep that setting on in Zero Trust.' });

	// Migrations: wrangler records them in d1_migrations.
	// By name, not the newest row: a site may keep migrations of its own in the same table.
	try {
		const row = await env.DB.prepare('SELECT 1 AS ok FROM d1_migrations WHERE name = ?').bind(LATEST_MIGRATION).first<{ ok: number }>();
		if (!row) error(`The database is missing migrations: this version needs ${LATEST_MIGRATION}. Run \`npx wrangler d1 migrations apply <database> --remote\`.`);
	} catch {}

	let cron: CronStatus | null = null, readable = true;
	try {
		const row = await env.DB.prepare(`SELECT value FROM status WHERE key = 'cron'`).first<{ value: string }>();
		cron = row ? JSON.parse(row.value) : null;
	} catch { readable = false; } // no status table yet: the missing migration above says what to do
	if (!readable) return out;
	if (!cron) error('The cron Worker has not run yet. It sends scheduled messages and the rest of big ones, releases places held by unconfirmed registrations and deletes everything 30 days after the event: deploy it (README step 10). Its first run, within five minutes, clears this.');
	else {
		const late = now - Date.parse(cron.at);
		if (late > CRON_LATE_MS) warning(`The cron Worker last ran ${Math.round(late / 60_000)} minutes ago; it should run every five. Check it is deployed and look at its log (\`npx wrangler tail --config workers/cron/wrangler.toml\`).`);
		if (cron.secret !== (await secretPrint(env))) error('The cron Worker\'s TOKEN_SECRET is not the same as the site\'s, so links in the emails it sends do not work. Set it to the same value: `npx wrangler secret put TOKEN_SECRET --config workers/cron/wrangler.toml`.');
		if (siteUrl({ ...env, SITE_URL: cron.site }) !== siteUrl(env)) error(`The cron Worker's SITE_URL (${cron.site || 'not set'}) is not the site's (${env.SITE_URL || 'not set'}), so links in the emails it sends go elsewhere: make them the same in workers/cron/wrangler.toml.`);
		if ((cron.from || '').trim() !== (env.EMAIL_FROM ?? '').trim()) warning(`The cron Worker's EMAIL_FROM (${cron.from || 'not set'}) is not the site's (${env.EMAIL_FROM || 'not set'}).`);
		if (!dev && !cron.resend) error('The cron Worker has no RESEND_API_KEY, so scheduled messages and the rest of big ones cannot be sent: `npx wrangler secret put RESEND_API_KEY --config workers/cron/wrangler.toml`.');
	}
	return out;
}

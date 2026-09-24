/// <reference types="@cloudflare/workers-types" />
// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.

export interface Env {
	DB: D1Database;
	/** Resend API key. Required on the live site; without it emails go to the dev outbox and console (DEV_MODE only). */
	RESEND_API_KEY?: string;
	/** Sender and calendar organiser, e.g. "AMYBO <hello@amybo.org>". */
	EMAIL_FROM?: string;
	/** Where admin notifications go; also the reply-to address. */
	NOTIFY_EMAIL?: string;
	/** Public origin used in email links, e.g. https://amybo.org. */
	SITE_URL?: string;
	/** Organisation name shown in emails and calendar entries. */
	ORG_NAME?: string;
	/** Legal line for email footers, e.g. company registration. */
	ORG_FOOTER?: string;
	/** Privacy notice URL (absolute or site-relative). */
	PRIVACY_URL?: string;
	/** Secret for signing self-service and confirmation links (32+ random bytes). Rotating it invalidates all links. */
	TOKEN_SECRET: string;
	TURNSTILE_SECRET_KEY?: string;
	/** Cloudflare Access team domain, e.g. myteam.cloudflareaccess.com */
	ACCESS_TEAM_DOMAIN?: string;
	/** Cloudflare Access application audience (AUD) tag. */
	ACCESS_AUD?: string;
	/** Where people can read the Events&I source and give feedback (AGPL). */
	EVENTSANDEYE_URL?: string;
	/** "true" only in local development: enables the dev outbox endpoints and test keys. Never set in production. */
	DEV_MODE?: string;
	/** Local development only: JSON Web Key Set used instead of the Access certs URL, for tests. */
	ACCESS_JWKS_JSON?: string;
}

export const isDev = (env: Env) => env.DEV_MODE === 'true';
export const siteUrl = (env: Env) => (env.SITE_URL || 'http://localhost:8788').replace(/\/$/, '');
export const notifyEmail = (env: Env) => env.NOTIFY_EMAIL || 'events@example.org';
export const emailFrom = (env: Env) => env.EMAIL_FROM || `Events <${notifyEmail(env)}>`;
export const orgName = (env: Env) => env.ORG_NAME || 'Events&I';
export const privacyUrl = (env: Env) => {
	const p = env.PRIVACY_URL || '/privacy/';
	return p.startsWith('http') ? p : `${siteUrl(env)}${p}`;
};
/** Bare address of the sender, for the calendar ORGANIZER. */
export const fromAddress = (env: Env) => /<([^>]+)>/.exec(emailFrom(env))?.[1] ?? emailFrom(env);
export const VERSION = '0.2.0-beta';
export const sourceUrl = (env: Env) => env.EVENTSANDEYE_URL || 'https://github.com/andeyePro/eventsandeye';

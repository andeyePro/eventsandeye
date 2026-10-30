// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import { type Env, isDev } from './env';

const TEST_SECRETS = new Set(['1x0000000000000000000000000000000AA', '2x0000000000000000000000000000000AA', '3x0000000000000000000000000000000AA']);

/** The widget's data-action on the booking form, so a token solved for another form or site using the same key is refused. */
export const TURNSTILE_ACTION = 'eventsandeye-register';

/**
 * Server-side Turnstile check. In DEV_MODE with a Cloudflare test secret it is decided locally (no network).
 * The token must also have been solved for the booking form's action, on the host this request came to: one widget key
 * often serves several sites, and a token from any of them would otherwise do.
 */
export async function verifyTurnstile(env: Env, token: unknown, ip: string | null, host: string): Promise<boolean> {
	if (typeof token !== 'string' || !token) return false;
	const secret = env.TURNSTILE_SECRET_KEY;
	if (!secret) return isDev(env); // live site without a secret fails closed
	if (isDev(env) && TEST_SECRETS.has(secret)) return secret.startsWith('1x');
	const form = new FormData();
	form.append('secret', secret);
	form.append('response', token);
	if (ip) form.append('remoteip', ip);
	const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
	if (!res.ok) return false;
	const data = (await res.json()) as { success?: boolean; action?: string; hostname?: string };
	return data.success === true && data.action === TURNSTILE_ACTION && data.hostname?.toLowerCase() === host.toLowerCase();
}

// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../../LICENSE.
import { type Env, isDev } from '../../env';
import { handle, readJson } from '../../http';
import { register, UserError } from '../../rsvp';
import { verifyTurnstile } from '../../turnstile';

/**
 * Every registration is answered after at least this long. An address already confirmed is answered with less work
 * than a new one, so without it the time taken would tell anyone whether an address is registered.
 */
const MIN_MS = 1500;
const minMs = (env: Env) => (isDev(env) && env.REGISTER_MIN_MS !== undefined ? Number(env.REGISTER_MIN_MS) : MIN_MS);

export const onRequestPost = handle(async ({ env, request }) => {
	const body = await readJson(request);
	// Honeypot: humans never see or fill the "website" field. Pretend success so bots learn nothing.
	if (typeof body.website === 'string' && body.website.trim() !== '') return { ok: true };
	const human = await verifyTurnstile(env, body['cf-turnstile-response'], request.headers.get('cf-connecting-ip'), new URL(request.url).hostname);
	if (!human) throw new UserError('The spam check failed. Please reload the page and try again.', 403);
	const started = Date.now();
	try {
		return await register(env, String(body.event || ''), body);
	} finally {
		const left = started + minMs(env) - Date.now();
		if (left > 0) await new Promise((r) => setTimeout(r, left));
	}
});

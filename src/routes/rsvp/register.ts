// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../../LICENSE.
import { handle, readJson } from '../../http';
import { register, UserError } from '../../rsvp';
import { verifyTurnstile } from '../../turnstile';

export const onRequestPost = handle(async ({ env, request }) => {
	const body = await readJson(request);
	// Honeypot: humans never see or fill the "website" field. Pretend success so bots learn nothing.
	if (typeof body.website === 'string' && body.website.trim() !== '') return { ok: true };
	const human = await verifyTurnstile(env, body['cf-turnstile-response'], request.headers.get('cf-connecting-ip'));
	if (!human) throw new UserError('The spam check failed. Please reload the page and try again.', 403);
	return register(env, String(body.event || ''), body);
});

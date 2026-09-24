// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../../LICENSE.
import type { Env } from '../../env';
import { handle, readJson } from '../../http';
import { cancel, manageView, updateRegistration, UserError } from '../../rsvp';
import { readToken } from '../../tokens';

async function idFrom(env: Env, t: unknown) {
	const id = await readToken(env, 'manage', t);
	if (!id) throw new UserError('This link is not valid.', 404);
	return id;
}

export const onRequestGet = handle(async ({ env, request }) => manageView(env, await idFrom(env, new URL(request.url).searchParams.get('t'))));

export const onRequestPost = handle(async ({ env, request }) => {
	const body = await readJson(request);
	return updateRegistration(env, await idFrom(env, body.t), body);
});

export const onRequestDelete = handle(async ({ env, request }) => {
	const body = await readJson(request);
	return cancel(env, await idFrom(env, body.t));
});

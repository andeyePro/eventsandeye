// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../../LICENSE.
import { handle, readJson } from '../../http';
import { confirm, UserError } from '../../rsvp';
import { readToken } from '../../tokens';

/** POST only, so email link scanners that prefetch GET URLs cannot confirm on someone's behalf. */
export const onRequestPost = handle(async ({ env, request }) => {
	const { t } = await readJson(request);
	const id = await readToken(env, 'confirm', t);
	if (!id) throw new UserError('This confirmation link is not valid.', 404);
	return confirm(env, id);
});

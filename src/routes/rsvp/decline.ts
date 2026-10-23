// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../../LICENSE.
import { handle, readJson } from '../../http';
import { decline, UserError } from '../../rsvp';
import { readToken } from '../../tokens';

/** POST only, like confirm: a link scanner fetching the email's links must not delete anything. */
export const onRequestPost = handle(async ({ env, request }) => {
	const { t } = await readJson(request);
	const id = await readToken(env, 'confirm', t);
	if (!id) throw new UserError('This link is not valid.', 404);
	return decline(env, id);
});

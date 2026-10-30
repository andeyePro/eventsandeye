// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../../LICENSE.
import { handle, readJson } from '../../http';
import { saveBallot, suggestOption } from '../../polls';
import { UserError } from '../../rsvp';
import { readToken } from '../../tokens';

/** A registrant's ranking ({ t, poll, ranking, bar }) or suggestion ({ t, poll, suggest }), with their manage link's token. */
export const onRequestPost = handle(async ({ env, request }) => {
	const body = await readJson(request);
	const id = await readToken(env, 'manage', body.t);
	if (!id) throw new UserError('This link is not valid.', 404);
	return body.suggest !== undefined ? suggestOption(env, id, { poll: body.poll, label: body.suggest }) : saveBallot(env, id, body);
});

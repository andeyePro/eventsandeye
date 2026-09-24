// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../../LICENSE.
import { handle } from '../../http';
import { calendarFile, UserError } from '../../rsvp';
import { readToken } from '../../tokens';

/** .ics download of one calendar entry, for calendars that import files (Apple Calendar, Thunderbird and others). */
export const onRequestGet = handle(async ({ env, request }) => {
	const url = new URL(request.url);
	const id = await readToken(env, 'manage', url.searchParams.get('t'));
	if (!id) throw new UserError('This link is not valid.', 404);
	const ics = await calendarFile(env, id, url.searchParams.get('entry') || '');
	return new Response(ics, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'attachment; filename="event.ics"', 'cache-control': 'no-store' } });
});

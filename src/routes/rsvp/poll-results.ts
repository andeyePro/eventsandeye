// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../../LICENSE.
import type { Env } from '../../env';
import { publicResults } from '../../polls';
import { UserError } from '../../rsvp';

/**
 * GET ?event=<id>[&poll=<id>]: a poll's live totals, if an organiser has made them public. Open to any origin (a
 * slide opened from a file sends Origin "null"), and never cached, so a page polling it sees new answers at once.
 */
export const onRequestGet = async ({ env, request }: EventContext<Env, string, unknown>): Promise<Response> => {
	const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' };
	const q = new URL(request.url).searchParams;
	try {
		return new Response(JSON.stringify(await publicResults(env, q.get('event') || '', q.get('poll') || '')), { headers });
	} catch (e) {
		if (!(e instanceof UserError)) console.error(e);
		const status = e instanceof UserError ? e.status : 500;
		return new Response(JSON.stringify({ ok: false, error: e instanceof UserError ? e.message : 'Something went wrong.' }), { status, headers });
	}
};

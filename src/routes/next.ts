// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../LICENSE.
import type { Env } from '../env';

/**
 * A permanent link to whichever event is next: redirects to the page of the earliest event that has not yet ended,
 * or to the events index (EVENTS_INDEX_PATH, default /events/) when there is none. Point a short link such as
 * example.org/event here once and never change it.
 */
export const onRequestGet = async ({ env, request }: EventContext<Env, string, unknown>): Promise<Response> => {
	const fallback = (env as Env & { EVENTS_INDEX_PATH?: string }).EVENTS_INDEX_PATH || '/events/';
	let path = fallback;
	try {
		const row = await env.DB.prepare('SELECT page_path FROM events WHERE ends_at > ? ORDER BY starts_at LIMIT 1')
			.bind(new Date().toISOString())
			.first<{ page_path: string }>();
		if (row?.page_path?.startsWith('/')) path = row.page_path;
	} catch (e) {
		console.error(e);
	}
	const target = new URL(path, request.url);
	return new Response(null, { status: 302, headers: { Location: target.toString(), 'Cache-Control': 'no-store' } });
};

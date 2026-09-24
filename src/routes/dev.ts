// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../LICENSE.
import { isDev } from '../env';
import { handle } from '../http';
import { runScheduled } from '../rsvp';
import { json } from '../util';

/** Local development only: emails that would have been sent. 404 on the live site. */
export const outbox = handle(async ({ env }) => {
	if (!isDev(env)) return new Response('Not found', { status: 404 });
	return json({ ok: true, emails: (await env.DB.prepare('SELECT * FROM dev_outbox ORDER BY id').all()).results });
});

/** Local development only: run the scheduled jobs now, optionally as if at ?at=<ISO time>. 404 on the live site. */
export const cron = handle(async ({ env, request }) => {
	if (!isDev(env)) return new Response('Not found', { status: 404 });
	const at = new URL(request.url).searchParams.get('at');
	return { ok: true, report: await runScheduled(env, at ? Date.parse(at) : Date.now()) };
});

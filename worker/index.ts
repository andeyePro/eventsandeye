// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import type { Env } from '../src/env';
import { runScheduled } from '../src/rsvp';

/**
 * Companion Worker for a Pages site (Pages Functions have no cron triggers). Shares the same D1 database.
 * Every 5 minutes: sends due scheduled messages, handles unconfirmed-registration holds, applies retention.
 */
export default {
	async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(runScheduled(env).then((r) => console.log('scheduled run', JSON.stringify(r))));
	},
	async fetch() {
		return new Response('Events&I cron worker: no HTTP interface', { status: 404 });
	},
} satisfies ExportedHandler<Env>;

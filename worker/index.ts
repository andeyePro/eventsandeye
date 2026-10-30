// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import type { Env } from '../src/env';
import { binaryString, handleInbound, MAX_INBOUND_BYTES } from '../src/inbound';
import { runScheduled } from '../src/rsvp';

/**
 * Companion Worker for a Pages site (Pages Functions have no cron triggers). Shares the same D1 database.
 * Every 5 minutes: sends due scheduled messages, handles unconfirmed-registration holds, applies retention.
 * Optionally, with Cloudflare Email Routing sending POLL_REPLY_EMAIL here: organisers' replies to poll suggestions.
 */
export default {
	async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(runScheduled(env).then((r) => console.log('scheduled run', JSON.stringify(r))));
	},
	async email(message: ForwardableEmailMessage, env: Env) {
		if (message.rawSize > MAX_INBOUND_BYTES) return message.setReject('Message too large.');
		const result = await handleInbound(env, binaryString(new Uint8Array(await new Response(message.raw).arrayBuffer())), (reason) => message.setReject(reason));
		console.log('inbound email', JSON.stringify(result));
	},
	async fetch() {
		return new Response('Events&I cron worker: no HTTP interface', { status: 404 });
	},
} satisfies ExportedHandler<Env>;

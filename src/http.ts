// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import type { Env } from './env';
import { UserError } from './rsvp';
import { bad, json } from './util';

export type Ctx = EventContext<Env, string, { adminEmail?: string }>;

/** Wraps a handler: JSON errors for UserError, generic 500 otherwise (details only in logs). */
export function handle(fn: (ctx: Ctx) => Promise<Response | unknown>) {
	return async (ctx: Ctx): Promise<Response> => {
		try {
			const r = await fn(ctx);
			return r instanceof Response ? r : json(r);
		} catch (e) {
			if (e instanceof UserError) return bad(e.message, e.status);
			console.error(e);
			return bad('Something went wrong. Please try again, or email hello@amybo.org.', 500);
		}
	};
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
	if (!(request.headers.get('content-type') || '').includes('application/json')) throw new UserError('Expected JSON.', 415);
	const text = await request.text();
	if (text.length > 50_000) throw new UserError('Request too large.', 413);
	try {
		const v = JSON.parse(text);
		if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
		return v;
	} catch {
		throw new UserError('Invalid JSON.');
	}
}

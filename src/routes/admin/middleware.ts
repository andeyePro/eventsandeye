// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../../LICENSE.
import { verifyAccess } from '../../access';
import type { Ctx } from '../../http';
import { bad } from '../../util';

/** Defence in depth behind the Cloudflare Access policy: every admin API call must carry a valid Access JWT. */
export const apiMiddleware = async (ctx: Ctx) => {
	const email = await verifyAccess(ctx.env, ctx.request);
	if (!email) return bad('Not authorised', 401);
	if (ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD') {
		const origin = ctx.request.headers.get('origin');
		if (origin && origin !== new URL(ctx.request.url).origin) return bad('Cross-origin request refused', 403);
	}
	ctx.data.adminEmail = email;
	const res = await ctx.next();
	const out = new Response(res.body, res);
	out.headers.set('cache-control', 'no-store');
	out.headers.set('x-robots-tag', 'noindex');
	return out;
};

/** The admin page itself is refused without a valid Access JWT, even if the Access policy were misconfigured. */
export const pageMiddleware = async (ctx: Ctx) => {
	if (!(await verifyAccess(ctx.env, ctx.request))) {
		return new Response('Not authorised. This page is protected by Cloudflare Access.', { status: 401, headers: { 'content-type': 'text/plain', 'x-robots-tag': 'noindex' } });
	}
	const res = await ctx.next();
	const out = new Response(res.body, res);
	out.headers.set('cache-control', 'no-store');
	out.headers.set('x-robots-tag', 'noindex');
	return out;
};

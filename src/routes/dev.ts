// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../LICENSE.
import { isDev } from '../env';
import { handle } from '../http';
import { runScheduled } from '../rsvp';
import { json } from '../util';

/** Local development only: emails that would have been sent. 404 on the live site. */
export const outbox = handle(async ({ env, request }) => {
	if (!isDev(env)) return new Response('Not found', { status: 404 });
	const emails = (await env.DB.prepare('SELECT * FROM dev_outbox ORDER BY id DESC').all()).results as Record<string, unknown>[];
	if (!(request.headers.get('accept') ?? '').includes('text/html')) return json({ ok: true, emails: [...emails].reverse() });
	// A browser gets a readable page: newest first, links clickable, so a local demo can walk through the emails.
	const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
	const linkify = (t: string) => esc(t).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`);
	const items = emails.map((e) => {
		const text = typeof e.text_body === 'string' ? e.text_body : JSON.stringify(e, null, 2);
		let attachments = '';
		try {
			const names = (JSON.parse(String(e.attachments ?? '[]')) as { filename?: string }[]).map((a) => a.filename).filter(Boolean);
			if (names.length) attachments = `<p class="att">Attachments: ${esc(names.join(', '))}</p>`;
		} catch { /* not JSON: ignore */ }
		return `<article><h2>${esc(e.subject)}</h2><p class="meta">To ${esc(e.to_addr)} · ${esc(e.created_at ?? '')}</p>${attachments}<pre>${linkify(text)}</pre></article>`;
	});
	const html = `<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Dev outbox (${emails.length})</title>
<style>body{font-family:Arial,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#111}article{border:1px solid #ccc;border-radius:.5rem;padding:1rem 1.25rem;margin:1rem 0}h1{font-size:1.4rem}h2{font-size:1.1rem;margin:0 0 .25rem}.meta,.att{color:#555;font-size:.9rem;margin:.25rem 0}pre{white-space:pre-wrap;font:inherit;background:#f6f6f6;padding:.75rem;border-radius:.4rem}a{color:#175a00}</style>
<h1>Dev outbox: ${emails.length} email${emails.length === 1 ? '' : 's'} that would have been sent</h1><p class="meta">Local development only. Newest first. Reload after each action.</p>${items.join('') || '<p>No emails yet.</p>'}`;
	return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
});

/** Local development only: run the scheduled jobs now, optionally as if at ?at=<ISO time>. 404 on the live site. */
export const cron = handle(async ({ env, request }) => {
	if (!isDev(env)) return new Response('Not found', { status: 404 });
	const at = new URL(request.url).searchParams.get('at');
	return { ok: true, report: await runScheduled(env, at ? Date.parse(at) : Date.now()) };
});

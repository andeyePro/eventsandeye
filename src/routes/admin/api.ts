// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../../LICENSE.
import { handle, readJson } from '../../http';
import { mdToHtml } from '../../markdown';
import {
	addInstructions, adminDelete, adminSummary, audienceRecipients, cancelMessage, createMessage, listInstructions, listMessages, parseAudience,
	promote, registrationsCsv, sentLogMarkdown, updateSessions, updateSettings,
} from '../../rsvp';

const ev = (request: Request) => new URL(request.url).searchParams.get('event') || '';

export const summary = handle(async ({ env, request }) => adminSummary(env, ev(request)));

export const settings = handle(async ({ env, request }) => {
	const body = await readJson(request);
	return updateSettings(env, String(body.event || ''), body);
});

export const sessions = handle(async ({ env, request }) => {
	const body = await readJson(request);
	return updateSessions(env, String(body.event || ''), body);
});

export const promoteHandler = handle(async ({ env, request }) => {
	const body = await readJson(request);
	return promote(env, String(body.id || ''), body.what === 'tour' ? 'tour' : 'event');
});

/** Admin removal (e.g. spam). Sends no email to the person. */
export const removeRegistration = handle(async ({ env, request }) => adminDelete(env, String((await readJson(request)).id || '')));

/** ?format=csv (all registrations) or ?format=bcc (confirmed attendees' addresses, comma separated, for Gmail BCC). */
export const exportHandler = handle(async ({ env, request }) => {
	const url = new URL(request.url);
	const event = ev(request);
	if (url.searchParams.get('format') === 'bcc') {
		let raw: unknown = {};
		try { raw = JSON.parse(url.searchParams.get('audience') || '{}'); } catch { raw = {}; }
		const regs = await audienceRecipients(env, event, parseAudience(raw));
		return { ok: true, count: regs.length, bcc: regs.map((r) => r.email).join(', ') };
	}
	const s = await adminSummary(env, event);
	return new Response(registrationsCsv(s.registrations, s.sessions), {
		headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${event}-registrations.csv"` },
	});
});

export const instructionsGet = handle(async ({ env, request }) => ({ ok: true, versions: await listInstructions(env, ev(request)) }));
/** Saves a new version. It is sent automatically only to people who confirm or are promoted from now on. */
export const instructionsPost = handle(async ({ env, request, data }) => {
	const body = await readJson(request);
	return addInstructions(env, String(body.event || ''), body, data.adminEmail || 'admin');
});

export const messagesGet = handle(async ({ env, request }) => ({ ok: true, messages: await listMessages(env, ev(request)) }));
/** Send now, or schedule with scheduled_at (ISO). { dry_run: true } returns the recipient count only. */
export const messagesPost = handle(async ({ env, request, data }) => {
	const body = await readJson(request);
	const event = String(body.event || '');
	if (body.dry_run === true) return { ok: true, count: (await audienceRecipients(env, event, parseAudience(body.audience))).length };
	return { ok: true, message: await createMessage(env, event, body, data.adminEmail || 'admin') };
});
export const messagesCancel = handle(async ({ env, request }) => cancelMessage(env, String((await readJson(request)).id || '')));

export const sentLog = handle(async ({ env, request }) => {
	const event = ev(request);
	return new Response(await sentLogMarkdown(env, event), {
		headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${event}-sent-log.md"` },
	});
});

export const preview = handle(async ({ request }) => {
	const body = await readJson(request);
	return { ok: true, html: mdToHtml(typeof body.body_md === 'string' ? body.body_md : '') };
});

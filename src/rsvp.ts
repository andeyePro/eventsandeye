// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import { attachments, entriesFor, parseState, plan, saveState } from './calendar';
import { type Env, notifyEmail, orgName, privacyUrl, siteUrl, sourceUrl } from './env';
import { sendBatch, sendEmail, type OutgoingEmail } from './email';
import { syncHosts } from './hosts';
import { buildIcs } from './ics';
import {
	alreadyRegisteredIntro, type Brand, calendarUpdateEmail, cancellationEmail, confirmEmail, type EventRow, instructionsEmail, messageEmail,
	notification, type RegistrationRow, type SessionRow, waitlistReminderEmail,
} from './templates';
import { makeToken } from './tokens';
import { cleanText, EMAIL_RE, nowIso, randomToken } from './util';

const HOUR = 3600_000;
export const MAX_HOLD_MS = 48 * HOUR;

export class UserError extends Error {
	constructor(message: string, public status = 400) {
		super(message);
	}
}

export const brand = (env: Env): Brand => ({
	org: orgName(env),
	source: sourceUrl(env),
	footer: env.ORG_FOOTER || '',
	privacyUrl: privacyUrl(env),
	notify: notifyEmail(env),
});

// ---------- reads ----------

export async function getEvent(env: Env, id: string): Promise<EventRow> {
	const ev = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<EventRow>();
	if (!ev) throw new UserError('Unknown event', 404);
	return ev;
}

export async function getSessions(env: Env, eventId: string): Promise<SessionRow[]> {
	return (await env.DB.prepare('SELECT * FROM sessions WHERE event_id = ? ORDER BY sort, starts_at').bind(eventId).all<SessionRow>()).results;
}

/** Bookable optional sessions (the "tour" choice group). */
export const tourSessions = (sessions: SessionRow[]) => sessions.filter((s) => s.choice_group === 'tour');

export async function getRegistration(env: Env, id: string): Promise<RegistrationRow | null> {
	return env.DB.prepare('SELECT * FROM registrations WHERE id = ?').bind(id).first<RegistrationRow>();
}

export async function latestInstructions(env: Env, eventId: string) {
	return env.DB.prepare('SELECT * FROM instructions WHERE event_id = ? ORDER BY version DESC LIMIT 1')
		.bind(eventId)
		.first<{ event_id: string; version: number; subject: string; body_md: string; change_note: string | null; created_at: string }>();
}

export const registrationOpen = (ev: EventRow, now = Date.now()) => now < Date.parse(ev.deadline);
/** Optional sessions can be booked or changed until their own deadline, by default their start. */
export const sessionBookingOpen = (s: SessionRow, now = Date.now()) => now < Date.parse(s.booking_deadline ?? s.starts_at);

/**
 * Places are "held" by confirmed registrations and by pending ones whose hold has not expired.
 * A place is only offered when a seat is free AND nobody confirmed is waiting: freed places go to the
 * waiting list first, and only an admin promotes people off it.
 */
export async function capacity(env: Env, ev: EventRow, sessions: SessionRow[], now = nowIso()) {
	const held = `(status = 'confirmed' OR (status = 'pending' AND hold_expires_at > ?))`;
	const inPerson = await env.DB.prepare(
		`SELECT
			SUM(CASE WHEN attendance='in_person' AND place='place' AND ${held} THEN 1 ELSE 0 END) AS held,
			SUM(CASE WHEN attendance='in_person' AND place='waitlist' AND status='confirmed' THEN 1 ELSE 0 END) AS waiting,
			SUM(CASE WHEN attendance='in_person' AND place='place' AND status='confirmed' THEN 1 ELSE 0 END) AS confirmed,
			SUM(CASE WHEN attendance='remote' AND status='confirmed' THEN 1 ELSE 0 END) AS remote,
			SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending
		 FROM registrations WHERE event_id = ?`,
	).bind(now, ev.id).first<Record<string, number | null>>();
	const rows = await env.DB.prepare(
		`SELECT tour_id,
			SUM(CASE WHEN tour_place='place' AND ${held} THEN 1 ELSE 0 END) AS held,
			SUM(CASE WHEN tour_place='place' AND status='confirmed' THEN 1 ELSE 0 END) AS confirmed,
			SUM(CASE WHEN tour_place='waitlist' AND status='confirmed' THEN 1 ELSE 0 END) AS waiting
		 FROM registrations WHERE event_id = ? AND tour_id IS NOT NULL GROUP BY tour_id`,
	).bind(now, ev.id).all<{ tour_id: string; held: number; confirmed: number; waiting: number }>();
	const n = (x: number | null | undefined) => x ?? 0;
	const nowMs = Date.parse(now);
	return {
		inPerson: {
			max: ev.in_person_max, held: n(inPerson?.held), confirmed: n(inPerson?.confirmed), waiting: n(inPerson?.waiting),
			available: n(inPerson?.held) < ev.in_person_max && n(inPerson?.waiting) === 0,
		},
		remote: n(inPerson?.remote),
		pending: n(inPerson?.pending),
		tours: tourSessions(sessions).map((t) => {
			const r = rows.results.find((x) => x.tour_id === t.id);
			const held = n(r?.held), waiting = n(r?.waiting);
			const cap = t.capacity ?? Infinity;
			return {
				id: t.id, label: t.label, starts_at: t.starts_at, capacity: t.capacity, held, confirmed: n(r?.confirmed), waiting,
				open: sessionBookingOpen(t, nowMs), available: held < cap && waiting === 0,
			};
		}),
	};
}

/** Hold for unconfirmed registrations: the shorter of 48 hours or a third of the time left to the deadline. */
export function holdMs(ev: EventRow, now = Date.now()): number {
	const third = Math.max(0, (Date.parse(ev.deadline) - now) / 3);
	return Math.max(15 * 60_000, Math.min(MAX_HOLD_MS, third));
}

export async function manageUrl(env: Env, id: string) {
	return `${siteUrl(env)}/events/manage/?t=${encodeURIComponent(await makeToken(env, 'manage', id))}`;
}
export async function confirmUrl(env: Env, id: string) {
	return `${siteUrl(env)}/events/confirm/?t=${encodeURIComponent(await makeToken(env, 'confirm', id))}`;
}
export async function icsUrlFor(env: Env, id: string) {
	const t = encodeURIComponent(await makeToken(env, 'manage', id));
	return (key: string) => `${siteUrl(env)}/api/rsvp/calendar?t=${t}&entry=${encodeURIComponent(key)}`;
}

async function recordDelivery(env: Env, regId: string, kind: string, providerId: string, extra: { messageId?: string; version?: number } = {}) {
	await env.DB.prepare('INSERT INTO deliveries (registration_id, kind, message_id, instructions_version, sent_at, provider_id) VALUES (?,?,?,?,?,?)')
		.bind(regId, kind, extra.messageId ?? null, extra.version ?? null, nowIso(), providerId)
		.run();
}

// ---------- public flows ----------

export interface RegistrationInput {
	name?: unknown;
	email?: unknown;
	attendance?: unknown;
	tour_id?: unknown;
	affiliation?: unknown;
	needs?: unknown;
	extra_answer?: unknown;
	consent?: unknown;
	share_contact?: unknown;
}

const truthy = (v: unknown) => v === true || v === 'on' || v === 'true' || v === 1 || v === '1';

function parseCommon(input: RegistrationInput, sessions: SessionRow[]) {
	const name = cleanText(input.name, 120);
	if (!name) throw new UserError('Please enter your name.');
	const attendance = input.attendance === 'remote' ? 'remote' : input.attendance === 'in_person' ? 'in_person' : null;
	if (!attendance) throw new UserError('Please choose in person or remote.');
	let tour_id: string | null = null;
	if (attendance === 'in_person' && input.tour_id && input.tour_id !== 'none') {
		const t = tourSessions(sessions).find((x) => x.id === input.tour_id);
		if (!t) throw new UserError('Unknown tour.');
		tour_id = t.id;
	}
	return {
		name, attendance, tour_id, affiliation: cleanText(input.affiliation, 200), needs: cleanText(input.needs, 1000), extra_answer: cleanText(input.extra_answer, 500),
		share_contact: truthy(input.share_contact) ? 1 : 0,
	} as const;
}

/**
 * Creates a pending registration and sends the confirm-your-email message. The response is identical whether or not
 * the address was already registered. A pending duplicate gets the confirm-your-email message again; a confirmed
 * duplicate gets a reminder of their registration with the latest joining instructions (or their waiting-list status).
 */
export async function register(env: Env, eventId: string, input: RegistrationInput) {
	const ev = await getEvent(env, eventId);
	if (!registrationOpen(ev)) throw new UserError('Registration for this event has closed.', 409);
	if (!truthy(input.consent)) throw new UserError('Please tick the consent box to register.');
	const sessions = await getSessions(env, ev.id);
	const c = parseCommon(input, sessions);
	const email = cleanText(input.email, 254)?.toLowerCase() ?? '';
	if (!EMAIL_RE.test(email)) throw new UserError('Please enter a valid email address.');

	const existing = await env.DB.prepare('SELECT * FROM registrations WHERE event_id = ? AND email = ?').bind(ev.id, email).first<RegistrationRow>();
	if (existing) {
		if (existing.status === 'pending') {
			await sendEmail(env, confirmEmail(brand(env), ev, existing, await confirmUrl(env, existing.id), await manageUrl(env, existing.id)));
		} else if (existing.attendance === 'in_person' && existing.place === 'waitlist') {
			const pid = await sendEmail(env, waitlistReminderEmail(brand(env), ev, existing, sessions, await manageUrl(env, existing.id)));
			await recordDelivery(env, existing.id, 'already_registered', pid);
		} else {
			await sendInstructions(env, ev, existing, sessions, { intro: alreadyRegisteredIntro(ev, existing), resendAllCalendar: true, kind: 'already_registered' });
		}
		return { ok: true as const };
	}

	const tour = c.tour_id ? sessions.find((s) => s.id === c.tour_id)! : null;
	if (tour && !sessionBookingOpen(tour)) throw new UserError(`Booking for the ${tour.label} has closed.`, 409);
	const now = Date.now();
	const nowS = new Date(now).toISOString();
	const cap = await capacity(env, ev, sessions, nowS);
	const place = c.attendance === 'in_person' ? (cap.inPerson.available ? 'place' : 'waitlist') : null;
	const tourCap = tour ? cap.tours.find((t) => t.id === tour.id)! : null;
	const tour_place = tourCap ? (tourCap.available ? 'place' : 'waitlist') : null;
	const id = randomToken(16);
	await env.DB.prepare(
		`INSERT INTO registrations (id, event_id, name, email, attendance, affiliation, needs, extra_answer, share_contact, status, place, tour_id, tour_place,
			consent_at, created_at, updated_at, hold_expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
	).bind(id, ev.id, c.name, email, c.attendance, c.affiliation, c.needs, c.extra_answer, c.share_contact, 'pending', place, c.tour_id, tour_place,
		nowS, nowS, nowS, new Date(now + holdMs(ev, now)).toISOString()).run();
	// D1 has no row locks: if two people took the last place at the same moment, the later one moves to the waiting list.
	const after = await capacity(env, ev, sessions, nowS);
	if (place === 'place' && after.inPerson.held > ev.in_person_max) await demoteIfLatest(env, id, 'place');
	const tourAfter = tour ? after.tours.find((t) => t.id === tour.id)! : null;
	if (tour && tour_place === 'place' && tourAfter && tour.capacity != null && tourAfter.held > tour.capacity) await demoteIfLatest(env, id, 'tour_place', tour.id);
	const reg = (await getRegistration(env, id))!;
	const pid = await sendEmail(env, confirmEmail(brand(env), ev, reg, await confirmUrl(env, id), await manageUrl(env, id)));
	await recordDelivery(env, id, 'confirm_email', pid);
	return { ok: true as const };
}

/** Moves this registration to the waiting list if it is the newest of those over capacity. */
async function demoteIfLatest(env: Env, id: string, field: 'place' | 'tour_place', tourId?: string) {
	const reg = (await getRegistration(env, id))!;
	const newer = await env.DB.prepare(
		`SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND ${field} = 'place' AND created_at > ? ${tourId ? 'AND tour_id = ?' : `AND attendance = 'in_person'`}`,
	).bind(...[reg.event_id, reg.created_at, ...(tourId ? [tourId] : [])]).first<{ n: number }>();
	if ((newer?.n ?? 0) === 0) await env.DB.prepare(`UPDATE registrations SET ${field} = 'waitlist' WHERE id = ?`).bind(id).run();
}

/**
 * Sends the latest joining instructions with the person's calendar. Invitations are attached only for new or
 * changed entries (or all of them when resendAllCalendar), and entries that no longer apply are cancelled.
 */
async function sendInstructions(env: Env, ev: EventRow, reg: RegistrationRow, sessions: SessionRow[],
	opts: { intro?: { html: string; text: string }; resendAllCalendar?: boolean; kind?: string } = {}) {
	const instr = await latestInstructions(env, ev.id);
	if (!instr) return;
	const murl = await manageUrl(env, reg.id);
	const p = await plan(parseState(reg.calendar_state), entriesFor(env, ev, sessions, reg, murl));
	const send = opts.resendAllCalendar ? [...p.requests, ...p.unchanged] : p.requests;
	const files = attachments(env, ev, reg, send, p.cancels);
	const pid = await sendEmail(env, instructionsEmail(brand(env), ev, reg, sessions, instr, murl, { entries: p.entries, icsUrl: await icsUrlFor(env, reg.id) }, files, opts.intro));
	await env.DB.prepare('UPDATE registrations SET instructions_version = ?, calendar_state = ? WHERE id = ?').bind(instr.version, JSON.stringify(p.state), reg.id).run();
	await recordDelivery(env, reg.id, opts.kind ?? 'instructions', pid, { version: instr.version });
}

/** Sends updated or cancelled invitations if, and only if, this person's calendar entries changed. */
async function syncCalendar(env: Env, ev: EventRow, reg: RegistrationRow, sessions: SessionRow[]) {
	const murl = await manageUrl(env, reg.id);
	const p = await plan(parseState(reg.calendar_state), entriesFor(env, ev, sessions, reg, murl));
	if (!p.requests.length && !p.cancels.length) return false;
	const files = attachments(env, ev, reg, p.requests, p.cancels);
	const pid = await sendEmail(env, calendarUpdateEmail(brand(env), ev, reg, p.requests.map((r) => r.entry), p.cancels.map((c) => c.summary), { entries: p.entries, icsUrl: await icsUrlFor(env, reg.id) }, murl, files));
	await saveState(env, reg.id, p.state);
	await recordDelivery(env, reg.id, 'calendar_update', pid);
	return true;
}

async function totalsLines(env: Env, ev: EventRow, sessions: SessionRow[]) {
	const cap = await capacity(env, ev, sessions);
	return [
		`In person: ${cap.inPerson.confirmed} confirmed of ${cap.inPerson.max} places, ${cap.inPerson.waiting} on the waiting list.`,
		`Remote: ${cap.remote} confirmed. Unconfirmed registrations: ${cap.pending}.`,
		...cap.tours.map((t) => `${t.label}: ${t.confirmed} of ${t.capacity ?? 'unlimited'} booked, ${t.waiting} waiting.`),
		`Admin: ${siteUrl(env)}/admin/rsvps/`,
	];
}

/** Tells the organiser when a confirmed registrant newly joins the in-person or a tour waiting list, with current totals. */
async function notifyWaitlist(env: Env, ev: EventRow, sessions: SessionRow[], reg: RegistrationRow, event: boolean, tour: boolean, verb: string) {
	if (!event && !tour) return;
	const what = [event ? 'the in-person waiting list' : null, tour ? `the ${sessions.find((t) => t.id === reg.tour_id)?.label} waiting list` : null].filter(Boolean).join(' and ');
	await sendEmail(env, notification(brand(env), `New waiting-list registration: ${ev.title}`, [
		`${reg.name}${reg.affiliation ? ` (${reg.affiliation})` : ''} ${verb} ${what}.`,
		...(await totalsLines(env, ev, sessions)),
	]));
}

export function publicStatus(reg: RegistrationRow, sessions: SessionRow[]) {
	const tour = reg.tour_id ? sessions.find((t) => t.id === reg.tour_id) : null;
	return {
		name: reg.name, email: reg.email, attendance: reg.attendance, affiliation: reg.affiliation, needs: reg.needs, extra_answer: reg.extra_answer ?? null, share_contact: !!reg.share_contact,
		status: reg.status, place: reg.place, tour_id: reg.tour_id, tour_label: tour?.label ?? null, tour_place: reg.tour_place,
		hold_expires_at: reg.status === 'pending' ? reg.hold_expires_at : null,
	};
}

/** Confirms the email address. Idempotent. Sends joining instructions unless the person is waitlisted in person. */
export async function confirm(env: Env, id: string) {
	let reg = await getRegistration(env, id);
	if (!reg) throw new UserError('This registration no longer exists. Unconfirmed registrations are deleted after a while, so please register again.', 404);
	const ev = await getEvent(env, reg.event_id);
	const sessions = await getSessions(env, ev.id);
	if (reg.status === 'confirmed') return { ok: true as const, already: true, registration: publicStatus(reg, sessions) };

	const now = nowIso();
	let place = reg.place, tour_place = reg.tour_place;
	if (reg.hold_expires_at && reg.hold_expires_at <= now) {
		// Hold lapsed but not yet swept: re-check availability as if registering now (this row no longer holds a place).
		const cap = await capacity(env, ev, sessions, now);
		if (reg.attendance === 'in_person') place = cap.inPerson.available ? 'place' : 'waitlist';
		if (reg.tour_id) tour_place = cap.tours.find((t) => t.id === reg!.tour_id)?.available ? 'place' : 'waitlist';
	}
	const joinsWaitlist = place === 'waitlist';
	const joinsTourWaitlist = tour_place === 'waitlist';
	await env.DB.prepare(
		`UPDATE registrations SET status='confirmed', confirmed_at=?, updated_at=?, hold_expires_at=NULL, place=?, tour_place=?,
			waitlist_since = CASE WHEN ? THEN ? ELSE NULL END, tour_waitlist_since = CASE WHEN ? THEN ? ELSE NULL END
		 WHERE id=? AND status='pending'`,
	).bind(now, now, place, tour_place, joinsWaitlist ? 1 : 0, now, joinsTourWaitlist ? 1 : 0, now, id).run();
	reg = (await getRegistration(env, id))!;

	if (!joinsWaitlist) await sendInstructions(env, ev, reg, sessions);
	await notifyWaitlist(env, ev, sessions, reg, joinsWaitlist, joinsTourWaitlist, 'has confirmed and joined');
	await syncHosts(env, brand(env), ev, sessions);
	return { ok: true as const, already: false, registration: publicStatus(reg, sessions) };
}

export async function manageView(env: Env, id: string) {
	const reg = await getRegistration(env, id);
	if (!reg) throw new UserError('This registration no longer exists.', 404);
	const ev = await getEvent(env, reg.event_id);
	const sessions = await getSessions(env, ev.id);
	const cap = await capacity(env, ev, sessions);
	const murl = await manageUrl(env, reg.id);
	const ics = await icsUrlFor(env, reg.id);
	return {
		ok: true as const,
		event: { id: ev.id, title: ev.title, starts_at: ev.starts_at, deadline: ev.deadline, page_path: ev.page_path, open: registrationOpen(ev) },
		tours: cap.tours.map((t) => ({ id: t.id, label: t.label, available: t.available, open: t.open })),
		registration: publicStatus(reg, sessions),
		calendar: entriesFor(env, ev, sessions, reg, murl).map((e) => ({ key: e.key, summary: e.summary, start: e.start, url: ics(e.key) })),
	};
}

/** Changes by the registrant. Email cannot change (cancel and re-register instead). Moves are re-checked against capacity. */
export async function updateRegistration(env: Env, id: string, input: RegistrationInput) {
	const reg = await getRegistration(env, id);
	if (!reg) throw new UserError('This registration no longer exists.', 404);
	const ev = await getEvent(env, reg.event_id);
	const sessions = await getSessions(env, ev.id);
	const c = parseCommon(input, sessions);
	const now = nowIso();
	const cap = await capacity(env, ev, sessions, now);

	let place = reg.place, waitlist_since = reg.waitlist_since;
	if (c.attendance === 'remote') {
		place = null;
		waitlist_since = null;
	} else if (reg.attendance === 'remote') {
		if (!registrationOpen(ev)) throw new UserError('Registration has closed, so in-person places can no longer be added. Please email ' + notifyEmail(env) + '.', 409);
		place = cap.inPerson.available ? 'place' : 'waitlist';
		waitlist_since = place === 'waitlist' && reg.status === 'confirmed' ? now : null;
	}
	let tour_place = reg.tour_place, tour_waitlist_since = reg.tour_waitlist_since;
	if (c.tour_id !== reg.tour_id) {
		const old = reg.tour_id ? sessions.find((s) => s.id === reg.tour_id) : null;
		// Switching to remote drops the tour even after its booking has closed; otherwise a closed tour cannot be changed.
		if (old && !sessionBookingOpen(old) && c.attendance !== 'remote') throw new UserError(`The ${old.label} has started or its booking has closed, so it can no longer be changed.`, 409);
		if (c.tour_id) {
			const t = sessions.find((s) => s.id === c.tour_id)!;
			if (!sessionBookingOpen(t)) throw new UserError(`Booking for the ${t.label} has closed.`, 409);
			tour_place = cap.tours.find((x) => x.id === c.tour_id)!.available ? 'place' : 'waitlist';
			tour_waitlist_since = tour_place === 'waitlist' && reg.status === 'confirmed' ? now : null;
		} else {
			tour_place = null;
			tour_waitlist_since = null;
		}
	}
	await env.DB.prepare(
		`UPDATE registrations SET name=?, attendance=?, affiliation=?, needs=?, extra_answer=?, share_contact=?, place=?, waitlist_since=?, tour_id=?, tour_place=?,
			tour_waitlist_since=?, updated_at=? WHERE id=?`,
	).bind(c.name, c.attendance, c.affiliation, c.needs, c.extra_answer, c.share_contact, place, waitlist_since, c.tour_id, tour_place, tour_waitlist_since, now, id).run();
	if (reg.status === 'confirmed') {
		const updated = (await getRegistration(env, id))!;
		const newEvent = updated.place === 'waitlist' && reg.place !== 'waitlist';
		const newTour = updated.tour_place === 'waitlist' && !(reg.tour_place === 'waitlist' && reg.tour_id === updated.tour_id);
		await notifyWaitlist(env, ev, sessions, updated, newEvent, newTour, 'changed their registration and joined');
		// A remote registrant moving in person gets full joining instructions once they have a place; otherwise only calendar changes go out.
		if (reg.attendance === 'remote' && updated.attendance === 'in_person' && updated.place === 'place') await sendInstructions(env, ev, updated, sessions);
		else await syncCalendar(env, ev, updated, sessions);
		await syncHosts(env, brand(env), ev, sessions);
	}
	return manageView(env, id);
}

/** Deletes the registration, confirms to the person (cancelling their calendar entries) and tells the organiser. */
export async function cancel(env: Env, id: string) {
	const reg = await getRegistration(env, id);
	if (!reg) throw new UserError('This registration no longer exists.', 404);
	const ev = await getEvent(env, reg.event_id);
	const sessions = await getSessions(env, ev.id);
	await env.DB.prepare('DELETE FROM registrations WHERE id = ?').bind(id).run();
	const state = parseState(reg.calendar_state);
	const files = attachments(env, ev, reg, [], Object.values(state).map((s) => ({ ...s, seq: s.seq + 1 })));
	await sendEmail(env, cancellationEmail(brand(env), ev, reg, `${siteUrl(env)}${ev.page_path}`, files));
	const detail = reg.attendance === 'remote' ? 'remote' : reg.place === 'waitlist' ? 'in person, waiting list' : 'in person';
	await sendEmail(env, notification(brand(env), `Cancellation: ${ev.title}`, [
		`${reg.name}${reg.affiliation ? ` (${reg.affiliation})` : ''} cancelled (${reg.status}, ${detail}${reg.tour_id ? `, ${sessions.find((t) => t.id === reg.tour_id)?.label ?? 'tour'} ${reg.tour_place ?? ''}` : ''}).`,
		...(await totalsLines(env, ev, sessions)),
	]));
	await syncHosts(env, brand(env), ev, sessions);
	return { ok: true as const };
}

/** .ics download for one of the registrant's calendar entries (METHOD:PUBLISH, for calendars that import files). */
export async function calendarFile(env: Env, id: string, key: string) {
	const reg = await getRegistration(env, id);
	if (!reg) throw new UserError('This registration no longer exists.', 404);
	const ev = await getEvent(env, reg.event_id);
	const sessions = await getSessions(env, ev.id);
	const entry = entriesFor(env, ev, sessions, reg, await manageUrl(env, id)).find((e) => e.key === key);
	if (!entry) throw new UserError('No such calendar entry.', 404);
	const seq = parseState(reg.calendar_state)[key]?.seq ?? 0;
	return buildIcs({ method: 'PUBLISH', entry, sequence: seq, organizer: { name: orgName(env), email: notifyEmail(env) }, tz: ev.timezone });
}

// ---------- admin ----------

export async function promote(env: Env, id: string, what: 'event' | 'tour') {
	const reg = await getRegistration(env, id);
	if (!reg || reg.status !== 'confirmed') throw new UserError('Only confirmed registrations can be promoted.', 404);
	const ev = await getEvent(env, reg.event_id);
	const sessions = await getSessions(env, ev.id);
	if (what === 'event') {
		if (reg.attendance !== 'in_person' || reg.place !== 'waitlist') throw new UserError('This person is not on the in-person waiting list.');
		await env.DB.prepare(`UPDATE registrations SET place='place', waitlist_since=NULL, updated_at=? WHERE id=?`).bind(nowIso(), id).run();
	} else {
		if (reg.tour_place !== 'waitlist') throw new UserError('This person is not on a tour waiting list.');
		await env.DB.prepare(`UPDATE registrations SET tour_place='place', tour_waitlist_since=NULL, updated_at=? WHERE id=?`).bind(nowIso(), id).run();
	}
	const updated = (await getRegistration(env, id))!;
	// Someone still waiting for an in-person place gets instructions only once they have one.
	if (!(updated.attendance === 'in_person' && updated.place === 'waitlist')) await sendInstructions(env, ev, updated, sessions);
	await syncHosts(env, brand(env), ev, sessions);
	return { ok: true as const };
}

export async function adminDelete(env: Env, id: string) {
	const reg = await getRegistration(env, id);
	await env.DB.prepare('DELETE FROM registrations WHERE id = ?').bind(id).run();
	if (reg) {
		const ev = await getEvent(env, reg.event_id);
		await syncHosts(env, brand(env), ev, await getSessions(env, ev.id));
	}
	return { ok: true as const };
}

export interface Audience {
	attendance?: 'all' | 'in_person' | 'remote';
	tour_id?: string; // a tour session id, 'none' for no tour, or undefined for any
	below_version?: number; // only people whose last joining instructions are older than this version
	include_waitlist?: boolean; // include people waiting for an in-person place
}

export function parseAudience(v: unknown): Audience {
	const a = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
	return {
		attendance: a.attendance === 'in_person' || a.attendance === 'remote' ? a.attendance : 'all',
		tour_id: typeof a.tour_id === 'string' && a.tour_id ? a.tour_id : undefined,
		below_version: Number.isInteger(a.below_version) && (a.below_version as number) > 0 ? (a.below_version as number) : undefined,
		include_waitlist: a.include_waitlist === true,
	};
}

export async function audienceRecipients(env: Env, eventId: string, a: Audience): Promise<RegistrationRow[]> {
	const where = [`event_id = ?`, `status = 'confirmed'`];
	const binds: unknown[] = [eventId];
	if (a.attendance && a.attendance !== 'all') { where.push('attendance = ?'); binds.push(a.attendance); }
	if (!a.include_waitlist) where.push(`NOT (attendance = 'in_person' AND place = 'waitlist')`);
	if (a.tour_id === 'none') where.push('tour_id IS NULL');
	else if (a.tour_id) { where.push('tour_id = ?'); binds.push(a.tour_id); }
	if (a.below_version) { where.push('instructions_version < ?'); binds.push(a.below_version); }
	return (await env.DB.prepare(`SELECT * FROM registrations WHERE ${where.join(' AND ')} ORDER BY created_at`).bind(...binds).all<RegistrationRow>()).results;
}

interface MessageRow {
	id: string; event_id: string; subject: string; body_md: string; audience: string; marks_instructions_version: number | null;
	status: string; scheduled_at: string | null; sent_at: string | null; recipients_count: number | null; error: string | null;
	created_at: string; created_by: string | null;
}

export async function createMessage(env: Env, eventId: string, input: Record<string, unknown>, createdBy: string) {
	await getEvent(env, eventId);
	const subject = cleanText(input.subject, 200);
	const body = typeof input.body_md === 'string' ? input.body_md.trim().slice(0, 20000) : '';
	if (!subject || !body) throw new UserError('Subject and message are required.');
	const audience = parseAudience(input.audience);
	let scheduled_at: string | null = null;
	if (input.scheduled_at) {
		const t = Date.parse(String(input.scheduled_at));
		if (Number.isNaN(t)) throw new UserError('Invalid schedule time.');
		if (t > Date.now() + 60_000) scheduled_at = new Date(t).toISOString();
	}
	const marks = Number.isInteger(input.marks_instructions_version) && (input.marks_instructions_version as number) > 0 ? (input.marks_instructions_version as number) : null;
	const id = randomToken(12);
	await env.DB.prepare(
		`INSERT INTO messages (id, event_id, subject, body_md, audience, marks_instructions_version, status, scheduled_at, created_at, created_by)
		 VALUES (?,?,?,?,?,?,?,?,?,?)`,
	).bind(id, eventId, subject, body, JSON.stringify(audience), marks, scheduled_at ? 'scheduled' : 'sending', scheduled_at, nowIso(), createdBy).run();
	if (!scheduled_at) await deliverMessage(env, id);
	return env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first<MessageRow>();
}

/** Sends a message to its audience, recording each delivery. Safe to call from the cron: claims the row first. */
export async function deliverMessage(env: Env, id: string) {
	const claim = await env.DB.prepare(`UPDATE messages SET status='sending' WHERE id=? AND status IN ('scheduled','sending') RETURNING *`).bind(id).first<MessageRow>();
	if (!claim) return;
	try {
		const recipients = await audienceRecipients(env, claim.event_id, JSON.parse(claim.audience));
		const emails: OutgoingEmail[] = [];
		for (const r of recipients) emails.push(messageEmail(brand(env), r, claim, await manageUrl(env, r.id)));
		const ids = await sendBatch(env, emails);
		const stmts = recipients.map((r, i) =>
			env.DB.prepare('INSERT INTO deliveries (registration_id, kind, message_id, instructions_version, sent_at, provider_id) VALUES (?,?,?,?,?,?)')
				.bind(r.id, 'message', id, claim.marks_instructions_version, nowIso(), ids[i] ?? null));
		if (claim.marks_instructions_version) {
			for (const r of recipients) stmts.push(env.DB.prepare('UPDATE registrations SET instructions_version = MAX(instructions_version, ?) WHERE id = ?').bind(claim.marks_instructions_version, r.id));
		}
		stmts.push(env.DB.prepare(`UPDATE messages SET status='sent', sent_at=?, recipients_count=? WHERE id=?`).bind(nowIso(), recipients.length, id));
		await env.DB.batch(stmts);
	} catch (e) {
		await env.DB.prepare(`UPDATE messages SET status='failed', error=? WHERE id=?`).bind(String(e).slice(0, 500), id).run();
		throw e;
	}
}

export async function cancelMessage(env: Env, id: string) {
	const r = await env.DB.prepare(`UPDATE messages SET status='cancelled' WHERE id=? AND status='scheduled' RETURNING id`).bind(id).first();
	if (!r) throw new UserError('Only scheduled messages that have not started sending can be cancelled.', 409);
	return { ok: true as const };
}

export async function listMessages(env: Env, eventId: string) {
	return (await env.DB.prepare('SELECT * FROM messages WHERE event_id = ? ORDER BY COALESCE(sent_at, scheduled_at, created_at) DESC').bind(eventId).all<MessageRow>()).results;
}

export async function listInstructions(env: Env, eventId: string) {
	return (await env.DB.prepare('SELECT * FROM instructions WHERE event_id = ? ORDER BY version DESC').bind(eventId).all()).results;
}

export async function addInstructions(env: Env, eventId: string, input: Record<string, unknown>, createdBy: string) {
	await getEvent(env, eventId);
	const subject = cleanText(input.subject, 200);
	const body = typeof input.body_md === 'string' ? input.body_md.trim().slice(0, 20000) : '';
	if (!subject || !body) throw new UserError('Subject and body are required.');
	const latest = await latestInstructions(env, eventId);
	const version = (latest?.version ?? 0) + 1;
	await env.DB.prepare('INSERT INTO instructions (event_id, version, subject, body_md, change_note, created_at, created_by) VALUES (?,?,?,?,?,?,?)')
		.bind(eventId, version, subject, body, cleanText(input.change_note, 1000), nowIso(), createdBy).run();
	return { ok: true as const, version };
}

const optDate = (v: unknown, label: string) => {
	if (v === null || v === '') return null;
	const t = Date.parse(String(v));
	if (Number.isNaN(t)) throw new UserError(`Invalid ${label}.`);
	return new Date(t).toISOString();
};

export async function updateSettings(env: Env, eventId: string, input: Record<string, unknown>) {
	const ev = await getEvent(env, eventId);
	const max = input.in_person_max === undefined ? ev.in_person_max : Number(input.in_person_max);
	if (!Number.isInteger(max) || max < 0 || max > 10000) throw new UserError('In-person maximum must be a whole number.');
	const deadline = input.deadline === undefined ? ev.deadline : optDate(input.deadline, 'deadline') ?? ev.deadline;
	const travel = input.travel_minutes === undefined ? ev.travel_minutes : Number(input.travel_minutes);
	if (!Number.isInteger(travel) || travel < 0 || travel > 1440) throw new UserError('Travel time must be a whole number of minutes.');
	await env.DB.prepare('UPDATE events SET in_person_max=?, deadline=?, travel_minutes=? WHERE id=?').bind(max, deadline, travel, eventId).run();
	return { ok: true as const, calendar_updates: travel !== ev.travel_minutes ? await resyncCalendars(env, eventId) : 0 };
}

/**
 * Admin edits to sessions: times, location, online link, host, capacity, booking deadline.
 * Afterwards, anyone whose calendar entries changed gets updated invitations, and hosts get new lists.
 * { dry_run: true } reports how many people would get a calendar update, without changing anything.
 */
export async function updateSessions(env: Env, eventId: string, input: Record<string, unknown>) {
	const ev = await getEvent(env, eventId);
	const sessions = await getSessions(env, ev.id);
	const edits = Array.isArray(input.sessions) ? (input.sessions as Record<string, unknown>[]) : [];
	const next = sessions.map((s) => ({ ...s }));
	for (const e of edits) {
		const s = next.find((x) => x.id === e.id);
		if (!s) throw new UserError('Unknown session.');
		if (e.starts_at !== undefined) s.starts_at = optDate(e.starts_at, 'start time') ?? s.starts_at;
		if (e.ends_at !== undefined) s.ends_at = optDate(e.ends_at, 'end time') ?? s.ends_at;
		if (Date.parse(s.ends_at) <= Date.parse(s.starts_at)) throw new UserError(`${s.label}: the end must be after the start.`);
		if (e.location !== undefined) s.location = cleanText(e.location, 300);
		if (e.online_url !== undefined) {
			const u = cleanText(e.online_url, 500);
			if (u && !/^https:\/\//.test(u)) throw new UserError('Online links must start with https://');
			s.online_url = u;
		}
		if (e.host_name !== undefined) s.host_name = cleanText(e.host_name, 120);
		if (e.host_email !== undefined) {
			const h = cleanText(e.host_email, 254)?.toLowerCase() ?? null;
			if (h && !EMAIL_RE.test(h)) throw new UserError('Invalid host email.');
			s.host_email = h;
		}
		if (e.capacity !== undefined) {
			const c = e.capacity === null || e.capacity === '' ? null : Number(e.capacity);
			if (c !== null && (!Number.isInteger(c) || c < 0 || c > 10000)) throw new UserError('Capacity must be a whole number.');
			s.capacity = c;
		}
		if (e.booking_deadline !== undefined) s.booking_deadline = optDate(e.booking_deadline, 'booking deadline');
	}
	if (input.dry_run === true) {
		let n = 0;
		for (const r of await confirmedRegs(env, ev.id)) {
			const p = await plan(parseState(r.calendar_state), entriesFor(env, ev, next, r, await manageUrl(env, r.id)));
			if (p.requests.length || p.cancels.length) n++;
		}
		return { ok: true as const, calendar_updates: n };
	}
	const stmts = [];
	for (const s of next) {
		const old = sessions.find((x) => x.id === s.id)!;
		if (JSON.stringify(old) === JSON.stringify(s)) continue;
		stmts.push(env.DB.prepare('UPDATE sessions SET starts_at=?, ends_at=?, location=?, online_url=?, host_name=?, host_email=?, capacity=?, booking_deadline=? WHERE id=?')
			.bind(s.starts_at, s.ends_at, s.location, s.online_url, s.host_name, s.host_email, s.capacity, s.booking_deadline, s.id));
		// A new host gets the whole list, not a diff against the previous host's.
		if (old.host_email !== s.host_email) stmts.push(env.DB.prepare('DELETE FROM host_snapshots WHERE session_id=?').bind(s.id));
	}
	if (stmts.length) await env.DB.batch(stmts);
	const updates = await resyncCalendars(env, ev.id);
	await syncHosts(env, brand(env), ev, await getSessions(env, ev.id));
	return { ok: true as const, calendar_updates: updates };
}

const confirmedRegs = async (env: Env, eventId: string) =>
	(await env.DB.prepare(`SELECT * FROM registrations WHERE event_id = ? AND status = 'confirmed'`).bind(eventId).all<RegistrationRow>()).results;

async function resyncCalendars(env: Env, eventId: string) {
	const ev = await getEvent(env, eventId);
	const sessions = await getSessions(env, ev.id);
	let n = 0;
	for (const r of await confirmedRegs(env, ev.id)) {
		// People who have never been sent a calendar (e.g. still waiting) are skipped by the plan itself.
		if (await syncCalendar(env, ev, r, sessions)) n++;
	}
	return n;
}

/** With no event id, the most recent event is shown. */
export async function adminSummary(env: Env, eventId: string) {
	if (!eventId) eventId = (await env.DB.prepare('SELECT id FROM events ORDER BY starts_at DESC LIMIT 1').first<{ id: string }>())?.id ?? '';
	const ev = await getEvent(env, eventId);
	const sessions = await getSessions(env, ev.id);
	const cap = await capacity(env, ev, sessions);
	const regs = (await env.DB.prepare('SELECT * FROM registrations WHERE event_id = ? ORDER BY created_at').bind(ev.id).all<RegistrationRow>()).results;
	const latest = await latestInstructions(env, ev.id);
	return {
		ok: true as const, event: ev, sessions, tours: tourSessions(sessions), capacity: cap,
		registrations: regs.map(({ calendar_state: _c, ...r }) => r), latest_instructions_version: latest?.version ?? 0,
	};
}

export function registrationsCsv(regs: Omit<RegistrationRow, 'calendar_state'>[], sessions: SessionRow[]): string {
	const cols = ['name', 'email', 'attendance', 'status', 'place', 'tour', 'tour_place', 'affiliation', 'needs', 'extra_answer', 'share_contact', 'instructions_version', 'created_at', 'confirmed_at'];
	const esc = (v: unknown) => {
		let s = v == null ? '' : String(v);
		if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // defuse spreadsheet formula injection
		return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	const rows = regs.map((r) => [r.name, r.email, r.attendance, r.status, r.place, sessions.find((t) => t.id === r.tour_id)?.label ?? '', r.tour_place,
		r.affiliation, r.needs, r.extra_answer ?? '', r.share_contact ? 'yes' : 'no', r.instructions_version, r.created_at, r.confirmed_at].map(esc).join(','));
	return [cols.join(','), ...rows].join('\r\n') + '\r\n';
}

/** Markdown record of joining-instruction versions and everything sent, for review (and for Claude to draft updates). */
export async function sentLogMarkdown(env: Env, eventId: string): Promise<string> {
	const ev = await getEvent(env, eventId);
	const instr = await listInstructions(env, eventId) as { version: number; subject: string; body_md: string; change_note: string | null; created_at: string }[];
	const msgs = await listMessages(env, eventId);
	const sessions = await getSessions(env, eventId);
	const regs = (await env.DB.prepare(`SELECT instructions_version AS v, COUNT(*) AS n FROM registrations WHERE event_id=? AND status='confirmed' GROUP BY instructions_version`).bind(eventId).all<{ v: number; n: number }>()).results;
	const out = [`# Sent log: ${ev.title}`, '', `Exported ${nowIso()}.`, '', '## Who has which joining-instructions version', '',
		...regs.map((r) => `- Version ${r.v}: ${r.n} confirmed registrant(s)${r.v === 0 ? ' (none yet: waiting list)' : ''}`), '',
		'## Sessions (what calendar entries are built from)', '',
		...sessions.map((s) => `- ${s.label}: ${s.starts_at} to ${s.ends_at}, ${s.mode}${s.location ? `, ${s.location}` : ''}${s.online_url ? ', online link set' : ''}${s.host_email ? ', has a host' : ''}`), '',
		'## Joining instructions versions (newest first)', ''];
	for (const i of instr) out.push(`### Version ${i.version} – ${i.created_at}`, '', `Subject: ${i.subject}`, '', `Change note: ${i.change_note ?? '–'}`, '', i.body_md, '');
	out.push('## Messages sent or scheduled (newest first)', '');
	for (const m of msgs) {
		out.push(`### ${m.subject}`, '', `- Status: ${m.status}${m.sent_at ? `, sent ${m.sent_at}` : ''}${m.scheduled_at ? `, scheduled for ${m.scheduled_at}` : ''}`,
			`- Recipients: ${m.recipients_count ?? '–'}`, `- Audience: \`${m.audience}\``,
			`- Counts as joining instructions version: ${m.marks_instructions_version ?? '–'}`, '', m.body_md, '');
	}
	return out.join('\n');
}

// ---------- scheduled jobs (companion cron Worker, or /api/dev/cron locally) ----------

export async function runScheduled(env: Env, now = Date.now()) {
	const nowS = new Date(now).toISOString();
	const report = { messagesSent: 0, holdsWarned: 0, holdsExpired: 0, retentionDeleted: 0 };

	const due = (await env.DB.prepare(`SELECT id FROM messages WHERE status='scheduled' AND scheduled_at <= ?`).bind(nowS).all<{ id: string }>()).results;
	for (const m of due) {
		try { await deliverMessage(env, m.id); report.messagesSent++; } catch (e) { console.error('message failed', m.id, e); }
	}

	const pending = (await env.DB.prepare(`SELECT * FROM registrations WHERE status='pending'`).all<RegistrationRow>()).results;
	for (const r of pending) {
		if (!r.hold_expires_at) continue;
		const exp = Date.parse(r.hold_expires_at), start = Date.parse(r.created_at);
		if (exp <= now) {
			await env.DB.prepare(`DELETE FROM registrations WHERE id=? AND status='pending'`).bind(r.id).run();
			report.holdsExpired++;
		} else if (!r.hold_warned_at && now >= start + (exp - start) / 2) {
			const ev = await getEvent(env, r.event_id);
			await sendEmail(env, notification(brand(env), `Unconfirmed registration half way to expiry: ${ev.title}`, [
				`${r.name} <${r.email}> registered at ${r.created_at} but has not confirmed their email address.`,
				`Their ${r.attendance === 'in_person' ? (r.place === 'place' ? 'held in-person place' : 'waiting-list request') : 'remote registration'} will be deleted at ${r.hold_expires_at} unless they confirm.`,
			]));
			await env.DB.prepare('UPDATE registrations SET hold_warned_at=? WHERE id=?').bind(nowS, r.id).run();
			report.holdsWarned++;
		}
	}

	// Retention: registrations, their delivery records and host lists are deleted 30 days after the event ends.
	const cutoff = new Date(now - 30 * 24 * HOUR).toISOString();
	const r = await env.DB.prepare(`DELETE FROM registrations WHERE event_id IN (SELECT id FROM events WHERE ends_at <= ?)`).bind(cutoff).run();
	report.retentionDeleted = r.meta.changes ?? 0;
	await env.DB.prepare(`DELETE FROM host_snapshots WHERE session_id IN (SELECT s.id FROM sessions s JOIN events e ON e.id = s.event_id WHERE e.ends_at <= ?)`).bind(cutoff).run();
	await env.DB.prepare('DELETE FROM dev_outbox WHERE created_at <= ?').bind(cutoff).run();
	return report;
}

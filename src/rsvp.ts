// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import { attachments, entriesFor, hashEntry, liveState, parseState, plan, saveState } from './calendar';
import { type Env, fromAddress, notifyEmail, orgName, privacyUrl, siteUrl, sourceUrl } from './env';
import { IdempotencyConflict, sendBatch, sendEmail, type OutgoingEmail } from './email';
import { syncHosts } from './hosts';
import { buildIcs } from './ics';
import {
	alreadyRegisteredIntro, type Brand, calendarUpdateEmail, cancellationEmail, confirmEmail, declinedEmail, type EventRow, instructionsEmail, messageEmail,
	hostReleasedEmail, notification, onlyWaiting, optedIn, optinWaiting, type RegistrationRow, type SessionRow, waitingForPlace, waitlistReminderEmail,
} from './templates';
import { modeOf } from './mode';
import { mdToHtml, mdToText } from './markdown';
import { adminPolls, parseBookingBallots, saveBookingBallots, unansweredPolls, voterPolls } from './polls';
import { recordCronRun } from './health';
import { makeToken } from './tokens';
import { cleanLine, cleanText, EMAIL_RE, escapeHtml, nowIso, randomToken, sha256, ukDateTime } from './util';

const HOUR = 3600_000;
export const MAX_HOLD_MS = 48 * HOUR;
/** Abuse limits: how often a confirmed address is reminded that it is registered, how many times an unconfirmed
 * registration may be replaced (each replacement sends a fresh confirm email), and how many emails a registrant's own
 * changes may trigger in an hour (each change can email hosts and the organiser too). */
const REMINDER_COOLDOWN_MS = 10 * 60_000;
const MAX_RESENDS = 3;
const MAX_REMINDERS_A_DAY = 3;
const MAX_CHANGE_EMAILS_PER_HOUR = 10;

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

/** The event's own wording for the forms; null where the components' defaults should be used. */
export const eventLabels = (ev: EventRow) => ({ in_person_label: ev.in_person_label ?? null, remote_label: ev.remote_label ?? null, tour_legend: ev.tour_legend ?? null });

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
			SUM(CASE WHEN attendance='in_person' AND place='place' AND ${held.replace('?', '?1')} THEN 1 ELSE 0 END) AS held,
			SUM(CASE WHEN attendance='in_person' AND place='waitlist' AND status='confirmed' THEN 1 ELSE 0 END) AS waiting,
			SUM(CASE WHEN attendance='in_person' AND place='place' AND status='confirmed' THEN 1 ELSE 0 END) AS confirmed,
			SUM(CASE WHEN attendance='remote' AND status='confirmed' THEN 1 ELSE 0 END) AS remote,
			SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
			SUM(CASE WHEN attendance='in_person' AND place='place' AND status='pending' AND hold_expires_at > ?1 THEN 1 ELSE 0 END) AS pendingHeld
		 FROM registrations WHERE event_id = ?2`,
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
	// Opt-in sessions (e.g. dinner): everyone who ticked one is in optins; those still waiting are also in optins_waiting.
	const listed = (col: string) => listedIn(col, '?1');
	const optins = [];
	for (const s of sessions.filter((x) => x.optin)) {
		const r = await env.DB.prepare(
			`SELECT
				SUM(CASE WHEN ${listed('optins_waiting')} THEN 0 WHEN status = 'confirmed' OR (status = 'pending' AND hold_expires_at > ?2) THEN 1 ELSE 0 END) AS held,
				SUM(CASE WHEN ${listed('optins_waiting')} THEN 0 WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
				SUM(CASE WHEN ${listed('optins_waiting')} AND status = 'confirmed' THEN 1 ELSE 0 END) AS waiting
			 FROM registrations WHERE event_id = ?3 AND attendance = 'in_person' AND ${listed('optins')}`,
		).bind(s.id, now, ev.id).first<{ held: number | null; confirmed: number | null; waiting: number | null }>();
		const held = n(r?.held), waiting = n(r?.waiting);
		optins.push({ id: s.id, label: s.label, capacity: s.capacity, held, confirmed: n(r?.confirmed), waiting, available: held < (s.capacity ?? Infinity) && waiting === 0 });
	}
	return {
		inPerson: {
			max: ev.in_person_max, held: n(inPerson?.held), confirmed: n(inPerson?.confirmed), waiting: n(inPerson?.waiting),
			available: n(inPerson?.held) < ev.in_person_max && n(inPerson?.waiting) === 0,
			pendingHeld: n(inPerson?.pendingHeld),
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
		optins,
	};
}

/** SQL: whether the comma-separated list in `col` contains the bound session id (instr, so an id with `_` or `%` is literal). */
const listedIn = (col: string, param: string) => `instr(',' || COALESCE(${col}, '') || ',', ',' || ${param} || ',') > 0`;
const ids = (list: string | null | undefined) => (list ?? '').split(',').filter(Boolean);
const joinIds = (list: string[]) => list.join(',') || null;

/**
 * How many in-person places unconfirmed registrations may hold at once. Anyone can register any address, so without a
 * limit made-up registrations could hold every place for up to 48 hours. Beyond it, a new registration holds nothing and
 * gets a place when it is confirmed, if one is free then.
 */
export const holdLimit = (ev: EventRow) => Math.max(5, Math.ceil(ev.in_person_max / 4));

/** Hold for unconfirmed registrations: the shorter of 48 hours or a third of the time left to the deadline. */
export function holdMs(ev: EventRow, now = Date.now()): number {
	const third = Math.max(0, (Date.parse(ev.deadline) - now) / 3);
	return Math.max(15 * 60_000, Math.min(MAX_HOLD_MS, third));
}

/** at: a fixed time for the link's expiry, so an email sent again on a retry is the same email. */
export async function manageUrl(env: Env, id: string, at?: number) {
	return `${siteUrl(env)}/events/manage/?t=${encodeURIComponent(await makeToken(env, 'manage', id, at))}`;
}
export async function confirmUrl(env: Env, id: string) {
	return `${siteUrl(env)}/events/confirm/?t=${encodeURIComponent(await makeToken(env, 'confirm', id))}`;
}
export async function icsUrlFor(env: Env, id: string, at?: number) {
	const t = encodeURIComponent(await makeToken(env, 'calendar', id, at));
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
	optins?: unknown;
	consent?: unknown;
	share_contact?: unknown;
	/** Poll rankings from the booking form: [{ poll, ranking, bar }]. */
	polls?: unknown;
}

const truthy = (v: unknown) => v === true || v === 'on' || v === 'true' || v === 1 || v === '1';

function parseCommon(input: RegistrationInput, sessions: SessionRow[]) {
	const name = cleanLine(input.name, 120);
	if (!name) throw new UserError('Please enter your name.');
	// 'extras' (just the opt-in sessions, e.g. only the dinner) is stored as in person with no place: see mode.ts.
	const extras = input.attendance === 'extras';
	const attendance = input.attendance === 'remote' ? 'remote' : input.attendance === 'in_person' || extras ? 'in_person' : null;
	if (!attendance) throw new UserError('Please choose how you will attend.');
	let tour_id: string | null = null;
	if (attendance === 'in_person' && !extras && input.tour_id && input.tour_id !== 'none') {
		const t = tourSessions(sessions).find((x) => x.id === input.tour_id);
		if (!t) throw new UserError('Unknown tour.');
		tour_id = t.id;
	}
	const asked = Array.isArray(input.optins) ? input.optins.map(String) : typeof input.optins === 'string' && input.optins ? input.optins.split(',') : [];
	const optins = attendance === 'in_person' ? sessions.filter((s) => s.optin && asked.includes(s.id)).map((s) => s.id).join(',') || null : null;
	if (extras && !optins) throw new UserError('Please tick what you would like to join us for.');
	return {
		name, attendance, extras, tour_id, optins, affiliation: cleanLine(input.affiliation, 200), needs: cleanText(input.needs, 1000), extra_answer: cleanText(input.extra_answer, 500),
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

	// Checked before looking the address up, so the answer is the same whether or not the address is already registered.
	const tour = c.tour_id ? sessions.find((s) => s.id === c.tour_id)! : null;
	if (tour && !sessionBookingOpen(tour)) throw new UserError(`Booking for the ${tour.label} has closed.`, 409);
	for (const s of sessions.filter((x) => ids(c.optins).includes(x.id))) if (!sessionBookingOpen(s)) throw new UserError(`Booking for the ${s.label} has closed.`, 409);
	const ballots = await parseBookingBallots(env, ev, input.polls);

	const existing = await env.DB.prepare('SELECT * FROM registrations WHERE event_id = ? AND email = ?').bind(ev.id, email).first<RegistrationRow>();
	if (existing && existing.status === 'confirmed') {
		// One reminder per cooldown, and a few a day: repeated submissions must not let anyone flood a registered address.
		const recent = await env.DB.prepare(`SELECT SUM(sent_at > ?) AS soon, COUNT(*) AS day FROM deliveries WHERE registration_id = ? AND kind = 'already_registered' AND sent_at > ?`)
			.bind(new Date(Date.now() - REMINDER_COOLDOWN_MS).toISOString(), existing.id, new Date(Date.now() - 24 * HOUR).toISOString()).first<{ soon: number | null; day: number }>();
		if ((recent?.soon ?? 0) > 0 || (recent?.day ?? 0) >= MAX_REMINDERS_A_DAY) return { ok: true as const };
		if (waitingForPlace(existing, sessions)) {
			const pid = await sendEmail(env, waitlistReminderEmail(brand(env), ev, existing, sessions, await manageUrl(env, existing.id)));
			await recordDelivery(env, existing.id, 'already_registered', pid);
		} else {
			await sendInstructions(env, ev, existing, sessions, { intro: alreadyRegisteredIntro(ev, existing), resendAllCalendar: true, kind: 'already_registered' });
		}
		return { ok: true as const };
	}
	// An unconfirmed earlier registration is replaced by this one, so what the owner confirms is what they last asked for
	// (and the confirm email lists it). The earlier confirm link stops working. After a few replacements the address is
	// left alone until it confirms or the hold lapses: each replacement is another email to an address nobody has verified.
	const resends = existing ? (existing.resends ?? 0) + 1 : 0;
	if (resends > MAX_RESENDS) return { ok: true as const };
	if (existing) await env.DB.prepare(`DELETE FROM registrations WHERE id = ? AND status = 'pending'`).bind(existing.id).run();

	const now = Date.now();
	const nowS = new Date(now).toISOString();
	const cap = await capacity(env, ev, sessions, nowS);
	const unheld = c.attendance === 'in_person' && !c.extras && cap.inPerson.available && cap.inPerson.pendingHeld >= holdLimit(ev);
	const place = c.attendance === 'in_person' && !c.extras ? (cap.inPerson.available && !unheld ? 'place' : 'waitlist') : null;
	const tourCap = tour ? cap.tours.find((t) => t.id === tour.id)! : null;
	// Beyond the hold limit nothing is held, tours and opt-in sessions included: confirming decides all of them.
	const tour_place = tourCap ? (tourCap.available && !unheld ? 'place' : 'waitlist') : null;
	const optins_waiting = joinIds(ids(c.optins).filter((o) => unheld || !cap.optins.find((x) => x.id === o)!.available));
	const id = randomToken(16);
	try {
		await env.DB.prepare(
			`INSERT INTO registrations (id, event_id, name, email, attendance, affiliation, needs, extra_answer, optins, optins_waiting, share_contact, status, place, tour_id, tour_place,
				consent_at, created_at, updated_at, hold_expires_at, resends) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		).bind(id, ev.id, c.name, email, c.attendance, c.affiliation, c.needs, c.extra_answer, c.optins, optins_waiting, c.share_contact, 'pending', place, c.tour_id, tour_place,
			nowS, nowS, nowS, new Date(now + holdMs(ev, now)).toISOString(), resends).run();
	} catch (e) {
		// The same address submitted twice at once: the other submission's confirm email is on its way.
		if (/UNIQUE/i.test(String(e))) return { ok: true as const };
		throw e;
	}
	// D1 has no row locks: if two people took the last place at the same moment, the later one moves to the waiting list.
	const after = await capacity(env, ev, sessions, nowS);
	if (place === 'place' && after.inPerson.held > ev.in_person_max) await demoteIfLatest(env, id, 'place', nowS);
	const tourAfter = tour ? after.tours.find((t) => t.id === tour.id)! : null;
	if (tour && tour_place === 'place' && tourAfter && tour.capacity != null && tourAfter.held > tour.capacity) await demoteIfLatest(env, id, 'tour_place', nowS, tour.id);
	for (const o of after.optins) {
		if (o.capacity != null && o.held > o.capacity && ids(c.optins).includes(o.id) && !ids(optins_waiting).includes(o.id)) await demoteOptinIfLatest(env, id, o.id, nowS);
	}
	// Saved with the registration and deleted with it (a confirmed address registering again keeps its own answers above).
	await saveBookingBallots(env, id, ballots);
	const reg = (await getRegistration(env, id))!;
	let pid: string;
	try {
		pid = await sendEmail(env, confirmEmail(brand(env), ev, reg, sessions, await confirmUrl(env, id), { unheld }));
	} catch (e) {
		// Nobody can confirm a registration whose email never went out: do not keep their details or hold a place.
		await env.DB.prepare(`DELETE FROM registrations WHERE id = ? AND status = 'pending'`).bind(id).run();
		throw e;
	}
	await recordDelivery(env, id, 'confirm_email', pid);
	return { ok: true as const };
}

// "Newest" is by rowid, the order rows were actually inserted: created_at is stamped before the insert, so two
// simultaneous registrations could each see the other as newer and both keep the last place. Only rows that still hold
// a place count, so an expired hold cannot shield the real newest row.
const HELD = `(status = 'confirmed' OR (status = 'pending' AND hold_expires_at > ?))`;

/** Moves this registration to the waiting list if it is the newest of those over capacity. */
async function demoteIfLatest(env: Env, id: string, field: 'place' | 'tour_place', now: string, tourId?: string) {
	const reg = (await getRegistration(env, id))!;
	const newer = await env.DB.prepare(
		`SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND ${field} = 'place' AND ${HELD} AND rowid > (SELECT rowid FROM registrations WHERE id = ?) ${tourId ? 'AND tour_id = ?' : `AND attendance = 'in_person'`}`,
	).bind(...[reg.event_id, now, id, ...(tourId ? [tourId] : [])]).first<{ n: number }>();
	if ((newer?.n ?? 0) === 0) await env.DB.prepare(`UPDATE registrations SET ${field} = 'waitlist' WHERE id = ?`).bind(id).run();
}

/** Puts this registration on an opt-in session's waiting list if it is the newest of those with a place there. */
async function demoteOptinIfLatest(env: Env, id: string, sessionId: string, now: string) {
	const reg = (await getRegistration(env, id))!;
	const newer = await env.DB.prepare(
		`SELECT COUNT(*) AS n FROM registrations WHERE event_id = ?1 AND attendance = 'in_person' AND ${listedIn('optins', '?2')} AND NOT ${listedIn('optins_waiting', '?2')}
		 AND (status = 'confirmed' OR (status = 'pending' AND hold_expires_at > ?3)) AND rowid > (SELECT rowid FROM registrations WHERE id = ?4)`,
	).bind(reg.event_id, sessionId, now, id).first<{ n: number }>();
	if ((newer?.n ?? 0) === 0) await env.DB.prepare('UPDATE registrations SET optins_waiting = ? WHERE id = ?').bind(joinIds([...ids(reg.optins_waiting), sessionId]), id).run();
}

/**
 * Sends the latest joining instructions with the person's calendar. Invitations are attached only for new or
 * changed entries (or all of them when resendAllCalendar), and entries that no longer apply are cancelled.
 */
async function sendInstructions(env: Env, ev: EventRow, reg: RegistrationRow, sessions: SessionRow[],
	opts: { intro?: { html: string; text: string }; resendAllCalendar?: boolean; kind?: string; subject?: string; idempotencyKey?: string;
		instructions?: { version: number; subject: string; body_md: string }; at?: number } = {}) {
	// Without a saved version yet, people still get their status, manage link and calendar, and a promise of instructions.
	const instr = opts.instructions ?? (await latestInstructions(env, ev.id))
		?? { version: 0, subject: `Your registration: ${ev.title}`, body_md: 'Joining instructions will follow by email nearer the day.' };
	const murl = await manageUrl(env, reg.id, opts.at);
	const p = await plan(parseState(reg.calendar_state), entriesFor(env, ev, sessions, reg));
	const send = opts.resendAllCalendar ? [...p.requests, ...p.unchanged] : p.requests;
	const files = attachments(env, ev, reg, send, p.cancels, opts.at);
	const mail = instructionsEmail(brand(env), ev, reg, sessions, instr, murl, { entries: p.entries, icsUrl: await icsUrlFor(env, reg.id, opts.at) }, files, opts.intro, await unansweredPolls(env, ev, reg.id));
	if (opts.subject) mail.subject = opts.subject;
	const pid = await sendEmail(env, mail, opts.idempotencyKey);
	// MAX: a message carrying an older version must not mark someone who already has a newer one as behind.
	await env.DB.prepare('UPDATE registrations SET instructions_version = MAX(instructions_version, ?), calendar_state = ? WHERE id = ?').bind(instr.version, JSON.stringify(p.state), reg.id).run();
	await recordDelivery(env, reg.id, opts.kind ?? 'instructions', pid, { version: instr.version });
}

/** Sends updated or cancelled invitations if, and only if, this person's calendar entries changed. */
/** opts.at and an idempotency key from the planned calendar make a retried update the same email, sent once. */
async function syncCalendar(env: Env, ev: EventRow, reg: RegistrationRow, sessions: SessionRow[], opts: { at?: number } = {}) {
	const murl = await manageUrl(env, reg.id, opts.at);
	const p = await plan(parseState(reg.calendar_state), entriesFor(env, ev, sessions, reg));
	if (!p.requests.length && !p.cancels.length) return false;
	const files = attachments(env, ev, reg, p.requests, p.cancels, opts.at);
	const key = opts.at === undefined ? undefined : `cal-${reg.id}-${(await sha256(JSON.stringify(p.state))).slice(0, 24)}`;
	// The key is the planned calendar itself, so a conflict means this same update went before (with other links or
	// stamps): its state is saved as sent.
	const pid = await sendEmail(env, calendarUpdateEmail(brand(env), ev, reg, p.requests, p.cancels.map((c) => c.summary), { entries: p.entries, icsUrl: await icsUrlFor(env, reg.id, opts.at) }, murl, files), key)
		.catch((e) => { if (e instanceof IdempotencyConflict) return 'repeat'; throw e; });
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
		...cap.optins.map((o) => `${o.label}: ${o.confirmed} of ${o.capacity ?? 'unlimited'} signed up, ${o.waiting} waiting.`),
		`Admin: ${siteUrl(env)}/admin/rsvps/`,
	];
}

/** Tells the organiser when a confirmed registrant newly joins the in-person, a tour or an opt-in waiting list, with current totals. */
async function notifyWaitlist(env: Env, ev: EventRow, sessions: SessionRow[], reg: RegistrationRow, event: boolean, tour: boolean, verb: string, optinIds: string[] = []) {
	if (!event && !tour && !optinIds.length) return;
	const what = [event ? 'the in-person waiting list' : null, tour ? `the ${sessions.find((t) => t.id === reg.tour_id)?.label} waiting list` : null,
		...optinIds.map((o) => `the ${sessions.find((s) => s.id === o)?.label} waiting list`)].filter(Boolean).join(' and ');
	await sendEmail(env, notification(brand(env), `New waiting-list registration: ${ev.title}`, [
		`${reg.name}${reg.affiliation ? ` (${reg.affiliation})` : ''} ${verb} ${what}.`,
		...(await totalsLines(env, ev, sessions)),
	]));
}

/** What the confirm page needs. No contact details or needs: whoever holds a confirm link may not be the registrant. */
function confirmStatus(reg: RegistrationRow, sessions: SessionRow[]) {
	const tour = reg.tour_id ? sessions.find((t) => t.id === reg.tour_id) : null;
	return { status: reg.status, attendance: reg.attendance, mode: modeOf(reg), place: reg.place, tour_label: tour?.label ?? null, tour_place: reg.tour_place, optin_labels: optedIn(reg, sessions).map((s) => s.label),
		optin_waiting_labels: optedIn(reg, sessions).filter((s) => optinWaiting(reg, s.id)).map((s) => s.label) };
}

export function publicStatus(reg: RegistrationRow, sessions: SessionRow[]) {
	const tour = reg.tour_id ? sessions.find((t) => t.id === reg.tour_id) : null;
	return {
		name: reg.name, email: reg.email, attendance: reg.attendance, mode: modeOf(reg), affiliation: reg.affiliation, needs: reg.needs, extra_answer: reg.extra_answer ?? null, optins: reg.optins ? reg.optins.split(',') : [], optin_labels: optedIn(reg, sessions).map((s) => s.label),
		optins_waiting: ids(reg.optins_waiting), optin_waiting_labels: optedIn(reg, sessions).filter((s) => optinWaiting(reg, s.id)).map((s) => s.label), share_contact: !!reg.share_contact,
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
	if (reg.status === 'confirmed') return { ok: true as const, already: true, registration: confirmStatus(reg, sessions) };

	const now = nowIso();
	let place = reg.place, tour_place = reg.tour_place, optins_waiting = reg.optins_waiting ?? null;
	if (reg.hold_expires_at && reg.hold_expires_at <= now) {
		// Hold lapsed but not yet swept: re-check availability as if registering now (this row no longer holds a place).
		const cap = await capacity(env, ev, sessions, now);
		if (reg.attendance === 'in_person' && reg.place) place = cap.inPerson.available ? 'place' : 'waitlist';
		if (reg.tour_id) tour_place = cap.tours.find((t) => t.id === reg!.tour_id)?.available ? 'place' : 'waitlist';
		optins_waiting = joinIds(ids(reg.optins).filter((o) => !cap.optins.find((x) => x.id === o)?.available));
	} else if (reg.attendance === 'in_person' && (reg.place === 'waitlist' || reg.tour_place === 'waitlist' || reg.optins_waiting)) {
		// Registered when something was full or the hold limit was reached: a place freed since, with nobody confirmed
		// waiting for it, goes to whoever confirms first. Only what was waiting is looked at; what is held stays held.
		const cap = await capacity(env, ev, sessions, now);
		if (reg.place === 'waitlist' && cap.inPerson.available) place = 'place';
		if (reg.tour_place === 'waitlist' && cap.tours.find((t) => t.id === reg!.tour_id)?.available) tour_place = 'place';
		optins_waiting = joinIds(ids(reg.optins_waiting).filter((o) => !cap.optins.find((x) => x.id === o)?.available));
	}
	// A place given now, not held since registering: two people confirming into the last one at once are checked below.
	const granted = place === 'place' && (reg.place !== 'place' || !!reg.hold_expires_at && reg.hold_expires_at <= now);
	let joinsWaitlist = place === 'waitlist';
	const joinsTourWaitlist = tour_place === 'waitlist';
	const upd = await env.DB.prepare(
		`UPDATE registrations SET status='confirmed', confirmed_at=?, updated_at=?, hold_expires_at=NULL, place=?, tour_place=?, optins_waiting=?,
			waitlist_since = CASE WHEN ? THEN ? ELSE NULL END, tour_waitlist_since = CASE WHEN ? THEN ? ELSE NULL END, optins_waitlist_since = CASE WHEN ? THEN ? ELSE NULL END
		 WHERE id=? AND status='pending'`,
	).bind(now, now, place, tour_place, optins_waiting, joinsWaitlist ? 1 : 0, now, joinsTourWaitlist ? 1 : 0, now, optins_waiting ? 1 : 0, now, id).run();
	if (!upd.meta.changes) {
		// Two clicks at once, or the cron swept the hold between the read and the update: the other request's email stands.
		const again = await getRegistration(env, id);
		if (!again) throw new UserError('This registration no longer exists. Unconfirmed registrations are deleted after a while, so please register again.', 404);
		return { ok: true as const, already: true, registration: confirmStatus(again, sessions) };
	}
	reg = (await getRegistration(env, id))!;
	if (granted && (await capacity(env, ev, sessions, now)).inPerson.held > ev.in_person_max) {
		// Over by one: the place goes to whichever registered first (by rowid, as in demoteIfLatest), so of two people
		// confirming at once exactly one keeps it.
		const ahead = await env.DB.prepare(
			`SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND attendance = 'in_person' AND place = 'place' AND ${HELD} AND rowid < (SELECT rowid FROM registrations WHERE id = ?)`,
		).bind(ev.id, now, id).first<{ n: number }>();
		if ((ahead?.n ?? 0) >= ev.in_person_max) {
			await env.DB.prepare(`UPDATE registrations SET place='waitlist', waitlist_since=? WHERE id=?`).bind(now, id).run();
			joinsWaitlist = true;
			reg = (await getRegistration(env, id))!;
		}
	}

	if (!waitingForPlace(reg, sessions)) await sendInstructions(env, ev, reg, sessions);
	else {
		// Waiting for an in-person place: no joining instructions yet, but they need their manage link.
		const pid = await sendEmail(env, waitlistReminderEmail(brand(env), ev, reg, sessions, await manageUrl(env, reg.id), true));
		await recordDelivery(env, reg.id, 'waitlist_confirmed', pid);
	}
	await notifyWaitlist(env, ev, sessions, reg, joinsWaitlist, joinsTourWaitlist, 'has confirmed and joined', ids(reg.optins_waiting));
	await syncHosts(env, brand(env), ev, sessions);
	return { ok: true as const, already: false, registration: confirmStatus(reg, sessions) };
}

export async function manageView(env: Env, id: string) {
	const reg = await getRegistration(env, id);
	if (!reg) throw new UserError('This registration no longer exists.', 404);
	if (reg.status !== 'confirmed') throw new UserError('Please confirm your email address first, using the link in your registration email.', 403);
	const ev = await getEvent(env, reg.event_id);
	const sessions = await getSessions(env, ev.id);
	const cap = await capacity(env, ev, sessions);
	const ics = await icsUrlFor(env, reg.id);
	return {
		ok: true as const,
		event: { id: ev.id, title: ev.title, starts_at: ev.starts_at, deadline: ev.deadline, ...eventLabels(ev), timezone: ev.timezone, page_path: ev.page_path, open: registrationOpen(ev), extra_question: ev.extra_question ?? null },
		tours: cap.tours.map((t) => ({ id: t.id, label: t.label, available: t.available, open: t.open })),
		optins: sessions.filter((s) => s.optin).map((s) => ({ id: s.id, label: s.label, starts_at: s.starts_at, location: s.location, available: !!cap.optins.find((o) => o.id === s.id)?.available })),
		registration: publicStatus(reg, sessions),
		calendar: entriesFor(env, ev, sessions, reg).map((e) => ({ key: e.key, summary: e.summary, start: e.start, url: ics(e.key) })),
		polls: await voterPolls(env, reg.id, ev),
	};
}

/** Changes by the registrant. Email cannot change (cancel and re-register instead). Moves are re-checked against capacity. */
export async function updateRegistration(env: Env, id: string, input: RegistrationInput) {
	const reg = await getRegistration(env, id);
	if (!reg) throw new UserError('This registration no longer exists.', 404);
	if (reg.status !== 'confirmed') throw new UserError('Please confirm your email address first, using the link in your registration email.', 403);
	const ev = await getEvent(env, reg.event_id);
	const sessions = await getSessions(env, ev.id);
	// A tour whose booking has closed shows as a disabled choice, which browsers leave out of the form: an absent
	// tour_id means "unchanged" (only an explicit 'none' drops the tour), so other details can still be saved.
	const c = { ...parseCommon(input, sessions) };
	if (input.tour_id === undefined && c.attendance === 'in_person' && !c.extras) c.tour_id = reg.tour_id;
	// Likewise an absent optins list means "unchanged" (an empty list clears them); remote attendees have none.
	if (input.optins === undefined && c.attendance === 'in_person') c.optins = reg.optins ?? null;
	const now = nowIso();
	const cap = await capacity(env, ev, sessions, now);

	let place = reg.place, waitlist_since = reg.waitlist_since;
	if (c.attendance === 'remote' || c.extras) {
		place = null;
		waitlist_since = null;
	} else if (!reg.place) {
		// From remote, or from just the extras, to the full day: a place if there is room, else the waiting list.
		if (!registrationOpen(ev)) throw new UserError('Registration has closed, so in-person places can no longer be added. Please email ' + notifyEmail(env) + '.', 409);
		place = cap.inPerson.available ? 'place' : 'waitlist';
		waitlist_since = place === 'waitlist' && reg.status === 'confirmed' ? now : null;
	}
	let tour_place = reg.tour_place, tour_waitlist_since = reg.tour_waitlist_since;
	if (c.tour_id !== reg.tour_id) {
		const old = reg.tour_id ? sessions.find((s) => s.id === reg.tour_id) : null;
		// Switching to remote drops the tour even after its booking has closed; otherwise a closed tour cannot be changed.
		if (old && !sessionBookingOpen(old) && c.attendance !== 'remote' && !c.extras) throw new UserError(`The ${old.label} has started or its booking has closed, so it can no longer be changed.`, 409);
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
	// Opt-in sessions kept keep their place or waiting-list position; newly ticked ones get a place if there is room,
	// and only while their booking is open (their own deadline, or their start).
	const had = reg.attendance === 'in_person' ? ids(reg.optins) : [], wasWaiting = ids(reg.optins_waiting);
	for (const o of ids(c.optins).filter((x) => !had.includes(x))) {
		const s = sessions.find((x) => x.id === o)!;
		if (!sessionBookingOpen(s)) throw new UserError(`Booking for the ${s.label} has closed.`, 409);
	}
	const waitingNow = ids(c.optins).filter((o) => (had.includes(o) ? wasWaiting.includes(o) : !cap.optins.find((x) => x.id === o)!.available));
	const newlyWaiting = waitingNow.filter((o) => !wasWaiting.includes(o));
	// One date orders all of a person's opt-in waiting lists: kept while they are still waiting for something.
	const optins_waitlist_since = !waitingNow.length ? null : waitingNow.some((o) => wasWaiting.includes(o)) && reg.optins_waitlist_since ? reg.optins_waitlist_since : now;
	// A change of attendance, tour or opt-in sessions can email the person, hosts and the organiser; a script flipping
	// back and forth could send hundreds, so after a burst the person is asked to wait.
	const affectsOthers = c.attendance !== reg.attendance || !!c.extras !== (modeOf(reg) === 'extras') || c.tour_id !== reg.tour_id || (c.optins ?? null) !== (reg.optins ?? null);
	if (affectsOthers) {
		const burst = await env.DB.prepare(`SELECT COUNT(*) AS n FROM deliveries WHERE registration_id = ? AND kind IN ('instructions', 'calendar_update') AND sent_at > ?`)
			.bind(id, new Date(Date.now() - HOUR).toISOString()).first<{ n: number }>();
		if ((burst?.n ?? 0) >= MAX_CHANGE_EMAILS_PER_HOUR) throw new UserError(`You have changed your registration many times in the last hour. Please wait a while, or email ${notifyEmail(env)}.`, 429);
	}
	await env.DB.prepare(
		`UPDATE registrations SET name=?, attendance=?, affiliation=?, needs=?, extra_answer=?, optins=?, optins_waiting=?, optins_waitlist_since=?, share_contact=?, place=?, waitlist_since=?,
			tour_id=?, tour_place=?, tour_waitlist_since=?, updated_at=? WHERE id=?`,
	).bind(c.name, c.attendance, c.affiliation, c.needs, c.extra_answer, c.optins, joinIds(waitingNow), optins_waitlist_since, c.share_contact, place, waitlist_since,
		c.tour_id, tour_place, tour_waitlist_since, now, id).run();
	if (reg.status === 'confirmed') {
		const updated = (await getRegistration(env, id))!;
		const newEvent = updated.place === 'waitlist' && reg.place !== 'waitlist';
		const newTour = updated.tour_place === 'waitlist' && !(reg.tour_place === 'waitlist' && reg.tour_id === updated.tour_id);
		await notifyWaitlist(env, ev, sessions, updated, newEvent, newTour, 'changed their registration and joined', newlyWaiting);
		// A remote registrant moving in person gets full joining instructions once they have a place; otherwise only calendar changes go out.
		// Anyone who now qualifies for joining instructions but never had them (a remote person moving in person with a
		// place, or someone leaving the in-person waiting list to join remotely) gets them in full.
		const before = modeOf(reg), after = modeOf(updated);
		const qualifies = !waitingForPlace(updated, sessions);
		// A change between in person, remote and just the extras is a different day: say so plainly, then give the
		// instructions for the new way of attending.
		const switched = before !== after;
		const say = (head: string, tail = '') => ({ html: `<p><strong>${escapeHtml(head)}</strong>${tail ? ' ' + escapeHtml(tail) : ''}</p>`, text: tail ? `${head} ${tail}` : head });
		const lower = (s: SessionRow) => s.label.charAt(0).toLowerCase() + s.label.slice(1);
		const oldTour = reg.tour_id ? sessions.find((s) => s.id === reg.tour_id) : undefined;
		const oldExtras = optedIn(reg, sessions).map(lower).join(' and ');
		// What the old way of attending took with it, named from the sessions themselves (nothing event-specific here).
		const dropped = [oldTour ? `your ${lower(oldTour)} booking` : '', oldExtras ? `your sign-up for ${oldExtras}` : ''].filter(Boolean).join(' and ');
		const intro = !switched ? undefined
			: after === 'remote' ? (before === 'extras'
				? say('You have changed to joining remotely.', `Your sign-up for ${oldExtras || 'the optional sessions'} has been deleted.`)
				: say('You have changed to joining remotely.', `Your in-person place has been deleted${dropped ? `, along with ${dropped}` : ''}.`))
			: after === 'extras' ? say(`You have changed to joining us for ${optedIn(updated, sessions).map(lower).join(' and ')} only.`, before === 'in_person' ? `Your daytime place has been deleted${oldTour ? `, along with your ${lower(oldTour)} booking` : ''}.` : '')
			: say('You have changed to attending in person.');
		if (qualifies && (reg.instructions_version === 0 || switched)) await sendInstructions(env, ev, updated, sessions, { intro });
		else await syncCalendar(env, ev, updated, sessions);
		await syncHosts(env, brand(env), ev, sessions);
	}
	return manageView(env, id);
}

/** Deletes the registration, confirms to the person (cancelling their calendar entries) and tells the organiser. */
export async function cancel(env: Env, id: string, opts: { byOrganiser?: boolean } = {}) {
	const reg = await getRegistration(env, id);
	if (!reg) throw new UserError('This registration no longer exists.', 404);
	const ev = await getEvent(env, reg.event_id);
	const sessions = await getSessions(env, ev.id);
	await env.DB.prepare('DELETE FROM registrations WHERE id = ?').bind(id).run();
	// Hosts first, so a failed email below cannot leave the person on a host's list.
	await syncHosts(env, brand(env), ev, sessions);
	const files = attachments(env, ev, reg, [], liveState(parseState(reg.calendar_state)).map((s) => ({ ...s, seq: s.seq + 1 })));
	await sendEmail(env, cancellationEmail(brand(env), ev, reg, `${siteUrl(env)}${ev.page_path}`, files, opts.byOrganiser));
	const detail = (reg.attendance === 'remote' ? 'remote' : !reg.place ? 'opt-in sessions only' : reg.place === 'waitlist' ? 'in person, waiting list' : 'in person')
		+ optedIn(reg, sessions).map((s) => `, ${s.label}${optinWaiting(reg, s.id) ? ' waiting' : ''}`).join('');
	await sendEmail(env, notification(brand(env), `Cancellation: ${ev.title}`, [
		`${reg.name}${reg.affiliation ? ` (${reg.affiliation})` : ''} ${opts.byOrganiser ? 'was removed by an organiser' : 'cancelled'} (${reg.status}, ${detail}${reg.tour_id ? `, ${sessions.find((t) => t.id === reg.tour_id)?.label ?? 'tour'} ${reg.tour_place ?? ''}` : ''}).`,
		...(await totalsLines(env, ev, sessions)),
	]));
	return { ok: true as const };
}

/** .ics download for one of the registrant's calendar entries (METHOD:PUBLISH, for calendars that import files). */
export async function calendarFile(env: Env, id: string, key: string) {
	const reg = await getRegistration(env, id);
	if (!reg) throw new UserError('This registration no longer exists.', 404);
	const ev = await getEvent(env, reg.event_id);
	const sessions = await getSessions(env, ev.id);
	const fresh = entriesFor(env, ev, sessions, reg).find((e) => e.key === key);
	if (!fresh) throw new UserError('No such calendar entry.', 404);
	// Same UID as the invitation already in their calendar; one sequence higher if the saved details have moved on since
	// it was sent (a quiet save), so the file is not ignored as older than what the calendar holds.
	const sent = parseState(reg.calendar_state)[key];
	const entry = sent ? { ...fresh, uid: sent.uid } : fresh;
	const seq = !sent ? 0 : sent.hash === await hashEntry(entry) ? sent.seq : sent.seq + 1;
	return buildIcs({ method: 'PUBLISH', entry, sequence: seq, organizer: { name: orgName(env), email: fromAddress(env) }, tz: ev.timezone });
}

// ---------- admin ----------

export async function promote(env: Env, id: string, what: 'event' | 'tour' | 'optin', sessionId = '', opts: { skipHosts?: boolean } = {}) {
	const reg = await getRegistration(env, id);
	if (!reg || reg.status !== 'confirmed') throw new UserError('Only confirmed registrations can be promoted.', 404);
	const ev = await getEvent(env, reg.event_id);
	const sessions = await getSessions(env, ev.id);
	// Each update re-checks that the person is still waiting, so a double click (or Promote during Promote all) sends one email.
	let r;
	if (what === 'event') {
		if (reg.attendance !== 'in_person' || reg.place !== 'waitlist') throw new UserError('This person is not on the in-person waiting list.');
		r = await env.DB.prepare(`UPDATE registrations SET place='place', waitlist_since=NULL, updated_at=? WHERE id=? AND place='waitlist'`).bind(nowIso(), id).run();
	} else if (what === 'tour') {
		if (reg.tour_place !== 'waitlist') throw new UserError('This person is not on a tour waiting list.');
		r = await env.DB.prepare(`UPDATE registrations SET tour_place='place', tour_waitlist_since=NULL, updated_at=? WHERE id=? AND tour_place='waitlist'`).bind(nowIso(), id).run();
	} else {
		if (!optinWaiting(reg, sessionId)) throw new UserError('This person is not on that waiting list.');
		const rest = ids(reg.optins_waiting).filter((o) => o !== sessionId);
		r = await env.DB.prepare('UPDATE registrations SET optins_waiting=?, optins_waitlist_since=?, updated_at=? WHERE id=? AND optins_waiting=?')
			.bind(joinIds(rest), rest.length ? reg.optins_waitlist_since : null, nowIso(), id, reg.optins_waiting).run();
	}
	if (!r.meta.changes) throw new UserError('This person has just been promoted.', 409);
	const updated = (await getRegistration(env, id))!;
	// Someone still waiting for an in-person place gets instructions only once they have one.
	const intro = { html: '<p><strong>Good news: a place has become available for you.</strong></p>', text: 'Good news: a place has become available for you.' };
	if (!waitingForPlace(updated, sessions)) await sendInstructions(env, ev, updated, sessions, { intro });
	if (!opts.skipHosts) await syncHosts(env, brand(env), ev, sessions);
	return { ok: true as const };
}

/** Promotes people from the in-person waiting list, in waiting-list order, until the in-person maximum is reached
 * (for when a bigger room is found). Each gets the latest joining instructions, as with a single promotion. A few at a
 * time (each promotion is several queries and an email): `more` says to call again, as the admin page does. */
const PROMOTE_CHUNK = 2;
export async function promoteAll(env: Env, eventId: string) {
	const ev = await getEvent(env, eventId);
	const cap = await capacity(env, ev, await getSessions(env, ev.id));
	const room = Math.max(0, cap.inPerson.max - cap.inPerson.held);
	const waiting = await env.DB.prepare(
		`SELECT id FROM registrations WHERE event_id = ? AND status = 'confirmed' AND attendance = 'in_person' AND place = 'waitlist'
		 ORDER BY waitlist_since, confirmed_at LIMIT ?`,
	).bind(ev.id, Math.min(room, PROMOTE_CHUNK)).all<{ id: string }>();
	for (const r of waiting.results) await promote(env, r.id, 'event', '', { skipHosts: true });
	const still = cap.inPerson.waiting - waiting.results.length;
	const more = still > 0 && room > waiting.results.length;
	// Hosts get one list for the lot, once the last few have been promoted.
	if (!more && waiting.results.length) await syncHosts(env, brand(env), ev, await getSessions(env, ev.id));
	return { ok: true as const, promoted: waiting.results.length, still_waiting: still, more };
}

/** "I did not register": deletes a registration that has not been confirmed, from the link in the confirmation email,
 * so the person gets no further email and any place it held is freed at once. Confirmed ones are left alone. */
export async function decline(env: Env, id: string) {
	const reg = await getRegistration(env, id);
	if (!reg) return { ok: true as const, gone: true };
	if (reg.status !== 'pending') throw new UserError('This registration has already been confirmed. To cancel it, use the link in your joining instructions.', 409);
	await env.DB.prepare("DELETE FROM registrations WHERE id = ? AND status = 'pending'").bind(id).run();
	const ev = await getEvent(env, reg.event_id);
	await syncHosts(env, brand(env), ev, await getSessions(env, ev.id));
	await sendEmail(env, declinedEmail(brand(env), ev, reg.email));
	return { ok: true as const, gone: false };
}

export async function adminDelete(env: Env, id: string) {
	const reg = await getRegistration(env, id);
	// Someone who confirmed may be relying on their place (travel, a day off): they are always told, exactly as if
	// they had cancelled, with their calendar entries cancelled too. Unconfirmed ones (spam, typos) are removed quietly.
	if (reg?.status === 'confirmed') return cancel(env, id, { byOrganiser: true });
	await env.DB.prepare('DELETE FROM registrations WHERE id = ?').bind(id).run();
	if (reg) {
		const ev = await getEvent(env, reg.event_id);
		await syncHosts(env, brand(env), ev, await getSessions(env, ev.id));
	}
	return { ok: true as const };
}

export interface Audience {
	/** in_person: everyone coming in person; day: those with a day place (or waiting for one); extras: those coming only to opt-in sessions. */
	attendance?: 'all' | 'in_person' | 'day' | 'remote' | 'extras';
	optin?: string; // an opt-in session id: only people signed up for it (waiting for it too, with include_waitlist)
	tour_id?: string; // a tour session id, 'none' for no tour, or undefined for any
	below_version?: number; // only people whose last joining instructions are older than this version
	include_waitlist?: boolean; // include people waiting for an in-person place
}

export function parseAudience(v: unknown): Audience {
	const a = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
	return {
		attendance: ['in_person', 'day', 'remote', 'extras'].includes(a.attendance as string) ? (a.attendance as Audience['attendance']) : 'all',
		optin: typeof a.optin === 'string' && a.optin ? a.optin : undefined,
		tour_id: typeof a.tour_id === 'string' && a.tour_id ? a.tour_id : undefined,
		below_version: Number.isInteger(a.below_version) && (a.below_version as number) > 0 ? (a.below_version as number) : undefined,
		include_waitlist: a.include_waitlist === true,
	};
}

export async function audienceRecipients(env: Env, eventId: string, a: Audience): Promise<RegistrationRow[]> {
	const where = [`event_id = ?`, `status = 'confirmed'`];
	const binds: unknown[] = [eventId];
	// "In person" includes people coming only to an opt-in session (no place); "day" and "extras" split them.
	if (a.attendance === 'in_person') where.push(`attendance = 'in_person'`);
	else if (a.attendance === 'day') where.push(`attendance = 'in_person' AND place IS NOT NULL`);
	else if (a.attendance === 'extras') where.push(`attendance = 'in_person' AND place IS NULL`);
	else if (a.attendance === 'remote') where.push(`attendance = 'remote'`);
	if (a.optin) {
		where.push(`attendance = 'in_person' AND ${listedIn('optins', '?')}`); binds.push(a.optin);
		if (!a.include_waitlist) { where.push(`NOT ${listedIn('optins_waiting', '?')}`); binds.push(a.optin); }
	}
	if (!a.include_waitlist) where.push(`NOT (attendance = 'in_person' AND place = 'waitlist')`);
	if (a.tour_id === 'none') where.push('tour_id IS NULL');
	else if (a.tour_id) { where.push('tour_id = ?'); binds.push(a.tour_id); }
	if (a.below_version) { where.push('instructions_version < ?'); binds.push(a.below_version); }
	const regs = (await env.DB.prepare(`SELECT * FROM registrations WHERE ${where.join(' AND ')} ORDER BY created_at`).bind(...binds).all<RegistrationRow>()).results;
	if (a.include_waitlist) return regs;
	// Likewise people coming only to the opt-in sessions who are still waiting for all of them.
	const sessions = await getSessions(env, eventId);
	return regs.filter((r) => !onlyWaiting(r, sessions));
}

interface MessageRow {
	id: string; event_id: string; subject: string; body_md: string; audience: string; marks_instructions_version: number | null;
	status: string; scheduled_at: string | null; sent_at: string | null; recipients_count: number | null; error: string | null;
	created_at: string; created_by: string | null; claimed_until?: string | null; started_at?: string | null; recipient_ids?: string | null; attempts?: number;
	piece_size?: number | null;
}

export async function createMessage(env: Env, eventId: string, input: Record<string, unknown>, createdBy: string) {
	await getEvent(env, eventId);
	const subject = cleanLine(input.subject, 200);
	const body = typeof input.body_md === 'string' ? input.body_md.trim().slice(0, 20000) : '';
	if (!subject || !body) throw new UserError('Subject and message are required.');
	const audience = parseAudience(input.audience);
	let scheduled_at: string | null = null;
	if (input.scheduled_at) {
		const t = Date.parse(String(input.scheduled_at));
		if (Number.isNaN(t)) throw new UserError('Invalid schedule time.');
		// A time already gone is a mistake (the organiser asked for later, not now): sending at once would surprise them.
		if (t < Date.now() - 60_000) throw new UserError('That time has passed. Choose a later time, or leave "Send at" empty to send now.');
		if (t > Date.now() + 60_000) scheduled_at = new Date(t).toISOString();
	}
	const marks = Number.isInteger(input.marks_instructions_version) && (input.marks_instructions_version as number) > 0 ? (input.marks_instructions_version as number) : null;
	const id = randomToken(12);
	await env.DB.prepare(
		`INSERT INTO messages (id, event_id, subject, body_md, audience, marks_instructions_version, status, scheduled_at, created_at, created_by)
		 VALUES (?,?,?,?,?,?,?,?,?,?)`,
	).bind(id, eventId, subject, body, JSON.stringify(audience), marks, 'scheduled', scheduled_at, nowIso(), createdBy).run();
	// The first piece goes now. If it fails, the message stays "sending" and the cron retries it: the admin page shows the
	// error against it, rather than an error the organiser might answer by sending the message again.
	if (!scheduled_at) {
		try { await deliverMessage(env, id); } catch (e) { console.error('message first piece failed', id, e); }
	}
	return env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first<MessageRow>();
}

/** How much one request (or cron run) sends, to stay inside the Workers free plan's 50 queries and 50 outbound requests
 * per invocation: a message's plain copies go to Resend 100 at a time, but each copy carrying joining instructions and
 * calendar files is a request and several queries of its own. PAID_PLAN=true allows ten times as many copies with
 * joining instructions per piece (the paid plan allows 1,000 queries). */
const MESSAGE_PLAIN_CHUNK = 100;
const instructionsChunk = (env: Env) => (env.PAID_PLAN === 'true' ? 30 : 3);
const CLAIM_MS = 4 * 60_000;
/** A message whose pieces fail this many times running is marked failed (the admin page can resume it), so it cannot
 * hold up the others. Counted when a piece is claimed, so a run killed outright counts too. */
const MAX_ATTEMPTS = 5;
/** Delivery records of a piece written but not yet sent: plain copies, and copies with joining instructions. */
const PENDING = 'pending', PENDING_FULL = 'pending-full', REFUSED = 'refused';
/** Copies that may or may not have gone (a retry found the key used for a different body, or the piece was too old to
 * retry safely): never sent again, not counted as delivered, and shown on the admin page. */
const UNCERTAIN = 'uncertain';
const NOT_DELIVERED = `('${PENDING}', '${PENDING_FULL}', '${REFUSED}', '${UNCERTAIN}')`;
/** Resend keeps idempotency keys for a day: a piece pending longer cannot be retried without risking a second copy. */
const KEY_LIFETIME_MS = 23 * 3600_000;

/**
 * Sends the next piece of a message. The first piece goes when the message is sent or falls due; the cron Worker sends
 * the rest, a piece per run. The audience is fixed when sending starts. Each piece is written down as pending before
 * it is sent, and a piece that fails is retried as exactly that piece, with the same links and calendar stamps (fixed
 * at the message's start) and the same idempotency key: if Resend took it the first time, it sends nothing again.
 * Resend refusing a piece (one bad address refuses a whole batch) makes the pieces smaller, down to the one person,
 * who is recorded as refused so everyone else still gets the message. A claim of a few minutes, with a token, stops two
 * runs working on the same message, and only the claimant can finish it, so a cancel in between stands.
 */
export async function deliverMessage(env: Env, id: string) {
	const now = nowIso();
	const mine = `${new Date(Date.now() + CLAIM_MS).toISOString()}#${randomToken(6)}`;
	const claim = await env.DB.prepare(
		`UPDATE messages SET status = 'sending', started_at = COALESCE(started_at, ?1), claimed_until = ?2, attempts = attempts + 1
		 WHERE id = ?3 AND status IN ('scheduled', 'sending') AND (claimed_until IS NULL OR claimed_until < ?1) RETURNING *`,
	).bind(now, mine, id).first<MessageRow>();
	if (!claim) return { sent: 0, left: 0 };
	const release = (sql: string, ...binds: unknown[]) => env.DB.prepare(`UPDATE messages SET claimed_until = NULL${sql} WHERE id = ? AND status = 'sending' AND claimed_until = ?`).bind(...binds, id, mine).run();
	if ((claim.attempts ?? 0) > MAX_ATTEMPTS) {
		await release(`, status = 'failed', error = COALESCE(error, 'Stopped after repeated failures.')`);
		return { sent: 0, left: 0 };
	}
	let piece: RegistrationRow[] = [];
	try {
		let ids: string[];
		if (claim.recipient_ids) ids = JSON.parse(claim.recipient_ids);
		else {
			ids = (await audienceRecipients(env, claim.event_id, JSON.parse(claim.audience))).map((r) => r.id);
			await env.DB.prepare('UPDATE messages SET recipient_ids = ? WHERE id = ?').bind(JSON.stringify(ids), id).run();
		}
		// A piece left pending for longer than Resend keeps its key cannot be retried safely: it may have gone.
		await env.DB.prepare(`UPDATE deliveries SET provider_id = '${UNCERTAIN}' WHERE message_id = ? AND provider_id IN ('${PENDING}', '${PENDING_FULL}') AND sent_at < ?`)
			.bind(id, new Date(Date.now() - KEY_LIFETIME_MS).toISOString()).run();
		const rows = (await env.DB.prepare('SELECT registration_id AS r, provider_id AS p FROM deliveries WHERE message_id = ?').bind(id).all<{ r: string; p: string | null }>()).results;
		const handled = new Set(rows.map((x) => x.r));
		// A piece written down before, retried as it was recorded: who was in it, and whether they get the instructions.
		const pendingPlain = rows.filter((x) => x.p === PENDING).map((x) => x.r).sort();
		const pendingFull = rows.filter((x) => x.p === PENDING_FULL).map((x) => x.r).sort();
		// Still registered and confirmed; anyone who has cancelled since is simply left out (with any pending row).
		const regs = new Map((await confirmedRegs(env, claim.event_id)).map((r) => [r.id, r]));
		// "Include the joining instructions": the version chosen when the message was written, even if a newer one is saved
		// while it goes out. It opens a full copy of them for everyone with a place; people still waiting get the message alone.
		const instructions = claim.marks_instructions_version
			? await env.DB.prepare('SELECT version, subject, body_md FROM instructions WHERE event_id = ? AND version = ?').bind(claim.event_id, claim.marks_instructions_version).first<{ version: number; subject: string; body_md: string }>()
			: null;
		const sessions = await getSessions(env, claim.event_id);
		const full = (r: RegistrationRow) => !!instructions && !waitingForPlace(r, sessions);
		const todo = ids.filter((x) => !handled.has(x) && regs.has(x)).map((x) => regs.get(x)!);
		let plainIds: string[], fullIds: string[];
		if (pendingPlain.length || pendingFull.length) [plainIds, fullIds] = [pendingPlain, pendingFull];
		else {
			const size = claim.piece_size ?? Infinity;
			const plainTodo = todo.filter((r) => !full(r));
			const chosen = (plainTodo.length ? plainTodo.slice(0, Math.min(MESSAGE_PLAIN_CHUNK, size)) : todo.slice(0, Math.min(instructionsChunk(env), size))).map((r) => r.id).sort();
			[plainIds, fullIds] = plainTodo.length ? [chosen, []] : [[], chosen];
			// One statement whatever the piece's size (D1 allows 100 bound values a statement).
			if (chosen.length) await env.DB.prepare(`INSERT INTO deliveries (registration_id, kind, message_id, instructions_version, sent_at, provider_id)
				SELECT value, 'message', ?, ?, ?, ? FROM json_each(?)`).bind(id, claim.marks_instructions_version, nowIso(), plainIds.length ? PENDING : PENDING_FULL, JSON.stringify(chosen)).run();
		}
		piece = [...plainIds, ...fullIds].filter((x) => regs.has(x)).map((x) => regs.get(x)!);
		const at = Date.parse(claim.started_at ?? now);
		// Recorded as sent in two statements however many people: the delivery records and their instructions version.
		const uncertain = (people: string[]) => env.DB.prepare(`UPDATE deliveries SET provider_id = '${UNCERTAIN}' WHERE message_id = ? AND provider_id IN ('${PENDING}', '${PENDING_FULL}') AND registration_id IN (SELECT value FROM json_each(?))`)
			.bind(id, JSON.stringify(people)).run();
		const done = (people: string[]) => env.DB.batch([
			env.DB.prepare(`UPDATE deliveries SET provider_id = 'sent', sent_at = ? WHERE message_id = ? AND provider_id IN ('${PENDING}', '${PENDING_FULL}') AND registration_id IN (SELECT value FROM json_each(?))`)
				.bind(nowIso(), id, JSON.stringify(people)),
			...(claim.marks_instructions_version ? [env.DB.prepare('UPDATE registrations SET instructions_version = MAX(instructions_version, ?) WHERE id IN (SELECT value FROM json_each(?))')
				.bind(claim.marks_instructions_version, JSON.stringify(people))] : []),
		]);
		const plain = piece.filter((r) => plainIds.includes(r.id)), withInstr = piece.filter((r) => fullIds.includes(r.id));
		if (plain.length) {
			const emails: OutgoingEmail[] = [];
			for (const r of plain) emails.push(messageEmail(brand(env), r, claim, await manageUrl(env, r.id, at)));
			// The key is the piece as recorded, even if someone in it has cancelled since: if Resend took it, a retry under the
			// same key sends nothing again, and a retry that differs (fewer people) leaves them marked uncertain (see email.ts).
			try {
				await sendBatch(env, emails, `msg-${id}-${(await sha256(plainIds.join(','))).slice(0, 24)}`);
				await done(plain.map((r) => r.id));
			} catch (e) {
				if (!(e instanceof IdempotencyConflict)) throw e;
				await uncertain(plain.map((r) => r.id));
			}
		}
		if (withInstr.length) {
			const ev = await getEvent(env, claim.event_id);
			for (const r of withInstr) {
				try {
					await sendInstructions(env, ev, r, sessions, { intro: { html: mdToHtml(claim.body_md), text: mdToText(claim.body_md) }, subject: claim.subject, kind: 'message_instructions',
						idempotencyKey: `msg-${id}-${r.id}`, instructions: instructions!, at });
					await done([r.id]);
				} catch (e) {
					// Their calendar is not marked as updated either: the next email that carries it catches up.
					if (!(e instanceof IdempotencyConflict)) throw e;
					await uncertain([r.id]);
				}
			}
		}
		// Pending rows of people who have since cancelled went with their registrations.
		const left = todo.filter((r) => !piece.includes(r)).length;
		// Pieces stay small until the refused address they are narrowing down to has been set aside (then full size again).
		if (left > 0) await release(`, error = NULL, attempts = 0`);
		else {
			await release(`, status = 'sent', sent_at = ?, error = NULL, attempts = 0,
				recipients_count = (SELECT COUNT(DISTINCT registration_id) FROM deliveries WHERE message_id = ? AND provider_id NOT IN ${NOT_DELIVERED})`, nowIso(), id);
		}
		return { sent: piece.length, left };
	} catch (e) {
		if (/Resend error 422/.test(String(e)) && piece.length) {
			// Refused, so nothing in the piece went: try smaller pieces, and at one person, record them as refused.
			if (piece.length > 1) {
				await env.DB.prepare(`DELETE FROM deliveries WHERE message_id = ? AND provider_id IN ('${PENDING}', '${PENDING_FULL}')`).bind(id).run();
				await release(`, piece_size = ?, attempts = attempts - 1, error = ?`, Math.max(1, Math.ceil(piece.length / 10)), String(e).slice(0, 500));
			} else {
				await env.DB.prepare(`UPDATE deliveries SET provider_id = ? WHERE message_id = ? AND provider_id IN ('${PENDING}', '${PENDING_FULL}')`).bind(REFUSED, id).run();
				// Refused by itself before anyone has had it, twice: the refusal is about the message (its sender, say), not
				// an address, so it stops here with its error rather than setting everyone aside.
				const tally = await env.DB.prepare(`SELECT SUM(provider_id = '${REFUSED}') AS refused, SUM(provider_id NOT IN ${NOT_DELIVERED}) AS sent FROM deliveries WHERE message_id = ?`).bind(id).first<{ refused: number; sent: number }>();
				if ((tally?.refused ?? 0) >= 2 && !(tally?.sent ?? 0)) await release(`, status = 'failed', error = ?`, `${String(e).slice(0, 400)}: refused for everyone tried, so probably not about an address (check EMAIL_FROM and the message)`);
				else await release(`, attempts = attempts - 1, piece_size = NULL, error = ?`, `${String(e).slice(0, 400)} (one address refused; the rest carry on)`);
			}
			return { sent: 0, left: 1 };
		}
		// Still 'sending', pending piece and all, for the cron to retry; the error shows on the admin page.
		await release(`, error = ?`, String(e).slice(0, 500));
		throw e;
	}
}

/** A failed message carries on from where it stopped: its delivery records say who already has it. */
export async function resumeMessage(env: Env, id: string) {
	const r = await env.DB.prepare(`UPDATE messages SET status = 'sending', attempts = 0, claimed_until = NULL WHERE id = ? AND status = 'failed' RETURNING id`).bind(id).first();
	if (!r) throw new UserError('Only a message that failed can be resumed.', 409);
	await deliverMessage(env, id).catch((e) => console.error('resumed message failed again', id, e));
	return { ok: true as const };
}

/** A scheduled message, or the rest of one part sent (its delivery records say who already has it). */
export async function cancelMessage(env: Env, id: string) {
	const now = nowIso();
	const r = await env.DB.prepare(`UPDATE messages SET status='cancelled', recipients_count = (SELECT COUNT(DISTINCT registration_id) FROM deliveries WHERE message_id = ?1 AND provider_id NOT IN ${NOT_DELIVERED})
		WHERE id = ?1 AND (status = 'scheduled' OR (status = 'sending' AND (claimed_until IS NULL OR claimed_until < ?2))) RETURNING id`).bind(id, now).first();
	if (!r) throw new UserError('Only messages that have not finished sending can be cancelled, and not while a part is going out: try again in a few minutes.', 409);
	return { ok: true as const };
}

export async function listMessages(env: Env, eventId: string) {
	return (await env.DB.prepare(`SELECT m.*, (SELECT COUNT(*) FROM deliveries d WHERE d.message_id = m.id AND d.provider_id = '${UNCERTAIN}') AS uncertain
		FROM messages m WHERE m.event_id = ? ORDER BY COALESCE(m.sent_at, m.scheduled_at, m.created_at) DESC`).bind(eventId).all<MessageRow & { uncertain: number }>()).results;
}

export async function listInstructions(env: Env, eventId: string) {
	return (await env.DB.prepare('SELECT * FROM instructions WHERE event_id = ? ORDER BY version DESC').bind(eventId).all()).results;
}

export async function addInstructions(env: Env, eventId: string, input: Record<string, unknown>, createdBy: string) {
	await getEvent(env, eventId);
	const subject = cleanLine(input.subject, 200);
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
	const hostMinutes = input.host_list_minutes === undefined ? ev.host_list_minutes ?? 0 : Number(input.host_list_minutes);
	if (!Number.isInteger(hostMinutes) || hostMinutes < 0 || hostMinutes > 1440) throw new UserError('The gap between host lists must be a whole number of minutes, up to a day.');
	await env.DB.prepare('UPDATE events SET in_person_max=?, deadline=?, travel_minutes=?, host_list_minutes=? WHERE id=?').bind(max, deadline, travel, hostMinutes, eventId).run();
	// A shorter gap can release lists held back under the old one (the cron only looks at events with a gap).
	if (hostMinutes < (ev.host_list_minutes ?? 0)) await syncHosts(env, brand(env), { ...ev, host_list_minutes: hostMinutes }, await getSessions(env, ev.id));
	// A new travel time changes everyone's "time to leave" reminder, which is not worth an email to every attendee:
	// like a quiet session save, each person's calendar catches up with their next email.
	return { ok: true as const, calendar_updates: 0 };
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
		if (e.location !== undefined) s.location = cleanLine(e.location, 300);
		if (e.online_url !== undefined) {
			const u = cleanText(e.online_url, 500);
			if (u && (!/^https:\/\//.test(u) || /\s/.test(u))) throw new UserError('Online links must start with https:// and contain no spaces or line breaks.');
			s.online_url = u;
		}
		if (e.host_name !== undefined) s.host_name = cleanLine(e.host_name, 120);
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
			const p = await plan(parseState(r.calendar_state), entriesFor(env, ev, next, r));
			if (p.requests.length || p.cancels.length) n++;
		}
		return { ok: true as const, calendar_updates: n };
	}
	const stmts = [];
	const released: SessionRow[] = [];
	for (const s of next) {
		const old = sessions.find((x) => x.id === s.id)!;
		if (JSON.stringify(old) === JSON.stringify(s)) continue;
		stmts.push(env.DB.prepare('UPDATE sessions SET starts_at=?, ends_at=?, location=?, online_url=?, host_name=?, host_email=?, capacity=?, booking_deadline=? WHERE id=?')
			.bind(s.starts_at, s.ends_at, s.location, s.online_url, s.host_name, s.host_email, s.capacity, s.booking_deadline, s.id));
		// A new host gets the whole list, not a diff against the previous host's.
		if (old.host_email !== s.host_email) {
			stmts.push(env.DB.prepare('DELETE FROM host_snapshots WHERE session_id=?').bind(s.id));
			// Only a host who was actually sent a list has anything to delete.
			if (old.host_email && await env.DB.prepare('SELECT 1 FROM host_snapshots WHERE session_id=?').bind(s.id).first()) released.push(old);
		}
	}
	if (stmts.length) await env.DB.batch(stmts);
	// Each note on its own: the save is done, so one failed send must not stop the others or the updates below.
	for (const old of released) {
		try { await sendEmail(env, hostReleasedEmail(brand(env), ev, old)); } catch (e) { console.error('replaced-host note failed', old.id, e); }
	}
	// "Save without emailing": calendars aren't updated now. Each person's entries catch up with the next email that
	// carries their calendar (joining instructions, a message that includes them, or a change of their own).
	const updates = input.quiet === true ? { sent: 0, queued: 0 } : await resyncCalendars(env, ev.id);
	await syncHosts(env, brand(env), ev, await getSessions(env, ev.id));
	return { ok: true as const, calendar_updates: updates.sent + updates.queued, calendar_queued: updates.queued };
}

const confirmedRegs = async (env: Env, eventId: string) =>
	(await env.DB.prepare(`SELECT * FROM registrations WHERE event_id = ? AND status = 'confirmed'`).bind(eventId).all<RegistrationRow>()).results;

/** Calendar updates sent in the request that changed the sessions; the rest are queued for the cron Worker. */
const CALENDAR_CHUNK = 8;

/** Works out who needs a calendar update (no queries), sends the first few and queues the rest. Returns both counts. */
async function resyncCalendars(env: Env, eventId: string) {
	const ev = await getEvent(env, eventId);
	const sessions = await getSessions(env, ev.id);
	const changed: RegistrationRow[] = [];
	for (const r of await confirmedRegs(env, ev.id)) {
		// People who have never been sent a calendar (e.g. still waiting) are skipped by the plan itself.
		const p = await plan(parseState(r.calendar_state), entriesFor(env, ev, sessions, r));
		if (p.requests.length || p.cancels.length) changed.push(r);
	}
	// Everyone queued first, so a failure part way leaves the rest for the cron rather than nowhere.
	for (let i = 0; i < changed.length; i += 90) {
		const ids = changed.slice(i, i + 90).map((r) => r.id);
		await env.DB.prepare(`UPDATE registrations SET calendar_dirty = 1 WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).run();
	}
	let sent = 0;
	for (const r of changed.slice(0, CALENDAR_CHUNK)) if (await calendarFromQueue(env, ev, { ...r, calendar_dirty: 1 }, sessions)) sent++;
	return { sent, queued: changed.length - sent };
}

/**
 * One queued calendar update. The person is claimed first (their flag cleared only if it is still what was read), so
 * a request and the cron cannot both send it, and the update is planned from the row as claimed. Its links and stamps
 * are fixed to the day and its idempotency key comes from the planned calendar, so a retry is the same email, sent
 * once. A failure puts the person back in the queue; after a few, they are left for their next email to catch up.
 */
async function calendarFromQueue(env: Env, ev: EventRow, r: RegistrationRow, sessions: SessionRow[]) {
	const was = r.calendar_dirty ?? 1;
	const claimed = await env.DB.prepare('UPDATE registrations SET calendar_dirty = 0 WHERE id = ? AND calendar_dirty = ? RETURNING *').bind(r.id, was).first<RegistrationRow>();
	if (!claimed) return false;
	try {
		return claimed.status === 'confirmed' && await syncCalendar(env, ev, claimed, sessions, { at: Math.floor(Date.now() / 86400_000) * 86400_000 });
	} catch (e) {
		console.error('calendar update failed', r.id, e);
		await env.DB.prepare('UPDATE registrations SET calendar_dirty = ? WHERE id = ? AND calendar_dirty = 0').bind(was >= 3 ? 0 : was + 1, r.id).run();
		return false;
	}
}

/** The cron's share of calendar updates: a few queued people per run. Each is re-planned, so a later change is included. */
async function runCalendarQueue(env: Env, limit = CALENDAR_CHUNK) {
	const dirty = (await env.DB.prepare('SELECT * FROM registrations WHERE calendar_dirty > 0 ORDER BY event_id, calendar_dirty LIMIT ?').bind(limit).all<RegistrationRow>()).results;
	let n = 0;
	for (const evId of [...new Set(dirty.map((r) => r.event_id))]) {
		const ev = await getEvent(env, evId);
		const sessions = await getSessions(env, evId);
		for (const r of dirty.filter((x) => x.event_id === evId)) if (await calendarFromQueue(env, ev, r, sessions)) n++;
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
	const cols = ['name', 'email', 'attendance', 'status', 'place', 'tour', 'tour_place', 'signed_up_for', 'waiting_for', 'affiliation', 'needs', 'extra_answer', 'share_contact', 'instructions_version', 'created_at', 'confirmed_at'];
	const esc = (v: unknown) => {
		let s = v == null ? '' : String(v).replace(/\t/g, ' ');
		if (/^[\s]*[=+\-@]/.test(s) || /^[\r\n]/.test(s)) s = `'${s}`; // defuse spreadsheet formula injection
		return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	const rows = regs.map((r) => [r.name, r.email, modeOf(r) === 'extras' ? 'opt-in sessions only' : r.attendance, r.status, r.place, sessions.find((t) => t.id === r.tour_id)?.label ?? '', r.tour_place, optedIn(r, sessions).map((s) => s.label).join('; '),
		optedIn(r, sessions).filter((s) => optinWaiting(r, s.id)).map((s) => s.label).join('; '), r.affiliation, r.needs, r.extra_answer ?? '', r.share_contact ? 'yes' : 'no', r.instructions_version, r.created_at, r.confirmed_at].map(esc).join(','));
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
	// Totals only, no names: enough to draft "the most popular choice was…" without the log naming anyone.
	const polls = (await adminPolls(env, eventId)).polls;
	if (polls.length) out.push('## Polls', '');
	for (const p of polls) {
		out.push(`### ${p.question}`, '', `- ${p.open ? 'Open' : 'Closed'}; ${p.tally.voters} answer(s)${p.tally.nothing ? `, ${p.tally.nothing} would join none of the options` : ''}`,
			...p.tally.results.map((r) => `- ${r.label}: ${r.willing} would join (${r.first} first choice), ${r.out} would stay at home`), '');
	}
	return out.join('\n');
}

// ---------- scheduled jobs (companion cron Worker, or /api/dev/cron locally) ----------

export async function runScheduled(env: Env, now = Date.now()) {
	const nowS = new Date(now).toISOString();
	const report = { messagesSent: 0, calendarUpdates: 0, holdsWarned: 0, holdsExpired: 0, retentionDeleted: 0 };
	await recordCronRun(env, now);

	const pending = (await env.DB.prepare(`SELECT * FROM registrations WHERE status='pending'`).all<RegistrationRow>()).results;
	// One warning per event per run, however many holds reached half way: made-up registrations must not flood the organiser.
	const warn = new Map<string, RegistrationRow[]>();
	for (const r of pending) {
		if (!r.hold_expires_at) continue;
		const exp = Date.parse(r.hold_expires_at), start = Date.parse(r.created_at);
		if (exp <= now) {
			await env.DB.prepare(`DELETE FROM registrations WHERE id=? AND status='pending'`).bind(r.id).run();
			report.holdsExpired++;
		} else if (!r.hold_warned_at && now >= start + (exp - start) / 2) {
			// Marked first: a failed send must not block the deletions below or repeat every five minutes.
			await env.DB.prepare('UPDATE registrations SET hold_warned_at=? WHERE id=?').bind(nowS, r.id).run();
			warn.set(r.event_id, [...(warn.get(r.event_id) ?? []), r]);
		}
	}
	for (const [eventId, regs] of warn) {
		try {
			const ev = await getEvent(env, eventId);
			const what = (r: RegistrationRow) => r.attendance === 'in_person' ? (r.place === 'place' ? 'held in-person place' : r.place === 'waitlist' ? 'registration (waiting list, or a place if one is free when they confirm)' : 'sign-up for the optional sessions') : 'remote registration';
			const shown = regs.slice(0, 20);
			await sendEmail(env, notification(brand(env), regs.length === 1 ? `Unconfirmed registration half way to expiry: ${ev.title}` : `${regs.length} unconfirmed registrations half way to expiry: ${ev.title}`, [
				...shown.map((r) => `${r.name} registered at ${ukDateTime(r.created_at, ev.timezone)} but has not confirmed their email address. Their ${what(r)} will be deleted at ${ukDateTime(r.hold_expires_at!, ev.timezone)} unless they confirm.`),
				...(regs.length > shown.length ? [`And ${regs.length - shown.length} more. Many unconfirmed registrations at once can mean someone is registering made-up addresses: see the admin page.`] : []),
			]));
			report.holdsWarned += regs.length;
		} catch (e) { console.error('hold warning failed', eventId, e); }
	}

	// Host lists held back by an event's host_list_minutes go out once their interval has passed.
	const throttled = (await env.DB.prepare('SELECT * FROM events WHERE host_list_minutes > 0 AND ends_at > ?').bind(nowS).all<EventRow>()).results;
	for (const ev of throttled) {
		try { await syncHosts(env, brand(env), ev, await getSessions(env, ev.id), now); } catch (e) { console.error('host lists failed', ev.id, e); }
	}

	// Retention: registrations, their delivery records and host lists are deleted 30 days after the event ends.
	const cutoff = new Date(now - 30 * 24 * HOUR).toISOString();
	const r = await env.DB.prepare(`DELETE FROM registrations WHERE event_id IN (SELECT id FROM events WHERE ends_at <= ?)`).bind(cutoff).run();
	report.retentionDeleted = r.meta.changes ?? 0;
	await env.DB.prepare(`DELETE FROM host_snapshots WHERE session_id IN (SELECT s.id FROM sessions s JOIN events e ON e.id = s.event_id WHERE e.ends_at <= ?)`).bind(cutoff).run();
	await env.DB.prepare(`UPDATE sessions SET host_name = NULL, host_email = NULL WHERE event_id IN (SELECT id FROM events WHERE ends_at <= ?)`).bind(cutoff).run();
	// Polls go too: suggestions are registrants' own words, and decisions name an organiser's address. Their totals are
	// in the sent log for anyone who needs them afterwards.
	await env.DB.prepare(`DELETE FROM polls WHERE event_id IN (SELECT id FROM events WHERE ends_at <= ?)`).bind(cutoff).run();
	await env.DB.prepare('DELETE FROM dev_outbox WHERE created_at <= ?').bind(cutoff).run();
	// Messages can name attendees, and both they and joining instructions name the organiser who wrote them: messages
	// go, and instructions (kept so the event can be cloned) lose their author.
	await env.DB.prepare(`DELETE FROM messages WHERE event_id IN (SELECT id FROM events WHERE ends_at <= ?)`).bind(cutoff).run();
	await env.DB.prepare(`UPDATE instructions SET created_by = NULL WHERE created_by IS NOT NULL AND event_id IN (SELECT id FROM events WHERE ends_at <= ?)`).bind(cutoff).run();

	// Last, so holds and retention always run: one piece of a message per run (a big message finishes over a few runs),
	// a message falling due first, then the one in progress that has failed least and started first; then queued
	// calendar updates, a couple alongside a message piece or a fuller share without one. That keeps a run inside the
	// free plan's limits.
	try {
		const due = await env.DB.prepare(`SELECT id FROM messages WHERE (status = 'scheduled' AND scheduled_at <= ?1) OR (status = 'sending' AND (claimed_until IS NULL OR claimed_until < ?1))
			ORDER BY status = 'sending', attempts, COALESCE(started_at, scheduled_at) LIMIT 1`).bind(nowS).first<{ id: string }>();
		if (due) report.messagesSent += (await deliverMessage(env, due.id)).sent;
	} catch (e) { console.error('sending failed', e); }
	try {
		report.calendarUpdates = await runCalendarQueue(env, report.messagesSent ? 2 : CALENDAR_CHUNK);
	} catch (e) { console.error('sending failed', e); }

	return report;
}

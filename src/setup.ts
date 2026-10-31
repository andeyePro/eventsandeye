// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import type { Env } from './env';
import { localStamp } from './ics';
import { getEvent, getSessions, latestInstructions, UserError } from './rsvp';
import type { EventRow, SessionRow } from './templates';
import { cleanLine, nowIso, randomToken } from './util';

/**
 * Setting events up from the admin page instead of SQL: create, edit and clone events, and add or remove sessions.
 * None of it emails anyone. Calendars already sent catch up with each person's next email, as after a quiet save.
 */

const ID_RE = /^[a-z0-9][a-z0-9-]{2,59}$/;
const DAY = 86400_000;

const when = (v: unknown, label: string) => {
	if (v === null || v === undefined || v === '') throw new UserError(`Please give the ${label}.`);
	const t = Date.parse(String(v));
	if (Number.isNaN(t)) throw new UserError(`Invalid ${label}.`);
	return new Date(t).toISOString();
};
const whole = (v: unknown, label: string, min: number, max: number) => {
	const n = Number(v);
	if (!Number.isInteger(n) || n < min || n > max) throw new UserError(`${label} must be a whole number from ${min} to ${max}.`);
	return n;
};
/** An IANA zone name, stored as the runtime spells it. Offsets such as +01:00 are refused: they know nothing of summer time. */
const zone = (v: unknown) => {
	const tz = typeof v === 'string' ? v.trim() : '';
	const refuse = () => new UserError('Unknown time zone: use a name such as Europe/London or America/New_York.');
	if (!tz || /^[+-]|^gmt[+-]/i.test(tz)) throw refuse();
	try {
		return new Intl.DateTimeFormat('en-GB', { timeZone: tz }).resolvedOptions().timeZone;
	} catch {
		throw refuse();
	}
};
const pagePath = (v: unknown) => {
	const p = cleanLine(v, 200);
	if (!p || !p.startsWith('/') || p.startsWith('//') || /[\s\\]/.test(p)) throw new UserError('The event page must be a path on your site, starting with /.');
	return p;
};

/** The instant a wall-clock YYYYMMDDTHHMMSS stands for in a zone (two passes, so the offset is the one at that instant). */
function wallToIso(stamp: string, tz: string): string {
	const wall = Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(9, 11), +stamp.slice(11, 13), +stamp.slice(13, 15));
	const offset = (ms: number) => {
		const s = localStamp(new Date(ms).toISOString(), tz);
		return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15)) - Math.floor(ms / 1000) * 1000;
	};
	const first = wall - offset(wall), second = wall - offset(first);
	return new Date(offset(second) === offset(first) ? second : first).toISOString();
}

/**
 * Moves times by the number of calendar days between two instants, counted in the event's zone. Every time keeps its
 * wall-clock time, so a move across a change to or from summer time stays at the same hour.
 */
function dayMover(tz: string, fromIso: string, toIso: string) {
	const dayOf = (iso: string) => { const s = localStamp(iso, tz); return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)); };
	const days = Math.round((dayOf(toIso) - dayOf(fromIso)) / DAY);
	const move = (iso: string | null) => {
		if (!iso || !days) return iso;
		const s = localStamp(iso, tz);
		const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) + days * DAY).toISOString();
		return wallToIso(`${d.slice(0, 4)}${d.slice(5, 7)}${d.slice(8, 10)}${s.slice(8)}`, tz);
	};
	return { days, move };
}

export async function listEvents(env: Env) {
	return { ok: true as const, events: (await env.DB.prepare('SELECT id, title, starts_at FROM events ORDER BY starts_at DESC').all<{ id: string; title: string; starts_at: string }>()).results };
}

/** The event's details from the form; every field is required on create and optional (unchanged) on update. */
function details(input: Record<string, unknown>, was?: EventRow) {
	const pick = <T>(k: string, f: (v: unknown) => T, keep: T | undefined) => (input[k] === undefined && was ? (keep as T) : f(input[k]));
	const title = pick('title', (v) => cleanLine(v, 200), was?.title);
	if (!title) throw new UserError('Please give the event a title.');
	const starts_at = pick('starts_at', (v) => when(v, 'start'), was?.starts_at);
	const ends_at = pick('ends_at', (v) => when(v, 'end'), was?.ends_at);
	if (Date.parse(ends_at) <= Date.parse(starts_at)) throw new UserError('The event must end after it starts.');
	const deadline = pick('deadline', (v) => when(v, 'registration deadline'), was?.deadline);
	if (Date.parse(deadline) > Date.parse(ends_at)) throw new UserError('Registration must close before the event ends.');
	return {
		title, starts_at, ends_at, deadline,
		page_path: pick('page_path', pagePath, was?.page_path),
		timezone: pick('timezone', zone, was?.timezone),
		location: pick('location', (v) => cleanLine(v, 300) ?? '', was?.location),
		in_person_max: pick('in_person_max', (v) => whole(v, 'The in-person maximum', 0, 10000), was?.in_person_max),
		travel_minutes: pick('travel_minutes', (v) => (v === undefined || v === '' ? 60 : whole(v, 'Travel time', 0, 1440)), was?.travel_minutes),
		extra_question: pick('extra_question', (v) => cleanLine(v, 300), was?.extra_question ?? null),
		in_person_label: pick('in_person_label', (v) => cleanLine(v, 120), was?.in_person_label ?? null),
		remote_label: pick('remote_label', (v) => cleanLine(v, 120), was?.remote_label ?? null),
		tour_legend: pick('tour_legend', (v) => cleanLine(v, 120), was?.tour_legend ?? null),
	};
}

const COLS = ['title', 'starts_at', 'ends_at', 'deadline', 'page_path', 'timezone', 'location', 'in_person_max', 'travel_minutes', 'extra_question', 'in_person_label', 'remote_label', 'tour_legend'] as const;

function newId(v: unknown) {
	const id = String(v ?? '').trim().toLowerCase();
	if (!ID_RE.test(id)) throw new UserError('The event id must be 3 to 60 lower-case letters, digits and hyphens, e.g. 2027-03-12-london.');
	return id;
}
async function idFree(env: Env, id: string) {
	if (await env.DB.prepare('SELECT 1 FROM events WHERE id = ?').bind(id).first()) throw new UserError('An event with that id already exists.', 409);
}

function sessionFields(input: Record<string, unknown>, ev: EventRow) {
	const label = cleanLine(input.label, 120);
	if (!label) throw new UserError('Please give the session a name.');
	const kind = ['talk', 'tour', 'social', 'other'].includes(String(input.kind)) ? String(input.kind) : 'talk';
	const mode = ['in_person', 'online', 'hybrid'].includes(String(input.mode)) ? String(input.mode) : 'in_person';
	const starts_at = when(input.starts_at, 'session start'), ends_at = when(input.ends_at, 'session end');
	if (Date.parse(ends_at) <= Date.parse(starts_at)) throw new UserError(`${label}: the end must be after the start.`);
	// A day's slack either side, for a tour the morning before or drinks the night after.
	if (Date.parse(ends_at) < Date.parse(ev.starts_at) - DAY || Date.parse(starts_at) > Date.parse(ev.ends_at) + DAY) throw new UserError(`${label}: the session must be during the event, give or take a day.`);
	const choice_group = input.choice_group === 'tour' ? 'tour' : null;
	const optin = input.optin === true && !choice_group ? 1 : 0;
	const capacity = input.capacity === null || input.capacity === undefined || input.capacity === '' ? null : whole(input.capacity, 'Capacity', 0, 10000);
	return { label, kind, mode, starts_at, ends_at, choice_group, optin, capacity, location: cleanLine(input.location, 300) };
}

/** Organiser actions on events and sessions. Nobody is emailed. */
export async function eventAction(env: Env, input: Record<string, unknown>, by: string) {
	switch (input.action) {
		case 'create': {
			const id = newId(input.id);
			await idFree(env, id);
			const d = details(input);
			await env.DB.prepare(`INSERT INTO events (id, ${COLS.join(', ')}) VALUES (?${', ?'.repeat(COLS.length)})`).bind(id, ...COLS.map((c) => d[c])).run();
			return { ok: true as const, id };
		}
		case 'update': {
			const ev = await getEvent(env, String(input.event ?? ''));
			// A new date takes the programme with it: sessions left on the old day would stay in everyone's calendars
			// there. Whole days only, as a clone does, so correcting the start time alone leaves the sessions where they are.
			// The registration deadline moves too, unless a new one was given.
			const { days, move } = input.starts_at === undefined ? { days: 0, move: (x: string | null) => x } : dayMover(ev.timezone, ev.starts_at, when(input.starts_at, 'start'));
			const d = details(days && input.deadline === undefined ? { ...input, deadline: move(ev.deadline) } : input, ev);
			// Registrations, polls and host lists go 30 days after the end, and polls close at it: an end typed into the
			// past by mistake would delete everyone at the next cron run.
			const people = (await env.DB.prepare('SELECT COUNT(*) AS n FROM registrations WHERE event_id = ?').bind(ev.id).first<{ n: number }>())?.n ?? 0;
			if (people && d.ends_at !== ev.ends_at && Date.parse(d.ends_at) < Date.now()) {
				throw new UserError('People are registered for this event, so its end cannot be moved into the past: 30 days after the end, their registrations are deleted.', 409);
			}
			const sessions = (await getSessions(env, ev.id)).map((s) => ({ ...s, starts_at: move(s.starts_at)!, ends_at: move(s.ends_at)!, booking_deadline: move(s.booking_deadline) }));
			const latest = sessions.reduce((m, s) => Math.max(m, Date.parse(s.ends_at)), 0);
			if (latest && Date.parse(d.ends_at) < latest - DAY) throw new UserError('The event would end more than a day before its last session.');
			// Nobody is emailed, as for any event edit: calendars already sent catch up with each person's next email.
			await env.DB.batch([
				env.DB.prepare(`UPDATE events SET ${COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).bind(...COLS.map((c) => d[c]), ev.id),
				...(days ? sessions.map((s) => env.DB.prepare('UPDATE sessions SET starts_at = ?, ends_at = ?, booking_deadline = ? WHERE id = ?').bind(s.starts_at, s.ends_at, s.booking_deadline, s.id)) : []),
			]);
			return { ok: true as const, sessions_moved: days ? sessions.length : 0, days };
		}
		case 'clone': return cloneEvent(env, input, by);
		case 'add_session': {
			const ev = await getEvent(env, String(input.event ?? ''));
			const f = sessionFields(input, ev);
			const sessions = await getSessions(env, ev.id);
			const id = `${ev.id}-${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
			await env.DB.prepare(`INSERT INTO sessions (id, event_id, label, kind, mode, choice_group, starts_at, ends_at, location, capacity, sort, optin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
				.bind(id, ev.id, f.label, f.kind, f.mode, f.choice_group, f.starts_at, f.ends_at, f.location, f.capacity, Math.max(0, ...sessions.map((s) => s.sort)) + 1, f.optin).run();
			return { ok: true as const, id };
		}
		case 'delete_session': return deleteSession(env, String(input.session ?? ''));
		default:
			throw new UserError('Unknown action.');
	}
}

/**
 * Only while nothing depends on the session: nobody booked or signed up, no host was sent a list, no scheduled message
 * is addressed to it, and (for the core programme, which is in everyone's calendar) no invitations have gone out.
 */
async function deleteSession(env: Env, id: string) {
	const s = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<SessionRow>();
	if (!s) throw new UserError('Unknown session.', 404);
	const listed = `instr(',' || COALESCE(optins, '') || ',', ',' || ?1 || ',') > 0`;
	const why = await env.DB.prepare(
		`SELECT
			(SELECT COUNT(*) FROM registrations WHERE event_id = ?2 AND (tour_id = ?1 OR ${listed})) AS booked,
			(SELECT COUNT(*) FROM host_snapshots WHERE session_id = ?1) AS hosted,
			(SELECT COUNT(*) FROM messages WHERE event_id = ?2 AND status IN ('scheduled', 'sending', 'failed') AND instr(audience, '"' || ?1 || '"') > 0) AS messaged,
			(SELECT COUNT(*) FROM registrations WHERE event_id = ?2 AND status = 'confirmed' AND calendar_state != '{}') AS invited`,
	).bind(s.id, s.event_id).first<{ booked: number; hosted: number; messaged: number; invited: number }>();
	if (why?.booked) throw new UserError('People have booked or signed up for this session, so it cannot be deleted. Change its details instead.', 409);
	if (why?.hosted) throw new UserError('Its host has been sent an attendee list, so it cannot be deleted. Change its details instead.', 409);
	if (why?.messaged) throw new UserError('A message still to be sent is addressed to the people in this session. Cancel it first.', 409);
	if (!s.choice_group && !s.optin && why?.invited) throw new UserError('Calendar invitations have gone out that may include this session, so it cannot be deleted. Change its details instead.', 409);
	// Checked again in the delete itself, in case someone books it in between.
	const r = await env.DB.prepare(`DELETE FROM sessions WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM registrations WHERE event_id = ?2 AND (tour_id = ?1 OR ${listed}))`).bind(s.id, s.event_id).run();
	if (!r.meta.changes) throw new UserError('Someone has just booked this session, so it cannot be deleted.', 409);
	return { ok: true as const };
}

/**
 * The programme, latest joining instructions and polls (the organisers' own options only), moved to the new start;
 * never people, hosts, online links or answers. Every time keeps its wall-clock time in the event's zone and moves by
 * the same number of days, so a clone across a change to or from summer time stays at the same hour.
 */
async function cloneEvent(env: Env, input: Record<string, unknown>, by: string) {
	const from = await getEvent(env, String(input.event ?? ''));
	const id = newId(input.id);
	await idFree(env, id);
	const start = when(input.starts_at, 'new start');
	const page_path = pagePath(input.page_path);
	if (page_path === from.page_path) throw new UserError('Give the new event its own page: emails link to it.');
	const { move } = dayMover(from.timezone, from.starts_at, start);
	const d = { ...details({}, from), title: cleanLine(input.title, 200) ?? from.title, starts_at: start, ends_at: move(from.ends_at)!, deadline: move(from.deadline)!, page_path };
	const sessions = await getSessions(env, from.id);
	const ids = sessions.map((s) => (s.id.startsWith(`${from.id}-`) ? id + s.id.slice(from.id.length) : `${id}-${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`));
	if (ids.length) {
		const taken = await env.DB.prepare(`SELECT id FROM sessions WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).first();
		if (taken) throw new UserError('Sessions with the new event\'s ids already exist: choose another event id.', 409);
	}
	const stmts = [env.DB.prepare(`INSERT INTO events (id, ${COLS.join(', ')}, host_list_minutes) VALUES (?${', ?'.repeat(COLS.length)}, ?)`).bind(id, ...COLS.map((c) => d[c]), from.host_list_minutes ?? 0)];
	sessions.forEach((s, i) => stmts.push(env.DB.prepare(`INSERT INTO sessions (id, event_id, label, kind, mode, choice_group, starts_at, ends_at, location, online_url, capacity, booking_deadline, sort, optin)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(ids[i], id, s.label, s.kind, s.mode, s.choice_group, move(s.starts_at), move(s.ends_at), s.location, null, s.capacity, move(s.booking_deadline), s.sort, s.optin ?? 0)));
	const instr = await latestInstructions(env, from.id);
	if (instr) stmts.push(env.DB.prepare('INSERT INTO instructions (event_id, version, subject, body_md, change_note, created_at, created_by) VALUES (?,1,?,?,?,?,?)')
		.bind(id, instr.subject, instr.body_md, `Copied from ${from.id}, version ${instr.version}`, nowIso(), by));
	const polls = (await env.DB.prepare('SELECT * FROM polls WHERE event_id = ?').bind(from.id).all<{ id: string; question: string; allow_suggestions: number; closes_at: string | null; sort: number }>()).results;
	// Registrants' accepted suggestions are their own words, deleted with the event's retention: not carried forward.
	const options = (await env.DB.prepare(`SELECT poll_id, label, sort FROM poll_options WHERE status = 'active' AND suggested_by IS NULL AND suggested_label IS NULL
		AND poll_id IN (SELECT id FROM polls WHERE event_id = ?)`).bind(from.id).all<{ poll_id: string; label: string; sort: number }>()).results;
	for (const p of polls) {
		const pid = randomToken(12);
		stmts.push(env.DB.prepare('INSERT INTO polls (id, event_id, question, allow_suggestions, closes_at, sort, created_at) VALUES (?,?,?,?,?,?,?)').bind(pid, id, p.question, p.allow_suggestions, move(p.closes_at), p.sort, nowIso()));
		for (const o of options.filter((x) => x.poll_id === p.id)) stmts.push(env.DB.prepare(`INSERT INTO poll_options (id, poll_id, label, status, sort, created_at) VALUES (?,?,?,'active',?,?)`).bind(randomToken(12), pid, o.label, o.sort, nowIso()));
	}
	await env.DB.batch(stmts);
	return { ok: true as const, id };
}

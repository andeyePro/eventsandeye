// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import type { Env } from './env';
import { getEvent, getSessions, latestInstructions, UserError } from './rsvp';
import type { EventRow, SessionRow } from './templates';
import { cleanLine, nowIso, randomToken } from './util';

/**
 * Setting events up from the admin page instead of SQL: create, edit and clone events, and add or remove sessions.
 * None of it emails anyone. Calendars already sent catch up with each person's next email, as after a quiet save.
 */

const ID_RE = /^[a-z0-9][a-z0-9-]{2,59}$/;

const when = (v: unknown, label: string, required = true) => {
	if (v === null || v === undefined || v === '') {
		if (required) throw new UserError(`Please give the ${label}.`);
		return null;
	}
	const t = Date.parse(String(v));
	if (Number.isNaN(t)) throw new UserError(`Invalid ${label}.`);
	return new Date(t).toISOString();
};
const whole = (v: unknown, label: string, min: number, max: number) => {
	const n = Number(v);
	if (!Number.isInteger(n) || n < min || n > max) throw new UserError(`${label} must be a whole number from ${min} to ${max}.`);
	return n;
};
const zone = (v: unknown) => {
	const tz = typeof v === 'string' && v ? v : 'Europe/London';
	try {
		new Intl.DateTimeFormat('en-GB', { timeZone: tz });
	} catch {
		throw new UserError('Unknown time zone: use a name such as Europe/London or America/New_York.');
	}
	return tz;
};

export async function listEvents(env: Env) {
	return { ok: true as const, events: (await env.DB.prepare('SELECT id, title, starts_at FROM events ORDER BY starts_at DESC').all<{ id: string; title: string; starts_at: string }>()).results };
}

/** The event's details from the form; every field is required on create and optional (unchanged) on update. */
function details(input: Record<string, unknown>, was?: EventRow) {
	const pick = <T>(k: string, f: (v: unknown) => T, keep: T | undefined) => (input[k] === undefined && was ? (keep as T) : f(input[k]));
	const title = pick('title', (v) => cleanLine(v, 200), was?.title);
	if (!title) throw new UserError('Please give the event a title.');
	const starts_at = pick('starts_at', (v) => when(v, 'start')!, was?.starts_at);
	const ends_at = pick('ends_at', (v) => when(v, 'end')!, was?.ends_at);
	if (Date.parse(ends_at) <= Date.parse(starts_at)) throw new UserError('The event must end after it starts.');
	const deadline = pick('deadline', (v) => when(v, 'registration deadline')!, was?.deadline);
	const page_path = pick('page_path', (v) => cleanLine(v, 200), was?.page_path);
	if (!page_path || !page_path.startsWith('/') || /\s/.test(page_path)) throw new UserError('The event page must be a path on your site, starting with /.');
	return {
		title, starts_at, ends_at, deadline, page_path,
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

function sessionFields(input: Record<string, unknown>) {
	const label = cleanLine(input.label, 120);
	if (!label) throw new UserError('Please give the session a name.');
	const kind = ['talk', 'tour', 'social', 'other'].includes(String(input.kind)) ? String(input.kind) : 'talk';
	const mode = ['in_person', 'online', 'hybrid'].includes(String(input.mode)) ? String(input.mode) : 'in_person';
	const starts_at = when(input.starts_at, 'session start')!, ends_at = when(input.ends_at, 'session end')!;
	if (Date.parse(ends_at) <= Date.parse(starts_at)) throw new UserError(`${label}: the end must be after the start.`);
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
			const d = details(input, ev);
			await env.DB.prepare(`UPDATE events SET ${COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).bind(...COLS.map((c) => d[c]), ev.id).run();
			return { ok: true as const };
		}
		case 'clone': {
			// The programme, latest joining instructions and polls, moved to the new start; never people, hosts or answers.
			const from = await getEvent(env, String(input.event ?? ''));
			const id = newId(input.id);
			await idFree(env, id);
			const start = when(input.starts_at, 'new start')!;
			const shift = Date.parse(start) - Date.parse(from.starts_at);
			const move = (iso: string | null) => (iso ? new Date(Date.parse(iso) + shift).toISOString() : null);
			const d = { ...details({}, from), title: cleanLine(input.title, 200) ?? from.title, starts_at: start, ends_at: move(from.ends_at)!, deadline: move(from.deadline)!,
				page_path: cleanLine(input.page_path, 200) ?? from.page_path };
			const stmts = [env.DB.prepare(`INSERT INTO events (id, ${COLS.join(', ')}, host_list_minutes) VALUES (?${', ?'.repeat(COLS.length)}, ?)`).bind(id, ...COLS.map((c) => d[c]), from.host_list_minutes ?? 0)];
			const ids = new Map<string, string>();
			for (const s of await getSessions(env, from.id)) {
				const sid = s.id.startsWith(from.id) ? id + s.id.slice(from.id.length) : `${id}-${randomToken(6)}`;
				ids.set(s.id, sid);
				stmts.push(env.DB.prepare(`INSERT INTO sessions (id, event_id, label, kind, mode, choice_group, starts_at, ends_at, location, online_url, capacity, booking_deadline, sort, optin)
					VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(sid, id, s.label, s.kind, s.mode, s.choice_group, move(s.starts_at), move(s.ends_at), s.location, null, s.capacity, move(s.booking_deadline), s.sort, s.optin ?? 0));
			}
			const instr = await latestInstructions(env, from.id);
			if (instr) stmts.push(env.DB.prepare('INSERT INTO instructions (event_id, version, subject, body_md, change_note, created_at, created_by) VALUES (?,1,?,?,?,?,?)')
				.bind(id, instr.subject, instr.body_md, `Copied from ${from.id}, version ${instr.version}`, nowIso(), by));
			const polls = (await env.DB.prepare('SELECT * FROM polls WHERE event_id = ?').bind(from.id).all<{ id: string; question: string; allow_suggestions: number; closes_at: string | null; sort: number }>()).results;
			for (const p of polls) {
				const pid = randomToken(12);
				stmts.push(env.DB.prepare('INSERT INTO polls (id, event_id, question, allow_suggestions, closes_at, sort, created_at) VALUES (?,?,?,?,?,?,?)').bind(pid, id, p.question, p.allow_suggestions, move(p.closes_at), p.sort, nowIso()));
				const opts = (await env.DB.prepare(`SELECT label, sort FROM poll_options WHERE poll_id = ? AND status = 'active'`).bind(p.id).all<{ label: string; sort: number }>()).results;
				for (const o of opts) stmts.push(env.DB.prepare(`INSERT INTO poll_options (id, poll_id, label, status, sort, created_at) VALUES (?,?,?,'active',?,?)`).bind(randomToken(12), pid, o.label, o.sort, nowIso()));
			}
			await env.DB.batch(stmts);
			return { ok: true as const, id };
		}
		case 'add_session': {
			const ev = await getEvent(env, String(input.event ?? ''));
			const f = sessionFields(input);
			const sessions = await getSessions(env, ev.id);
			const id = `${ev.id}-${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
			await env.DB.prepare(`INSERT INTO sessions (id, event_id, label, kind, mode, choice_group, starts_at, ends_at, location, capacity, sort, optin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
				.bind(id, ev.id, f.label, f.kind, f.mode, f.choice_group, f.starts_at, f.ends_at, f.location, f.capacity, Math.max(0, ...sessions.map((s) => s.sort)) + 1, f.optin).run();
			return { ok: true as const, id };
		}
		case 'delete_session': {
			// Only while nobody has booked or signed up for it: their calendars and host lists would quietly go wrong.
			const s = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(String(input.session ?? '')).first<SessionRow>();
			if (!s) throw new UserError('Unknown session.', 404);
			const used = await env.DB.prepare(`SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND (tour_id = ?2 OR instr(',' || COALESCE(optins, '') || ',', ',' || ?2 || ',') > 0)`)
				.bind(s.event_id, s.id).first<{ n: number }>();
			const sent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND status = 'confirmed' AND calendar_state != '{}'`).bind(s.event_id).first<{ n: number }>();
			if ((used?.n ?? 0) > 0) throw new UserError('People have booked or signed up for this session, so it cannot be deleted. Change its details instead.', 409);
			if (!s.choice_group && !s.optin && (sent?.n ?? 0) > 0) throw new UserError('Calendar invitations have gone out that may include this session, so it cannot be deleted. Change its details instead.', 409);
			await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(s.id).run();
			return { ok: true as const };
		}
		default:
			throw new UserError('Unknown action.');
	}
}

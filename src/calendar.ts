// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import type { Attachment } from './email';
import { type Env, fromAddress, orgName, siteUrl } from './env';
import { buildIcs, type CalEntry } from './ics';
import type { EventRow, RegistrationRow, SessionRow } from './templates';
import { sha256 } from './util';

/** What we last sent for each calendar entry of a registration. */
export interface EntryState { seq: number; hash: string; uid: string; summary: string; start: string; end: string; location: string }
export type CalendarState = Record<string, EntryState>;

const hostOf = (env: Env) => new URL(siteUrl(env)).hostname;
const hm = (iso: string, tz: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));

export const isCore = (s: SessionRow) => !s.choice_group && s.kind !== 'social';

/**
 * Calendar entries for a registration:
 * - remote: one entry per online or hybrid core session, reminders a day, an hour and 10 minutes before;
 * - in person: one entry for the day, from their booked tour (or the first core session) to the last core session,
 *   reminders a week and a day before, "time to leave" (travel time + 15 minutes) and 15 minutes before.
 * Nobody without a confirmed place gets entries (unconfirmed, or waiting for an in-person place).
 */
export function entriesFor(env: Env, ev: EventRow, sessions: SessionRow[], reg: RegistrationRow, manageUrl: string): CalEntry[] {
	if (reg.status !== 'confirmed') return [];
	if (reg.attendance === 'in_person' && reg.place !== 'place') return [];
	const tz = ev.timezone;
	const uid = (key: string) => `${reg.id}-${key}@${hostOf(env)}`;
	const manage = `Change or cancel your registration: ${manageUrl}`;
	const ordered = [...sessions].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.sort - b.sort);

	if (reg.attendance === 'remote') {
		return ordered.filter((s) => isCore(s) && (s.mode === 'online' || s.mode === 'hybrid')).map((s) => ({
			key: `s-${s.id}`,
			uid: uid(`s-${s.id}`),
			summary: `${ev.title}: ${s.label} (online)`,
			location: s.online_url || 'Online – the link will follow by email',
			url: s.online_url || undefined,
			start: s.starts_at,
			end: s.ends_at,
			description: [s.online_url ? `Join online: ${s.online_url}` : 'The online link will follow by email before the day.', '', manage].join('\n'),
			alarms: ['-P1D', '-PT1H', '-PT10M'],
		}));
	}

	const core = ordered.filter((s) => isCore(s) && s.mode !== 'online');
	const tour = reg.tour_id && reg.tour_place === 'place' ? ordered.find((s) => s.id === reg.tour_id) : undefined;
	if (!core.length && !tour) return [];
	const starts = [...core.map((s) => s.starts_at), ...(tour ? [tour.starts_at] : [])].sort();
	const ends = [...core.map((s) => s.ends_at), ...(tour ? [tour.ends_at] : [])].sort();
	const schedule = ordered
		.filter((s) => isCore(s) ? s.mode !== 'online' : s.id === reg.tour_id || s.kind === 'social')
		.map((s) => {
			let note = '';
			if (s.id === reg.tour_id) note = reg.tour_place === 'waitlist' ? ' (you are on the waiting list)' : ' (booked)';
			if (s.kind === 'social') note = ` (optional${s.location ? `, ${s.location}` : ''})`;
			return `${hm(s.starts_at, tz)} ${s.label}${note}`;
		});
	const travel = ev.travel_minutes || 60;
	return [{
		key: 'day',
		uid: uid('day'),
		summary: ev.title,
		location: ev.location,
		start: starts[0],
		end: ends[ends.length - 1],
		description: [
			'Your day:', ...schedule, '',
			`The "time to leave" reminder assumes about ${travel} minutes' travel; adjust it in your calendar if you need longer.`, '',
			manage,
		].join('\n'),
		alarms: ['-P7D', '-P1D', `-PT${travel + 15}M`, '-PT15M'],
	}];
}

const hashEntry = (e: CalEntry) => sha256(JSON.stringify([e.summary, e.description, e.location, e.start, e.end, e.url ?? '', e.alarms]));

export interface CalendarPlan {
	entries: CalEntry[];
	requests: { entry: CalEntry; seq: number }[]; // new or changed entries to (re)send
	cancels: EntryState[]; // entries that no longer apply, with bumped sequence
	state: CalendarState; // state to store once sent
	unchanged: { entry: CalEntry; seq: number }[];
}

export async function plan(prev: CalendarState, entries: CalEntry[]): Promise<CalendarPlan> {
	const state: CalendarState = {};
	const requests: CalendarPlan['requests'] = [];
	const unchanged: CalendarPlan['unchanged'] = [];
	for (const e of entries) {
		const h = await hashEntry(e);
		const p = prev[e.key];
		const seq = !p ? 0 : p.hash === h ? p.seq : p.seq + 1;
		state[e.key] = { seq, hash: h, uid: e.uid, summary: e.summary, start: e.start, end: e.end, location: e.location };
		if (!p || p.hash !== h) requests.push({ entry: e, seq });
		else unchanged.push({ entry: e, seq });
	}
	const cancels = Object.entries(prev).filter(([k]) => !state[k]).map(([, v]) => ({ ...v, seq: v.seq + 1 }));
	return { entries, requests, cancels, state, unchanged };
}

export function parseState(json: string | null | undefined): CalendarState {
	try {
		const v = JSON.parse(json || '{}');
		return v && typeof v === 'object' ? v : {};
	} catch {
		return {};
	}
}

export function attachments(env: Env, ev: EventRow, reg: RegistrationRow, requests: { entry: CalEntry; seq: number }[], cancels: EntryState[]): Attachment[] {
	const organizer = { name: orgName(env), email: fromAddress(env) };
	const attendee = { name: reg.name, email: reg.email };
	const out: Attachment[] = [];
	requests.forEach(({ entry, seq }, i) => out.push({
		filename: requests.length + cancels.length > 1 ? `invite-${i + 1}.ics` : 'invite.ics',
		content_type: 'text/calendar; method=REQUEST; charset=UTF-8',
		content: buildIcs({ method: 'REQUEST', entry, sequence: seq, organizer, attendee, tz: ev.timezone }),
	}));
	cancels.forEach((c, i) => out.push({
		filename: `cancel-${i + 1}.ics`,
		content_type: 'text/calendar; method=CANCEL; charset=UTF-8',
		content: buildIcs({ method: 'CANCEL', entry: { key: '', uid: c.uid, summary: c.summary, description: 'Cancelled', location: c.location, start: c.start, end: c.end, alarms: [] }, sequence: c.seq, organizer, attendee, tz: ev.timezone }),
	}));
	return out;
}

export async function saveState(env: Env, regId: string, state: CalendarState) {
	await env.DB.prepare('UPDATE registrations SET calendar_state = ? WHERE id = ?').bind(JSON.stringify(state), regId).run();
}

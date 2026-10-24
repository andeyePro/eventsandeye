// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import type { Attachment } from './email';
import { type Env, fromAddress, orgName, siteUrl } from './env';
import { buildIcs, type CalEntry } from './ics';
import { modeOf } from './mode';
import type { EventRow, RegistrationRow, SessionRow } from './templates';
import { sha256 } from './util';

/** What we last sent for each calendar entry of a registration. */
export interface EntryState { seq: number; hash: string; uid: string; summary: string; start: string; end: string; location: string; cancelled?: boolean }
export type CalendarState = Record<string, EntryState>;

const hostOf = (env: Env) => new URL(siteUrl(env)).hostname;
const hm = (iso: string, tz: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));

export const isCore = (s: SessionRow) => !s.choice_group && s.kind !== 'social';

/**
 * Calendar entries for a registration:
 * - remote: one entry per online or hybrid core session, reminders a day, an hour and 10 minutes before;
 * - in person: one entry for the day, from their booked tour (or the first core session) to the last core session,
 *   reminders a week and a day before, "time to leave" (travel time + 15 minutes) and 15 minutes before.
 * Most calendar apps ignore an invitation's own reminders and apply the attendee's defaults, so the entries carry
 * them for the apps that honour them but no text promises them.
 * Nobody without a confirmed place gets entries (unconfirmed, or waiting for an in-person place).
 */
/** An event's name for its online entries: without a trailing place that is part of its venue ("Community Day, Glasgow"
 * becomes "Community Day"), since someone joining online isn't going there. */
export function onlineTitle(ev: Pick<EventRow, 'title' | 'location'>): string {
	const m = /^(.*\S),\s*([^,]+)$/.exec(ev.title);
	return m && (ev.location ?? '').toLowerCase().includes(m[2].trim().toLowerCase()) ? m[1] : ev.title;
}

export function entriesFor(env: Env, ev: EventRow, sessions: SessionRow[], reg: RegistrationRow): CalEntry[] {
	if (reg.status !== 'confirmed') return [];
	if (reg.attendance === 'in_person' && reg.place === 'waitlist') return [];
	const tz = ev.timezone;
	const uid = (key: string) => `${reg.id}-${key}@${hostOf(env)}`;
	// Calendar entries are often shared (delegates, forwarded invitations), so they never carry the manage link.
	const manage = `Event details: ${siteUrl(env)}${ev.page_path}\nTo change or cancel, use the "Manage my registration" link in your registration emails.`;
	const ordered = [...sessions].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.sort - b.sort);

	if (reg.attendance === 'remote') {
		return ordered.filter((s) => isCore(s) && (s.mode === 'online' || s.mode === 'hybrid')).map((s) => ({
			key: `s-${s.id}`,
			uid: uid(`s-${s.id}`),
			summary: `${onlineTitle(ev)}: ${s.label} (online)`,
			location: s.online_url || 'Online – the link will follow by email',
			url: s.online_url || undefined,
			start: s.starts_at,
			end: s.ends_at,
			description: [s.online_url ? `Join online: ${s.online_url}` : 'The online link will follow by email before the day.', '', manage].join('\n'),
			alarms: ['-P1D', '-PT1H', '-PT10M'],
		}));
	}

	// The opt-in sessions this person has a place at (e.g. dinner) each get an entry of their own, at their own place,
	// whether they come for the day too or only for these. Waiting for one gets no entry until they are promoted.
	const optinIds = (reg.optins ?? '').split(',');
	const waitingIds = (reg.optins_waiting ?? '').split(',');
	const optinEntries: CalEntry[] = ordered.filter((s) => s.optin && optinIds.includes(s.id) && !waitingIds.includes(s.id)).map((s) => ({
		key: `s-${s.id}`,
		uid: uid(`s-${s.id}`),
		summary: `${ev.title}: ${s.label}`,
		location: s.location || ev.location,
		start: s.starts_at,
		end: s.ends_at,
		description: [`${s.label}${s.location ? `, ${s.location}` : ''}`, '', manage].join('\n'),
		alarms: ['-P1D', '-PT1H'],
	}));
	if (modeOf(reg) === 'extras') return optinEntries;

	const core = ordered.filter((s) => isCore(s) && s.mode !== 'online');
	const tour = reg.tour_id && reg.tour_place === 'place' ? ordered.find((s) => s.id === reg.tour_id) : undefined;
	if (!core.length && !tour) return optinEntries;
	const starts = [...core.map((s) => s.starts_at), ...(tour ? [tour.starts_at] : [])].sort();
	const ends = [...core.map((s) => s.ends_at), ...(tour ? [tour.ends_at] : [])].sort();
	const schedule = ordered
		.filter((s) => isCore(s) ? s.mode !== 'online' : s.id === reg.tour_id || s.kind === 'social')
		.map((s) => {
			let note = '';
			if (s.id === reg.tour_id) note = reg.tour_place === 'waitlist' ? ' (you are on the waiting list)' : ' (booked)';
			if (s.kind === 'social') note = s.optin && waitingIds.includes(s.id) && optinIds.includes(s.id) ? ' (you are on the waiting list)' : s.optin && optinIds.includes(s.id) ? ` (you signed up${s.location ? `, ${s.location}` : ''})` : ` (optional${s.location ? `, ${s.location}` : ''})`;
			return `${hm(s.starts_at, tz)} ${s.label}${note}`;
		});
	const travel = ev.travel_minutes ?? 60; // 0 is a real answer (no travel), not "unset"
	return [{
		key: 'day',
		uid: uid('day'),
		summary: ev.title,
		location: ev.location,
		start: starts[0],
		end: ends[ends.length - 1],
		description: [
			'Your day:', ...schedule, '',
			manage,
		].join('\n'),
		alarms: ['-P7D', '-P1D', `-PT${travel + 15}M`, '-PT15M'],
	}, ...optinEntries];
}

// Times are normalised so that re-saving the same time in another ISO spelling ('…:00Z' vs '…:00.000Z') is not a change.
const iso = (t: string) => { const d = Date.parse(t); return Number.isNaN(d) ? t : new Date(d).toISOString(); };
export const hashEntry = (e: CalEntry) => sha256(JSON.stringify([e.summary, e.description, e.location, iso(e.start), iso(e.end), e.url ?? '', e.alarms]));

export interface CalendarPlan {
	entries: CalEntry[];
	requests: { entry: CalEntry; seq: number; was?: EntryState }[]; // new or changed entries to (re)send, with what they replace
	cancels: EntryState[]; // entries that no longer apply, with bumped sequence
	state: CalendarState; // state to store once sent
	unchanged: { entry: CalEntry; seq: number }[];
}

export async function plan(prev: CalendarState, entries: CalEntry[]): Promise<CalendarPlan> {
	const state: CalendarState = {};
	const requests: CalendarPlan['requests'] = [];
	const unchanged: CalendarPlan['unchanged'] = [];
	const out: CalEntry[] = [];
	for (const e0 of entries) {
		const p = prev[e0.key];
		// A UID, once sent, is kept for good (a site that changes address must not duplicate entries), and an entry that
		// was cancelled and comes back continues its sequence: a lower number than the cancellation is ignored as stale.
		const e = p ? { ...e0, uid: p.uid } : e0;
		out.push(e);
		const h = await hashEntry(e);
		const seq = !p ? 0 : p.cancelled || p.hash !== h ? p.seq + 1 : p.seq;
		state[e.key] = { seq, hash: h, uid: e.uid, summary: e.summary, start: e.start, end: e.end, location: e.location };
		if (!p || p.cancelled || p.hash !== h) requests.push({ entry: e, seq, ...(p && !p.cancelled ? { was: p } : {}) });
		else unchanged.push({ entry: e, seq });
	}
	// Entries that no longer apply are cancelled once, then remembered with the cancellation's sequence in case they return.
	const cancels = Object.entries(prev).filter(([k, v]) => !state[k] && !v.cancelled).map(([, v]) => ({ ...v, seq: v.seq + 1 }));
	for (const [k, v] of Object.entries(prev)) if (!state[k]) state[k] = v.cancelled ? v : { ...v, seq: v.seq + 1, cancelled: true };
	return { entries: out, requests, cancels, state, unchanged };
}

/** The entries actually in someone's calendar: cancelled ones are only remembered. */
export const liveState = (state: CalendarState) => Object.values(state).filter((s) => !s.cancelled);

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

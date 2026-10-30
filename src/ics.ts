// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
/**
 * Minimal RFC 5545 / RFC 5546 (iTIP) calendar builder: one VEVENT per file, as iTIP requires a single UID per
 * message. Times are written in the event's time zone, with a VTIMEZONE for it (UTC if the zone is unknown).
 */

export interface CalEntry {
	key: string; // stable per registration, e.g. 'day' or 's-<session id>'
	uid: string;
	summary: string;
	description: string;
	location: string;
	start: string; // ISO UTC
	end: string; // ISO UTC
	url?: string;
	alarms: string[]; // RFC 5545 durations before start, e.g. '-P1D', '-PT15M'
}

export interface Organizer {
	name: string;
	email: string;
}

const LONDON_VTIMEZONE = [
	'BEGIN:VTIMEZONE', 'TZID:Europe/London',
	'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0100', 'TZNAME:BST', 'DTSTART:19700329T010000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
	'BEGIN:STANDARD', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000', 'TZNAME:GMT', 'DTSTART:19701025T020000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
	'END:VTIMEZONE',
];

export function escapeText(s: string): string {
	return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Parameter values (RFC 5545 §3.2) cannot contain escapes: drop quotes and line breaks, then always quote. */
export const paramValue = (v: string) => `"${v.replace(/["\r\n]/g, '').replace(/[\u0000-\u001f]/g, '')}"`;

/** Fold to 75 octets per line (RFC 5545 §3.1) without splitting UTF-8 characters. */
export function fold(line: string): string {
	const enc = new TextEncoder();
	if (enc.encode(line).length <= 75) return line;
	const out: string[] = [];
	let cur = '';
	let curLen = 0;
	for (const ch of line) {
		const n = enc.encode(ch).length;
		const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
		if (curLen + n > limit) {
			out.push(cur);
			cur = '';
			curLen = 0;
		}
		cur += ch;
		curLen += n;
	}
	out.push(cur);
	return out.join('\r\n ');
}

export const utcStamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '').replace(/Z?$/, 'Z');

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Wall-clock YYYYMMDDTHHMMSS in a time zone. One formatter per zone: building them is most of the cost. */
export function localStamp(iso: string, tz: string): string {
	let f = formatters.get(tz);
	if (!f) formatters.set(tz, (f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })));
	const parts = f.formatToParts(new Date(iso));
	const g = (t: string) => parts.find((p) => p.type === t)!.value;
	return `${g('year')}${g('month')}${g('day')}T${g('hour')}${g('minute')}${g('second')}`;
}

const knownZone = (tz: string) => {
	try {
		new Intl.DateTimeFormat('en-GB', { timeZone: tz });
		return tz !== 'UTC' && tz !== 'Etc/UTC';
	} catch {
		return false;
	}
};

/** The zone's offset from UTC in minutes at an instant, from its wall-clock time there. */
function offsetMinutes(ms: number, tz: string): number {
	const s = localStamp(new Date(ms).toISOString(), tz);
	const wall = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15));
	return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60000);
}
const fmtOffset = (m: number) => `${m < 0 ? '-' : '+'}${String(Math.floor(Math.abs(m) / 60)).padStart(2, '0')}${String(Math.abs(m) % 60).padStart(2, '0')}`;
const wallStamp = (ms: number) => utcStamp(new Date(ms).toISOString()).slice(0, 15);

/**
 * A VTIMEZONE for any zone, without a time zone database of our own: the runtime's Intl data gives the offset at any
 * instant, so each change of offset within a year either side of the event is found by search and written as an
 * observance of its own (no RRULEs to get wrong). Calendar apps need only the rules around the event's own dates.
 */
const zones = new Map<string, string[]>();
export function vtimezone(tz: string, aroundIso: string): string[] {
	if (tz === 'Europe/London') return LONDON_VTIMEZONE;
	// From the start of the event's UTC day, so the search runs on whole minutes, and so every file for the same event
	// (and the cache) shares one answer.
	const DAY = 86400_000, day = Math.floor(Date.parse(aroundIso) / DAY) * DAY;
	const key = `${tz}|${day}`;
	const cached = zones.get(key);
	if (cached) return cached;
	const from = day - 366 * DAY, to = day + 366 * DAY;
	const changes: { at: number; before: number; after: number }[] = [];
	let prev = offsetMinutes(from, tz);
	// A day at a time: no zone changes its offset and back again within a day.
	for (let t = from + DAY; t <= to; t += DAY) {
		const cur = offsetMinutes(t, tz);
		if (cur === prev) continue;
		let lo = t - DAY, hi = t; // the change is in (lo, hi]
		while (hi - lo > 60_000) {
			const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
			if (offsetMinutes(mid, tz) === prev) lo = mid; else hi = mid;
		}
		changes.push({ at: hi, before: prev, after: cur });
		prev = cur;
	}
	const first = offsetMinutes(from, tz);
	const offsets = [first, ...changes.map((c) => c.after)];
	const standard = Math.min(...offsets);
	const block = (startWall: number, before: number, after: number) => {
		const kind = after > standard ? 'DAYLIGHT' : 'STANDARD';
		return [`BEGIN:${kind}`, `TZOFFSETFROM:${fmtOffset(before)}`, `TZOFFSETTO:${fmtOffset(after)}`, `DTSTART:${wallStamp(startWall)}`, `END:${kind}`];
	};
	const out = [
		'BEGIN:VTIMEZONE', `TZID:${tz}`,
		// In force from before the first change found; its DTSTART is the start of the search window, in local time.
		...block(from + first * 60_000, first, first),
		// Each change starts at the local time it happened, counted in the offset it replaced (RFC 5545 §3.6.5).
		...changes.flatMap((c) => block(c.at + c.before * 60_000, c.before, c.after)),
		'END:VTIMEZONE',
	];
	zones.set(key, out);
	return out;
}

function dt(prop: string, iso: string, tz: string): string {
	return knownZone(tz) ? `${prop};TZID=${tz}:${localStamp(iso, tz)}` : `${prop}:${utcStamp(iso)}`;
}

export function buildIcs(opts: {
	method: 'REQUEST' | 'CANCEL' | 'PUBLISH';
	entry: CalEntry;
	sequence: number;
	organizer: Organizer;
	attendee?: { name: string; email: string };
	tz: string;
	now?: string;
}): string {
	const { method, entry, sequence, organizer, attendee, tz } = opts;
	const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//andeye Ltd//Events&I//EN', 'CALSCALE:GREGORIAN', `METHOD:${method}`];
	if (knownZone(tz)) lines.push(...vtimezone(tz, entry.start));
	lines.push(
		'BEGIN:VEVENT',
		`UID:${entry.uid}`,
		`SEQUENCE:${sequence}`,
		`DTSTAMP:${utcStamp(opts.now ?? new Date().toISOString())}`,
		dt('DTSTART', entry.start, tz),
		dt('DTEND', entry.end, tz),
		`SUMMARY:${escapeText(entry.summary)}`,
		`LOCATION:${escapeText(entry.location)}`,
		`DESCRIPTION:${escapeText(entry.description)}`,
		`STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
		'TRANSP:OPAQUE',
	);
	if (entry.url) lines.push(`URL:${entry.url}`);
	// ORGANIZER is required for every method (RFC 5546); only REQUEST and CANCEL are addressed to an attendee.
	lines.push(`ORGANIZER;CN=${paramValue(organizer.name)}:mailto:${organizer.email}`);
	if (method !== 'PUBLISH') {
		if (attendee) lines.push(`ATTENDEE;CN=${paramValue(attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=${method === 'CANCEL' ? 'DECLINED' : 'NEEDS-ACTION'};RSVP=FALSE:mailto:${attendee.email}`);
	}
	if (method !== 'CANCEL') {
		for (const a of entry.alarms) {
			lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(entry.summary)}`, `TRIGGER:${a}`, 'END:VALARM');
		}
	}
	lines.push('END:VEVENT', 'END:VCALENDAR');
	return lines.map(fold).join('\r\n') + '\r\n';
}

const compact = (iso: string) => utcStamp(iso);

/** "Add to calendar" links for services that cannot read an attachment. */
export function addLinks(e: CalEntry) {
	const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
	const body = e.description.slice(0, 1500);
	const isoNoMs = (iso: string) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
	return {
		google: `https://calendar.google.com/calendar/render?${q({ action: 'TEMPLATE', text: e.summary, dates: `${compact(e.start)}/${compact(e.end)}`, details: body, location: e.location })}`,
		outlook: `https://outlook.live.com/calendar/0/deeplink/compose?${q({ path: '/calendar/action/compose', rru: 'addevent', subject: e.summary, startdt: isoNoMs(e.start), enddt: isoNoMs(e.end), body, location: e.location })}`,
		office365: `https://outlook.office.com/calendar/0/deeplink/compose?${q({ path: '/calendar/action/compose', rru: 'addevent', subject: e.summary, startdt: isoNoMs(e.start), enddt: isoNoMs(e.end), body, location: e.location })}`,
		yahoo: `https://calendar.yahoo.com/?${q({ v: '60', title: e.summary, st: compact(e.start), et: compact(e.end), desc: body, in_loc: e.location })}`,
	};
}

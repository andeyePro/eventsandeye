// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import { sendEmail } from './email';
import type { Env } from './env';
import { type Brand, type EventRow, type HostLine, hostListEmail, type RegistrationRow, type SessionRow } from './templates';
import { nowIso } from './util';

/** Who belongs on a session host's list. Only confirmed registrations appear; emails only with the registrant's consent. */
export function hostLines(s: SessionRow, regs: RegistrationRow[]): HostLine[] {
	const confirmed = regs.filter((r) => r.status === 'confirmed').sort((a, b) => (a.confirmed_at ?? '').localeCompare(b.confirmed_at ?? ''));
	const line = (r: RegistrationRow, detail: string): HostLine => ({ id: r.id, name: `${r.name}${r.affiliation ? ` (${r.affiliation})` : ''}`, detail, ...(r.share_contact ? { email: r.email } : {}) });
	if (s.choice_group) {
		return confirmed.filter((r) => r.tour_id === s.id && r.attendance === 'in_person').map((r) => line(r, r.tour_place === 'waitlist' ? 'waiting list' : r.place === 'waitlist' ? 'booked, but waiting for an in-person place' : 'booked'));
	}
	const out: HostLine[] = [];
	for (const r of confirmed) {
		if (r.attendance === 'remote') {
			if (s.mode !== 'in_person' && s.kind !== 'social') out.push(line(r, 'remote'));
		} else if (s.mode !== 'online') {
			out.push(line(r, r.place === 'waitlist' ? 'in-person waiting list' : 'in person'));
		}
	}
	return out;
}

/** Emails each session host whose list has changed since the last email, showing the differences. */
export async function syncHosts(env: Env, brand: Brand, ev: EventRow, sessions: SessionRow[]) {
	const hosted = sessions.filter((s) => s.host_email);
	if (!hosted.length) return 0;
	const regs = (await env.DB.prepare('SELECT * FROM registrations WHERE event_id = ?').bind(ev.id).all<RegistrationRow>()).results;
	let sent = 0;
	for (const s of hosted) {
		const current = hostLines(s, regs);
		const snap = await env.DB.prepare('SELECT snapshot FROM host_snapshots WHERE session_id = ?').bind(s.id).first<{ snapshot: string }>();
		const prev: HostLine[] = snap ? JSON.parse(snap.snapshot) : [];
		const key = (l: HostLine) => `${l.name}|${l.detail}|${l.email ?? ''}`;
		const prevById = new Map(prev.map((l) => [l.id, l]));
		const curIds = new Set(current.map((l) => l.id));
		const added = new Set(current.filter((l) => !prevById.has(l.id)).map((l) => l.id));
		const changed = new Set(current.filter((l) => prevById.has(l.id) && key(prevById.get(l.id)!) !== key(l)).map((l) => l.id));
		const removed = prev.filter((l) => !curIds.has(l.id));
		if (!added.size && !changed.size && !removed.length) continue;
		await sendEmail(env, hostListEmail(brand, ev, s, current, added, removed, changed));
		const stored = current.map(({ id, name, detail, email }) => ({ id, name, detail, ...(email ? { email } : {}) }));
		await env.DB.prepare('INSERT INTO host_snapshots (session_id, snapshot, sent_at) VALUES (?,?,?) ON CONFLICT(session_id) DO UPDATE SET snapshot = excluded.snapshot, sent_at = excluded.sent_at')
			.bind(s.id, JSON.stringify(stored), nowIso()).run();
		sent++;
	}
	return sent;
}

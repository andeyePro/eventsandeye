// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../../LICENSE.
import { handle } from '../../http';
import { capacity, getEvent, getSessions, registrationOpen } from '../../rsvp';

/** Public availability for the booking form. Shows whether places are free, never names or exact holders. */
export const onRequestGet = handle(async ({ env, request }) => {
	const id = new URL(request.url).searchParams.get('event') || '';
	const ev = await getEvent(env, id);
	const sessions = await getSessions(env, ev.id);
	const cap = await capacity(env, ev, sessions);
	return {
		ok: true,
		event: { id: ev.id, title: ev.title, starts_at: ev.starts_at, deadline: ev.deadline, open: registrationOpen(ev), extra_question: ev.extra_question ?? null },
		in_person_available: cap.inPerson.available,
		tours: cap.tours.map((t) => ({ id: t.id, label: t.label, available: t.available, open: t.open })),
	};
});

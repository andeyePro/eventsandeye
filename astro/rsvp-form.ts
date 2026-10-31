// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
// The RsvpForm script, shared by astro/RsvpForm.astro and the plain HTML version in html/. It finds its elements by id.
import { BAR, rankList, restoreFocus } from './ranking';
const form = document.getElementById('rsvp-form') as HTMLFormElement;
const event = form.dataset.event!;
const result = document.getElementById('rsvp-result')!;
const avail = document.getElementById('rsvp-availability')!;
const toursBox = document.getElementById('rsvp-tours')!;
const tourFs = document.getElementById('rsvp-tour-fieldset') as HTMLFieldSetElement;
const optFs = document.getElementById('rsvp-optins-fieldset') as HTMLFieldSetElement;
const btn = form.querySelector('button[type=submit]') as HTMLButtonElement;
btn.disabled = false;
avail.textContent = 'Checking availability…';
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

interface Status {
	ok: boolean;
	error?: string;
	event: { open: boolean; deadline: string; timezone?: string; extra_question?: string | null; in_person_label?: string | null; remote_label?: string | null; tour_legend?: string | null };
	tours: { id: string; label: string; available: boolean; open: boolean }[];
	optins?: { id: string; label: string; starts_at: string; location: string | null; available?: boolean }[];
	polls?: { id: string; question: string; options: { id: string; label: string }[] }[];
}
/** The event's own wording, unless the page set the component's prop (data-fixed). */
function useLabels(e: { in_person_label?: string | null; remote_label?: string | null; tour_legend?: string | null }) {
	for (const [id, text] of [['rsvp-in-person-label', e.in_person_label], ['rsvp-remote-label', e.remote_label], ['rsvp-tour-legend', e.tour_legend]] as const) {
		const el = document.getElementById(id);
		if (el && !el.dataset.fixed && text) el.textContent = text;
	}
}
// Polls are optional here: only a list someone has rearranged is sent, so nobody is counted in by default.
const pollsBox = document.getElementById('rsvp-polls')!;
const pollOrders = new Map<string, { ids: string[]; touched: boolean }>();
function renderPolls(polls: NonNullable<Status['polls']>) {
	pollsBox.hidden = !polls.length;
	pollsBox.replaceChildren(...polls.map((p) => {
		const state = { ids: [...p.options.map((o) => o.id), BAR], touched: false };
		pollOrders.set(p.id, state);
		const fs = document.createElement('fieldset');
		fs.className = 'field poll';
		const legend = document.createElement('legend');
		legend.textContent = `${p.question} (optional)`;
		const help = document.createElement('p');
		help.className = 'help';
		help.textContent = 'Put the options in order, most wanted first, then move the line: you would join anything above it, and would rather stay at home for anything below it. Use the arrows, or drag. Or leave it, and answer later from the link in your joining instructions.';
		const status = document.createElement('p');
		status.className = 'help';
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');
		const label = (id: string) => ({ label: p.options.find((o) => o.id === id)?.label ?? '', tags: [] });
		// Only the list is rebuilt after a move: the status region stays put, so screen readers announce the change.
		const list = (): HTMLOListElement => rankList(state.ids, label, true, `Your order for: ${p.question}`, (focus) => {
			state.touched = true;
			const next = list();
			fs.querySelector('.rank')!.replaceWith(next);
			restoreFocus(next, focus, status);
		});
		fs.dataset.poll = p.id;
		fs.append(legend, help, list(), status);
		return fs;
	}));
}

function syncTour() {
	const mode = (form.elements.namedItem('attendance') as RadioNodeList).value;
	const inPerson = mode === 'in_person', extras = mode === 'extras';
	tourFs.disabled = !inPerson;
	optFs.disabled = !inPerson && !extras;
	document.getElementById('rsvp-optins-legend')!.textContent = extras ? 'Joining us for' : 'Also joining us for (in person only)';
	const boxes = [...optFs.querySelectorAll('input')] as HTMLInputElement[];
	if (!inPerson && !extras) boxes.forEach((el) => (el.checked = false));
	// Just the dinner (say): with only one optional session there's nothing to choose, so tick it.
	if (extras && boxes.length === 1) boxes[0].checked = true;
	if (!inPerson) (form.querySelector('input[name=tour_id][value=none]') as HTMLInputElement).checked = true;
}
form.addEventListener('change', syncTour);
function closed() {
	avail.textContent = 'Registration for this event has closed.';
	form.querySelectorAll('input,textarea,button').forEach((el) => ((el as HTMLInputElement).disabled = true));
}
syncTour();

fetch(`/api/rsvp/status?event=${encodeURIComponent(event)}`)
	.then((r) => r.json() as Promise<Status>)
	.then((s) => {
		if (!s.ok) throw new Error(s.error);
		useLabels(s.event);
		if (!s.event.open) return closed();
		if (s.event.extra_question) {
			(document.getElementById('rsvp-extra-label') as HTMLElement).textContent = `${s.event.extra_question} (optional)`;
			(document.getElementById('rsvp-extra-field') as HTMLElement).hidden = false;
		}
		const tz = s.event.timezone || 'Europe/London';
		const deadline = new Date(s.event.deadline).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: tz });
		// Only the deadline: saying places are full would put people off registering, and the waiting list is how
		// demand beyond the room shows up.
		avail.textContent = `Registration closes ${deadline} (${tz === 'Europe/London' ? 'UK' : tz.split('/').pop()!.replace(/_/g, ' ')} time).`;
		tourFs.hidden = !s.tours.length;
		for (const t of s.tours) {
			const label = document.createElement('label');
			label.className = 'choice';
			const input = document.createElement('input');
			input.type = 'radio';
			input.name = 'tour_id';
			input.value = t.id;
			input.disabled = !t.open;
			label.replaceChildren(input, ` ${t.label}${!t.open ? ' (booking closed)' : t.available ? '' : ' (full: waiting list)'}`);
			toursBox.appendChild(label);
		}
		for (const o of s.optins ?? []) {
			const label = document.createElement('label');
			label.className = 'choice';
			const input = document.createElement('input');
			input.type = 'checkbox';
			input.name = 'optins';
			input.value = o.id;
			const time = new Date(o.starts_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: s.event.timezone || 'Europe/London' });
			label.replaceChildren(input, ` ${o.label}, ${time}${o.location ? `, ${o.location}` : ''}${o.available === false ? ' (full: waiting list)' : ''}`);
			(document.getElementById('rsvp-optins') as HTMLElement).appendChild(label);
		}
		renderPolls(s.polls ?? []);
		optFs.hidden = !(s.optins ?? []).length;
		if ((s.optins ?? []).length) {
			document.getElementById('rsvp-extras-label')!.textContent = `Just the ${(s.optins ?? []).map((o) => lowerFirst(o.label)).join(' and ')}`;
			document.getElementById('rsvp-extras-choice')!.hidden = false;
		}
		syncTour();
	})
	.catch(() => {
		avail.textContent = `Could not check availability. You can still try to register, or contact us using the link below.`;
	});

form.addEventListener('submit', async (e) => {
	e.preventDefault();
	result.textContent = '';
	result.classList.remove('error');
	for (const el of form.querySelectorAll('[aria-invalid]')) { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); }
	// A name of spaces only passes "required" but not the server.
	const name = form.elements.namedItem('name') as HTMLInputElement;
	name.value = name.value.trim();
	if (!form.reportValidity()) return;
	const fd = new FormData(form);
	const body: Record<string, unknown> = Object.fromEntries(fd.entries());
	body.event = event;
	body.consent = (document.getElementById('rsvp-consent') as HTMLInputElement).checked;
	body.share_contact = (document.getElementById('rsvp-share') as HTMLInputElement).checked;
	body.optins = fd.getAll('optins').map(String);
	body.polls = [...pollOrders].filter(([, s]) => s.touched).map(([poll, s]) => ({ poll, ranking: s.ids.filter((x) => x !== BAR), bar: s.ids.indexOf(BAR) }));
	btn.disabled = true;
	try {
		const res = await fetch('/api/rsvp/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		const data = (await res.json()) as { ok: boolean; error?: string; field?: string };
		// The deadline passed while the form was open: say so where the deadline was shown, as on loading.
		if (res.status === 409 && /closed/i.test(data.error ?? '')) closed();
		if (!data.ok) throw Object.assign(new Error(data.error || 'Registration failed.'), { field: data.field });
		// A page of its own, so the "check your email" step can't be missed below the form.
		try { sessionStorage.setItem('rsvp-email', String(fd.get('email'))); } catch {}
		location.href = form.dataset.next || '/events/check-email/';
	} catch (err) {
		result.textContent = (err as Error).message;
		result.classList.add('error');
		(window as unknown as { turnstile?: { reset: () => void } }).turnstile?.reset();
		// Only on failure: after success the Turnstile token is spent, so a second click must not resend it.
		if (!avail.textContent?.includes('has closed')) btn.disabled = false;
		// Disabling the button threw focus away. Bring it to the field the server refused, described by the message, or
		// else to the message itself, so it is read out and not missed.
		const field = (err as { field?: string }).field;
		const bad = field ? [...form.querySelectorAll<HTMLInputElement>(`[name="${CSS.escape(field)}"]`)] : [];
		for (const el of bad) { el.setAttribute('aria-invalid', 'true'); el.setAttribute('aria-describedby', 'rsvp-result'); }
		(bad[0] ?? result).focus();
	}
});
export {};

// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
// The ManagePanel script, shared by astro/ManagePanel.astro and the plain HTML version in html/. It finds its elements by id.
import { BAR, rankList, restoreFocus } from './ranking';
const t = new URLSearchParams(location.search).get('t');
// Keep the link out of the address bar and history once read: it is the key to this registration.
if (t) history.replaceState(null, '', location.pathname);
const form = document.getElementById('manage-form') as HTMLFormElement;
const loading = document.getElementById('manage-loading')!;
const out = document.getElementById('manage-result')!;
const tourFs = document.getElementById('m-tour-fs') as HTMLFieldSetElement;
const buttons = [document.getElementById('m-save'), document.getElementById('m-cancel')] as HTMLButtonElement[];
const busy = (on: boolean) => buttons.forEach((b) => (b.disabled = on));
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

type View = { ok: boolean; error?: string; event: { title: string; page_path: string; open: boolean; timezone?: string; extra_question?: string | null; in_person_label?: string | null; remote_label?: string | null; tour_legend?: string | null }; tours: { id: string; label: string; available: boolean; open: boolean }[]; optins?: { id: string; label: string; starts_at: string; location: string | null; available?: boolean }[]; registration: Record<string, string | null | boolean | string[]>; calendar: { key: string; summary: string; start: string; url: string }[]; polls?: Poll[] };
type Poll = { id: string; question: string; open: boolean; allow_suggestions: boolean; closes_at: string; options: { id: string; label: string; pending: boolean; mine: boolean }[]; ballot: { ranking: string[]; bar: number } | null; notes: string[]; results: { label: string; willing: number; out: number }[] | null };

function describe(r: View['registration']) {
	const parts: string[] = [];
	parts.push('Confirmed.');
	if (r.mode === 'extras') parts.push(`Joining us for ${Array.isArray(r.optin_labels) ? r.optin_labels.map(lowerFirst).join(' and ') : 'the optional sessions'} only.`);
	else if (r.attendance === 'remote') parts.push('Attending remotely.');
	else parts.push(r.place === 'waitlist' ? 'On the in-person waiting list.' : 'In-person place.');
	if (r.tour_label) parts.push(r.tour_place === 'waitlist' ? `Waiting list for the ${r.tour_label}.` : `Booked on the ${r.tour_label}.`);
	const waitingFor = Array.isArray(r.optin_waiting_labels) ? r.optin_waiting_labels : [];
	const placed = Array.isArray(r.optin_labels) ? r.optin_labels.filter((l) => !waitingFor.includes(l)) : [];
	if (r.mode !== 'extras' && placed.length) parts.push(`Signed up for: ${placed.join(', ')}.`);
	if (waitingFor.length) parts.push(`Waiting list for: ${waitingFor.join(', ')}.`);
	return parts.join(' ');
}
function syncTour() {
	const mode = (form.elements.namedItem('attendance') as RadioNodeList).value;
	const inPerson = mode === 'in_person', extras = mode === 'extras';
	tourFs.disabled = !inPerson;
	if (!inPerson) (form.querySelector('input[name=tour_id][value=none]') as HTMLInputElement).checked = true;
	const optFs = document.getElementById('m-optins-fieldset') as HTMLFieldSetElement;
	optFs.disabled = !inPerson && !extras;
	document.getElementById('m-optins-legend')!.textContent = extras ? 'Joining us for' : 'Also joining us for (in person only)';
	const boxes = [...optFs.querySelectorAll('input')] as HTMLInputElement[];
	if (!inPerson && !extras) boxes.forEach((el) => (el.checked = false));
	if (extras && boxes.length === 1) boxes[0].checked = true;
}
function fill(v: View) {
	const r = v.registration;
	// The event's own wording, unless the page set the component's prop (data-fixed).
	for (const [id, text] of [['m-in-person-label', v.event.in_person_label], ['m-remote-label', v.event.remote_label], ['m-tour-legend', v.event.tour_legend]] as const) {
		const el = document.getElementById(id);
		if (el && !el.dataset.fixed && text) el.textContent = text;
	}
	document.getElementById('manage-summary')!.textContent = `${v.event.title}: ${describe(r)}`;
	(form.elements.namedItem('name') as HTMLInputElement).value = String(r.name ?? '');
	document.getElementById('m-email')!.textContent = String(r.email ?? '');
	(form.elements.namedItem('affiliation') as HTMLInputElement).value = String(r.affiliation ?? '');
	(form.elements.namedItem('needs') as HTMLTextAreaElement).value = String(r.needs ?? '');
	(form.elements.namedItem('extra_answer') as HTMLTextAreaElement).value = String(r.extra_answer ?? '');
	document.getElementById('m-extra-field')!.hidden = !v.event.extra_question;
	if (v.event.extra_question) document.getElementById('m-extra-label')!.textContent = `${v.event.extra_question} (optional)`;
	tourFs.hidden = !v.tours.length;
	const box = document.getElementById('m-tours')!;
	box.replaceChildren(...v.tours.map((tour) => {
		const l = document.createElement('label');
		l.className = 'choice';
		const i = document.createElement('input');
		i.type = 'radio'; i.name = 'tour_id'; i.value = tour.id;
		i.disabled = !tour.open;
		l.replaceChildren(i, ` ${tour.label}${!tour.open ? ' (booking closed)' : tour.available || tour.id === r.tour_id ? '' : ' (full: waiting list)'}`);
		return l;
	}));
	const current = r.mode === 'extras' ? 'extras' : String(r.attendance);
	(form.querySelector(`input[name=attendance][value=${current}]`) as HTMLInputElement).checked = true;
	// Once registration closes, nobody new may take an in-person or optional-session place, but anyone can step back.
	for (const mode of ['in_person', 'extras']) (form.querySelector(`input[name=attendance][value=${mode}]`) as HTMLInputElement).disabled = !v.event.open && mode !== current;
	document.getElementById('m-closed')!.hidden = v.event.open;
	(form.querySelector(`input[name=tour_id][value="${r.tour_id ?? 'none'}"]`) as HTMLInputElement).checked = true;
	(document.getElementById('m-share') as HTMLInputElement).checked = !!r.share_contact;
	const mine = Array.isArray(r.optins) ? r.optins : [];
	document.getElementById('m-optins')!.replaceChildren(...(v.optins ?? []).map((o) => {
		const l = document.createElement('label');
		l.className = 'choice';
		const i = document.createElement('input');
		i.type = 'checkbox'; i.name = 'optins'; i.value = o.id; i.checked = mine.includes(o.id);
		const time = new Date(o.starts_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: v.event.timezone || 'Europe/London' });
		l.replaceChildren(i, ` ${o.label}, ${time}${o.location ? `, ${o.location}` : ''}${o.available === false && !mine.includes(o.id) ? ' (full: waiting list)' : ''}`);
		return l;
	}));
	(document.getElementById('m-optins-fieldset') as HTMLFieldSetElement).hidden = !(v.optins ?? []).length;
	if ((v.optins ?? []).length) {
		document.getElementById('m-extras-label')!.textContent = `Just the ${(v.optins ?? []).map((o) => lowerFirst(o.label)).join(' and ')}`;
		document.getElementById('m-extras-choice')!.hidden = false;
	}
	const cal = document.getElementById('m-calendar')!;
	cal.replaceChildren();
	if (v.calendar?.length) {
		const p = document.createElement('p');
		p.className = 'help';
		p.textContent = 'Calendar files for your registration:';
		const ul = document.createElement('ul');
		for (const c of v.calendar) {
			const li = document.createElement('li');
			const a = document.createElement('a');
			a.href = c.url;
			a.textContent = `${c.summary} (.ics)`;
			li.appendChild(a);
			ul.appendChild(li);
		}
		cal.replaceChildren(p, ul);
	}
	syncTour();
	renderPolls(v.polls ?? []);
}

// ---- polls: rank the options, most wanted first, with a line below the ones you would join ----
const pollsBox = document.getElementById('m-polls')!;
/** Unsaved orders by poll id, so a save or suggestion elsewhere on the page does not undo someone's arranging. */
const order = new Map<string, string[]>();
let polls: Poll[] = [];
function startOrder(p: Poll): string[] {
	const ids = p.options.map((o) => o.id);
	if (!p.ballot) return [...ids, BAR];
	// Options added since this person last saved go below their line, marked new, until they move them.
	const fresh = ids.filter((id) => !p.ballot!.ranking.includes(id));
	return [...p.ballot.ranking.slice(0, p.ballot.bar), BAR, ...p.ballot.ranking.slice(p.ballot.bar), ...fresh];
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
	const e = Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
	e.append(...kids);
	return e;
}
function renderPolls(list: Poll[]) {
	polls = list;
	pollsBox.hidden = !list.length;
	pollsBox.replaceChildren(...list.map((p) => renderPoll(p)));
}
function renderPoll(p: Poll) {
	const ids = order.get(p.id) ?? startOrder(p);
	order.set(p.id, ids);
	const status = el('p', { className: 'help poll-status', role: 'status' });
	status.setAttribute('aria-live', 'polite');
	const fresh = p.ballot ? p.options.filter((o) => !p.ballot!.ranking.includes(o.id)).map((o) => o.id) : [];
	const info = (id: string) => {
		const o = p.options.find((x) => x.id === id);
		return { label: o?.label ?? '', tags: [o?.pending ? 'your suggestion, waiting for the organisers' : o?.mine ? 'your suggestion' : '', fresh.includes(id) ? 'new' : ''].filter(Boolean) };
	};
	// Only the list is rebuilt after a move: the status region stays put, so screen readers announce the change.
	const list = (): HTMLOListElement => rankList(ids, info, p.open, `Your order for: ${p.question}`, (focus) => {
		const next = list();
		section.querySelector('.rank')!.replaceWith(next);
		restoreFocus(next, focus, status);
	});
	const ol = list();
	const section = el('section', { className: 'poll' });
	section.dataset.poll = p.id;
	const h = el('h2', { id: `poll-${p.id}`, textContent: p.question });
	section.setAttribute('aria-labelledby', h.id);
	const intro = p.open
		? 'Put the options in order, most wanted first, then move the line: you would join anything above it, and would rather stay at home for anything below it. Use the arrows, or drag.'
		: 'This poll has closed.';
	section.append(h, el('p', { className: 'help', textContent: intro }), ol);
	if (p.open) {
		const save = el('button', { type: 'button', className: 'primary', textContent: 'Save my order' });
		save.addEventListener('click', () => submitPoll(p, ids, status, save));
		const actions = el('div', { className: 'actions' }, save);
		section.append(actions);
		if (p.allow_suggestions) {
			const input = el('input', { type: 'text', maxLength: 80, id: `poll-suggest-${p.id}` });
			const add = el('button', { type: 'button', className: 'secondary', textContent: 'Add my suggestion' });
			add.addEventListener('click', () => suggest(p, ids, input, status, add));
			section.append(el('div', { className: 'field' },
				el('label', { htmlFor: input.id, textContent: 'Something else? Add it and put it in your order (the organisers decide whether to add it for everyone)' }),
				el('div', { className: 'suggest' }, input, add)));
		}
	}
	section.append(status);
	if (p.notes.length) section.append(el('ul', { className: 'help' }, ...p.notes.map((n) => el('li', { textContent: n }))));
	if (p.results?.length) {
		const rows = p.results.map((r) => el('tr', {}, el('th', { scope: 'row', textContent: r.label }), el('td', { textContent: String(r.willing) }), el('td', { textContent: String(r.out) })));
		const head = el('tr', {}, el('th', { scope: 'col', textContent: 'Option' }), el('th', { scope: 'col', textContent: 'Would join' }), el('th', { scope: 'col', textContent: 'Would stay at home' }));
		section.append(el('details', {}, el('summary', { textContent: 'How everyone has answered so far' }), el('table', {}, el('thead', {}, head), el('tbody', {}, ...rows))));
	}
	return section;
}
async function pollCall(body: object) {
	const res = await fetch('/api/rsvp/poll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t, ...body }) });
	const d = (await res.json()) as { ok: boolean; error?: string; polls: Poll[]; option?: { id: string; label: string }; existing?: boolean };
	if (!d.ok) throw new Error(d.error);
	return d;
}
async function submitPoll(p: Poll, ids: string[], status: HTMLElement, button: HTMLButtonElement, said = 'Your order has been saved.') {
	button.disabled = true;
	try {
		const d = await pollCall({ poll: p.id, ranking: ids.filter((x) => x !== BAR), bar: ids.indexOf(BAR) });
		order.delete(p.id);
		renderPolls(d.polls);
		const s = pollsBox.querySelector(`[data-poll="${p.id}"] .poll-status`);
		if (s) s.textContent = said;
	} catch (err) { status.textContent = (err as Error).message; button.disabled = false; }
}
async function suggest(p: Poll, ids: string[], input: HTMLInputElement, status: HTMLElement, button: HTMLButtonElement) {
	const label = input.value.trim();
	if (!label) { status.textContent = 'Please write your suggestion first.'; input.focus(); return; }
	button.disabled = true;
	try {
		const d = await pollCall({ poll: p.id, suggest: label });
		const o = d.option!;
		// Into this person's order at the top, above their line, and saved with the rest of their order as it stands.
		if (ids.includes(o.id)) ids.splice(ids.indexOf(o.id), 1);
		ids.unshift(o.id);
		polls = d.polls;
		const fresh = d.polls.find((x) => x.id === p.id)!;
		await submitPoll(fresh, ids.filter((id) => id === BAR || fresh.options.some((x) => x.id === id)), status, button,
			d.existing ? `"${o.label}" is already an option: it is now at the top of your order, which has been saved.` : `Added "${o.label}" at the top of your order, which has been saved. The organisers have been asked whether to add it for everyone.`);
	} catch (err) { status.textContent = (err as Error).message; button.disabled = false; }
}
async function call(method: string, body?: object) {
	const res = await fetch(method === 'GET' ? `/api/rsvp/manage?t=${encodeURIComponent(t ?? '')}` : '/api/rsvp/manage', {
		method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify({ t, ...body }) : undefined,
	});
	const d = (await res.json()) as View;
	if (!d.ok) throw new Error(d.error);
	return d;
}
form.addEventListener('change', syncTour);
call('GET').then((v) => { loading.hidden = true; form.hidden = false; fill(v); }).catch((e) => { loading.textContent = e.message || 'This link is not valid.'; });

form.addEventListener('submit', async (e) => {
	e.preventDefault();
	if (!form.reportValidity()) return;
	const fd: Record<string, unknown> = Object.fromEntries(new FormData(form).entries());
	fd.share_contact = (document.getElementById('m-share') as HTMLInputElement).checked;
	fd.optins = new FormData(form).getAll('optins').map(String);
	busy(true);
	try { fill(await call('POST', fd)); out.textContent = 'Your changes have been saved.'; } catch (err) { out.textContent = (err as Error).message; } finally { busy(false); }
});
document.getElementById('m-cancel')!.addEventListener('click', async () => {
	if (!confirm('Cancel your registration? Your details will be deleted.')) return;
	busy(true);
	try {
		await call('DELETE', {});
		const p = document.createElement('p');
		p.tabIndex = -1;
		p.textContent = 'Your registration has been cancelled and your details deleted. We have emailed you a confirmation.';
		form.replaceChildren(p);
		pollsBox.hidden = true;
		// The button that had focus is gone; move focus to the outcome so it isn't lost to the page body.
		p.focus();
	} catch (err) { out.textContent = (err as Error).message; busy(false); }
});
export {};

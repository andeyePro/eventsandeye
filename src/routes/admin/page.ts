// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../../LICENSE.
import { VERSION } from '../../env';

/**
 * The admin page. Served by a Pages Function so it only ever leaves the server after the Access JWT check in
 * pageMiddleware. Plain HTML and JavaScript, no build step.
 */
export const onRequestGet = async () => new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

const HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Registrations admin – Events&amp;I</title>
<style>
	:root { --blue: #0069a0; --line: #ccd; font-family: Arial, Helvetica, sans-serif; color: #111; background: #f6f8f4; }
	body { margin: 0; }
	header { background: #fff; border-bottom: 1px solid var(--line); padding: 0.8rem 1.5rem; display: flex; gap: 1rem; align-items: baseline; flex-wrap: wrap; }
	header h1 { font-size: 1.3rem; margin: 0; }
	main { padding: 1rem 1.5rem 4rem; display: grid; gap: 1.5rem; max-width: 1250px; }
	section { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 1rem 1.25rem; }
	h2 { font-size: 1.15rem; margin: 0 0 0.75rem; color: var(--blue); }
	.stats { display: flex; gap: 1rem; flex-wrap: wrap; }
	.stat { border: 1px solid var(--line); border-radius: 6px; padding: 0.5rem 0.8rem; min-width: 9rem; }
	.stat b { font-size: 1.4rem; display: block; }
	table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
	th, td { border-bottom: 1px solid var(--line); padding: 0.4rem; text-align: left; vertical-align: top; }
	th { background: #eef2ea; }
	label { font-weight: 600; display: block; margin-top: 0.6rem; }
	input[type=text], input[type=email], input[type=url], input[type=number], input[type=datetime-local], textarea, select { font: inherit; padding: 0.4rem; border: 1px solid #889; border-radius: 4px; width: 100%; box-sizing: border-box; }
	textarea { min-height: 12rem; font-family: ui-monospace, Menlo, monospace; font-size: 0.85rem; }
	.row { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 0.75rem; }
	button, .button { font: inherit; background: var(--blue); color: #fff; border: 0; border-radius: 4px; padding: 0.45rem 0.9rem; cursor: pointer; text-decoration: none; display: inline-block; margin-top: 0.6rem; }
	button.secondary, .button.secondary { background: #fff; color: var(--blue); border: 1px solid var(--blue); }
	button.danger { background: #b3261e; }
	.small { font-size: 0.85rem; color: #444; }
	.tag { display: inline-block; font-size: 0.75rem; padding: 0.05rem 0.4rem; border-radius: 3px; background: #eee; }
	.tag.wait { background: #ffe8b3; } .tag.pending { background: #e3e3ff; } .tag.ok { background: #d9f2c4; }
	.preview { border: 1px dashed #889; padding: 0.75rem; margin-top: 0.6rem; background: #fcfcfc; }
	fieldset { border: 1px solid var(--line); border-radius: 6px; margin: 0.75rem 0; }
	legend { font-weight: 700; }
	#toast { position: fixed; bottom: 1rem; right: 1rem; background: #111; color: #fff; padding: 0.6rem 1rem; border-radius: 6px; max-width: 30rem; }
	#toast:empty { display: none; }
</style>
</head>
<body>
<header>
	<h1>Registrations admin</h1>
	<span id="ev-title" class="small"></span>
	<a href="/" class="small">Website</a>
	<span class="small">Events&amp;I ${VERSION} (beta)</span>
</header>
<main>
	<section aria-labelledby="h-summary"><h2 id="h-summary">Summary</h2><div class="stats" id="stats"></div></section>

	<section aria-labelledby="h-settings">
		<h2 id="h-settings">Settings</h2>
		<form id="settings-form">
			<div class="row">
				<div><label for="s-max">In-person maximum</label><input id="s-max" type="number" min="0" required /></div>
				<div><label for="s-deadline">Registration deadline (UK time)</label><input id="s-deadline" type="datetime-local" required /></div>
				<div><label for="s-travel">Assumed travel time for the "time to leave" reminder (minutes)</label><input id="s-travel" type="number" min="0" required /></div>
			</div>
			<button type="submit">Save settings</button>
			<p class="small">Raising a maximum does not move anyone off a waiting list: use "Promote" below, which sends that person the latest joining instructions.</p>
		</form>
	</section>

	<section aria-labelledby="h-sessions">
		<h2 id="h-sessions">Sessions</h2>
		<p class="small">Times, places and online links here are what everyone's calendar entries are built from. Saving changes sends updated calendar invitations, but only to people whose own entries actually change. Hosts get the attendee list by email whenever it changes.</p>
		<form id="sessions-form"><div id="sessions-box"></div>
			<button type="button" class="secondary" id="sess-dry">How many people would get a calendar update?</button>
			<button type="submit">Save sessions</button>
		</form>
	</section>

	<section aria-labelledby="h-regs">
		<h2 id="h-regs">Registrations</h2>
		<p><a class="button secondary" id="csv-link" href="#">Download CSV</a> <a class="button secondary" id="log-link" href="#">Download sent log (markdown)</a></p>
		<div style="overflow-x:auto"><table id="regs"><caption class="small" style="text-align:left">Waiting lists are in order of confirmation. Unconfirmed = email not yet confirmed.</caption><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Attendance</th><th scope="col">Tour</th><th scope="col">Affiliation</th><th scope="col">Needs</th><th scope="col">Extra</th><th scope="col">Shares email with hosts</th><th scope="col">Instr. v</th><th scope="col">Actions</th></tr></thead><tbody></tbody></table></div>
	</section>

	<section aria-labelledby="h-instr">
		<h2 id="h-instr">Joining instructions</h2>
		<p class="small">The latest version is emailed automatically, with calendar invitations, to each person when they confirm (or are promoted from the in-person waiting list), and to anyone who registers again. Saving a new version does <strong>not</strong> email anyone already registered: to update them, compose a message below to "people on an older version" and tick "counts as this version".</p>
		<div id="instr-versions"></div>
		<form id="instr-form">
			<label for="i-subject">Subject</label><input id="i-subject" type="text" required maxlength="200" />
			<label for="i-body">Body (markdown: **bold**, *italic*, - lists, [links](https://…))</label><textarea id="i-body" required></textarea>
			<label for="i-note">What changed since the previous version</label><input id="i-note" type="text" maxlength="1000" />
			<button type="button" class="secondary" data-preview="i-body">Preview</button>
			<button type="submit">Save as new version</button>
			<div class="preview" id="i-body-preview" hidden></div>
		</form>
	</section>

	<section aria-labelledby="h-compose">
		<h2 id="h-compose">Email registrants</h2>
		<form id="msg-form">
			<label for="m-subject">Subject</label><input id="m-subject" type="text" required maxlength="200" />
			<label for="m-body">Message (markdown). Each person gets their own copy starting "Hello &lt;name&gt;," with their manage link at the end.</label><textarea id="m-body" required></textarea>
			<div class="row">
				<div><label for="m-att">Attendance</label><select id="m-att"><option value="all">Everyone</option><option value="in_person">In person</option><option value="remote">Remote</option></select></div>
				<div><label for="m-tour">Tour</label><select id="m-tour"><option value="">Any</option><option value="none">No tour</option></select></div>
				<div><label for="m-below">Only people whose joining instructions are older than version</label><input id="m-below" type="number" min="1" placeholder="(everyone)" /></div>
				<div><label for="m-marks">Counts as joining instructions version</label><input id="m-marks" type="number" min="1" placeholder="(no)" /></div>
			</div>
			<label><input type="checkbox" id="m-wait" style="width:auto" /> Include people on the in-person waiting list</label>
			<label for="m-when">Send at (UK time; leave empty to send now)</label><input id="m-when" type="datetime-local" />
			<button type="button" class="secondary" data-preview="m-body">Preview</button>
			<button type="button" class="secondary" id="m-count">Count recipients</button>
			<button type="button" class="secondary" id="m-bcc">Copy BCC list for Gmail</button>
			<button type="submit">Send or schedule</button>
			<div class="preview" id="m-body-preview" hidden></div>
		</form>
		<h3>Sent and scheduled</h3>
		<div style="overflow-x:auto"><table id="msgs"><thead><tr><th scope="col">When</th><th scope="col">Subject</th><th scope="col">Status</th><th scope="col">Recipients</th><th scope="col">Audience</th><th scope="col">Actions</th></tr></thead><tbody></tbody></table></div>
	</section>
</main>
<div id="toast" role="status" aria-live="polite"></div>
<script>
${SCRIPT()}
</script>
</body>
</html>`;

function SCRIPT() {
	return String.raw`
const EVENT = new URLSearchParams(location.search).get('event') || '';
const $ = (id) => document.getElementById(id);
const toast = (msg) => { const t = $('toast'); t.textContent = msg; setTimeout(() => { if (t.textContent === msg) t.textContent = ''; }, 7000); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
async function api(path, method = 'GET', body) {
	const res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
	const d = await res.json().catch(() => ({ ok: false, error: 'HTTP ' + res.status }));
	if (!d.ok) throw new Error(d.error || 'HTTP ' + res.status);
	return d;
}
// datetime-local values are UK wall-clock time; convert via the Europe/London offset at that moment.
function ukLocalToIso(v) {
	if (!v) return null;
	const guess = new Date(v + 'Z');
	const uk = new Date(guess.toLocaleString('en-US', { timeZone: 'Europe/London' }));
	const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
	return new Date(guess.getTime() - (uk.getTime() - utc.getTime())).toISOString();
}
function isoToUkLocal(iso) {
	if (!iso) return '';
	const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
	const g = (t) => parts.find((p) => p.type === t).value;
	return g('year') + '-' + g('month') + '-' + g('day') + 'T' + g('hour') + ':' + g('minute');
}
const uk = (iso) => iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }) : '';
let sessions = [], tours = [], latestVersion = 0, eventId = EVENT;

function audience() {
	return { attendance: $('m-att').value, tour_id: $('m-tour').value || undefined, below_version: $('m-below').value ? Number($('m-below').value) : undefined, include_waitlist: $('m-wait').checked };
}
function sessionEdits() {
	return sessions.map((s) => {
		const v = (f) => $('sx-' + f + '-' + s.id);
		return {
			id: s.id, starts_at: ukLocalToIso(v('start').value), ends_at: ukLocalToIso(v('end').value), location: v('loc').value, online_url: v('url').value,
			host_name: v('hname').value, host_email: v('hemail').value, capacity: v('cap').value === '' ? null : Number(v('cap').value),
			booking_deadline: v('dl') ? ukLocalToIso(v('dl').value) : undefined,
		};
	});
}

async function load() {
	const s = await api('/api/admin/summary?event=' + encodeURIComponent(eventId));
	eventId = s.event.id;
	const c = s.capacity;
	sessions = s.sessions; tours = s.tours; latestVersion = s.latest_instructions_version;
	$('ev-title').textContent = s.event.title + ' – ' + uk(s.event.starts_at);
	const stat = (label, value) => '<div class="stat"><b>' + esc(value) + '</b>' + esc(label) + '</div>';
	$('stats').innerHTML = [
		stat('in person confirmed', c.inPerson.confirmed + ' / ' + c.inPerson.max),
		stat('in-person places held (incl. unconfirmed)', c.inPerson.held),
		stat('in-person waiting list', c.inPerson.waiting),
		stat('remote confirmed', c.remote),
		stat('unconfirmed', c.pending),
		...c.tours.map((t) => stat(t.label + ' (waiting ' + t.waiting + ')' + (t.open ? '' : ' – booking closed'), t.confirmed + ' / ' + (t.capacity ?? '∞'))),
		stat('registration closes', uk(s.event.deadline)),
	].join('');
	$('s-max').value = s.event.in_person_max; $('s-deadline').value = isoToUkLocal(s.event.deadline); $('s-travel').value = s.event.travel_minutes;

	$('sessions-box').innerHTML = sessions.map((x) => {
		const id = esc(x.id);
		const f = (name, label, type, value, extra = '') => '<div><label for="sx-' + name + '-' + id + '">' + label + '</label><input id="sx-' + name + '-' + id + '" type="' + type + '" value="' + esc(value) + '" ' + extra + ' /></div>';
		return '<fieldset><legend>' + esc(x.label) + ' <span class="small">(' + esc(x.kind) + ', ' + esc(x.mode) + (x.choice_group ? ', optional, booked separately' : '') + ')</span></legend><div class="row">'
			+ f('start', 'Starts (UK time)', 'datetime-local', isoToUkLocal(x.starts_at), 'required')
			+ f('end', 'Ends (UK time)', 'datetime-local', isoToUkLocal(x.ends_at), 'required')
			+ f('loc', 'Location (blank = event venue)', 'text', x.location ?? '')
			+ f('url', 'Online link (e.g. Google Meet)', 'url', x.online_url ?? '', 'placeholder="https://meet.google.com/…"')
			+ f('hname', 'Host name', 'text', x.host_name ?? '')
			+ f('hemail', 'Host email (gets the list)', 'email', x.host_email ?? '')
			+ f('cap', 'Capacity (blank = unlimited)', 'number', x.capacity ?? '', 'min="0"')
			+ (x.choice_group ? f('dl', 'Booking closes (blank = at start)', 'datetime-local', isoToUkLocal(x.booking_deadline)) : '')
			+ '</div></fieldset>';
	}).join('');

	const tourSel = $('m-tour');
	tourSel.querySelectorAll('option[data-t]').forEach((o) => o.remove());
	for (const t of tours) { const o = document.createElement('option'); o.value = t.id; o.textContent = t.label; o.dataset.t = '1'; tourSel.append(o); }

	$('regs').querySelector('tbody').innerHTML = s.registrations.map((r) => {
		const tour = tours.find((t) => t.id === r.tour_id);
		const pend = r.status === 'pending' ? '<span class="tag pending">unconfirmed</span> ' : '';
		const where = r.attendance === 'remote' ? 'Remote' : r.place === 'waitlist' ? '<span class="tag wait">in person: waiting since ' + esc(uk(r.waitlist_since)) + '</span>' : '<span class="tag ok">in person</span>';
		const tourCell = tour ? (r.tour_place === 'waitlist' ? '<span class="tag wait">' + esc(tour.label) + ': waiting</span>' : esc(tour.label)) : '';
		const actions = [
			r.status === 'confirmed' && r.place === 'waitlist' ? '<button data-promote="event" data-id="' + esc(r.id) + '">Promote to place</button>' : '',
			r.status === 'confirmed' && r.tour_place === 'waitlist' ? '<button data-promote="tour" data-id="' + esc(r.id) + '">Promote to tour</button>' : '',
			'<button class="danger" data-delete="' + esc(r.id) + '" data-name="' + esc(r.name) + '">Remove</button>',
		].join(' ');
		return '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.email) + '</td><td>' + pend + where + '</td><td>' + tourCell + '</td><td>' + esc(r.affiliation) + '</td><td>' + esc(r.needs) + '</td><td>' + esc(r.extra_answer) + '</td><td>' + (r.share_contact ? 'yes' : 'no') + '</td><td>' + esc(r.instructions_version) + '</td><td>' + actions + '</td></tr>';
	}).join('') || '<tr><td colspan="10">No registrations yet.</td></tr>';
	$('csv-link').href = '/api/admin/export?format=csv&event=' + encodeURIComponent(eventId);
	$('log-link').href = '/api/admin/sent-log?event=' + encodeURIComponent(eventId);

	const iv = await api('/api/admin/instructions?event=' + encodeURIComponent(eventId));
	const latest = iv.versions[0];
	$('instr-versions').innerHTML = iv.versions.map((v) => '<details><summary>Version ' + esc(v.version) + ' – ' + esc(uk(v.created_at)) + ' – ' + esc(v.subject) + (v.change_note ? ' – <em>' + esc(v.change_note) + '</em>' : '') + '</summary><pre style="white-space:pre-wrap">' + esc(v.body_md) + '</pre></details>').join('');
	if (latest && !$('i-subject').value) { $('i-subject').value = latest.subject; $('i-body').value = latest.body_md; }
	$('m-marks').placeholder = '(no) latest is ' + latestVersion;

	const ms = await api('/api/admin/messages?event=' + encodeURIComponent(eventId));
	$('msgs').querySelector('tbody').innerHTML = ms.messages.map((m) => '<tr><td>' + esc(uk(m.sent_at || m.scheduled_at || m.created_at)) + '</td><td>' + esc(m.subject) + '</td><td>' + esc(m.status) + (m.error ? ': ' + esc(m.error) : '') + '</td><td>' + esc(m.recipients_count ?? '') + '</td><td><code>' + esc(m.audience) + '</code></td><td>' + (m.status === 'scheduled' ? '<button class="danger" data-cancel="' + esc(m.id) + '">Cancel</button>' : '') + '</td></tr>').join('') || '<tr><td colspan="6">Nothing sent yet.</td></tr>';
}

$('settings-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	try {
		const d = await api('/api/admin/settings', 'POST', { event: eventId, in_person_max: Number($('s-max').value), deadline: ukLocalToIso($('s-deadline').value), travel_minutes: Number($('s-travel').value) });
		toast('Settings saved.' + (d.calendar_updates ? ' ' + d.calendar_updates + ' calendar update(s) sent.' : '')); load();
	} catch (err) { toast(err.message); }
});
$('sessions-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	try {
		const dry = await api('/api/admin/sessions', 'POST', { event: eventId, sessions: sessionEdits(), dry_run: true });
		if (!confirm('Save sessions? ' + dry.calendar_updates + ' person(s) will get updated calendar invitations.')) return;
		const d = await api('/api/admin/sessions', 'POST', { event: eventId, sessions: sessionEdits() });
		toast('Sessions saved. ' + d.calendar_updates + ' calendar update(s) sent.'); load();
	} catch (err) { toast(err.message); }
});
document.body.addEventListener('click', async (e) => {
	const b = e.target.closest('button');
	if (!b) return;
	try {
		if (b.id === 'sess-dry') {
			const d = await api('/api/admin/sessions', 'POST', { event: eventId, sessions: sessionEdits(), dry_run: true });
			toast(d.calendar_updates + ' person(s) would get updated calendar invitations.');
		} else if (b.dataset.promote) {
			if (!confirm('Promote this person? They will be emailed the latest joining instructions.')) return;
			await api('/api/admin/promote', 'POST', { id: b.dataset.id, what: b.dataset.promote }); toast('Promoted and emailed.'); load();
		} else if (b.dataset.delete) {
			if (!confirm('Remove ' + b.dataset.name + '? No email is sent to them. Use this for spam or duplicates.')) return;
			await api('/api/admin/registration', 'DELETE', { id: b.dataset.delete }); toast('Removed.'); load();
		} else if (b.dataset.cancel) {
			await api('/api/admin/messages/cancel', 'POST', { id: b.dataset.cancel }); toast('Scheduled message cancelled.'); load();
		} else if (b.dataset.preview) {
			const d = await api('/api/admin/preview', 'POST', { body_md: $(b.dataset.preview).value });
			const box = $(b.dataset.preview + '-preview'); box.innerHTML = d.html; box.hidden = false;
		} else if (b.id === 'm-count') {
			const d = await api('/api/admin/messages', 'POST', { event: eventId, dry_run: true, audience: audience() }); toast(d.count + ' recipient(s) match.');
		} else if (b.id === 'm-bcc') {
			const d = await api('/api/admin/export?format=bcc&event=' + encodeURIComponent(eventId) + '&audience=' + encodeURIComponent(JSON.stringify(audience())));
			await navigator.clipboard.writeText(d.bcc); toast('Copied ' + d.count + ' address(es). Paste into Gmail\'s BCC field, never To or CC.');
		}
	} catch (err) { toast(err.message); }
});
$('instr-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	try {
		const d = await api('/api/admin/instructions', 'POST', { event: eventId, subject: $('i-subject').value, body_md: $('i-body').value, change_note: $('i-note').value });
		toast('Saved as version ' + d.version + '. New confirmations will get it; existing registrants have not been emailed.'); $('i-note').value = ''; load();
	} catch (err) { toast(err.message); }
});
$('msg-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	const when = $('m-when').value ? ukLocalToIso($('m-when').value) : null;
	try {
		const count = (await api('/api/admin/messages', 'POST', { event: eventId, dry_run: true, audience: audience() })).count;
		if (!confirm((when ? 'Schedule for ' + uk(when) : 'Send now') + ' to ' + count + ' recipient(s)?')) return;
		await api('/api/admin/messages', 'POST', { event: eventId, subject: $('m-subject').value, body_md: $('m-body').value, audience: audience(), scheduled_at: when, marks_instructions_version: $('m-marks').value ? Number($('m-marks').value) : undefined });
		toast(when ? 'Scheduled.' : 'Sent.'); e.target.reset(); load();
	} catch (err) { toast(err.message); }
});
load().catch((err) => { document.querySelector('main').innerHTML = '<section><h2>Not available</h2><p>' + esc(err.message) + '</p><p class="small">This page needs Cloudflare Access sign-in, and an event id (?event=...).</p></section>'; });
`;
}

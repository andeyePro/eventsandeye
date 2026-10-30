// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../../LICENSE.
import { VERSION } from '../../env';

/**
 * The admin page. Served by a Pages Function so it only ever leaves the server after the Access JWT check in
 * pageMiddleware. Plain HTML and JavaScript, no build step.
 */
export const onRequestGet = async () => new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'content-security-policy': "frame-ancestors 'none'", 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' } });

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
	main { padding: 1rem 1.5rem 4rem; display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; max-width: 1250px; }
	/* Without this, display:inline-block on buttons beats the hidden attribute. */
	[hidden] { display: none !important; }
	summary { padding: 0.3rem 0; cursor: pointer; }
	@media (max-width: 40rem) { header, main { padding-left: 0.75rem; padding-right: 0.75rem; } section { padding: 0.75rem; } }
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
	#setup { border-color: #b3261e; }
	#setup li { margin: 0.3rem 0; }
	#setup .error::marker { content: '✗ '; color: #b3261e; } #setup .warning::marker { content: '! '; color: #8a5a00; } #setup .note::marker { content: 'i '; color: #444; }
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
	<section aria-labelledby="h-setup" id="setup" hidden><h2 id="h-setup">Set-up check</h2><p class="small">Things to put right in your Cloudflare settings. This list disappears when everything is in order.</p><ul id="setup-list"></ul></section>
	<section aria-labelledby="h-summary"><h2 id="h-summary">Summary</h2><div class="stats" id="stats"></div></section>

	<section aria-labelledby="h-events" id="events">
		<h2 id="h-events">Events</h2>
		<label for="ev-pick">Event shown on this page</label><select id="ev-pick"></select>
		<p class="small">Setting up and editing events emails nobody. Calendars already sent pick up a new title or venue with each person's next email.</p>
		<details><summary>Edit this event</summary>
			<form id="ev-form">
				<div class="row">
					<div><label for="e-title">Title</label><input id="e-title" type="text" required maxlength="200" /></div>
					<div><label for="e-loc">Venue address</label><input id="e-loc" type="text" maxlength="300" /></div>
					<div><label for="e-page">Event page (path on your site)</label><input id="e-page" type="text" required maxlength="200" placeholder="/events/2027-03-12-london/" /></div>
					<div><label for="e-tz">Time zone</label><input id="e-tz" type="text" required placeholder="Europe/London" /><p class="small">A new zone keeps the event and its sessions at the same moment; only how times are shown changes.</p></div>
					<div><label for="e-start">Starts (<span class="tzl">UK time</span>)</label><input id="e-start" type="datetime-local" required /></div>
					<div><label for="e-end">Ends (<span class="tzl">UK time</span>)</label><input id="e-end" type="datetime-local" required /></div>
					<div><label for="e-q">Extra question on the form (optional)</label><input id="e-q" type="text" maxlength="300" /></div>
					<div><label for="e-lip">Wording for attending in person (optional)</label><input id="e-lip" type="text" maxlength="120" placeholder="In person" /></div>
					<div><label for="e-lrem">Wording for attending remotely (optional)</label><input id="e-lrem" type="text" maxlength="120" placeholder="Remotely (online sessions only)" /></div>
					<div><label for="e-ltour">Heading for the tour choice (optional)</label><input id="e-ltour" type="text" maxlength="120" placeholder="Optional tour (in person only)" /></div>
				</div>
				<button type="submit">Save event</button>
			</form>
		</details>
		<details><summary>Clone this event</summary>
			<form id="clone-form">
				<p class="small">Copies the programme (times moved to the new start, without hosts or online links), the latest joining instructions and the polls' options. Never people or answers.</p>
				<div class="row">
					<div><label for="c-id">New event id</label><input id="c-id" type="text" required pattern="[a-z0-9][a-z0-9-]{2,59}" placeholder="2027-03-12-london" /></div>
					<div><label for="c-title">New title</label><input id="c-title" type="text" maxlength="200" /></div>
					<div><label for="c-start">New start (<span class="tzl">UK time</span>)</label><input id="c-start" type="datetime-local" required /></div>
					<div><label for="c-page">New event page</label><input id="c-page" type="text" required maxlength="200" placeholder="/events/2027-03-12-london/" /></div>
				</div>
				<button type="submit">Clone</button>
			</form>
		</details>
		<details id="new-details"><summary>New event</summary>
			<form id="new-form">
				<div class="row">
					<div><label for="n-id">Event id</label><input id="n-id" type="text" required pattern="[a-z0-9][a-z0-9-]{2,59}" placeholder="2027-03-12-london" /></div>
					<div><label for="n-title">Title</label><input id="n-title" type="text" required maxlength="200" /></div>
					<div><label for="n-tz">Time zone</label><input id="n-tz" type="text" required value="Europe/London" /></div>
					<div><label for="n-start">Starts (in that time zone)</label><input id="n-start" type="datetime-local" required /></div>
					<div><label for="n-end">Ends</label><input id="n-end" type="datetime-local" required /></div>
					<div><label for="n-deadline">Registration closes</label><input id="n-deadline" type="datetime-local" required /></div>
					<div><label for="n-max">In-person maximum</label><input id="n-max" type="number" min="0" required /></div>
					<div><label for="n-page">Event page (path on your site)</label><input id="n-page" type="text" required maxlength="200" /></div>
					<div><label for="n-loc">Venue address</label><input id="n-loc" type="text" maxlength="300" /></div>
				</div>
				<button type="submit">Create event</button>
				<p class="small">Then add its sessions and joining instructions below.</p>
			</form>
		</details>
	</section>

	<section aria-labelledby="h-settings">
		<h2 id="h-settings">Settings</h2>
		<form id="settings-form">
			<div class="row">
				<div><label for="s-max">In-person maximum</label><input id="s-max" type="number" min="0" required /></div>
				<div><label for="s-deadline">Registration deadline (<span class="tzl">UK time</span>)</label><input id="s-deadline" type="datetime-local" required /></div>
				<div><label for="s-travel">Assumed travel time for the "time to leave" reminder (minutes)</label><input id="s-travel" type="number" min="0" required /></div>
				<div><label for="s-hostgap">At most one list per session host every (minutes; 0 = every change)</label><input id="s-hostgap" type="number" min="0" max="1440" required /></div>
			</div>
			<button type="submit">Save settings</button>
			<p class="small">Raising a maximum does not move anyone off the waiting list by itself: use "Promote" on a person below, or <button type="button" id="promote-all" hidden>Promote all who fit</button> to give places to the waiting list in order, up to the maximum. Each person promoted is emailed the latest joining instructions.</p>
		</form>
	</section>

	<section aria-labelledby="h-sessions">
		<h2 id="h-sessions">Sessions</h2>
		<p class="small">Times, places and online links here are what everyone's calendar entries are built from. Saving changes sends updated calendar invitations, but only to people whose own entries actually change. Hosts get the attendee list by email whenever it changes.</p>
		<form id="sessions-form"><div id="sessions-box"></div>
			<button type="button" class="secondary" id="sess-dry">How many people would get a calendar update?</button>
			<button type="submit">Save sessions</button>
			<button type="button" class="secondary" id="sess-quiet">Save without emailing attendees</button>
			<p class="small">"Save without emailing attendees" changes calendar entries only when each person is next sent their joining instructions (for example a message with "Include the latest joining instructions" ticked), so several changes reach them in one email. Session hosts are still sent their updated attendee lists.</p>
		</form>
		<details><summary>Add a session</summary>
			<form id="addsess-form">
				<div class="row">
					<div><label for="a-label">Name</label><input id="a-label" type="text" required maxlength="120" /></div>
					<div><label for="a-kind">Kind</label><select id="a-kind"><option value="talk">Talk</option><option value="tour">Tour</option><option value="social">Social</option><option value="other">Other</option></select></div>
					<div><label for="a-mode">Where</label><select id="a-mode"><option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Both</option></select></div>
					<div><label for="a-type">Who comes</label><select id="a-type"><option value="core">Everyone (part of the day)</option><option value="tour">A tour: each person picks at most one</option><option value="optin">Opt-in, like a dinner</option></select></div>
					<div><label for="a-start">Starts (<span class="tzl">UK time</span>)</label><input id="a-start" type="datetime-local" required /></div>
					<div><label for="a-end">Ends (<span class="tzl">UK time</span>)</label><input id="a-end" type="datetime-local" required /></div>
					<div><label for="a-cap">Capacity (blank = unlimited)</label><input id="a-cap" type="number" min="0" /></div>
					<div><label for="a-loc">Location (blank = event venue)</label><input id="a-loc" type="text" maxlength="300" /></div>
				</div>
				<button type="submit">Add session</button>
				<p class="small">Adding a session emails nobody. People already registered see it in their calendars with their next email.</p>
			</form>
		</details>
	</section>

	<section aria-labelledby="h-regs">
		<h2 id="h-regs" tabindex="-1">Registrations</h2>
		<p><a class="button secondary" id="csv-link" href="#">Download CSV</a> <a class="button secondary" id="log-link" href="#">Download sent log (markdown)</a></p>
		<div style="overflow-x:auto"><table id="regs"><caption class="small" style="text-align:left">Waiting lists are in order of confirmation. Unconfirmed = email not yet confirmed.</caption><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Attendance</th><th scope="col">Tour</th><th scope="col">Affiliation</th><th scope="col">Needs</th><th scope="col">Extra</th><th scope="col">Shares email with hosts</th><th scope="col">Instr. v</th><th scope="col">Actions</th></tr></thead><tbody></tbody></table></div>
	</section>

	<section aria-labelledby="h-polls" id="polls">
		<h2 id="h-polls">Polls</h2>
		<p class="small">Registrants rank the options on their manage page, most wanted first, and draw a line under the ones they would join. Their suggestions wait here (and in your inbox) until you add them for everyone, in their words or yours, or turn them down. Nothing in this section emails anyone: to tell people about a poll, send a message below.</p>
		<div id="polls-box"></div>
		<details><summary>New poll</summary>
			<form id="poll-form">
				<label for="p-q">Question</label><input id="p-q" type="text" required maxlength="200" placeholder="What shall we do on Saturday?" />
				<label for="p-opts">Options, one per line</label><textarea id="p-opts" style="min-height:6rem"></textarea>
				<div class="row">
					<div><label for="p-close">Closes (<span class="tzl">UK time</span>; blank = when the event ends)</label><input id="p-close" type="datetime-local" /></div>
					<div><label><input type="checkbox" id="p-sugg" checked style="width:auto" /> Registrants can suggest options</label></div>
				</div>
				<button type="submit">Create poll</button>
			</form>
		</details>
	</section>

	<section aria-labelledby="h-instr">
		<h2 id="h-instr">Joining instructions</h2>
		<p class="small">The latest version is emailed automatically, with calendar invitations, to each person when they confirm (or are promoted from the in-person waiting list), and to anyone who registers again. Saving a new version does <strong>not</strong> email anyone already registered: to update them, write a short message below to "people on an older version" and tick "Include the latest joining instructions". If the event has an open poll someone has not answered, their copy ends with a line inviting them to put its options in order.</p>
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
				<div><label for="m-att">Attendance</label><select id="m-att"><option value="all">Everyone</option><option value="in_person">In person</option><option value="day">In person for the day</option><option value="remote">Remote</option><option value="extras">Only coming to opt-in sessions</option></select></div>
				<div><label for="m-optin">Signed up for</label><select id="m-optin"><option value="">Any</option></select></div>
				<div><label for="m-tour">Tour</label><select id="m-tour"><option value="">Any</option><option value="none">No tour</option></select></div>
				<div><label for="m-below">Only people whose joining instructions are older than version</label><input id="m-below" type="number" min="1" placeholder="(everyone)" /></div>
				<div><label><input type="checkbox" id="m-instr" style="width:auto" /> Include the latest joining instructions</label><p class="small">Your message comes first, then the full joining instructions with any calendar changes. Everyone sent it counts as having the latest version.</p></div>
			</div>
			<label><input type="checkbox" id="m-wait" style="width:auto" /> Include people on the in-person waiting list</label>
			<label for="m-when">Send at (<span class="tzl">UK time</span>; leave empty to send now)</label><input id="m-when" type="datetime-local" />
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
	let res;
	// When the Access session runs out, Access redirects to its sign-in page on another site, which fetch cannot follow.
	try { res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', redirect: 'manual' }); }
	catch { throw new Error('Could not reach the server. Check your connection, then reload the page (your sign-in may have run out).'); }
	if (res.type === 'opaqueredirect' || res.status === 0) throw new Error('Your sign-in has run out: reload the page to sign in again. Nothing was saved or sent.');
	const d = await res.json().catch(() => ({ ok: false, error: 'HTTP ' + res.status }));
	if (!d.ok) throw new Error(d.error || 'HTTP ' + res.status);
	return d;
}
// datetime-local values are wall-clock time in the event's own zone (TZ, set from the event); convert via that zone's offset at that moment.
let TZ = 'Europe/London';
const tzLabel = () => TZ === 'Europe/London' ? 'UK time' : TZ.split('/').pop().replace(/_/g, ' ') + ' time';
function ukLocalToIso(v, tz = TZ) {
	if (!v) return null;
	const wall = new Date(v + 'Z').getTime();
	const offset = (ms) => { const d = new Date(ms); return new Date(d.toLocaleString('en-US', { timeZone: tz })).getTime() - new Date(d.toLocaleString('en-US', { timeZone: 'UTC' })).getTime(); };
	// The offset that applies at the instant itself, so a second pass from the first guess: near a change of offset the
	// first guess can be on the other side of it. A wall time that does not exist (in the hour clocks skip) moves forward.
	const first = wall - offset(wall), second = wall - offset(first);
	return new Date(offset(second) === offset(first) ? second : first).toISOString();
}
function isoToUkLocal(iso) {
	if (!iso) return '';
	const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
	const g = (t) => parts.find((p) => p.type === t).value;
	return g('year') + '-' + g('month') + '-' + g('day') + 'T' + g('hour') + ':' + g('minute');
}
const uk = (iso) => iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }) : '';
let sessions = [], tours = [], latestVersion = 0, eventId = EVENT;

function audience() {
	return { attendance: $('m-att').value, optin: $('m-optin').value || undefined, tour_id: $('m-tour').value || undefined, below_version: $('m-below').value ? Number($('m-below').value) : undefined, include_waitlist: $('m-wait').checked };
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

function showSetup(findings) {
	const list = (findings || []).filter((f) => f.level !== 'note' || findings.some((x) => x.level !== 'note'));
	$('setup').hidden = !list.length;
	$('setup-list').innerHTML = list.map((f) => '<li class="' + esc(f.level) + '">' + esc(f.text) + '</li>').join('');
}

async function load() {
	// A site updated without copying functions/api/admin/events.ts has no events API: the page works without that section.
	const evs = await api('/api/admin/events').catch(() => null);
	showSetup(evs && evs.setup);
	if (!evs) $('events').hidden = true;
	else if (!evs.events.length) {
		// A new installation: nothing to show but the form to create the first event.
		document.querySelectorAll('main > section').forEach((x) => { if (x.id !== 'setup') x.hidden = x.id !== 'events'; });
		$('ev-pick').hidden = true; $('ev-pick').previousElementSibling.textContent = 'No events yet: create the first one.';
		$('ev-form').closest('details').hidden = true; $('clone-form').closest('details').hidden = true; $('new-details').open = true;
		return;
	}
	const s = await api('/api/admin/summary?event=' + encodeURIComponent(eventId));
	if (!evs) showSetup(s.setup);
	eventId = s.event.id;
	TZ = s.event.timezone || 'Europe/London';
	document.querySelectorAll('.tzl').forEach((x) => { x.textContent = tzLabel(); });
	if (evs) $('ev-pick').innerHTML = evs.events.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === eventId ? ' selected' : '') + '>' + esc(x.title) + ' – ' + esc(uk(x.starts_at)) + '</option>').join('');
	const ev = s.event;
	$('e-title').value = ev.title; $('e-loc').value = ev.location || ''; $('e-page').value = ev.page_path; $('e-tz').value = ev.timezone;
	$('e-start').value = isoToUkLocal(ev.starts_at); $('e-end').value = isoToUkLocal(ev.ends_at); $('e-q').value = ev.extra_question || '';
	$('e-lip').value = ev.in_person_label || ''; $('e-lrem').value = ev.remote_label || ''; $('e-ltour').value = ev.tour_legend || '';
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
		...c.optins.map((o) => stat(o.label + ' signed up (waiting ' + o.waiting + ')', o.confirmed + ' / ' + (o.capacity ?? '∞'))),
		stat('registration closes', uk(s.event.deadline)),
	].join('');
	$('promote-all').hidden = !(c.inPerson.waiting > 0 && c.inPerson.held < c.inPerson.max);
	$('promote-all').dataset.fit = String(Math.min(c.inPerson.waiting, c.inPerson.max - c.inPerson.held));
	$('s-max').value = s.event.in_person_max; $('s-deadline').value = isoToUkLocal(s.event.deadline); $('s-travel').value = s.event.travel_minutes; $('s-hostgap').value = s.event.host_list_minutes ?? 0;

	$('sessions-box').innerHTML = sessions.map((x) => {
		const id = esc(x.id);
		const f = (name, label, type, value, extra = '') => '<div><label for="sx-' + name + '-' + id + '">' + label + '</label><input id="sx-' + name + '-' + id + '" type="' + type + '" value="' + esc(value) + '" ' + extra + ' /></div>';
		return '<fieldset><legend>' + esc(x.label) + ' <span class="small">(' + esc(x.kind) + ', ' + esc(x.mode) + (x.choice_group ? ', optional, booked separately' : '') + ')</span></legend><div class="row">'
			+ f('start', 'Starts (' + esc(tzLabel()) + ')', 'datetime-local', isoToUkLocal(x.starts_at), 'required')
			+ f('end', 'Ends (' + esc(tzLabel()) + ')', 'datetime-local', isoToUkLocal(x.ends_at), 'required')
			+ f('loc', 'Location (blank = event venue)', 'text', x.location ?? '')
			+ f('url', 'Online link (e.g. Google Meet)', 'url', x.online_url ?? '', 'placeholder="https://meet.google.com/…"')
			+ f('hname', 'Host name', 'text', x.host_name ?? '')
			+ f('hemail', 'Host email (gets the list)', 'email', x.host_email ?? '')
			+ f('cap', 'Capacity (blank = unlimited)', 'number', x.capacity ?? '', 'min="0"')
			+ (x.choice_group || x.optin ? f('dl', 'Booking closes (blank = at start)', 'datetime-local', isoToUkLocal(x.booking_deadline)) : '')
			+ '</div><button type="button" class="danger" data-delsess="' + id + '" data-label="' + esc(x.label) + '">Delete session</button></fieldset>';
	}).join('');

	const optSel = $('m-optin');
	optSel.querySelectorAll('option[data-o]').forEach((o) => o.remove());
	for (const x of sessions.filter((y) => y.optin)) { const o = document.createElement('option'); o.value = x.id; o.textContent = x.label; o.dataset.o = '1'; optSel.append(o); }
	optSel.parentElement.hidden = !sessions.some((y) => y.optin);
	const tourSel = $('m-tour');
	tourSel.querySelectorAll('option[data-t]').forEach((o) => o.remove());
	for (const t of tours) { const o = document.createElement('option'); o.value = t.id; o.textContent = t.label; o.dataset.t = '1'; tourSel.append(o); }

	$('regs').querySelector('tbody').innerHTML = s.registrations.map((r) => {
		const tour = tours.find((t) => t.id === r.tour_id);
		const pend = r.status === 'pending' ? '<span class="tag pending">unconfirmed</span> ' : '';
		const where = r.attendance === 'remote' ? 'Remote' : !r.place ? (() => { const chosen = s.sessions.filter((x) => x.optin && (r.optins || '').split(',').includes(x.id)); const waiting = (r.optins_waiting || '').split(','); const all = chosen.length && chosen.every((x) => waiting.includes(x.id));
			return '<span class="tag ' + (all ? 'wait' : 'ok') + '">' + esc(chosen.map((x) => x.label).join(', ') || 'Opt-in') + ' only' + (all ? ': waiting' : '') + '</span>'; })() : r.place === 'waitlist' ? '<span class="tag wait">in person: waiting since ' + esc(uk(r.waitlist_since)) + '</span>' : '<span class="tag ok">in person</span>';
		const waitingFor = (r.optins_waiting || '').split(',');
		const optSessions = r.attendance === 'in_person' && r.optins ? s.sessions.filter((x) => x.optin && r.optins.split(',').includes(x.id)) : [];
		const opts = optSessions.map((x) => waitingFor.includes(x.id) ? '<span class="tag wait">' + esc(x.label) + ': waiting</span>' : esc(x.label));
		const tourCell = (tour ? (r.tour_place === 'waitlist' ? '<span class="tag wait">' + esc(tour.label) + ': waiting</span>' : esc(tour.label)) : '') + (opts.length ? (tour ? '<br>' : '') + 'Signed up: ' + opts.join(', ') : '');
		const actions = [
			r.status === 'confirmed' && r.place === 'waitlist' ? '<button data-promote="event" data-id="' + esc(r.id) + '">Promote to place</button>' : '',
			r.status === 'confirmed' && r.tour_place === 'waitlist' ? '<button data-promote="tour" data-id="' + esc(r.id) + '">Promote to tour</button>' : '',
			...(r.status === 'confirmed' ? optSessions.filter((x) => waitingFor.includes(x.id)).map((x) => '<button data-promote="optin" data-session="' + esc(x.id) + '" data-id="' + esc(r.id) + '">Promote to ' + esc(x.label.toLowerCase()) + '</button>') : []),
			'<button class="danger" data-delete="' + esc(r.id) + '" data-name="' + esc(r.name) + '" data-confirmed="' + (r.status === 'confirmed' ? '1' : '0') + '">Remove</button>',
		].join(' ');
		return '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.email) + '</td><td>' + pend + where + '</td><td>' + tourCell + '</td><td>' + esc(r.affiliation) + '</td><td>' + esc(r.needs) + '</td><td>' + esc(r.extra_answer) + '</td><td>' + (r.share_contact ? 'yes' : 'no') + '</td><td>' + esc(r.instructions_version) + '</td><td>' + actions + '</td></tr>';
	}).join('') || '<tr><td colspan="10">No registrations yet.</td></tr>';
	$('csv-link').href = '/api/admin/export?format=csv&event=' + encodeURIComponent(eventId);
	$('log-link').href = '/api/admin/sent-log?event=' + encodeURIComponent(eventId);

	const iv = await api('/api/admin/instructions?event=' + encodeURIComponent(eventId));
	const latest = iv.versions[0];
	$('instr-versions').innerHTML = iv.versions.map((v) => '<details><summary>Version ' + esc(v.version) + ' – ' + esc(uk(v.created_at)) + ' – ' + esc(v.subject) + (v.change_note ? ' – <em>' + esc(v.change_note) + '</em>' : '') + '</summary><pre style="white-space:pre-wrap">' + esc(v.body_md) + '</pre></details>').join('');
	if (latest && !$('i-subject').value) { $('i-subject').value = latest.subject; $('i-body').value = latest.body_md; }
	$('m-instr').parentElement.lastChild.textContent = ' Include the latest joining instructions (version ' + latestVersion + ')';

	await loadPolls();

	const ms = await api('/api/admin/messages?event=' + encodeURIComponent(eventId));
	$('msgs').querySelector('tbody').innerHTML = ms.messages.map((m) => '<tr><td>' + esc(uk(m.sent_at || m.scheduled_at || m.created_at)) + '</td><td>' + esc(m.subject) + '</td><td>' + esc(m.status) + (m.error ? ': ' + esc(m.error) : '') + (m.uncertain ? ' <span class="tag wait">' + esc(m.uncertain) + ' may not have had it: a retry could not tell, so it was not sent again</span>' : '') + '</td><td>' + esc(m.recipients_count ?? '') + '</td><td><code>' + esc(m.audience) + '</code></td><td>' + (m.status === 'sending' ? '<span class="small">the rest go out within a few minutes</span> ' : '') + (m.status === 'failed' ? '<button data-resume="' + esc(m.id) + '">Resume</button> ' : '') + (m.status === 'scheduled' || m.status === 'sending' ? '<button class="danger" data-cancel="' + esc(m.id) + '">Cancel</button>' : '') + '</td></tr>').join('') || '<tr><td colspan="6">Nothing sent yet.</td></tr>';
}

$('settings-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	try {
		const d = await api('/api/admin/settings', 'POST', { event: eventId, in_person_max: Number($('s-max').value), deadline: ukLocalToIso($('s-deadline').value), travel_minutes: Number($('s-travel').value), host_list_minutes: Number($('s-hostgap').value) });
		toast('Settings saved.' + (d.calendar_updates ? ' ' + d.calendar_updates + ' calendar update(s) sent.' : '')); load();
	} catch (err) { toast(err.message); }
});
$('sessions-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	try {
		const dry = await api('/api/admin/sessions', 'POST', { event: eventId, sessions: sessionEdits(), dry_run: true });
		if (!confirm('Save sessions? ' + dry.calendar_updates + ' person(s) will get updated calendar invitations.')) return;
		const d = await api('/api/admin/sessions', 'POST', { event: eventId, sessions: sessionEdits() });
		toast('Sessions saved. ' + d.calendar_updates + ' calendar update(s)' + (d.calendar_queued ? ': ' + (d.calendar_updates - d.calendar_queued) + ' sent now, the rest within a few minutes.' : ' sent.')); load();
	} catch (err) { toast(err.message); }
});
document.body.addEventListener('click', async (e) => {
	const b = e.target.closest('button');
	if (!b) return;
	try {
		if (b.id === 'sess-quiet') {
			if (!confirm('Save sessions without emailing attendees? Session hosts still get their updated lists. Calendars update with each person\'s next joining-instructions email.')) return;
			await api('/api/admin/sessions', 'POST', { event: eventId, sessions: sessionEdits(), quiet: true }); toast('Sessions saved. No attendee was emailed; hosts get their updated lists.'); load();
		} else if (b.id === 'sess-dry') {
			const d = await api('/api/admin/sessions', 'POST', { event: eventId, sessions: sessionEdits(), dry_run: true });
			toast(d.calendar_updates + ' person(s) would get updated calendar invitations.');
		} else if (b.id === 'promote-all') {
			if (!confirm('Promote ' + b.dataset.fit + ' person(s) from the waiting list? Each will be emailed the latest joining instructions.')) return;
			let d, total = 0;
			do { d = await api('/api/admin/promote-all', 'POST', { event: eventId }); total += d.promoted; toast('Promoting… ' + total + ' so far.'); } while (d.more && d.promoted);
			toast('Promoted and emailed ' + total + (d.still_waiting ? '; ' + d.still_waiting + ' still waiting.' : '.')); load();
		} else if (b.dataset.promote) {
			if (!confirm('Promote this person? They will be emailed the latest joining instructions.')) return;
			await api('/api/admin/promote', 'POST', { id: b.dataset.id, what: b.dataset.promote, session: b.dataset.session }); toast('Promoted and emailed.'); load().then(() => $('h-regs').focus());
		} else if (b.dataset.delete) {
			if (!confirm(b.dataset.confirmed === '1' ? 'Remove ' + b.dataset.name + '? They have confirmed, so they will be emailed that their registration has been cancelled, and their calendar entries removed.' : 'Remove ' + b.dataset.name + '? They never confirmed, so no email is sent (use this for spam, typos or duplicates).')) return;
			await api('/api/admin/registration', 'DELETE', { id: b.dataset.delete }); toast('Removed.'); load().then(() => $('h-regs').focus());
		} else if (b.dataset.resume) {
			if (!confirm('Carry on sending this message to the people who have not had it yet?')) return;
			await api('/api/admin/messages', 'POST', { action: 'resume', id: b.dataset.resume }); toast('Resumed: the rest go out within a few minutes.'); load();
		} else if (b.dataset.cancel) {
			if (!confirm('Cancel this scheduled message? It will not be sent, and this cannot be undone.')) return;
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
async function loadPolls() {
	const d = await api('/api/admin/polls?event=' + encodeURIComponent(eventId));
	$('polls-box').innerHTML = d.polls.map((p) => {
		const pid = esc(p.id);
		const pending = p.options.filter((o) => o.status === 'pending');
		const decided = p.options.filter((o) => o.suggested_label && o.status !== 'pending');
		const rows = p.tally.results.map((r) => '<tr><td>' + esc(r.label) + '</td><td>' + r.willing + '</td><td>' + r.out + '</td><td>' + r.first + '</td><td>' + r.score + '</td><td class="small">' + esc((r.names || []).join(', ')) + '</td><td><button class="secondary" data-poll-rename="' + esc(r.id) + '" data-label="' + esc(r.label) + '">Rename</button> <button class="danger" data-poll-remove="' + esc(r.id) + '" data-label="' + esc(r.label) + '">Remove</button></td></tr>').join('');
		return '<fieldset data-poll="' + pid + '"><legend>' + esc(p.question) + '</legend>'
			+ '<p class="small">' + (p.open ? 'Open' : 'Closed') + ', ' + (p.closes_at ? 'closes ' + esc(uk(p.closes_at)) : 'closes when the event ends') + '. ' + p.tally.voters + ' answer(s)' + (p.tally.nothing ? ', of whom ' + p.tally.nothing + ' would join none of the options' : '') + '. Suggestions ' + (p.allow_suggestions ? 'on' : 'off') + '.</p>'
			+ (pending.length ? '<h3>Suggestions waiting for you</h3><ul>' + pending.map((o) => '<li><strong>' + esc(o.label) + '</strong> from ' + esc(o.suggested_by_name || 'someone who has since cancelled') + ' <button data-poll-decide="add" data-option="' + esc(o.id) + '">Add for everyone</button> <button class="secondary" data-poll-decide="use" data-option="' + esc(o.id) + '" data-label="' + esc(o.label) + '">Add in my words…</button> <button class="danger" data-poll-decide="reject" data-option="' + esc(o.id) + '">Don\'t add</button></li>').join('') + '</ul>' : '')
			+ '<div style="overflow-x:auto"><table><caption class="small" style="text-align:left">Sorted by how many would join, then by preference (each person\'s top choice above their line scores most).</caption><thead><tr><th scope="col">Option</th><th scope="col">Would join</th><th scope="col">Would stay at home</th><th scope="col">First choice</th><th scope="col">Score</th><th scope="col">Who would join</th><th scope="col">Actions</th></tr></thead><tbody>' + (rows || '<tr><td colspan="7">No options yet.</td></tr>') + '</tbody></table></div>'
			+ '<div class="row"><div><label for="po-' + pid + '">Add an option</label><input id="po-' + pid + '" type="text" maxlength="80" /></div></div><button data-poll-add="' + pid + '">Add option</button> '
			+ '<button class="secondary" data-poll-toggle="' + pid + '" data-allow="' + (p.allow_suggestions ? '1' : '0') + '">' + (p.allow_suggestions ? 'Stop taking suggestions' : 'Take suggestions') + '</button> '
			+ '<button class="secondary" data-poll-close="' + pid + '" data-open="' + (p.open ? '1' : '0') + '">' + (p.open ? 'Close now' : 'Reopen until the event ends') + '</button> '
			+ '<button class="danger" data-poll-delete="' + pid + '">Delete poll</button>'
			+ (decided.length ? '<details><summary class="small">Decided suggestions</summary><ul class="small">' + decided.map((o) => '<li>' + esc(o.suggested_label || o.label) + ' (' + esc(o.suggested_by_name || 'since cancelled') + '): ' + (o.status === 'active' ? 'added as ' + esc(o.label) : o.merged_into ? 'merged into an existing option' : 'not added') + ', ' + esc(o.decided_by || '') + ', ' + esc(uk(o.decided_at)) + '</li>').join('') + '</ul></details>' : '')
			+ '</fieldset>';
	}).join('') || '<p class="small">No polls yet.</p>';
}
$('poll-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	try {
		await api('/api/admin/polls', 'POST', { action: 'create', event: eventId, question: $('p-q').value, options: $('p-opts').value, closes_at: ukLocalToIso($('p-close').value), allow_suggestions: $('p-sugg').checked });
		toast('Poll created. Nobody has been emailed.'); e.target.reset(); $('p-sugg').checked = true; loadPolls();
	} catch (err) { toast(err.message); }
});
$('polls-box').addEventListener('click', async (e) => {
	const b = e.target.closest('button');
	if (!b) return;
	const act = (body) => api('/api/admin/polls', 'POST', body);
	try {
		if (b.dataset.pollDecide) {
			let label;
			if (b.dataset.pollDecide === 'use') { label = prompt('Add it in your words (an existing option\'s name merges it into that option):', b.dataset.label); if (!label) return; }
			const d = await act({ action: 'decide', option: b.dataset.option, decision: b.dataset.pollDecide, label });
			toast((d.already ? 'Already decided: ' : 'Done: ') + d.outcome + '.');
		} else if (b.dataset.pollRename) {
			const label = prompt('New wording:', b.dataset.label); if (!label) return;
			await act({ action: 'rename_option', option: b.dataset.pollRename, label }); toast('Renamed.');
		} else if (b.dataset.pollRemove) {
			if (!confirm('Remove ' + b.dataset.label + '? It is taken off everyone\'s ranking.')) return;
			await act({ action: 'remove_option', option: b.dataset.pollRemove }); toast('Removed.');
		} else if (b.dataset.pollAdd) {
			await act({ action: 'add_option', poll: b.dataset.pollAdd, label: $('po-' + b.dataset.pollAdd).value }); toast('Option added. People who have already answered see it as new, below their line.');
		} else if (b.dataset.pollToggle) {
			await act({ action: 'update', poll: b.dataset.pollToggle, allow_suggestions: b.dataset.allow !== '1' }); toast('Saved.');
		} else if (b.dataset.pollClose) {
			await act({ action: 'update', poll: b.dataset.pollClose, closes_at: b.dataset.open === '1' ? new Date().toISOString() : null }); toast('Saved.');
		} else if (b.dataset.pollDelete) {
			if (!confirm('Delete this poll and everyone\'s answers?')) return;
			await act({ action: 'delete', poll: b.dataset.pollDelete }); toast('Poll deleted.');
		} else return;
		loadPolls();
	} catch (err) { toast(err.message); }
});
const goTo = (id) => { location.search = '?event=' + encodeURIComponent(id); };
$('ev-pick').addEventListener('change', (e) => goTo(e.target.value));
$('ev-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	try {
		const tz = $('e-tz').value.trim();
		// The times shown are in the event's current zone, so they are read in it: a new zone keeps the event at the same moment.
		await api('/api/admin/events', 'POST', { action: 'update', event: eventId, title: $('e-title').value, location: $('e-loc').value, page_path: $('e-page').value, timezone: tz,
			starts_at: ukLocalToIso($('e-start').value), ends_at: ukLocalToIso($('e-end').value), extra_question: $('e-q').value, in_person_label: $('e-lip').value, remote_label: $('e-lrem').value, tour_legend: $('e-ltour').value });
		toast('Event saved. Nobody has been emailed.'); load();
	} catch (err) { toast(err.message); }
});
$('clone-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	try {
		const d = await api('/api/admin/events', 'POST', { action: 'clone', event: eventId, id: $('c-id').value, title: $('c-title').value, starts_at: ukLocalToIso($('c-start').value), page_path: $('c-page').value });
		toast('Cloned.'); goTo(d.id);
	} catch (err) { toast(err.message); }
});
$('new-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	const tz = $('n-tz').value.trim();
	try {
		const d = await api('/api/admin/events', 'POST', { action: 'create', id: $('n-id').value, title: $('n-title').value, timezone: tz, starts_at: ukLocalToIso($('n-start').value, tz), ends_at: ukLocalToIso($('n-end').value, tz),
			deadline: ukLocalToIso($('n-deadline').value, tz), in_person_max: Number($('n-max').value), page_path: $('n-page').value, location: $('n-loc').value });
		toast('Event created.'); goTo(d.id);
	} catch (err) { toast(err.message); }
});
$('addsess-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	const type = $('a-type').value;
	try {
		await api('/api/admin/events', 'POST', { action: 'add_session', event: eventId, label: $('a-label').value, kind: $('a-kind').value, mode: $('a-mode').value, choice_group: type === 'tour' ? 'tour' : null, optin: type === 'optin',
			starts_at: ukLocalToIso($('a-start').value), ends_at: ukLocalToIso($('a-end').value), capacity: $('a-cap').value === '' ? null : Number($('a-cap').value), location: $('a-loc').value });
		toast('Session added. Nobody has been emailed.'); e.target.reset(); load();
	} catch (err) { toast(err.message); }
});
$('sessions-box').addEventListener('click', async (e) => {
	const b = e.target.closest('button[data-delsess]');
	if (!b) return;
	if (!confirm('Delete ' + b.dataset.label + '?')) return;
	try { await api('/api/admin/events', 'POST', { action: 'delete_session', session: b.dataset.delsess }); toast('Session deleted.'); load(); } catch (err) { toast(err.message); }
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
	if (when && Date.parse(when) < Date.now()) { toast('That time has passed. Choose a later time, or leave "Send at" empty to send now.'); $('m-when').focus(); return; }
	try {
		const count = (await api('/api/admin/messages', 'POST', { event: eventId, dry_run: true, audience: audience() })).count;
		if (!confirm((when ? 'Schedule for ' + uk(when) : 'Send now') + ' to ' + count + ' recipient(s)?')) return;
		const sent = await api('/api/admin/messages', 'POST', { event: eventId, subject: $('m-subject').value, body_md: $('m-body').value, audience: audience(), scheduled_at: when, marks_instructions_version: $('m-instr').checked ? latestVersion : undefined });
		const m = sent.message || {};
		toast(when ? 'Scheduled.' : m.status === 'sending' && m.error ? 'Not sent yet: ' + m.error + '. It will be tried again within a few minutes; do not send it again.' : m.status === 'sending' ? 'Sending: the first copies have gone, and the rest go out within a few minutes.' : 'Sent.'); e.target.reset(); load();
	} catch (err) { toast(err.message); }
});
load().catch((err) => { document.querySelector('main').innerHTML = '<section><h2>Not available</h2><p>' + esc(err.message) + '</p><p class="small">This page needs Cloudflare Access sign-in, and an event id (?event=...).</p></section>'; });
`;
}

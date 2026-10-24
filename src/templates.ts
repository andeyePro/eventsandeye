// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import { type Mode, modeOf } from './mode';
import type { Attachment, OutgoingEmail } from './email';
import { type CalEntry, addLinks } from './ics';
import { mdToHtml, mdToText } from './markdown';
import { escapeHtml, ukDate, ukDateTime } from './util';

export interface EventRow {
	id: string;
	title: string;
	starts_at: string;
	ends_at: string;
	timezone: string;
	location: string;
	in_person_max: number;
	deadline: string;
	travel_minutes: number;
	page_path: string;
	/** Optional free-text question shown on the booking form (null = none). */
	extra_question?: string | null;
}

export interface SessionRow {
	id: string;
	event_id: string;
	label: string;
	kind: 'talk' | 'tour' | 'social' | 'other';
	mode: 'in_person' | 'online' | 'hybrid';
	choice_group: string | null;
	starts_at: string;
	ends_at: string;
	location: string | null;
	online_url: string | null;
	host_name: string | null;
	host_email: string | null;
	capacity: number | null;
	booking_deadline: string | null;
	sort: number;
	/** 1 for an optional session people sign up to (e.g. dinner), so numbers are known; with a capacity, it has a waiting list. */
	optin?: number;
}

export interface RegistrationRow {
	id: string;
	event_id: string;
	name: string;
	email: string;
	attendance: 'in_person' | 'remote';
	affiliation: string | null;
	needs: string | null;
	extra_answer?: string | null;
	/** Comma-separated ids of the opt-in sessions this person signed up to, whether they have a place or are waiting. */
	optins?: string | null;
	/** The subset of optins they are on the waiting list for. */
	optins_waiting?: string | null;
	/** How many times an unconfirmed registration for this address has been replaced (each sends a fresh confirm email). */
	resends?: number;
	optins_waitlist_since?: string | null;
	share_contact: number;
	status: 'pending' | 'confirmed';
	place: 'place' | 'waitlist' | null;
	tour_id: string | null;
	tour_place: 'place' | 'waitlist' | null;
	consent_at: string;
	created_at: string;
	updated_at: string;
	confirmed_at: string | null;
	hold_expires_at: string | null;
	hold_warned_at: string | null;
	waitlist_since: string | null;
	tour_waitlist_since: string | null;
	instructions_version: number;
	calendar_state: string;
}

/** Organisation details for email chrome. */
export interface Brand {
	org: string;
	source: string;
	footer: string;
	privacyUrl: string;
	notify: string;
}

export interface CalendarBlock {
	entries: CalEntry[];
	icsUrl: (key: string) => string;
}

const BLUE = '#0069a0'; // AA contrast with white text

const poweredBy = (b: Brand) =>
	`Registrations via <a href="${escapeHtml(b.source)}">Events&amp;I</a> (beta) – all feedback hugely welcome at <a href="mailto:${escapeHtml(b.notify)}">${escapeHtml(b.notify)}</a>.`;
const poweredByText = (b: Brand) => `Registrations via Events&I (beta) – all feedback hugely welcome: ${b.notify}`;

function layout(b: Brand, title: string, bodyHtml: string, extraFooter = ''): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f4f7f2;font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.5">
<div style="max-width:600px;margin:0 auto;padding:24px">
<p style="font-size:20px;font-weight:bold;margin:0 0 16px;color:${BLUE}">${escapeHtml(b.org)}</p>
<div style="background:#fff;border-radius:8px;padding:24px">${bodyHtml}</div>
<p style="font-size:12px;color:#555;margin-top:16px">${extraFooter}${escapeHtml(b.footer)} Questions? Reply to this email or write to <a href="mailto:${escapeHtml(b.notify)}">${escapeHtml(b.notify)}</a>. <a href="${escapeHtml(b.privacyUrl)}">Privacy notice</a>.</p>
<p style="font-size:12px;color:#555">${poweredBy(b)}</p>
</div></body></html>`;
}

const textFooter = (b: Brand) => `\n\n--\n${b.org} – ${b.notify} – Privacy notice: ${b.privacyUrl}\n${poweredByText(b)}`;

function button(href: string, label: string): string {
	return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:${BLUE};color:#fff;text-decoration:none;font-weight:bold;font-size:18px;padding:14px 24px;border-radius:6px;display:inline-block">${escapeHtml(label)}</a></p>`;
}

/**
 * Joining instructions can carry sections for one kind of attendee only:
 *   :::in-person            :::remote
 *   …markdown…              …markdown…
 *   :::                     :::
 * Everything outside such a block goes to everyone.
 */
export function forAudience(md: string, mode: Mode): string {
	const out: string[] = [];
	let keep = true;
	const tag = { in_person: 'in-person', remote: 'remote', extras: 'extras' }[mode];
	for (const line of md.split('\n')) {
		const m = /^:::\s*(in-person|remote|extras)?\s*$/.exec(line.trim());
		if (m) { keep = !m[1] || m[1] === tag; continue; }
		if (keep) out.push(line);
	}
	return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** The opt-in sessions (e.g. dinner) this registration signed up to, with a place or waiting. Only in-person registrations can. */
export function optedIn(reg: Pick<RegistrationRow, 'attendance' | 'optins'>, sessions: SessionRow[]): SessionRow[] {
	if (reg.attendance !== 'in_person' || !reg.optins) return [];
	const ids = reg.optins.split(',');
	return sessions.filter((s) => s.optin && ids.includes(s.id));
}

export const optinWaiting = (reg: Pick<RegistrationRow, 'optins_waiting'>, id: string) => (reg.optins_waiting ?? '').split(',').includes(id);

/** The opt-in sessions this registration has a place at (not just waiting for). */
export const optinPlaces = (reg: Pick<RegistrationRow, 'attendance' | 'optins' | 'optins_waiting'>, sessions: SessionRow[]) =>
	optedIn(reg, sessions).filter((s) => !optinWaiting(reg, s.id));

/** Just the opt-in sessions, and waiting for every one of them: like the in-person waiting list, no joining instructions yet. */
export const onlyWaiting = (reg: Pick<RegistrationRow, 'attendance' | 'place' | 'optins' | 'optins_waiting'>, sessions: SessionRow[]) =>
	modeOf(reg) === 'extras' && optedIn(reg, sessions).length > 0 && !optinPlaces(reg, sessions).length;

/** Waiting for a place: in person, or (for someone coming only to the opt-in sessions) for all of those. */
export const waitingForPlace = (reg: Pick<RegistrationRow, 'attendance' | 'place' | 'optins' | 'optins_waiting'>, sessions: SessionRow[]) =>
	(reg.attendance === 'in_person' && reg.place === 'waitlist') || onlyWaiting(reg, sessions);

const lower = (s: SessionRow) => s.label.charAt(0).toLowerCase() + s.label.slice(1);
const waitingLines = (reg: RegistrationRow, sessions: SessionRow[]) =>
	optedIn(reg, sessions).filter((s) => optinWaiting(reg, s.id)).map((s) => `You are on the waiting list for ${lower(s)}. We will email you if a place becomes available.`);

export function statusLines(reg: RegistrationRow, sessions: SessionRow[]): string[] {
	const lines: string[] = [];
	const mode = modeOf(reg);
	if (mode === 'extras') {
		const what = optedIn(reg, sessions).map(lower).join(' and ') || 'the optional sessions';
		return [`You are joining us for ${what} only.`, ...waitingLines(reg, sessions)];
	}
	if (reg.attendance === 'remote') lines.push('You are registered to join the talks remotely.');
	else if (reg.place === 'waitlist') lines.push('You are on the waiting list for an in-person place. We will email you if a place becomes available.');
	else lines.push('You have an in-person place.');
	if (reg.attendance === 'in_person' && reg.tour_id) {
		const t = sessions.find((x) => x.id === reg.tour_id);
		if (t) lines.push(reg.tour_place === 'waitlist' ? `You are on the waiting list for the ${t.label}.` : `You are booked on the ${t.label}.`);
	}
	for (const s of optinPlaces(reg, sessions)) lines.push(s.capacity != null ? `You have a place at ${lower(s)}.` : `You would like to join us for ${lower(s)}.`);
	lines.push(...waitingLines(reg, sessions));
	return lines;
}

function calendarHtml(cal: CalendarBlock | undefined, tz: string): string {
	if (!cal || !cal.entries.length) return '';
	const items = cal.entries.map((e) => {
		const l = addLinks(e);
		return `<li><strong>${escapeHtml(e.summary)}</strong>, ${escapeHtml(ukDateTime(e.start, tz))}<br>
<span style="font-size:14px">Add to: <a href="${escapeHtml(l.google)}">Google</a> · <a href="${escapeHtml(l.outlook)}">Outlook.com</a> · <a href="${escapeHtml(l.office365)}">Office 365</a> · <a href="${escapeHtml(l.yahoo)}">Yahoo</a> · <a href="${escapeHtml(cal.icsUrl(e.key))}">Apple and others (.ics)</a></span></li>`;
	}).join('');
	return `<h2 style="font-size:18px">Your calendar</h2><p style="font-size:14px">If the event wasn't added to your calendar automatically, try opening the attachment or using one of these links:</p><ul>${items}</ul>`;
}

function calendarText(cal: CalendarBlock | undefined, tz: string): string {
	if (!cal || !cal.entries.length) return '';
	return '\n\nYOUR CALENDAR (if the event wasn\'t added automatically, open the attachment or use one of these links)\n' + cal.entries.map((e) => {
		const l = addLinks(e);
		return `- ${e.summary}, ${ukDateTime(e.start, tz)}\n  Google: ${l.google}\n  Outlook.com: ${l.outlook}\n  Office 365: ${l.office365}\n  Yahoo: ${l.yahoo}\n  Apple and others (.ics): ${cal.icsUrl(e.key)}`;
	}).join('\n');
}

/**
 * The double opt-in email. It goes to an address nobody has verified yet, so it carries no manage link, does not
 * repeat the name typed into the form, and lists only the choices the recipient is about to confirm.
 */
export function confirmEmail(b: Brand, ev: EventRow, reg: RegistrationRow, sessions: SessionRow[], confirmUrl: string): OutgoingEmail {
	const subject = `Complete your registration: ${ev.title}`;
	const choices = [
		...statusLines(reg, sessions).map((l) => l.replace('You have an in-person place.', 'An in-person place is held for you.').replace('You are booked on', 'A place is held for you on').replace('You are on the waiting list for an in-person place. We will email you if a place becomes available.', 'You are joining the waiting list for an in-person place.').replace(/^You are on the waiting list for (.*)\. We will email you if a place becomes available\.$/, 'You are joining the waiting list for $1.')),
		reg.share_contact ? 'You chose to share your email address with the hosts of the sessions you attend.' : 'Session hosts will see only your name and whether you have a place.',
	];
	const waiting = waitingForPlace(reg, sessions);
	const held = modeOf(reg) === 'in_person' && !waiting ? 'your place will be released' : 'it will be deleted';
	// On the waiting list there's no place to lose: the point of confirming is to stay on the list.
	const why = !waiting ? '' : reg.place === 'waitlist' ? ' and join the waiting list: we will email you if a place comes up, for example if we can book a bigger room' : ' and join the waiting list: we will email you if a place comes up';
	const notMeUrl = `${confirmUrl}${confirmUrl.includes('?') ? '&' : '?'}not-me=1`;
	const holdUntil = ukDateTime(reg.hold_expires_at ?? ev.deadline, ev.timezone);
	const html = layout(b, subject, `
<h1 style="font-size:22px;margin-top:0">Please complete your registration</h1>
<p>Hello,</p>
<p>Someone, hopefully you, registered this address for the <strong>${escapeHtml(ev.title)}</strong>, on ${escapeHtml(ukDateTime(ev.starts_at, ev.timezone))}.</p>
<p><strong>Your registration is not complete yet.</strong> Please click the button below now to confirm your email address${why}. If you don't complete your registration, ${held} on ${escapeHtml(holdUntil)}.</p>
<p>You are confirming:</p><ul>${choices.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
${button(confirmUrl, 'Complete registration')}
<p style="font-size:14px">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(confirmUrl)}">${escapeHtml(confirmUrl)}</a></p>
<p style="font-size:14px">To change anything, register again with the same address: the newest registration replaces this one. Once you have confirmed, every email has a link to view, change or cancel your registration.</p>
<p style="font-size:14px">If you did not register, please <a href="${escapeHtml(notMeUrl)}">click here to delete the registration</a>.</p>`);
	const text = `Hello,

Someone, hopefully you, registered this address for the ${ev.title}, on ${ukDateTime(ev.starts_at, ev.timezone)}.

YOUR REGISTRATION IS NOT COMPLETE YET. Please open this link now and click "Complete registration" to confirm your email address${why}:
${confirmUrl}

If you don't complete your registration, ${held} on ${holdUntil}.

You are confirming:
${choices.map((l) => `- ${l}`).join('\n')}

To change anything, register again with the same address: the newest registration replaces this one. Once you have confirmed, every email has a link to view, change or cancel your registration.

If you did not register, please open this link to delete the registration:
${notMeUrl}${textFooter(b)}`;
	return { to: reg.email, subject, html, text };
}

export function instructionsEmail(
	b: Brand, ev: EventRow, reg: RegistrationRow, sessions: SessionRow[], instr: { subject: string; body_md: string }, manageUrl: string,
	cal?: CalendarBlock, attachments?: Attachment[], intro?: { html: string; text: string },
): OutgoingEmail {
	const st = statusLines(reg, sessions);
	const thanks = `Thank you for registering for the ${ev.title}, on ${ukDate(ev.starts_at, ev.timezone)}.`;
	const body = forAudience(instr.body_md, modeOf(reg));
	const html = layout(b, instr.subject, `
<p>Hello ${escapeHtml(reg.name)},</p>
${intro?.html ?? ''}
<p>${escapeHtml(thanks)}</p>
${st.map((l) => `<p><strong>${escapeHtml(l)}</strong></p>`).join('')}
${mdToHtml(body)}
${calendarHtml(cal, ev.timezone)}
${button(manageUrl, 'Manage my registration')}`);
	const text = `Hello ${reg.name},\n\n${intro ? `${intro.text}\n\n` : ''}${thanks}\n\n${st.join('\n')}\n\n${mdToText(body)}${calendarText(cal, ev.timezone)}\n\nView, change or cancel your registration: ${manageUrl}${textFooter(b)}`;
	return { to: reg.email, subject: instr.subject, html, text, attachments };
}

/** For someone who registers again with an address that is already confirmed. */
export function alreadyRegisteredIntro(ev: EventRow, reg: RegistrationRow) {
	const when = ukDateTime(reg.confirmed_at ?? reg.created_at, ev.timezone);
	const lines = [
		`You tried to register again, so here is a reminder: you are already registered for the ${ev.title}.`,
		`Name: ${reg.name}. Email: ${reg.email}. Registered: ${when}.`,
		'Your latest joining instructions follow.',
	];
	return { html: lines.map((l) => `<p>${escapeHtml(l)}</p>`).join(''), text: lines.join('\n') };
}

export function waitlistReminderEmail(b: Brand, ev: EventRow, reg: RegistrationRow, sessions: SessionRow[], manageUrl: string, justConfirmed = false): OutgoingEmail {
	const intro = justConfirmed
		? { html: `<p>Thank you for confirming your registration for the ${escapeHtml(ev.title)}.</p><p>Your latest joining instructions follow.</p>`, text: `Thank you for confirming your registration for the ${ev.title}.\nYour latest joining instructions follow.` }
		: alreadyRegisteredIntro(ev, reg);
	const st = statusLines(reg, sessions);
	const subject = `Your registration: ${ev.title}`;
	const html = layout(b, subject, `<p>Hello ${escapeHtml(reg.name)},</p>${intro.html.replace('Your latest joining instructions follow.', 'You will receive joining instructions if a place becomes available.')}${st.map((l) => `<p><strong>${escapeHtml(l)}</strong></p>`).join('')}${button(manageUrl, 'Manage my registration')}`);
	const text = `Hello ${reg.name},\n\n${intro.text.replace('Your latest joining instructions follow.', 'You will receive joining instructions if a place becomes available.')}\n\n${st.join('\n')}\n\nView, change or cancel your registration: ${manageUrl}${textFooter(b)}`;
	return { to: reg.email, subject, html, text };
}

/** What an entry was when last sent, for saying what changed. */
export interface SentEntry { summary: string; start: string; end: string; location: string }

/** One line per changed entry naming what actually changed, so an update never reads as "now <the same as before>". */
export function describeChange(e: CalEntry, was: SentEntry | undefined, tz: string): string {
	const hm = (iso: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));
	const when = `${ukDateTime(e.start, tz)} to ${hm(e.end)}`;
	if (!was) return `added: ${when}, ${e.location}`;
	const parts: string[] = [];
	if (Date.parse(was.start) !== Date.parse(e.start) || Date.parse(was.end) !== Date.parse(e.end)) parts.push(`now ${when}`);
	if (was.location !== e.location) parts.push(`${parts.length ? 'at' : 'now at'} ${e.location}`);
	if (was.summary !== e.summary) parts.push(`was "${was.summary}"`);
	return parts.join(', ') || 'details updated (see the attached invitation)';
}

export function calendarUpdateEmail(b: Brand, ev: EventRow, reg: RegistrationRow, changed: { entry: CalEntry; was?: SentEntry }[], cancelled: string[], cal: CalendarBlock, manageUrl: string, attachments: Attachment[]): OutgoingEmail {
	const subject = `Calendar update: ${ev.title}`;
	const lines = changed.map((c) => ({ summary: c.entry.summary, what: describeChange(c.entry, c.was, ev.timezone) }));
	const items = [
		...lines.map((l) => `<li><strong>${escapeHtml(l.summary)}</strong>: ${escapeHtml(l.what)}</li>`),
		...cancelled.map((s) => `<li><s>${escapeHtml(s)}</s> – removed from your calendar</li>`),
	].join('');
	const html = layout(b, subject, `<p>Hello ${escapeHtml(reg.name)},</p><p>Your calendar entries for the <strong>${escapeHtml(ev.title)}</strong> have changed:</p><ul>${items}</ul><p style="font-size:14px">The attached invitations update your calendar.</p>${calendarHtml(cal, ev.timezone)}${button(manageUrl, 'Manage my registration')}`);
	const text = `Hello ${reg.name},\n\nYour calendar entries for the ${ev.title} have changed:\n${lines.map((l) => `- ${l.summary}: ${l.what}`).join('\n')}${cancelled.length ? `\n${cancelled.map((s) => `- REMOVED: ${s}`).join('\n')}` : ''}\n\nThe attached invitations update your calendar.${calendarText(cal, ev.timezone)}\n\nView, change or cancel your registration: ${manageUrl}${textFooter(b)}`;
	return { to: reg.email, subject, html, text, attachments };
}

export function messageEmail(b: Brand, reg: RegistrationRow, msg: { subject: string; body_md: string }, manageUrl: string): OutgoingEmail {
	const html = layout(b, msg.subject, `<p>Hello ${escapeHtml(reg.name)},</p>${mdToHtml(msg.body_md)}<p style="font-size:14px;margin-top:24px"><a href="${escapeHtml(manageUrl)}">Manage or cancel my registration</a></p>`,
		'You are receiving this because you registered for an event. ');
	const text = `Hello ${reg.name},\n\n${mdToText(msg.body_md)}\n\nManage or cancel your registration: ${manageUrl}\n\nYou are receiving this because you registered for an event.${textFooter(b)}`;
	return { to: reg.email, subject: msg.subject, html, text };
}

export function cancellationEmail(b: Brand, ev: EventRow, reg: Pick<RegistrationRow, 'name' | 'email'>, eventUrl: string, attachments: Attachment[], byOrganiser = false): OutgoingEmail {
	const subject = `Registration cancelled: ${ev.title}`;
	const who = byOrganiser ? 'has been cancelled by the organisers' : 'has been cancelled';
	const ask = byOrganiser ? 'If you think this is a mistake, please reply to this email.' : 'If this was a mistake, you are welcome to';
	const html = layout(b, subject, `
<p>Hello ${escapeHtml(reg.name)},</p>
<p>Your registration for the <strong>${escapeHtml(ev.title)}</strong> ${who} and your details have been deleted.${attachments.length ? ' The attached cancellations remove the entries from your calendar.' : ''}</p>
<p>${byOrganiser ? escapeHtml(ask) : `If this was a mistake, you are welcome to <a href="${escapeHtml(eventUrl)}">register again</a> while registration is open.`}</p>`);
	const text = `Hello ${reg.name},\n\nYour registration for the ${ev.title} ${who} and your details have been deleted.${attachments.length ? ' The attached cancellations remove the entries from your calendar.' : ''}\n\n${byOrganiser ? ask : `If this was a mistake, you are welcome to register again while registration is open: ${eventUrl}`}${textFooter(b)}`;
	return { to: reg.email, subject, html, text, attachments };
}

/** After "I did not register": one last email, so the address owner knows it worked. Names nobody (the name was typed
 * by whoever registered the address) and invites nothing. */
export function declinedEmail(b: Brand, ev: EventRow, email: string): OutgoingEmail {
	const subject = `Registration deleted: ${ev.title}`;
	const html = layout(b, subject, `
<p>Hello,</p>
<p>The registration made with this address for the <strong>${escapeHtml(ev.title)}</strong> has been deleted, as you asked. You won't hear from us about it again.</p>
<p>Best regards</p>
<p>${escapeHtml(b.org)}</p>`);
	const text = `Hello,\n\nThe registration made with this address for the ${ev.title} has been deleted, as you asked. You won't hear from us about it again.\n\nBest regards\n\n${b.org}${textFooter(b)}`;
	return { to: email, subject, html, text };
}

export interface HostLine {
	id: string;
	name: string;
	detail: string; // e.g. 'in person', 'remote', 'waiting list'
	email?: string; // only when the registrant agreed to share it
}

/** Attendee list for a session host, with additions in bold and removals struck through. */
export function hostListEmail(b: Brand, ev: EventRow, s: SessionRow, current: HostLine[], added: Set<string>, removed: HostLine[], changedDetail: Set<string>): OutgoingEmail {
	const subject = `Attendee list changed: ${s.label}, ${ev.title}`;
	const row = (l: HostLine) => {
		const t = `${escapeHtml(l.name)} – ${escapeHtml(l.detail)}${l.email ? ` – <a href="mailto:${escapeHtml(l.email)}">${escapeHtml(l.email)}</a>` : ''}`;
		return `<li>${added.has(l.id) || changedDetail.has(l.id) ? `<strong>${t}</strong>${added.has(l.id) ? ' (new)' : ' (changed)'}` : t}</li>`;
	};
	const html = layout(b, subject, `
<p>Hello${s.host_name ? ` ${escapeHtml(s.host_name)}` : ''},</p>
<p>The list for <strong>${escapeHtml(s.label)}</strong> (${escapeHtml(ukDateTime(s.starts_at, ev.timezone))}) has changed. Changes are in <strong>bold</strong> (added or changed) or <s>struck through</s> (removed).</p>
<p><strong>${current.length}</strong> registered${s.capacity != null ? ` of ${s.capacity} places` : ''}:</p>
<ol>${current.map(row).join('')}</ol>
${removed.length ? `<p>Removed:</p><ul>${removed.map((l) => `<li><s>${escapeHtml(l.name)} – ${escapeHtml(l.detail)}</s></li>`).join('')}</ul>` : ''}
<p style="font-size:13px">Emails are shown only for people who agreed to share them with session hosts. If plans change at the last minute, please tell the organisers at ${escapeHtml(b.notify)} so they can reach everyone else. Please use this list only for this session, and delete it afterwards.</p>`);
	const text = `Hello${s.host_name ? ` ${s.host_name}` : ''},\n\nThe list for ${s.label} (${ukDateTime(s.starts_at, ev.timezone)}) has changed. Added or changed people are marked **like this**, removed people ~~like this~~.\n\n${current.length} registered${s.capacity != null ? ` of ${s.capacity} places` : ''}:\n${current.map((l, i) => {
		const t = `${l.name} – ${l.detail}${l.email ? ` – ${l.email}` : ''}`;
		return `${i + 1}. ${added.has(l.id) || changedDetail.has(l.id) ? `**${t}**` : t}`;
	}).join('\n')}${removed.length ? `\n\nRemoved:\n${removed.map((l) => `- ~~${l.name} – ${l.detail}~~`).join('\n')}` : ''}\n\nEmails are shown only for people who agreed to share them with session hosts. If plans change at the last minute, please tell the organisers at ${b.notify} so they can reach everyone else. Please use this list only for this session, and delete it afterwards.${textFooter(b)}`;
	return { to: s.host_email!, subject, html, text };
}

export function notification(b: Brand, subject: string, lines: string[]): OutgoingEmail {
	return { to: b.notify, subject: `[${b.org}] ${subject}`, text: lines.join('\n'), html: layout(b, subject, lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')) };
}

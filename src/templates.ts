// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import type { Attachment, OutgoingEmail } from './email';
import { type CalEntry, addLinks } from './ics';
import { mdToHtml, mdToText } from './markdown';
import { escapeHtml, ukDateTime } from './util';

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
}

export interface RegistrationRow {
	id: string;
	event_id: string;
	name: string;
	email: string;
	attendance: 'in_person' | 'remote';
	affiliation: string | null;
	needs: string | null;
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

export function statusLines(reg: RegistrationRow, sessions: SessionRow[]): string[] {
	const lines: string[] = [];
	if (reg.attendance === 'remote') lines.push('You are registered to join the talks remotely.');
	else if (reg.place === 'waitlist') lines.push('You are on the waiting list for an in-person place. We will email you if a place becomes available.');
	else lines.push('You have an in-person place.');
	if (reg.attendance === 'in_person' && reg.tour_id) {
		const t = sessions.find((x) => x.id === reg.tour_id);
		if (t) lines.push(reg.tour_place === 'waitlist' ? `You are on the waiting list for the ${t.label}.` : `You are booked on the ${t.label}.`);
	}
	return lines;
}

function calendarHtml(cal: CalendarBlock | undefined, tz: string): string {
	if (!cal || !cal.entries.length) return '';
	const items = cal.entries.map((e) => {
		const l = addLinks(e);
		return `<li><strong>${escapeHtml(e.summary)}</strong>, ${escapeHtml(ukDateTime(e.start, tz))}<br>
<span style="font-size:14px">Add to: <a href="${escapeHtml(l.google)}">Google</a> · <a href="${escapeHtml(l.outlook)}">Outlook.com</a> · <a href="${escapeHtml(l.office365)}">Office 365</a> · <a href="${escapeHtml(l.yahoo)}">Yahoo</a> · <a href="${escapeHtml(cal.icsUrl(e.key))}">Apple and others (.ics)</a></span></li>`;
	}).join('');
	return `<h2 style="font-size:18px">Your calendar</h2><p style="font-size:14px">Calendar invitations are attached; most email apps add them to your calendar automatically. Or use these links:</p><ul>${items}</ul>`;
}

function calendarText(cal: CalendarBlock | undefined, tz: string): string {
	if (!cal || !cal.entries.length) return '';
	return '\n\nYOUR CALENDAR (invitations attached)\n' + cal.entries.map((e) => {
		const l = addLinks(e);
		return `- ${e.summary}, ${ukDateTime(e.start, tz)}\n  Google: ${l.google}\n  Outlook.com: ${l.outlook}\n  Office 365: ${l.office365}\n  Yahoo: ${l.yahoo}\n  Apple and others (.ics): ${cal.icsUrl(e.key)}`;
	}).join('\n');
}

export function confirmEmail(b: Brand, ev: EventRow, reg: RegistrationRow, confirmUrl: string, manageUrl: string): OutgoingEmail {
	const subject = `Complete your registration: ${ev.title}`;
	const html = layout(b, subject, `
<h1 style="font-size:22px;margin-top:0">Please complete your registration</h1>
<p>Hello ${escapeHtml(reg.name)},</p>
<p>Thanks for registering for the <strong>${escapeHtml(ev.title)}</strong> on ${escapeHtml(ukDateTime(ev.starts_at, ev.timezone))}.</p>
<p><strong>Your registration is not complete yet.</strong> Please confirm your email address by clicking the button below. We are holding your place until ${escapeHtml(ukDateTime(reg.hold_expires_at ?? ev.deadline, ev.timezone))}; after that, an unconfirmed registration is deleted automatically.</p>
${button(confirmUrl, 'Complete registration')}
<p style="font-size:14px">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(confirmUrl)}">${escapeHtml(confirmUrl)}</a></p>
<p style="font-size:14px">You can view, change or cancel your registration at any time: <a href="${escapeHtml(manageUrl)}">manage my registration</a>.</p>
<p style="font-size:14px">If you did not register, ignore this email and the registration will be deleted.</p>`);
	const text = `Hello ${reg.name},

Thanks for registering for the ${ev.title} on ${ukDateTime(ev.starts_at, ev.timezone)}.

YOUR REGISTRATION IS NOT COMPLETE YET. Please confirm your email address by opening this link and clicking "Complete registration":
${confirmUrl}

We are holding your place until ${ukDateTime(reg.hold_expires_at ?? ev.deadline, ev.timezone)}; after that, an unconfirmed registration is deleted automatically.

View, change or cancel your registration: ${manageUrl}

If you did not register, ignore this email and the registration will be deleted.${textFooter(b)}`;
	return { to: reg.email, subject, html, text };
}

export function instructionsEmail(
	b: Brand, ev: EventRow, reg: RegistrationRow, sessions: SessionRow[], instr: { subject: string; body_md: string }, manageUrl: string,
	cal?: CalendarBlock, attachments?: Attachment[], intro?: { html: string; text: string },
): OutgoingEmail {
	const st = statusLines(reg, sessions);
	const html = layout(b, instr.subject, `
<p>Hello ${escapeHtml(reg.name)},</p>
${intro?.html ?? ''}
${st.map((l) => `<p><strong>${escapeHtml(l)}</strong></p>`).join('')}
${mdToHtml(instr.body_md)}
${calendarHtml(cal, ev.timezone)}
${button(manageUrl, 'Manage my registration')}`);
	const text = `Hello ${reg.name},\n\n${intro ? `${intro.text}\n\n` : ''}${st.join('\n')}\n\n${mdToText(instr.body_md)}${calendarText(cal, ev.timezone)}\n\nView, change or cancel your registration: ${manageUrl}${textFooter(b)}`;
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

export function waitlistReminderEmail(b: Brand, ev: EventRow, reg: RegistrationRow, sessions: SessionRow[], manageUrl: string): OutgoingEmail {
	const intro = alreadyRegisteredIntro(ev, reg);
	const st = statusLines(reg, sessions);
	const subject = `Your registration: ${ev.title}`;
	const html = layout(b, subject, `<p>Hello ${escapeHtml(reg.name)},</p>${intro.html.replace('Your latest joining instructions follow.', 'You will receive joining instructions if a place becomes available.')}${st.map((l) => `<p><strong>${escapeHtml(l)}</strong></p>`).join('')}${button(manageUrl, 'Manage my registration')}`);
	const text = `Hello ${reg.name},\n\n${intro.text.replace('Your latest joining instructions follow.', 'You will receive joining instructions if a place becomes available.')}\n\n${st.join('\n')}\n\nView, change or cancel your registration: ${manageUrl}${textFooter(b)}`;
	return { to: reg.email, subject, html, text };
}

export function calendarUpdateEmail(b: Brand, ev: EventRow, reg: RegistrationRow, changed: CalEntry[], cancelled: string[], cal: CalendarBlock, manageUrl: string, attachments: Attachment[]): OutgoingEmail {
	const subject = `Calendar update: ${ev.title}`;
	const items = [
		...changed.map((e) => `<li><strong>${escapeHtml(e.summary)}</strong>: now ${escapeHtml(ukDateTime(e.start, ev.timezone))}, ${escapeHtml(e.location)}</li>`),
		...cancelled.map((s) => `<li><s>${escapeHtml(s)}</s> – removed from your calendar</li>`),
	].join('');
	const html = layout(b, subject, `<p>Hello ${escapeHtml(reg.name)},</p><p>Your calendar entries for the <strong>${escapeHtml(ev.title)}</strong> have changed:</p><ul>${items}</ul><p style="font-size:14px">The attached invitations update your calendar.</p>${calendarHtml(cal, ev.timezone)}${button(manageUrl, 'Manage my registration')}`);
	const text = `Hello ${reg.name},\n\nYour calendar entries for the ${ev.title} have changed:\n${changed.map((e) => `- ${e.summary}: now ${ukDateTime(e.start, ev.timezone)}, ${e.location}`).join('\n')}${cancelled.length ? `\n${cancelled.map((s) => `- REMOVED: ${s}`).join('\n')}` : ''}\n\nThe attached invitations update your calendar.${calendarText(cal, ev.timezone)}\n\nView, change or cancel your registration: ${manageUrl}${textFooter(b)}`;
	return { to: reg.email, subject, html, text, attachments };
}

export function messageEmail(b: Brand, reg: RegistrationRow, msg: { subject: string; body_md: string }, manageUrl: string): OutgoingEmail {
	const html = layout(b, msg.subject, `<p>Hello ${escapeHtml(reg.name)},</p>${mdToHtml(msg.body_md)}<p style="font-size:14px;margin-top:24px"><a href="${escapeHtml(manageUrl)}">Manage or cancel my registration</a></p>`,
		'You are receiving this because you registered for an event. ');
	const text = `Hello ${reg.name},\n\n${mdToText(msg.body_md)}\n\nManage or cancel your registration: ${manageUrl}\n\nYou are receiving this because you registered for an event.${textFooter(b)}`;
	return { to: reg.email, subject: msg.subject, html, text };
}

export function cancellationEmail(b: Brand, ev: EventRow, reg: Pick<RegistrationRow, 'name' | 'email'>, eventUrl: string, attachments: Attachment[]): OutgoingEmail {
	const subject = `Registration cancelled: ${ev.title}`;
	const html = layout(b, subject, `
<p>Hello ${escapeHtml(reg.name)},</p>
<p>Your registration for the <strong>${escapeHtml(ev.title)}</strong> has been cancelled and your details have been deleted.${attachments.length ? ' The attached cancellations remove the entries from your calendar.' : ''}</p>
<p>If this was a mistake, you are welcome to <a href="${escapeHtml(eventUrl)}">register again</a> while registration is open.</p>`);
	const text = `Hello ${reg.name},\n\nYour registration for the ${ev.title} has been cancelled and your details have been deleted.${attachments.length ? ' The attached cancellations remove the entries from your calendar.' : ''}\n\nIf this was a mistake, you are welcome to register again while registration is open: ${eventUrl}${textFooter(b)}`;
	return { to: reg.email, subject, html, text, attachments };
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
<p style="font-size:13px">Emails are shown only for people who agreed to share them with session hosts. Please use this list only for this session, and delete it afterwards.</p>`);
	const text = `The list for ${s.label} (${ukDateTime(s.starts_at, ev.timezone)}) has changed. Added or changed people are marked **like this**, removed people ~~like this~~.\n\n${current.length} registered${s.capacity != null ? ` of ${s.capacity} places` : ''}:\n${current.map((l, i) => {
		const t = `${l.name} – ${l.detail}${l.email ? ` – ${l.email}` : ''}`;
		return `${i + 1}. ${added.has(l.id) || changedDetail.has(l.id) ? `**${t}**` : t}`;
	}).join('\n')}${removed.length ? `\n\nRemoved:\n${removed.map((l) => `- ~~${l.name} – ${l.detail}~~`).join('\n')}` : ''}\n\nEmails are shown only for people who agreed to share them with session hosts. Please use this list only for this session, and delete it afterwards.${textFooter(b)}`;
	return { to: s.host_email!, subject, html, text };
}

export function notification(b: Brand, subject: string, lines: string[]): OutgoingEmail {
	return { to: b.notify, subject: `[${b.org}] ${subject}`, text: lines.join('\n'), html: layout(b, subject, lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')) };
}

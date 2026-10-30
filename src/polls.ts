// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import { type Env, siteUrl } from './env';
import { sendEmail } from './email';
import { brand, getEvent, getRegistration, UserError } from './rsvp';
import { suggestionEmail, type EventRow } from './templates';
import { suggestionRef } from './tokens';
import { cleanLine, nowIso, randomToken } from './util';

/**
 * Polls ("What shall we do on Saturday?"). Each registrant ranks the options from most to least wanted and puts a line
 * under the ones they would join: below it, they would rather stay at home. They can suggest an option of their own;
 * it is theirs alone to rank until an organiser adds it for everyone (as written, or reworded) or turns it down.
 */

export interface PollRow {
	id: string;
	event_id: string;
	question: string;
	allow_suggestions: number;
	closes_at: string | null;
	sort: number;
	created_at: string;
}

export interface OptionRow {
	id: string;
	poll_id: string;
	label: string;
	status: 'active' | 'pending' | 'rejected';
	suggested_by: string | null;
	suggested_label: string | null;
	merged_into: string | null;
	sort: number;
	created_at: string;
	decided_at: string | null;
	decided_by: string | null;
}

interface BallotRow { poll_id: string; registration_id: string; ranking: string; bar: number; updated_at: string }

const MAX_OPTIONS = 50;
const MAX_PENDING_PER_PERSON = 3;
const MAX_SUGGESTIONS_PER_PERSON = 10;
const LABEL_MAX = 80;

/** Open until closes_at, or until the event ends. */
export const pollOpen = (p: PollRow, ev: EventRow, now = Date.now()) => now < Date.parse(p.closes_at ?? ev.ends_at);

/** Labels compare without case or extra spaces, so "Hiking" and " hiking " are the same option. */
const same = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

function parseRanking(s: string): string[] {
	try {
		const v = JSON.parse(s);
		return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
	} catch {
		return [];
	}
}

export async function getPolls(env: Env, eventId: string) {
	return (await env.DB.prepare('SELECT * FROM polls WHERE event_id = ? ORDER BY sort, created_at').bind(eventId).all<PollRow>()).results;
}
async function getPoll(env: Env, id: string) {
	const p = await env.DB.prepare('SELECT * FROM polls WHERE id = ?').bind(id).first<PollRow>();
	if (!p) throw new UserError('Unknown poll.', 404);
	return p;
}
async function getOptions(env: Env, pollId: string) {
	return (await env.DB.prepare('SELECT * FROM poll_options WHERE poll_id = ? ORDER BY sort, created_at').bind(pollId).all<OptionRow>()).results;
}
async function getOption(env: Env, id: string) {
	const o = await env.DB.prepare('SELECT * FROM poll_options WHERE id = ?').bind(id).first<OptionRow>();
	if (!o) throw new UserError('Unknown option.', 404);
	return o;
}
async function getBallots(env: Env, pollId: string) {
	// Confirmed registrations only: a booking-form ranking counts once its address is confirmed, so made-up addresses
	// cannot sway the totals while their holds last.
	return (await env.DB.prepare(`SELECT b.* FROM poll_ballots b JOIN registrations r ON r.id = b.registration_id AND r.status = 'confirmed' WHERE b.poll_id = ?`).bind(pollId).all<BallotRow>()).results;
}

export interface TallyRow { id: string; label: string; willing: number; out: number; first: number; score: number; names?: string[] }

/**
 * For each active option: how many would join (above their line), how many would stay at home (below it), how many
 * put it first, and a preference score (among the options above someone's line, the top one of k scores k, the next
 * k-1, and so on). Sorted by who would join, then by score: the option that gets the most people out, preferring the
 * one they like best. Someone who has not ranked an option since it was added counts for neither.
 */
export function tally(options: OptionRow[], ballots: Pick<BallotRow, 'registration_id' | 'ranking' | 'bar'>[], names?: Map<string, string>) {
	const rows = new Map<string, TallyRow>(options.filter((o) => o.status === 'active').map((o) => [o.id, { id: o.id, label: o.label, willing: 0, out: 0, first: 0, score: 0, ...(names ? { names: [] } : {}) }]));
	let nothing = 0;
	for (const b of ballots) {
		const { above, below } = resolve(b, options, (o) => o.status === 'active');
		// Someone whose only choice above the line is their own suggestion, still waiting, is not "none of them".
		if (!above.length && !resolve(b, options, (o) => o.status === 'pending').above.length) nothing++;
		above.forEach((id, i) => {
			const r = rows.get(id)!;
			r.willing++;
			r.score += above.length - i;
			if (i === 0) r.first++;
			const n = names?.get(b.registration_id);
			if (n) r.names!.push(n);
		});
		for (const id of below) rows.get(id)!.out++;
	}
	for (const r of rows.values()) r.names?.sort((a, b) => a.localeCompare(b));
	const results = [...rows.values()].sort((a, b) => b.willing - a.willing || b.score - a.score || a.label.localeCompare(b.label));
	return { voters: ballots.length, nothing, results };
}

/**
 * A ballot as it stands now, split at the line. Ballots are rewritten when suggestions are merged, turned down or
 * removed, but a ranking saved at the same moment can miss that rewrite (D1 has no row locks), so it is also resolved
 * on every read: a suggestion merged since counts for the option it was merged into, at its higher place, and
 * anything else no longer listed is skipped.
 */
function resolve(b: Pick<BallotRow, 'ranking' | 'bar'>, options: OptionRow[], keep: (o: OptionRow) => boolean) {
	const byId = new Map(options.map((o) => [o.id, o]));
	const above: string[] = [], below: string[] = [];
	parseRanking(b.ranking).forEach((id, i) => {
		const o = byId.get(id);
		const t = o?.status === 'rejected' && o.merged_into ? byId.get(o.merged_into) : o;
		if (!t || !keep(t) || above.includes(t.id) || below.includes(t.id)) return;
		(i < b.bar ? above : below).push(t.id);
	});
	return { above, below };
}

// ---------- registrants (through their manage link) ----------

/** What a registrant sees: active options, their own suggestions, their ballot, and the totals once they have voted. */
export async function voterPolls(env: Env, regId: string, ev: EventRow) {
	const out = [];
	for (const p of await getPolls(env, ev.id)) {
		const options = await getOptions(env, p.id);
		const ballots = await getBallots(env, p.id);
		const mine = ballots.find((b) => b.registration_id === regId);
		const visible = options.filter((o) => o.status === 'active' || (o.status === 'pending' && o.suggested_by === regId));
		const label = (id: string | null) => options.find((o) => o.id === id)?.label ?? '';
		// What became of this person's suggestions, in words: they are not emailed about it.
		const notes = options.filter((o) => o.suggested_by === regId && o.status !== 'pending').map((o) =>
			o.status === 'active' ? (o.suggested_label && o.suggested_label !== o.label ? `Your suggestion "${o.suggested_label}" was added for everyone as "${o.label}".` : `Your suggestion "${o.label}" was added for everyone.`)
			: o.merged_into && label(o.merged_into) ? `Your suggestion "${o.label}" is already an option, as "${label(o.merged_into)}", so your vote counts for that.` : `Your suggestion "${o.label}" was not added.`);
		out.push({
			id: p.id, question: p.question, open: pollOpen(p, ev), allow_suggestions: !!p.allow_suggestions, closes_at: p.closes_at ?? ev.ends_at,
			options: visible.map((o) => ({ id: o.id, label: o.label, pending: o.status === 'pending', mine: o.suggested_by === regId })),
			ballot: mine ? (({ above, below }) => ({ ranking: [...above, ...below], bar: above.length }))(resolve(mine, options, (o) => visible.includes(o))) : null,
			notes,
			results: mine ? tally(options, ballots).results.map(({ label, willing, out }) => ({ label, willing, out })) : null,
		});
	}
	return out;
}

async function voter(env: Env, regId: string, pollId: unknown) {
	const reg = await getRegistration(env, regId);
	if (!reg) throw new UserError('This registration no longer exists.', 404);
	if (reg.status !== 'confirmed') throw new UserError('Please confirm your email address first, using the link in your registration email.', 403);
	const poll = await getPoll(env, String(pollId ?? ''));
	if (poll.event_id !== reg.event_id) throw new UserError('Unknown poll.', 404);
	const ev = await getEvent(env, reg.event_id);
	if (!pollOpen(poll, ev)) throw new UserError('This poll has closed.', 409);
	return { reg, poll, ev };
}

/** Open polls with their options, for the booking form (no suggestions there: the address is not confirmed yet). */
export async function bookingPolls(env: Env, ev: EventRow) {
	const out = [];
	for (const p of (await getPolls(env, ev.id)).filter((x) => pollOpen(x, ev))) {
		const options = (await getOptions(env, p.id)).filter((o) => o.status === 'active');
		if (options.length) out.push({ id: p.id, question: p.question, options: options.map((o) => ({ id: o.id, label: o.label })) });
	}
	return out;
}

type BallotInput = { poll: string; ranking: string[]; bar: number };

/**
 * Rankings sent with a registration, checked before anything is saved. Malformed input is refused; a ranking that is
 * merely out of date (the poll closed, or an option went, while the form was open) is dropped, as the poll is optional
 * and the registration matters more.
 */
export async function parseBookingBallots(env: Env, ev: EventRow, v: unknown): Promise<BallotInput[]> {
	if (v === undefined || v === null) return [];
	if (!Array.isArray(v) || v.length > 20) throw new UserError('Invalid poll answers.');
	const polls = await bookingPolls(env, ev);
	const out: BallotInput[] = [];
	for (const raw of v as Record<string, unknown>[]) {
		const ranking = Array.isArray(raw?.ranking) && raw.ranking.length <= MAX_OPTIONS ? raw.ranking.map(String) : null;
		const bar = Number(raw?.bar);
		if (typeof raw?.poll !== 'string' || out.some((x) => x.poll === raw.poll) || !ranking || new Set(ranking).size !== ranking.length || !Number.isInteger(bar) || bar < 0 || bar > ranking.length) {
			throw new UserError('Invalid poll answers.');
		}
		const p = polls.find((x) => x.id === raw.poll);
		if (p && ranking.every((id) => p.options.some((o) => o.id === id))) out.push({ poll: p.id, ranking, bar });
	}
	return out;
}

export async function saveBookingBallots(env: Env, regId: string, ballots: BallotInput[]) {
	if (!ballots.length) return;
	await env.DB.batch(ballots.map((b) => env.DB.prepare('INSERT OR REPLACE INTO poll_ballots (poll_id, registration_id, ranking, bar, updated_at) VALUES (?,?,?,?,?)')
		.bind(b.poll, regId, JSON.stringify(b.ranking), b.bar, nowIso())));
}

/** Questions of the open polls this person has not answered, for a line in the emails they get anyway. */
export async function unansweredPolls(env: Env, ev: EventRow, regId: string) {
	const rows = (await env.DB.prepare(
		`SELECT p.* FROM polls p WHERE p.event_id = ? AND NOT EXISTS (SELECT 1 FROM poll_ballots b WHERE b.poll_id = p.id AND b.registration_id = ?)
		 AND EXISTS (SELECT 1 FROM poll_options o WHERE o.poll_id = p.id AND o.status = 'active') ORDER BY p.sort, p.created_at`,
	).bind(ev.id, regId).all<PollRow>()).results;
	return rows.filter((p) => pollOpen(p, ev)).map((p) => p.question);
}

/** Saves a ranking: option ids, most wanted first, and how many of them (from the top) the person would join. */
export async function saveBallot(env: Env, regId: string, input: Record<string, unknown>) {
	const { reg, poll, ev } = await voter(env, regId, input.poll);
	const options = await getOptions(env, poll.id);
	const allowed = new Set(options.filter((o) => o.status === 'active' || (o.status === 'pending' && o.suggested_by === regId)).map((o) => o.id));
	const ranking = Array.isArray(input.ranking) ? input.ranking.map(String) : null;
	if (!ranking || ranking.length > MAX_OPTIONS || new Set(ranking).size !== ranking.length || ranking.some((id) => !allowed.has(id))) {
		throw new UserError('The options have changed since this page was loaded. Please reload it and try again.', 409);
	}
	const bar = Number(input.bar);
	if (!Number.isInteger(bar) || bar < 0 || bar > ranking.length) throw new UserError('Invalid position for the line.');
	await env.DB.prepare(
		`INSERT INTO poll_ballots (poll_id, registration_id, ranking, bar, updated_at) VALUES (?,?,?,?,?)
		 ON CONFLICT (poll_id, registration_id) DO UPDATE SET ranking = excluded.ranking, bar = excluded.bar, updated_at = excluded.updated_at`,
	).bind(poll.id, reg.id, JSON.stringify(ranking), bar, nowIso()).run();
	return { ok: true as const, polls: await voterPolls(env, reg.id, ev) };
}

/**
 * A registrant's own option. It is theirs to rank straight away; the organiser is emailed to add it for everyone or
 * not. A label that is already an option returns that option instead, and nobody is emailed.
 */
export async function suggestOption(env: Env, regId: string, input: Record<string, unknown>) {
	const { reg, poll, ev } = await voter(env, regId, input.poll);
	if (!poll.allow_suggestions) throw new UserError('This poll does not take suggestions.', 409);
	const label = cleanLine(input.label, LABEL_MAX);
	if (!label) throw new UserError('Please say what you would like to suggest.');
	const options = await getOptions(env, poll.id);
	const existing = options.find((o) => same(o.label, label) && (o.status === 'active' || (o.status === 'pending' && o.suggested_by === reg.id)));
	if (existing) return { ok: true as const, option: { id: existing.id, label: existing.label, pending: existing.status === 'pending', mine: existing.suggested_by === reg.id }, existing: true, polls: await voterPolls(env, reg.id, ev) };
	const own = options.filter((o) => o.suggested_by === reg.id);
	if (own.filter((o) => o.status === 'pending').length >= MAX_PENDING_PER_PERSON) throw new UserError('You have several suggestions waiting for the organisers. Please wait until they have looked at those.', 429);
	if (own.length >= MAX_SUGGESTIONS_PER_PERSON) throw new UserError('You have made as many suggestions as this poll allows.', 429);
	if (options.filter((o) => o.status !== 'rejected').length >= MAX_OPTIONS) throw new UserError('This poll has as many options as it can take.', 409);
	const id = randomToken(12);
	// The limits again inside the insert: parallel requests could all pass the checks above before any of them inserts.
	const ins = await env.DB.prepare(
		`INSERT INTO poll_options (id, poll_id, label, status, suggested_by, suggested_label, sort, created_at) SELECT ?1, ?2, ?3, 'pending', ?4, ?3, ?5, ?6
		 WHERE (SELECT COUNT(*) FROM poll_options WHERE poll_id = ?2 AND suggested_by = ?4 AND status = 'pending') < ?7
		   AND (SELECT COUNT(*) FROM poll_options WHERE poll_id = ?2 AND suggested_by = ?4) < ?8
		   AND (SELECT COUNT(*) FROM poll_options WHERE poll_id = ?2 AND status != 'rejected') < ?9`,
	).bind(id, poll.id, label, reg.id, Math.max(0, ...options.map((o) => o.sort)) + 1, nowIso(), MAX_PENDING_PER_PERSON, MAX_SUGGESTIONS_PER_PERSON, MAX_OPTIONS).run();
	if (!ins.meta.changes) throw new UserError('You have several suggestions waiting for the organisers. Please wait until they have looked at those.', 429);
	try {
		await sendEmail(env, suggestionEmail(brand(env), {
			who: reg.name, label, question: poll.question, eventTitle: ev.title, ref: await suggestionRef(env, id),
			adminUrl: adminPollsUrl(env, ev.id), replyTo: env.POLL_REPLY_EMAIL || undefined,
		}));
	} catch (e) {
		// The suggestion still waits on the admin page; the registrant need not see an error for the organiser's email.
		console.error('suggestion email failed', id, e);
	}
	return { ok: true as const, option: { id, label, pending: true, mine: true }, existing: false, polls: await voterPolls(env, reg.id, ev) };
}

export const adminPollsUrl = (env: Env, eventId: string) => `${siteUrl(env)}/admin/rsvps/?event=${encodeURIComponent(eventId)}#polls`;

// ---------- organisers ----------

/** Rewrites every ballot of a poll, keeping each person's line in the same place relative to what stays above it. */
async function rewriteBallots(env: Env, pollId: string, fn: (ranking: string[]) => string[]) {
	// A ranking saved between the read and the write wins; it is tried again from a fresh read (see also resolve()).
	for (let attempt = 0; attempt < 3 && !(await rewriteOnce(env, pollId, fn)); attempt++);
}
async function rewriteOnce(env: Env, pollId: string, fn: (ranking: string[]) => string[]) {
	const stmts = [];
	for (const b of await getBallots(env, pollId)) {
		const ranking = parseRanking(b.ranking);
		const above = fn(ranking.slice(0, b.bar));
		const below = fn(ranking.slice(b.bar)).filter((id) => !above.includes(id));
		const next = [...above, ...below];
		if (JSON.stringify(next) === JSON.stringify(ranking) && above.length === b.bar) continue;
		stmts.push(env.DB.prepare('UPDATE poll_ballots SET ranking = ?, bar = ? WHERE poll_id = ? AND registration_id = ? AND ranking = ? AND bar = ?')
			.bind(JSON.stringify(next), above.length, pollId, b.registration_id, b.ranking, b.bar));
	}
	const results = stmts.length ? await env.DB.batch(stmts) : [];
	return results.every((r) => r.meta.changes === 1);
}

export type Decision = { decision: 'add' } | { decision: 'reject' } | { decision: 'use'; label: string };

/**
 * An organiser's answer to a suggestion: add it as written, turn it down, or add it in their own words. Wording that
 * matches an existing option merges the suggestion into it, so everyone who ranked the suggestion keeps their ranking
 * for that option. Only a pending suggestion can be decided; a second answer reports the first.
 */
export async function decideSuggestion(env: Env, optionId: string, d: Decision, by: string) {
	const o = await getOption(env, optionId);
	const options = await getOptions(env, o.poll_id);
	const describe = (x: OptionRow) => x.status === 'active' ? `added as "${x.label}"` : x.merged_into ? `merged into "${options.find((y) => y.id === x.merged_into)?.label ?? 'another option'}"` : 'not added';
	if (o.status !== 'pending') return { ok: true as const, already: true, outcome: describe(o), option: o };
	const now = nowIso();
	let label = o.label, merged: OptionRow | undefined;
	if (d.decision === 'use') {
		const l = cleanLine(d.label, LABEL_MAX);
		if (!l) throw new UserError('Please give the wording to use.');
		label = l;
		merged = options.find((x) => x.status === 'active' && same(x.label, l));
	} else if (d.decision === 'add') {
		merged = options.find((x) => x.status === 'active' && same(x.label, o.label));
	}
	// Each update checks the option is still pending, so two answers at once (an email and the admin page) apply once.
	let r;
	if (d.decision === 'reject' || merged) {
		r = await env.DB.prepare(`UPDATE poll_options SET status = 'rejected', merged_into = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'`)
			.bind(merged?.id ?? null, now, by, o.id).run();
	} else {
		r = await env.DB.prepare(`UPDATE poll_options SET status = 'active', label = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'`).bind(label, now, by, o.id).run();
	}
	if (!r.meta.changes) return decideSuggestion(env, optionId, d, by);
	if (merged) await rewriteBallots(env, o.poll_id, (ids) => [...new Set(ids.map((id) => (id === o.id ? merged!.id : id)))]);
	else if (d.decision === 'reject') await rewriteBallots(env, o.poll_id, (ids) => ids.filter((id) => id !== o.id));
	const after = await getOption(env, o.id);
	return { ok: true as const, already: false, outcome: describe(after), option: after };
}

export async function adminPolls(env: Env, eventId: string) {
	const ev = await getEvent(env, eventId);
	const names = new Map((await env.DB.prepare('SELECT id, name FROM registrations WHERE event_id = ?').bind(ev.id).all<{ id: string; name: string }>()).results.map((r) => [r.id, r.name]));
	const polls = [];
	for (const p of await getPolls(env, ev.id)) {
		const options = await getOptions(env, p.id);
		polls.push({
			...p, open: pollOpen(p, ev), allow_suggestions: !!p.allow_suggestions,
			options: options.map((o) => ({ ...o, suggested_by_name: o.suggested_by ? names.get(o.suggested_by) ?? null : null })),
			tally: tally(options, await getBallots(env, p.id), names),
		});
	}
	return { ok: true as const, polls };
}

const labelsFrom = (v: unknown) => {
	const raw = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split('\n') : [];
	const out: string[] = [];
	for (const l of raw.map((x) => cleanLine(x, LABEL_MAX)).filter((x): x is string => !!x)) if (!out.some((y) => same(y, l))) out.push(l);
	return out;
};
const optDate = (v: unknown) => {
	if (v === null || v === undefined || v === '') return null;
	const t = Date.parse(String(v));
	if (Number.isNaN(t)) throw new UserError('Invalid closing time.');
	return new Date(t).toISOString();
};

/** Organiser actions. None of them emails anyone: registrants see changes when they next open their registration. */
export async function adminPollAction(env: Env, input: Record<string, unknown>) {
	const now = nowIso();
	switch (input.action) {
		case 'create': {
			const ev = await getEvent(env, String(input.event ?? ''));
			const question = cleanLine(input.question, 200);
			if (!question) throw new UserError('Please write the question.');
			const labels = labelsFrom(input.options);
			if (labels.length > MAX_OPTIONS) throw new UserError(`A poll can have up to ${MAX_OPTIONS} options.`);
			const id = randomToken(12);
			const sort = ((await env.DB.prepare('SELECT MAX(sort) AS s FROM polls WHERE event_id = ?').bind(ev.id).first<{ s: number | null }>())?.s ?? 0) + 1;
			await env.DB.batch([
				env.DB.prepare('INSERT INTO polls (id, event_id, question, allow_suggestions, closes_at, sort, created_at) VALUES (?,?,?,?,?,?,?)')
					.bind(id, ev.id, question, input.allow_suggestions === false ? 0 : 1, optDate(input.closes_at), sort, now),
				...labels.map((l, i) => env.DB.prepare(`INSERT INTO poll_options (id, poll_id, label, status, sort, created_at) VALUES (?,?,?,'active',?,?)`).bind(randomToken(12), id, l, i + 1, now)),
			]);
			return { ok: true as const, id };
		}
		case 'update': {
			const p = await getPoll(env, String(input.poll ?? ''));
			const question = input.question === undefined ? p.question : cleanLine(input.question, 200);
			if (!question) throw new UserError('Please write the question.');
			const closes = input.closes_at === undefined ? p.closes_at : optDate(input.closes_at);
			const allow = input.allow_suggestions === undefined ? p.allow_suggestions : input.allow_suggestions === false ? 0 : 1;
			await env.DB.prepare('UPDATE polls SET question = ?, closes_at = ?, allow_suggestions = ? WHERE id = ?').bind(question, closes, allow, p.id).run();
			return { ok: true as const };
		}
		case 'delete': {
			const p = await getPoll(env, String(input.poll ?? ''));
			await env.DB.prepare('DELETE FROM polls WHERE id = ?').bind(p.id).run();
			return { ok: true as const };
		}
		case 'add_option': {
			const p = await getPoll(env, String(input.poll ?? ''));
			const label = cleanLine(input.label, LABEL_MAX);
			if (!label) throw new UserError('Please write the option.');
			const options = await getOptions(env, p.id);
			if (options.some((o) => o.status === 'active' && same(o.label, label))) throw new UserError('That is already an option.', 409);
			if (options.filter((o) => o.status !== 'rejected').length >= MAX_OPTIONS) throw new UserError(`A poll can have up to ${MAX_OPTIONS} options.`);
			const id = randomToken(12);
			await env.DB.prepare(`INSERT INTO poll_options (id, poll_id, label, status, sort, created_at) VALUES (?,?,?,'active',?,?)`)
				.bind(id, p.id, label, Math.max(0, ...options.map((o) => o.sort)) + 1, now).run();
			return { ok: true as const, id };
		}
		case 'rename_option': {
			const o = await getOption(env, String(input.option ?? ''));
			if (o.status !== 'active') throw new UserError('Only options on the list can be renamed; decide a suggestion instead.', 409);
			const label = cleanLine(input.label, LABEL_MAX);
			if (!label) throw new UserError('Please write the option.');
			if ((await getOptions(env, o.poll_id)).some((x) => x.id !== o.id && x.status === 'active' && same(x.label, label))) throw new UserError('That is already an option.', 409);
			await env.DB.prepare('UPDATE poll_options SET label = ? WHERE id = ?').bind(label, o.id).run();
			return { ok: true as const };
		}
		case 'remove_option': {
			// Taken off everyone's ranking too, each person's line moving up with it.
			// Deleted first, so a ranking saved meanwhile can no longer include it.
			const o = await getOption(env, String(input.option ?? ''));
			await env.DB.prepare('DELETE FROM poll_options WHERE id = ?').bind(o.id).run();
			await rewriteBallots(env, o.poll_id, (ids) => ids.filter((id) => id !== o.id));
			return { ok: true as const };
		}
		case 'decide': {
			const decision = input.decision === 'reject' ? { decision: 'reject' as const }
				: input.decision === 'use' ? { decision: 'use' as const, label: String(input.label ?? '') }
				: input.decision === 'add' ? { decision: 'add' as const } : null;
			if (!decision) throw new UserError('Unknown decision.');
			return decideSuggestion(env, String(input.option ?? ''), decision, `${String(input.by ?? 'admin')} (admin page)`);
		}
		default:
			throw new UserError('Unknown action.');
	}
}

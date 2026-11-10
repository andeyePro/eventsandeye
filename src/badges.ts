// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import type { Env } from './env';
import { modeOf } from './mode';
import type { RegistrationRow } from './templates';

/**
 * Name badges. The server decides who gets a named badge and in what order; the admin page lays the badges out on
 * label sheets and opens a print page (HTML with CSS @page, printed or saved as PDF by the browser), so no PDF
 * library is needed and the logo, read from a file on the organiser's computer, is never uploaded.
 */

/** A label sheet, in millimetres: the sheet, the grid of badges on it, and where the grid starts. */
export interface BadgeGeometry {
	sheet_w: number; sheet_h: number;
	cols: number; rows: number;
	badge_w: number; badge_h: number;
	margin_top: number; margin_left: number;
	gap_x: number; gap_y: number;
}
export interface BadgePreset extends BadgeGeometry {
	id: string;
	label: string;
	/** Cut lines on by default: plain paper has to be cut; perforated inserts and labels do not. */
	guides: boolean;
	/** Where the geometry comes from, so it can be checked again. */
	source: string;
}

const inch = (x: number) => Math.round(x * 25.4 * 1000) / 1000;

/**
 * Only sheets whose layout could be checked. The Avery 4822 holders take Avery's L4728 micro-perforated inserts:
 * 90 × 60 mm, 8 to an A4 sheet. Eight of them fit portrait A4 only as 2 across and 4 down, and perforated cards are
 * butted together, so the grid is centred with no gaps: 15 mm at each side, 28.5 mm at top and bottom. Avery's own
 * template page could not be reached to confirm the margins, hence the README's advice to test on plain paper first.
 */
export const BADGE_PRESETS: BadgePreset[] = [
	{
		id: 'plain-a4', label: 'Plain A4, 1 per page (148 × 105 mm)', guides: true,
		sheet_w: 210, sheet_h: 297, cols: 1, rows: 1, badge_w: 148, badge_h: 105, margin_top: 20, margin_left: 31, gap_x: 0, gap_y: 0,
		source: 'A6 landscape, centred across the page',
	},
	{
		id: 'plain-letter', label: 'Plain US Letter, 1 per page (6 × 4 in)', guides: true,
		sheet_w: inch(8.5), sheet_h: inch(11), cols: 1, rows: 1, badge_w: inch(6), badge_h: inch(4), margin_top: inch(1), margin_left: inch(1.25), gap_x: 0, gap_y: 0,
		source: '6 × 4 in, centred across the page',
	},
	{
		id: 'avery-4822', label: 'Avery 4822 / L4728 (90 × 60 mm, 8 per A4)', guides: false,
		sheet_w: 210, sheet_h: 297, cols: 2, rows: 4, badge_w: 90, badge_h: 60, margin_top: 28.5, margin_left: 15, gap_x: 0, gap_y: 0,
		source: 'Avery L4728: 90 × 60 mm, 8 per A4 sheet, for the 4822 holders; grid centred, no gaps (margins worked out, not published)',
	},
	{
		id: 'avery-l4785', label: 'Avery L4785 labels (80 × 50 mm, 10 per A4)', guides: false,
		sheet_w: 210, sheet_h: 297, cols: 2, rows: 5, badge_w: 80, badge_h: 50, margin_top: 13, margin_left: 18, gap_x: 15, gap_y: 5,
		source: 'gLabels template database (avery-iso-templates.xml, L4785, also L4784, L4786 and L4787)',
	},
	{
		id: 'avery-5395', label: 'Avery 5395 labels (3⅜ × 2⅓ in, 8 per Letter)', guides: false,
		sheet_w: inch(8.5), sheet_h: inch(11), cols: 2, rows: 4, badge_w: inch(3.375), badge_h: inch(7 / 3), margin_top: inch(7 / 12), margin_left: inch(0.6875), gap_x: inch(0.375), gap_y: inch(1 / 6),
		source: 'gLabels template database (avery-us-templates.xml, 5395, also 8395 and 15395)',
	},
];
/** Events&I's own default; a site sets BADGE_TEMPLATE to the sheets it has bought. */
export const DEFAULT_BADGE_TEMPLATE = 'plain-a4';

/** Who gets a named badge: confirmed, coming in person, with a place in the room. Not the waiting list, not remote
 * attendees, not people coming only to opt-in sessions (no place in the room), not unconfirmed registrations. */
export const wantsBadge = (r: Pick<RegistrationRow, 'status' | 'attendance' | 'place'>) => r.status === 'confirmed' && modeOf(r) === 'in_person' && r.place === 'place';

/** Particles that belong with the family name when typed in lower case ("Ludwig van Beethoven", "Maria de la Cruz").
 * Only in lower case: "Van" or "De" with a capital is more often a given name, or the start of a family name typed as
 * the person writes it, which the last-word rule already keeps. */
const PARTICLES = new Set(['van', 'von', 'der', 'den', 'de', 'del', 'della', 'di', 'da', 'du', 'dos', 'das', 'do', 'la', 'le', 'ter', 'ten', 'bin', 'binti', 'al', 'el', 'zu', 'y']);

/**
 * A name typed in one box, split into given and family names for the badge: the family name is the last word, with
 * any lower-case particles before it. It is a guess (a Spanish double family name without "y" loses its first half,
 * say), so the print page lets the organiser correct it. One word is all given name.
 */
export function splitName(name: string) {
	const w = name.trim().split(/\s+/).filter(Boolean);
	if (w.length < 2) return { given: w[0] ?? '', family: '' };
	let i = w.length - 1;
	while (i > 1 && PARTICLES.has(w[i - 1])) i--;
	return { given: w.slice(0, i).join(' '), family: w.slice(i).join(' ') };
}
const collate = new Intl.Collator('en-GB', { sensitivity: 'base', numeric: true });

/** Named badges, by family name then given name. Names are kept exactly as typed: never re-cased. */
export function badgePeople(regs: Pick<RegistrationRow, 'status' | 'attendance' | 'place' | 'name' | 'affiliation' | 'no_images'>[]) {
	return regs.filter(wantsBadge)
		.map((r) => ({ ...splitName(r.name), affiliation: r.affiliation?.trim() || null, no_images: !!r.no_images }))
		.sort((a, b) => collate.compare(a.family || a.given, b.family || b.given) || collate.compare(a.given, b.given));
}

const COLOUR_RE = /^#[0-9a-fA-F]{6}$/;
/** A font family name goes into CSS, so only plain names. */
const FONT_NAME_RE = /^[A-Za-z0-9 _-]{1,60}$/;

/** What the admin page needs for badges: the people, how many blanks would fill the room, and the site's defaults. */
export function badgeSummary(env: Env, ev: { in_person_max: number }, regs: Parameters<typeof badgePeople>[0]) {
	const people = badgePeople(regs);
	const set = env.BADGE_TEMPLATE?.trim() || '';
	const known = BADGE_PRESETS.some((p) => p.id === set);
	const colour = env.BADGE_COLOUR?.trim() || '';
	const family = env.BADGE_FONT_FAMILY?.trim() || '';
	const fontUrl = env.BADGE_FONT_URL?.trim() || '';
	const position = env.BADGE_LOGO_POSITION?.trim().toLowerCase() || '';
	const positionOk = ['auto', 'top', 'right', 'left'].includes(position);
	return {
		people,
		/** Before rounding up to fill the last sheet, which depends on the sheet chosen. */
		blanks_for_room: Math.max(0, ev.in_person_max - people.length),
		template: known ? set : DEFAULT_BADGE_TEMPLATE,
		/** Settings that were set but could not be used, so the admin page can say so rather than quietly ignore them. */
		ignored: [
			set && !known ? `BADGE_TEMPLATE "${set}" is not one of the built-in sheets` : '',
			colour && !COLOUR_RE.test(colour) ? `BADGE_COLOUR "${colour}" is not a colour like #007CBB` : '',
			family && !FONT_NAME_RE.test(family) ? 'BADGE_FONT_FAMILY may only have letters, digits, spaces, - and _' : '',
			fontUrl && !(family && FONT_NAME_RE.test(family)) ? 'BADGE_FONT_URL needs BADGE_FONT_FAMILY, the name to use for it' : '',
			position && !positionOk ? `BADGE_LOGO_POSITION "${position}" is not auto, top, right or left` : '',
		].filter(Boolean),
		logo_url: env.BADGE_LOGO_URL?.trim() || null,
		logo_position: positionOk ? position : 'auto',
		colour: COLOUR_RE.test(colour) ? colour.toUpperCase() : '#000000',
		font: fontUrl && FONT_NAME_RE.test(family) ? { url: fontUrl, family } : null,
	};
}

/**
 * The layout code that runs in the admin page (and, through badgePrintPage, in the print page). It is plain JavaScript
 * in a string because the admin page is one HTML response with no build step; tests/badges.test.mjs runs this same
 * string, so what is tested is what the browser runs. No backticks or dollar-brace in here: it sits in a template.
 */
export const BADGE_JS = String.raw`
/** Bold sans-serif faces average a little over half an em per letter; 0.62 leaves room for capitals and wide letters,
 * so the first guess rarely overflows. The print page then measures, and shrinks anything that still does. */
const BADGE_CHAR_EM = 0.62;
/** About 10 pt: smaller than this is hard to read on a badge, so a very long name wraps instead. */
const BADGE_MIN_NAME_MM = 3.5;
const badgeRound = (x) => Math.round(x * 10) / 10;

function badgePerSheet(g) { return Math.max(0, Math.floor(g.cols)) * Math.max(0, Math.floor(g.rows)); }

/** A sentence saying what is wrong with a sheet layout, or '' when the badges fit on the sheet. */
function badgeGeometryProblem(g) {
	for (const k of ['sheet_w', 'sheet_h', 'cols', 'rows', 'badge_w', 'badge_h', 'margin_top', 'margin_left', 'gap_x', 'gap_y'])
		if (typeof g[k] !== 'number' || !Number.isFinite(g[k]) || g[k] < 0) return 'Fill in every size, in millimetres (0 or more).';
	if (!Number.isInteger(g.cols) || !Number.isInteger(g.rows) || g.cols < 1 || g.rows < 1) return 'Columns and rows must be whole numbers, at least 1.';
	if (g.badge_w < 30 || g.badge_h < 20) return 'Badges must be at least 30 mm wide and 20 mm high.';
	const across = g.margin_left + g.cols * g.badge_w + (g.cols - 1) * g.gap_x;
	const down = g.margin_top + g.rows * g.badge_h + (g.rows - 1) * g.gap_y;
	// A little slack for sizes converted from inches.
	if (across > g.sheet_w + 0.05) return 'The badges need ' + badgeRound(across) + ' mm across, with the left margin: more than the sheet\'s ' + g.sheet_w + ' mm.';
	if (down > g.sheet_h + 0.05) return 'The badges need ' + badgeRound(down) + ' mm down, with the top margin: more than the sheet\'s ' + g.sheet_h + ' mm.';
	return '';
}

/**
 * How many blank badges: by default enough for every place in the room (in-person maximum less the named badges),
 * then more to fill the last sheet, which would otherwise be wasted. A number the organiser types is used as it is.
 */
function badgeBlanks(named, roomMax, perSheet, typed) {
	if (typed !== '' && typed != null && Number.isFinite(Number(typed)) && Number(typed) >= 0) return Math.floor(Number(typed));
	const blanks = Math.max(0, (roomMax || 0) - named);
	const total = named + blanks;
	if (!perSheet || !total) return blanks;
	return Math.ceil(total / perSheet) * perSheet - named;
}

/**
 * A first guess at a name's size, in mm: one line as big as fits the width (up to capMm), or two lines, split at the
 * space nearest the middle, when that is clearly bigger. Both must fit heightMm. The browser does the wrapping itself
 * (the lines returned are what the guess assumed); the print page measures and shrinks if the guess was wrong.
 */
function badgeNameFit(name, widthMm, heightMm, capMm) {
	const text = String(name || '').trim().replace(/\s+/g, ' ');
	const len = (s) => Math.max(1, s.length);
	const oneLine = Math.min(capMm, heightMm / 1.25, widthMm / (len(text) * BADGE_CHAR_EM));
	let best = { lines: [text], size: oneLine };
	if (text.includes(' ')) {
		let a = text, b = '';
		for (let i = text.indexOf(' '); i >= 0; i = text.indexOf(' ', i + 1)) {
			const x = text.slice(0, i), y = text.slice(i + 1);
			if (!b || Math.max(x.length, y.length) < Math.max(a.length, b.length)) { a = x; b = y; }
		}
		const twoLines = Math.min(capMm * 0.85, heightMm / 2.5, widthMm / (Math.max(len(a), len(b)) * BADGE_CHAR_EM));
		// Only when it is clearly better: a name on one line reads more easily.
		if (twoLines > oneLine * 1.15) best = { lines: [a, b], size: twoLines };
	}
	best.size = Math.max(BADGE_MIN_NAME_MM, Math.floor(best.size * 10) / 10);
	return best;
}

/**
 * 'lower' or 'upper' when a name or affiliation is typed all in one case, which is usually not how the person writes
 * it; '' otherwise. Printed as typed regardless (re-casing breaks McDonald, O'Neill, van der Sande): this only asks the
 * organiser to look. Short all-capitals words (UCL, MIT, NHS) are left alone.
 */
function badgeCaseFlag(text) {
	const letters = String(text || '').replace(/[^\p{L}]/gu, '');
	if (letters.length < 2) return '';
	if (letters === letters.toLowerCase() && letters !== letters.toUpperCase()) return 'lower';
	if (letters === letters.toUpperCase() && letters !== letters.toLowerCase() && (letters.length > 4 || /\s/.test(String(text).trim()))) return 'upper';
	return '';
}

/** Where each badge sits on its sheet, in mm from the sheet's top left, row by row. */
function badgePositions(g) {
	const out = [];
	for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) out.push({ left: badgeRound(g.margin_left + c * (g.badge_w + g.gap_x)), top: badgeRound(g.margin_top + r * (g.badge_h + g.gap_y)) });
	return out;
}

/**
 * Runs in the print page (its source is copied there, with badgeCaseFlag). Shrinks any text still too big for its box,
 * as a last resort letting a long single word break; outlines names and affiliations typed all in one case, on screen
 * only; and lets the organiser correct any of them in place, refitting as they type. Nothing typed there is saved.
 * Marks the page when done, for anyone (or any test) waiting on it.
 */
function badgePrintPage(doc) {
	// Shrinks the text until it fits, wrapping only between words; a word too long to fit even at the smallest size is
	// then allowed to break, starting again from the full size, so it is broken over lines rather than made tiny.
	const fit = (el) => {
		const min = parseFloat(el.dataset.min || '2');
		const over = () => el.scrollWidth > el.clientWidth + 0.5 || el.scrollHeight > el.clientHeight + 0.5;
		const shrink = (floor) => {
			let size = parseFloat(el.dataset.size);
			el.style.fontSize = size + 'mm';
			while (over() && size > floor) { size = Math.max(floor, size * 0.94); el.style.fontSize = size + 'mm'; }
		};
		// Fitted in the box it was given, then shrunk to its text, so the lines sit together (the block is centred). The
		// line height (1.25) is taller than most fonts' own ascent and descent, so no letter is cut off once it has.
		el.style.height = el.dataset.h + 'mm';
		el.classList.remove('anywhere');
		shrink(min);
		if (over()) { el.classList.add('anywhere'); shrink(1.5); }
		if (el.closest('.text')) el.style.height = 'auto';
	};
	const flags = doc.getElementById('checks');
	const flag = (el) => { el.classList.toggle('check', !!badgeCaseFlag(el.textContent)); };
	const count = () => {
		const n = doc.querySelectorAll('.edit.check').length;
		flags.hidden = !n;
		flags.textContent = n === 1 ? '1 name or affiliation, outlined in orange, is all lower-case or all capitals. It prints as typed: check how the person writes it, and click it to correct it.'
			: n + ' names or affiliations, outlined in orange, are all lower-case or all capitals. They print as typed: check how each person writes theirs, and click one to correct it.';
	};
	const all = () => { doc.querySelectorAll('.fit').forEach(fit); doc.querySelectorAll('.edit').forEach(flag); count(); };
	doc.addEventListener('input', (e) => { const el = e.target.closest && e.target.closest('.fit'); if (el) { fit(el); if (el.classList.contains('edit')) { flag(el); count(); } } });
	// One line each: Enter finishes the edit rather than adding a line the badge has no room for.
	doc.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest && e.target.closest('.edit')) { e.preventDefault(); e.target.blur(); } });
	const done = () => { all(); doc.body.dataset.fitted = '1'; };
	all();
	// A site font may arrive after the first fit, with different widths: fit again once it (and the logo) have, and only
	// then say the page is ready.
	if (doc.fonts && doc.fonts.ready) Promise.all([doc.fonts.ready, ...[...doc.images].map((i) => i.decode().catch(() => {}))]).then(done); else done();
}

const badgeEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** A camera, crossed out: small, and explained at the foot of the sheet, so it means nothing to anyone else. */
const BADGE_NO_IMAGES_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 8h4l2-3h6l2 3h4v11H3z" fill="none" stroke="#000" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="#000" stroke-width="1.8"/><path d="M3 3l18 18" stroke="#000" stroke-width="2"/></svg>';

/**
 * Where the logo goes when the organiser leaves it to us: a tall or square logo on a landscape badge makes a column at
 * the side (on the right, so the name is read first), and anything wider, or any logo on a portrait badge, a band
 * across the top. aspect is the logo's width over its height (0 when unknown, read as wide).
 */
function badgeLogoPosition(g, aspect, chosen) {
	if (chosen === 'top' || chosen === 'right' || chosen === 'left') return chosen;
	return g.badge_w > g.badge_h * 1.1 && aspect > 0 && aspect < 1.25 ? 'right' : 'top';
}

/**
 * The parts of a badge, in mm. With the logo in a band at the top, the band is capped at about a quarter of the
 * badge's height so even a tall logo leaves the name large, and the text is centred beneath it. With the logo at the
 * side, it is a column about a third of the badge's width, as high as the badge allows and centred in it, and the text,
 * left-aligned, has the rest. The text is the event title (if wanted), the given name (largest), family name and
 * affiliation; with oneLine, the full name takes the given and family names' room.
 */
function badgeLayout(g, o) {
	const w = g.badge_w, h = g.badge_h;
	const pos = o.logo ? badgeLogoPosition(g, o.logoAspect || 0, o.logoPosition) : '';
	const side = pos === 'left' || pos === 'right';
	const pad = badgeRound(Math.min(5, Math.max(2, 0.08 * Math.min(w, h))));
	const iw = badgeRound(w - 2 * pad), ih = badgeRound(h - 2 * pad);
	const colGap = side ? badgeRound(Math.min(4, 0.05 * w)) : 0;
	const logoW = side ? badgeRound(w / 3) : pos ? iw : 0;
	const logoH = side ? ih : pos ? badgeRound(Math.min(0.27 * h, 0.3 * ih)) : 0;
	const tw = badgeRound(side ? iw - logoW - colGap : iw);
	const gap = badgeRound(0.025 * ih);
	const th = side ? ih : ih - logoH - gap;
	const titleH = o.showTitle ? badgeRound((pos === 'top' ? 0.09 : 0.12) * ih) : 0;
	const text = th - titleH - 3 * gap;
	// Side by side there is no band to fill, so the lines keep their sizes and the block is centred in the height.
	const share = side ? 0.82 : 1;
	const affH = badgeRound(0.2 * text * share);
	const givenH = badgeRound((o.oneLine ? text * share - affH : 0.48 * text * share));
	const familyH = o.oneLine ? 0 : badgeRound(text * share - affH - givenH);
	return { pos, side, pad, iw, ih, tw, colGap, logoW, logoH, titleH, gap, givenH, familyH, affH };
}

/**
 * The print page: one section per sheet, the named badges first (in the order given), then the blanks.
 * opts: { title, people: [{ given, family, affiliation, no_images }], blanks, geometry, logo (URL or data URL, or ''),
 *   logoAspect (width / height, 0 if unknown), logoPosition ('auto', 'top', 'right' or 'left'), guides, markNoImages,
 *   oneLine, showTitle, colour ('#rrggbb'), font ({ url, family } or null) }
 */
function badgeSheetHtml(opts) {
	const g = opts.geometry, h = g.badge_h;
	const L = badgeLayout(g, opts);
	const colour = /^#[0-9a-fA-F]{6}$/.test(opts.colour || '') ? opts.colour : '#000000';
	const mark = opts.markNoImages && opts.people.some((p) => p.no_images);
	const givenCap = Math.min(L.givenH / 1.25, 0.2 * h);
	const titleSize = badgeRound(Math.min(L.titleH / 1.3, 0.07 * h));
	const edit = (label) => ' edit" contenteditable="plaintext-only" spellcheck="false" role="textbox" aria-label="' + label + '"';
	const box = (cls, height, size, min, inner, label) => '<div class="' + cls + ' fit' + (label ? edit(label) : '"') + ' style="height:' + height + 'mm;font-size:' + size + 'mm" data-h="' + height + '" data-size="' + size + '" data-min="' + min + '">' + inner + '</div>';
	const space = (cls, height) => height ? '<div class="' + cls + '" style="height:' + height + 'mm"></div>' : '';
	const badge = (p, i) => {
		let parts = '';
		if (p) {
			let smaller = Infinity;
			const full = [p.given, p.family].filter(Boolean).join(' ');
			const who = badgeEsc(full) + ', badge ' + (i + 1);
			const gSize = badgeNameFit(opts.oneLine ? full : p.given, L.tw, L.givenH, givenCap).size;
			if (opts.oneLine) parts += box('given', L.givenH, gSize, 4, badgeEsc(full), 'Name: ' + who);
			else {
				parts += box('given', L.givenH, gSize, 4, badgeEsc(p.given), 'Given name: ' + who);
				// Smaller than the given name, always, however short the family name.
				const fSize = Math.min(badgeNameFit(p.family, L.tw, L.familyH, L.familyH / 1.2).size, badgeRound(gSize * 0.62));
				parts += box('family', L.familyH, Math.max(2.2, fSize), 3, badgeEsc(p.family), 'Family name: ' + who);
				if (p.family) smaller = Math.max(2.2, fSize) * 0.9;
			}
			// Smaller still than the family name: the affiliation is the least of the three.
			const aSize = badgeRound(Math.min(L.affH / 1.25, gSize * 0.45, 0.06 * h + 1, smaller));
			parts += box('aff', L.affH, Math.max(1.8, aSize), 2, badgeEsc(p.affiliation || ''), 'Affiliation: ' + who);
		} else parts = space('given', L.givenH) + space('family', L.familyH) + space('aff', L.affH);
		// Blank badges keep the same layout, with the text area left empty for writing in.
		return '<div class="badge pos-' + (L.pos || 'none') + (p ? '' : ' blank') + '">'
			+ (L.pos ? '<div class="logo" style="width:' + L.logoW + 'mm;height:' + L.logoH + 'mm"><img src="' + badgeEsc(opts.logo) + '" alt=""></div>' : '')
			+ '<div class="text" style="width:' + L.tw + 'mm">'
			+ (opts.showTitle ? box('title', L.titleH, titleSize, 1.6, badgeEsc(opts.title)) : '')
			+ parts + '</div>'
			+ (p && mark && p.no_images ? '<span class="noimg" title="Asked us not to share images of them">' + BADGE_NO_IMAGES_SVG + '</span>' : '')
			+ '</div>';
	};
	const all = opts.people.map(badge);
	for (let i = 0; i < opts.blanks; i++) all.push(badge(null, 0));
	const per = badgePerSheet(g), pos = badgePositions(g), sheets = [];
	const below = g.sheet_h - (g.margin_top + g.rows * h + (g.rows - 1) * g.gap_y);
	const legendText = 'Key: the crossed-out camera marks someone who has asked us not to share images of them. Please keep them out of photos and recordings you publish.';
	// The key goes in the space below the badges when there is room for it; otherwise on a page of its own, for plain paper.
	const legendOnSheet = mark && below >= 8;
	for (let s = 0; s * per < all.length; s++) {
		const items = all.slice(s * per, (s + 1) * per).map((b, i) => b.replace('<div class="badge', '<div style="left:' + pos[i].left + 'mm;top:' + pos[i].top + 'mm" class="badge'));
		sheets.push('<section class="sheet" aria-label="Sheet ' + (s + 1) + '">' + items.join('')
			+ (legendOnSheet ? '<p class="legend" style="top:' + badgeRound(g.sheet_h - below / 2 - 2) + 'mm"><span class="noimg">' + BADGE_NO_IMAGES_SVG + '</span> ' + badgeEsc(legendText) + '</p>' : '')
			+ '</section>');
	}
	const sheetCount = sheets.length;
	if (mark && !legendOnSheet) sheets.push('<section class="sheet key" aria-label="Key"><p class="legend" style="top:20mm"><span class="noimg">' + BADGE_NO_IMAGES_SVG + '</span> ' + badgeEsc(legendText) + ' (Print this page on plain paper.)</p></section>');
	const n = opts.people.length;
	const cssUrl = (u) => '"' + String(u).replace(/["\\\n\r]/g, (c) => '\\' + c.charCodeAt(0).toString(16) + ' ') + '"';
	const fontFormat = (u) => /\.woff2(\?|#|$)/i.test(u) ? ' format("woff2")' : /\.woff(\?|#|$)/i.test(u) ? ' format("woff")' : /\.ttf(\?|#|$)/i.test(u) ? ' format("truetype")' : /\.otf(\?|#|$)/i.test(u) ? ' format("opentype")' : '';
	const family = opts.font && /^[A-Za-z0-9 _-]{1,60}$/.test(opts.font.family) ? opts.font.family : '';
	// One face for every weight (font-weight 1 1000), so a single SemiBold file is used as it is, never thickened by the
	// browser's fake bold.
	const fontFace = family ? '@font-face { font-family: "' + family + '"; src: url(' + cssUrl(opts.font.url) + ')' + fontFormat(opts.font.url) + '; font-weight: 1 1000; font-style: normal; font-display: block; } ' : '';
	const stack = (family ? '"' + family + '", ' : '') + 'Arial, Helvetica, "Liberation Sans", sans-serif';
	const css = fontFace + '@page { size: ' + g.sheet_w + 'mm ' + g.sheet_h + 'mm; margin: 0; }'
		+ ' :root { color-scheme: light; } * { box-sizing: border-box; }'
		+ ' body { margin: 0; background: #e8e8e8; color: #000; font-family: Arial, Helvetica, sans-serif; }'
		+ ' .bar { padding: 0.75rem 1rem; background: #fff; border-bottom: 1px solid #999; font-size: 15px; line-height: 1.4; }'
		+ ' .bar h1 { font-size: 1.15rem; margin: 0 0 0.25rem; } .bar p { margin: 0.25rem 0; max-width: 60rem; } .bar .warn { color: #8a4b00; font-weight: 700; }'
		+ ' .bar button { font: inherit; background: #0069a0; color: #fff; border: 0; border-radius: 4px; padding: 0.45rem 0.9rem; cursor: pointer; }'
		+ ' [hidden] { display: none !important; }'
		+ ' .sheet { position: relative; width: ' + g.sheet_w + 'mm; height: ' + g.sheet_h + 'mm; margin: 8mm auto; background: #fff; overflow: hidden; box-shadow: 0 1px 4px #0004; }'
		+ ' .badge { position: absolute; width: ' + g.badge_w + 'mm; height: ' + h + 'mm; padding: ' + L.pad + 'mm; display: flex; justify-content: center; align-items: center; gap: ' + (L.side ? L.colGap : L.gap) + 'mm; overflow: hidden; color: ' + colour + '; font-family: ' + stack + '; }'
		+ ' .pos-top, .pos-none { flex-direction: column; text-align: center; } .pos-right { flex-direction: row-reverse; text-align: left; } .pos-left { flex-direction: row; text-align: left; }'
		+ ' .text { display: flex; flex-direction: column; justify-content: center; gap: ' + L.gap + 'mm; } .pos-top .text { flex: 1 1 auto; min-height: 0; }'
		+ (opts.guides ? ' .badge { outline: 0.2mm dashed #777; outline-offset: -0.1mm; }' : '')
		+ ' .badge > *, .text > * { flex: none; }'
		+ ' .logo { display: flex; align-items: center; justify-content: center; } .logo img { display: block; width: 100%; height: 100%; object-fit: contain; object-position: center; }'
		+ ' .fit { width: 100%; overflow: hidden; display: flex; flex-direction: column; justify-content: center; line-height: 1.25; overflow-wrap: normal; text-wrap: balance; white-space: normal; }'
		+ ' .fit.anywhere { overflow-wrap: anywhere; }'
		+ ' .given { font-weight: 700; } .family { font-weight: 700; } .aff { font-weight: 400; } .title { font-weight: 700; }'
		+ ' .edit { cursor: text; border-radius: 1mm; } .edit:focus { outline: 0.5mm solid #0069a0; }'
		+ ' .edit.check { outline: 0.6mm dashed #d35f00; }'
		// The mark sits in a bottom corner away from the logo, so it never covers it.
		+ ' .noimg { position: absolute; bottom: ' + badgeRound(L.pad / 2) + 'mm; ' + (L.pos === 'left' ? 'right' : L.pos === 'right' ? 'left' : 'right') + ': ' + badgeRound(L.pad / 2) + 'mm; width: 4mm; height: 4mm; display: inline-block; }'
		+ ' .noimg svg { width: 100%; height: 100%; display: block; }'
		+ ' .legend { position: absolute; left: 10mm; right: 10mm; margin: 0; font-size: 3mm; line-height: 1.2; text-align: center; color: #000; }'
		+ ' .legend .noimg { position: static; vertical-align: -0.8mm; }'
		+ ' @media print { body { background: #fff; } .bar { display: none; } .sheet { margin: 0; box-shadow: none; break-after: page; } .sheet:last-child { break-after: auto; } .edit, .edit.check, .edit:focus { outline: none; } }';
	return '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
		+ '<title>Name badges – ' + badgeEsc(opts.title) + '</title><style>' + css + '</style></head><body>'
		+ '<main><div class="bar"><h1>Name badges – ' + badgeEsc(opts.title) + '</h1>'
		+ '<p>' + n + ' named and ' + opts.blanks + ' blank, on ' + sheetCount + ' sheet' + (sheetCount === 1 ? '' : 's') + ' of ' + per + '.</p>'
		+ '<p>Names and affiliations print exactly as typed. Click any of them to correct it here before printing; changes here are not saved.</p>'
		+ '<p class="warn" id="checks" role="status" hidden></p>'
		+ '<p>Print at actual size (100%, not "fit to page"), with margins set to none and headers and footers off. Try one sheet on plain paper first, held against a sheet of badges to the light.</p>'
		+ '<button type="button" onclick="print()">Print</button></div>'
		+ sheets.join('') + '</main>'
		+ '<script>' + badgeCaseFlag.toString() + ';(' + badgePrintPage.toString() + ')(document);<\/script></body></html>';
}
`;

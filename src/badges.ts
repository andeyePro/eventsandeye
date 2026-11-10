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
 * 90 × 60 mm, 8 to an A4 sheet, 2 across and 4 down. The geometry is read from Avery's own Word template for 4822
 * (avery.co.uk/template-4822): a 28.5 mm top margin, the left column's edge 10.18 mm from the sheet's edge, a 10 mm
 * gap between the columns and none between the rows.
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
		sheet_w: 210, sheet_h: 297, cols: 2, rows: 4, badge_w: 90, badge_h: 60, margin_top: 28.5, margin_left: 10.18, gap_x: 10, gap_y: 0,
		source: 'Avery\'s Word template for 4822 (avery.co.uk/template-4822, Avery-UK_4822_Word_Template.doc): A4, top margin 28.49 mm, rows exactly 60 mm, columns 90 mm with a 9.98 mm gap, the first 10.18 mm from the left edge',
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
	const positionOk = ['auto', 'corner', 'top', 'right', 'left'].includes(position);
	const colours = { colour: 'BADGE_COLOUR', affiliation_colour: 'BADGE_AFFILIATION_COLOUR', tag_colour: 'BADGE_TAG_COLOUR', accent_colour: 'BADGE_ACCENT_COLOUR' } as const;
	const colourOf = (k: keyof typeof colours) => env[colours[k]]?.trim() || '';
	const tagWidth = env.BADGE_TAG_WIDTH?.trim() || '';
	const tagWidthOk = /^(0(\.\d+)?|1(\.0+)?)$/.test(tagWidth) && Number(tagWidth) >= 0.2;
	return {
		people,
		/** Before rounding up to fill the last sheet, which depends on the sheet chosen. */
		blanks_for_room: Math.max(0, ev.in_person_max - people.length),
		template: known ? set : DEFAULT_BADGE_TEMPLATE,
		/** Settings that were set but could not be used, so the admin page can say so rather than quietly ignore them. */
		ignored: [
			set && !known ? `BADGE_TEMPLATE "${set}" is not one of the built-in sheets` : '',
			...(Object.keys(colours) as (keyof typeof colours)[]).map((k) => colourOf(k) && !COLOUR_RE.test(colourOf(k)) ? `${colours[k]} "${colourOf(k)}" is not a colour like #007CBB` : ''),
			tagWidth && !tagWidthOk ? `BADGE_TAG_WIDTH "${tagWidth}" is not a share of the logo's width from 0.2 to 1, such as 0.64` : '',
			family && !FONT_NAME_RE.test(family) ? 'BADGE_FONT_FAMILY may only have letters, digits, spaces, - and _' : '',
			fontUrl && !(family && FONT_NAME_RE.test(family)) ? 'BADGE_FONT_URL needs BADGE_FONT_FAMILY, the name to use for it' : '',
			position && !positionOk ? `BADGE_LOGO_POSITION "${position}" is not auto, corner, top, right or left` : '',
		].filter(Boolean),
		logo_url: env.BADGE_LOGO_URL?.trim() || null,
		logo_position: positionOk ? position : 'auto',
		colour: COLOUR_RE.test(colour) ? colour.toUpperCase() : '#000000',
		/** null: the same as the text colour. */
		affiliation_colour: COLOUR_RE.test(colourOf('affiliation_colour')) ? colourOf('affiliation_colour').toUpperCase() : null,
		tag: env.BADGE_TAG?.trim().slice(0, 40) || '',
		tag_colour: COLOUR_RE.test(colourOf('tag_colour')) ? colourOf('tag_colour').toUpperCase() : null,
		tag_width: tagWidthOk ? Number(tagWidth) : 1,
		/** Set: the dots on i and j (and hyphens in names without any) are drawn in this colour; the admin page can turn
		 * it off. null: off. */
		accent_colour: COLOUR_RE.test(colourOf('accent_colour')) ? colourOf('accent_colour').toUpperCase() : null,
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
		// The tag line fills its width exactly, so it ends where the logo ends: grown until one more step would not fit.
		if (el.dataset.fill) {
			let size = parseFloat(el.style.fontSize);
			const most = parseFloat(el.dataset.fill), wide = () => el.scrollWidth > el.clientWidth + 0.5 || el.scrollHeight > el.clientHeight + 0.5;
			const ink = () => { const r = doc.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; };
			while (size < most && !wide() && ink() < el.clientWidth * 0.98) { size *= 1.02; el.style.fontSize = size + 'mm'; }
			if (wide() || ink() > el.clientWidth + 0.5) { size /= 1.02; el.style.fontSize = size + 'mm'; }
		}
		if (el.closest('.text')) el.style.height = 'auto';
	};
	// The line's own text: while it is being edited, what is in it; otherwise what was there before it was decorated.
	const textOf = (el) => el === doc.activeElement || el.dataset.text == null ? el.textContent : el.dataset.text;
	const flags = doc.getElementById('checks');
	const flag = (el) => { el.classList.toggle('check', !!badgeCaseFlag(textOf(el))); };

	/*
	 * Accent colour (body data-accent): the dot on every lower-case i and j, in names and affiliations, and the hyphens
	 * in a name with no i or j at all. A dot cannot be coloured on its own, so the letter is drawn dotless (ı, ȷ) in the
	 * text colour, and the dotted letter laid exactly over it in the accent colour, clipped to its dot: so the dot is the
	 * font's own, its shape and place exact in any font. Where to clip (halfway between the dot and the top of the stem)
	 * comes from the font itself: the dotted and dotless letters are drawn on a canvas and compared pixel by pixel, once
	 * per font and weight, in em so it follows the fitted size. A font without the dotless letters (the two must match
	 * apart from the dot) is left as it is. The real text stays in the line for screen readers and copying; the drawing
	 * is aria-hidden.
	 */
	const accent = doc.body.dataset.accent === '1';
	const dots = {};
	const dotFor = (el, ch) => {
		const cs = getComputedStyle(el), key = cs.fontStyle + '|' + cs.fontWeight + '|' + cs.fontFamily + '|' + ch;
		if (key in dots) return dots[key];
		const S = 200, n = 420, ox = 110, oy = 300, plain = ch === 'i' ? '\u0131' : '\u0237';
		const cv = doc.createElement('canvas'); cv.width = cv.height = n;
		const x = cv.getContext('2d', { willReadFrequently: true });
		const font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + S + 'px ' + cs.fontFamily;
		const shot = (g) => { x.clearRect(0, 0, n, n); x.font = font; x.fillStyle = '#000'; x.textBaseline = 'alphabetic'; x.fillText(g, ox, oy); return x.getImageData(0, 0, n, n).data; };
		const a = shot(ch), b = shot(plain);
		let maxY = -1, stemTop = n, dot = 0, stem = 0, extra = 0;
		for (let p = 3; p < a.length; p += 4) {
			const d = a[p] - b[p], Y = Math.floor((p - 3) / 4 / n);
			if (b[p] > 16) { stem++; stemTop = Math.min(stemTop, Y); }
			if (d < -64) extra++;
			if (d > 16) { dot++; maxY = Math.max(maxY, Y); }
		}
		x.font = font;
		const same = Math.abs(x.measureText(ch).width - x.measureText(plain).width) < S * 0.02;
		// The dotless letter must be the dotted one less its dot: otherwise it came from another font, or is missing.
		const ok = dot > 20 && stem > 20 && extra <= stem * 0.02 && same && maxY < stemTop;
		if (!ok) return (dots[key] = null);
		// The dotted letter is an inline-block on the line's own baseline, then pulled back by its advance so the dotless
		// letter is drawn over it. The cut is halfway between the bottom of the dot and the top of the stem, measured from
		// the inline-block's top, whose baseline is found on the page with a marker.
		const mid = (oy - (maxY + stemTop) / 2) / S;
		const over = doc.createElement('span'), base = doc.createElement('span');
		over.className = 'tt'; over.textContent = ch;
		base.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
		over.append(base); el.append(over);
		const px = parseFloat(cs.fontSize), baseline = (base.getBoundingClientRect().top - over.getBoundingClientRect().top) / px;
		over.remove();
		x.font = font;
		return (dots[key] = { cut: baseline - mid, adv: x.measureText(ch).width / S });
	};
	const decorate = (el) => {
		if (!accent || el === doc.activeElement) return;
		const text = textOf(el);
		el.dataset.text = text;
		const badge = el.closest('.badge');
		const name = [...badge.querySelectorAll('.given, .family')].map(textOf).join(' ');
		const hyphens = !el.classList.contains('aff') && !/[ij]/.test(name);
		if (!/[ij]/.test(text) && !(hyphens && /[-\u2010\u2011]/.test(text))) { el.textContent = text; return; }
		el.textContent = '';
		let out = '';
		for (const ch of text) {
			const d = ch === 'i' || ch === 'j' ? dotFor(el, ch) : null;
			if (d) out += '<span class="tt" style="clip-path:inset(0 0 calc(100% - ' + d.cut.toFixed(4) + 'em) 0);margin-right:-' + d.adv.toFixed(4) + 'em">' + ch + '</span>' + (ch === 'i' ? '\u0131' : '\u0237');
			else if (hyphens && /[-\u2010\u2011]/.test(ch)) out += '<span class="acc">' + ch + '</span>';
			else out += badgeEsc(ch);
		}
		el.innerHTML = '<span class="sr">' + badgeEsc(text) + '</span><span aria-hidden="true">' + out + '</span>';
	};
	const decorateBadge = (badge) => badge.querySelectorAll('.given.edit, .family.edit, .aff.edit').forEach((x) => { decorate(x); fit(x); });
	// Edited as plain text, decorated again when done (the hyphen rule looks at the whole name, so the badge's lines).
	doc.addEventListener('focusin', (e) => { const el = e.target.closest && e.target.closest('.edit'); if (el && accent && el.dataset.text != null) { el.textContent = el.dataset.text; fit(el); } });
	doc.addEventListener('focusout', (e) => { const el = e.target.closest && e.target.closest('.edit'); if (el && accent) { el.dataset.text = el.textContent; setTimeout(() => decorateBadge(el.closest('.badge')), 0); } });
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
	const done = () => { if (accent) doc.querySelectorAll('.edit').forEach(decorate); all(); doc.body.dataset.fitted = '1'; };
	all();
	// A site font may arrive after the first fit, with different widths: fit again once it (and the logo) have, and only
	// then say the page is ready.
	if (doc.fonts && doc.fonts.ready) Promise.all([doc.fonts.ready, ...[...doc.images].map((i) => i.decode().catch(() => {}))]).then(done); else done();
}

const badgeEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** A camera, crossed out: small, and explained at the foot of the sheet, so it means nothing to anyone else. */
const BADGE_NO_IMAGES_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 8h4l2-3h6l2 3h4v11H3z" fill="none" stroke="#000" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="#000" stroke-width="1.8"/><path d="M3 3l18 18" stroke="#000" stroke-width="2"/></svg>';

/**
 * Where the logo goes when the organiser leaves it to us. On a landscape badge, in the top right-hand corner with the
 * names across the full width beneath it, unless the logo is very wide (a banner), which goes in a band across the
 * top; on a portrait badge, across the top. aspect is the logo's width over its height (0 when unknown).
 */
function badgeLogoPosition(g, aspect, chosen) {
	if (chosen === 'corner' || chosen === 'top' || chosen === 'right' || chosen === 'left') return chosen;
	if (g.badge_w <= g.badge_h * 1.1) return 'top';
	return aspect >= 2.2 ? 'top' : 'corner';
}

/**
 * The parts of a badge, in mm.
 * - corner: the logo in the top right-hand corner, about 22% of the badge's width (20 mm on a 90 mm badge) and never
 *   more than about a third of its height, with the tag line under it, right-aligned to it; the names run the full
 *   width beneath, left-aligned, and the event title (if wanted) sits to the left of the logo.
 * - top: a band across the top, capped at about a quarter of the badge's height, the names centred beneath.
 * - left or right: a column about a third of the badge's width, the names left-aligned beside it.
 * The names are the given name (largest), family name and affiliation; with oneLine, the full name takes the given and
 * family names' room. tagWidth is the tag line's width as a share of the logo's.
 */
function badgeLayout(g, o) {
	const w = g.badge_w, h = g.badge_h;
	const pos = o.logo ? badgeLogoPosition(g, o.logoAspect || 0, o.logoPosition) : '';
	const side = pos === 'left' || pos === 'right', corner = pos === 'corner';
	const pad = badgeRound(Math.min(5, Math.max(2, 0.08 * Math.min(w, h))));
	const iw = badgeRound(w - 2 * pad), ih = badgeRound(h - 2 * pad);
	const gap = badgeRound(0.025 * ih);
	const colGap = side ? badgeRound(Math.min(4, 0.05 * w)) : 0;
	const tag = !!(pos && o.tag);
	let logoW = 0, logoH = 0;
	if (corner) {
		// As wide as 22% of the badge, unless that makes it too tall for the names to stay large.
		const aspect = o.logoAspect > 0 ? o.logoAspect : 1;
		logoW = Math.min(0.22 * w, 0.3 * ih * aspect);
		logoH = badgeRound(logoW / aspect);
		logoW = badgeRound(logoW);
	} else if (side) { logoW = badgeRound(w / 3); logoH = ih; }
	else if (pos) { logoW = iw; logoH = badgeRound(Math.min(0.27 * h, 0.3 * ih)); }
	const tagH = tag ? badgeRound(0.075 * h) : 0;
	const tagW = tag ? badgeRound(Math.min(1, Math.max(0.2, o.tagWidth > 0 ? o.tagWidth : 1)) * logoW) : 0;
	if (side && tag) logoH = badgeRound(ih - tagH - gap);
	const headH = corner || pos === 'top' ? badgeRound(logoH + (tag ? tagH + gap : 0)) : 0;
	const tw = badgeRound(side ? iw - logoW - colGap : iw);
	const th = side ? ih : ih - headH - (headH ? gap : 0);
	// In the corner layout the title sits beside the logo, so it takes nothing from the names.
	const titleH = o.showTitle ? badgeRound((pos === 'top' ? 0.09 : 0.12) * ih) : 0;
	const text = th - (corner ? 0 : titleH) - 3 * gap;
	// Side by side there is no band to fill, so the lines keep their sizes and the block is centred in the height.
	const share = side ? 0.82 : 1;
	const affH = badgeRound(0.2 * text * share);
	const givenH = badgeRound((o.oneLine ? text * share - affH : (corner ? 0.5 : 0.48) * text * share));
	const familyH = o.oneLine ? 0 : badgeRound(text * share - affH - givenH);
	return { pos, side, corner, pad, iw, ih, tw, colGap, logoW, logoH, tagW, tagH, headH, titleH, gap, givenH, familyH, affH };
}

/**
 * The print page: one section per sheet, the named badges first (in the order given), then the blanks.
 * opts: { title, people: [{ given, family, affiliation, no_images }], blanks, geometry, logo (URL or data URL, or ''),
 *   logoAspect (width / height, 0 if unknown), logoPosition ('auto', 'corner', 'top', 'right' or 'left'), tag (a line
 *   under the logo), tagColour, tagWidth (share of the logo's width), guides, markNoImages, oneLine, showTitle, colour,
 *   affColour (the affiliation's), accent (the dots on i and j, and hyphens in names without them, or '' for none;
 *   all colours '#rrggbb'),
 *   font ({ url, family } or null) }
 */
function badgeSheetHtml(opts) {
	const g = opts.geometry, h = g.badge_h;
	const L = badgeLayout(g, opts);
	const hex = (c, or) => /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : or;
	const colour = hex(opts.colour, '#000000'), affColour = hex(opts.affColour, colour), tagColour = hex(opts.tagColour, colour), accent = hex(opts.accent, '');
	const mark = opts.markNoImages && opts.people.some((p) => p.no_images);
	const givenCap = Math.min(L.givenH / 1.25, (L.corner ? 0.24 : 0.2) * h);
	const named = badgeEsc;
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
			if (opts.oneLine) parts += box('given', L.givenH, gSize, 4, named(full), 'Name: ' + who);
			else {
				parts += box('given', L.givenH, gSize, 4, named(p.given), 'Given name: ' + who);
				// Smaller than the given name, always, however short the family name.
				const fSize = Math.min(badgeNameFit(p.family, L.tw, L.familyH, L.familyH / 1.2).size, badgeRound(gSize * 0.62));
				parts += box('family', L.familyH, Math.max(2.2, fSize), 3, named(p.family), 'Family name: ' + who);
				if (p.family) smaller = Math.max(2.2, fSize) * 0.9;
			}
			// Smaller still than the family name: the affiliation is the least of the three.
			const aSize = badgeRound(Math.min(L.affH / 1.25, gSize * 0.45, 0.06 * h + 1, smaller));
			parts += box('aff', L.affH, Math.max(1.8, aSize), 2, badgeEsc(p.affiliation || ''), 'Affiliation: ' + who);
		} else parts = space('given', L.givenH) + space('family', L.familyH) + space('aff', L.affH);
		// Blank badges keep the same layout, with the text area left empty for writing in.
		const img = '<img src="' + badgeEsc(opts.logo) + '" alt="">';
		const tagLine = L.tagW ? box('tag', L.tagH, badgeRound(Math.min(L.tagH / 1.25, L.tagW / (Math.max(1, String(opts.tag).length) * 0.62))), 1.5, badgeEsc(opts.tag)).replace(' data-min=', ' data-fill="' + badgeRound(L.tagH / 1.25) + '" data-min=') : '';
		const logo = !L.pos ? '' : L.corner || L.pos === 'top'
			? '<div class="head" style="height:' + L.headH + 'mm">'
				+ (L.corner && opts.showTitle ? box('title', L.titleH, titleSize, 1.6, badgeEsc(opts.title)) : '')
				+ '<div class="mark-block" style="width:' + L.logoW + 'mm"><div class="logo" style="width:' + L.logoW + 'mm;height:' + L.logoH + 'mm">' + img + '</div>' + tagLine + '</div></div>'
			: '<div class="mark-block" style="width:' + L.logoW + 'mm"><div class="logo" style="width:' + L.logoW + 'mm;height:' + L.logoH + 'mm">' + img + '</div>' + tagLine + '</div>';
		return '<div class="badge pos-' + (L.pos || 'none') + (p ? '' : ' blank') + '">'
			+ logo
			+ '<div class="text" style="width:' + L.tw + 'mm">'
			+ (opts.showTitle && !L.corner ? box('title', L.titleH, titleSize, 1.6, badgeEsc(opts.title)) : '')
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
		+ ' .pos-corner { flex-direction: column; justify-content: flex-start; align-items: stretch; text-align: left; } .pos-corner .text { flex: 1 1 auto; min-height: 0; }'
		+ ' .head { width: 100%; display: flex; justify-content: space-between; align-items: flex-start; gap: ' + L.gap + 'mm; } .pos-top .head { justify-content: center; }'
		+ ' .head .title { flex: 1 1 auto; width: auto; justify-content: flex-start; } .mark-block { display: flex; flex-direction: column; gap: ' + L.gap + 'mm; margin-left: auto; } .pos-top .mark-block { margin: 0 auto; }'
		+ ' .mark-block { flex: none; } .mark-block .tag { color: ' + tagColour + '; font-weight: 700; width: ' + L.tagW + 'mm; align-self: ' + (L.corner ? 'flex-end' : 'center') + '; text-align: ' + (L.corner ? 'right' : 'center') + '; white-space: nowrap; }'
		+ ' .aff { color: ' + affColour + '; } .acc { color: ' + (accent || colour) + '; }'
		+ ' .fit { position: relative; } .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }'
		+ ' .tt { display: inline-block; color: ' + (accent || colour) + '; }'
		+ ' .text { display: flex; flex-direction: column; justify-content: center; gap: ' + L.gap + 'mm; } .pos-top .text { flex: 1 1 auto; min-height: 0; }'
		+ (opts.guides ? ' .badge { outline: 0.2mm dashed #777; outline-offset: -0.1mm; }' : '')
		+ ' .badge > *, .text > * { flex: none; }'
		+ ' .logo { display: flex; align-items: center; justify-content: center; } .logo img { display: block; width: 100%; height: 100%; object-fit: contain; object-position: center; }'
		+ ' .fit { width: 100%; overflow: hidden; display: flex; flex-direction: column; justify-content: center; line-height: 1.25; overflow-wrap: normal; text-wrap: balance; white-space: normal; }'
		+ ' .fit.anywhere { overflow-wrap: anywhere; }'
		+ ' .given { font-weight: 700; } .family { font-weight: 700; } .aff { font-weight: 400; } .title { font-weight: 700; }'
		+ ' .edit { cursor: text; border-radius: 1mm; } .edit:focus { outline: 0.5mm solid #0069a0; }'
		+ ' .edit.check { outline: 0.6mm dashed #d35f00; }'
		// The mark sits in a corner away from the logo and the names (top left beside a corner logo), so it covers neither.
		+ ' .noimg { position: absolute; bottom: ' + badgeRound(L.pad / 2) + 'mm; ' + (L.pos === 'left' ? 'right' : L.pos === 'right' ? 'left' : 'right') + ': ' + badgeRound(L.pad / 2) + 'mm;' + (L.corner && !opts.showTitle ? ' bottom: auto; top: ' + badgeRound(L.pad / 2) + 'mm; left: ' + badgeRound(L.pad / 2) + 'mm; right: auto;' : '') + ' width: 4mm; height: 4mm; display: inline-block; }'
		+ ' .noimg svg { width: 100%; height: 100%; display: block; }'
		+ ' .legend { position: absolute; left: 10mm; right: 10mm; margin: 0; font-size: 3mm; line-height: 1.2; text-align: center; color: #000; }'
		+ ' .legend .noimg { position: static; vertical-align: -0.8mm; }'
		+ ' @media print { body { background: #fff; } .bar { display: none; } .sheet { margin: 0; box-shadow: none; break-after: page; } .sheet:last-child { break-after: auto; } .edit, .edit.check, .edit:focus { outline: none; } }';
	return '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
		+ '<title>Name badges – ' + badgeEsc(opts.title) + '</title><style>' + css + '</style></head><body' + (accent ? ' data-accent="1"' : '') + '>'
		+ '<main><div class="bar"><h1>Name badges – ' + badgeEsc(opts.title) + '</h1>'
		+ '<p>' + n + ' named and ' + opts.blanks + ' blank, on ' + sheetCount + ' sheet' + (sheetCount === 1 ? '' : 's') + ' of ' + per + '.</p>'
		+ '<p>Names and affiliations print exactly as typed. Click any of them to correct it here before printing; changes here are not saved.</p>'
		+ '<p class="warn" id="checks" role="status" hidden></p>'
		+ '<p>Print at actual size (100%, not "fit to page"), with margins set to none and headers and footers off. Try one sheet on plain paper first, held against a sheet of badges to the light.</p>'
		+ '<button type="button" onclick="print()">Print</button></div>'
		+ sheets.join('') + '</main>'
		+ '<script>' + badgeCaseFlag.toString() + ';const badgeEsc = ' + badgeEsc.toString() + ';(' + badgePrintPage.toString() + ')(document);<\/script></body></html>';
}
`;

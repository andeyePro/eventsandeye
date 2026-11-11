// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
// Unit tests for name badges: who gets one and in what order, the built-in sheets, and the layout code the admin page
// runs (BADGE_JS is run here exactly as the browser runs it). The browser test measures the printed result.
// Run: node --test eventsandeye/tests/badges.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({ entryPoints: [new URL('../src/badges.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, platform: 'neutral' });
const { BADGE_JS, BADGE_PRESETS, DEFAULT_BADGE_TEMPLATE, badgePeople, badgeSummary, splitName, wantsBadge } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const js = new Function(`${BADGE_JS}; return { badgePerSheet, badgeGeometryProblem, badgeBlanks, badgeNameFit, badgeCaseFlag, badgePositions, badgeLayout, badgeLogoPosition, badgeSheetHtml, badgeCutMarks };`)();
const near = (a, b) => Math.abs(a - b) < 0.11;
const preset = (id) => BADGE_PRESETS.find((p) => p.id === id);

const reg = (name, over = {}) => ({ name, status: 'confirmed', attendance: 'in_person', place: 'place', affiliation: null, no_images: 0, updated_at: '2026-11-01T10:00:00.000Z', ...over });

test('named badges: confirmed, in person, with a place; nobody else', () => {
	assert.equal(wantsBadge(reg('A')), true);
	assert.equal(wantsBadge(reg('A', { status: 'pending' })), false, 'unconfirmed');
	assert.equal(wantsBadge(reg('A', { place: 'waitlist' })), false, 'waiting list');
	assert.equal(wantsBadge(reg('A', { place: null })), false, 'opt-in sessions only (e.g. dinner)');
	assert.equal(wantsBadge(reg('A', { attendance: 'remote', place: null })), false, 'remote');
});

test('names are split into given and family names, keeping lower-case particles with the family name', () => {
	assert.deepEqual(splitName('Ada Lovelace'), { given: 'Ada', family: 'Lovelace' });
	assert.deepEqual(splitName('  Mary  Ann   Evans '), { given: 'Mary Ann', family: 'Evans' });
	assert.deepEqual(splitName('Ludwig van Beethoven'), { given: 'Ludwig', family: 'van Beethoven' });
	assert.deepEqual(splitName('Maria de la Cruz'), { given: 'Maria', family: 'de la Cruz' });
	assert.deepEqual(splitName('Sanne van der Sande'), { given: 'Sanne', family: 'van der Sande' });
	assert.deepEqual(splitName('Van Morrison'), { given: 'Van', family: 'Morrison' }, 'a capitalised Van is a given name');
	assert.deepEqual(splitName('de Gaulle'), { given: 'de', family: 'Gaulle' }, 'the first word always stays a given name');
	assert.deepEqual(splitName('Cher'), { given: 'Cher', family: '' });
	assert.deepEqual(splitName("Siobhán O'Neill-McDonald"), { given: 'Siobhán', family: "O'Neill-McDonald" }, 'as typed, never re-cased');
});

test('sorted by family name, then given name, ignoring case and accents; names kept as typed', () => {
	const people = badgePeople([reg('zed adams'), reg('Ludwig van Beethoven'), reg('Amy Brown', { affiliation: ' UCL ', no_images: 1 }), reg('Bea Ádams'), reg('Cher'), reg('Remote Person', { attendance: 'remote', place: null })]);
	assert.deepEqual(people.map((p) => `${p.given}|${p.family}`), ['Bea|Ádams', 'zed|adams', 'Amy|Brown', 'Cher|', 'Ludwig|van Beethoven']);
	assert.deepEqual(people.find((p) => p.given === 'Amy'), { given: 'Amy', family: 'Brown', affiliation: 'UCL', no_images: true, changed_at: '2026-11-01T10:00:00.000Z' });
	assert.equal(badgePeople([reg('Late Comer', { updated_at: '2026-11-11T09:00:00.000Z' })])[0].changed_at, '2026-11-11T09:00:00.000Z', 'when last confirmed, promoted or edited: for a second print run');
});

test('badge settings: defaults, a known sheet, and settings that cannot be used are reported', () => {
	const s = badgeSummary({}, { in_person_max: 10 }, [reg('A B'), reg('C D')]);
	assert.equal(s.template, DEFAULT_BADGE_TEMPLATE);
	assert.equal(DEFAULT_BADGE_TEMPLATE, 'plain-a4');
	assert.equal(s.blanks_for_room, 8);
	assert.equal(s.colour, '#000000');
	assert.equal(s.font, null);
	assert.deepEqual(s.ignored, []);
	const amybo = badgeSummary({ BADGE_TEMPLATE: 'avery-4822', BADGE_COLOUR: '#007cbb', BADGE_AFFILIATION_COLOUR: '#007CBB', BADGE_TAG: ' EVENT’26 ', BADGE_TAG_COLOUR: '#007CBB', BADGE_TAG_WIDTH: '0.64', BADGE_ACCENT_COLOUR: '#87bd25', BADGE_FONT_URL: '/fonts/Montserrat-SemiBold.woff2', BADGE_FONT_FAMILY: 'Montserrat SemiBold', BADGE_LOGO_URL: '/logo.svg' }, { in_person_max: 1 }, [reg('A B'), reg('C D')]);
	assert.equal(amybo.template, 'avery-4822');
	assert.equal(amybo.blanks_for_room, 0, 'never negative');
	assert.equal(amybo.colour, '#007CBB');
	assert.deepEqual(amybo.font, { url: '/fonts/Montserrat-SemiBold.woff2', family: 'Montserrat SemiBold' });
	assert.equal(amybo.logo_url, '/logo.svg');
	assert.deepEqual([amybo.affiliation_colour, amybo.tag, amybo.tag_colour, amybo.tag_width, amybo.accent_colour], ['#007CBB', 'EVENT’26', '#007CBB', 0.64, '#87BD25']);
	assert.deepEqual([s.affiliation_colour, s.tag, s.tag_colour, s.tag_width, s.accent_colour], [null, '', null, 1, null], 'all off by default');
	const odd = badgeSummary({ BADGE_TAG_WIDTH: '2', BADGE_ACCENT_COLOUR: 'green', BADGE_LOGO_POSITION: 'corner' }, { in_person_max: 1 }, []);
	assert.equal(odd.tag_width, 1);
	assert.equal(odd.accent_colour, null);
	assert.equal(odd.logo_position, 'corner');
	assert.equal(odd.ignored.length, 2, odd.ignored.join(' | '));
	const bad = badgeSummary({ BADGE_TEMPLATE: 'avery-9999', BADGE_COLOUR: 'blue', BADGE_FONT_URL: '/f.woff2', BADGE_FONT_FAMILY: 'x"; } body { color: red' }, { in_person_max: 1 }, []);
	assert.equal(bad.template, 'plain-a4');
	assert.equal(bad.colour, '#000000');
	assert.equal(bad.font, null, 'a family name that could break out of the CSS is refused');
	assert.equal(bad.ignored.length, 4, bad.ignored.join(' | '));
	assert.equal(badgeSummary({ BADGE_LOGO_POSITION: 'Right' }, { in_person_max: 1 }, []).logo_position, 'right');
	const pos = badgeSummary({ BADGE_LOGO_POSITION: 'middle' }, { in_person_max: 1 }, []);
	assert.equal(pos.logo_position, 'auto');
	assert.match(pos.ignored.join(), /BADGE_LOGO_POSITION/);
});

test('every built-in sheet fits its paper, and the Avery sheets have the published counts and sizes', () => {
	for (const p of BADGE_PRESETS) assert.equal(js.badgeGeometryProblem(p), '', p.id);
	const a = preset('avery-4822');
	assert.deepEqual([a.sheet_w, a.sheet_h, a.cols, a.rows, a.badge_w, a.badge_h], [210, 297, 2, 4, 90, 60]);
	assert.equal(js.badgePerSheet(a), 8);
	// As in Avery's 4822 Word template: 28.5 mm down (equal top and bottom), 10 mm in, a 10 mm gap between columns.
	assert.deepEqual([a.margin_top, a.margin_left, a.gap_x, a.gap_y], [28.5, 10, 10, 0]);
	assert.equal(a.margin_top * 2 + a.rows * a.badge_h, a.sheet_h);
	assert.equal(js.badgePerSheet(preset('avery-l4785')), 10);
	assert.equal(js.badgePerSheet(preset('avery-5395')), 8);
	assert.ok(Math.abs(preset('avery-5395').badge_w - 85.725) < 0.01 && Math.abs(preset('avery-5395').sheet_h - 279.4) < 0.01);
	assert.equal(js.badgePerSheet(preset('plain-a4')), 1);
	assert.deepEqual(js.badgePositions(a).slice(0, 3), [{ left: 10, top: 28.5 }, { left: 110, top: 28.5 }, { left: 10, top: 88.5 }]);
	assert.deepEqual(js.badgePositions(a).at(-1), { left: 110, top: 208.5 });
});

test('a layout that does not fit, or makes no sense, is refused with a sentence', () => {
	const a = preset('avery-4822');
	assert.match(js.badgeGeometryProblem({ ...a, cols: 3 }), /mm across/);
	assert.match(js.badgeGeometryProblem({ ...a, margin_top: 60 }), /mm down/);
	assert.match(js.badgeGeometryProblem({ ...a, rows: 0 }), /whole numbers/);
	assert.match(js.badgeGeometryProblem({ ...a, cols: 1.5 }), /whole numbers/);
	assert.match(js.badgeGeometryProblem({ ...a, badge_w: NaN }), /Fill in every size/);
	assert.match(js.badgeGeometryProblem({ ...a, badge_h: 10 }), /at least/);
});

test('blank badges fill the room, then the last sheet; a typed number is used as it is', () => {
	assert.equal(js.badgeBlanks(30, 40, 8, ''), 10, '30 + 10 = 40 = 5 sheets exactly');
	assert.equal(js.badgeBlanks(30, 41, 8, ''), 18, '41 rounds up to 48');
	assert.equal(js.badgeBlanks(45, 40, 8, ''), 3, 'more named than places: just fill the last sheet');
	assert.equal(js.badgeBlanks(0, 0, 8, ''), 0, 'nothing to print');
	assert.equal(js.badgeBlanks(0, 5, 8, ''), 8);
	assert.equal(js.badgeBlanks(7, 0, 1, ''), 0, 'one per page never needs filling');
	assert.equal(js.badgeBlanks(30, 41, 8, '0'), 0, 'typed 0');
	assert.equal(js.badgeBlanks(30, 41, 8, '4'), 4);
	assert.equal(js.badgeBlanks(30, 41, 8, '-2'), 18, 'a negative number is ignored');
});

test('name fitting: short names hit the cap, long ones shrink or take two lines, nothing below the minimum', () => {
	const w = 82.8, h = 20, cap = 10;
	assert.deepEqual(js.badgeNameFit('Amy', w, h, cap), { lines: ['Amy'], size: 10 });
	const long = js.badgeNameFit('Bartholomew Montgomery-Fotheringham', w, h, cap);
	assert.equal(long.lines.length, 2);
	assert.deepEqual(long.lines, ['Bartholomew', 'Montgomery-Fotheringham']);
	assert.ok(long.size < cap && long.size * 0.62 * 23 <= w + 0.1, String(long.size));
	const mid = js.badgeNameFit('Christopher Wainwright', w, 12, cap);
	assert.equal(mid.lines.length, 1, 'one line when the box is too low for two to be bigger');
	assert.equal(js.badgeNameFit('Christopher Wainwright', w, h, cap).lines.length, 2, 'two lines when the box is tall enough for them to be bigger');
	assert.ok(mid.size * 0.62 * 22 <= w + 0.1);
	const word = js.badgeNameFit('Wolfeschlegelsteinhausenbergerdorffvoralternwarengewissenhaftschaferswessenschafewarenwohlgepflegeundsorgfaltigkeitbeschutzen', w, h, cap);
	assert.equal(word.size, 3.5, 'never below the minimum: the print page lets it break instead');
	assert.ok(js.badgeNameFit('Mary Ann', w, 8, cap).size <= 8 / 1.2, 'one line must fit the height');
	assert.ok(js.badgeNameFit('', w, h, cap).size > 0);
});

test('names and affiliations typed all in one case are flagged, never changed', () => {
	assert.equal(js.badgeCaseFlag('amy brown'), 'lower');
	assert.equal(js.badgeCaseFlag('AMY BROWN'), 'upper');
	assert.equal(js.badgeCaseFlag('IMPERIAL'), 'upper');
	assert.equal(js.badgeCaseFlag('UCL'), '', 'short initialisms are fine');
	assert.equal(js.badgeCaseFlag('MIT'), '');
	assert.equal(js.badgeCaseFlag("O'Neill"), '');
	assert.equal(js.badgeCaseFlag('van der Sande'), '', 'mixed case');
	assert.equal(js.badgeCaseFlag('McDonald'), '');
	assert.equal(js.badgeCaseFlag('siobhán'), 'lower');
	assert.equal(js.badgeCaseFlag('李'), '', 'no case to speak of');
	assert.equal(js.badgeCaseFlag(''), '');
});

test('the logo goes in the top corner of a landscape badge, a banner across the top; a choice wins', () => {
	const a = preset('avery-4822');
	const portrait = { ...a, badge_w: 60, badge_h: 90, sheet_w: 210, cols: 2 };
	assert.equal(js.badgeLogoPosition(a, 7087 / 4905, 'auto'), 'corner', 'AMYBO\'s logo on a landscape badge');
	assert.equal(js.badgeLogoPosition(a, 7087 / 9493, 'auto'), 'corner', 'a tall one too');
	assert.equal(js.badgeLogoPosition(a, 0, 'auto'), 'corner', 'shape unknown');
	assert.equal(js.badgeLogoPosition(a, 400 / 120, 'auto'), 'top', 'a banner');
	assert.equal(js.badgeLogoPosition(portrait, 0.75, 'auto'), 'top', 'portrait badge');
	for (const p of ['right', 'left', 'top', 'corner']) assert.equal(js.badgeLogoPosition(a, 0.75, p), p);
	const C = js.badgeLayout(a, { logo: 'x', logoAspect: 7087 / 4905, logoPosition: 'auto', tag: 'EVENT’26', tagWidth: 0.64, showTitle: false, oneLine: false });
	assert.equal(C.pos, 'corner');
	assert.ok(near(C.logoW, 19.8), 'about 20 mm wide on a 90 mm badge: ' + C.logoW);
	assert.ok(near(C.logoH, 13.7), 'its height from its shape: ' + C.logoH);
	assert.ok(near(C.tagW, 12.7), 'the tag line 0.64 of the logo\'s width: ' + C.tagW);
	assert.ok(C.pad >= 4.5 && C.pad <= 5, 'about 5 mm margins');
	assert.equal(C.tw, C.iw, 'the names run the full width');
	assert.ok(C.headH + C.gap + C.givenH + C.familyH + C.affH + 3 * C.gap <= C.ih + 0.1);
	assert.ok(C.givenH > C.familyH && C.familyH > C.affH);
	const tall = js.badgeLayout(a, { logo: 'x', logoAspect: 0.5, logoPosition: 'corner', showTitle: false });
	assert.ok(tall.logoH <= 0.3 * tall.ih + 0.1, 'a tall logo is narrowed rather than allowed to crowd the names');
	const L = js.badgeLayout(a, { logo: 'x', logoAspect: 0.75, logoPosition: 'right', showTitle: false, oneLine: false });
	assert.equal(L.logoW, 30, 'a side column: a third of the badge width');
	assert.ok(near(L.tw + L.logoW + L.colGap, L.iw), 'the text has the rest of the width');
	assert.ok(L.givenH > L.familyH && L.familyH > L.affH);
});

test('the logo is capped so the name keeps most of the badge; given name gets the most room', () => {
	const a = preset('avery-4822');
	const L = js.badgeLayout(a, { logo: 'x', showTitle: false, oneLine: false });
	assert.ok(L.logoH <= 0.27 * a.badge_h + 0.01, String(L.logoH));
	assert.ok(L.givenH > L.familyH && L.familyH > L.affH, JSON.stringify(L));
	const total = L.logoH + L.titleH + L.givenH + L.familyH + L.affH + 4 * L.gap;
	assert.ok(total <= L.ih + 0.2, `${total} > ${L.ih}`);
	const one = js.badgeLayout(a, { logo: '', showTitle: true, oneLine: true });
	assert.equal(one.familyH, 0);
	assert.ok(one.givenH > L.givenH);
});

test('the print page: page size, one section per sheet, names as typed and escaped, the key only when asked', () => {
	const a = preset('avery-4822');
	const people = [{ given: 'amy', family: 'brown', affiliation: 'UCL', no_images: true }, { given: '<b>Bo</b>', family: 'Ng', affiliation: null, no_images: false }];
	const html = js.badgeSheetHtml({ title: 'Imperial & Friends', people, blanks: 14, geometry: a, logo: '', guides: false, markNoImages: false, oneLine: false, showTitle: true, colour: '#007CBB', font: null });
	assert.match(html, /@page \{ size: 210mm 297mm; margin: 0; \}/);
	assert.match(html, /class="badge pos-none"/, 'no logo: nothing beside the text');
	assert.equal((html.match(/<section class="sheet"/g) || []).length, 2, '16 badges on 2 sheets of 8');
	assert.equal((html.match(/class="badge pos-/g) || []).length, 16);
	assert.equal((html.match(/class="badge pos-none blank"/g) || []).length, 14);
	assert.match(html, />amy</, 'printed as typed');
	assert.match(html, /&lt;b&gt;Bo&lt;\/b&gt;/);
	assert.doesNotMatch(html, /<b>Bo/);
	assert.match(html, /Imperial &amp; Friends/);
	assert.match(html, /color: #007CBB/);
	assert.doesNotMatch(html, /text-transform/, 'never re-cased by CSS either');
	assert.doesNotMatch(html, /crossed-out camera/, 'no key unless asked');
	assert.doesNotMatch(html, /outline: 0.2mm dashed/, 'no cut lines unless asked');
	const marked = js.badgeSheetHtml({ title: 'T', people, blanks: 0, geometry: a, logo: 'data:image/svg+xml;base64,AAAA', guides: true, markNoImages: true, oneLine: true, showTitle: false, colour: 'red', font: { family: 'Montserrat SemiBold', url: 'https://example.org/f/Montserrat-SemiBold.woff2' } });
	assert.equal((marked.match(/class="noimg" title=/g) || []).length, 1, 'only on the badge of the person who asked');
	assert.equal((marked.match(/class="legend"/g) || []).length, 1, 'the key on the sheet, in the 28.5 mm below the badges');
	assert.match(marked, /outline: 0.2mm dashed/);
	assert.match(marked, /color: #000000/, 'a colour that is not #rrggbb falls back to black');
	assert.match(marked, /@font-face \{ font-family: "Montserrat SemiBold"; src: url\("https:\/\/example.org\/f\/Montserrat-SemiBold.woff2"\) format\("woff2"\); font-weight: 1 1000;/);
	assert.match(marked, /font-family: "Montserrat SemiBold", Arial/);
	assert.match(marked, /aria-label="Name: amy brown, badge 1"/, 'one line: the full name');
	assert.match(marked, /<img src="data:image\/svg\+xml;base64,AAAA" alt="">/);
	assert.match(marked, /class="badge pos-corner"/, 'shape unknown, landscape badge: the corner');
	const side = js.badgeSheetHtml({ title: 'T', people, blanks: 1, geometry: a, logo: 'l.svg', logoAspect: 0.75, logoPosition: 'right', guides: false, markNoImages: false, oneLine: false, showTitle: false, colour: '', font: null });
	assert.match(side, /class="badge pos-right"/);
	assert.match(side, /class="badge pos-right blank"/, 'blanks keep the same layout');
	assert.match(side, /class="logo" style="width:30mm;/);
	assert.doesNotMatch(marked.slice(0, marked.indexOf('<script>')), /<\/script>/);
	const amybo = js.badgeSheetHtml({ title: 'T', people: [{ given: 'Anne-Marie', family: 'St. Clair-Jones', affiliation: 'X', no_images: false }], blanks: 1, geometry: a, logo: 'l.svg', logoAspect: 1.44, logoPosition: 'auto',
		tag: 'EVENT’26', tagColour: '#007CBB', tagWidth: 0.64, colour: '#000000', affColour: '#007cbb', accent: '#87BD25', guides: false, markNoImages: false, oneLine: false, showTitle: false, font: null });
	assert.match(amybo, /class="badge pos-corner"/);
	assert.match(amybo, /class="badge pos-corner blank"/, 'blanks keep the same layout');
	assert.equal((amybo.match(/>EVENT’26</g) || []).length, 2, 'the tag on every badge, named or blank');
	assert.match(amybo, /\.mark-block \.tag \{ color: #007CBB;[^}]*width: 12\.\dmm; align-self: flex-end; text-align: right;/);
	assert.match(amybo, /\.aff \{ color: #007cbb; \} \.acc \{ color: #87BD25; \}/);
	assert.match(amybo, /<body data-accent="1">/, 'the print page draws the dots on i and j (measured there, from the font)');
	assert.match(amybo, /\.tt \{ display: inline-block; color: #87BD25; \}/);
	assert.match(amybo, />Anne-Marie</, 'the real text is in the page; the drawing is added by the print page');
	assert.match(html, /<body>/, 'no accent unless asked');
	// A sheet with no room below the badges puts the key on a page of its own.
	const l4785 = js.badgeSheetHtml({ title: 'T', people, blanks: 0, geometry: { ...preset('avery-l4785'), margin_top: 22 }, logo: '', guides: false, markNoImages: true, oneLine: false, showTitle: true, colour: '', font: null });
	assert.match(l4785, /class="sheet key"/);
	assert.match(l4785, /plain paper/);
});

test('guillotine marks: strips from the margins, then badges from each strip, and no lines around the badges', () => {
	const a = preset('avery-4822');
	const m = js.badgeCutMarks(a);
	const v = m.filter((x) => x.v), hz = m.filter((x) => !x.v);
	assert.deepEqual([...new Set(v.map((x) => x.x))], [10, 100, 110, 200], 'a line at each column edge');
	assert.equal(v.length, 8, 'four above and four below');
	assert.ok(v.every((x) => x.y + x.len <= 27.5 + 0.001 || x.y >= 269.5 - 0.001), 'all in the margins, clear of the badges, so they are cut away');
	assert.equal(hz.length, 10, 'five row edges in each of two strips');
	assert.deepEqual([...new Set(hz.map((x) => x.y))], [28.5, 88.5, 148.5, 208.5, 268.5]);
	assert.ok(hz.every((x) => [100, 200].some((r) => near(x.x + x.len, r)) && x.len <= 2), 'short, ending at the strip\'s right-hand edge');
	// A gap between rows gives each badge its own top and bottom mark.
	assert.equal(js.badgeCutMarks({ ...a, rows: 2, gap_y: 5 }).filter((x) => !x.v && x.x < 100).length, 4);
	const people = [{ given: 'Amy', family: 'Brown', affiliation: null, no_images: false }];
	const html = js.badgeSheetHtml({ title: 'T', people, blanks: 0, geometry: a, logo: '', guides: 'marks', markNoImages: false, oneLine: false, showTitle: false, colour: '', font: null });
	assert.equal((html.match(/class="cm c[vh]"/g) || []).length, 18);
	assert.doesNotMatch(html, /outline: 0.2mm dashed/);
	assert.doesNotMatch(html, /\.cm \{[^}]*background/, 'drawn with borders: browsers leave backgrounds out of a print');
	assert.match(js.badgeSheetHtml({ title: 'T', people, blanks: 0, geometry: a, logo: '', guides: 'lines', markNoImages: false, oneLine: false, showTitle: false, colour: '', font: null }), /outline: 0.2mm dashed/);
});

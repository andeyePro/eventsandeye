#!/usr/bin/env node
// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../LICENSE.
/**
 * Browser test of name badges: the admin page's Name badges section (with the harness's AMYBO settings: Avery 4822,
 * brand blue, a site font) and the print page it opens. Measures what would be printed: the sheet's size and every
 * badge's place on it against the Avery geometry, that no name, family name or affiliation overflows its badge, the
 * order and sizes of the lines, the logo, the font and colour, the case check and correcting a name in place, and the
 * PDF Chromium prints (page count and size). axe checks the admin section and the print page.
 *
 *   SITE_DIR=… PORT=8798 node tests/browser/badges.mjs
 *
 * BADGE_SHOTS (default: a temporary folder) gets a PNG of the first printed sheet and the PDF, for a person to look at.
 * BADGE_TEST_LOGO and BADGE_TEST_FONT may name a real logo (SVG) and font file (TTF) to use instead of the stand-ins.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import * as h from './harness.mjs';

const require = createRequire(import.meta.url);
const { BASE, EVENT, check } = h;
const SHOTS = process.env.BADGE_SHOTS || join(tmpdir(), 'eventsandeye-badge-shots');
mkdirSync(SHOTS, { recursive: true });
const PX = 96 / 25.4; // CSS pixels per millimetre
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
async function registerAndConfirm(name, over = {}) {
	const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@example.org`;
	const r = await post('/api/rsvp/register', { event: EVENT, name, email, attendance: 'in_person', tour_id: 'none', consent: true, website: '', 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX', ...over });
	if (!r.ok) throw new Error(`register ${name}: ${JSON.stringify(r)}`);
	const t = new URL(await h.linkFor(email, 'confirm')).searchParams.get('t');
	const c = await post('/api/rsvp/confirm', { t });
	if (!c.ok) throw new Error(`confirm ${name}: ${JSON.stringify(c)}`);
}
// A tall logo like AMYBO's (7087 × 9493: the name over "EVENT 2026"), and a wide lockup for the band across the top.
const TALL = process.env.BADGE_TEST_LOGO ? readFileSync(process.env.BADGE_TEST_LOGO, 'utf8') : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7087 9493"><g font-family="Arial" font-weight="700" fill="#000"><text x="0" y="2100" font-size="2600">AMY</text><circle cx="1500" cy="4100" r="300" fill="#7ab929"/><text x="1900" y="4600" font-size="2600">BO</text><text x="0" y="7000" font-size="2300">EVENT</text><text x="1500" y="9400" font-size="2300">2026</text></g></svg>';
const WIDE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120"><rect x="150" y="4" width="100" height="56" rx="10" fill="#007CBB"/><text x="200" y="88" font-family="Arial" font-size="26" font-weight="700" text-anchor="middle" fill="#007CBB">EVENT</text><text x="200" y="116" font-family="Arial" font-size="22" text-anchor="middle" fill="#007CBB">2026</text></svg>';
// The site's own font (BADGE_FONT_URL in the harness) is served from a file here: BADGE_TEST_FONT, or any bold
// TrueType font on the machine.
const FONT = [process.env.BADGE_TEST_FONT, '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'].filter(Boolean).find(existsSync);

const people = [
	['Ada Lovelace', { affiliation: 'Analytical Engine Society' }],
	['zed adams', { affiliation: 'UCL' }], // all lower case: flagged, printed as typed
	['Ludwig van Beethoven', { no_images: true }],
	['Bartholomew Montgomery-Fotheringham-Smythe', { affiliation: 'The Royal Institution of Great Britain and Northern Ireland' }],
	["Siobhán O'Neill", { affiliation: 'IMPERIAL COLLEGE LONDON' }], // all capitals: flagged
	['Wolfeschlegelsteinhausenbergerdorff', {}], // one long word: must shrink, and break if it must
	['Bo Ng', {}],
];

let failed = false;
try {
	await h.start();
	// 12 places: 7 named, so 5 blanks fill the room and 4 more fill the second sheet of 8.
	h.sql(`UPDATE events SET in_person_max=12 WHERE id='${EVENT}'`);
	for (const [name, over] of people) await registerAndConfirm(name, over);
	await registerAndConfirm('Rita Remote', { attendance: 'remote' });

	const ctx = await h.context({ admin: true });
	if (FONT) await ctx.route('**/fonts/badge-test.ttf', (r) => r.fulfill({ contentType: 'font/ttf', body: readFileSync(FONT) }));
	const page = await ctx.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	await page.goto(`${BASE}/admin/rsvps/?event=${EVENT}`);
	await page.waitForSelector('#msgs tbody tr');

	console.log('The admin section');
	check('the Avery 4822 sheet is preselected from BADGE_TEMPLATE', (await page.inputValue('#b-preset')) === 'avery-4822');
	check('its geometry is filled in: 90 × 60 mm, 2 × 4 on A4', (await page.inputValue('#b-badge_w')) === '90' && (await page.inputValue('#b-rows')) === '4' && (await page.inputValue('#b-sheet_h')) === '297');
	check('the colour starts at BADGE_COLOUR', (await page.inputValue('#b-colour')).toLowerCase() === '#007cbb');
	const who = await page.textContent('#b-who');
	check('7 named badges (the remote attendee is not one)', /^7 named badges/.test(who), who);
	const count = await page.textContent('#b-count');
	check('7 named and 9 blank on 2 sheets of 8', /7 named and 9 blank: 16 badges on 2 sheets of 8/.test(count), count);
	check('the inclusion rule is on the page', /confirmed in-person attendee with a place/.test(await page.textContent('#badges')));
	await page.fill('#b-blanks', '1');
	check('typing a number of blanks uses it as it is', /7 named and 1 blank: 8 badges on 1 sheet of 8/.test(await page.textContent('#b-count')));
	await page.fill('#b-blanks', '');
	await page.$eval('#badges details', (d) => { d.open = true; });
	await page.fill('#b-cols', '3');
	check('a layout too wide for the sheet is explained', /mm across/.test(await page.textContent('#b-count')) && (await page.inputValue('#b-preset')) === 'custom');
	await page.selectOption('#b-preset', 'avery-4822');
	check('choosing the sheet again restores its geometry', (await page.inputValue('#b-cols')) === '2');
	await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
	const v = (await page.evaluate(() => window.axe.run({ include: ['#badges'] }, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }))).violations;
	check('axe: no violations in the Name badges section', !v.length, JSON.stringify(v.map((x) => [x.id, x.nodes.map((n) => n.target.join(' '))])));
	await page.screenshot({ path: join(SHOTS, 'admin-section.png'), clip: await page.locator('#badges').boundingBox() });

	await page.setInputFiles('#b-logo', { name: 'amybo-event-2026.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(TALL) });
	await page.waitForTimeout(300);
	await page.check('#b-noimg');
	await page.uncheck('#b-title'); // the lockup says it already

	console.log('The print page');
	const [print] = await Promise.all([ctx.waitForEvent('page'), page.click('#badge-form button[type=submit]')]);
	print.on('pageerror', (e) => errors.push(String(e)));
	await print.waitForSelector('body[data-fitted="1"]');
	await print.evaluate(() => document.fonts.ready);
	await print.waitForFunction(() => [...document.images].every((i) => i.complete));
	const m = await print.evaluate(() => {
		const r = (el) => el.getBoundingClientRect();
		const sheets = [...document.querySelectorAll('.sheet:not(.key)')];
		return {
			sheets: sheets.map((s) => ({ w: r(s).width, h: r(s).height })),
			badges: sheets.flatMap((s, si) => [...s.querySelectorAll('.badge')].map((b) => {
				const sr = r(s), br = r(b);
				const parts = [...b.querySelectorAll('.fit')].map((f) => ({ cls: f.className, text: f.textContent, size: parseFloat(getComputedStyle(f).fontSize), over: f.scrollWidth > f.clientWidth + 1 || f.scrollHeight > f.clientHeight + 1, outside: r(f).left < br.left - 0.5 || r(f).right > br.right + 0.5 || r(f).top < br.top - 0.5 || r(f).bottom > br.bottom + 0.5 }));
				return { sheet: si, left: br.left - sr.left, top: br.top - sr.top, w: br.width, h: br.height, blank: b.classList.contains('blank'), parts, mark: !!b.querySelector('.noimg') };
			})),
			logo: (() => { const i = document.querySelector('.badge .logo img'), b = i.closest('.badge'), t = b.querySelector('.text'); return i && { ok: i.complete && i.naturalWidth > 0, pos: b.className, box: r(i.parentElement), badge: r(b), text: r(t), align: getComputedStyle(t.querySelector('.given')).textAlign }; })(),
			legend: document.querySelectorAll('.sheet .legend').length,
			flagged: [...document.querySelectorAll('.edit.check')].map((e) => e.textContent),
			checks: document.getElementById('checks').hidden ? '' : document.getElementById('checks').textContent,
			colour: getComputedStyle(document.querySelector('.badge .given')).color,
			font: getComputedStyle(document.querySelector('.badge .given')).fontFamily,
			fontLoaded: document.fonts.check('700 12px "Badge Test"'),
			transform: [...document.querySelectorAll('.fit')].some((e) => getComputedStyle(e).textTransform !== 'none'),
			page: [...document.styleSheets[0].cssRules].find((x) => x.type === 6)?.cssText ?? '',
		};
	});
	check('two sheets, each 210 × 297 mm', m.sheets.length === 2 && m.sheets.every((s) => near(s.w, 210 * PX) && near(s.h, 297 * PX)), JSON.stringify(m.sheets));
	check('@page is A4 with no margin', /size: 210mm 297mm/.test(m.page) && /margin: 0/.test(m.page), m.page);
	check('16 badges: 7 named, then 9 blank', m.badges.length === 16 && m.badges.slice(0, 7).every((b) => !b.blank) && m.badges.slice(7).every((b) => b.blank));
	const want = (i) => ({ left: 15 + (i % 2) * 90, top: 28.5 + Math.floor(i / 2) * 60 });
	check('every badge is 90 × 60 mm, in the Avery 4822 grid (15 mm in, 28.5 mm down, no gaps)', m.badges.every((b, i) => near(b.w, 90 * PX) && near(b.h, 60 * PX) && near(b.left, want(i % 8).left * PX) && near(b.top, want(i % 8).top * PX)),
		JSON.stringify(m.badges.slice(0, 3).map((b) => [b.left / PX, b.top / PX, b.w / PX, b.h / PX])));
	const bad = m.badges.flatMap((b) => b.parts.filter((p) => p.over || p.outside).map((p) => `${p.cls}: ${p.text}`));
	check('nothing overflows its box or its badge', !bad.length, bad.join(' | '));
	const named = m.badges.filter((b) => !b.blank);
	const line = (b, cls) => b.parts.find((p) => p.cls.includes(cls));
	check('sorted by family name: adams, Lovelace, Montgomery-…, Ng, O\'Neill, van Beethoven, then the one-word name', named.map((b) => line(b, 'family').text || line(b, 'given').text).join(',') === "adams,Lovelace,Montgomery-Fotheringham-Smythe,Ng,O'Neill,van Beethoven,Wolfeschlegelsteinhausenbergerdorff", named.map((b) => line(b, 'family').text).join(','));
	check('given name largest, then family name, then affiliation, on every named badge', named.every((b) => line(b, 'given').size > line(b, 'family').size && line(b, 'family').size > line(b, 'aff').size || !line(b, 'family').text), JSON.stringify(named.map((b) => b.parts.map((p) => Math.round(p.size)))));
	check('a short given name is big (at least 9 mm, about 26 pt)', line(named.find((b) => line(b, 'given').text === 'Ada'), 'given').size >= 9 * PX, String(line(named[1], 'given').size / PX));
	check('names and affiliations are printed exactly as typed, never re-cased', named.some((b) => line(b, 'given').text === 'zed') && named.some((b) => line(b, 'aff').text === 'IMPERIAL COLLEGE LONDON') && !m.transform);
	check('the all-lower-case and all-capitals entries are flagged', ['zed', 'adams', 'IMPERIAL COLLEGE LONDON'].every((t) => m.flagged.includes(t)) && m.flagged.length === 3 && /3 names or affiliations/.test(m.checks), JSON.stringify([m.flagged, m.checks]));
	const lg = m.logo;
	check('a tall logo on a landscape badge goes in a column on the right, a third of the width, centred top to bottom', lg?.ok && /pos-right/.test(lg.pos) && near(lg.box.width, 30 * PX) && near(lg.box.right, lg.badge.right - 4.8 * PX, 2) && near((lg.box.top + lg.box.bottom) / 2, (lg.badge.top + lg.badge.bottom) / 2, 2), JSON.stringify(lg));
	check('…with the names on the left, left-aligned, clear of the logo', lg.text.right <= lg.box.left + 0.5 && near(lg.text.left, lg.badge.left + 4.8 * PX, 2) && lg.align === 'left', JSON.stringify([lg.text, lg.align]));
	check('blank badges keep the logo column', m.badges.at(-1).blank && (await print.locator('.badge.blank.pos-right .logo img').count()) === 9);
	check('the no-images mark is on Beethoven\'s badge only, with the key on each sheet', named.filter((b) => b.mark).length === 1 && line(named.find((b) => b.mark), 'family').text === 'van Beethoven' && m.legend === 2);
	check('text in BADGE_COLOUR (#007CBB)', m.colour === 'rgb(0, 124, 187)', m.colour);
	check('the site font is named first', /^"Badge Test"/.test(m.font), m.font);
	if (FONT) check('…and loaded from BADGE_FONT_URL', m.fontLoaded);
	else console.log('  (no bold TrueType font on this machine to stand in for the site font: not loaded)');

	// Correcting a name in place: refitted as typed, the flag goes, and nothing is saved.
	const zed = print.locator('.edit', { hasText: /^zed$/ });
	await zed.click();
	await print.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
	await print.keyboard.type('Zed Maximilian-Alexander');
	await print.keyboard.press('Enter');
	const after = await print.evaluate(() => { const e = [...document.querySelectorAll('.edit')].find((x) => x.textContent.startsWith('Zed')); return { text: e.textContent, over: e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1, flagged: e.classList.contains('check'), checks: document.getElementById('checks').textContent }; });
	check('a name corrected in the print page is refitted and no longer flagged', after.text === 'Zed Maximilian-Alexander' && !after.over && !after.flagged && /^2 names/.test(after.checks), JSON.stringify(after));
	const pv = (await (await fetch(`${BASE}/api/admin/summary?event=${EVENT}`, { headers: { 'cf-access-jwt-assertion': h.jwt() } })).json()).badges.people;
	check('…and not saved', pv.some((p) => p.given === 'zed') && !pv.some((p) => p.given.startsWith('Zed')));

	await print.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
	const pvv = (await print.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }))).violations;
	check('axe: no violations on the print page', !pvv.length, JSON.stringify(pvv.map((x) => [x.id, x.nodes.slice(0, 3).map((n) => n.target.join(' '))])));

	console.log('Printing');
	await print.emulateMedia({ media: 'print' });
	const printed = await print.evaluate(() => ({ bar: getComputedStyle(document.querySelector('.bar')).display, outline: getComputedStyle(document.querySelector('.edit.check')).outlineStyle }));
	check('printed: no toolbar, no case-check outlines', printed.bar === 'none' && printed.outline === 'none', JSON.stringify(printed));
	await print.setViewportSize({ width: 1000, height: 1300 });
	await print.locator('.sheet').first().screenshot({ path: join(SHOTS, 'avery-4822-sheet-1.png'), scale: 'device' });
	const pdf = await print.pdf({ preferCSSPageSize: true, printBackground: true });
	writeFileSync(join(SHOTS, 'avery-4822.pdf'), pdf);
	const text = pdf.toString('latin1');
	const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
	const box = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(text);
	check('the PDF has 2 A4 pages', pages === 2 && box && near(+box[1], 595.28, 2) && near(+box[2], 841.89, 2), JSON.stringify([pages, box?.slice(1)]));

	console.log('Other choices');
	await page.setInputFiles('#b-logo', { name: 'wide.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(WIDE) });
	await page.waitForTimeout(300);
	await page.selectOption('#b-names', 'one');
	await page.check('#b-title');
	await page.selectOption('#b-preset', 'plain-a4');
	const [one] = await Promise.all([ctx.waitForEvent('page'), page.click('#badge-form button[type=submit]')]);
	await one.waitForSelector('body[data-fitted="1"]');
	const o = await one.evaluate(() => ({ sheets: document.querySelectorAll('.sheet:not(.key)').length, family: document.querySelectorAll('.badge .family').length, title: document.querySelectorAll('.badge .title').length,
		guides: getComputedStyle(document.querySelector('.badge')).outlineStyle, top: document.querySelector('.badge').classList.contains('pos-top'),
		logoH: document.querySelector('.badge .logo').getBoundingClientRect().height, badgeH: document.querySelector('.badge').getBoundingClientRect().height, align: getComputedStyle(document.querySelector('.badge .given')).textAlign, full: document.querySelector('.badge .given').textContent,
		over: [...document.querySelectorAll('.fit')].filter((f) => f.scrollWidth > f.clientWidth + 1 || f.scrollHeight > f.clientHeight + 1).map((f) => f.textContent) }));
	check('plain A4: one badge a page, 12 pages (7 named, 5 blanks for the room), cut lines on', o.sheets === 12 && o.guides === 'dashed', JSON.stringify(o));
	check('full name on one line: no separate family name, and the event title is printed', o.family === 0 && o.title === 12 && o.full === 'zed adams', JSON.stringify(o));
	check('a wide logo goes across the top, at most about a quarter of the badge high, with the names centred beneath', o.top && o.logoH <= 0.27 * o.badgeH + 1 && o.align === 'center', JSON.stringify(o));
	check('…and still nothing overflows', !o.over.length, o.over.join(' | '));
	await one.screenshot({ path: join(SHOTS, 'plain-a4.png') });
	check('no errors in the pages', !errors.length, errors.join(' | '));
	check('nothing went to a third party', !h.thirdParty.length, h.thirdParty.join(' | '));
	await ctx.close();
} catch (e) {
	failed = true;
	console.error(e);
	console.error(h.log().slice(-3000));
} finally {
	await h.stop();
}
const { passes, failures } = h.results();
console.log(`\n${passes} passed, ${failures} failed. Sheet image and PDF in ${SHOTS}.`);
process.exit(failures || failed ? 1 : 0);

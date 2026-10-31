#!/usr/bin/env node
// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../LICENSE.
/**
 * Accessibility and presentation sweep, to WCAG 2.2 AA, of every page and state an attendee or organiser can reach on
 * the starter site: the home, events, privacy and 404 pages, the booking form (empty, refused by the browser, refused by
 * the server), check-email, confirm (valid, already used, expired, tampered, incomplete), manage (in person, remote,
 * dinner only, waiting list, with a poll, cancelled) and the admin page.
 *
 * Each page is run through axe in light and dark, then measured in the page itself: text contrast, the borders of
 * inputs, focus indicators while tabbing, tab order against the layout, reflow at 320 px and at 200% zoom, the WCAG
 * text-spacing override, and forced colours. Screenshots go to A11Y_SHOTS, to be looked at, not only counted.
 *
 *   SITE_DIR=… PORT=8796 node tests/browser/a11y.mjs
 *
 * Checks introduced by "Fixed …" comments guard against bugs this test found.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import * as h from './harness.mjs';

const SHOTS = process.env.A11Y_SHOTS || join(process.env.TMPDIR || '/tmp', 'eventsandeye-a11y');
mkdirSync(SHOTS, { recursive: true });
const DINNER = '2026-11-13-london-pub';
const POLL = '2026-11-13-london-saturday';
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

const post = (path, body) => fetch(h.BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const register = (over) => post('/api/rsvp/register', {
	event: h.EVENT, name: 'Test Person', email: `${randomUUID()}@example.org`, attendance: 'in_person', tour_id: 'none',
	consent: true, website: '', 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX', ...over,
});
async function registerAndConfirm(over) {
	await register(over);
	const confirm = await h.linkFor(over.email, 'confirm');
	await post('/api/rsvp/confirm', { t: decodeURIComponent(new URL(confirm).searchParams.get('t')) });
	return { confirm, manage: await h.linkFor(over.email, 'manage') };
}
/** A link token as the server signs it, with a chosen expiry, to show the page an expired link gives. */
function tokenWithExpiry(purpose, id, expS) {
	const secret = /^TOKEN_SECRET=(.*)$/m.exec(readFileSync(join(h.SITE, '.dev.vars'), 'utf8'))[1];
	const exp = expS.toString(36);
	return `${id}.${exp}.${createHmac('sha256', secret).update(`${purpose}:${id}:${exp}`).digest('base64url')}`;
}

// ---- measurements made inside the page ----
// One function, so every page is judged by the same arithmetic. It returns plain data for the checks below.
const MEASURE = () => {
	const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
	const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
	const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
	const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
	// The page's own canvas: what an unstyled background really is in this colour scheme.
	const probe = document.createElement('div'); probe.style.background = 'Canvas'; document.body.append(probe);
	const canvas = parse(getComputedStyle(probe).backgroundColor); probe.remove();
	const bgOf = (el) => {
		const layers = [];
		for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a === 1) break; } }
		return layers.reverse().reduce((acc, c) => blend(c, acc), canvas);
	};
	const opacity = (el) => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
	const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.closest('[hidden],[aria-hidden="true"]'); };
	const name = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} "${(el.textContent || el.value || '').trim().slice(0, 40)}"`;
	const disabled = (el) => el.closest(':disabled, fieldset:disabled') !== null;

	// Text: every element with its own text, its colour (with opacity) over what is really behind it.
	const text = [];
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	const seen = new Set();
	for (let n; (n = walker.nextNode());) {
		const el = n.parentElement;
		if (!n.textContent.trim() || seen.has(el) || !visible(el) || disabled(el) || el.closest('noscript')) continue;
		seen.add(el);
		const s = getComputedStyle(el), fg = parse(s.color); const bg = bgOf(el);
		const c = blend({ ...fg, a: fg.a * opacity(el) }, bg);
		const px = parseFloat(s.fontSize), bold = Number(s.fontWeight) >= 700;
		const large = px >= 24 || (bold && px >= 18.66);
		text.push({ el: name(el), ratio: +ratio(c, bg).toFixed(2), need: large ? 3 : 4.5 });
	}
	// Input borders (1.4.11): the edge is what shows where to type, against what is around the field.
	const borders = [...document.querySelectorAll('input[type=text],input[type=email],input[type=number],input[type=datetime-local],textarea,select')]
		.filter((el) => visible(el) && !disabled(el)).map((el) => {
			const s = getComputedStyle(el); const around = bgOf(el.parentElement);
			const b = parse(s.borderTopColor); const w = parseFloat(s.borderTopWidth);
			return { el: name(el), ratio: w > 0 && b ? +ratio(blend({ ...b, a: b.a * opacity(el) }, around), around).toFixed(2) : 0 };
		});
	// Bordered buttons with no fill: their border is the only thing that marks the target out from the page.
	const outlined = [...document.querySelectorAll('button')].filter((el) => visible(el) && !disabled(el)).map((el) => {
		const s = getComputedStyle(el); const fill = parse(s.backgroundColor);
		if (!fill || fill.a > 0 || parseFloat(s.borderTopWidth) === 0) return null;
		const around = bgOf(el.parentElement); const b = parse(s.borderTopColor);
		return { el: name(el), ratio: +ratio(blend(b, around), around).toFixed(2) };
	}).filter(Boolean);
	const h1 = document.querySelectorAll('h1').length;
	const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map((e) => Number(e.tagName[1]));
	const skipped = levels.some((l, i) => i > 0 && l > levels[i - 1] + 1);
	return {
		text, borders, outlined, h1, skipped, lang: document.documentElement.lang, title: document.title,
		main: document.querySelectorAll('main, [role=main]').length,
		hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
		motion: document.getAnimations().length,
	};
};

/** Tabs through the page: what has focus, whether that shows, and where it is on screen. */
async function tabWalk(page, shotPrefix) {
	await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
	await page.mouse.click(1, 1);
	const stops = [];
	for (let i = 0; i < 80; i++) {
		await page.keyboard.press('Tab');
		const s = await page.evaluate(() => {
			const el = document.activeElement;
			if (!el || el === document.body) return null;
			const st = getComputedStyle(el); const r = el.getBoundingClientRect();
			const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
			const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
			const probe = document.createElement('div'); probe.style.background = 'Canvas'; document.body.append(probe);
			const canvas = parse(getComputedStyle(probe).backgroundColor); probe.remove();
			let bg = canvas; for (let e = el.parentElement; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a === 1) { bg = c; break; } }
			const oc = parse(st.outlineColor);
			const ocRatio = oc ? (() => { const [x, y] = [lum(oc), lum(bg)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); })() : 0;
			// Chromium's 'auto' ring is two-tone (dark and light), so it shows on any background.
			// Date and time fields take focus on a part inside them, which Chromium rings and highlights itself.
			const ring = /^(date|time|datetime-local|month|week)$/.test(el.type) || st.outlineStyle === 'auto' || (st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) >= 1 && ocRatio >= 3) || st.boxShadow !== 'none';
			return { el: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.type ? '[' + el.type + ']' : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`,
				x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, ring, style: `${st.outlineStyle} ${st.outlineWidth} ${st.outlineColor}`, key: el.id || el.outerHTML.slice(0, 80) };
		});
		if (!s || (stops.length && s.key === stops[0].key)) break;
		if (shotPrefix && stops.length < 40) await page.screenshot({ fullPage: true, path: `${shotPrefix}-tab${String(stops.length).padStart(2, '0')}.png`, clip: { x: Math.max(0, s.x - 12), y: Math.max(0, s.y - 12), width: Math.min(600, s.w + 24), height: Math.min(300, s.h + 24) } }).catch(() => {});
		stops.push(s);
	}
	return stops;
}
/** Tab stops that go back up the page, or leftwards on the same line: tab order not matching what is seen. */
// Two stops are on one line when their boxes overlap vertically (fields in a grid row can sit a little apart).
const outOfOrder = (stops) => stops.filter((s, i) => {
	if (!i) return false;
	const p = stops[i - 1], sameLine = s.y < p.y + p.h && p.y < s.y + s.h;
	return sameLine ? s.x < p.x - 8 : s.y < p.y;
}).map((s) => `${s.el} after ${stops[stops.indexOf(s) - 1].el}`);

const TEXT_SPACING = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }`;
/** Elements whose content no longer fits once text is spaced out, and which hide the rest (overflow not visible). */
const clipped = () => [...document.querySelectorAll('body *')].filter((el) => {
	// Fields scroll their own text by design; only text that cannot be reached counts.
	const s = getComputedStyle(el); if (el.closest('[hidden], .hp, noscript') || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return false;
	const hides = [s.overflowX, s.overflowY].some((o) => o !== 'visible');
	// A box that scrolls on purpose (a wide table) is fine when the keyboard can reach it to scroll.
	if (el.tabIndex >= 0 && [s.overflowX, s.overflowY].some((o) => o === 'auto' || o === 'scroll')) return false;
	return hides && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) && el.clientHeight > 0;
}).map((el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`);

const titles = new Map();
const failedAxe = new Map();

/**
 * Opens the page once per colour scheme, lets ready() bring it to the state under test, and checks it.
 * full adds the layout checks (reflow, zoom, spacing, forced colours, focus), which do not change with the state of a
 * panel as much as with the page, so they run on one state per page to keep the run short.
 */
async function audit(label, urlFor, { ready = async () => {}, admin = false, full = false } = {}) {
	console.log(`\n${label}`);
	// A state that is used up by reaching it (cancelling, say) needs its own link for each colour scheme.
	const urlOf = async (scheme) => (typeof urlFor === 'function' ? urlFor(scheme) : urlFor);
	const url = await urlOf('light');
	for (const colorScheme of ['light', 'dark']) {
		const ctx = await h.context({ admin, colorScheme });
		const page = await ctx.newPage();
		page.on('dialog', (d) => d.accept());
		await page.goto(colorScheme === 'light' ? url : await urlOf('dark'), { waitUntil: 'networkidle' });
		await ready(page);
		await page.waitForTimeout(150);
		const shot = join(SHOTS, `${slug(label)}-${colorScheme}`);
		await page.screenshot({ path: `${shot}.png`, fullPage: true });
		// With no background of its own the page shows the browser's dark canvas, but axe measures it against white, so
		// in dark its colour-contrast rule is wrong until the layout sets one; the measured check below stands in for it.
		const unpainted = await page.evaluate(() => [document.documentElement, document.body].every((e) => /rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(e).backgroundColor)));
		const v = (await h.axe(page)).filter((x) => !(colorScheme === 'dark' && unpainted && x.id === 'color-contrast'));
		h.check(`${label} (${colorScheme}): axe finds nothing`, !v.length, JSON.stringify(v));
		if (colorScheme === 'dark' && !admin && full) {
			// Fixed 2026-10-30, kept as a regression check: a11y-canvas – Base.astro sets color-scheme but no background, so contrast tools judge dark text against white.
			h.check(`${label} (dark): the page paints its own background`, !unpainted);
		}
		const m = await page.evaluate(MEASURE);
		const low = m.text.filter((t) => t.ratio < t.need);
		h.check(`${label} (${colorScheme}): text contrast is at least 4.5:1 (3:1 large)`, !low.length, JSON.stringify(low.slice(0, 6)));
		const faint = m.borders.filter((b) => b.ratio < 3);
		h.check(`${label} (${colorScheme}): input borders are at least 3:1 against the page`, !faint.length, JSON.stringify(faint));
		const thin = m.outlined.filter((b) => b.ratio < 3);
		// Fixed 2026-10-30, kept as a regression check: a11y-danger-dark – the cancel button's #b3261e border is 2.87:1 on the dark canvas.
		h.check(`${label} (${colorScheme}): outlined buttons' borders are at least 3:1`, !thin.length, JSON.stringify(thin));
		if (colorScheme === 'light') {
			h.check(`${label}: one h1, a main landmark, no skipped heading levels`, m.h1 === 1 && m.main === 1 && !m.skipped, JSON.stringify({ h1: m.h1, main: m.main, skipped: m.skipped }));
			const path = new URL(url).pathname;
			// Fixed 2026-10-30, kept as a regression check: a11y-admin-lang – the admin page says lang="en" where every other page says en-GB.
			h.check(`${label}: language is British English`, m.lang === 'en-GB', m.lang);
			h.check(`${label}: has a title`, m.title.trim().length > 3, m.title);
			if (!titles.has(path)) titles.set(path, m.title);
			h.check(`${label}: no animation (prefers-reduced-motion has nothing to stop)`, m.motion === 0, m.motion);
		}
		if (full) {
			const stops = await tabWalk(page, colorScheme === 'light' ? shot : null);
			const unseen = stops.filter((s) => !s.ring);
			h.check(`${label} (${colorScheme}): every tab stop shows focus`, stops.length && !unseen.length, JSON.stringify(unseen.slice(0, 5)));
			if (colorScheme === 'light') {
				const odd = outOfOrder(stops);
				h.check(`${label}: tab order follows the layout`, !odd.length, odd.join('; '));
				// Fixed 2026-10-30, kept as a regression check: a11y-admin-targets – the admin page's stacked <summary> toggles are 22 px tall with no gap (2.5.8).
				const small = stops.filter((s) => (s.w < 24 || s.h < 24) && !/^a /.test(s.el));
				h.check(`${label}: focusable controls (not inline links) are at least 24×24 px or spaced`, !small.length || small.every((s) => /\[(radio|checkbox)\]/.test(s.el)), JSON.stringify(small.slice(0, 5)));
			}
		}
		await ctx.close();
	}
	if (!full) return;
	// Reflow at 320 px, 200% zoom (640 px of CSS width at twice the pixels), and the text-spacing override.
	for (const [what, viewport, deviceScaleFactor] of [['320 px', { width: 320, height: 640 }, 1], ['200% zoom', { width: 640, height: 400 }, 2]]) {
		const ctx = await h.context({ admin, viewport, deviceScaleFactor });
		const page = await ctx.newPage();
		await page.goto(url, { waitUntil: 'networkidle' });
		await ready(page);
		await page.screenshot({ path: join(SHOTS, `${slug(label)}-${slug(what)}.png`), fullPage: true });
		const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		// What sticks out, deepest first, so the report can name the cause.
		const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && ![...e.children].some((c) => c.getBoundingClientRect().right > document.documentElement.clientWidth + 1))
			.slice(0, 6).map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : ''} (${Math.round(e.getBoundingClientRect().width)}px)`));
		// Fixed 2026-10-30, kept as a regression check: a11y-admin-reflow – the admin page scrolls sideways at 320 px.
		h.check(`${label}: no horizontal scroll at ${what}`, over <= 0, `${over}px too wide: ${wide.join(', ')}`);
		if (what === '320 px') {
			await page.addStyleTag({ content: TEXT_SPACING });
			await page.waitForTimeout(100);
			await page.screenshot({ path: join(SHOTS, `${slug(label)}-text-spacing.png`), fullPage: true });
			const c = await page.evaluate(clipped);
			const over2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
			h.check(`${label}: nothing clipped with WCAG text spacing at 320 px`, !c.length && over2 <= 0, `${c.join(', ')} ${over2 > 0 ? over2 + 'px too wide' : ''}`);
		}
		await ctx.close();
	}
	// Forced colours (Windows contrast themes): author backgrounds are dropped, so a button with no border is just text.
	{
		const ctx = await h.context({ admin, forcedColors: 'active' });
		const page = await ctx.newPage();
		await page.goto(url, { waitUntil: 'networkidle' });
		await ready(page);
		await page.screenshot({ path: join(SHOTS, `${slug(label)}-forced-colours.png`), fullPage: true });
		const bare = await page.evaluate(() => [...document.querySelectorAll('button, .button')].filter((b) => {
			const r = b.getBoundingClientRect(); if (!r.width || b.closest('[hidden]')) return false;
			const s = getComputedStyle(b); return parseFloat(s.borderTopWidth) === 0 || s.borderTopStyle === 'none';
		}).map((b) => `${b.id ? '#' + b.id : b.className || 'button'} "${b.textContent.trim().slice(0, 30)}"`));
		// Fixed 2026-10-30, kept as a regression check: a11y-forced-buttons – filled buttons set border: 0, so in forced colours they show as plain text.
		h.check(`${label}: buttons keep a visible edge in forced colours`, !bare.length, bare.join(', '));
		await ctx.close();
	}
}

try {
	await h.start();
	// A poll, so the manage page's ranking list and the form's optional poll are both on show.
	h.sql(`INSERT INTO polls (id, event_id, question, allow_suggestions, created_at) VALUES ('${POLL}', '${h.EVENT}', 'What shall we do on Saturday 14 November?', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')); `
		+ `INSERT INTO poll_options (id, poll_id, label, status, sort, created_at) VALUES ('${POLL}-walk', '${POLL}', 'A walk by the Thames', 'active', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')), `
		+ `('${POLL}-museum', '${POLL}', 'The Science Museum', 'active', 2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);

	const formReady = (p) => p.waitForFunction(() => /closes/.test(document.getElementById('rsvp-availability')?.textContent || ''));

	// ---- static pages ----
	await audit('Home', `${h.BASE}/`, { full: true });
	await audit('Events index', `${h.BASE}/events/`, { full: true });
	await audit('Privacy notice', `${h.BASE}/privacy/`, { full: true });
	await audit('404 page', `${h.BASE}/no-such-page/`, { full: true });
	await audit('Check your email', `${h.BASE}/events/check-email/`, { full: true });

	// ---- the booking form ----
	await audit('Booking form', `${h.BASE}/event/`, { ready: formReady, full: true });
	await audit('Booking form, refused by the browser', `${h.BASE}/event/`, {
		ready: async (p) => { await formReady(p); await p.click('button.submit'); },
	});
	{
		// The browser's own check stops an empty form; it must leave the person on the first field in error.
		const ctx = await h.context(); const p = await ctx.newPage();
		await p.goto(`${h.BASE}/event/`, { waitUntil: 'networkidle' }); await formReady(p);
		await p.click('button.submit');
		h.check('Booking form: an empty submit puts focus on the name field', await p.evaluate(() => document.activeElement?.id) === 'rsvp-name');
		await ctx.close();
	}
	// The server's refusal (an address the browser accepts but the server does not): shown in the status region.
	const serverError = async (p) => {
		await formReady(p);
		await p.fill('#rsvp-name', 'Ann'); await p.fill('#rsvp-email', 'ann@localhost');
		await p.check('input[name=attendance][value=remote]'); await p.check('#rsvp-consent');
		await p.click('button.submit');
		await p.waitForFunction(() => document.getElementById('rsvp-result').textContent.trim().length > 0);
	};
	await audit('Booking form, refused by the server', `${h.BASE}/event/`, { ready: serverError });
	{
		const ctx = await h.context(); const p = await ctx.newPage();
		await p.goto(`${h.BASE}/event/`, { waitUntil: 'networkidle' });
		await serverError(p);
		const r = await p.evaluate(() => { const e = document.getElementById('rsvp-result'); return { role: e.getAttribute('role'), live: e.getAttribute('aria-live'), text: e.textContent, invalid: document.getElementById('rsvp-email').getAttribute('aria-invalid'), described: document.getElementById('rsvp-email').getAttribute('aria-describedby') }; });
		h.check('Booking form: the server\'s error is in a live region', (r.role === 'status' || r.role === 'alert' || r.live) && /email/i.test(r.text), JSON.stringify(r));
		// Fixed 2026-10-30, kept as a regression check: a11y-error-field – the error names the field in words, but the field itself is not marked invalid or tied to it.
		h.check('Booking form: the field in error is marked aria-invalid and described by the error', r.invalid === 'true' && !!r.described, JSON.stringify(r));
		await ctx.close();
	}
	{
		// Success: the form moves to check-email, which must name the address.
		const ctx = await h.context(); const p = await ctx.newPage();
		await p.goto(`${h.BASE}/event/`, { waitUntil: 'networkidle' }); await formReady(p);
		await p.fill('#rsvp-name', 'Bea'); await p.fill('#rsvp-email', 'bea@example.org');
		await p.check('input[name=attendance][value=remote]'); await p.check('#rsvp-consent');
		await Promise.all([p.waitForURL('**/events/check-email/'), p.click('button.submit')]);
		h.check('Booking form: success lands on check-email with the address', /bea@example\.org/.test(await p.textContent('#sent-to')));
		h.check('Check-email after success: axe finds nothing', !(await h.axe(p)).length);
		await ctx.close();
	}

	// ---- confirm ----
	const cal = 'cal@example.org';
	await register({ name: 'Cal', email: cal, attendance: 'in_person' });
	const calConfirm = await h.linkFor(cal, 'confirm');
	await audit('Confirm, valid link', calConfirm, { full: true });
	await audit('Confirm, after the button (done, then already done)', calConfirm, {
		ready: async (p) => { await p.click('#confirm-btn'); await p.waitForFunction(() => /registration/.test(document.getElementById('confirm-result').textContent)); },
	});
	{
		const ctx = await h.context(); const p = await ctx.newPage();
		await p.goto(calConfirm, { waitUntil: 'networkidle' });
		await p.click('#confirm-btn');
		await p.waitForFunction(() => /registration/.test(document.getElementById('confirm-result').textContent));
		h.check('Confirm: focus moves to the result after the button goes', await p.evaluate(() => document.activeElement?.id) === 'confirm-result');
		await ctx.close();
	}
	const calId = decodeURIComponent(new URL(calConfirm).searchParams.get('t')).split('.')[0];
	const expired = `${h.BASE}/events/confirm/?t=${encodeURIComponent(tokenWithExpiry('confirm', calId, Math.floor(Date.now() / 1000) - 60))}`;
	const errorShown = (p) => p.click('#confirm-btn').then(() => p.waitForFunction(() => { const t = document.getElementById('confirm-result').textContent; return t && t !== 'Confirming…'; }));
	await audit('Confirm, expired link', expired, { ready: errorShown });
	await audit('Confirm, tampered link', calConfirm.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), { ready: errorShown });
	await audit('Confirm, incomplete link', `${h.BASE}/events/confirm/`);
	await audit('Confirm, "not me"', `${calConfirm}&not-me=1`);

	// ---- manage ----
	const inPerson = await registerAndConfirm({ name: 'Dee', email: 'dee@example.org', attendance: 'in_person', tour_id: '2026-11-13-london-tour-1030', optins: [DINNER] });
	const manageReady = (p) => p.waitForFunction(() => !document.getElementById('manage-form').hidden || !/Loading/.test(document.getElementById('manage-loading').textContent));
	await audit('Manage, in person with a tour, dinner and a poll', inPerson.manage, { ready: manageReady, full: true });
	{
		const ctx = await h.context(); const p = await ctx.newPage();
		await p.goto(inPerson.manage, { waitUntil: 'networkidle' }); await manageReady(p);
		// Moving a poll option by keyboard must keep focus on the arrow and say what happened.
		await p.focus('.poll [data-move="down"]');
		await p.keyboard.press('Enter');
		const after = await p.evaluate(() => ({ focus: document.activeElement?.dataset?.move, said: document.querySelector('.poll-status')?.textContent }));
		h.check('Manage poll: a keyboard move keeps focus on an arrow and is announced', !!after.focus && /now number/.test(after.said || ''), JSON.stringify(after));
		await p.click('#m-save');
		await p.waitForFunction(() => document.getElementById('manage-result').textContent.length > 0);
		h.check('Manage: "saved" is said in the status region', /saved/.test(await p.textContent('#manage-result')));
		await ctx.close();
	}
	const remote = await registerAndConfirm({ name: 'Eve', email: 'eve@example.org', attendance: 'remote' });
	await audit('Manage, remote', remote.manage, { ready: manageReady });
	const extras = await registerAndConfirm({ name: 'Fay', email: 'fay@example.org', attendance: 'extras', optins: [DINNER] });
	await audit('Manage, dinner only', extras.manage, { ready: manageReady });
	h.sql(`UPDATE events SET in_person_max=1 WHERE id='${h.EVENT}'`);
	const waiting = await registerAndConfirm({ name: 'Gil', email: 'gil@example.org', attendance: 'in_person' });
	h.sql(`UPDATE events SET in_person_max=20 WHERE id='${h.EVENT}'`);
	await audit('Manage, in-person waiting list', waiting.manage, { ready: manageReady });
	const leavers = {};
	for (const scheme of ['light', 'dark']) leavers[scheme] = await registerAndConfirm({ name: 'Hal', email: `hal-${scheme}@example.org`, attendance: 'remote' });
	const leaver = leavers.light;
	await audit('Manage, just cancelled', (scheme) => leavers[scheme].manage, {
		ready: async (p) => { await manageReady(p); await p.click('#m-cancel'); await p.waitForFunction(() => /cancelled/.test(document.getElementById('manage-form').textContent)); },
	});
	await audit('Manage, link of a cancelled registration', leaver.manage, { ready: manageReady });
	await audit('Manage, no link', `${h.BASE}/events/manage/`, { ready: manageReady });

	// ---- admin ----
	await audit('Admin page', `${h.BASE}/admin/rsvps/?event=${h.EVENT}`, {
		admin: true, full: true,
		ready: (p) => p.waitForFunction(() => document.querySelector('#stats')?.children.length > 0),
	});

	// Titles: each page its own, so a list of tabs or the history tells them apart.
	const all = [...titles.values()];
	h.check('Page titles are unique', new Set(all).size === all.length, JSON.stringify([...titles]));
	h.check('Nothing was fetched from a third party', !h.thirdParty.length, h.thirdParty.join(', '));
	console.log(`\nScreenshots in ${SHOTS}`);
} catch (e) {
	console.error(e);
	h.check('the run finished', false, e.message);
} finally {
	await h.stop();
	const { passes, failures } = h.results();
	console.log(`\n${passes} passed, ${failures} failed`);
	process.exit(failures ? 1 : 0);
}

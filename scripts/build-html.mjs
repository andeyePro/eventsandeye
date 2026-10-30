#!/usr/bin/env node
// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
/**
 * Plain HTML versions of the booking form, confirm panel and manage panel, for sites that do not use Astro.
 * The markup is taken from the Astro components, so the two cannot drift apart; the scripts are the same modules.
 *   node scripts/build-html.mjs            writes html/*.html, html/events-and-i.css and html/*.js
 *   node scripts/build-html.mjs --check    fails if the committed html/*.html or the stylesheet is out of date
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
const PLACEHOLDERS = {
	event: 'YOUR-EVENT-ID', controller: 'YOUR ORGANISATION', contactHref: 'mailto:you@example.org', privacyHref: '/privacy/',
	sourceUrl: 'https://github.com/andeyePro/eventsandeye', next: '/events/check-email/', siteKey: 'YOUR-TURNSTILE-SITE-KEY',
};
/** Every rule under .eai (the wrapper each fragment comes in), so the components' plain class names cannot touch the rest of a site. */
const scope = (css) => css.trim().replace(/(^|\})(\s*)([^{}]+)\{/g, (m, close, space, sel) => `${close}${space}${sel.split(',').map((x) => {
	const t = x.trim();
	return t.startsWith('[data-theme') ? t.replace(/^(\[data-theme[^\]]*\])\s*/, '$1 .eai ') : `.eai ${t}`;
}).join(', ')} {`);
const components = [['RsvpForm', 'rsvp-form'], ['ConfirmPanel', 'confirm-panel'], ['ManagePanel', 'manage-panel']];

function fragment(name, mod) {
	const src = readFileSync(`${root}astro/${name}.astro`, 'utf8');
	const body = src.split(/^---$/m).slice(2).join('---');
	const markup = body.slice(0, body.search(/^<script/m)).trim();
	const style = /<style>([\s\S]*?)<\/style>/.exec(body)?.[1] ?? '';
	const value = (k) => {
		if (!(k in PLACEHOLDERS)) throw new Error(`${name}: no placeholder for {${k}}`);
		return PLACEHOLDERS[k];
	};
	const html = markup
		.replace(/ data-fixed=\{\w+ \? "1" : undefined\}/g, '') // the page's own wording is not set here: the event's is used
		.replace(/\{\w+ \?\? "([^"]*)"\}/g, '$1')
		.replace(/=\{(\w+)\}/g, (m, k) => `="${value(k)}"`)
		.replace(/\{(\w+)\}/g, (m, k) => value(k));
	if (/[{}]/.test(html.replace(/<!--[\s\S]*?-->/g, ''))) throw new Error(`${name}: an expression was left in the markup`);
	const turnstile = mod === 'rsvp-form' ? '\n<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : '';
	return {
		html: `<!-- Events&I ${name}, generated from astro/${name}.astro by scripts/build-html.mjs: do not edit. Replace the capitalised placeholders. -->\n<div class="eai">\n${html}\n</div>${turnstile}\n<script type="module" src="${mod}.js"></script>\n`,
		css: `/* ${name} */\n${scope(style.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:global\(([^)]*)\)/g, '$1'))}\n`,
	};
}

const check = process.argv.includes('--check');
let stale = 0, css = '/* Events&I components, generated from the Astro components by scripts/build-html.mjs. Plain fallbacks for the Starlight variables. */\n';
for (const [name, mod] of components) {
	const f = fragment(name, mod);
	css += f.css;
	const path = `${root}html/${mod}.html`;
	if (check) {
		let was = '';
		try { was = readFileSync(path, 'utf8'); } catch {}
		if (was !== f.html) { stale++; console.error(`html/${mod}.html is out of date: run node scripts/build-html.mjs`); }
	} else writeFileSync(path, f.html);
}
if (check) {
	let was = '';
	try { was = readFileSync(`${root}html/events-and-i.css`, 'utf8'); } catch {}
	if (was !== css) { stale++; console.error('html/events-and-i.css is out of date: run node scripts/build-html.mjs'); }
	process.exit(stale ? 1 : 0);
}
mkdirSync(`${root}html`, { recursive: true });
writeFileSync(`${root}html/events-and-i.css`, css);
await build({ entryPoints: components.map(([, m]) => `${root}astro/${m}.ts`), bundle: true, format: 'esm', minify: true, outdir: `${root}html`, logLevel: 'warning' });
console.log('Wrote html/*.html and html/events-and-i.css (commit these) and html/*.js (build output: copy them to your site).');

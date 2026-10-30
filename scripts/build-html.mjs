#!/usr/bin/env node
// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
/**
 * Plain HTML versions of the booking form, confirm panel and manage panel, for sites that do not use Astro.
 * The markup is taken from the Astro components, so the two cannot drift apart; the scripts are the same modules.
 *   node scripts/build-html.mjs            writes html/*.html, html/events-and-i.css and html/*.js
 *   node scripts/build-html.mjs --check    fails if the committed html/*.html or the stylesheet is out of date
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
/** For the props a page must give (capitalised, to be replaced). Props with defaults take them from the component. */
const PLACEHOLDERS = { event: 'YOUR-EVENT-ID', controller: 'YOUR ORGANISATION', contactHref: 'YOUR-CONTACT-LINK', siteKey: 'YOUR-TURNSTILE-SITE-KEY' };
/**
 * Every rule under .eai (the wrapper each fragment comes in), so the components' plain class names cannot touch the
 * rest of a site. Only what the components use today is handled; anything else (at-rules, selector lists inside
 * brackets, html or body) stops the build rather than coming out wrong.
 */
const scope = (name, css) => {
	if (/@/.test(css)) throw new Error(`${name}: at-rules in the component's style are not handled by scripts/build-html.mjs`);
	return css.trim().replace(/(^|\})(\s*)([^{}]+)\{/g, (m, close, space, sel) => {
		if (/\([^)]*,/.test(sel)) throw new Error(`${name}: a selector list inside brackets is not handled: ${sel.trim()}`);
		return `${close}${space}${sel.split(',').map((x) => {
			const t = x.trim();
			if (/(^|[\s>+~])(html|body|:root)\b/.test(t)) throw new Error(`${name}: a selector reaching outside the component is not handled: ${t}`);
			return t.startsWith('[data-theme') ? t.replace(/^(\[data-theme[^\]]*\])\s*/, '$1 .eai ') : `.eai ${t}`;
		}).join(', ')} {`;
	});
};
const components = [['RsvpForm', 'rsvp-form'], ['ConfirmPanel', 'confirm-panel'], ['ManagePanel', 'manage-panel']];

function fragment(name, mod) {
	const src = readFileSync(`${root}astro/${name}.astro`, 'utf8');
	const [, front = ''] = src.split(/^---$/m);
	const body = src.split(/^---$/m).slice(2).join('---');
	const end = body.search(/^<script/m);
	if (end < 0) throw new Error(`${name}: no <script> found after the markup`);
	const markup = body.slice(0, end).trim();
	const styles = [...body.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)];
	if (styles.length > 1 || styles.some((m) => m[1].trim())) throw new Error(`${name}: only one plain <style> block is handled`);
	const style = styles[0]?.[2] ?? '';
	// Defaults as the component declares them: `name = 'value'` in its Astro.props destructuring.
	const defaults = Object.fromEntries([...(/const \{([\s\S]*?)\} = Astro\.props/.exec(front)?.[1] ?? '').matchAll(/(\w+)\s*=\s*'([^']*)'/g)].map((m) => [m[1], m[2]]));
	const value = (k) => {
		const v = defaults[k] ?? PLACEHOLDERS[k];
		if (v === undefined) throw new Error(`${name}: no default or placeholder for {${k}}`);
		return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
	};
	const html = markup
		.replace(/ data-fixed=\{\w+ \? "1" : undefined\}/g, '') // the page's own wording is not set here: the event's is used
		.replace(/\{\w+ \?\? "([^"]*)"\}/g, '$1')
		.replace(/=\{(\w+)\}/g, (m, k) => `="${value(k)}"`)
		.replace(/\{(\w+)\}/g, (m, k) => value(k));
	if (/[{}]/.test(html.replace(/<!--[\s\S]*?-->/g, ''))) throw new Error(`${name}: an expression was left in the markup`);
	// Inline scripts (Turnstile's loader) as the component has them.
	const inline = [...body.matchAll(/<script is:inline([^>]*)><\/script>/g)].map((m) => `\n<script${m[1]}></script>`).join('');
	return {
		html: `<!-- Events&I ${name}, generated from astro/${name}.astro by scripts/build-html.mjs: do not edit.${Object.values(PLACEHOLDERS).some((v) => html.includes(v)) ? ' Replace the capitalised placeholders.' : ''}${html.includes('href="/privacy/"') ? ' The privacy notice link is /privacy/: change it if yours is elsewhere.' : ''} -->\n<div class="eai">\n${html}\n</div>${inline}\n<script type="module" src="${mod}.js"></script>\n`,
		css: `/* ${name} */\n${scope(name, style.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:global\(([^)]*)\)/g, '$1'))}\n`,
	};
}

/** The "check your email" page's line: no props, and a few lines of plain script. */
function sentTo() {
	const src = readFileSync(`${root}astro/SentTo.astro`, 'utf8');
	const body = src.split(/^---$/m).slice(2).join('---');
	const markup = body.slice(0, body.search(/^<script/m)).trim();
	const script = /<script>([\s\S]*?)<\/script>/.exec(body)?.[1];
	if (!script || /:\s*(string|number|HTML\w+)\b|\bas\s+\w/.test(script)) throw new Error('SentTo: expected a plain JavaScript script');
	return `<!-- Events&I SentTo, generated from astro/SentTo.astro by scripts/build-html.mjs: do not edit. For the page people go to after registering. -->\n${markup}\n<script>${script}</script>\n`;
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
{
	const html = sentTo(), path = `${root}html/sent-to.html`;
	if (check) {
		let was = '';
		try { was = readFileSync(path, 'utf8'); } catch {}
		if (was !== html) { stale++; console.error('html/sent-to.html is out of date: run node scripts/build-html.mjs'); }
	} else writeFileSync(path, html);
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

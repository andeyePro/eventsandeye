// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
// Unit tests for the email markdown renderer. Run: node --test eventsandeye/tests/markdown.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({ entryPoints: [new URL('../src/markdown.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, platform: 'neutral' });
const { mdToHtml } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

test('a * or backtick inside a URL stays part of the link, and labels still get emphasis', () => {
	assert.equal(mdToHtml('See [the *map*](https://ex.org/a*b*c) and `code` and *em*.'),
		'<p>See <a href="https://ex.org/a*b*c">the <em>map</em></a> and <code>code</code> and <em>em</em>.</p>');
});

test('emphasis cannot open inside a link and close outside it', () => {
	assert.equal(mdToHtml('[a*b](https://u.example) *c*'), '<p><a href="https://u.example">a*b</a> <em>c</em></p>');
});

test('NUL characters in the text cannot forge a link placeholder', () => {
	assert.equal(mdToHtml('x\u00000\u0000 y'), '<p>x0 y</p>');
});

test('HTML in the text is escaped, and only http(s) and mailto links are made', () => {
	assert.equal(mdToHtml('<b>hi</b> [x](javascript:alert(1))'), '<p>&lt;b&gt;hi&lt;/b&gt; [x](javascript:alert(1))</p>');
});

test('nothing inside a code span is emphasis', () => {
	assert.equal(mdToHtml('Use `a*b*c` and `**x**`.'), '<p>Use <code>a*b*c</code> and <code>**x**</code>.</p>');
});

test('a * between numbers or inside words is not italics', () => {
	assert.equal(mdToHtml('2*3*4 and snake*case*name, but *this* and **that**'), '<p>2*3*4 and snake*case*name, but <em>this</em> and <strong>that</strong></p>');
	assert.equal(mdToHtml('a * b * c'), '<p>a * b * c</p>');
});

test('URLs with balanced brackets are kept whole', () => {
	assert.equal(mdToHtml('[Camping](https://en.wikipedia.org/wiki/Camping_(disambiguation)).'), '<p><a href="https://en.wikipedia.org/wiki/Camping_(disambiguation)">Camping</a>.</p>');
	assert.equal(mdToHtml('[`code` label](https://x.example)'), '<p><a href="https://x.example"><code>code</code> label</a></p>');
});

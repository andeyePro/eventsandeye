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

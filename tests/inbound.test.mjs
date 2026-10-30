// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
// Unit tests for reading organisers' email replies to poll suggestions. Run: node --test eventsandeye/tests/inbound.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({ entryPoints: [new URL('../src/inbound.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, platform: 'neutral' });
const { parseEmail, replyText, parseCommand, decodeHeader, mailbox } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

const cmd = (text) => parseCommand(replyText(text));

test('yes, no and use, from the first line of the reply', () => {
	assert.deepEqual(cmd('Yes please!'), { decision: 'add' });
	assert.deepEqual(cmd('ok'), { decision: 'add' });
	assert.deepEqual(cmd('\n\nNo thanks.'), { decision: 'reject' });
	assert.deepEqual(cmd('use Wild swimming at the lido.'), { decision: 'use', label: 'Wild swimming at the lido' });
	assert.deepEqual(cmd('Use: "Paddleboarding"'), { decision: 'use', label: 'Paddleboarding' });
	assert.equal(cmd('Maybe later'), null);
	assert.equal(cmd('use'), null);
	assert.equal(cmd('nothing'), null, 'a word that starts with "no" is not no');
	assert.equal(cmd('yesterday was fun'), null);
});

test('the quoted original is never read as the answer', () => {
	assert.equal(cmd('> yes\n> no'), null);
	assert.equal(cmd('On Fri, 13 Nov 2026 at 10:00, AMYBO <hello@example.org> wrote:\n> yes'), null);
	assert.deepEqual(cmd('no\n\n-----Original Message-----\nFrom: AMYBO\nyes: add it'), { decision: 'reject' });
	assert.equal(cmd('\n-- \nyes'), null, 'nor a signature');
});

test('headers: folded lines and RFC 2047 encoded words', () => {
	assert.equal(decodeHeader('=?UTF-8?Q?Caf=C3=A9_trip?= (ref x)'), 'Café trip (ref x)');
	assert.equal(decodeHeader('=?utf-8?B?Q2Fmw6k=?= =?utf-8?B?IHRyaXA=?='), 'Café trip');
	const m = parseEmail('From: "Org, The" <Hello@example.org>\r\nSubject: Re: Poll suggestion:\r\n (ref abc)\r\n\r\nyes\r\n');
	assert.equal(m.from, 'hello@example.org');
	assert.equal(m.subject, 'Re: Poll suggestion: (ref abc)');
	assert.equal(m.text.trim(), 'yes');
});

test('multipart replies: plain text preferred, quoted-printable and base64 decoded, HTML as a fallback', () => {
	const alt = 'From: a@example.org\r\nContent-Type: multipart/mixed; boundary=outer\r\n\r\npreamble\r\n--outer\r\nContent-Type: multipart/alternative; boundary="inner"\r\n\r\n'
		+ '--inner\r\nContent-Type: text/html\r\n\r\n<p>html answer</p>\r\n--inner\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nuse Caf=C3=A9 =\r\ncrawl\r\n--inner--\r\n--outer--\r\n';
	assert.deepEqual(parseCommand(replyText(parseEmail(alt).text)), { decision: 'use', label: 'Café crawl' });
	const b64 = `From: a@example.org\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from('Nope\r\n').toString('base64')}\r\n`;
	assert.deepEqual(parseCommand(replyText(parseEmail(b64).text)), { decision: 'reject' });
	const html = 'From: a@example.org\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<div dir="ltr">Yes, thanks!&nbsp;<br></div><blockquote>no</blockquote>';
	assert.deepEqual(parseCommand(replyText(parseEmail(html).text)), { decision: 'add' });
	const latin = 'From: a@example.org\r\nContent-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nuse Caf=E9\r\n';
	assert.deepEqual(parseCommand(replyText(parseEmail(latin).text)), { decision: 'use', label: 'Café' });
});

test('automatic replies are recognised, so an out-of-office message never decides anything', () => {
	assert.equal(parseEmail('From: a@example.org\r\nAuto-Submitted: auto-replied\r\n\r\nNo one is in the office\r\n').automatic, true);
	assert.equal(parseEmail('From: a@example.org\r\nPrecedence: bulk\r\n\r\nNo\r\n').automatic, true);
	assert.equal(parseEmail('From: a@example.org\r\nAuto-Submitted: no\r\n\r\nNo\r\n').automatic, false);
	assert.equal(parseEmail('From: a@example.org\r\n\r\nNo\r\n').automatic, false);
});

test('the sender is the one real address, never one hidden in a display name or comment', async () => {
	assert.equal(mailbox('Organiser <Hello@example.org>'), 'hello@example.org');
	assert.equal(mailbox('hello@example.org'), 'hello@example.org');
	assert.equal(mailbox('"<hello@example.org>" <evil@x.example>'), 'evil@x.example');
	assert.equal(mailbox('=?UTF-8?Q?=3Chello@example.org=3E?= <evil@x.example>'), 'evil@x.example');
	assert.equal(mailbox('evil@x.example (<hello@example.org>)'), 'evil@x.example');
	assert.equal(mailbox('a@example.org, hello@example.org'), null);
	assert.equal(mailbox('<a@example.org> <hello@example.org>'), null);
});

test('only a whole-line answer counts', () => {
	assert.equal(cmd('No problem, add it'), null);
	assert.equal(cmd('No worries, yes'), null);
	assert.equal(cmd('OK, so maybe not'), null);
	assert.deepEqual(cmd('Yes, thanks!'), { decision: 'add' });
	assert.deepEqual(cmd("Don't add it."), { decision: 'reject' });
});

test('a hostile HTML body is read in linear time', () => {
	const t = Date.now();
	parseEmail(`From: a@example.org\r\nContent-Type: text/html\r\n\r\n${'<'.repeat(900_000)}`);
	parseEmail(`From: a@example.org\r\nContent-Type: text/html\r\n\r\n${'<style '.repeat(150_000)}`);
	assert.ok(Date.now() - t < 1000, `took ${Date.now() - t} ms`);
});

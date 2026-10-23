// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
import { escapeHtml } from './util';

/**
 * Deliberately small markdown renderer for admin-written emails: paragraphs, `#`–`###` headings,
 * `-`/`*` and `1.` lists, **bold**, *italic*, `code` and [links](https://...). Input is escaped first,
 * so no raw HTML from the database ever reaches an email.
 */
export function mdToHtml(md: string): string {
	const lines = md.replace(/\r\n?/g, '\n').split('\n');
	const out: string[] = [];
	let para: string[] = [];
	let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;

	const flushPara = () => {
		if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
		para = [];
	};
	const flushList = () => {
		if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
		list = null;
	};

	for (const raw of lines) {
		const line = raw.trimEnd();
		const h = /^(#{1,3})\s+(.*)$/.exec(line);
		const ul = /^\s*[-*]\s+(.*)$/.exec(line);
		const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
		if (!line.trim()) {
			flushPara();
			flushList();
		} else if (h) {
			flushPara();
			flushList();
			const level = h[1].length + 1; // email body headings start at h2
			out.push(`<h${level}>${inline(h[2])}</h${level}>`);
		} else if (ul || ol) {
			flushPara();
			const tag = ul ? 'ul' : 'ol';
			if (!list || list.tag !== tag) {
				flushList();
				list = { tag, items: [] };
			}
			list.items.push((ul || ol)![1]);
		} else {
			flushList();
			para.push(line.trim());
		}
	}
	flushPara();
	flushList();
	return out.join('\n');
}

function emphasis(s: string): string {
	s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
	s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	return s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

function inline(text: string): string {
	// NUL marks link placeholders below, so none may come from the text itself.
	let s = escapeHtml(text.replace(/\u0000/g, ''));
	// Each link becomes one atomic placeholder with its label rendered on its own, so a * or ` inside a URL cannot
	// become markup and emphasis can never open inside a link and close outside it.
	const links: string[] = [];
	s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_m, label, href) => `\u0000${links.push(`<a href="${href}">${emphasis(label)}</a>`) - 1}\u0000`);
	s = emphasis(s);
	return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => links[Number(i)] ?? '');
}

/** Plain-text version: markdown is already readable; just turn [label](url) into "label (url)". */
export function mdToText(md: string): string {
	return md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/\*\*([^*]+)\*\*/g, '$1');
}

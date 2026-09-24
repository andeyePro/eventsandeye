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

function inline(text: string): string {
	let s = escapeHtml(text);
	s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
	s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
	s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_m, label, href) => `<a href="${href}">${label}</a>`);
	return s;
}

/** Plain-text version: markdown is already readable; just turn [label](url) into "label (url)". */
export function mdToText(md: string): string {
	return md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/\*\*([^*]+)\*\*/g, '$1');
}

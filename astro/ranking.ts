// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
/**
 * The poll ranking list shared by the booking form and the manage panel: options most wanted first, and a line under
 * the ones the person would join. Arrow buttons work by keyboard and touch; dragging is a shortcut for mouse users.
 */

/** Stands for the line in the list of ids. */
export const BAR = '__bar__';

export interface Focus { id: string; dir: 'up' | 'down'; message: string }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
	const e = Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
	e.append(...kids);
	return e;
}

/**
 * The list for `ids` (option ids and BAR), which it reorders in place. After each move it calls rerender with where
 * focus should go and what to announce, so the caller can rebuild the list and keep keyboard users where they were.
 */
export function rankList(ids: string[], info: (id: string) => { label: string; tags: string[] }, editable: boolean, ariaLabel: string, rerender: (focus?: Focus) => void): HTMLOListElement {
	const move = (id: string, delta: number) => {
		const i = ids.indexOf(id), j = i + delta;
		if (j < 0 || j >= ids.length) return;
		[ids[i], ids[j]] = [ids[j], ids[i]];
		// At the top or bottom the pressed button is disabled, so focus moves to the other one.
		const edge = j === 0 || j === ids.length - 1;
		const dir = (delta < 0) !== edge ? 'up' : 'down';
		const above = ids.indexOf(BAR), rank = ids.filter((x) => x !== BAR).indexOf(id) + 1;
		const message = id === BAR ? `The line is now under ${above} of ${ids.length - 1} options.` : `${info(id).label} is now number ${rank}, ${j < above ? 'above' : 'below'} the line.`;
		rerender({ id, dir, message });
	};
	const items = ids.map((id, i) => {
		const isBar = id === BAR;
		const { label, tags } = isBar ? { label: 'Below this line: count me out', tags: [] } : info(id);
		const li = el('li', { className: isBar ? 'bar' : 'opt', draggable: editable }, el('span', { className: 'opt-label' }, label, ...tags.map((t) => el('span', { className: 'tag' }, t))));
		li.dataset.id = id;
		if (editable) {
			const btn = (dir: 'up' | 'down', delta: number, arrow: string) => {
				const b = el('button', { type: 'button', textContent: arrow, disabled: (delta < 0 && i === 0) || (delta > 0 && i === ids.length - 1) });
				b.setAttribute('aria-label', `Move ${isBar ? 'the line' : label} ${dir}`);
				b.dataset.move = dir;
				b.dataset.id = id;
				b.addEventListener('click', () => move(id, delta));
				return b;
			};
			li.append(el('span', { className: 'moves' }, btn('up', -1, '↑'), btn('down', 1, '↓')));
			li.addEventListener('dragstart', (e) => { e.dataTransfer?.setData('text/plain', id); li.classList.add('dragging'); });
			li.addEventListener('dragend', () => li.classList.remove('dragging'));
			li.addEventListener('dragover', (e) => e.preventDefault());
			li.addEventListener('drop', (e) => {
				e.preventDefault();
				const from = e.dataTransfer?.getData('text/plain');
				if (!from || from === id || !ids.includes(from)) return;
				ids.splice(ids.indexOf(from), 1);
				ids.splice(ids.indexOf(id) + (e.offsetY > li.offsetHeight / 2 ? 1 : 0), 0, from);
				rerender();
			});
		}
		return li;
	});
	const ol = el('ol', { className: 'rank' }, ...items);
	ol.setAttribute('aria-label', ariaLabel);
	return ol;
}

/** After a rerender: focus the moved item's button and announce the move in the given status element. */
export function restoreFocus(root: ParentNode, focus: Focus | undefined, status: Element | null) {
	if (!focus) return;
	(root.querySelector(`[data-move="${focus.dir}"][data-id="${focus.id}"]`) as HTMLButtonElement | null)?.focus();
	if (status) status.textContent = focus.message;
}

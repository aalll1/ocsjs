/** Pointer capture and capture-phase listeners avoid page mouse handlers. */
export function enablePanelDrag(
	target: HTMLElement,
	handle: HTMLElement,
	onPositionChange: (x: number, y: number) => void
) {
	const doc = target.ownerDocument;
	const view = doc.defaultView!;
	let drag: { id: number; x: number; y: number; left: number; top: number } | undefined;
	let moved = false;
	const interactive =
		'button,input,select,textarea,a,dropdown-element,.switch,.close,[role="button"],[contenteditable="true"]';
	const isControl = (event: Event) =>
		event.composedPath().some((node) => node !== handle && node instanceof view.Element && node.matches(interactive));
	const constrain = (left: number, top: number) => ({
		x: Math.max(0, Math.min(left, Math.max(0, view.innerWidth - target.getBoundingClientRect().width))),
		y: Math.max(0, Math.min(top, Math.max(0, view.innerHeight - Math.max(32, handle.getBoundingClientRect().height))))
	});
	const move = (event: PointerEvent) => {
		if (!drag || event.pointerId !== drag.id) return;
		event.preventDefault();
		const position = constrain(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
		target.style.left = position.x + 'px';
		target.style.top = position.y + 'px';
		target.style.right = 'auto';
		target.style.bottom = 'auto';
		moved = true;
	};
	const finish = (event?: PointerEvent) => {
		if (!drag || (event && event.pointerId !== drag.id)) return;
		const pointerId = drag.id;
		drag = undefined;
		try {
			handle.releasePointerCapture(pointerId);
		} catch {
			/* Pointer capture is optional. */
		}
		if (moved) onPositionChange(parseFloat(target.style.left), parseFloat(target.style.top));
	};
	const down = (event: PointerEvent) => {
		if (event.button !== 0 || isControl(event) || drag) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		const bounds = target.getBoundingClientRect();
		drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top };
		moved = false;
		try {
			handle.setPointerCapture(event.pointerId);
		} catch {
			/* Use window listeners as fallback. */
		}
	};
	const suppressLegacyDrag = (event: MouseEvent) => {
		if (event.button === 0 && !isControl(event)) event.stopImmediatePropagation();
	};
	const resize = () => {
		if (!target.getClientRects().length) return;
		const bounds = target.getBoundingClientRect();
		const position = constrain(bounds.left, bounds.top);
		target.style.left = position.x + 'px';
		target.style.top = position.y + 'px';
		onPositionChange(position.x, position.y);
	};
	handle.style.cursor = 'move';
	handle.style.touchAction = 'none';
	handle.addEventListener('pointerdown', down, true);
	handle.addEventListener('mousedown', suppressLegacyDrag, true);
	view.addEventListener('pointermove', move, { capture: true, passive: false });
	view.addEventListener('pointerup', finish, true);
	view.addEventListener('pointercancel', finish, true);
	view.addEventListener('blur', () => finish());
	view.addEventListener('resize', resize);
}

const draggableRoots = new WeakSet<ShadowRoot>();

export function installPanelDragging(root: ShadowRoot, onPositionChange: (x: number, y: number) => void) {
	if (draggableRoots.has(root)) return;
	draggableRoots.add(root);
	const installed = new WeakSet<HTMLElement>();
	const attach = () => {
		const target = root.querySelector<HTMLElement>('container-element');
		const header = target?.querySelector<HTMLElement>('header-element');
		if (!target || !header) return;
		if (!installed.has(header)) {
			installed.add(header);
			enablePanelDrag(target, header, onPositionChange);
		}
		if (!header.querySelector('.ocs-drag-handle')) {
			const grip = header.ownerDocument.createElement('span');
			grip.className = 'ocs-drag-handle';
			grip.textContent = '⠿';
			grip.title = '按住拖动窗口';
			grip.style.cssText = 'cursor:move;padding:6px;font-size:20px;user-select:none';
			header.prepend(grip);
		}
	};
	attach();
	const observer = new MutationObserver(attach);
	observer.observe(root, { childList: true, subtree: true });
}

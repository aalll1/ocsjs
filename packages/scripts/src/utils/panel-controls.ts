type PauseControl = {
	isPaused(): boolean;
	setPaused(value: boolean): void;
	subscribe(listener: (paused: boolean) => void): () => unknown;
};

const controlledRoots = new WeakSet<ShadowRoot>();

/** Keep one pause button in the existing header, including after panel switches. */
export function installAutomationPanel(root: ShadowRoot, control: PauseControl) {
	if (controlledRoots.has(root)) return;
	controlledRoots.add(root);
	const button = root.ownerDocument.createElement('button');
	button.type = 'button';
	button.className = 'base-style-button-secondary ocs-automation-control';
	button.style.cssText =
		'margin-left:auto;margin-right:6px;padding:3px 8px;font-size:12px;white-space:nowrap;flex-shrink:0;cursor:pointer';
	const update = () => {
		const paused = control.isPaused();
		button.textContent = paused ? '▶ 继续' : '⏸ 暂停';
		button.title = paused ? '国开脚本已暂停，点击继续运行' : '暂停国开脚本的播放、跳转和答题';
		button.setAttribute('aria-label', button.title);
		button.setAttribute('aria-pressed', String(paused));
		button.style.color = paused ? '#16803c' : '#b42318';
		button.style.borderColor = paused ? '#86efac' : '#fca5a5';
		button.style.backgroundColor = paused ? '#f0fdf4' : '#fff';
	};
	button.onclick = () => control.setPaused(!control.isPaused());
	const attach = () => {
		const header = root.querySelector<HTMLElement>('header-element');
		if (!header) return;
		const switcher = header.querySelector<HTMLElement>('.switch');
		const row = switcher?.parentElement || header.querySelector('.profile')?.parentElement || header;
		if (button.parentElement !== row) row.insertBefore(button, switcher);
	};
	control.subscribe(update);
	update();
	attach();
	const observer = new MutationObserver(attach);
	observer.observe(root, { childList: true, subtree: true });
}

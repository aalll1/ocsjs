type ReadingControl = { waitUntilRunning(): Promise<void>; delay(ms: number): Promise<void> };

type ReadingSpeed = () => number;

/** Invalid saved settings fall back to the default, and speed never skips a viewport. */
export function readingInterval(speed: number) {
	const multiplier = Number.isFinite(speed) && speed > 0 ? Math.max(0.5, Math.min(10, speed)) : 3;
	return 700 / multiplier;
}

/** Read a scroll surface in small steps, rechecking lazy-loaded height at the bottom. */
export async function readScrollSurface(
	surface: HTMLElement,
	control: ReadingControl,
	getSpeed: ReadingSpeed = () => 3
) {
	await control.waitUntilRunning();
	if (surface.clientHeight <= 0) throw new Error('阅读区域未显示，停止切换资源。');
	surface.scrollTo({ top: 0, behavior: 'auto' });
	let bottomChecks = 0;
	let stuck = 0;
	for (let step = 0; step < 20000; step++) {
		await control.delay(bottomChecks > 0 ? 700 : readingInterval(getSpeed()));
		await control.waitUntilRunning();
		const end = Math.max(0, surface.scrollHeight - surface.clientHeight);
		if (surface.scrollTop >= end - 2) {
			if (++bottomChecks >= 5) return;
			continue;
		}
		bottomChecks = 0;
		const before = surface.scrollTop;
		surface.scrollTo({
			top: Math.min(end, before + Math.max(40, Math.min(120, surface.clientHeight * 0.2))),
			behavior: 'auto'
		});
		surface.dispatchEvent(new Event('scroll', { bubbles: true }));
		if (surface.scrollTop <= before + 1) {
			if (++stuck >= 5) throw new Error('阅读区域无法滚动，停止切换资源。');
		} else stuck = 0;
	}
	throw new Error('阅读超时，未确认到达末尾，停止切换资源。');
}

export function isVisible(element: Element): boolean {
	const el = element as HTMLElement;
	return !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('.ng-hide');
}

async function readDocument(doc: Document, control: ReadingControl, getSpeed: ReadingSpeed) {
	// PDF.js creates all page containers, but renders pages as scrolling reveals them.
	for (let attempt = 0; attempt < 40; attempt++) {
		await control.delay(500);
		const container = doc.querySelector<HTMLElement>('#viewerContainer');
		const pages = doc.querySelectorAll('#viewer .page');
		if (container && pages.length && container.clientHeight > 0) {
			await readScrollSurface(container, control, getSpeed);
			const number = doc.querySelector<HTMLInputElement>('#pageNumber');
			const total = Number(doc.querySelector('#numPages')?.textContent?.replace(/\D/g, ''));
			if (total && Number(number?.value) !== total) throw new Error('PDF 尚未到达最后一页，停止切换资源。');
			return;
		}
	}
	throw new Error('未找到已加载的文档阅读器，停止切换资源。');
}

/** Resource adapters are deliberately separate from the video and exam controllers. */
export async function readLearningResource(doc: Document, control: ReadingControl, getSpeed: ReadingSpeed = () => 3) {
	await control.delay(2000);
	const main = doc.querySelector<HTMLElement>('.full-screen-mode-main');
	if (!main) throw new Error('未找到资源正文。');
	const links = Array.from(main.querySelectorAll<HTMLElement>('a')).filter(
		(e) => e.textContent?.trim() === '查看' && isVisible(e)
	);
	if (links.length) {
		for (const link of links) {
			await control.waitUntilRunning();
			// Do not open another preview when the user already has this one open.
			let frame = doc.querySelector<HTMLIFrameElement>('#file-previewer #pdf-viewer');
			if (!frame || !isVisible(frame)) {
				link.click();
				await control.delay(1500);
			}
			frame = doc.querySelector<HTMLIFrameElement>('#file-previewer #pdf-viewer');
			let inner: Document | null = null;
			for (let attempt = 0; attempt < 30; attempt++) {
				await control.delay(500);
				try {
					inner = frame?.contentDocument || null;
				} catch {
					/* Unsupported cross-origin viewers stay on this resource. */
				}
				if (inner?.querySelector('#viewerContainer')) break;
				frame = doc.querySelector<HTMLIFrameElement>('#file-previewer #pdf-viewer');
			}
			if (!inner) throw new Error('无法访问课件阅读区域，已停止，未跳过该资源。');
			await readDocument(inner, control, getSpeed);
			await control.waitUntilRunning();
			const close = doc.querySelector<HTMLElement>(
				'#file-previewer [close-popup="file-previewer"], #file-previewer .close-reveal-modal, #file-previewer .popup-header .right'
			);
			if (!close) throw new Error('课件已读到末尾，但未找到关闭预览按钮。');
			close.click();
			await control.delay(1500);
		}
		return;
	}
	const frames = Array.from(main.querySelectorAll<HTMLIFrameElement>('iframe')).filter(isVisible);
	for (const frame of frames) {
		let inner: Document | null = null;
		try {
			inner = frame.contentDocument;
		} catch {
			/* Do not skip unreadable attachments. */
		}
		if (!inner || inner.location.href === 'about:blank') throw new Error('资源阅读器未就绪或不支持，已停止，未跳过。');
		if (inner.querySelector('#viewerContainer')) await readDocument(inner, control, getSpeed);
		else if (inner.scrollingElement && inner.body?.textContent?.trim())
			await readScrollSurface(inner.scrollingElement as HTMLElement, control, getSpeed);
		else throw new Error('无法识别资源正文，已停止，未跳过。');
	}
	if (frames.length) return;
	if (main.querySelector('a[download], a[href*="/blob"], canvas, object, embed'))
		throw new Error('资源需要专用阅读器，已停止，未跳过。');
	const article = main.querySelector<HTMLElement>(
		'.page-content, .activity-content, .rich-text, .content-body, article'
	);
	if (!article?.textContent?.trim()) throw new Error('未找到可阅读的图文正文，已停止，未跳过。');
	let surface: HTMLElement = article;
	while (surface.parentElement && surface.scrollHeight <= surface.clientHeight + 2) surface = surface.parentElement;
	await readScrollSurface(surface, control, getSpeed);
}

/** Shared pause gate. Delays count only time spent running. */
export function createAutomationControl(initialPaused = false) {
	let paused = initialPaused;
	const listeners = new Set<(paused: boolean) => void>();
	const subscribe = (listener: (paused: boolean) => void) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};
	return {
		isPaused: () => paused,
		setPaused(value: boolean) {
			if (paused === value) return;
			paused = value;
			for (const listener of listeners) listener(paused);
		},
		subscribe,
		async waitUntilRunning() {
			while (paused) {
				await new Promise<void>((resolve) => {
					const unsubscribe = subscribe((value) => {
						if (!value) {
							unsubscribe();
							resolve();
						}
					});
				});
			}
		},
		delay(milliseconds: number) {
			return new Promise<void>((resolve) => {
				let remaining = Math.max(0, milliseconds);
				let started = 0;
				let timer: ReturnType<typeof setTimeout> | undefined;
				const update = (stopped: boolean) => {
					if (timer !== undefined) {
						clearTimeout(timer);
						timer = undefined;
						remaining = Math.max(0, remaining - (Date.now() - started));
					}
					if (!stopped) {
						started = Date.now();
						timer = setTimeout(() => {
							timer = undefined;
							unsubscribe();
							resolve();
						}, remaining);
					}
				};
				const unsubscribe = subscribe(update);
				update(paused);
			});
		}
	};
}

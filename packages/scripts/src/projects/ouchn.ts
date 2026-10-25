import { $, OCSWorker, defaultAnswerWrapperHandler } from '@ocsjs/core';
import { Project, Script, $ui, $message, $store } from 'easy-us';
import { createAutomationControl } from '../utils/automation-control';
import { enablePanelDrag } from '../utils/panel-drag';
import { playMedia, $msg, CommonWorkOptions } from '../utils';
import { CommonProject } from './common';
import { BackgroundProject } from './background';
import { waitForElement } from '../utils/study';
import { playbackRate, volume, restudy } from '../utils/configs';
import { commonWork, simplifyWorkResult } from '../utils/work';

/**
 * 模块级状态，供 study 和 work 脚本共享
 */
const state = {
	study: {
		resumeAfterPause: false,
		/** 当前播放的媒体元素 */
		currentMedia: undefined as HTMLVideoElement | undefined
	},
	worker: undefined as Pick<OCSWorker, 'emit'> | undefined
};

const automation = createAutomationControl();
const pauseKey = 'ouchn.automation.paused';
let controlInitialized = false;

function initializeAutomationControl() {
	if (controlInitialized) return;
	controlInitialized = true;
	automation.setPaused(Boolean($store.get(pauseKey, false)));
	automation.subscribe((paused) => {
		try {
			if ($store.get(pauseKey, false) !== paused) $store.set(pauseKey, paused);
		} catch {
			// Pausing must still stop automation if persistent storage is unavailable.
		}
		const video = document.querySelector<HTMLVideoElement>('video.vjs-tech') || state.study.currentMedia;
		if (paused) {
			state.study.resumeAfterPause = !!video && !video.paused && !video.ended;
			video?.pause();
			state.worker?.emit('stop');
		} else {
			state.worker?.emit('continuate');
			if (state.study.resumeAfterPause && video && !video.ended) {
				startPlayback(video).catch(() => {});
			}
			state.study.resumeAfterPause = false;
		}
	});
	$store.addChangeListener(pauseKey, (paused) => automation.setPaused(Boolean(paused)));
	// Also stop platform autoplay when a page is opened while the script is paused.
	document.addEventListener(
		'play',
		(event) => {
			if (automation.isPaused() && event.target instanceof HTMLMediaElement) event.target.pause();
		},
		true
	);
}

function mountAutomationToolbar() {
	if (self !== top || document.getElementById('ocs-ouchn-control')) return;
	const host = document.createElement('div');
	host.id = 'ocs-ouchn-control';
	const saved = $store.get('ouchn.control.position', { x: 12, y: 12 });
	const savedX = Number(saved?.x);
	const savedY = Number(saved?.y);
	const x = Math.max(0, Math.min(Number.isFinite(savedX) ? savedX : 12, Math.max(0, innerWidth - 270)));
	const y = Math.max(0, Math.min(Number.isFinite(savedY) ? savedY : 12, Math.max(0, innerHeight - 40)));
	host.style.cssText = `position:fixed!important;left:${x}px;top:${y}px;z-index:2147483647!important`;
	const root = host.attachShadow({ mode: 'closed' });
	const bar = document.createElement('div');
	bar.style.cssText =
		'display:flex;align-items:center;gap:8px;padding:8px;background:#fff;color:#222;border:1px solid #aaa;border-radius:8px;box-shadow:0 2px 10px #0003;font:14px sans-serif';
	const grip = document.createElement('span');
	grip.textContent = '⠿ 国开脚本';
	grip.title = '按住拖动控制条';
	grip.style.cssText = 'cursor:move;user-select:none;white-space:nowrap';
	const status = document.createElement('span');
	const button = document.createElement('button');
	button.type = 'button';
	button.style.cssText =
		'cursor:pointer;border:0;border-radius:5px;padding:7px 10px;color:white;font:inherit;white-space:nowrap';
	const update = () => {
		const paused = automation.isPaused();
		status.textContent = paused ? '已暂停' : '运行中';
		button.textContent = paused ? '▶ 继续运行' : '⏸ 暂停全部';
		button.style.background = paused ? '#16803c' : '#b42318';
		button.setAttribute('aria-pressed', String(paused));
	};
	button.onclick = () => automation.setPaused(!automation.isPaused());
	bar.append(grip, status, button);
	root.append(bar);
	document.documentElement.append(host);
	enablePanelDrag(host, grip, (left, top) => $store.set('ouchn.control.position', { x: left, y: top }));
	automation.subscribe(update);
	update();
}

/**
 * 设置 MVP 播放器的倍速
 * 通过解析按钮文本中的数值来匹配，支持 "2.0X", "1.75X", "1.5X" 等格式
 */
function setPlaybackRate(rate: number) {
	const rateBtns = document.querySelectorAll<HTMLElement>('.mvp-play-rate');
	let clicked = false;
	rateBtns.forEach((btn) => {
		const btnRate = parseFloat(btn.innerText.replace('X', '').trim());
		if (Math.abs(btnRate - rate) < 0.01 && !clicked) {
			btn.click();
			clicked = true;
		}
	});
	const video = document.querySelector<HTMLVideoElement>('video.vjs-tech');
	if (video) {
		video.playbackRate = rate;
	}
}

/**
 * 获取当前活动名称
 */
function getCurrentActivityName() {
	const activeItem = document.querySelector('.full-screen-mode-sidebar-menu-item.active');
	const titleEl = activeItem?.querySelector<HTMLElement>('.full-screen-mode-sidebar-menu-item-title .text-too-long');
	return titleEl?.innerText?.trim() || '未知';
}

/**
 * 播放视频：先尝试点击 MVP 播放按钮，再调用原生 play
 */
async function startPlayback(video: HTMLVideoElement) {
	await automation.waitUntilRunning();
	if (!video.paused || video.ended) return;
	const playBtn = document.querySelector<HTMLElement>('.mvp-toggle-play');
	if (playBtn) {
		playBtn.click();
		await automation.delay(500);
	}
	if (video.paused) {
		await playMedia(async () => {
			await automation.waitUntilRunning();
			await video.play();
		});
	}
}

/** Wait for media using active runtime, so pausing cannot exhaust its timeout. */
async function waitForStudyVideo() {
	for (let attempt = 0; attempt < 50; attempt++) {
		await automation.waitUntilRunning();
		const video = document.querySelector<HTMLVideoElement>('video.vjs-tech');
		if (video && (video.readyState >= 2 || video.getAttribute('src'))) return video;
		await automation.delay(200);
	}
	throw new Error('视频未找到，或者加载超时。');
}

/**
 * 学习单个视频，返回 Promise 在视频播放完成时 resolve
 */
async function studyVideo(playbackRate: number, vol: number) {
	const name = getCurrentActivityName();
	$msg.info(`正在学习: ${name}`);

	try {
		const video = await waitForStudyVideo();

		await automation.waitUntilRunning();
		state.study.currentMedia = video;

		setPlaybackRate(playbackRate);
		video.volume = vol;

		await startPlayback(video);

		const autoResume = () => {
			if (automation.isPaused()) return;
			if (!video.ended && video.paused) {
				const playBtn = document.querySelector<HTMLElement>('.mvp-toggle-play');
				if (playBtn) {
					playBtn.click();
				} else {
					video.play().catch(() => {});
				}
			}
		};
		const respectPause = () => {
			if (automation.isPaused()) video.pause();
		};
		video.addEventListener('play', respectPause);
		video.addEventListener('pause', autoResume);

		await new Promise<void>((resolve) => {
			video.addEventListener(
				'ended',
				() => {
					video.removeEventListener('pause', autoResume);
					video.removeEventListener('play', respectPause);
					resolve();
				},
				{ once: true }
			);
		});

		$msg.info(`视频学习完成: ${name}`);
	} catch (err) {
		$msg.warn('视频加载失败或非视频资源，跳过');
	}
}

/**
 * 发送浏览器桌面通知
 * 若权限未授予则先请求；浏览器不支持或用户拒绝则静默忽略
 */
async function browserNotify(title: string, body: string) {
	if (typeof Notification === 'undefined') return;
	if (Notification.permission === 'default') {
		await Notification.requestPermission();
	}
	if (Notification.permission === 'granted') {
		new Notification(title, { body });
	}
}

/**
 * 点击下一个按钮并等待页面更新
 * @returns true 跳转成功，false 所有任务已完成
 */
async function goNext() {
	await automation.waitUntilRunning();
	const nextBtn = document.querySelector<HTMLButtonElement>('.next-btn');
	if (!nextBtn) {
		const errMsg = '未找到"下一个"按钮，学习已停止，请检查页面';
		$msg.error(errMsg);
		browserNotify('国开学习中断', errMsg).catch(() => {});
		return false;
	}

	if (nextBtn.disabled) {
		$msg.success('所有任务已完成！');
		return false;
	}

	// Compare activity identity, not DOM node identity: Vue may reuse or recreate nodes.
	const activityKey = (item: Element | null) =>
		item
			? [item.id, item.getAttribute('data-id'), item.getAttribute('data-activity-id'), item.textContent?.trim()].join(
					'|'
			  )
			: '';
	const prevActiveKey = activityKey(document.querySelector('.full-screen-mode-sidebar-menu-item.active'));
	const prevHash = location.hash;
	const prevVideo = document.querySelector<HTMLVideoElement>('video.vjs-tech');
	const prevVideoSrc = prevVideo?.currentSrc || prevVideo?.getAttribute('src') || '';

	await automation.waitUntilRunning();
	nextBtn.click();
	$msg.info('正在跳转下一个任务...');

	let attempts = 0;
	while (attempts < 20) {
		await automation.delay(1000);
		const currentActive = document.querySelector('.full-screen-mode-sidebar-menu-item.active');
		if (currentActive && activityKey(currentActive) !== prevActiveKey) {
			await automation.delay(1000);
			return true;
		}
		const videoEl = document.querySelector<HTMLVideoElement>('video.vjs-tech');
		const videoSrc = videoEl?.currentSrc || videoEl?.getAttribute('src') || '';
		// A loaded video alone may still be the previous task's player.
		if (
			location.hash !== prevHash &&
			videoEl &&
			videoEl.readyState >= 2 &&
			(videoEl !== prevVideo || (videoSrc !== '' && videoSrc !== prevVideoSrc))
		) {
			await automation.delay(1000);
			return true;
		}
		attempts++;
	}

	// 点击下一个按钮后 20 秒内页面未发生任何变化，视为跳转失败
	const errMsg = '点击"下一个"后页面未响应，学习已停止，请检查页面';
	$msg.error(errMsg);
	browserNotify('国开学习中断', errMsg).catch(() => {});
	return false;
}

/**
 * 国开考试自动答题（测试版）
 * 支持：单选、多选、判断、填空
 */
function ouchnExamWork({ answererWrappers, period, thread, answerSeparators, answerMatchMode }: CommonWorkOptions) {
	$message.info({ content: '开始国开考试自动答题...' });
	CommonProject.scripts.workResults.methods.init();

	const titleTransform = (titles: (HTMLElement | undefined)[]) => {
		return titles
			.filter((t) => t?.innerText)
			.map((t) => t!.innerText.trim())
			.join(',');
	};

	const worker = new OCSWorker({
		// 排除 text(章节标题)、short_answer(简答)、analysis(综合)、matching(匹配) 等无法自动答题的类型
		root: '.subjects-jit-display > li.subject:not(.text):not(.short_answer):not(.analysis):not(.matching)',
		elements: {
			title: '.subject-description',
			options: 'ol.subject-options > li.option, ol.subject-answers > li.answer'
		},
		thread: thread ?? 1,
		answerSeparators: answerSeparators.split(',').map((s) => s.trim()),
		answerMatchMode,
		answerer: async (elements, ctx) => {
			await automation.waitUntilRunning();
			const title = titleTransform(elements.title);
			if (title) {
				const typeNames: Record<string, string> = {
					single: '单选题',
					multiple: '多选题',
					judgement: '判断题',
					completion: '填空题'
				};
				return CommonProject.scripts.apps.methods.searchAnswerInCaches(title, async () => {
					await automation.delay((period ?? 3) * 1000);
					return defaultAnswerWrapperHandler(answererWrappers, {
						type: typeNames[ctx.type || ''] || ctx.type || '未知题型',
						title,
						options: ctx.elements.options.map((o) => o.innerText).join('\n')
					});
				});
			} else {
				throw new Error('题目为空，跳过');
			}
		},
		work: {
			type(ctx) {
				const opts = ctx.elements.options;
				if (!opts.length) return undefined;
				if (opts.some((o) => o.querySelector('input[type="text"]'))) return 'completion';
				if (opts.some((o) => o.querySelector('input[type="checkbox"]'))) return 'multiple';
				if (opts.some((o) => o.querySelector('input[type="radio"]'))) {
					return opts.length === 2 ? 'judgement' : 'single';
				}
				return undefined;
			},
			async handler(type, answer, option) {
				await automation.waitUntilRunning();
				if (worker.isClose) return;
				if (type === 'single' || type === 'judgement' || type === 'multiple') {
					const input = option.querySelector<HTMLInputElement>('input');
					if (input && !input.checked) {
						const label = option.querySelector('label');
						if (label) label.click();
						else input.click();
					}
				} else if (type === 'completion' && answer.trim()) {
					const input = option.querySelector<HTMLInputElement>('input[type="text"]');
					if (input) {
						input.value = answer;
						input.dispatchEvent(new Event('input', { bubbles: true }));
						input.dispatchEvent(new Event('change', { bubbles: true }));
					}
				}
			}
		},
		onResultsUpdate(curr, _, res) {
			CommonProject.scripts.workResults.methods.setResults(simplifyWorkResult(res, titleTransform));
			if (curr.result?.finish) {
				CommonProject.scripts.apps.methods.addQuestionCacheFromWorkResult(simplifyWorkResult([curr], titleTransform));
			}
			CommonProject.scripts.workResults.methods.updateWorkStateByResults(res);
		}
	});

	state.worker = worker;
	worker
		.doWork({ enable_debug: BackgroundProject.scripts.dev.cfg.enable_answerer_debug })
		.then(() => {
			const doneMsg = '考试题目已自动作答，请检查后手动提交。';
			$message.info({ content: doneMsg, duration: 0 });
			browserNotify('国开考试：需要手动交卷', doneMsg).catch(() => {});
			worker.emit('done');
		})
		.catch((err) => {
			const errMsg = `答题失败: ${err}`;
			$message.error({ content: errMsg, duration: 0 });
			browserNotify('国开考试：答题出错', errMsg).catch(() => {});
		});

	if (automation.isPaused()) worker.emit('stop');
	return worker;
}

export const OUHNProject = Project.create({
	name: '国开',
	domains: ['lms.ouchn.cn'],
	scripts: {
		guide: new Script({
			name: '💡 使用提示',
			matches: [['国开所有页面', 'lms.ouchn.cn']],
			namespace: 'ouchn.guide-v1',
			onstart() {
				initializeAutomationControl();
			},
			configs: {
				notes: {
					defaultValue: $ui.notes([
						'手动进入任意课程的视频/课件页面，即可开始自动学习。',
						'支持视频倍速播放、静音播放、自动跳转下一个任务。',
						'使用独立控制条暂停/继续；按住 ⠿ 拖动窗口或控制条。'
					]).outerHTML
				}
			},
			oncomplete() {
				mountAutomationToolbar();
				if (document.querySelector('.full-screen-mode-wrapper')) {
					$msg.info('已进入学习页面，等待自动运行...');
					return;
				}
				CommonProject.scripts.render.methods.pin(this);
			}
		}),
		study: new Script({
			name: '🖥️ 学习脚本',
			namespace: 'ouchn.study-v1',
			matches: [['国开学习页面', 'lms.ouchn.cn']],
			configs: {
				notes: {
					defaultValue: $ui.notes([
						'自动播放视频并自动跳转下一个任务。',
						'非视频资源（图文、资料等）会自动跳过。',
						'请勿在播放过程中最小化浏览器。'
					]).outerHTML
				},
				playbackRate: playbackRate,
				volume: volume,
				restudy: restudy
			},
			oncomplete() {
				this.onConfigChange('playbackRate', (rate) => {
					setPlaybackRate(parseFloat(rate.toString()));
				});
				this.onConfigChange('volume', (v) => {
					const video = document.querySelector<HTMLVideoElement>('video.vjs-tech');
					if (video) video.volume = v;
				});
				this.methods.main();
			},
			methods() {
				return {
					main: async () => {
						CommonProject.scripts.render.methods.pin(this);

						await waitForElement('.full-screen-mode-wrapper', { timeout_seconds: 15 });

						$msg.info('国开学习脚本已启动');

						try {
							while (true) {
								await automation.waitUntilRunning();
								if (!document.querySelector('.full-screen-mode-wrapper')) {
									$msg.warn('已离开学习页面，脚本停止');
									break;
								}

								const rate = parseFloat(this.cfg.playbackRate?.toString() || '1');
								const vol = this.cfg.volume ?? 0;
								await studyVideo(rate, vol);

								const hasNext = await goNext();
								if (!hasNext) break;

								await automation.delay(1000);
							}
						} catch (err) {
							const errMsg = `学习脚本发生异常：${err instanceof Error ? err.message : String(err)}`;
							$msg.error(errMsg);
							browserNotify('国开学习中断', errMsg).catch(() => {});
						}
					}
				};
			}
		}),
		/**
		 * 课程章节页导航脚本
		 * 在课程章节列表页（/course/{id}/ng）检测并跳转到第一个未完成的视频任务
		 */
		courseNav: new Script({
			name: '📋 课程导航',
			namespace: 'ouchn.course-nav-v1',
			matches: [['国开所有页面', 'lms.ouchn.cn']],
			configs: {
				notes: {
					defaultValue: $ui.notes([
						'在课程章节列表页自动检测未完成的视频任务。',
						'开启"自动跳转"后，3 秒内自动进入第一个未完成视频。',
						'关闭时仅显示按钮，需手动点击跳转。'
					]).outerHTML
				},
				autoJump: {
					label: '自动跳转未完成视频',
					defaultValue: true,
					type: 'boolean' as const
				}
			},
			oncomplete() {
				if (!/^\/course\/\d+\/ng/.test(location.pathname)) return;
				CommonProject.scripts.render.methods.pin(this);
				this.methods.init();
			},
			methods() {
				const findFirstIncompleteVideo = (): { activityId: string; activityType: string } | null => {
					const activities = document.querySelectorAll<HTMLElement>('.learning-activity');
					for (const activity of Array.from(activities)) {
						if (activity.classList.contains('ng-hide') || activity.style.display === 'none') continue;
						if (!activity.querySelector('.completeness.none, .completeness.part')) continue;
						if (activity.querySelector('.title.locked')) continue;
						const idMatch = activity.id.match(/learning-activity-(\d+)/);
						if (!idMatch) continue;
						const summaryEl = activity.querySelector<HTMLElement>('[ng-switch-when].activity-summary');
						if (!summaryEl) continue;
						const activityType = summaryEl.getAttribute('ng-switch-when');
						// 只跳转视频任务
						if (activityType !== 'online_video') continue;
						return { activityId: idMatch[1], activityType };
					}
					return null;
				};

				const getCourseId = () => {
					const el = document.getElementById('courseId') as HTMLInputElement | null;
					return el?.value || location.pathname.match(/\/course\/(\d+)/)?.[1] || '';
				};

				return {
					findFirstIncompleteVideo,
					getCourseId,
					init: async () => {
						await waitForElement('.learning-activity', { timeout_seconds: 20 });
						await automation.delay(1500);

						const result = findFirstIncompleteVideo();
						if (!result) {
							$msg.success('没有未完成的视频任务！');
							return;
						}

						const { activityId } = result;
						const courseId = getCourseId();
						const url = `/course/${courseId}/learning-activity/full-screen#/${activityId}`;

						// 统计未完成视频总数
						const allActivities = Array.from(document.querySelectorAll<HTMLElement>('.learning-activity'));
						const totalVideos = allActivities.filter((a) => {
							if (a.classList.contains('ng-hide') || a.style.display === 'none') return false;
							if (!a.querySelector('.completeness.none, .completeness.part')) return false;
							if (a.querySelector('.title.locked')) return false;
							const summary = a.querySelector('[ng-switch-when].activity-summary');
							return summary?.getAttribute('ng-switch-when') === 'online_video';
						}).length;

						$msg.info(`检测到 ${totalVideos} 个未完成视频任务`);

						if (courseId) {
							const old = document.getElementById('ocs-course-nav-btn');
							if (old) old.remove();
							const btn = document.createElement('button');
							btn.id = 'ocs-course-nav-btn';
							btn.textContent = `▶ 前往第一个未完成视频（共 ${totalVideos} 个）`;
							btn.style.cssText = [
								'position:fixed',
								'bottom:20px',
								'left:50%',
								'transform:translateX(-50%)',
								'z-index:9998',
								'padding:10px 24px',
								'background:#19be6b',
								'color:#fff',
								'border:none',
								'border-radius:6px',
								'cursor:pointer',
								'font-size:14px',
								'box-shadow:0 2px 12px rgba(0,0,0,.25)',
								'white-space:nowrap',
								'line-height:1.5'
							].join(';');
							btn.disabled = automation.isPaused();
							automation.subscribe((paused) => {
								btn.disabled = paused;
							});
							btn.onclick = async () => {
								await automation.waitUntilRunning();
								btn.remove();
								location.href = url;
							};
							document.body.appendChild(btn);
						}

						if (this.cfg.autoJump && courseId) {
							$msg.info('3 秒后自动跳转...');
							await automation.delay(3000);
							document.getElementById('ocs-course-nav-btn')?.remove();
							location.href = url;
						}
					}
				};
			}
		}),
		/**
		 * 作业考试脚本（测试版）
		 * 通过等待 .exam-paper.notranslate 来检测考试页面，非考试页面 10 秒后自动退出
		 */
		work: new Script({
			name: '📝 作业考试',
			namespace: 'ouchn.work-v1',
			matches: [['国开考试页面', 'lms.ouchn.cn']],
			configs: {
				notes: {
					defaultValue: $ui.notes([
						'【测试版】支持单选、多选、判断、填空自动答题。',
						'使用前请在 "通用-全局设置" 中配置题库。',
						'进入考试答题页面后脚本自动识别并运行，答完后请手动提交。',
						'简答题/综合题不支持自动答题，需手动填写。'
					]).outerHTML
				}
			},
			oncomplete() {
				waitForElement('.exam-paper.notranslate', { timeout_seconds: 10 }).then((el) => {
					if (!el) return;
					CommonProject.scripts.render.methods.pin(this);
					commonWork(this, {
						beforeRunning: () => automation.waitUntilRunning(),
						workerProvider: (opts) => ouchnExamWork(opts)
					});
				});
			}
		})
	}
});

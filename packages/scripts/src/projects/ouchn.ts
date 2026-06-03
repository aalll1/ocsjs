import { $, OCSWorker, defaultAnswerWrapperHandler } from '@ocsjs/core';
import { Project, Script, $ui, $message } from 'easy-us';
import { playMedia, $msg, CommonWorkOptions } from '../utils';
import { CommonProject } from './common';
import { BackgroundProject } from './background';
import { waitForElement, waitForMedia } from '../utils/study';
import { playbackRate, volume, restudy } from '../utils/configs';
import { commonWork, simplifyWorkResult } from '../utils/work';

/**
 * 模块级状态，供 study 和 work 脚本共享
 */
const state = {
	study: {
		/** 用户手动暂停 */
		paused: false,
		/** 当前播放的媒体元素 */
		currentMedia: undefined as HTMLVideoElement | undefined
	}
};

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
	const titleEl = activeItem?.querySelector<HTMLElement>(
		'.full-screen-mode-sidebar-menu-item-title .text-too-long'
	);
	return titleEl?.innerText?.trim() || '未知';
}

/**
 * 播放视频：先尝试点击 MVP 播放按钮，再调用原生 play
 */
async function startPlayback(video: HTMLVideoElement) {
	const playBtn = document.querySelector<HTMLElement>('.mvp-toggle-play');
	if (playBtn) {
		playBtn.click();
		await $.sleep(500);
	}
	if (video.paused) {
		await playMedia(() => video.play());
	}
}

/**
 * 学习单个视频，返回 Promise 在视频播放完成时 resolve
 */
async function studyVideo(playbackRate: number, vol: number) {
	const name = getCurrentActivityName();
	$msg.info(`正在学习: ${name}`);

	try {
		const video = (await waitForMedia({
			videoSelector: 'video.vjs-tech',
			timeout: 10000,
			filter: (v) => v.readyState >= 2 || !!v.getAttribute('src')
		})) as HTMLVideoElement;

		state.study.currentMedia = video;

		setPlaybackRate(playbackRate);
		video.volume = vol;

		await startPlayback(video);

		const autoResume = () => {
			if (state.study.paused) return;
			if (!video.ended && video.paused) {
				const playBtn = document.querySelector<HTMLElement>('.mvp-toggle-play');
				if (playBtn) {
					playBtn.click();
				} else {
					video.play().catch(() => {});
				}
			}
		};
		video.addEventListener('pause', autoResume);

		await new Promise<void>((resolve) => {
			video.addEventListener(
				'ended',
				() => {
					video.removeEventListener('pause', autoResume);
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

	const prevActiveItem = document.querySelector(
		'.full-screen-mode-sidebar-menu-item.active'
	);

	nextBtn.click();
	$msg.info('正在跳转下一个任务...');

	let attempts = 0;
	while (attempts < 20) {
		await $.sleep(1000);
		const currentActive = document.querySelector(
			'.full-screen-mode-sidebar-menu-item.active'
		);
		if (currentActive && currentActive !== prevActiveItem) {
			await $.sleep(1000);
			return true;
		}
		const videoEl = document.querySelector<HTMLVideoElement>('video.vjs-tech');
		if (videoEl && videoEl.readyState >= 2) {
			await $.sleep(1000);
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
		answerer: (elements, ctx) => {
			const title = titleTransform(elements.title);
			if (title) {
				const typeNames: Record<string, string> = {
					single: '单选题', multiple: '多选题', judgement: '判断题', completion: '填空题'
				};
				return CommonProject.scripts.apps.methods.searchAnswerInCaches(title, async () => {
					await $.sleep((period ?? 3) * 1000);
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
			handler(type, answer, option) {
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
				CommonProject.scripts.apps.methods.addQuestionCacheFromWorkResult(
					simplifyWorkResult([curr], titleTransform)
				);
			}
			CommonProject.scripts.workResults.methods.updateWorkStateByResults(res);
		}
	});

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
			configs: {
				notes: {
					defaultValue: $ui.notes([
						'手动进入任意课程的视频/课件页面，即可开始自动学习。',
						'支持视频倍速播放、静音播放、自动跳转下一个任务。'
					]).outerHTML
				}
			},
			oncomplete() {
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
								if (!document.querySelector('.full-screen-mode-wrapper')) {
									$msg.warn('已离开学习页面，脚本停止');
									break;
								}

								// 直接等视频元素出现（最多10秒），不依赖侧栏图标
								const videoEl = await waitForElement('video.vjs-tech', { timeout_seconds: 10 });
								if (videoEl) {
									const rate = parseFloat(this.cfg.playbackRate?.toString() || '1');
									const vol = this.cfg.volume ?? 0;
									await studyVideo(rate, vol);
								} else {
									const name = getCurrentActivityName();
									$msg.info(`非视频资源，跳过: ${name}`);
									await $.sleep(3000);
								}

								const hasNext = await goNext();
								if (!hasNext) break;

								await $.sleep(1000);
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
						await $.sleep(1500);

						const result = findFirstIncompleteVideo();
						if (!result) {
							$msg.success('没有未完成的视频任务！');
							return;
						}

						const { activityId, activityType } = result;
						const courseId = getCourseId();
						const url = `/course/${courseId}/learning-activity#/${activityType}/${activityId}`;

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
								'position:fixed', 'bottom:20px', 'left:50%',
								'transform:translateX(-50%)', 'z-index:9998',
								'padding:10px 24px', 'background:#19be6b', 'color:#fff',
								'border:none', 'border-radius:6px', 'cursor:pointer',
								'font-size:14px', 'box-shadow:0 2px 12px rgba(0,0,0,.25)',
								'white-space:nowrap', 'line-height:1.5'
							].join(';');
							btn.onclick = () => {
								btn.remove();
								location.href = url;
							};
							document.body.appendChild(btn);
						}

						if (this.cfg.autoJump && courseId) {
							$msg.info('3 秒后自动跳转...');
							await $.sleep(3000);
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
						workerProvider: (opts) => ouchnExamWork(opts)
					});
				});
			}
		})
	}
});

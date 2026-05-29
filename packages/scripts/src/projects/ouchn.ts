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
 * 检查当前活动是否为视频类型
 */
function isVideoActivity() {
	const activeItem = document.querySelector('.full-screen-mode-sidebar-menu-item.active');
	if (!activeItem) return false;
	return !!activeItem.querySelector('.font-syllabus-online-video');
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
 * 点击下一个按钮并等待页面更新
 * @returns true 跳转成功，false 所有任务已完成
 */
async function goNext() {
	const nextBtn = document.querySelector<HTMLButtonElement>('.next-btn');
	if (!nextBtn) {
		$msg.error('未找到"下一个"按钮');
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
	return true;
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
		root: '.subjects-jit-display > li.subject',
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
				return CommonProject.scripts.apps.methods.searchAnswerInCaches(title, async () => {
					await $.sleep((period ?? 3) * 1000);
					return defaultAnswerWrapperHandler(answererWrappers, {
						type: ctx.type || 'unknown',
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
				// 填空题：有 text 输入框
				if (opts.some((o) => o.querySelector('input[type="text"]'))) return 'completion';
				// 多选题：有 checkbox
				if (opts.some((o) => o.querySelector('input[type="checkbox"]'))) return 'multiple';
				// 单选/判断：有 radio，2 个选项则判断题
				if (opts.some((o) => o.querySelector('input[type="radio"]'))) {
					return opts.length === 2 ? 'judgement' : 'single';
				}
				return undefined;
			},
			handler(type, answer, option) {
				if (type === 'single' || type === 'judgement' || type === 'multiple') {
					const input = option.querySelector<HTMLInputElement>('input');
					if (input && !input.checked) {
						// AngularJS 通过 label click 触发 ng-model 更新
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
			$message.info({ content: '考试题目已自动作答，请检查后手动提交。', duration: 0 });
			worker.emit('done');
		})
		.catch((err) => {
			$message.error({ content: `答题失败: ${err}`, duration: 0 });
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

						while (true) {
							if (!document.querySelector('.full-screen-mode-wrapper')) {
								$msg.warn('已离开学习页面，脚本停止');
								break;
							}

							if (isVideoActivity()) {
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
					}
				};
			}
		}),
		/**
		 * 作业考试脚本（测试版 v4.14.1）
		 * 仅在 ng-app="exam" 的国开答题页面运行，通过 DOM 检测区分考试活动页和学习页
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
				// 仅在国开考试答题页面（ng-app="exam"）运行
				const ngApp = document.documentElement.getAttribute('ng-app');
				if (ngApp !== 'exam') return;

				// 等待答题卷加载（非结果页）
				waitForElement('.exam-paper.notranslate', { timeout_seconds: 20 }).then((el) => {
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

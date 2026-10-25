import { $, OCSWorker, defaultAnswerWrapperHandler } from '@ocsjs/core';
import { Project, Script, $ui, $message, $store, $elements } from 'easy-us';
import { createAutomationControl } from '../utils/automation-control';
import { installAutomationPanel } from '../utils/panel-controls';
import { playMedia, $msg, CommonWorkOptions } from '../utils';
import { CommonProject } from './common';
import { BackgroundProject } from './background';
import { waitForElement } from '../utils/study';
import { playbackRate, volume, restudy } from '../utils/configs';
import { commonWork, simplifyWorkResult } from '../utils/work';
import { getChoiceQuestionType, readChoiceQuestion } from '../utils/choice-question';
import { readLearningResource, isVisible } from '../utils/resource-reader';
import { ExamSession, recordExamResult, readExamScore, canSubmitExam } from '../utils/ouchn-exam-flow';

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

function mountAutomationPanel() {
	if (self !== top) return;
	// Remove the old detached control if a script manager hot-reloads this version.
	document.getElementById('ocs-ouchn-control')?.remove();
	if ($elements.root) installAutomationPanel($elements.root, automation);
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
		throw new Error(`视频加载失败，已停止，未跳过：${err instanceof Error ? err.message : String(err)}`);
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

/** Stored per exam so reloads and full-page result navigation preserve the retry cap. */
function examId() {
	return location.pathname.match(/\/exam\/(\d+)/)?.[1] || location.hash.match(/exam\/(\d+)/)?.[1];
}
function examSession(create = false): ExamSession | undefined {
	const id = examId();
	if (!id) return;
	const saved = $store.get(`ouchn.exam.flow.${id}`, undefined) as ExamSession | undefined;
	if (saved && Date.now() - saved.updated < 24 * 60 * 60 * 1000) return saved;
	if (create) return { id, failures: 0, seen: [], status: 'answering', updated: Date.now() };
}
function saveExamSession(session: ExamSession) {
	session.updated = Date.now();
	$store.set(`ouchn.exam.flow.${session.id}`, session);
}
function examNotice(content: string) {
	// A nonblocking popup allows the automatic retry/next action to continue.
	$message.warn({ content, duration: 0 });
	browserNotify('国开测验', content).catch(() => {});
}
async function waitExamElement(selector: string, seconds = 30): Promise<HTMLElement> {
	for (let i = 0; i < seconds * 2; i++) {
		await automation.waitUntilRunning();
		const el = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(isVisible);
		if (
			el &&
			!el.hasAttribute('disabled') &&
			el.getAttribute('ng-disabled') !== 'true' &&
			el.getAttribute('aria-disabled') !== 'true' &&
			!el.classList.contains('disabled')
		)
			return el;
		await automation.delay(500);
	}
	throw new Error('测验页面未出现可用控件，可能没有剩余次数或尚未开放，自动流程已停止。');
}
async function submitExam(
	results: { result?: { finish?: boolean }; error?: unknown }[],
	worker: Pick<OCSWorker, 'isStop' | 'isClose'>
) {
	await automation.waitUntilRunning();
	while (worker.isStop && !worker.isClose) await automation.delay(500);
	if (worker.isClose) return;
	if (!canSubmitExam(document, results)) throw new Error('仍有未成功作答或不支持的题目，已停止自动交卷。');
	const session = examSession(true);
	if (!session || ['skip', 'complete', 'stopped'].includes(session.status))
		throw new Error('当前测验自动流程已结束，请检查后再开始。');
	const submit = await waitExamElement('[ng-click="calUnsavedSubjects()"]');
	await automation.waitUntilRunning();
	submit.click();
	const confirm = await waitExamElement('#submit-exam-confirmation-popup button[ng-click^="submitAnswer("]');
	const popup = confirm.closest('#submit-exam-confirmation-popup');
	if (/还有\s*[1-9]\d*\s*道题目未作答/.test(popup?.textContent || ''))
		throw new Error('平台提示仍有题目未作答，已停止交卷。');
	await automation.waitUntilRunning();
	while (worker.isStop && !worker.isClose) await automation.delay(500);
	if (worker.isClose || !canSubmitExam(document, results)) return;
	session.status = 'awaiting-result';
	saveExamSession(session);
	confirm.click();
}
let examNavigationStarted = false;
async function runExamNavigation() {
	if (examNavigationStarted || self !== top) return;
	examNavigationStarted = true;
	let waiting = 0;
	let lastRoute = '';
	while (true) {
		await automation.delay(1000);
		const route = location.pathname + location.hash;
		if (route !== lastRoute) {
			waiting = 0;
			lastRoute = route;
		}
		const session = examSession();
		if (session?.pendingNotice && document.querySelector('.full-screen-mode-wrapper')) {
			examNotice(session.pendingNotice);
			delete session.pendingNotice;
			saveExamSession(session);
		}
		if (!session || session.status === 'stopped') continue;
		try {
			const result = document.querySelector('.exam-paper.exam-result');
			if (result && session.status !== 'answering') {
				const score = readExamScore(document);
				if (!score) {
					if (++waiting >= 120) throw new Error('成绩尚未公布或无法读取满分值，已停止自动重答。');
					continue;
				}
				const submission = location.hash.match(/submission\/(\d+)/)?.[1];
				if (!submission) throw new Error('无法确认提交记录，已停止自动重答。');
				if (session.status !== 'awaiting-result' && !session.seen.includes(submission)) continue;
				const outcome = recordExamResult(session, submission, score.score, score.maximum);
				if (outcome) {
					session.feedback = Array.from(result.querySelectorAll<HTMLElement>('li.subject:not(.text)')).flatMap(
						(root) => {
							try {
								const question = readChoiceQuestion(root);
								const options = Array.from(root.querySelectorAll<HTMLElement>('ol.subject-options > li.option'));
								const earned = root.querySelector('[ng-bind="subject.getScore()"]')?.textContent?.trim();
								const possible = root.querySelector('[ng-bind="subject.getPoint()"]')?.textContent?.trim();
								if (!earned || !possible) return [];
								return [
									{
										title: question.title,
										selected: question.options
											.filter((_, i) => options[i]?.querySelector<HTMLInputElement>('input')?.checked)
											.map((o) => o.text),
										correct: Number(earned) === Number(possible)
									}
								];
							} catch {
								return [];
							}
						}
					);
					if (outcome.notice === 'retry')
						session.pendingNotice = `本次 ${score.score}/${score.maximum} 分，未满分，将自动重答；连续 3 次未满分会跳过。`;
					if (outcome.notice === 'skip')
						session.pendingNotice = `连续 3 次未满分（本次 ${score.score}/${score.maximum} 分），已停止重答，即将跳过此测验。`;
					if (outcome.notice === 'complete')
						session.pendingNotice = `测验已满分：${score.score}/${score.maximum}，即将进入下一项。`;
					saveExamSession(session);
				}
				const back = await waitExamElement('a[ng-click*="hasUnsavedSubjects"]');
				if (!back.textContent?.includes('返回测试')) throw new Error('未找到返回测试入口。');
				await automation.waitUntilRunning();
				back.click();
				await automation.delay(2000);
			} else if (
				document.querySelector('.full-screen-mode-wrapper') &&
				/exam\/\d+/.test(location.hash) &&
				['answering', 'retry'].includes(session.status)
			) {
				if (!CommonProject.scripts.settings.methods.getWorkOptions().answererWrappers.length)
					throw new Error('请先在全局设置填写 DeepSeek API Key，再开始测验。');
				const start = await waitExamElement('a.take-exam');
				await automation.waitUntilRunning();
				start.click();
				const checkbox = (await waitExamElement(
					'#start-exam-confirmation-popup input[type="checkbox"]'
				)) as HTMLInputElement;
				await automation.waitUntilRunning();
				if (!checkbox.checked) checkbox.click();
				const button = await waitExamElement('#start-exam-confirmation-popup button[ng-click="takeExam()"]');
				await automation.waitUntilRunning();
				session.status = 'answering';
				saveExamSession(session);
				button.click();
				await automation.delay(3000);
			} else if (session.status === 'awaiting-result' && ++waiting >= 120) {
				throw new Error('交卷后未出现可确认成绩，已停止，避免重复提交。');
			}
		} catch (err) {
			session.status = 'stopped';
			saveExamSession(session);
			examNotice(err instanceof Error ? err.message : String(err));
			automation.setPaused(true);
		}
	}
}

/**
 * 国开考试自动答题（测试版）
 * 支持：单选、多选、判断、填空
 */
function ouchnExamWork({ answererWrappers, period, thread, answerSeparators, answerMatchMode }: CommonWorkOptions) {
	const searchWrappers = answererWrappers.filter((wrapper) => wrapper.provider === 'deepseek-search');
	const useWebSearch = searchWrappers.length > 0;
	$message.info({ content: useWebSearch ? '开始国开联网检索答题...' : '开始国开考试自动答题...' });
	CommonProject.scripts.workResults.methods.init();

	const titleTransform = (titles: (HTMLElement | undefined)[]) => {
		return titles
			.filter((t) => t?.innerText)
			.map((t) => t!.innerText.trim())
			.join(',');
	};

	const clearedQuestions = new WeakSet<Element>();
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
			if (useWebSearch) {
				const question = readChoiceQuestion(ctx.root);
				const previous = examSession()?.feedback?.find((item) => item.title === question.title);
				if (previous) question.previousAttempt = { selectedOptions: previous.selected, wasCorrect: previous.correct };
				await automation.delay((period ?? 3) * 1000);
				return defaultAnswerWrapperHandler(searchWrappers, {
					question,
					title: question.title,
					beforeRequest: () => automation.waitUntilRunning()
				});
			}
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
				const choiceType = getChoiceQuestionType(ctx.root);
				if (choiceType) return choiceType;
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
					const root = option.closest?.('li.subject');
					if (type === 'multiple' && root && !clearedQuestions.has(root)) {
						for (const checked of Array.from(
							root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')
						)) {
							await automation.waitUntilRunning();
							const label = checked.closest('label');
							if (label) label.click();
							else checked.click();
						}
						clearedQuestions.add(root);
					}
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
			if (curr.result?.finish && !useWebSearch) {
				CommonProject.scripts.apps.methods.addQuestionCacheFromWorkResult(simplifyWorkResult([curr], titleTransform));
			}
			CommonProject.scripts.workResults.methods.updateWorkStateByResults(res);
		}
	});

	state.worker = worker;
	worker
		.doWork({ enable_debug: BackgroundProject.scripts.dev.cfg.enable_answerer_debug })
		.then(async (results) => {
			await submitExam(results, worker);
			worker.emit('done');
		})
		.catch((err) => {
			const session = examSession(true);
			if (session) {
				session.status = 'stopped';
				saveExamSession(session);
			}
			automation.setPaused(true);
			worker.emit('done');
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
						'使用面板标题栏的暂停/继续按钮；按住 ⠿ 拖动窗口。'
					]).outerHTML
				}
			},
			oncomplete() {
				mountAutomationPanel();
				runExamNavigation();
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
						'图文与课件会缓慢阅读到末尾，再进入下一项；不支持的阅读器会停留提示。',
						'阅读滚动速度可在下方调整，默认 3x，调整后下一步滚动即生效。',
						'请勿在播放过程中最小化浏览器。'
					]).outerHTML
				},
				playbackRate: playbackRate,
				volume: volume,
				readingSpeed: {
					label: '阅读滚动速度',
					tag: 'select',
					options: [0.5, 1, 2, 3, 5, 10].map((speed) => [
						speed.toString(),
						`${speed} x${speed === 3 ? '（默认）' : ''}`
					]),
					defaultValue: '3'
				},
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
								const active = document.querySelector('.full-screen-mode-sidebar-menu-item.active');
								if (active?.querySelector('.font-syllabus-exam') || /exam\/\d+/.test(location.hash)) {
									const session = examSession(true);
									if (!session) throw new Error('无法识别测验编号，停止切换。');
									saveExamSession(session);
									while (true) {
										await automation.delay(1000);
										const latest = examSession();
										if (latest?.status === 'stopped') throw new Error('测验流程已停止，请检查提示。');
										if (latest && ['complete', 'skip'].includes(latest.status)) {
											if (latest.pendingNotice) {
												const notice = latest.pendingNotice;
												delete latest.pendingNotice;
												saveExamSession(latest);
												examNotice(notice);
											}
											break;
										}
									}
								} else if (
									active?.querySelector('.font-syllabus-online-video') ||
									(!active && document.querySelector('video.vjs-tech'))
								) {
									await studyVideo(rate, vol);
								} else if (
									active?.querySelector('.font-syllabus-page, .font-syllabus-material, .font-syllabus-slide')
								) {
									$msg.info('正在逐段阅读图文/课件，读到末尾后进入下一项...');
									await readLearningResource(document, automation, () => Number(this.cfg.readingSpeed));
								} else throw new Error('不支持的资源类型，已停止，未跳过。');

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
		 * 在课程章节列表页（/course/{id}/ng）检测并跳转到第一个未完成的学习任务
		 */
		courseNav: new Script({
			name: '📋 课程导航',
			namespace: 'ouchn.course-nav-v1',
			matches: [['国开所有页面', 'lms.ouchn.cn']],
			configs: {
				notes: {
					defaultValue: $ui.notes([
						'在课程章节列表页自动检测未完成的学习任务。',
						'开启"自动跳转"后，3 秒内自动进入第一个未完成学习任务。',
						'关闭时仅显示按钮，需手动点击跳转。'
					]).outerHTML
				},
				autoJump: {
					label: '自动跳转未完成学习任务',
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
						// 按课程顺序保留视频、图文、课件与测验任务
						if (!activityType || !['online_video', 'page', 'material', 'slide', 'exam'].includes(activityType))
							continue;
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
							$msg.success('没有未完成的学习任务！');
							return;
						}

						const { activityId } = result;
						const courseId = getCourseId();
						const url = `/course/${courseId}/learning-activity/full-screen#/${activityId}`;

						// 统计未完成学习任务总数
						const allActivities = Array.from(document.querySelectorAll<HTMLElement>('.learning-activity'));
						const totalVideos = allActivities.filter((a) => {
							if (a.classList.contains('ng-hide') || a.style.display === 'none') return false;
							if (!a.querySelector('.completeness.none, .completeness.part')) return false;
							if (a.querySelector('.title.locked')) return false;
							const summary = a.querySelector('[ng-switch-when].activity-summary');
							return ['online_video', 'page', 'material', 'slide', 'exam'].includes(
								summary?.getAttribute('ng-switch-when') || ''
							);
						}).length;

						$msg.info(`检测到 ${totalVideos} 个未完成学习任务任务`);

						if (courseId) {
							const old = document.getElementById('ocs-course-nav-btn');
							if (old) old.remove();
							const btn = document.createElement('button');
							btn.id = 'ocs-course-nav-btn';
							btn.textContent = `▶ 前往第一个未完成学习任务（共 ${totalVideos} 个）`;
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
						'【测试版】支持文本单选、多选、判断自动答题。',
						'使用前请在“通用-全局设置”中填写 DeepSeek API Key。',
						'从网页读取题干和选项文本，先联网搜索再分析；全部支持题型答完后自动交卷，未满分重答，连续 3 次未满分跳过。',
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
						onRestart: () => {
							const session = examSession(true);
							if (session) {
								if (['complete', 'skip'].includes(session.status)) {
									session.failures = 0;
									session.seen = [];
								}
								session.status = 'answering';
								delete session.pendingNotice;
								saveExamSession(session);
							}
						},
						workerProvider: (opts) => ouchnExamWork(opts)
					});
				});
			}
		})
	}
});

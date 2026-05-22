import { $ } from '@ocsjs/core';
import { Project, Script, $ui } from 'easy-us';
import { playMedia, $msg } from '../utils';
import { CommonProject } from './common';
import { waitForElement, waitForMedia } from '../utils/study';
import { playbackRate, volume, restudy } from '../utils/configs';

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
		 * 作业考试脚本（占位，等待国开作业页面 URL 和 DOM 确认后实现）
		 * @see docs/ouchn-work-plan-a.md
		 */
		work: new Script({
			name: '📝 作业考试',
			namespace: 'ouchn.work-v1',
			matches: [['国开作业页面', 'TODO']],
			hideInPanel: true,
			configs: {
				notes: {
					defaultValue: $ui.notes([
						'自动答题前请在 "通用-全局设置" 中设置题库配置。',
						'可以搭配 "通用-在线搜题" 一起使用。',
						'请手动进入作业考试页面才能使用自动答题。'
					]).outerHTML
				}
			},
			oncomplete() {
				// TODO: 拿到国开作业页面 DOM 后实现
				// 参考: packages/scripts/src/projects/zjy.ts:632-720
				// commonWork(this, {
				//     workerProvider: (opt) => ouchnWorkOrExam(opt)
				// });
			}
		})
	}
});

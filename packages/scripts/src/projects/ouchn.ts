import { $ } from '@ocsjs/core';
import { Project, Script, $ui } from 'easy-us';
import { playMedia, $msg } from '../utils';
import { CommonProject } from './common';
import { waitForElement, waitForMedia } from '../utils/study';
import { playbackRate, volume, restudy } from '../utils/configs';

/**
 * 设置 MVP 播放器的倍速
 * 国开的 MVP 播放器通过点击倍速按钮来切换，不直接设置 video.playbackRate
 */
function setPlaybackRate(rate: number) {
	const rateBtns = document.querySelectorAll<HTMLElement>('.mvp-play-rate');
	const target = rate.toFixed(2) + 'X';
	rateBtns.forEach((btn) => {
		btn.classList.toggle('active', btn.innerText.trim() === target);
	});
	// 同时也设置 video 元素的 playbackRate
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
	const titleEl = activeItem?.querySelector<HTMLElement>('.full-screen-mode-sidebar-menu-item-title .text-too-long');
	return titleEl?.innerText?.trim() || '未知';
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
			},
			methods() {
				return {
					main: async () => {
						CommonProject.scripts.render.methods.pin(this);

						// 等待全屏模式加载
						await waitForElement('.full-screen-mode-wrapper', { timeout_seconds: 15 });

						$msg.info('国开学习脚本已启动');

						/**
						 * 学习单个视频
						 */
						const studyVideo = async () => {
							const name = getCurrentActivityName();
							$msg.info(`正在学习: ${name}`);

							try {
								const video = await waitForMedia({
									videoSelector: 'video.vjs-tech',
									timeout: 10000
								});

								// 设置初始倍速和音量
								const rate = parseFloat(this.cfg.playbackRate?.toString() || '1');
								setPlaybackRate(rate);
								video.volume = this.cfg.volume ?? 0;

								// 播放视频
								await playMedia(() => video.play());

								// 监听暂停事件，自动续播
								const autoResume = () => {
									if (!video.ended && video.paused) {
										video.play().catch(() => {});
									}
								};
								video.addEventListener('pause', autoResume);

								// 等待视频播放结束
								await new Promise<void>((resolve) => {
									video.addEventListener('ended', () => {
										video.removeEventListener('pause', autoResume);
										resolve();
									}, { once: true });
								});

								$msg.info(`视频学习完成: ${name}`);
							} catch (err) {
								$msg.warn('视频加载失败或非视频资源，跳过');
							}
						};

						/**
						 * 点击下一个按钮并等待页面更新
						 */
						const goNext = async () => {
							const nextBtn = document.querySelector<HTMLButtonElement>('.next-btn');
							if (!nextBtn) {
								$msg.error('未找到"下一个"按钮');
								return false;
							}

							// 记录当前活动元素，用于检测页面是否更新
							const prevActiveItem = document.querySelector('.full-screen-mode-sidebar-menu-item.active');

							nextBtn.click();
							$msg.info('正在跳转下一个任务...');

							// 等待页面内容更新（active 类切换或页面内容变化）
							await $.sleep(3000);

							// 等待新的活动加载
							let attempts = 0;
							while (attempts < 15) {
								const currentActive = document.querySelector('.full-screen-mode-sidebar-menu-item.active');
								// 如果 active 项发生变化，说明页面已更新
								if (currentActive && currentActive !== prevActiveItem) {
									await $.sleep(1000); // 额外等待内容渲染
									return true;
								}
								// 或者如果视频元素变化了
								const video = document.querySelector<HTMLVideoElement>('video.vjs-tech');
								if (video && video.src) {
									await $.sleep(1000);
									return true;
								}
								await $.sleep(1000);
								attempts++;
							}
							return true; // 超时也继续尝试
						};

						// 主循环
						while (true) {
							// 检查页面是否还在学习页面
							if (!document.querySelector('.full-screen-mode-wrapper')) {
								$msg.warn('已离开学习页面，脚本停止');
								break;
							}

							if (isVideoActivity()) {
								await studyVideo();
							} else {
								const name = getCurrentActivityName();
								$msg.info(`非视频资源，跳过: ${name}`);
								await $.sleep(2000);
							}

							// 检查是否需要复习（已完成的内容）
							const activeItem = document.querySelector('.full-screen-mode-sidebar-menu-item.active');
							// 国开的已完成活动不会自动跳过，由 restudy 配置控制

							const hasNext = await goNext();
							if (!hasNext) break;

							// 短暂等待后检查是否还在同一页面
							await $.sleep(2000);
						}
					}
				};
			}
		})
	}
});

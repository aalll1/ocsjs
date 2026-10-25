<div align="center">

<div style="padding:8px;border-radius:100%;background:white;width:124px;height:124px">
<img src="https://cdn.ocsjs.com/resources/img/logo.png" width=124 height=124  >
</div>

# OCS 网课助手

> OCS (Online Course Script) 网课刷课脚本，帮助大学生解决网课难题

[![Release](https://img.shields.io/github/v/release/aalll1/ocsjs)](https://github.com/aalll1/ocsjs/releases/latest)
[![License](https://img.shields.io/github/license/aalll1/ocsjs)](LICENSE)

</div>
 
<div align="center">

## 当前版本：4.14.14

本仓库是 [ocsjs/ocsjs](https://github.com/ocsjs/ocsjs) 的维护分支，保留上游 MIT 许可及作者信息，主要维护国开平台适配。

本维护分支在 AI 工具的辅助下开发与维护，AI 参与代码编写、问题排查、测试和文档整理。上游项目及原作者的署名与 MIT 许可予以保留。

[下载正式脚本](https://github.com/aalll1/ocsjs/releases/latest/download/ocs.user.js) · [全部发布文件](https://github.com/aalll1/ocsjs/releases/latest) · [问题反馈](https://github.com/aalll1/ocsjs/issues)

下载后通过 Tampermonkey 或脚本猫安装。国开脚本面板标题栏中的“暂停 / 继续”按钮可控制运行，最小化面板后仍可使用；按住“⠿”拖动窗口。暂停状态会保留，需点击“继续”才恢复。在“通用 → 全局设置”填写 DeepSeek 官方 API Key，选择分析模型和每题搜索结果数。联网答题目前适配国开文本单选、多选和判断题；全部支持题型成功作答后自动提交；未满分自动重答，连续 3 次未满分提示并跳过。图文和课件缓慢阅读到末尾后才进入下一项。

## 官网及教程 [https://docs.ocsjs.com](https://docs.ocsjs.com)

## 支持的平台

| 平台 | 域名 |
|------|------|
| 超星学习通 | chaoxing.com |
| 知到智慧树 | zhihuishu.com |
| 中国大学MOOC | icourse163.org |
| 职教云 | zjy |
| 智慧职教 | icve |
| 雨课堂 | yuketang |
| **国开** | **lms.ouchn.cn** |

## 更新日志

### v4.14.14 (2026-10-25)

- 图文和 PDF/PPT 预览逐段滚动到末尾，多附件逐一阅读，不再直接跳过非视频资源。
- 答完自动提交；第一次未满分提示、第二次静默重答、第三次提示并跳过；满分后提示并继续。
- 重试计数跨刷新保留，重答参考平台反馈，并清除旧多选勾选。
- 未答完、成绩未公布或阅读器不支持时停止提示；所有页面操作遵守暂停。

### v4.14.13 (2026-10-25)

- 新增 DeepSeek 联网答题：逐题读取题干和选项文本，先调用搜索接口，再让模型依据搜索资料返回答案。
- 全局设置改为 DeepSeek API Key、模型和搜索数量；旧题库界面不再显示，旧实现保留作兼容参考。
- 搜索失败、空结果、无效选项或无来源引用时停止该题，不回退到纯模型或随机答案。
- 结果中展示答案依据和网页来源；联网模式不读取旧答案缓存，也不把未评分的 AI 答案写入缓存。
- API Key 仅本地保存且输入框隐藏；导出设置排除 API Key 和旧接口凭据。


### v4.14.12 (2026-10-25)

- 将暂停/继续按钮集成到原面板标题栏，移除页面上的独立控制条。
- 切换面板、标题栏重绘或最小化后仍可暂停/继续，保留暂停状态记忆与窗口拖动。


### v4.14.11 (2026-10-25)

- 新增独立的“暂停全部 / 继续运行”控制条：暂停播放、自动跳转、新题库请求及答案填写，暂停状态刷新后保留并同步到其他国开页面。
- 暂停时冻结自动跳转倒计时；已发出的题库请求可能返回，但暂停期间不会填写答案。
- 主窗口和控制条支持拖动，增加明显的拖动手柄，保存位置并限制窗口移出屏幕。
- 修复页面事件拦截导致的拖动失败，以及窗口重绘后拖动入口丢失的问题。


### v4.14.10 (2026-10-25)

- 课程导航适配当前 `/learning-activity/full-screen#/{activityId}` 入口。
- 修复旧视频残留或同一任务节点重新渲染时误报跳转成功的问题；跳转超时仍会通知并停止。
- 新增 8 项跳转回归测试，重新构建并同步之前未发布的源码改动。
- 同步本分支的版本日志、下载链接与发布流程。

### v4.14.9 (2026-06-03)

- 清洗 AI 返回的答案格式，DeepSeek 支持使用 `|模型名` 指定模型。
- 新增 Perplexity 解析器及题型提示，补齐对应请求域名。


### v4.14.8 (2026-06-02)

- 修复 `goNext()` 跳转超时后错误返回 `true` 的 bug：点击"下一个"按钮后 20 秒内页面未响应，原来误判为成功导致主循环可能无限重学同一任务；现在超时后发送桌面通知并停止学习循环

### v4.14.7 (2026-06-02)

- 修复学习脚本误判"非视频资源"：改用直接检测 `video.vjs-tech` 元素（等待最多10秒），不再依赖侧栏图标渲染时机
- 修复考试答题脚本无法启动：`-ng-app` 属性带连字符前缀导致检测永远失败，改为等待 `.exam-paper.notranslate`
- 考试答题排除 `text`/`short_answer`/`analysis`/`matching` 等无法作答的题型
- 新增课程导航脚本：章节列表页自动检测并跳转第一个未完成**视频任务**，支持3秒自动跳转
- 新增桌面通知：学习中断、脚本异常、考试完成/出错时发送系统通知

### v4.14.4 (2026-05-30)

- 修复 DeepSeek AI 答题完全失效：构建脚本缺少 `@connect api.deepseek.com`，Tampermonkey 拦截所有 DeepSeek 请求，导致既搜不到答案也不选选项
- 修复全局设置连接状态误报：DeepSeek 等需要鉴权的 API，服务端返回 401/404 仍应显示"连接成功"，只有真网络故障才显示"连接失败"

### v4.14.3 (2026-05-30)

- 修复国开考试答题脚本无法启动的 bug：实际 HTML 为 `<body -ng-app="exam">`，属性在 `body` 上且名称带连字符，导致 `ng-app` 检测永远失败
- 改为直接等待 `.exam-paper.notranslate` 元素，检测更可靠，非考试页面 10 秒后自动跳过
- 答题题目选择器排除章节标题(text)、简答(short_answer)、综合(analysis)、匹配(matching)等无法自动答题的类型

### v4.14.2 (2026-05-29)

- 题库配置新增 **DeepSeek AI** 解析器
- 选择"DeepSeek AI"解析器后粘贴 API Key（`sk-...`）即可启用 AI 自动答题
- AI 答题与题库可同时配置，互不影响

### v4.14.1 (2026-05-29)

- 新增国开考试自动答题功能（测试版）
- 支持题型：单选题、多选题、判断题、填空题
- 通过 `ng-app="exam"` + `.exam-paper.notranslate` 检测考试页面，不影响学习页面
- 简答/综合题暂不支持，需手动填写；答完后请手动提交

### v4.14.0 (2026-05-22)

- 重构国开架构：模块级 state 对象 + 函数提取到模块作用域 + work 作业脚本占位
- study 脚本功能无变化，为后续答题模块接入搭好框架

### v4.13.9 (2026-05-22)

- 修复国开自动播放不触发（oncomplete 未调用 main）
- 修复国开倍速设置失效（数值格式与 MVP 按钮不匹配）
- 修复国开视频播放完后不自动跳转下一个

### v4.13.8 (2026-05-22)

- 新增国开（国家开放大学，lms.ouchn.cn）平台支持
- 支持 MVP 播放器视频自动播放、倍速调节、音量控制
- 视频结束后自动跳转下一个任务，非视频资源自动跳过

</div>

## 本地开发与发布

使用 Node.js 24 和 pnpm 11.2.2。先运行 `pnpm install --frozen-lockfile --ignore-scripts`，再运行 `pnpm test`。

Windows PowerShell 构建：

```powershell
$env:PATH = "$PWD/node_modules/.bin;$PWD/packages/core/node_modules/.bin;$PWD/packages/scripts/node_modules/.bin;" + $env:PATH
$env:VITE_BUILD_PATH = '../../dist'
pnpm build
```

构建产物位于 `dist/`。版本标签必须与 `package.json` 的版本一致；推送版本标签后，GitHub Actions 会执行测试、构建并发布 GitHub Release。发布说明来自 `CHANGELOG_CURRENT.md`。本仓库通过 GitHub 发布用户脚本。

本地账号资料放在已忽略的 `.env.local` 中。提交前检查暂存文件及敏感信息；账号、Cookie、API Key 和浏览器导出内容应仅保存在本地。

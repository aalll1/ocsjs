# DeepSeek 联网答题（4.14.16）

## 使用

在油猴中更新脚本后刷新页面，进入“通用 → 全局设置”，填写 DeepSeek 官方 API Key，选择模型和每题搜索结果数。设置会自动保存；修改后刷新答题页。默认模型为 `deepseek-flash`，也可选择 `deepseek-v4-pro`。API Key 仅保存在脚本管理器本地，导出设置不包含该值。

当前只接入国开文本单选、多选、判断题。保持暂停时不会发起新的答题请求或填写答案；已经发出的请求可能返回。全部支持题型成功作答后自动提交。首次未满分提示并重答，第二次静默重答，连续第三次未满分提示并跳过；满分时提示并继续。重答继续搜索，并向模型传递上次选项文本与平台判分反馈。成绩未公布、无法确认满分值、未答完或没有重答机会时停止提示。计数按测验在本地保存 24 小时，不因刷新重置；“重新答题”可恢复发生错误后已停止的当前尝试。

## 文本提取

题干来自 `.subject-description`，选项来自 `ol.subject-options > li.option .option-content`，去掉 A/B 编号、输入控件和隐藏辅助标签，保留段落/换行的文本间隔。题型读取根节点的 `single_selection`、`multiple_selection`、`true_or_false` 类。含图片、画布、SVG 或空文本时明确停止该题，留待后续题型模块接入。

## 调用流程

1. `POST https://api.deepseek.com/v1/tools/search`：查询题干，按官方限制最多 128 个 Unicode 字符；读取 3 或 5 条带内容的搜索结果。
2. `POST https://api.deepseek.com/chat/completions`：发送完整题干、选项和本轮资料，要求 JSON 中返回 `selectedOptionIds`、`sourceIds`、`reason`。
3. 检查选择数量、选项编号和引用来源，再转换为现有答题引擎的答案格式。搜索错误、空结果、证据不足、JSON 不合法或输出截断时不猜测答案。
4. 在结果面板显示理由与来源链接；本轮结果未经平台评分，不写入正确答案缓存。

搜索上限 20 秒，分析上限 40 秒。两阶段均使用同一个 DeepSeek Key，分别检查暂停。请求输入仅包含单题内容及检索资料，不读取登录凭据，不上传整页截图。

## 模块

- `packages/scripts/src/utils/choice-question.ts`：国开 DOM 文本读取与题型识别。后续题型在这里增加适配。
- `packages/core/src/core/answer-wrapper/deepseek.search.ts`：搜索、结构化分析、来源和选项校验；网络请求通过依赖注入，便于替换答案来源和离线测试。
- `ouchn.ts`：把结构化题目交给答案模块，负责原有页面勾选及暂停。
- `common.ts`：DeepSeek 专用设置；`ENABLE_LEGACY_QUESTION_BANK_UI = false`，保留旧源码而不生成旧题库设置控件。

## 验证与限制

`pnpm test` 覆盖调用顺序、失败不回退、Unicode 限制、超时、暂停、DOM 原文、题型、引用和缓存隔离。API 请求使用模拟响应；用户已初测答题成功；本次回归用模拟响应，不刻意在正式测验制造三次错误。检索和引用检查不等于平台验证答案正确。

## 官方资料（2026-10-25 核对）

- https://api-docs.deepseek.com/guides/search/
- https://api-docs.deepseek.com/guides/json_mode/
- https://api-docs.deepseek.com/api/create-chat-completion/

## 非视频阅读（4.14.14）

图文正文与同源 PDF.js 预览缓慢滚动，每步前进至多 120 像素，滚动间隔由“国开 → 学习脚本 → 阅读滚动速度”调节（0.5/1/2/3/5/10 倍，默认 3 倍，1 倍对应 700 毫秒间隔；可在阅读中调整并自动保存）；到达末尾后等待稳定，再核对最后页码。附件逐一打开阅读并关闭预览，再进入下一项。暂停冻结所有阅读和等待；不能访问的跨域阅读器、未知格式或滚动失效时停留提示，不直接跳过。滚动到末尾不能保证所有课程的特殊完成条件均已满足，尚需在实际课程观察完成标记。

`utils/resource-reader.ts` 为阅读适配模块；`utils/ouchn-exam-flow.ts` 负责提交资格、实际满分读取与重试结果决策。题型扩展仍通过 `choice-question.ts` 接入。

4.14.16：学习入口先等待活动图标与正文/附件就绪。页面外框或空正文不代表资源已加载；最多等待 30 秒运行时间，暂停冻结，超时停留提示而不跳过。

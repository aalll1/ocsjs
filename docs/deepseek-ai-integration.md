# DeepSeek AI 答题集成 — 开发文档

状态: **v4.14.2 已实现** | 创建: 2026-05-29

---

## 功能概述

在"通用-全局设置 → 题库配置"中新增 **DeepSeek AI** 解析器选项，用户输入 API Key 后即可启用 AI 自动答题。AI 配置与题库配置独立，可同时使用。

---

## 用户操作流程

1. 进入 **通用-全局设置 → 题库配置**
2. 解析器下拉菜单选择 **DeepSeek AI**
3. 文本框中粘贴 API Key（格式：`sk-xxxx...`）
4. 点击**保存配置**
5. 刷新页面后进入答题页面即可生效

> 若同时需要题库，可先用"默认"解析器保存一次题库，再用 `###` 分隔追加，或使用 UI 保存后在显示的 JSON 中追加再保存一次。

---

## 技术实现

### 生成的 AnswererWrapper 结构

保存时自动生成如下配置（存入 `settings.cfg.answererWrappers`）：

```json
{
  "name": "DeepSeek AI",
  "url": "https://api.deepseek.com/v1/chat/completions",
  "homepage": "https://www.deepseek.com",
  "method": "post",
  "type": "GM_xmlhttpRequest",
  "contentType": "json",
  "headers": {
    "Authorization": "Bearer sk-xxxx...",
    "Content-Type": "application/json"
  },
  "data": {
    "model": "deepseek-chat",
    "messages": [
      {
        "role": "system",
        "content": "你是答题助手。只输出答案，不要解释。单选题输出对应选项字母（A/B/C/D）；多选题输出多个字母并用#分隔（如A#C）；判断题只输出"对"或"错"；填空题直接输出答案文字。"
      },
      {
        "role": "user",
        "content": "题目：${title}\n选项：\n${options}"
      }
    ],
    "temperature": 0.1,
    "max_tokens": 500
  },
  "handler": "return (res) => { const c = res.choices?.[0]?.message?.content?.trim(); if (!c) return undefined; return ['AI', c]; }"
}
```

### 占位符解析路径

`defaultAnswerWrapperHandler`（`core/src/core/answer-wrapper/answer.wrapper.handler.ts`）在 POST 请求构造阶段对 `data` 字段做递归 `resolvePlaceHolder`：

```
data.messages (Array)
  └── [1].content = "题目：${title}\n选项：\n${options}"
        ├── ${title}   → ctx.elements.title.innerText
        └── ${options} → ctx.elements.options.map(o => o.innerText).join('\n')
```

数组被当作对象递归处理（`Object.keys([]) = ['0','1',...]`），字符串值中的 `${...}` 被替换。最终调用 `JSON.stringify(data)` 作为 POST body。

### 答案匹配方式

`handler` 返回 `['AI', content]`，其中 `content` 是 AI 的原始回复。
`question.resolver.ts` 按以下逻辑使用 `content`：

| 题型 | AI 应返回 | 匹配逻辑 |
|------|-----------|----------|
| 单选 | `A` / `B` / `C` / `D` | 字母索引映射（A=第0个选项） |
| 多选 | `A#C` | 逐字母索引映射 |
| 判断 | `对` / `错` | `correctWords` / `incorrectWords` 词表匹配 |
| 填空 | 答案文字 | 直接填入 input |

System prompt 要求 AI 严格按上述格式输出，temperature 设为 0.1 降低随机性。

### 跨域请求授权

`scripts/make-userscript.js` 中 `@connect` 白名单已加入 `api.deepseek.com`，构建时自动写入 userscript 头部。

---

## 代码位置

| 文件 | 改动 | 说明 |
|------|------|------|
| `packages/scripts/src/projects/common.ts` | 新增 DeepSeek AI option、onchange、save 分支 | 题库配置 UI 逻辑 |
| `scripts/make-userscript.js` | `connect` 白名单加 `api.deepseek.com` | userscript 头部生成 |

---

## 限制与注意事项

- **仅支持 DeepSeek 官方 API**（`api.deepseek.com`），不支持代理地址。若需代理，手动用"默认"解析器填写完整 JSON 配置。
- **简答/综合题不支持**：AI 返回的长文本填入复杂 DOM 结构未经测试。
- **费用**：每道题消耗一次 API 调用，`max_tokens=500` 控制单次最大费用。
- **API Key 明文存储**：配置保存在 Tampermonkey 的 `GM_setValue` 存储中，不会上传，但建议使用专用低权限 Key。

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

## 代码改动详情

### `packages/scripts/src/projects/common.ts`

`answererWrappersButton.onload()` 内，原有解析器选择逻辑基于 `<select>` + 分支处理，本次新增第三个分支，与 TikuAdapter 对称。

**改动 1 — 解析器 `<select>` 新增选项**（`$ui.tooltip(h('select', ...))` 内）

```ts
h('option', {
    title: 'DeepSeek AI 智能答题：输入 API Key（sk-...）即可使用 AI 自动答题...'
}, 'DeepSeek AI')
```

位置：`TikuAdapter` 选项之后。

---

**改动 2 — `select.onchange` 更新 textarea 提示文字**（`$ui.tooltip(...)` 闭合之后）

```ts
select.onchange = () => {
    if (select.value === 'DeepSeek AI') {
        textarea.placeholder = '输入 DeepSeek API Key（格式：sk-xxxx...）';
    } else if (select.value === 'TikuAdapter') {
        textarea.placeholder = '输入 TikuAdapter 接口地址（格式：http://...）';
    } else {
        textarea.placeholder = aw.length ? '重新输入题库配置' : '输入你的题库配置...';
    }
};
```

`textarea` 在 `select` 之前定义，可直接引用。

---

**改动 3 — 保存配置按钮的 `try` 块内新增分支**

原结构：
```
if (TikuAdapter) { ... }
else { /* 默认 JSON 解析 */ }
```

改为：
```
if (TikuAdapter) { ... }
else if (DeepSeek AI) { /* 验证 sk- 格式，生成 AnswererWrapper */ }
else { /* 默认 JSON 解析 */ }
```

DeepSeek AI 分支的核心：验证 API Key 格式（`startsWith('sk-')`），然后 `awsResult.push({...})` 构造完整 AnswererWrapper 对象（见上方技术实现章节）。

---

### `scripts/make-userscript.js`

```js
// 原来
connect: ['enncy.cn', ..., '127.0.0.1'],
// 改为
connect: ['enncy.cn', ..., '127.0.0.1', 'api.deepseek.com'],
```

此数组在构建时写入 userscript 的 `@connect` 头部。不加则 Tampermonkey 会弹窗拦截 `GM_xmlhttpRequest` 的跨域请求。

---

## 开发过程遇到的问题

### 问题：Windows bash heredoc 中文字符 GBK 编码写入 UTF-8 文件

**现象**：第一次构建报错 `TS1002: Unterminated string literal`（common.ts 第 367 行），检查文件发现：
- system prompt 中的中文字符变成乱码字节（UTF-8 的汉字 bytes 被当作 GBK 解释后写入）
- `'题目：${title}\n选项：\n${options}'` 里的 `\n` 成了真实换行符，导致单引号字符串跨行

**根本原因**：修改代码使用了 `python -c "..."` + bash 双引号字符串的方式生成 Python 脚本。在 Windows Git Bash 中，bash 双引号字符串内的 `\n` 转义会被处理，导致 `\\n` → `\n`（真实换行）；同时 heredoc 传入 Python 的中文字符走了 GBK 编码的 stdin 管道，Python 写文件时字节值错误。

**解决方案**：将修复逻辑写成独立的 `.py` 文件（`Write` 工具直接写 UTF-8），再用 `python _fix.py` 执行。Python 脚本文件以 UTF-8 读取，字符串字面量正确，`open(..., encoding='utf-8')` 写出的文件字节也正确。

**结论 / 后续规则**：在 Windows 环境下，凡是 Python 脚本中含有中文字符串需要写入文件，**必须先把脚本写成文件再执行**，不能用 `python -c "..."` 或 bash heredoc 传递含中文的 Python 代码。

---

## 代码位置（汇总）

| 文件 | 改动 | 说明 |
|------|------|------|
| `packages/scripts/src/projects/common.ts` | 3 处：select option / onchange / save 分支 | 题库配置 UI 逻辑，约 50 行 |
| `scripts/make-userscript.js` | `connect` 白名单加 `api.deepseek.com` | userscript 头部生成 |

---

## 限制与注意事项

- **仅支持 DeepSeek 官方 API**（`api.deepseek.com`），不支持代理地址。若需代理，手动用"默认"解析器填写完整 JSON 配置。
- **简答/综合题不支持**：AI 返回的长文本填入复杂 DOM 结构未经测试。
- **费用**：每道题消耗一次 API 调用，`max_tokens=500` 控制单次最大费用。
- **API Key 明文存储**：配置保存在 Tampermonkey 的 `GM_setValue` 存储中，不会上传，但建议使用专用低权限 Key。

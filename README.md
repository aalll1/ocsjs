<div align="center">

<div style="padding:8px;border-radius:100%;background:white;width:124px;height:124px">
<img src="https://cdn.ocsjs.com/resources/img/logo.png" width=124 height=124  >
</div>

# OCS 网课助手

> OCS (Online Course Script) 网课刷课脚本，帮助大学生解决网课难题

![GitHub Repo stars](https://img.shields.io/github/stars/ocsjs/ocsjs)
![npm](https://img.shields.io/npm/v/ocsjs?color=red)
![NPM](https://img.shields.io/npm/l/ocsjs)
![今日安装](https://img.shields.io/badge/dynamic/json?color=orange&label=今日安装&query=$.data.today_install&url=https://scriptcat.org/api/v2/scripts/367)
![总共安装](https://img.shields.io/badge/dynamic/json?color=red&label=总共安装&query=$.data.total_install&url=https://scriptcat.org/api/v2/scripts/367)

</div>
 
<div align="center">

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

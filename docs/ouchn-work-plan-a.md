# 国开(ouchn)答题功能接入 — 方案A

状态: **测试版已实现** | 创建: 2026-05-22 | 更新: 2026-05-29

---

## 架构

```
OUHNProject.scripts
├── guide      (已有，不改)
├── study      (已重构，函数提取到模块层，引用 state.study)
└── work       (v4.14.1 测试版已实现)
    └── commonWork()
        └── ouchnExamWork()
            └── OCSWorker({
                  root:      '.subjects-jit-display > li.subject',
                  elements:  { title, options },
                  work:      { type, handler },
                  answerer:  searchAnswerInCaches + defaultAnswerWrapperHandler
                })
```

---

## 页面结构（通过 HTML 分析确认）

### 页面类型区分

| 页面 | ng-app 属性 | 主要 Controller | 说明 |
|------|------------|----------------|------|
| 考试须知/介绍页 | `activity` | `ExamActivityShowController` | 点击"开始考试"前 |
| **考试答题页** | **`exam`** | **`ExamViewController`** | 实际答题，脚本在此页运行 |
| 考试结果页 | `exam` | `ExamSubmissionListController` | 提交后查看结果 |

**页面识别逻辑**（`oncomplete()` 中）：
```typescript
// 1. 必须是 ng-app="exam" 的页面
document.documentElement.getAttribute('ng-app') === 'exam'
// 2. 且存在活动答题卷（非结果页）
document.querySelector('.exam-paper.notranslate')  // 活动答题卷
// 结果页是 .exam-paper.exam-result.row，两者互斥
```

### 考试答题页 DOM 结构（.exam-paper.notranslate）

```
.exam-paper.notranslate
└── .paper-content.card
    └── .exam-subjects
        └── ol.subjects-jit-display          ← 题目列表容器
            └── li.subject[ng-class=type]    ← 每道题（root 选择器）
                ├── .subject-head
                │   └── .subject-description ← 题目文字（title 选择器）
                └── .subject-body
                    ├── ol.subject-options   ← 选择题选项容器
                    │   └── li.option        ← 每个选项
                    │       └── label
                    │           ├── input[type="radio"]    (single_selection / true_or_false)
                    │           └── input[type="checkbox"] (multiple_selection)
                    └── ol.subject-answers   ← 填空题答案容器
                        └── li.answer
                            └── input[type="text"][ng-model="answer.content"]
```

### 题型映射

| ng-class 值 | OCSWorker type | 判断依据 |
|------------|---------------|---------|
| `single_selection` | `single` | options 含 radio 且 > 2 个 |
| `true_or_false` | `judgement` | options 含 radio 且 = 2 个 |
| `multiple_selection` | `multiple` | options 含 checkbox |
| `fill_in_blank` | `completion` | options 含 input[type="text"] |
| `short_answer` | undefined（跳过） | 无标准输入元素 |
| `analysis` / `matching` | undefined（跳过） | 结构复杂，暂不支持 |

---

## OCSWorker 配置（已实现）

```typescript
new OCSWorker({
    root: '.subjects-jit-display > li.subject',
    elements: {
        title: '.subject-description',
        options: 'ol.subject-options > li.option, ol.subject-answers > li.answer'
    },
    work: {
        type(ctx) { /* 按 input 类型推断题型 */ },
        handler(type, answer, option) {
            // 选择题：label.click() 触发 AngularJS ng-model 更新
            // 填空题：input.value = answer + dispatch input/change event
        }
    }
})
```

---

## 已确认信息

- [x] 考试页面通过 `ng-app="exam"` 识别，不需要具体 URL
- [x] 活动答题卷选择器：`.exam-paper.notranslate`（结果页为 `.exam-paper.exam-result`）
- [x] 题目容器：`.subjects-jit-display > li.subject`
- [x] 题目文字：`.subject-description`（AngularJS 渲染后的 innerText）
- [x] 选择题选项：`ol.subject-options > li.option`
- [x] 填空题输入：`ol.subject-answers > li.answer`（内含 `input[type="text"]`）
- [x] 答题后需手动提交（不自动交卷，完成后提示用户）

---

## 已知风险 / 待测试项

### 风险1：AngularJS label.click() 是否生效 ⚠️
- **问题**：从 HTML dump 分析的页面是提交确认状态（options `ng-disabled="true"`），实际活动答题页的 options 可能结构不同
- **预期**：活动答题页 options 无 `ng-disabled`，点击 `label` → 触发 native input change → AngularJS 响应
- **备用方案**：若 `label.click()` 不生效，需改用 Angular 作用域注入：
  ```typescript
  const angular = (unsafeWindow as any).angular;
  const scope = angular?.element(input).scope();
  scope?.$apply(() => { option.isChosen = true; });
  ```

### 风险2：填空题 Angular 双向绑定响应
- **问题**：`input.value = x` + `dispatchEvent('input')` 对 AngularJS `ng-model` 的触发效果未验证
- **备用方案**：同上，改用 `$apply` 设置 scope 变量 `answer.content`

### 风险3：结果页误触发
- **当前保护**：检测 `.exam-paper.notranslate`（结果页为 `.exam-paper.exam-result`）
- **需验证**：结果页是否也有 `.notranslate` 类（HTML dump 显示没有，但需实机确认）

### 风险4：题目文字包含 MathJax 公式
- **影响**：`.subject-description` 的 innerText 可能含有 MathJax 渲染后的特殊字符
- **当前处理**：直接取 innerText，搜题时可能匹配困难

---

## 简答/综合题的后续计划

暂不支持，后续可考虑：
- 简答题（`short_answer`）：直接将搜索结果填入 `textarea`
- 综合题（`analysis`）：遍历 `subject.sub_subjects`，递归处理子题

---

## 参考

- 实现文件: `packages/scripts/src/projects/ouchn.ts`（函数 `ouchnExamWork`，第 170+ 行）
- 参考实现: `packages/scripts/src/projects/zjy.ts:632-720`
- 答题框架: `packages/scripts/src/utils/work.ts`（`commonWork` / `OCSWorker`）
- 页面 HTML 分析源文件: 根目录 `国开答题页面*.txt`（供日后继续分析）

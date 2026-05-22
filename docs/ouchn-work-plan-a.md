# 国开(ouchn)答题功能接入 — 方案A

状态: 框架已搭建 | 日期: 2026-05-22 | 更新: 2026-05-22

## 方案

使用标准 `OCSWorker` + `commonWork()`，参考 `zjy.ts:326-720`。

## 架构

```
OUHNProject.scripts
├── guide      (已有，不改)
├── study      (已重构，函数提取到模块层，引用 state.study)
└── work       (已添加占位，hideInPanel，等待 URL 和 DOM)
    └── commonWork()
        └── OCSWorker({
              root:      题目容器选择器,
              elements: { title, options },
              work:      { type, handler },
              answerer:  搜题逻辑
            })
```

## 已完成

- [x] 模块级 `state` 对象（`state.study.paused`, `state.study.currentMedia`）
- [x] 函数提取到模块作用域（`setPlaybackRate`, `isVideoActivity`, `getCurrentActivityName`, `startPlayback`, `studyVideo`, `goNext`）
- [x] `work` Script 占位（`ouchn.work-v1`, `hideInPanel: true`）
- [ ] work 脚本 matches URL 待确认

## 待确认信息

1. 国开作业/考试页面 URL 格式（用于 Script.matches）
2. 题目容器 DOM 选择器（root）
3. 题目文字 DOM 选择器（elements.title）
4. 选项 DOM 选择器（elements.options）
5. 题型区分方式：radio=单选, checkbox=多选, textarea/input=填空
6. 答案填入后是否需要手动点击保存/提交
7. 是否有验证码、切屏检测等限制

## 实施模板

```typescript
// 在 OUHNProject.scripts 中新增:
work: new Script({
    name: '📝 作业考试',
    namespace: 'ouchn.work-v1',
    matches: [['国开作业页面', 'TODO: URL']],
    configs: {
        notes: {
            defaultValue: $ui.notes([
                '自动答题前请在 "通用-全局设置" 中设置题库配置。',
                '请手动进入作业考试页面才能使用自动答题。'
            ]).outerHTML
        }
    },
    oncomplete() {
        commonWork(this, {
            workerProvider: (opt) => ouchnWorkOrExam(opt)
        });
    }
})
```

## 参考

- 最简完整实现: `packages/scripts/src/projects/zjy.ts:632-720`
- 完整实现(含阅读/完形): `packages/scripts/src/projects/cx.ts:744-940`
- 答题框架: `packages/scripts/src/utils/work.ts` (commonWork/createWorkerControl)
- Worker 接口: `packages/core/src/core/worker/interface.ts`

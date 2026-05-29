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

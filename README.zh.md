# aiduCAT☤爱嘟猫 — 飞书 × Claude Code 流式泡波卡

<p align="center">
  <img src="docs/images/aiducat-banner-wide.jpg" alt="aiduCAT 爱嘟猫 · 飞书 Claude Code 流式卡横幅" width="100%">
</p>

> **泡波样式（Bubble Wave）——一只住在飞书里的猫，随时替你敲代码**
>
> **答案在上，过程收进一只小面板，结果看边框颜色。**

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/monkey2jack/aiduCAT)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/node-20.12%2B-brightgreen.svg)](https://nodejs.org/)
[![Claude Code](https://img.shields.io/badge/agent-Claude%20Code%20%7C%20Codex-orange.svg)](https://docs.anthropic.com/en/docs/claude-code/quickstart)
[![aiduCAT](https://img.shields.io/badge/aiduCAT-☤爱嘟猫-ff69b4.svg)](https://github.com/monkey2jack/aiduCAT)

**中文** | **[📖 English](./README.md)**

<!-- distribution-policy: github-source-only -->
> **分发说明**：aiduCAT 不发 npm / PyPI 安装包，直接从本仓库源码运行（`npm install && npm run build`）。源码中的 `.bin` 入口仅用于本地开发与测试。

---

## aiduCAT 是什么？

**aiduCAT☤爱嘟猫** 是给 **Claude Code / Codex CLI** 装上的一只飞书猫 —— 把本地编程 agent 的思考、工具调用和最终答案，实时装进一张仿 [aiduPOP](https://github.com/monkey2jack/aiduPOP) 泡波样式的飞书流式卡片。

aiduCAT 起源并致敬上游 [zarazhangrui/lark-coding-agent-bridge](https://github.com/zarazhangrui/lark-coding-agent-bridge)（npm 包 `lark-channel-bridge`），在MIT 协议的代码基础之上，做了一套完整的**泡波化改造**：

| 特性 | 说明 |
|------|------|
| 🫧 **单面板泡波样式** | 答案流式显示在上方；思考与全部工具调用收进一只折叠面板（aiduPOP 布局） |
| ☤ **纯 emoji 计数头** | 收起后只显示 `状态词 · ☤ 模型 · 🌊 思考段 · 🫧 工具数 · ✨ 时长`，无中文废话 |
| 👩🏻‍💻 **工具专属 emoji** | Bash👩🏻‍💻 Read👩🏻‍🏫 Edit👩🏻‍🔧 Write👩🏻‍🎨 Grep🕵🏻 Glob🥷🏻 Web👩🏻‍🚀 Agent👯🏻 —— 每类工具一个脸 |
| 🚦 **边框即状态** | 完成绿 / 停止黄 / 出错红 —— 一眼看清结果，无结尾注脚 |
| 🎹 **打字机反应** | 消息一落就打上敲键盘表情；真正开跑立刻消失，干净利落 |
| 🗣 **`/model` 自由切模型** | 免费 pass-through 任意 gateway combo id（如 `Gemini-3.8-Flash`），不做白名单收口 |
| 📝 **文案点菜单** | 全部展示文案列成 wiki 表格，按行点菜式定制 |

## 快速开始

```bash
git clone https://github.com/monkey2jack/aiduCAT.git
cd aiduCAT
npm install
npm run build

# 前台运行（首次启动扫码绑定 PersonalAgent 应用）
npm run dev -- run
```

需要 Node.js >= 20.12.0，且本机已装好 [Claude Code](https://docs.anthropic.com/en/docs/claude-code/quickstart) 或 [Codex CLI](https://developers.openai.com/codex/cli)。

首次运行会做三件事：渲染绑定二维码 → 让你扫码并选择/创建 PersonalAgent 应用 → 把配置写入 `~/.lark-channel/config.json`。

## 常用命令

### 飞书内斜杠命令

| 命令 | 效果 |
|---|---|
| `/help` | 列出所有命令 |
| `/model` | 查看 / 切换模型（支持任意 gateway combo id；`/model default` 还原默认） |
| `/new` | 中断当前任务并开新会话 |
| `/stop` | 停止当前正在运行的任务 |
| `/timeout [N\|off]` | 设置会话空闲超时 |
| `/cd <path>` | 切换工作目录 |
| `/ws` | 管理命名工作区 |
| `/resume` | 恢复同会话历史 |
| `/status` | 显示运行状态 |
| `/config` | 调整展示偏好与访问策略 |

### 宿主机 CLI

```bash
aiduCAT run      # 前台运行
aiduCAT start    # 后台守护进程（launchd/systemd）
aiduCAT status
aiduCAT stop
aiduCAT ps
aiduCAT kill <id|#>
```

## 卡片长相

一张卡，三段式：

```
[模型长答案，流式打字]

┌─────────────────────────────────────┐
│ 🫧Poping… · ☤ Gemini-3.8-Flash · 🌊 2 · 🫧 4 · ✨ 38s │  ← 收起标题
└─────────────────────────────────────┘
```

- **运行中**：标题最左是实时状态词（🌊Waving… / 🫧Poping… / ☤aiduCATing…），随后是模型、思考段数、工具数、已用时长
- **展开面板**：🌊 开头的是思考文本；每个工具前是它的专属 emoji（👩🏻‍💻Bash 👩🏻‍🏫Read 👩🏻‍🔧Edit 👩🏻‍🎨Write 🕵🏻Grep 🥷🏻Glob 👩🏻‍🚀网络 👯🏻子agent 🤵🏻其他）
- **结束**：状态词消失，只剩计数头；**边框颜色说结果** —— 完成绿 / 停止黄 / 出错红

## 会话与队列

- 每个私聊 / 群 / 话题 / 文档评论独立会话
- 快速连发的消息自动合并处理；运行中再来的消息进入队列，等这轮跑完作为下一轮输入
- 会话历史本地持久化，`/resume` 恢复

## 致谢

- **上游**：[zarazhangrui/lark-coding-agent-bridge](https://github.com/zarazhangrui/lark-coding-agent-bridge)（npm 包 `lark-channel-bridge` v0.7.1）
- **样式灵感**：[monkey2jack/aiduPOP](https://github.com/monkey2jack/aiduPOP) —— 泡波样式（Bubble Wave）设计语言起源
- **定制**：aidu

---

<p align="center">
  <sub>用 💕 制作 by aidu</sub>
</p>

## License

[MIT](./LICENSE)

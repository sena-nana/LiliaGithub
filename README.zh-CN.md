<!-- 若要更换 README 截图，保持 .github/assets/home-overview.png 和 .github/assets/repo-detail.png 文件名以避免改动 README。 -->

> [English](README.md) | 简体中文 | [网页版文档](https://sena-nana.github.io/LiliaGithub/)

> **开发状态声明**
>
> LiliaGithub 仍处于早期 alpha 阶段。核心仓库工作流已经可用，但本地工作区元数据、快速启动命令状态和发布打包流程仍可能随应用演进调整。重要仓库工作应保存在 Git 和 GitHub 中，不要只依赖应用本地状态。

<p align="center">
  <img src="./src-tauri/icons/icon.png" width="128" alt="LiliaGithub logo" />
</p>

<h1 align="center">LiliaGithub</h1>

<p align="center">
  <a href="https://github.com/sena-nana/LiliaGithub/releases">
    <img alt="LiliaGithub release" src="https://img.shields.io/github/v/release/sena-nana/LiliaGithub?include_prereleases">
  </a>
</p>

<p align="center"><strong>面向本地 GitHub 工作区和多仓库管理的桌面应用。</strong></p>

<p align="center">LiliaGithub 将本地多仓库状态、单仓库操作、快速启动命令和 pull / push 队列工作流整合进一个紧凑的 Tauri 桌面工作台。</p>

<p align="center">
  <img src="./.github/assets/home-overview.png" alt="LiliaGithub 工作区总览" />
</p>

<p align="center"><strong>工作区总览</strong></p>

<p align="center">
  <img src="./.github/assets/repo-detail.png" alt="LiliaGithub 仓库详情" />
</p>

<p align="center"><strong>仓库详情</strong></p>

---

## 产品定位

LiliaGithub 是 Lilia 系列中的 GitHub 工作区工具。它面向同时维护多个本地仓库的开发者，提供一个安静的桌面界面，用于查看整体状态、进入单个仓库、运行常用命令，并在不丢失工作区全局结构的前提下推进 pull / push 工作。

它不是 Git、GitHub Desktop 或 GitHub 网页端的替代品。应用聚焦本地仓库可见性和重复工程操作，源码和协作状态的事实来源仍保留在仓库本身。

## Lilia 系列

Lilia 是面向高协同工程工作流的工具链应用系列。系列应用共享可观察的本地状态、紧凑桌面壳、可恢复工作流，以及由人清晰控制自动化边界的设计取向。

LiliaGithub 聚焦 GitHub 工作区周边的仓库操作。它保留 Lilia 桌面壳风格、主题系统、右键菜单模型和工程工具交互语言，但不包含 LiliaCode 的 Agent 运行时、聊天时间线、provider 配置或任务编排功能。

## 核心差异

- 工作区优先的仓库视图：扫描本地工作区，将仓库状态、分支、变更和历史放在同一套界面里。
- 聚焦单仓库操作：在单仓库界面完成暂存、提交、pull、push、checkout、打开 GitHub 和打开文件夹。
- 快速启动命令：保存仓库启动目标，轮询运行状态，并查看最近输出日志，而不是把主工作区改造成纯终端界面。
- 队列化同步工作流：对 pull / push 做预检，并按受控队列执行。
- Lilia 桌面壳：沿用 Lilia 系列紧凑标题栏、可拖拽侧栏、主题持久化和声明式右键菜单模式。

## 功能状态

以下按当前真实接入面记录。只有已经能作为用户功能使用的项目标记为完成；部分接入和未接入项目均保持未完成。最近核对时间：2026-06-21。

### 工作区和仓库管理

- [x] 工作区选择和本地 Git 仓库扫描。
- [x] 仓库状态总览、分支信息、变更详情、历史和仓库详情视图。
- [x] 单仓库暂存、提交、pull、push、checkout、打开 GitHub 和打开文件夹。
- [x] pull / push 批量预检和队列执行。
- [x] GitHub 设备码授权和系统钥匙串凭证复用。
- [ ] 完整 GitHub issue、pull request、review 和 notification 工作流。
- [ ] 当前 GitHub 取向流程之外的多代码托管平台支持。

### 快速启动

- [x] 仓库启动候选发现和选择。
- [x] 按仓库保存快速启动配置。
- [x] 启动运行状态轮询和最近输出日志展示。
- [ ] 完整终端会话管理、输入和长进程监督。

### 桌面壳

- [x] Lilia 风格的无边框标题栏、紧凑侧栏和克制工作台 UI。
- [x] 主窗口位置、尺寸和最大化状态恢复，并在主窗口可见前完成窗口状态应用。
- [x] 浅色 / 深色主题切换和本地持久化。
- [x] 组件声明式右键菜单、程序化打开菜单、危险操作确认，并全局屏蔽浏览器原生右键菜单。
- [x] 通用确认弹层和本地 `AGENTS.md` 开发规范。
- [ ] 插件管理、技能市场和第三方集成管理。
- [ ] 托盘、小组件、WebDAV、SQLite 产品数据或其他无关业务能力。

### 构建和发布

- [x] 单应用 Tauri 2 + Vue 3 + TypeScript 结构。
- [x] Yarn 4 贡献路径和包管理器检查。
- [x] `yarn verify` 串行执行测试、前端构建和 Tauri Rust 编译检查。
- [x] GitHub Actions CI、Pages 文档构建和 Windows release 打包工作流。
- [ ] 签名安装包、更新器集成和跨平台发布验证。

## 项目结构

```text
LiliaGithub/
├── docs/                       # VitePress 文档
├── scripts/                    # 贡献者命令和 Tauri 辅助脚本
├── src/                        # Vue 3 前端
│   ├── components/             # 可复用 UI 和应用组件
│   ├── pages/                  # 工作区、仓库和设置页面
│   ├── services/               # 前端服务和状态辅助逻辑
│   ├── styles/                 # 主题令牌、壳层样式和页面样式
│   ├── router.ts
│   └── main.ts
├── src-tauri/                  # Tauri 2 Rust 端
│   ├── icons/
│   ├── src/                    # IPC 命令和桌面集成
│   └── tauri.conf.json
├── tests/                      # Vitest 测试
├── package.json
└── yarn.lock
```

## 早期开发

LiliaGithub 通过 Corepack 使用 Yarn 4.14.1。先启用 Corepack，再从仓库根目录通过根 `yarn ...` 脚本运行贡献命令。`npm`、`pnpm`、全局 Yarn 1.x 和偏离包管理器约束的路径都不作为贡献路径支持。

```bash
# 1) 启用 Corepack 并激活仓库要求的 Yarn 版本
corepack enable
corepack prepare yarn@4.14.1 --activate

# 2) 安装依赖
yarn install

# 3) 仅启动 Vite 前端
yarn dev

# 4) 启动 Tauri 桌面端
yarn tauri:dev

# 5) 运行测试、前端构建和 Tauri Rust 编译检查
yarn verify

# 6) 启动、构建或预览文档站
yarn docs:dev
yarn docs:build
yarn docs:preview
```

如果启用 Corepack 后 `yarn --version` 仍显示 `1.x`，请显式通过 Corepack 运行命令，例如 `corepack yarn install` 和 `corepack yarn dev`。

## 首发发布打包

发布打包由 GitHub Actions release workflow 驱动。根 `package.json` 可以使用 `0.1.0-alpha.1` 这类预发布版本名；Tauri 的 `src-tauri/tauri.conf.json` 保持 Tauri bundler 期望的数字安装包版本。

推送 `v*` tag 后，workflow 会运行验证并为 draft release 构建 Windows Tauri 安装包。正式发布前应下载产物，并手动验证安装、启动、基础窗口行为、仓库扫描和卸载流程。当前发布产物以 Windows 为主，没有代码签名，也不包含 Tauri updater。

Tauri 图标源文件是 [src-tauri/icons/icon.png](src-tauri/icons/icon.png)。

## 感谢

- LiliaCode 提供了 LiliaGithub 继承的桌面壳风格、交互语言和工程工作台方向。

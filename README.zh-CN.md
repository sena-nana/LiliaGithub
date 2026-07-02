<!-- 若要更换 README 截图，使用 VITE_README_SHOWCASE=1 启动前端，并刷新 .github/assets/home-overview.png 与 .github/assets/repo-detail.png。repo-detail 资产应覆盖 Issues、Pull Requests 和 Actions。 -->

> [English](README.md) | 简体中文 | [网页版文档](https://sena-nana.github.io/LiliaGithub/)

> **开发状态声明**
>
> LiliaGithub 当前处于 1.0 收尾稳定性阶段。核心仓库工作流和 GitHub 协作查看已经可用，当前重点是稳定关键路径、补齐诊断恢复和完成发布验证。重要仓库工作应保存在 Git 和 GitHub 中，不要只依赖应用本地状态。

<p align="center">
  <img src="./src-tauri/icons/icon.png" width="128" alt="LiliaGithub logo" />
</p>

<h1 align="center">LiliaGithub</h1>

<p align="center">
  <a href="https://github.com/sena-nana/LiliaGithub/releases">
    <img alt="LiliaGithub release" src="https://img.shields.io/github/v/release/sena-nana/LiliaGithub?include_prereleases">
  </a>
</p>

<p align="center"><strong>面向本地 Git 和日常 GitHub 操作的桌面工作台。</strong></p>

<p align="center">LiliaGithub 将本地多仓库状态、单仓库操作、GitHub 项目查看、个人工作区管理和推送活动跟踪整合进一个紧凑的桌面应用。</p>

<p align="center">
  <img src="./.github/assets/home-overview.png" alt="LiliaGithub 工作区总览" />
</p>

<p align="center"><strong>工作区总览</strong></p>

<p align="center">
  <img src="./.github/assets/repo-detail.png" alt="LiliaGithub 仓库详情" />
</p>

<p align="center"><strong>仓库详情：Issues、Pull Requests 和 Actions</strong></p>

---

## 产品定位

LiliaGithub 是 Lilia 系列中的 GitHub 工作区工具。它面向同时维护多个本地仓库的开发者，目标是在不启动 GitHub 网页端的情况下完成大部分日常 GitHub 操作。

长期方向是提供一个桌面优先的工作流，覆盖本地 Git 管理、GitHub 仓库和项目查看、个人账号工作区管理，以及推送 / 同步活动回顾。GitHub 网页端仍作为少见管理操作、组织策略和 GitHub 高级能力的兜底入口。

## 阶段目标

- `1.0 收尾稳定性`：稳定现有本地 Git、GitHub 协作、Actions、Release、快速启动和打包发布关键路径，补齐恢复指引、失败诊断和发布验收。
- `2.0 GitHub 网页端能力对齐`：将仓库配置、仓库界面、Discussions、个人配置和偏好与 GitHub 网页端核心能力对齐。
- `3.0 账号级活动与发现`：支持 GitHub 账号活动时间线、远端仓库搜索、通知收件箱和跨仓库工作流聚合。

## Lilia 系列

Lilia 是面向高协同工程工作流的工具链应用系列。系列应用共享可观察的本地状态、紧凑桌面壳、可恢复工作流，以及由人清晰控制自动化边界的设计取向。

LiliaGithub 聚焦 GitHub 工作区周边的仓库操作。它通过 LiliaUI 使用桌面壳基础、主题系统、右键菜单模型、共享组件和工程工具交互语言，但不包含 LiliaCode 的 Agent 运行时、聊天时间线、provider 配置或任务编排功能。

## 核心差异

- 工作区优先的仓库视图：扫描本地工作区，将仓库状态、分支、变更、历史和同步状态放在同一套界面里。
- 聚焦单仓库操作：在单仓库界面完成暂存、提交、pull、push、checkout、必要时打开远端页面和打开本地文件夹。
- GitHub 项目查看：把仓库、issue、pull request、review、release 和 project 看板信息带入桌面端，减少频繁切换浏览器。
- 个人工作区管理：提供登录后的个人首页，用于查看账号状态、仓库列表、通知、保存的工作区和个人偏好。
- 推送活动回顾：在管理仓库的同一界面查看最近推送、待推送变更、CI / release 结果和同步问题。
- 快速启动命令：保存仓库启动目标，轮询运行状态，并查看最近输出日志，而不是把主工作区改造成纯终端界面。
- 队列化同步工作流：对 pull / push 做预检，并按受控队列执行。
- 紧凑桌面工作台：保持安静、高密度、可扫描的界面，让仓库内容始终是主角。

## 功能状态

以下按当前真实接入面记录。只有已经能作为用户功能使用的项目标记为完成；部分接入和未接入项目均保持未完成并标注目标阶段。最近核对时间：2026-06-24。

### 本地 Git 和仓库管理

- [x] 工作区选择和本地 Git 仓库扫描。
- [x] 仓库状态总览、分支信息、变更详情、历史和仓库详情视图。
- [x] 单仓库暂存、提交、pull、push、checkout、打开远端页面和打开文件夹。
- [x] pull / push 批量预检和队列执行。
- [x] GitHub 设备码授权和系统钥匙串凭证复用。
- [x] 在应用内提供更清晰的冲突、同步失败和多步骤恢复指引。

### GitHub 项目和协作查看

- [x] GitHub 仓库元信息、star、fork、topic、release、默认分支状态和仓库设置。
- [x] Issue 浏览、筛选、详情时间线、模板辅助创建、路由持久化筛选状态和仓库 project 字段。
- [x] Pull Request 浏览、筛选、详情时间线、checks、创建流程、合并操作和路由持久化筛选状态。
- [x] 在 issue 和 pull request 详情中渲染 discussion Markdown 时间线。
- [x] GitHub Projects 元数据读取和基于已关联 issue、pull request 的看板查看。
- [x] Actions run 列表、run 详情、job 图、job 日志、workflow 节点图和 artifact 预览。
- [x] 首页 GitHub 时间线，覆盖最近 issue、pull request、workflow run、push 和同步事件。
- [x] Release 列表和状态管理。
- [ ] GitHub Discussions 浏览和创建。`2.0`
- [ ] 通知收件箱，支持按仓库、issue、pull request 和 review 过滤。`3.0`
- [x] 更完整的失败 workflow 查看。

### 个人工作区

- [x] GitHub 账号登录连接。
- [x] 本地工作区偏好和主题持久化。
- [x] 账号仓库列表读取，并在侧边栏提供创建仓库入口。
- [x] GitHub 仓库创建和克隆到工作区流程。
- [ ] 个人首页，展示分配给自己的工作、最近处理的仓库和保存的工作区。`3.0`
- [ ] 关注仓库和通知偏好。`2.0`
- [ ] 收藏仓库和常用工作区的本地组织。`2.0`

### 快速启动

- [x] 仓库启动候选发现和选择。
- [x] 按仓库保存快速启动配置。
- [x] 启动运行状态轮询和最近输出日志展示。
- [x] 更清晰的启动历史和失败诊断。

### 桌面体验

- [x] 支持工作区、仓库和设置导航的紧凑桌面壳。
- [x] 窗口位置、尺寸和最大化状态恢复。
- [x] 浅色 / 深色主题切换。
- [x] 仓库操作使用右键菜单和确认弹层。
- [x] 面向重复 GitHub 操作的更完整键盘导航和命令入口。

### 构建和发布

- [x] Windows 桌面应用打包。
- [x] 面向贡献者的测试和构建验证命令。
- [x] GitHub Actions CI、文档构建和 release 打包工作流。
- [ ] 签名安装包和应用内自动更新器集成。`1.0`

## 项目结构

```text
LiliaGithub/
├── docs/                       # VitePress 文档
├── scripts/                    # 贡献者命令和 Tauri 辅助脚本
├── src/                        # Vue 3 前端
│   ├── components/             # GitHub 业务组件;共享 UI 来自 LiliaUI
│   ├── pages/                  # 工作区、仓库和设置页面
│   ├── services/               # 前端服务和状态辅助逻辑
│   ├── styles/                 # GitHub 专属样式补充;共享样式来自 LiliaUI
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

发布打包由 GitHub Actions release workflow 驱动。当前版本同步在 `package.json`、`src-tauri/Cargo.toml` 与 `src-tauri/tauri.conf.json`，本次发布版本为 `1.0.0-beta.1`。

### `v1.0.0-beta.1` 发布说明

本次发布记录版本对齐为 `v1.0.0-beta.1`，并同步 Tauri 与 Rust 打包版本号。

- Issues 和 PR 已接入更紧凑的筛选列表、路由持久化筛选状态、模板创建入口和详情侧栏。
- Actions 已接入应用内运行详情、job 日志、更收敛的运行列表和 workflow 节点图。
- issue 和 pull request 详情可以渲染 discussion Markdown 时间线。
- GitHub Projects 元数据在缺少 `read:project` 权限时会降级处理，不再阻断仓库协作视图。
- 侧边栏新增创建仓库入口，创建表单从设置页拆出复用。

推送 `v*` tag 后，workflow 会运行验证并为 draft release 构建 Windows Tauri 安装包。正式发布前应下载产物，并手动验证安装、启动、基础窗口行为、仓库扫描、更新检查和卸载流程。当前发布产物以 Windows 为主；应用内检查更新只检查 GitHub Releases 并打开下载页，不执行自动下载或安装。

发布仓库需要配置以下 GitHub Actions secrets：

- `WINDOWS_CERTIFICATE`：Base64 编码的 Windows 代码签名 PFX。
- `WINDOWS_CERTIFICATE_PASSWORD`：PFX 导入密码。
- `WINDOWS_CERTIFICATE_THUMBPRINT`：PFX 导入后的 SHA-1 证书指纹。

未配置 Windows 证书时，workflow 仍会生成未签名安装包。未来如恢复应用内自动更新，需要重新接入 Tauri updater 公钥、私钥和 updater artifact 验证链路。

Tauri 图标源文件是 [src-tauri/icons/icon.png](src-tauri/icons/icon.png)。

## 感谢

- LiliaUI 提供 LiliaGithub 使用的共享桌面壳基础、通用组件、主题令牌、右键菜单和 page/shell 样式。

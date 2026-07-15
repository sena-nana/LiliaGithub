# LiliaGithub

面向本地 Git 和日常 GitHub 操作的桌面工作台。

LiliaGithub 将本地多仓库状态、单仓库 Git 操作、GitHub 协作视图、账号级仓库管理和 Actions 结果整合进一个紧凑的 Tauri 2 + Vue 3 桌面应用。它适合同时维护多个本地仓库、又希望减少在 GitHub 网页端和本地终端之间来回切换的开发者。

框架核心能力使用 LiliaUI:共享组件、主题、右键菜单、桌面壳层基础和公共样式由 `@lilia/ui` 提供;本仓库保留 GitHub 工作区业务和应用专属 Tauri 边界。

## 当前能力

- 工作区扫描、本地仓库分组、仓库状态总览和 GitHub 时间线。
- 单仓库暂存、提交、pull、push、checkout、分支、历史、文件树和 README 视图。
- GitHub 仓库元信息、Issues、Pull Requests、Projects、Actions 和 Settings 入口。
- Issue / Pull Request 筛选、详情时间线、创建流程、checks 和合并操作。
- Actions run 详情、job 图、job 日志和 artifact 预览。
- 快速启动命令候选、按仓库保存配置、运行状态轮询和最近输出日志。
- pull / push 批量预检和队列执行。

## 阶段边界

当前版本处于 1.0 收尾稳定性阶段，以 Windows 桌面应用为主。核心仓库工作流、GitHub 协作查看、Actions 和 Release 管理已经可用；当前重点是稳定关键路径、补齐恢复诊断、完善发布验收和 GitHub Releases 下载引导。2.0 将对齐 GitHub 网页端仓库配置、仓库界面和个人配置，3.0 将扩展账号活动时间线、远端仓库搜索、通知收件箱和跨仓库工作流聚合。完整阶段目标见 [README](https://github.com/sena-nana/LiliaGithub/blob/main/README.zh-CN.md#阶段目标)。

## 开始使用

```bash
npm install --global corepack@0.35.0
corepack enable yarn
corepack yarn install
corepack yarn dev
```

更多本地开发命令见[开发启动](./guide/development.md)。

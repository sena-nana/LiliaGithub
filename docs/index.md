# LiliaGithub

面向本地 Git 和日常 GitHub 操作的桌面工作台。

LiliaGithub 将本地多仓库状态、单仓库 Git 操作、GitHub 协作视图、账号级仓库管理和 Actions 结果整合进一个紧凑的 Tauri 2 + Vue 3 桌面应用。它适合同时维护多个本地仓库、又希望减少在 GitHub 网页端和本地终端之间来回切换的开发者。

## 当前能力

- 工作区扫描、本地仓库分组、仓库状态总览和 GitHub 时间线。
- 单仓库暂存、提交、pull、push、checkout、分支、历史、文件树和 README 视图。
- GitHub 仓库元信息、Issues、Pull Requests、Projects、Actions 和 Settings 入口。
- Issue / Pull Request 筛选、详情时间线、创建流程、checks 和合并操作。
- Actions run 详情、job 图、job 日志和 artifact 预览。
- 快速启动命令候选、按仓库保存配置、运行状态轮询和最近输出日志。
- pull / push 批量预检和队列执行。

## Alpha 边界

当前 alpha 版本以 Windows 桌面应用为主。核心仓库工作流和 GitHub 协作查看已经可用，但 Discussions、通知收件箱、release 管理、签名安装包和自动更新器仍在后续范围内。重要仓库工作仍应保存在 Git 和 GitHub 中，不要只依赖应用本地状态。

## 开始使用

```bash
corepack enable
corepack yarn install
corepack yarn dev
```

更多本地开发命令见[开发启动](./guide/development.md)。

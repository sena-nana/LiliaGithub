# LiliaGithub

一个面向本地多仓库管理的 Tauri 2 + Vue 3 + TypeScript 桌面应用。当前实现以 GitHub 工作区、仓库状态总览、单仓库操作和快速启动为核心，同时保留从 Lilia 桌面端提取出的工程工具外壳。

当前包含：

- Lilia 风格的自绘标题栏、可拖拽侧栏、紧凑工作台 UI。
- 主窗口位置、尺寸与最大化状态恢复，避免启动时先闪默认窗口再跳转。
- 暗色 / 浅色主题切换与本地持久化。
- 组件声明式右键菜单、程序化打开菜单、危险项二次确认，并全局屏蔽浏览器原生右键菜单。
- 通用确认弹层和 `AGENTS.md` 开发规范。
- 工作区选择、GitHub 设备码授权和系统钥匙串凭证复用。
- 工作区 Git 仓库扫描、状态统计、变更 / 历史 / 分支详情。
- 单仓库暂存、提交、pull、push、checkout 和 GitHub / 文件夹打开入口。
- 仓库快速启动配置、运行状态轮询和最近输出日志。
- pull / push 批量预检和按队列执行。
- Yarn 4 单应用包管理与 `verify` 验证脚本。
- 最小 Tauri Rust 壳和 `ping` invoke 冒烟命令。

当前不包含：

- Lilia 的 Claude / Codex / CC-Switch / agent runner 业务。
- `packages/contracts`、项目 stub、聊天流、provider 配置。
- 真实插件管理、技能市场或第三方集成管理。
- SQLite、WebDAV、托盘、小组件等 Momo 业务能力。

## 命令

```bash
yarn install
yarn dev
yarn tauri:dev
yarn verify
```

`yarn verify` 会串行运行前端测试、前端构建和 Tauri Rust 编译检查。

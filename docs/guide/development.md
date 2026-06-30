# 开发启动

## 项目结构

```text
LiliaGithub/
├── src/                 # Vue 3 前端
│   ├── layouts/         # GitHub 工作区壳层接入;通用壳层能力来自 LiliaUI
│   ├── components/      # GitHub 业务组件;通用组件来自 LiliaUI
│   ├── pages/           # Home / Settings / RepoDetail
│   ├── composables/     # GitHub 工作区状态与业务生命周期
│   ├── router.ts
│   └── styles.css       # GitHub 专属样式补充;公共样式来自 LiliaUI
├── src-tauri/           # Tauri 2 Rust 端
├── tests/               # Vitest + Testing Library
├── scripts/             # 本地开发脚本
└── agent-debug/         # Agent 调试验证脚本
```

## 本地运行

本仓库通过 Corepack 使用 Yarn 4.14.1,并通过根目录 `rust-toolchain.toml` 固定 Rust 工具链。建议从仓库根目录通过根 `yarn ...` 脚本运行贡献命令,让本机、CI 和 release 都读取同一份工具链约定。

框架核心能力使用 LiliaUI:`@lilia/ui` 提供共享 TitleBar、Dropdown、ContextMenu、主题/圆角、滚动条、CSS token、shell/page 公共样式和 Agent 友好基础结构。LiliaGithub 本仓库只保留 GitHub 工作区业务、应用专属 Tauri command 和业务样式补充。

```bash
corepack enable
corepack prepare yarn@4.14.1 --activate
yarn install
yarn dev
yarn tauri:dev
yarn tauri:build:no-bundle
yarn tauri:install
```

`yarn dev` 只启动 Vite 前端。浏览器中没有 Tauri runtime 时,前端会使用内置开发 mock 数据,用于快速浏览页面和调试界面。

`yarn tauri:dev` 会自动寻找可用本地端口,再把对应 `devUrl` 传给 Tauri。此模式和生产包一样通过现有 Tauri command 访问真实工作区、Git 和 GitHub 能力。
`yarn tauri:build:no-bundle` 只验证 release 编译并跳过安装包生成,适合发布前的本机快速检查。
`yarn tauri:install` 会先用本机 CPU 优化参数打包,再打开安装程序并尝试安装;该入口面向本机安装验证,不要用它产出的包做通用分发。
需要检查 install 打包命令但不执行构建和安装时,使用 `LILIA_GITHUB_INSTALL_DRY_RUN=1 yarn tauri:install`;这是 LiliaGithub 的唯一 install dry-run 接口。

Rust 编译缓存可在个人机器启用 `sccache`,但不要写入仓库配置。确认本机已安装后,在 `~/.cargo/config.toml` 配置:

```toml
[build]
rustc-wrapper = "sccache"
```

启用后用 `sccache --show-stats` 和重复构建耗时确认命中效果。CI 通过 `mozilla-actions/sccache-action` 使用预构建 sccache,不要在 workflow 里用 `cargo install sccache`,否则会从源码编译并拖慢构建。

## Agent 调试

开发态 Agent 调试层用于浏览器驱动 Agent 和本地 Tauri 冒烟验证:

```bash
yarn agent-debug:verify
```

该命令需要 `cargo`、`tauri-driver` 和匹配 Microsoft Edge 的 EdgeDriver,产物写入 `agent-debug-runs/<run-id>/`。详细接口、环境变量和产物说明见[Agent Debug Harness](../design/agent-debug-harness.md)。

## 验证

```bash
yarn test
yarn build
cargo check --manifest-path src-tauri/Cargo.toml
yarn tauri:build:no-bundle
yarn verify
yarn agent-debug:verify
```

按影响范围运行最小必要验证。涉及构建配置、壳层布局、路由或 Tauri 端改动时,优先运行 `yarn verify`。

## 图标

Tauri 图标位于 `src-tauri/icons/`。如需替换图标,先更新源图,再使用 Tauri CLI 重新生成平台图标。

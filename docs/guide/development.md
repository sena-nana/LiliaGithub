# 开发启动

## 项目结构

```text
LiliaGithub/
├── src/                 # Vue 3 前端
│   ├── layouts/         # AppShell / SecondaryPanel / SettingsSidebar
│   ├── components/      # TitleBar / ViewTabs / SidebarFooter 等
│   ├── pages/           # Home / Settings / RepoDetail
│   ├── composables/     # useTheme / useResizablePane 等
│   ├── router.ts
│   └── styles.css
├── src-tauri/           # Tauri 2 Rust 端
├── tests/               # Vitest + Testing Library
└── scripts/             # 本地开发脚本
```

## 本地运行

本仓库通过 Corepack 使用 Yarn 4.14.1。建议从仓库根目录通过根 `yarn ...` 脚本运行贡献命令。

```bash
corepack enable
corepack prepare yarn@4.14.1 --activate
yarn install
yarn dev
yarn tauri:dev
```

`yarn tauri:dev` 会自动寻找可用本地端口,再把对应 `devUrl` 传给 Tauri。

## 验证

```bash
yarn test
yarn build
cargo check --manifest-path src-tauri/Cargo.toml
yarn verify
```

按影响范围运行最小必要验证。涉及构建配置、壳层布局、路由或 Tauri 端改动时,优先运行 `yarn verify`。

## 图标

Tauri 图标位于 `src-tauri/icons/`。如需替换图标,先更新源图,再使用 Tauri CLI 重新生成平台图标。

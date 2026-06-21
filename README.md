<!-- To replace README screenshots, keep the file names .github/assets/home-overview.png and .github/assets/repo-detail.png to avoid README changes. -->

> English | [简体中文](README.zh-CN.md) | [Documentation](https://sena-nana.github.io/LiliaGithub/)

> **Development Status**
>
> LiliaGithub is still in early alpha. Core repository workflows are usable, but local workspace metadata, launch command state, and release packaging may still change as the app evolves. Keep important repository work in Git and GitHub, not only in the app's local state.

<p align="center">
  <img src="./src-tauri/icons/icon.png" width="128" alt="LiliaGithub logo" />
</p>

<h1 align="center">LiliaGithub</h1>

<p align="center">
  <a href="https://github.com/sena-nana/LiliaGithub/releases">
    <img alt="LiliaGithub release" src="https://img.shields.io/github/v/release/sena-nana/LiliaGithub?include_prereleases">
  </a>
</p>

<p align="center"><strong>A local GitHub workspace and repository management desktop app.</strong></p>

<p align="center">LiliaGithub brings local multi-repository status, focused repository operations, quick launch commands, and queued pull / push workflows into a compact Tauri desktop workbench.</p>

<p align="center">
  <img src="./.github/assets/home-overview.png" alt="LiliaGithub workspace overview" />
</p>

<p align="center"><strong>Workspace overview</strong></p>

<p align="center">
  <img src="./.github/assets/repo-detail.png" alt="LiliaGithub repository detail" />
</p>

<p align="center"><strong>Repository detail</strong></p>

---

## Product Positioning

LiliaGithub is the GitHub workspace tool in the Lilia family. It is built for developers who keep many local repositories active and need a quiet desktop surface for checking status, entering a repository, running common commands, and moving pull / push work forward without losing the shape of the whole workspace.

It is not a replacement for Git, GitHub Desktop, or the GitHub web UI. The app focuses on local repository visibility and repeated engineering operations, while leaving source control truth in the repositories themselves.

## The Lilia Family

Lilia is a family of toolchain applications for high-collaboration engineering workflows. Its apps share a preference for observable local state, compact desktop shells, recoverable workflows, and clear human control over automation.

LiliaGithub focuses on repository operations around GitHub workspaces. It keeps the Lilia desktop shell style, theme system, context menu model, and engineering-tool interaction language, but intentionally does not include LiliaCode's agent runtime, chat timeline, provider configuration, or task orchestration features.

## What Makes It Different

- Workspace-first repository view: scan a local workspace and keep repository status, branch state, changes, and history close together.
- Focused repository operations: stage, commit, pull, push, checkout, open in GitHub, and open in the file system from one repository surface.
- Quick launch commands: save a repository launch target, poll running state, and inspect recent command output without turning the main workspace into a terminal-only app.
- Queued sync workflows: preflight pull / push operations and execute them in a controlled queue.
- Lilia desktop shell: use the same compact title bar, draggable sidebar, theme persistence, and declarative context menu patterns from the Lilia desktop family.

## Feature Status

The list below tracks the current real integration surface. Only capabilities that are usable as user-facing features are marked complete; partially integrated and not-yet-integrated items remain unchecked. Last checked: 2026-06-21.

### Workspace And Repository Management

- [x] Workspace selection and local Git repository scanning.
- [x] Repository status summary, branch information, change details, history, and repository detail view.
- [x] Single-repository staging, committing, pull, push, checkout, GitHub open, and folder open actions.
- [x] Pull / push batch preflight and queued execution.
- [x] GitHub device-code authorization and system keychain credential reuse.
- [ ] Full GitHub issue, pull request, review, and notification workflows.
- [ ] Multi-host provider support beyond the current GitHub-oriented flow.

### Quick Launch

- [x] Repository launch candidate discovery and selection.
- [x] Saved quick launch configuration per repository.
- [x] Launch running-state polling and recent output log display.
- [ ] Full terminal session management, input, and long-running process supervision.

### Desktop Shell

- [x] Lilia-style frameless title bar, compact sidebar, and restrained workbench UI.
- [x] Window position, size, and maximized-state restoration before the main window becomes visible.
- [x] Light / dark theme switching with local persistence.
- [x] Component-declared context menus, programmatic menu opening, dangerous-action confirmation, and global suppression of the browser native context menu.
- [x] Shared confirmation dialog and local `AGENTS.md` development guidance.
- [ ] Plugin management, skill marketplace, and third-party integration management.
- [ ] Tray, widgets, WebDAV, SQLite-backed product data, or other unrelated app-domain features.

### Build And Release

- [x] Single-app Tauri 2 + Vue 3 + TypeScript structure.
- [x] Yarn 4 contributor path with package-manager guards.
- [x] `yarn verify` for tests, frontend build, and Tauri Rust compile check.
- [x] GitHub Actions CI, Pages documentation build, and Windows release packaging workflow.
- [ ] Signed installers, updater integration, and cross-platform release verification.

## Project Structure

```text
LiliaGithub/
├── docs/                       # VitePress documentation
├── scripts/                    # Contributor and Tauri helper scripts
├── src/                        # Vue 3 frontend
│   ├── components/             # Reusable UI and app components
│   ├── pages/                  # Workspace, repository, and settings pages
│   ├── services/               # Frontend service and state helpers
│   ├── styles/                 # Theme tokens, shell, and page styles
│   ├── router.ts
│   └── main.ts
├── src-tauri/                  # Tauri 2 Rust side
│   ├── icons/
│   ├── src/                    # IPC commands and desktop integration
│   └── tauri.conf.json
├── tests/                      # Vitest coverage
├── package.json
└── yarn.lock
```

## Early Development

LiliaGithub uses Yarn 4.14.1 through Corepack. Enable Corepack first, then run contributor commands from the repository root through the root `yarn ...` scripts. `npm`, `pnpm`, global Yarn 1.x, and direct package-manager drift are guarded and not supported as the contributor path.

```bash
# 1) Enable Corepack and activate the repository Yarn version
corepack enable
corepack prepare yarn@4.14.1 --activate

# 2) Install dependencies
yarn install

# 3) Start only the Vite frontend
yarn dev

# 4) Start the Tauri desktop app
yarn tauri:dev

# 5) Run tests, frontend build, and Tauri Rust check
yarn verify

# 6) Start, build, or preview the documentation site
yarn docs:dev
yarn docs:build
yarn docs:preview
```

If `yarn --version` still reports `1.x` after enabling Corepack, run commands through Corepack explicitly, for example `corepack yarn install` and `corepack yarn dev`.

## First Release Packaging

Release packaging is driven by the GitHub Actions release workflow. The root `package.json` may use prerelease names such as `0.1.0-alpha.1`, while Tauri's `src-tauri/tauri.conf.json` keeps the numeric installer version expected by the Tauri bundler.

Pushing a `v*` tag runs verification and builds the Windows Tauri bundle for the draft release. Before publishing a release, download the artifact and manually verify install, launch, basic window behavior, repository scanning, and uninstall. Current release artifacts are Windows-first, unsigned, and do not include the Tauri updater.

The Tauri icon source is [src-tauri/icons/icon.png](src-tauri/icons/icon.png).

## Thanks

- LiliaCode provides the desktop shell style, interaction language, and engineering-workbench direction that LiliaGithub builds on.

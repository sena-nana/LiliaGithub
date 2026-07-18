<!-- To replace README screenshots, run the frontend with VITE_README_SHOWCASE=1 and refresh .github/assets/home-overview.png plus .github/assets/repo-detail.png. The repo-detail asset should cover Issues, Pull Requests, and Actions. -->

> English | [简体中文](README.zh-CN.md) | [Documentation](https://sena-nana.github.io/LiliaGithub/)

> **Development Status**
>
> LiliaGithub is now in the 1.0 closing stability phase. Core repository workflows and GitHub collaboration views are usable; the current focus is stabilizing critical paths, filling diagnostic and recovery gaps, and completing release validation. Keep important repository work in Git and GitHub, not only in the app's local state.

<p align="center">
  <img src="./src-tauri/icons/icon.png" width="128" alt="LiliaGithub logo" />
</p>

<h1 align="center">LiliaGithub</h1>

<p align="center">
  <a href="https://github.com/sena-nana/LiliaGithub/releases">
    <img alt="LiliaGithub release" src="https://img.shields.io/github/v/release/sena-nana/LiliaGithub?include_prereleases">
  </a>
</p>

<p align="center"><strong>A desktop workbench for local Git and day-to-day GitHub operations.</strong></p>

<p align="center">LiliaGithub brings local multi-repository status, focused repository operations, GitHub project visibility, personal workspace controls, and push activity tracking into one compact desktop app.</p>

<p align="center">
  <img src="./.github/assets/home-overview.png" alt="LiliaGithub workspace overview" />
</p>

<p align="center"><strong>Workspace overview</strong></p>

<p align="center">
  <img src="./.github/assets/repo-detail.png" alt="LiliaGithub repository detail" />
</p>

<p align="center"><strong>Repository detail: Issues, Pull Requests, and Actions</strong></p>

---

## Product Positioning

LiliaGithub is the personal developer control center for Git and GitHub in the Lilia family. It is built for developers who keep many repositories active and need one place to understand what needs attention, continue recent work, and complete everyday collaboration without repeatedly returning to the web UI.

The product deliberately prioritizes focused developer decisions and recoverable workflows over GitHub web parity. Git and GitHub remain the source of truth; the web UI remains the fallback for uncommon administration, organization policy, and advanced capabilities that do not belong in a personal control center.

## Milestones

- `1.0 Closing Stability`: stabilize the existing local Git, GitHub collaboration, Actions, Release, quick launch, and packaging paths, then close recovery guidance, failure diagnostics, and release validation gaps.
- `Collaboration And Control`: complete high-frequency review, comment, notification, Attention, Today, and Continue workflows inside the app.
- `Focused Extensions`: add structured LiliaCode handoff, multiple workspaces, account activity, Projects V2 context, and Actions controls where they strengthen the personal developer workflow without copying the full GitHub web UI.

## The Lilia Family

Lilia is a family of toolchain applications for high-collaboration engineering workflows. Its apps share a preference for observable local state, compact desktop shells, recoverable workflows, and clear human control over automation.

LiliaGithub focuses on repository operations around GitHub workspaces. It consumes LiliaUI for the desktop shell base, theme system, context menu model, shared components, and engineering-tool interaction language, but intentionally does not include LiliaCode's agent runtime, chat timeline, provider configuration, or task orchestration features.

## What Makes It Different

- Workspace-first repository view: scan a local workspace and keep repository status, branch state, changes, history, and sync state close together.
- Focused repository operations: stage, commit, pull, push, checkout, open the remote page when needed, and open the local folder from one repository surface.
- GitHub project visibility: bring repository, issue, pull request, review, release, and milestone context into the desktop app instead of requiring constant browser switching.
- Personal workspace controls: provide a signed-in home for account state, repository lists, notification summary, watched repositories, and personal preferences.
- Push activity review: surface recent pushes, outgoing changes, CI / release results, and sync problems where developers already manage their repositories.
- Quick launch commands: save a repository launch target, poll running state, and inspect recent command output without turning the main workspace into a terminal-only app.
- Queued sync workflows: preflight pull / push operations and execute them in a controlled queue.
- Compact desktop workbench: keep the app quiet, dense, and readable so the repository content stays primary.

## Feature Status

<!-- Generated from docs/feature-status.json by scripts/sync-feature-status.mjs. Edit the source, then run pnpm feature-status:generate. -->

The list below is generated from the project's canonical feature-status data. Only user-facing capabilities available on the current main branch are marked complete. Last checked: 2026-07-17.

### Local Git And Repository Management

- [x] Workspace selection and local Git repository scanning.
- [x] Repository status, branches, changes, history, and repository detail views.
- [x] Staging, committing, pull, push, checkout, remote-page open, and folder open actions.
- [x] Pull / push batch preflight and queued execution.
- [x] GitHub device-code authorization and system keychain credential reuse.
- [x] Conflict, failed-sync, and multi-step recovery guidance inside the app.

### GitHub Project And Collaboration View

- [x] GitHub repository metadata, stars, forks, topics, releases, default branch state, and repository settings.
- [x] Issue browsing, filtering, detail timeline, template-assisted creation, and route-persisted filters.
- [x] Pull request browsing, filtering, detail timeline, checks, creation, merge, and route-persisted filters.
- [x] Discussion Markdown timelines inside issue and pull request details.
- [x] Repository milestones grouped from linked issues and pull requests.
- [x] Linked project field metadata in issue and pull request details.
- [x] Actions run details, job and workflow graphs, logs, artifact preview, failure diagnostics, and rerun.
- [x] Home timeline for recent issues, pull requests, workflow runs, pushes, and sync events in the current workspace.
- [x] Release list and status management.
- [x] GitHub Discussions browsing, detail view, and topic creation.
- [x] Complete pull request code review with changed files, threads, replies, and review submission.
- [x] Issue, pull request, and Discussion comment round-trips with recoverable writes.
- [x] In-app notification inbox with filtering, read state, unsubscribe, and internal routing.
- [ ] Projects V2 browsing and common field updates connected to the work-item model. `P2`
- [ ] Actions workflow dispatch, run cancellation, and deployment approval controls. `P2`

### Personal Developer Control Center

- [x] Signed-in GitHub account connection and profile management.
- [x] Account repository scope, list preferences, local workspace preference, and theme persistence.
- [x] Account and organization repository browsing, repository creation, and clone-to-workspace flow.
- [x] Personal home for assigned work, recently touched repositories, notification summary, and current workspace context.
- [x] Watched repositories and repository notification preferences.
- [x] Local repository favorites and repository groups.
- [x] Explainable Attention / Today / Continue work-item organization and exact context restoration.
- [x] Structured LiliaCode task handoff with source context, acceptance criteria, and result return path.
- [ ] Multiple named workspaces with multiple roots and workspace-specific preferences. `P1`
- [ ] In-app account activity timeline with type, repository, and owner-scope filters. `P1`

### Quick Launch

- [x] Repository launch candidate discovery and selection.
- [x] Saved quick launch configuration per repository.
- [x] Launch running-state polling and recent output logs.
- [x] Launch history and failure diagnostics.

### Desktop Experience

- [x] Compact desktop shell with workspace, repository, profile, and settings navigation.
- [x] Window position, size, and maximized-state restoration.
- [x] Light and dark themes.
- [x] Context menus and confirmation dialogs for repository actions.
- [x] Keyboard navigation for repeated GitHub work.

### Build And Release

- [x] Windows desktop app packaging.
- [x] Contributor verification command for tests, builds, Rust checks, and generated feature-status consistency.
- [x] GitHub Actions CI, documentation build, and release packaging workflows.
- [ ] Signed installer integration. `1.0`

## Project Structure

```text
LiliaGithub/
├── docs/                       # VitePress documentation
├── scripts/                    # Contributor and Tauri helper scripts
├── src/                        # Vue 3 frontend
│   ├── components/             # GitHub business components; shared UI comes from LiliaUI
│   ├── pages/                  # Workspace, repository, and settings pages
│   ├── services/               # Frontend service and state helpers
│   ├── styles/                 # GitHub-specific style additions; shared styles come from LiliaUI
│   ├── router.ts
│   └── main.ts
├── src-tauri/                  # Tauri 2 Rust side
│   ├── icons/
│   ├── src/                    # IPC commands and desktop integration
│   └── tauri.conf.json
├── tests/                      # Vitest coverage
├── package.json
└── pnpm-lock.yaml
```

## Early Development

LiliaGithub uses Node.js 26.5.0, Corepack 0.35.0, and the repository-pinned pnpm 4.17.1. Rust is pinned through the repository root `rust-toolchain.toml`. Install Corepack explicitly because Node.js 26 no longer bundles it, then run contributor commands from the repository root.

```bash
# 1) Install Corepack and enable the repository pnpm shim
npm install --global corepack@0.35.0
corepack enable pnpm # 2) Install dependencies
pnpm install

# 3) Start only the Vite frontend
pnpm dev

# 4) Start the Tauri desktop app
pnpm tauri:dev

# 5) Run tests, frontend build, and Tauri Rust check
pnpm verify

# 6) Start, build, or preview the documentation site
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

If `pnpm --version` does not report `4.17.1`, run commands through Corepack explicitly, for example `pnpm install` and `pnpm dev`.

## First Release Packaging

Release packaging is driven by the GitHub Actions release workflow. Both CI and release jobs load Rust from `rust-toolchain.toml` before running `pnpm verify` or the Tauri release action, so release validation and bundle builds use the same pinned Rust version as local development. The root `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` are aligned to the same release version, such as `1.0.0-beta.1`.

### `v1.0.0-beta.1` Notes

This release documents the `v1.0.0-beta.1` milestone and version alignment update.

- Issues and pull requests now have denser filtered lists, route-persisted filter state, template-backed creation entry points, and detail sidebars.
- Actions now has in-app run details, job logs, cleaner run lists, and a workflow node graph.
- Issue and pull request details can render discussion Markdown timelines.
- GitHub Projects metadata now degrades gracefully when `read:project` permission is unavailable instead of blocking repository collaboration views.
- The sidebar now exposes the create-repository entry, with the repository creation form split out from settings.

Pushing a `v*` tag runs verification and builds the Windows Tauri bundle for the draft release. Before publishing a release, download the artifact and manually verify install, launch, basic window behavior, repository scanning, and uninstall. Current release artifacts are Windows-first.

If Windows signing secrets are configured, the release workflow imports the PFX certificate for installer signing. Without those secrets, it still produces unsigned installers.

The Tauri icon source is [src-tauri/icons/icon.png](src-tauri/icons/icon.png).

## Thanks

- LiliaUI provides the shared desktop shell foundation, common components, theme tokens, context menu, and page/shell styles consumed by LiliaGithub.

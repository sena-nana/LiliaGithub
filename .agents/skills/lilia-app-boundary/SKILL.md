---
name: lilia-app-boundary
description: Ownership rules for deciding whether a LiliaGithub change belongs in the app repository or in LiliaUI. Use when Codex touches shell behavior, titlebar, sidebar, settings, menus, theme, global CSS, config sync, build wrappers, default assets, window state, @lilia packages, shared Tauri runtime behavior, app routes, commands, business pages, or app-owned Tauri code.
---

# Lilia App Boundary

## Decision Rule

Put behavior in the LiliaGithub app only when it is application-specific business logic, application configuration, page routing, command wiring, or an app-owned Tauri boundary.

Move or implement behavior in LiliaUI when it is reusable shell, UI system, styling, config, tooling, build, app check, default asset, or common Tauri runtime behavior.

## LiliaGithub Owns

- `src/config/appShell.ts` plus package/Tauri metadata: app name, product title, version, identifier, storage prefix, navigation, footer status, settings copy, and app-level shell configuration.
- `src/router.ts`: LiliaGithub app routes and lazy-loaded business pages.
- `src/tauri/runtime.ts`: app command registration exposed to LiliaUI runtime.
- `src/pages/** and src/components/repo/**`: app business pages, workflows, state, and scoped styles.
- `src-tauri/**`: app-specific Rust commands, app-specific state, capabilities, and Tauri configuration.
- `tests/**`: behavior tests for LiliaGithub app routes, commands, configuration, and business workflows.

## LiliaUI Owns

- `@lilia/ui`: shared components, desktop shell, titlebar, sidebar, settings page, menus, dialogs, theme, CSS tokens, reset, base controls, page classes, default copy patterns, and global UI behavior.
- `@lilia/config`: shared TypeScript, Vite, VitePress, and app config synchronization helpers.
- `@lilia/tools`: default assets, app checks, migrations, and surrounding tools.
- `@lilia/build`: dev, build, docs, Tauri run, and verify wrappers.
- shared Tauri runtime helpers: main-window preparation, window state persistence, and shared desktop runtime behavior.

Do not edit `node_modules/@lilia/*`. Modify the LiliaUI source repository, validate there, then update the LiliaGithub app dependency or lockfile.

## Common Decisions

- New business page or workflow: implement in the LiliaGithub app under `src/pages` or the existing `src/components/repo` workflow surface, then wire through `src/router.ts` and `src/config/appShell.ts` when routing or navigation changes.
- New app-specific command: implement in LiliaGithub app frontend and `src-tauri`, then update capabilities and tests.
- Titlebar, shared sidebar behavior, shell layout, settings primitives, menu, theme, default resource, config sync, app check, build flow, or window-state change: implement in LiliaUI first.
- Repeated style or component pattern across LiliaGithub apps: implement in LiliaUI.
- One-off business visualization or workflow-specific style: keep scoped in the LiliaGithub app component.

## Agent-Friendly Ownership

Use `$lilia-agent-debug` for detailed Agent debugging workflows. Use this section only to decide ownership.

Put reusable Agent-friendly affordances in LiliaUI or its source packages:

- Stable `data-agent-id` on shared shell controls, shared dialogs, common menus, settings, titlebar, sidebar, and reusable LiliaUI components.
- Shared debug harness, app checks, dev-only instrumentation, screenshot/replay tooling, and agent-debug build wrappers.
- Common timeline, pending-action, permission, plan, markdown, or process-observation components only when they are generic UI primitives and do not embed Lilia-specific provider protocols.
- Shared display derivation helpers or contracts when multiple apps need the same event-to-UI mapping.

Keep app-specific Agent behavior in the LiliaGithub app:

- Business workflows, app routes, app-owned commands, app-specific Tauri state, and persistence.
- App-specific `data-agent-id` values for feature controls, rows, records, and actions.
- App-specific Agent timeline, approval, automation, or runner logic when the app owns the data contract or provider boundary.
- Feature validation scenarios that exercise real app behavior through the shared agent-debug harness.

If both sides are involved, define the public LiliaUI/component or debug interface first, then wire LiliaGithub behavior through that interface. Do not make the LiliaGithub app depend on private Lilia implementation details, provider payloads, or undocumented DOM structure.

## Guardrails

- Do not copy Lilia-specific paths, protocols, providers, task timelines, or verification scripts into LiliaGithub apps unless the app truly implements that capability.
- Do not duplicate shared shell or style code locally to make a quick fix.
- When unsure, inspect the current app code and LiliaUI package surface before choosing a boundary.
- If both sides must change, define the interface first, then update LiliaUI and the LiliaGithub app in that order.

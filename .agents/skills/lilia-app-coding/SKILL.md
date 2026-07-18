---
name: lilia-app-coding
description: Coding workflow for LiliaGithub application work. Use when Codex implements features, fixes bugs, refactors application code, adds routes or commands, changes cross-end data contracts, touches Vue pages under src/pages or src/components/repo, updates src/router.ts or src/tauri/runtime.ts, or modifies app-owned Tauri Rust code.
---

# Lilia App Coding

## Start With Context

- Read the relevant module, data contract, route, command map, tests, and LiliaUI ownership boundary before editing.
- Use CodeGraph first when the repository is indexed and the task requires understanding code flow.
- Run `pnpm agent-debug:verify` early when the app boundary or recommended verification commands are unclear.
- For complex tasks, split work into clear sub-tasks and use subagents only where the boundary is clean enough for independent investigation or validation.

## Ownership

- LiliaGithub owns app configuration, routes, commands, business pages, and app-specific Tauri Rust boundaries.
- Put new business pages and feature logic under `src/pages/`; keep repository workflow components under `src/components/repo/` when they are part of the existing repo-detail surface.
- Connect business pages through `src/router.ts` with async lazy imports unless there is a clear reason not to.
- Keep app command registration in `src/tauri/runtime.ts`.
- Keep app-specific Rust commands, state, and permissions inside `src-tauri`.
- Do not copy public UI, shell, settings, menus, theme, global CSS, build wrappers, config sync, app checks, default assets, or window-state runtime code from LiliaUI into the app.

## Implementation Rules

- Fix root causes at the correct boundary. Do not patch symptoms with local workarounds.
- Preserve existing structures, names, and visible behavior unless the task requires changing them.
- Keep changes scoped to the requested feature or bug.
- Before changing a cross-end contract, define the boundary first, then update frontend, backend, permissions, and functional tests together.
- Do not display technical explanations in the UI.
- Do not add controls, routes, sidebar entries, commands, or disabled placeholders that are not connected to real behavior.
- Use `$lilia-agent-debug` when adding or changing `data-agent-id`, debug harnesses, `pnpm agent-debug:verify`, or desktop replay support.
- When adding Agent, automation, timeline, permission, or approval behavior, define the user-visible workflow, runtime command, event shape, persistence, and fallback before wiring UI.
- Keep provider-specific or experimental payloads behind adapter/runtime boundaries. UI should use app or Lilia-level contracts and round-trip opaque provider context only when required.
- Prefer simple data flow over new abstractions. Add an abstraction only when it removes real duplication or matches an existing local pattern.
- Avoid comments that restate code. Put long-lived context, tradeoffs, or unresolved design notes in docs only when they are useful to future maintainers.
- Never overwrite user or other-agent changes. If nearby files are dirty, inspect and work with those changes.

## Frontend Pattern

- Start feature UI from `src/pages/`; use `src/components/repo/` for existing repository-detail workflow components.
- Keep shared application wiring in `src/config/appShell.ts`, `src/router.ts`, and `src/tauri/runtime.ts`.
- Use LiliaUI components, styles, CSS tokens, and shell conventions before adding local UI.
- Keep business component styles scoped.
- Ensure text, controls, loading state, empty state, and error state are stable on desktop and narrow viewports.

## Tauri Pattern

- Treat `src-tauri` as the LiliaGithub app's Rust boundary only.
- Keep command names, payload shapes, permissions, and frontend invocations synchronized.
- Use typed request and response structures when a command has structured data.
- Update `src-tauri/capabilities/default.json` when a new command or plugin permission needs frontend access.
- Leave shared Tauri runtime behavior in LiliaUI unless the change is truly app-specific.

## Before Finishing

- Remove duplicate branches, dead state, unused helper functions, and comments that only narrate the code.
- Confirm no fake UI or unconnected action was introduced.
- Confirm `$lilia-agent-debug` requirements are met when the changed flow needs Agent/debug validation.
- Run the smallest meaningful validation for the changed behavior, or explain why validation was not run.

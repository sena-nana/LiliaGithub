---
name: lilia-app-validation
description: Validation strategy for LiliaGithub changes. Use when Codex needs to choose or report checks after app code, routes, commands, UI, Tauri Rust, dependencies, build config, documentation, tests, local LiliaUI dependency switching, or LiliaUI dependency updates change.
---

# Lilia App Validation

## Choose The Smallest Meaningful Check

Run checks that validate real behavior affected by the change. Prefer targeted functional checks over broad or brittle assertions.

- Always consider `pnpm agent-debug:verify` when app boundaries, important files, or recommended checks may have changed.
- Use `$lilia-agent-debug` to choose checks for UI main paths, `data-agent-id`, debug harnesses, and desktop replay support.
- Use `pnpm test` for route behavior, command wiring, component behavior, config synchronization expectations, and business logic.
- Use `pnpm build` for frontend compile, bundling, route import, and type integration risk.
- Use `cargo check --manifest-path src-tauri/Cargo.toml` for app-owned Rust changes.
- Use `pnpm verify` for broader final confidence when the change crosses frontend, Tauri, config, or build boundaries.

## Test Quality

- Add tests only for behavior changes or meaningful regression risk.
- Do not add tests for documentation-only, comment-only, or formatting-only changes.
- Do not write low-value tests that only hard-match log text, incidental strings, implementation comments, or snapshot-like markup.
- Do not use raw string matching as the main assertion when it does not prove the feature works; assert the behavior through roles, events, state changes, command effects, data results, or observable outcomes.
- Test user-visible behavior, command results, route outcomes, config synchronization, permission availability, or data-contract handling.
- For Agent debug changes, follow `$lilia-agent-debug` test-quality and gating requirements.
- Keep tests focused on the changed capability and existing public behavior.

## LiliaUI Dependency Changes

When changing LiliaGithub's local LiliaUI dependency switch, package scripts, or documentation:

- Treat the switch itself as the behavior under test. Do not add low-value tests that hard-match script output.
- Run `node --check scripts/lilia-ui-deps.mjs` after editing the switch script.
- Run `pnpm liliaui:local`, confirm the four `@lilia/*` packages report local `portal:` sources, then run `pnpm liliaui:remote` and confirm `pnpm liliaui:status` reports remote again.
- Confirm `package.json` and `pnpm-lock.yaml` do not retain LiliaUI `resolutions` or `portal:../LiliaUI` entries after switching back. Preserve unrelated resolutions such as dependency overrides.
- Run `pnpm install --frozen-lockfile` to prove the committed default dependency state still uses the pinned GitHub lockfile.
- Skip broader desktop or Agent validation unless the change also affects app runtime behavior, build wrappers, UI, commands, or the Agent debug harness.

When a LiliaGithub app consumes a changed LiliaUI package:

- Validate LiliaUI in its source repository first: use `pnpm typecheck` and `pnpm test` for package or UI changes.
- For shared Tauri runtime changes in LiliaUI, run the relevant Cargo package tests in LiliaUI.
- After refreshing the LiliaGithub app dependency or lockfile, run at least `pnpm agent-debug:verify`, `pnpm test`, and any affected build or Tauri check.

## Reporting

- State exactly which checks ran and whether they passed.
- If a check was skipped, explain why it was not necessary for the change.
- If a check cannot run, include the blocking error and remaining risk.
- Do not treat unrelated full-suite failures as blockers without confirming they touch the edited surface.

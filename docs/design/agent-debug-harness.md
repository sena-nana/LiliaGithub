# Agent Debug Harness

LiliaGithub includes a development-only Agent debug surface for browser-driving agents and local Tauri smoke tests.

## Enablement

- Frontend harness: set `VITE_LILIA_GITHUB_AGENT_DEBUG=1` while running Vite.
- Tauri commands: set `LILIA_GITHUB_AGENT_DEBUG=1` in a debug build.
- Release builds always report the backend debug commands as disabled.

The frontend exposes `window.__liliaGithubAgentDebug` and the compatibility alias `window.__liliaAgentDebug`.

## Frontend API

`observe()` returns the current route, document title, viewport, visible text, recent console/runtime errors, traced Tauri invokes, all `[data-agent-id]` nodes, and visible interactive nodes that still need stable IDs.

`act(action)` supports:

- `click` by `data-agent-id`
- `focus` by `data-agent-id`
- `type` into inputs, textareas, or contenteditable nodes
- `hotkey`
- `mark` for replay breadcrumbs

Tauri invokes routed through `src/tauri/runtime.ts` are recorded in the snapshot.

## Backend Commands

The backend registers:

- `agent_debug_status`
- `agent_debug_logs`
- `agent_debug_runtime_snapshot`
- `agent_debug_record_action`
- `agent_debug_reset_state`

The backend keeps a bounded in-memory log buffer. It is intentionally separate from workspace commands so existing command contracts stay unchanged.

## Smoke Verification

Run:

```powershell
yarn agent-debug:verify
```

The script expects `tauri-driver`, EdgeDriver, and `cargo`. It rebuilds the managed debug binary for the selected Tauri `devUrl` on every run so the desktop shell and Vite server cannot drift to different ports. If the default dev server port is already occupied by another app, it picks a free localhost port and starts Vite on the same port.
The verification server enables the development-only workspace mock through `VITE_LILIA_GITHUB_AGENT_DEBUG_MOCK_WORKSPACE=1`, keeping the run deterministic without changing production Tauri command contracts.

Useful overrides:

- `LILIA_GITHUB_AGENT_DEBUG_DEV_URL`: force a specific Vite URL.
- `LILIA_GITHUB_AGENT_DEBUG_APP`: use an existing debug app binary instead of the managed rebuild path.
- `LILIA_GITHUB_AGENT_DEBUG_DRIVER_PORT`: change the `tauri-driver` WebDriver port.

The script fails when any captured target-route snapshot reports non-empty `missing-agent-ids`.

It writes artifacts under `agent-debug-runs/<run-id>/`, including:

- `preflight.json`
- `debug-app-build.log` when the debug binary is rebuilt
- `observe.json`
- `missing-agent-ids.json`
- screenshots
- `replay.json`
- `summary.json`

If dependencies are missing, the summary status is `blocked` and includes the next required setup step.

## UI Marking

Stable `data-agent-id` values should be added to agent-relevant controls, especially shell navigation, setup actions, repository actions, repository rows, settings tabs, and modal actions. Dynamic rows should derive IDs from stable business identifiers instead of DOM order.

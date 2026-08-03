# LiliaGithub Tokio execution-domain performance reference

LiliaGithub keeps four application-owned Tokio execution domains:

- `interactive-orchestration`: one worker;
- `github-io`: two workers;
- `workspace-cpu`: one worker;
- `local-blocking`: two workers.

Each domain has a bounded queue of 64 entries. Priority ordering is applied inside a domain;
repository read/write serialization remains enforced by the existing repository guards.
Mutsuki is no longer part of the production runtime or this benchmark.

The benchmark submits CPU work that occupies the isolated `workspace-cpu` lane, then measures
the time from submitting an interactive blocking task until that task actually starts. It uses
one monotonic clock epoch and waits for every task to reach a terminal result.

```powershell
cargo run --release --locked `
  --manifest-path src-tauri/Cargo.toml `
  -p lilia_github_workspace_execution_bench `
  --bin workspace-execution-domain-bench -- `
  --samples 300 --min-background-ms 5 --workspace . `
  --output artifacts/perf/issue43-liliagithub-execution-domains.json
```

The current 300-sample run reports p50 `0.0167 ms`, p95 `0.0238 ms`, p99 `0.0353 ms` and max
`0.2553 ms`; the p99 gate is `0.05 ms`.

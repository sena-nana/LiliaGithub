# LiliaGithub ExecutionDomain performance reference

LiliaGithub keeps one `github-domain` consistency domain because status, stage, commit, branch,
watcher and remote synchronization share repository truth. The production workspace runtime maps
operation kinds into independent physical execution paths inside that domain.

`lilia_github_workspace_runtime_reference` is a separate, non-published workspace crate. It uses
the production `OperationKind` protocol IDs and the production Git command/parser crate to compare:

- one shared two-worker path;
- one `local-blocking` worker plus one `workspace-cpu` worker.

Both topologies keep the same RuntimeDomain, two-worker budget, protocols, runners, payloads and
outputs. The measured business operation is production `git status --porcelain=v1 -z --branch`
plus status parsing while CPU derivation from captured production `git ls-files -z` and
`git log --all` snapshots saturates the background workers. Capturing the versioned input before
analysis follows the product rule that an index is derived data, and avoids pretending that
ExecutionDomain isolation can remove physical Git, disk or process contention.

The percentile is measured from task submission until the real status runner starts. Every sample
still waits for that runner to finish and requires its parsed business output. This isolates the
submit-to-dispatch latency promised by ExecutionDomain while keeping end-to-end correctness as a
hard condition; full Git command duration remains subject to external disk, process and repository
contention that worker-path separation does not control.

```powershell
cargo run --release --locked `
  --manifest-path src-tauri/Cargo.toml `
  -p lilia_github_workspace_runtime_reference `
  --bin workspace-execution-domain-bench -- `
  --samples 300 --min-background-ms 20 --workspace . `
  --output artifacts/perf/issue43-liliagithub-execution-domains.json
```

The gate uses warmed long-lived runtimes, alternating paired sample order and nearest-rank p99.
Calibration accepts an iteration count only when the fastest of three warmed attempts reaches
ten times the declared 20 ms minimum. A sample is included only after both shared-path workers,
or the multi-path CPU worker, are observably occupied; an unestablished pressure sample
is drained and retried up to three times. The multi-path p99 must improve by at least 50%.
The CPU loop is protected from compiler hoisting and can scale to 67,108,864 iterations so a
shallow checkout with a short captured history calibrates by duration instead of repository size.

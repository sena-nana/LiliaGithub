use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use lilia_github_workspace::OperationKind;
use lilia_github_workspace_runtime_reference::{
    monotonic_nanos, repository_root, WorkspaceExecutionDomainReference, WorkspaceExecutionTopology,
};
use mutsuki_runtime_contracts::{DomainTaskHandle, TaskOutcome};
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Clone, Debug)]
struct Options {
    samples: usize,
    min_background_ms: u64,
    workspace: PathBuf,
    output: Option<PathBuf>,
}

#[derive(Clone, Debug)]
struct CapturedSnapshots {
    files: String,
    history: String,
}

impl CapturedSnapshots {
    fn capture(workspace: &Path) -> Result<Self, String> {
        Ok(Self {
            files: lilia_github_git::git_command(workspace, &["ls-files", "-z"], None)?,
            history: lilia_github_git::git_command(
                workspace,
                &["log", "--format=%H%x00", "--all", "-n", "200"],
                None,
            )?,
        })
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
struct CalibratedWork {
    analysis_iterations: usize,
    bulk_iterations: usize,
}

#[derive(Clone, Debug, Serialize)]
struct Distribution {
    samples: usize,
    p50_ms: f64,
    p95_ms: f64,
    p99_ms: f64,
    max_ms: f64,
}

#[derive(Debug, Serialize)]
struct Report {
    schema: &'static str,
    business_purpose: &'static str,
    workload: Value,
    single_path: Distribution,
    local_and_analysis_paths: Distribution,
    p99_improvement_percent: f64,
    expected_minimum_improvement_percent: f64,
    passed: bool,
}

fn main() -> Result<(), String> {
    let options = parse_options()?;
    if options.samples < 300 || options.min_background_ms == 0 {
        return Err("samples must be at least 300 and min-background-ms must be positive".into());
    }
    let snapshots = CapturedSnapshots::capture(&options.workspace)?;
    let calibrated = calibrate(&options, &snapshots)?;
    let (single_path, local_and_analysis_paths) = run_comparison(&options, &snapshots, calibrated)?;
    let improvement = (single_path.p99_ms - local_and_analysis_paths.p99_ms)
        / single_path.p99_ms.max(f64::EPSILON)
        * 100.0;
    let report = Report {
        schema: "lilia.github.execution-domain-reference.v1",
        business_purpose:
            "read the current repository status while full workspace and history analysis are saturated",
        workload: json!({
            "samples": options.samples,
            "minimum_background_work_ms": options.min_background_ms,
            "calibration_safety_factor": 10,
            "calibration_attempts_per_step": 3,
            "calibration_max_iterations": 67_108_864,
            "pressure_establishment_attempts": 3,
            "calibrated": calibrated,
            "workspace": options.workspace,
            "interactive_work": "production git status --porcelain=v1 -z --branch plus production parser",
            "background_work": [
                "CPU derivation from a captured production git ls-files -z snapshot",
                "CPU derivation from a captured production git log --all snapshot"
            ],
            "snapshot_inputs": {
                "tracked_files_bytes": snapshots.files.len(),
                "history_bytes": snapshots.history.len()
            },
            "single_path_threads": 2,
            "multi_path_threads": {
                "local_blocking": 1,
                "workspace_cpu": 1
            },
            "same_runtime_domain": true,
            "same_total_worker_budget": 2,
            "same_protocols_runners_payloads_and_outputs": true,
            "measurement": "local repository status submit to runner start; terminal business output is still required and validated",
            "runtime_lifecycle": "reuse one warmed long-lived runtime per topology",
            "sample_order": "alternate single-path-first and multi-path-first paired samples",
            "percentile_method": "nearest-rank"
        }),
        single_path,
        local_and_analysis_paths,
        p99_improvement_percent: improvement,
        expected_minimum_improvement_percent: 50.0,
        passed: improvement >= 50.0,
    };
    let encoded = serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?;
    println!("{encoded}");
    if let Some(output) = options.output {
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(output, format!("{encoded}\n")).map_err(|error| error.to_string())?;
    }
    if !report.passed {
        return Err(format!(
            "workspace multi-path p99 improvement {:.2}% is below the required 50%",
            report.p99_improvement_percent
        ));
    }
    Ok(())
}

fn calibrate(options: &Options, snapshots: &CapturedSnapshots) -> Result<CalibratedWork, String> {
    let target_ms = options
        .min_background_ms
        .checked_mul(10)
        .ok_or_else(|| "min-background-ms is too large".to_string())?;
    Ok(CalibratedWork {
        analysis_iterations: calibrate_work(
            &options.workspace,
            snapshots,
            target_ms,
            OperationKind::WorkspaceAnalysis,
        )?,
        bulk_iterations: calibrate_work(
            &options.workspace,
            snapshots,
            target_ms,
            OperationKind::Bulk,
        )?,
    })
}

fn calibrate_work(
    path: &Path,
    snapshots: &CapturedSnapshots,
    minimum_ms: u64,
    kind: OperationKind,
) -> Result<usize, String> {
    let reference =
        WorkspaceExecutionDomainReference::start(WorkspaceExecutionTopology::SinglePath)?;
    let warmup = reference.submit(
        format!("calibrate-warmup-{kind:?}"),
        kind,
        payload(kind, path, snapshots, 1),
    )?;
    ensure_completed(&reference, &warmup, Duration::from_secs(30))?;

    let mut iterations = 1usize;
    loop {
        let mut fastest = Duration::MAX;
        for attempt in 0..3 {
            let started = Instant::now();
            let handle = reference.submit(
                format!("calibrate-{kind:?}-{iterations}-{attempt}"),
                kind,
                payload(kind, path, snapshots, iterations),
            )?;
            ensure_completed(&reference, &handle, Duration::from_secs(30))?;
            fastest = fastest.min(started.elapsed());
        }
        if fastest >= Duration::from_millis(minimum_ms) {
            return Ok(iterations);
        }
        iterations = iterations
            .checked_mul(2)
            .filter(|value| *value <= 67_108_864)
            .ok_or_else(|| format!("unable to calibrate {kind:?} to {minimum_ms}ms"))?;
    }
}

fn run_comparison(
    options: &Options,
    snapshots: &CapturedSnapshots,
    calibrated: CalibratedWork,
) -> Result<(Distribution, Distribution), String> {
    let single = WorkspaceExecutionDomainReference::start(WorkspaceExecutionTopology::SinglePath)?;
    let multi = WorkspaceExecutionDomainReference::start(
        WorkspaceExecutionTopology::LocalAndAnalysisPaths,
    )?;
    warm_up(&single, "single", &options.workspace, snapshots)?;
    warm_up(&multi, "multi", &options.workspace, snapshots)?;

    let mut single_values = Vec::with_capacity(options.samples);
    let mut multi_values = Vec::with_capacity(options.samples);
    for sample in 0..options.samples {
        if sample % 2 == 0 {
            single_values.push(run_sample(
                &single,
                "single",
                sample,
                &options.workspace,
                snapshots,
                calibrated,
            )?);
            multi_values.push(run_sample(
                &multi,
                "multi",
                sample,
                &options.workspace,
                snapshots,
                calibrated,
            )?);
        } else {
            multi_values.push(run_sample(
                &multi,
                "multi",
                sample,
                &options.workspace,
                snapshots,
                calibrated,
            )?);
            single_values.push(run_sample(
                &single,
                "single",
                sample,
                &options.workspace,
                snapshots,
                calibrated,
            )?);
        }
    }
    Ok((distribution(single_values), distribution(multi_values)))
}

fn warm_up(
    reference: &WorkspaceExecutionDomainReference,
    topology: &str,
    workspace: &Path,
    snapshots: &CapturedSnapshots,
) -> Result<(), String> {
    for kind in [
        OperationKind::LocalRead,
        OperationKind::WorkspaceAnalysis,
        OperationKind::Bulk,
    ] {
        let handle = reference.submit(
            format!("warmup-{topology}-{kind:?}"),
            kind,
            payload(kind, workspace, snapshots, 1),
        )?;
        ensure_completed(reference, &handle, Duration::from_secs(30))?;
    }
    Ok(())
}

fn run_sample(
    reference: &WorkspaceExecutionDomainReference,
    topology: &str,
    sample: usize,
    workspace: &Path,
    snapshots: &CapturedSnapshots,
    calibrated: CalibratedWork,
) -> Result<f64, String> {
    let (analysis, bulk) = establish_pressure(
        reference, topology, sample, workspace, snapshots, calibrated,
    )?;

    let submitted_nanos = monotonic_nanos();
    let status = reference.submit(
        format!("{topology}-{sample}-status"),
        OperationKind::LocalRead,
        payload(OperationKind::LocalRead, workspace, snapshots, 1),
    )?;
    let status_output = ensure_completed(reference, &status, Duration::from_secs(30))?;
    let runner_started_nanos = status_output
        .get("runner_started_nanos")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            format!(
                "status task {} did not report runner start time",
                status.task.task_id
            )
        })?;
    let elapsed_ms = runner_started_nanos.saturating_sub(submitted_nanos) as f64 / 1_000_000.0;

    for handle in [&analysis, &bulk] {
        ensure_completed(reference, handle, Duration::from_secs(30))?;
    }
    Ok(elapsed_ms)
}

fn establish_pressure(
    reference: &WorkspaceExecutionDomainReference,
    topology: &str,
    sample: usize,
    workspace: &Path,
    snapshots: &CapturedSnapshots,
    calibrated: CalibratedWork,
) -> Result<(DomainTaskHandle, DomainTaskHandle), String> {
    for attempt in 0..3 {
        let analysis = reference.submit(
            format!("{topology}-{sample}-{attempt}-analysis"),
            OperationKind::WorkspaceAnalysis,
            payload(
                OperationKind::WorkspaceAnalysis,
                workspace,
                snapshots,
                calibrated.analysis_iterations,
            ),
        )?;
        let bulk = reference.submit(
            format!("{topology}-{sample}-{attempt}-bulk"),
            OperationKind::Bulk,
            payload(
                OperationKind::Bulk,
                workspace,
                snapshots,
                calibrated.bulk_iterations,
            ),
        )?;
        let (pool_id, running_batches) = if reference.is_single_path() {
            ("github-shared", 2)
        } else {
            ("workspace-cpu", 1)
        };
        let pressure = wait_pool_running(reference, pool_id, running_batches);
        if pressure.is_ok() {
            return Ok((analysis, bulk));
        }
        for handle in [&analysis, &bulk] {
            ensure_completed(reference, handle, Duration::from_secs(30))?;
        }
    }
    Err(format!(
        "unable to establish saturated background pressure for {topology} sample {sample}"
    ))
}

fn ensure_completed(
    reference: &WorkspaceExecutionDomainReference,
    handle: &DomainTaskHandle,
    timeout: Duration,
) -> Result<Value, String> {
    match reference.wait_outcome(handle, timeout)? {
        Some(TaskOutcome::Completed {
            output: Some(output),
            ..
        }) => Ok(output),
        other => Err(format!(
            "task {} did not complete with business output: {other:?}",
            handle.task.task_id
        )),
    }
}

fn wait_pool_running(
    reference: &WorkspaceExecutionDomainReference,
    pool_id: &str,
    minimum_running_batches: usize,
) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        let running_batches = reference
            .group()
            .snapshots()
            .map_err(|error| error.to_string())?
            .into_iter()
            .flat_map(|snapshot| snapshot.execution_domains)
            .find(|pool| pool.pool_id == pool_id)
            .map(|pool| pool.running_batches)
            .unwrap_or_default();
        if running_batches >= minimum_running_batches {
            return Ok(());
        }
        thread::yield_now();
    }
    Err(format!(
        "execution pool {pool_id} did not reach {minimum_running_batches} running batches"
    ))
}

fn payload(
    kind: OperationKind,
    path: &Path,
    snapshots: &CapturedSnapshots,
    iterations: usize,
) -> Value {
    match kind {
        OperationKind::LocalRead => json!({
            "path": path,
            "iterations": iterations,
        }),
        OperationKind::WorkspaceAnalysis => json!({
            "snapshot": snapshots.files.as_str(),
            "iterations": iterations,
        }),
        OperationKind::Bulk => json!({
            "snapshot": snapshots.history.as_str(),
            "iterations": iterations,
        }),
        _ => unreachable!(),
    }
}

fn distribution(mut values: Vec<f64>) -> Distribution {
    values.sort_by(f64::total_cmp);
    Distribution {
        samples: values.len(),
        p50_ms: percentile(&values, 0.50),
        p95_ms: percentile(&values, 0.95),
        p99_ms: percentile(&values, 0.99),
        max_ms: *values.last().unwrap_or(&0.0),
    }
}

fn percentile(values: &[f64], percentile: f64) -> f64 {
    let index = ((values.len() as f64 * percentile).ceil() as usize).saturating_sub(1);
    values[index.min(values.len().saturating_sub(1))]
}

fn parse_options() -> Result<Options, String> {
    let mut options = Options {
        samples: 300,
        min_background_ms: 20,
        workspace: repository_root(),
        output: None,
    };
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--samples" => {
                options.samples = args
                    .next()
                    .ok_or("--samples requires a value")?
                    .parse()
                    .map_err(|_| "invalid --samples")?;
            }
            "--min-background-ms" => {
                options.min_background_ms = args
                    .next()
                    .ok_or("--min-background-ms requires a value")?
                    .parse()
                    .map_err(|_| "invalid --min-background-ms")?;
            }
            "--workspace" => {
                options.workspace =
                    PathBuf::from(args.next().ok_or("--workspace requires a path")?);
            }
            "--output" => {
                options.output = Some(PathBuf::from(
                    args.next().ok_or("--output requires a path")?,
                ));
            }
            _ => return Err(format!("unknown argument: {arg}")),
        }
    }
    Ok(options)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nearest_rank_p99_excludes_the_top_one_percent() {
        let values = (1..=100).map(f64::from).collect::<Vec<_>>();
        assert_eq!(percentile(&values, 0.99), 99.0);
    }
}

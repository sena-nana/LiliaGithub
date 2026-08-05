use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use lilia_github_workspace::task_runtime::{
    ExecutionClass, TaskOutcome, TaskSpec, WorkspaceTaskRuntime,
};
use serde::Serialize;
use serde_json::json;

static EPOCH: OnceLock<Instant> = OnceLock::new();

#[derive(Clone, Debug)]
struct Options {
    samples: usize,
    min_background_ms: u64,
    workspace: PathBuf,
    output: Option<PathBuf>,
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
    workload: serde_json::Value,
    interactive_dispatch: Distribution,
    expected_max_ms: f64,
    passed: bool,
}

fn main() -> Result<(), String> {
    let options = parse_options()?;
    if options.samples < 300 || options.min_background_ms == 0 {
        return Err("samples must be at least 300 and min-background-ms must be positive".into());
    }

    let runtime = WorkspaceTaskRuntime::new();
    let mut values = Vec::with_capacity(options.samples);
    for sample in 0..options.samples {
        values.push(run_sample(&runtime, sample, options.min_background_ms)?);
    }

    let distribution = distribution(values);
    let report = Report {
        schema: "lilia.github.execution-domain-performance.v2",
        business_purpose:
            "measure interactive dispatch latency while CPU work saturates its isolated lane",
        workload: json!({
            "samples": options.samples,
            "minimum_background_work_ms": options.min_background_ms,
            "workspace": options.workspace,
            "execution_domains": {
                "interactive-orchestration": 1,
                "github-io": 2,
                "workspace-cpu": 1,
                "local-blocking": 2
            },
            "queue_capacity": 64,
            "measurement": "submit to worker start using one monotonic epoch"
        }),
        interactive_dispatch: distribution.clone(),
        expected_max_ms: 0.05,
        passed: distribution.p99_ms <= 0.05,
    };
    let encoded = serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?;
    println!("{encoded}");
    if let Some(output) = options.output {
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(output, format!("{encoded}\n")).map_err(|error| error.to_string())?;
    }
    if report.passed {
        Ok(())
    } else {
        Err(format!(
            "interactive dispatch p99 {:.4}ms exceeds {:.2}ms",
            report.interactive_dispatch.p99_ms, report.expected_max_ms
        ))
    }
}

fn run_sample(
    runtime: &WorkspaceTaskRuntime,
    sample: usize,
    background_ms: u64,
) -> Result<f64, String> {
    let first = runtime.submit(
        TaskSpec::new(format!("bench-{sample}-analysis"), -50, ExecutionClass::Cpu),
        Box::new(move |_| {
            thread::sleep(Duration::from_millis(background_ms));
            Ok(())
        }),
    )?;
    let second = runtime.submit(
        TaskSpec::new(format!("bench-{sample}-bulk"), -50, ExecutionClass::Cpu),
        Box::new(move |_| {
            thread::sleep(Duration::from_millis(background_ms));
            Ok(())
        }),
    )?;

    let started = Arc::new(Mutex::new(None));
    let started_by_job = Arc::clone(&started);
    let submitted = monotonic_nanos();
    let interactive = runtime.submit(
        TaskSpec::new(
            format!("bench-{sample}-status"),
            100,
            ExecutionClass::Blocking,
        ),
        Box::new(move |_| {
            *started_by_job
                .lock()
                .unwrap_or_else(|error| error.into_inner()) = Some(monotonic_nanos());
            Ok(())
        }),
    )?;

    match interactive.wait() {
        TaskOutcome::Completed { .. } => {}
        outcome => return Err(format!("interactive benchmark task failed: {outcome:?}")),
    }
    first.wait();
    second.wait();
    let started = started
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .ok_or_else(|| "interactive task did not record its start time".to_string())?;
    Ok(started.saturating_sub(submitted) as f64 / 1_000_000.0)
}

fn monotonic_nanos() -> u64 {
    u64::try_from(EPOCH.get_or_init(Instant::now).elapsed().as_nanos()).unwrap_or(u64::MAX)
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
        min_background_ms: 5,
        workspace: PathBuf::from("."),
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

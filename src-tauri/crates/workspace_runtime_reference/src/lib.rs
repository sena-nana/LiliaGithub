use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use lilia_github_workspace::OperationKind;
use mutsuki_runtime_contracts::{
    CrossDomainTaskRequest, DispatchLane, DomainTaskHandle, ExecutionClass, ObservabilityProfile,
    RunnerDescriptor, RunnerPurity, RunnerResult, RuntimeDomainId, RuntimeError, RuntimeProfile,
    RuntimeProfileMode, Task, TaskOutcome,
};
use mutsuki_runtime_core::RuntimeFailure;
use mutsuki_runtime_host::{
    runner_manifest, ExecutionDomainConfig, HostRuntime, HostRuntimeConfig, NativeRunner,
    RuntimeBootstrapper, RuntimeGroupHost,
};
use mutsuki_runtime_sdk::HostServiceRegistry;
use serde_json::Value;

pub const GITHUB_DOMAIN_ID: &str = "github-domain";
const REFERENCE_PLUGIN_ID: &str = "lilia.github.execution-domains.reference";
static REFERENCE_EPOCH: OnceLock<Instant> = OnceLock::new();

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkspaceExecutionTopology {
    SinglePath,
    LocalAndAnalysisPaths,
}

pub struct WorkspaceExecutionDomainReference {
    topology: WorkspaceExecutionTopology,
    group: RuntimeGroupHost,
}

impl WorkspaceExecutionDomainReference {
    pub fn start(topology: WorkspaceExecutionTopology) -> Result<Self, String> {
        let shared_services = Arc::new(HostServiceRegistry::new());
        shared_services.freeze();
        let runtime = build_runtime(shared_services.clone(), topology)?;
        let mut group = RuntimeGroupHost::with_defaults(shared_services);
        group
            .insert_domain(domain_id(GITHUB_DOMAIN_ID)?, runtime)
            .map_err(|error| error.to_string())?;
        Ok(Self { topology, group })
    }

    pub fn submit(
        &self,
        request_id: impl Into<String>,
        kind: OperationKind,
        payload: Value,
    ) -> Result<DomainTaskHandle, String> {
        let request_id = request_id.into();
        let domain = domain_id(GITHUB_DOMAIN_ID)?;
        let mut task = Task::new(request_id.clone(), kind.protocol(), payload);
        task.dispatch_lane = match kind {
            OperationKind::LocalRead => DispatchLane::Interactive,
            OperationKind::WorkspaceAnalysis => DispatchLane::Background,
            OperationKind::Bulk => DispatchLane::Bulk,
            _ => DispatchLane::Normal,
        };
        self.group
            .submit_cross_domain(CrossDomainTaskRequest {
                request_id: request_id.clone(),
                source_domain: domain.clone(),
                target_domain: domain,
                task,
                timeout_ms: 10_000,
                idempotency_key: format!("{request_id}:{}", kind.protocol()),
                max_attempts: 1,
            })
            .map_err(|error| error.to_string())
    }

    pub fn wait_outcome(
        &self,
        handle: &DomainTaskHandle,
        timeout: Duration,
    ) -> Result<Option<TaskOutcome>, String> {
        self.group
            .wait_outcome(handle, timeout)
            .map_err(|error| error.to_string())
    }

    pub fn group(&self) -> &RuntimeGroupHost {
        &self.group
    }

    pub fn is_single_path(&self) -> bool {
        self.topology == WorkspaceExecutionTopology::SinglePath
    }
}

pub fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("reference crate must remain under src-tauri/crates")
        .to_path_buf()
}

pub fn monotonic_nanos() -> u64 {
    u64::try_from(
        REFERENCE_EPOCH
            .get_or_init(Instant::now)
            .elapsed()
            .as_nanos(),
    )
    .unwrap_or(u64::MAX)
}

fn build_runtime(
    shared_services: Arc<HostServiceRegistry>,
    topology: WorkspaceExecutionTopology,
) -> Result<HostRuntime, String> {
    let kinds = [
        OperationKind::LocalRead,
        OperationKind::WorkspaceAnalysis,
        OperationKind::Bulk,
    ];
    let descriptors = kinds.into_iter().map(descriptor).collect::<Vec<_>>();
    let mut bootstrapper = RuntimeBootstrapper::new();
    bootstrapper.register_manifest(runner_manifest(REFERENCE_PLUGIN_ID, descriptors.clone()));
    bootstrapper
        .use_shared_services(shared_services)
        .map_err(|error| error.to_string())?;

    for (kind, descriptor) in kinds.into_iter().zip(descriptors) {
        bootstrapper.register_runner(Box::new(NativeRunner::new(
            descriptor,
            move |_context, task| {
                let task_id = task.task_id.clone();
                let payload: Value = task.payload.into();
                let output = execute_git_work(kind, &payload)
                    .map_err(|message| reference_failure(kind, message))?;
                let mut result = RunnerResult::completed(task_id);
                result.output = Some(output);
                Ok(result)
            },
        )));
    }

    let execution_domains = match topology {
        WorkspaceExecutionTopology::SinglePath => vec![ExecutionDomainConfig::new(
            "github-shared",
            all_execution_classes(),
            2,
        )],
        WorkspaceExecutionTopology::LocalAndAnalysisPaths => vec![
            ExecutionDomainConfig::new(
                "local-blocking",
                vec![
                    ExecutionClass::Orchestration,
                    ExecutionClass::Io,
                    ExecutionClass::Blocking,
                    ExecutionClass::Script,
                ],
                1,
            ),
            ExecutionDomainConfig::new("workspace-cpu", vec![ExecutionClass::Cpu], 1),
        ],
    };

    bootstrapper
        .into_host_runtime_with_config(
            profile(),
            HostRuntimeConfig {
                event_driven: true,
                execution_domains,
                ..HostRuntimeConfig::default()
            },
        )
        .map_err(|error| error.to_string())
}

fn execute_git_work(kind: OperationKind, payload: &Value) -> Result<Value, String> {
    let runner_started_nanos = monotonic_nanos();
    let iterations = payload
        .get("iterations")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| "workspace reference payload requires positive iterations".to_string())?;

    let (count, checksum) = match kind {
        OperationKind::LocalRead => {
            let path = payload
                .get("path")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "local-read reference payload requires path".to_string())?;
            let mut count = 0usize;
            for _ in 0..iterations {
                let status = lilia_github_git::git_command(
                    Path::new(path),
                    &["status", "--porcelain=v1", "-z", "--branch"],
                    None,
                )?;
                count = lilia_github_git::parse_status_snapshot(&status)
                    .entries
                    .len();
            }
            (count, 0)
        }
        OperationKind::WorkspaceAnalysis | OperationKind::Bulk => {
            let snapshot = payload
                .get("snapshot")
                .and_then(Value::as_str)
                .ok_or_else(|| "analysis reference payload requires snapshot".to_string())?;
            let mut result = (0, 0);
            for _ in 0..iterations {
                result = analyze_snapshot(std::hint::black_box(snapshot));
                std::hint::black_box(result);
            }
            result
        }
        _ => return Err(format!("unsupported reference operation: {kind:?}")),
    };
    Ok(serde_json::json!({
        "iterations": iterations,
        "items": count,
        "checksum": checksum,
        "runner_started_nanos": runner_started_nanos,
    }))
}

fn analyze_snapshot(snapshot: &str) -> (usize, u64) {
    let mut count = 0usize;
    let mut checksum = 0xcbf29ce484222325u64;
    for item in snapshot.split('\0').filter(|value| !value.is_empty()) {
        count += 1;
        for byte in item.bytes() {
            checksum ^= u64::from(byte);
            checksum = checksum.wrapping_mul(0x100000001b3);
        }
    }
    (count, checksum)
}

fn descriptor(kind: OperationKind) -> RunnerDescriptor {
    RunnerDescriptor {
        runner_id: format!("{}.reference-runner", kind.protocol()),
        plugin_id: REFERENCE_PLUGIN_ID.into(),
        plugin_generation: 1,
        accepted_protocol_ids: vec![kind.protocol().into()],
        purity: RunnerPurity::Effectful,
        execution_class: kind.execution_class(),
        invocation_mode: Default::default(),
        concurrency: Default::default(),
        input_schema: serde_json::json!({}),
        output_schema: serde_json::json!({}),
        batch: Default::default(),
        payload: Default::default(),
        resources: Default::default(),
        ordering: Default::default(),
        control: Default::default(),
        metadata: BTreeMap::new(),
        contract_surfaces: vec![format!("runner:{}", kind.protocol())],
    }
}

fn profile() -> RuntimeProfile {
    RuntimeProfile {
        profile_id: "lilia-github-execution-domain-reference".into(),
        mode: RuntimeProfileMode::FullDev,
        enabled_plugins: vec![REFERENCE_PLUGIN_ID.into()],
        bindings: BTreeMap::new(),
        plugin_deployments: BTreeMap::new(),
        observability: ObservabilityProfile::default(),
        allow_dynamic_registration: false,
        allow_hot_reload: false,
    }
}

fn reference_failure(kind: OperationKind, message: String) -> RuntimeFailure {
    RuntimeFailure::new(RuntimeError::new(
        "lilia.github.reference.invalid_input",
        "lilia.github.execution-domain-reference",
        format!("{}.{}", kind.protocol(), message),
    ))
}

fn all_execution_classes() -> Vec<ExecutionClass> {
    vec![
        ExecutionClass::Orchestration,
        ExecutionClass::Io,
        ExecutionClass::Cpu,
        ExecutionClass::Blocking,
        ExecutionClass::Script,
    ]
}

fn domain_id(value: &str) -> Result<RuntimeDomainId, String> {
    RuntimeDomainId::new(value).map_err(|error| format!("{error:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use lilia_github_workspace::{BULK_PROTOCOL, LOCAL_READ_PROTOCOL, WORKSPACE_ANALYSIS_PROTOCOL};
    use serde_json::json;

    #[test]
    fn multi_path_reference_runs_real_git_operations_with_the_production_kinds() {
        let reference = WorkspaceExecutionDomainReference::start(
            WorkspaceExecutionTopology::LocalAndAnalysisPaths,
        )
        .unwrap();
        let snapshot = reference.group().snapshots().unwrap().remove(0);
        assert_eq!(snapshot.domain_id.to_string(), GITHUB_DOMAIN_ID);
        assert_eq!(
            snapshot
                .execution_domains
                .iter()
                .map(|domain| domain.domain_id.as_str())
                .collect::<Vec<_>>(),
            vec!["local-blocking", "workspace-cpu"]
        );
        assert_eq!(
            snapshot
                .execution_domains
                .iter()
                .map(|domain| domain.configured_threads)
                .sum::<usize>(),
            2
        );

        for (index, kind) in [
            OperationKind::LocalRead,
            OperationKind::WorkspaceAnalysis,
            OperationKind::Bulk,
        ]
        .into_iter()
        .enumerate()
        {
            let handle = reference
                .submit(format!("git-operation-{index}"), kind, test_payload(kind))
                .unwrap();
            let Some(TaskOutcome::Completed {
                output: Some(output),
                ..
            }) = reference
                .wait_outcome(&handle, Duration::from_secs(5))
                .unwrap()
            else {
                panic!("reference task must complete with business output");
            };
            assert!(output["runner_started_nanos"].as_u64().is_some());
        }
    }

    #[test]
    fn invalid_git_payload_fails_as_a_structured_task() {
        let reference = WorkspaceExecutionDomainReference::start(
            WorkspaceExecutionTopology::LocalAndAnalysisPaths,
        )
        .unwrap();
        let handle = reference
            .submit("invalid-git", OperationKind::LocalRead, json!({}))
            .unwrap();
        assert!(matches!(
            reference
                .wait_outcome(&handle, Duration::from_secs(2))
                .unwrap(),
            Some(TaskOutcome::Failed { .. })
        ));
    }

    #[test]
    fn both_topologies_keep_one_runtime_domain_and_two_workers() {
        for topology in [
            WorkspaceExecutionTopology::SinglePath,
            WorkspaceExecutionTopology::LocalAndAnalysisPaths,
        ] {
            let reference = WorkspaceExecutionDomainReference::start(topology).unwrap();
            let snapshots = reference.group().snapshots().unwrap();
            assert_eq!(snapshots.len(), 1);
            assert_eq!(
                snapshots[0]
                    .execution_domains
                    .iter()
                    .map(|domain| domain.configured_threads)
                    .sum::<usize>(),
                2
            );
        }
    }

    #[test]
    fn reference_uses_production_operation_protocols() {
        assert_eq!(OperationKind::LocalRead.protocol(), LOCAL_READ_PROTOCOL);
        assert_eq!(
            OperationKind::WorkspaceAnalysis.protocol(),
            WORKSPACE_ANALYSIS_PROTOCOL
        );
        assert_eq!(OperationKind::Bulk.protocol(), BULK_PROTOCOL);
    }

    fn test_payload(kind: OperationKind) -> Value {
        match kind {
            OperationKind::LocalRead => json!({
                "path": repository_root(),
                "iterations": 1
            }),
            OperationKind::WorkspaceAnalysis | OperationKind::Bulk => json!({
                "snapshot": "src/lib.rs\0src/main.rs\0",
                "iterations": 1
            }),
            _ => unreachable!(),
        }
    }
}

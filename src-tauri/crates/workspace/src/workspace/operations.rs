use std::any::Any;
use std::collections::{BTreeMap, HashMap};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use mutsuki_runtime_contracts::{
    CompletionBatch, DispatchLane, EntryCompletion, ExecutionClass, OrderingRequirement,
    ResourceAccessMode, ResourceRequirement, RunnerBatchCapability, RunnerDescriptor, RunnerMode,
    RunnerPurity, RunnerResult, RunnerSideEffect, RunnerStatus, Task, TaskHandle, TaskOutcome,
    WorkBatch,
};
use mutsuki_runtime_core::{Runner, RunnerContext, RuntimeResult};
use serde_json::json;
use tokio::sync::oneshot;

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::tasks::{
    finish_workspace_task, mark_workspace_task_running, record_pending_operation_task,
    register_pending_task_cancellation,
};

pub const LOCAL_READ_PROTOCOL: &str = "effect.lilia.github.operation.local-read.v1";
pub const LOCAL_WRITE_PROTOCOL: &str = "effect.lilia.github.operation.local-write.v1";
pub const GITHUB_READ_PROTOCOL: &str = "effect.lilia.github.operation.github-read.v1";
pub const GITHUB_WRITE_PROTOCOL: &str = "effect.lilia.github.operation.github-write.v1";
pub const GITHUB_TRANSFER_PROTOCOL: &str = "effect.lilia.github.operation.github-transfer.v1";
pub const WORKSPACE_ANALYSIS_PROTOCOL: &str = "effect.lilia.github.operation.workspace-analysis.v1";
pub const BULK_PROTOCOL: &str = "effect.lilia.github.operation.bulk.v1";
pub const LAUNCH_CONTROL_PROTOCOL: &str = "effect.lilia.github.operation.launch-control.v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OperationKind {
    LocalRead,
    LocalWrite,
    GitHubRead,
    GitHubWrite,
    GitHubTransfer,
    WorkspaceAnalysis,
    Bulk,
    LaunchControl,
}

impl OperationKind {
    pub fn protocol(self) -> &'static str {
        match self {
            Self::LocalRead => LOCAL_READ_PROTOCOL,
            Self::LocalWrite => LOCAL_WRITE_PROTOCOL,
            Self::GitHubRead => GITHUB_READ_PROTOCOL,
            Self::GitHubWrite => GITHUB_WRITE_PROTOCOL,
            Self::GitHubTransfer => GITHUB_TRANSFER_PROTOCOL,
            Self::WorkspaceAnalysis => WORKSPACE_ANALYSIS_PROTOCOL,
            Self::Bulk => BULK_PROTOCOL,
            Self::LaunchControl => LAUNCH_CONTROL_PROTOCOL,
        }
    }

    pub fn concurrency(self) -> usize {
        match self {
            Self::LocalRead | Self::GitHubRead | Self::Bulk => 4,
            Self::LocalWrite
            | Self::GitHubWrite
            | Self::GitHubTransfer
            | Self::WorkspaceAnalysis
            | Self::LaunchControl => 2,
        }
    }
}

#[derive(Clone, Debug)]
pub struct VisibleOperation {
    pub kind: String,
    pub title: String,
    pub priority: String,
    pub repo_id: Option<String>,
}

impl VisibleOperation {
    pub fn new(kind: impl Into<String>, title: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            title: title.into(),
            priority: "normal".to_string(),
            repo_id: None,
        }
    }

    pub fn priority(mut self, priority: impl Into<String>) -> Self {
        self.priority = priority.into();
        self
    }

    pub fn repo_id(mut self, repo_id: impl Into<String>) -> Self {
        self.repo_id = Some(repo_id.into());
        self
    }
}

#[derive(Clone, Debug)]
pub struct OperationSpec {
    pub kind: OperationKind,
    pub lane: DispatchLane,
    pub priority: i64,
    pub ordering: OrderingRequirement,
    pub resource_requirements: Vec<ResourceRequirement>,
    pub visible: Option<VisibleOperation>,
    pub parent_task_id: Option<String>,
}

impl OperationSpec {
    pub fn new(kind: OperationKind) -> Self {
        Self {
            kind,
            lane: DispatchLane::Interactive,
            priority: 0,
            ordering: OrderingRequirement::None,
            resource_requirements: Vec::new(),
            visible: None,
            parent_task_id: None,
        }
    }

    pub fn lane(mut self, lane: DispatchLane) -> Self {
        self.lane = lane;
        self
    }

    pub fn priority(mut self, priority: i64) -> Self {
        self.priority = priority;
        self
    }

    pub fn visible(mut self, visible: VisibleOperation) -> Self {
        self.visible = Some(visible);
        self
    }

    pub fn resource(mut self, ref_id: impl Into<String>, mode: ResourceAccessMode) -> Self {
        self.resource_requirements.push(ResourceRequirement {
            ref_id: ref_id.into(),
            mode,
            expected_version: None,
        });
        self
    }

    pub fn parent_task(mut self, task_id: impl Into<String>) -> Self {
        self.parent_task_id = Some(task_id.into());
        self
    }

    pub fn same_resource_order(mut self, ref_id: impl Into<String>) -> Self {
        self.ordering = OrderingRequirement::SameResourceOrder {
            ref_id: ref_id.into(),
        };
        self
    }
}

type TypedValue = Box<dyn Any + Send>;
type TypedResult = Result<TypedValue, String>;

pub enum OperationTaskCompletion {
    Success(String),
    Error(String),
}

struct OperationExecution {
    result: TypedResult,
    completion: Option<OperationTaskCompletion>,
}

impl OperationExecution {
    fn result(result: TypedResult) -> Self {
        Self {
            result,
            completion: None,
        }
    }
}

struct OperationEntry {
    app: AppHandle,
    visible_task_id: Option<String>,
    parent_task_id: Option<String>,
    sender: oneshot::Sender<OperationExecution>,
    run: Box<dyn FnOnce() -> OperationExecution + Send>,
}

fn registry() -> &'static Mutex<HashMap<String, OperationEntry>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, OperationEntry>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn next_operation_id() -> String {
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    format!(
        "operation-{}-{}",
        std::process::id(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}

pub async fn run_operation<T, F>(
    app: AppHandle,
    spec: OperationSpec,
    operation: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    submit_operation(app, spec, operation)?.wait().await
}

pub async fn run_operation_with_completion<T, F>(
    app: AppHandle,
    spec: OperationSpec,
    operation: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<(T, OperationTaskCompletion), String> + Send + 'static,
{
    submit_operation_with_completion(app, spec, operation)?
        .wait()
        .await
}

pub struct OperationTicket<T> {
    operation_id: String,
    handle: TaskHandle,
    receiver: oneshot::Receiver<TypedResult>,
    marker: std::marker::PhantomData<T>,
}

#[derive(Clone)]
pub struct OperationCancelTarget {
    pub operation_id: String,
    pub handle: TaskHandle,
}

impl<T: Send + 'static> OperationTicket<T> {
    pub fn cancel_target(&self) -> OperationCancelTarget {
        OperationCancelTarget {
            operation_id: self.operation_id.clone(),
            handle: self.handle.clone(),
        }
    }

    pub async fn wait(self) -> Result<T, String> {
        let typed = self
            .receiver
            .await
            .map_err(|_| "Mutsuki 操作结果通道已关闭".to_string())??;
        typed
            .downcast::<T>()
            .map(|value| *value)
            .map_err(|_| "Mutsuki 操作返回类型不匹配".to_string())
    }
}

fn combine_operation_result(result: TypedResult, outcome: TaskOutcome) -> TypedResult {
    match result {
        Err(error) => Err(error),
        Ok(value) => {
            ensure_completed(outcome)?;
            Ok(value)
        }
    }
}

fn operation_wait_error(error: impl std::fmt::Display) -> String {
    format!("等待 Mutsuki 操作异常：{error}")
}

async fn monitor_operation(
    app: AppHandle,
    operation_id: String,
    task_id: String,
    visible_task_id: Option<String>,
    mut business_receiver: oneshot::Receiver<OperationExecution>,
    result_sender: oneshot::Sender<TypedResult>,
) {
    let wait_app = app.clone();
    let wait_task_id = task_id.clone();
    let mut outcome =
        tokio::task::spawn_blocking(move || wait_app.wait_mutsuki_task(&wait_task_id));
    let monitored: Result<OperationExecution, String> = tokio::select! {
        business = &mut business_receiver => {
            match business {
                Err(_) => Err("Mutsuki 操作结果通道已关闭".to_string()),
                Ok(business) => match outcome.await {
                    Err(error) => Err(operation_wait_error(error)),
                    Ok(Err(error)) => Err(error),
                    Ok(Ok(core_outcome)) => Ok(OperationExecution {
                        result: combine_operation_result(business.result, core_outcome),
                        completion: business.completion,
                    }),
                }
            }
        }
        core = &mut outcome => {
            let core_result = core
                .map_err(operation_wait_error)
                .and_then(|result| result)
                .and_then(ensure_completed);
            match core_result {
                Ok(()) => business_receiver
                    .await
                    .map_err(|_| "Mutsuki 操作结果通道已关闭".to_string()),
                Err(core_error) => {
                    fail_pending_operation(&operation_id, &core_error);
                    Ok(match business_receiver.await {
                        Ok(OperationExecution { result: Err(business_error), completion }) if !business_error.is_empty() => OperationExecution {
                            result: Err(business_error),
                            completion,
                        },
                        Ok(_) | Err(_) => OperationExecution::result(Err(core_error)),
                    })
                }
            }
        }
    };
    let execution = monitored.unwrap_or_else(|error| {
        fail_pending_operation(&operation_id, &error);
        OperationExecution::result(Err(error))
    });

    if let Some(task_id) = visible_task_id {
        let (status, message) = match (&execution.result, &execution.completion) {
            (Ok(_), Some(OperationTaskCompletion::Success(message))) => {
                ("success", message.clone())
            }
            (Ok(_), Some(OperationTaskCompletion::Error(message))) => ("error", message.clone()),
            (Ok(_), None) => ("success", "完成".to_string()),
            (Err(error), _) if error.contains("取消") => ("cancelled", error.clone()),
            (Err(error), _) => ("error", error.clone()),
        };
        finish_workspace_task(&app, &task_id, status, Some(message));
    }
    let _ = result_sender.send(execution.result);
}

pub fn submit_operation<T, F>(
    app: AppHandle,
    spec: OperationSpec,
    operation: F,
) -> Result<OperationTicket<T>, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    submit_operation_inner(app, spec, move || {
        OperationExecution::result(match catch_unwind(AssertUnwindSafe(operation)) {
            Ok(Ok(value)) => Ok(Box::new(value) as TypedValue),
            Ok(Err(error)) => Err(error),
            Err(payload) => Err(panic_message(payload)),
        })
    })
}

fn submit_operation_with_completion<T, F>(
    app: AppHandle,
    spec: OperationSpec,
    operation: F,
) -> Result<OperationTicket<T>, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<(T, OperationTaskCompletion), String> + Send + 'static,
{
    submit_operation_inner(app, spec, move || {
        match catch_unwind(AssertUnwindSafe(operation)) {
            Ok(Ok((value, completion))) => OperationExecution {
                result: Ok(Box::new(value) as TypedValue),
                completion: Some(completion),
            },
            Ok(Err(error)) => OperationExecution::result(Err(error)),
            Err(payload) => OperationExecution::result(Err(panic_message(payload))),
        }
    })
}

fn submit_operation_inner<T, F>(
    app: AppHandle,
    spec: OperationSpec,
    operation: F,
) -> Result<OperationTicket<T>, String>
where
    T: Send + 'static,
    F: FnOnce() -> OperationExecution + Send + 'static,
{
    let operation_id = next_operation_id();
    let visible_task = spec.visible.as_ref().map(|visible| {
        record_pending_operation_task(
            &app,
            &visible.kind,
            &visible.title,
            &visible.priority,
            visible.repo_id.clone(),
            None,
        )
    });
    let visible_task_id = visible_task.as_ref().map(|task| task.id.clone());
    let (business_sender, business_receiver) = oneshot::channel::<OperationExecution>();
    let (result_sender, receiver) = oneshot::channel::<TypedResult>();
    let run = Box::new(operation);
    registry()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .insert(
            operation_id.clone(),
            OperationEntry {
                app: app.clone(),
                visible_task_id: visible_task.as_ref().map(|task| task.id.clone()),
                parent_task_id: spec.parent_task_id.clone(),
                sender: business_sender,
                run,
            },
        );

    let mut task = Task::new(
        operation_id.clone(),
        spec.kind.protocol(),
        json!({ "operationId": operation_id }),
    );
    task.priority = spec.priority;
    task.dispatch_lane = spec.lane;
    task.ordering = spec.ordering;
    task.resource_requirements = spec.resource_requirements;
    let handle = match app.submit_mutsuki_task(task) {
        Ok(handle) => handle,
        Err(error) => {
            fail_pending_operation(&operation_id, &error);
            if let Some(task_id) = visible_task_id.as_deref() {
                finish_workspace_task(&app, task_id, "error", Some(error.clone()));
            }
            return Err(error);
        }
    };

    if let Some(visible_task) = visible_task {
        let cancel_app = app.clone();
        let cancel_target = OperationCancelTarget {
            operation_id: operation_id.clone(),
            handle: handle.clone(),
        };
        register_pending_task_cancellation(
            &app,
            &visible_task.id,
            Box::new(move || cancel_pending_operation(&cancel_app, cancel_target, "操作已取消")),
        );
    }

    let monitor_app = app.clone();
    let monitor_operation_id = operation_id.clone();
    let monitor_task_id = handle.task_id.clone();
    let monitor_visible_task_id = visible_task_id;
    tokio::spawn(monitor_operation(
        monitor_app,
        monitor_operation_id,
        monitor_task_id,
        monitor_visible_task_id,
        business_receiver,
        result_sender,
    ));

    Ok(OperationTicket {
        operation_id,
        handle,
        receiver,
        marker: std::marker::PhantomData,
    })
}

fn ensure_completed(outcome: TaskOutcome) -> Result<(), String> {
    match outcome {
        TaskOutcome::Completed { .. } => Ok(()),
        TaskOutcome::Failed { error, .. } => Err(format!("Mutsuki 操作失败：{error:?}")),
        TaskOutcome::Cancelled { reason, .. } => Err(reason.unwrap_or_else(|| "操作已取消".into())),
        TaskOutcome::Expired { reason, .. } => Err(reason.unwrap_or_else(|| "操作已过期".into())),
        TaskOutcome::DeadLetter { reason, .. } => {
            Err(reason.unwrap_or_else(|| "操作无法调度".into()))
        }
    }
}

fn panic_message(payload: Box<dyn Any + Send>) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        format!("后台操作异常：{message}")
    } else if let Some(message) = payload.downcast_ref::<String>() {
        format!("后台操作异常：{message}")
    } else {
        "后台操作异常".to_string()
    }
}

pub fn cancel_pending_operation(
    app: &AppHandle,
    target: OperationCancelTarget,
    reason: &str,
) -> Result<(), String> {
    cancel_pending_operations(app, &[target], reason)
}

pub fn cancel_pending_operations(
    app: &AppHandle,
    targets: &[OperationCancelTarget],
    reason: &str,
) -> Result<(), String> {
    let entries = {
        let mut registry = registry().lock().unwrap_or_else(|error| error.into_inner());
        if targets
            .iter()
            .any(|target| !registry.contains_key(&target.operation_id))
        {
            return Err("批量任务已开始或不支持取消".to_string());
        }
        targets
            .iter()
            .filter_map(|target| registry.remove(&target.operation_id))
            .collect::<Vec<_>>()
    };
    for target in targets {
        let _ = app.cancel_mutsuki_task(target.handle.clone());
    }
    for entry in entries {
        let _ = entry
            .sender
            .send(OperationExecution::result(Err(reason.to_string())));
    }
    Ok(())
}

fn fail_pending_operation(operation_id: &str, reason: &str) {
    let entry = registry()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(operation_id);
    if let Some(entry) = entry {
        let _ = entry
            .sender
            .send(OperationExecution::result(Err(reason.to_string())));
    }
}

pub fn operation_runners() -> Vec<Box<dyn Runner>> {
    [
        OperationKind::LocalRead,
        OperationKind::LocalWrite,
        OperationKind::GitHubRead,
        OperationKind::GitHubWrite,
        OperationKind::GitHubTransfer,
        OperationKind::WorkspaceAnalysis,
        OperationKind::Bulk,
        OperationKind::LaunchControl,
    ]
    .into_iter()
    .map(|kind| Box::new(OperationRunner::new(kind)) as Box<dyn Runner>)
    .collect()
}

struct OperationRunner {
    descriptor: RunnerDescriptor,
}

impl OperationRunner {
    fn new(kind: OperationKind) -> Self {
        let protocol = kind.protocol();
        let concurrency = kind.concurrency();
        Self {
            descriptor: RunnerDescriptor {
                runner_id: protocol.into(),
                plugin_id: "lilia.github.operations".into(),
                plugin_generation: 1,
                accepted_protocol_ids: vec![protocol.into()],
                purity: RunnerPurity::Effectful,
                execution_class: ExecutionClass::Blocking,
                input_schema: json!({ "type": "object" }),
                output_schema: json!({ "type": "object" }),
                batch: RunnerBatchCapability {
                    mode: RunnerMode::NativeBatch,
                    preferred_batch_size: concurrency,
                    max_batch_entries: concurrency,
                    max_entry_concurrency: concurrency,
                    max_inflight_batches: 1,
                    scalar_thread_safe: true,
                    scalar_reentrant: true,
                    partial_failure: true,
                    preserve_order: false,
                    side_effect: RunnerSideEffect::External,
                },
                payload: Default::default(),
                resources: Default::default(),
                ordering: Default::default(),
                control: Default::default(),
                metadata: BTreeMap::new(),
                contract_surfaces: vec![format!("task_protocol:{protocol}")],
            },
        }
    }
}

impl Runner for OperationRunner {
    fn descriptor(&self) -> &RunnerDescriptor {
        &self.descriptor
    }

    fn run_batch(
        &mut self,
        _ctx: RunnerContext,
        batch: WorkBatch,
    ) -> RuntimeResult<CompletionBatch> {
        let tasks = match batch.row_payload_tasks() {
            Ok(tasks) => tasks,
            Err(error) => return Ok(CompletionBatch::from_error(&batch, error)),
        };
        let mut by_id = std::thread::scope(|scope| {
            tasks
                .into_iter()
                .map(|task| {
                    let task_id = task.task_id.clone();
                    let worker = scope.spawn(move || execute_operation(task));
                    (task_id, worker)
                })
                .collect::<Vec<_>>()
                .into_iter()
                .map(|(task_id, worker)| {
                    let result = worker.join().unwrap_or_else(|_| failed_result(&task_id));
                    (task_id, result)
                })
                .collect::<HashMap<_, _>>()
        });
        Ok(CompletionBatch::from_results(
            &batch,
            batch
                .entries
                .iter()
                .map(|entry| EntryCompletion {
                    entry_id: entry.entry_id.clone(),
                    task_id: entry.task_id.clone(),
                    result: Some(
                        by_id
                            .remove(&entry.task_id)
                            .unwrap_or_else(|| failed_result(&entry.task_id)),
                    ),
                    error: None,
                })
                .collect(),
        ))
    }
}

fn execute_operation(task: Task) -> RunnerResult {
    let entry = registry()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(&task.task_id);
    let Some(entry) = entry else {
        return RunnerResult::completed(task.task_id);
    };
    let lifecycle_task_id = entry
        .visible_task_id
        .as_deref()
        .or(entry.parent_task_id.as_deref());
    if let Some(task_id) = lifecycle_task_id {
        if !mark_workspace_task_running(&entry.app, task_id, None) {
            let _ = entry
                .sender
                .send(OperationExecution::result(Err("操作已取消".to_string())));
            return RunnerResult::completed(task.task_id);
        }
    }
    let result = (entry.run)();
    let failed = result.result.is_err();
    let _ = entry.sender.send(result);
    if failed {
        failed_result(&task.task_id)
    } else {
        RunnerResult::completed(task.task_id)
    }
}

fn failed_result(task_id: &str) -> RunnerResult {
    let mut result = RunnerResult::completed(task_id.to_string());
    result.status = RunnerStatus::Failed;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::WorkspaceRuntime;
    use crate::workspace::tasks::{workspace_cancel_task, workspace_list_tasks};
    use mutsuki_runtime_contracts::{CancelPolicy, RuntimeError};
    use mutsuki_runtime_core::TaskPool;
    use serde_json::Value;
    use std::sync::atomic::{AtomicBool, AtomicUsize};
    use std::sync::{Arc, Condvar};

    fn test_guard() -> std::sync::MutexGuard<'static, ()> {
        static TEST_LOCK: Mutex<()> = Mutex::new(());
        TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner())
    }

    #[test]
    fn effectful_operation_runners_are_claimable() {
        for (index, runner) in operation_runners().into_iter().enumerate() {
            let descriptor = runner.descriptor();
            assert!(descriptor.runner_id.starts_with("effect."));

            let task_id = format!("operation-contract-{index}");
            let mut tasks = TaskPool::default();
            tasks
                .enqueue(Task::new(
                    task_id.clone(),
                    descriptor.accepted_protocol_ids[0].clone(),
                    json!({}),
                ))
                .unwrap();
            let claimed = tasks.claim_ready(descriptor, 1, 0, 1);
            assert_eq!(claimed.len(), 1);
            assert_eq!(claimed[0].task_id, task_id);
        }
    }

    #[derive(Default)]
    struct InlineRuntime {
        outcome: Mutex<Option<TaskOutcome>>,
        submit_error: Option<String>,
        execute: bool,
    }

    impl InlineRuntime {
        fn executing() -> Self {
            Self {
                execute: true,
                ..Self::default()
            }
        }

        fn core_failure() -> Self {
            Self {
                outcome: Mutex::new(Some(TaskOutcome::Failed {
                    task_id: String::new(),
                    error: RuntimeError::new("core.failure", "test", "operation"),
                })),
                ..Self::default()
            }
        }
    }

    impl WorkspaceRuntime for InlineRuntime {
        fn store_get(&self, _file: &str, _key: &str) -> Result<Option<Value>, String> {
            Ok(None)
        }
        fn store_set(&self, _file: &str, _key: &str, _value: Value) -> Result<(), String> {
            Ok(())
        }
        fn store_delete(&self, _file: &str, _key: &str) -> Result<(), String> {
            Ok(())
        }
        fn store_save(&self, _file: &str) -> Result<(), String> {
            Ok(())
        }
        fn pick_folder(&self, _title: Option<&str>) -> Result<Option<String>, String> {
            Ok(None)
        }
        fn pick_files(&self, _title: Option<&str>) -> Result<Option<Vec<String>>, String> {
            Ok(None)
        }
        fn open_path(&self, _path: &str, _with: Option<&str>) -> Result<(), String> {
            Ok(())
        }
        fn open_url(&self, _url: &str, _with: Option<&str>) -> Result<(), String> {
            Ok(())
        }
        fn emit(&self, _event: &str, _payload: Value) -> Result<(), String> {
            Ok(())
        }
        fn submit_mutsuki_task(&self, task: Task) -> Result<TaskHandle, String> {
            if let Some(error) = &self.submit_error {
                return Err(error.clone());
            }
            let handle = TaskHandle {
                task_id: task.task_id.clone(),
                protocol_id: task.protocol_id.clone(),
                target_binding_id: None,
                cancel_policy: CancelPolicy::Cascade,
                trace_id: None,
                correlation_id: None,
            };
            if self.execute {
                let result = execute_operation(task);
                let outcome = if result.status == RunnerStatus::Failed {
                    TaskOutcome::Failed {
                        task_id: handle.task_id.clone(),
                        error: RuntimeError::new("operation.failed", "test", "operation"),
                    }
                } else {
                    TaskOutcome::Completed {
                        task_id: handle.task_id.clone(),
                        output_ref: None,
                    }
                };
                *self.outcome.lock().unwrap() = Some(outcome);
            } else if let Some(outcome) = self.outcome.lock().unwrap().as_mut() {
                match outcome {
                    TaskOutcome::Failed { task_id, .. }
                    | TaskOutcome::Cancelled { task_id, .. }
                    | TaskOutcome::Expired { task_id, .. }
                    | TaskOutcome::DeadLetter { task_id, .. }
                    | TaskOutcome::Completed { task_id, .. } => *task_id = handle.task_id.clone(),
                }
            }
            Ok(handle)
        }
        fn wait_mutsuki_task(&self, _task_id: &str) -> Result<TaskOutcome, String> {
            self.outcome
                .lock()
                .unwrap()
                .clone()
                .ok_or_else(|| "missing outcome".to_string())
        }
    }

    fn app(runtime: InlineRuntime) -> AppHandle {
        AppHandle::new(Arc::new(runtime))
    }

    #[derive(Default)]
    struct ControlledRuntime {
        tasks: Mutex<HashMap<String, Task>>,
        outcomes: Mutex<HashMap<String, TaskOutcome>>,
        outcome_ready: Condvar,
        cancel_calls: AtomicUsize,
    }

    impl ControlledRuntime {
        fn app(self: &Arc<Self>) -> AppHandle {
            AppHandle::new(self.clone())
        }

        fn start(&self, task_id: &str) {
            let task = self
                .tasks
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .remove(task_id)
                .expect("submitted task must be available");
            let result = execute_operation(task);
            let outcome = if result.status == RunnerStatus::Failed {
                TaskOutcome::Failed {
                    task_id: task_id.to_string(),
                    error: RuntimeError::new("operation.failed", "test", "operation"),
                }
            } else {
                TaskOutcome::Completed {
                    task_id: task_id.to_string(),
                    output_ref: None,
                }
            };
            self.finish(outcome);
        }

        fn fail_before_start(&self, task_id: &str) {
            self.tasks
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .remove(task_id);
            self.finish(TaskOutcome::Failed {
                task_id: task_id.to_string(),
                error: RuntimeError::new("core.failure", "test", "operation"),
            });
        }

        fn finish(&self, outcome: TaskOutcome) {
            let task_id = match &outcome {
                TaskOutcome::Failed { task_id, .. }
                | TaskOutcome::Cancelled { task_id, .. }
                | TaskOutcome::Expired { task_id, .. }
                | TaskOutcome::DeadLetter { task_id, .. }
                | TaskOutcome::Completed { task_id, .. } => task_id.clone(),
            };
            self.outcomes
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .insert(task_id, outcome);
            self.outcome_ready.notify_all();
        }
    }

    impl WorkspaceRuntime for ControlledRuntime {
        fn store_get(&self, _file: &str, _key: &str) -> Result<Option<Value>, String> {
            Ok(None)
        }
        fn store_set(&self, _file: &str, _key: &str, _value: Value) -> Result<(), String> {
            Ok(())
        }
        fn store_delete(&self, _file: &str, _key: &str) -> Result<(), String> {
            Ok(())
        }
        fn store_save(&self, _file: &str) -> Result<(), String> {
            Ok(())
        }
        fn pick_folder(&self, _title: Option<&str>) -> Result<Option<String>, String> {
            Ok(None)
        }
        fn pick_files(&self, _title: Option<&str>) -> Result<Option<Vec<String>>, String> {
            Ok(None)
        }
        fn open_path(&self, _path: &str, _with: Option<&str>) -> Result<(), String> {
            Ok(())
        }
        fn open_url(&self, _url: &str, _with: Option<&str>) -> Result<(), String> {
            Ok(())
        }
        fn emit(&self, _event: &str, _payload: Value) -> Result<(), String> {
            Ok(())
        }
        fn submit_mutsuki_task(&self, task: Task) -> Result<TaskHandle, String> {
            let handle = TaskHandle {
                task_id: task.task_id.clone(),
                protocol_id: task.protocol_id.clone(),
                target_binding_id: None,
                cancel_policy: CancelPolicy::Cascade,
                trace_id: None,
                correlation_id: None,
            };
            self.tasks
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .insert(task.task_id.clone(), task);
            Ok(handle)
        }
        fn wait_mutsuki_task(&self, task_id: &str) -> Result<TaskOutcome, String> {
            let mut outcomes = self
                .outcomes
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            loop {
                if let Some(outcome) = outcomes.remove(task_id) {
                    return Ok(outcome);
                }
                outcomes = self
                    .outcome_ready
                    .wait(outcomes)
                    .unwrap_or_else(|error| error.into_inner());
            }
        }
        fn cancel_mutsuki_task(&self, handle: TaskHandle) -> Result<(), String> {
            self.cancel_calls.fetch_add(1, Ordering::SeqCst);
            self.tasks
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .remove(&handle.task_id);
            self.finish(TaskOutcome::Cancelled {
                task_id: handle.task_id,
                reason: Some("操作已取消".to_string()),
            });
            Ok(())
        }
    }

    async fn wait_for_task_status(title: &str, status: &str) {
        for _ in 0..200 {
            if workspace_list_tasks()
                .iter()
                .any(|task| task.title == title && task.status == status)
            {
                return;
            }
            tokio::task::yield_now().await;
        }
        panic!("task {title} did not reach {status}");
    }

    #[tokio::test]
    async fn typed_result_round_trips_through_runner() {
        let _guard = test_guard();
        let value = run_operation(
            app(InlineRuntime::executing()),
            OperationSpec::new(OperationKind::LocalRead),
            || Ok::<_, String>(42_u64),
        )
        .await
        .unwrap();
        assert_eq!(value, 42);
    }

    #[tokio::test]
    async fn business_error_is_not_replaced_by_core_failure() {
        let _guard = test_guard();
        let error = run_operation::<(), _>(
            app(InlineRuntime::executing()),
            OperationSpec::new(OperationKind::LocalRead),
            || Err("domain failure".to_string()),
        )
        .await
        .unwrap_err();
        assert_eq!(error, "domain failure");
    }

    #[tokio::test]
    async fn panic_becomes_a_terminal_operation_error() {
        let _guard = test_guard();
        let error = run_operation::<(), _>(
            app(InlineRuntime::executing()),
            OperationSpec::new(OperationKind::LocalRead),
            || panic!("broken operation"),
        )
        .await
        .unwrap_err();
        assert!(error.contains("broken operation"));
    }

    #[tokio::test]
    async fn submission_failure_does_not_leave_registry_entry() {
        let _guard = test_guard();
        let runtime = InlineRuntime {
            submit_error: Some("submit failed".to_string()),
            ..InlineRuntime::default()
        };
        let before = registry()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .len();
        let error = run_operation::<(), _>(
            app(runtime),
            OperationSpec::new(OperationKind::LocalRead),
            || Ok(()),
        )
        .await
        .unwrap_err();
        assert_eq!(error, "submit failed");
        assert_eq!(
            registry()
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .len(),
            before
        );
    }

    #[tokio::test]
    async fn core_failure_before_runner_removes_pending_operation() {
        let _guard = test_guard();
        let before = registry()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .len();
        let error = run_operation::<(), _>(
            app(InlineRuntime::core_failure()),
            OperationSpec::new(OperationKind::LocalRead),
            || Ok(()),
        )
        .await
        .unwrap_err();
        assert!(error.contains("core.failure"));
        assert_eq!(
            registry()
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .len(),
            before
        );
    }

    #[tokio::test]
    async fn dropped_ticket_still_completes_visible_task_after_core_failure() {
        let _guard = test_guard();
        let runtime = Arc::new(ControlledRuntime::default());
        let title = "drop-safe core failure";
        let ticket = submit_operation::<(), _>(
            runtime.app(),
            OperationSpec::new(OperationKind::LocalRead)
                .visible(VisibleOperation::new("workspace", title)),
            || Ok(()),
        )
        .unwrap();
        let operation_id = ticket.operation_id.clone();
        runtime.fail_before_start(&ticket.handle.task_id);
        drop(ticket);

        wait_for_task_status(title, "error").await;
        assert!(!registry()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .contains_key(&operation_id));
    }

    #[tokio::test]
    async fn projected_error_changes_task_terminal_state_without_changing_typed_result() {
        let _guard = test_guard();
        let title = "projected refresh failure";
        let value = run_operation_with_completion(
            app(InlineRuntime::executing()),
            OperationSpec::new(OperationKind::LocalRead)
                .visible(VisibleOperation::new("repoStatus", title)),
            || {
                Ok::<_, String>((
                    17_u64,
                    OperationTaskCompletion::Error("远端刷新失败".to_string()),
                ))
            },
        )
        .await
        .unwrap();

        assert_eq!(value, 17);
        wait_for_task_status(title, "error").await;
    }

    #[tokio::test]
    async fn pending_cancel_claims_operation_before_calling_core() {
        let _guard = test_guard();
        let runtime = Arc::new(ControlledRuntime::default());
        let side_effect = Arc::new(AtomicBool::new(false));
        let run_side_effect = Arc::clone(&side_effect);
        let title = "pending cancellation claim";
        let ticket = submit_operation(
            runtime.app(),
            OperationSpec::new(OperationKind::LocalWrite)
                .visible(VisibleOperation::new("git", title)),
            move || {
                run_side_effect.store(true, Ordering::SeqCst);
                Ok::<_, String>(())
            },
        )
        .unwrap();
        let task_id = workspace_list_tasks()
            .into_iter()
            .find(|task| task.title == title)
            .unwrap()
            .id;

        workspace_cancel_task(runtime.app(), task_id).unwrap();

        assert_eq!(runtime.cancel_calls.load(Ordering::SeqCst), 1);
        assert!(!side_effect.load(Ordering::SeqCst));
        assert!(ticket.wait().await.unwrap_err().contains("取消"));
    }

    #[tokio::test]
    async fn running_cancel_is_rejected_without_calling_core_cancel() {
        let _guard = test_guard();
        let runtime = Arc::new(ControlledRuntime::default());
        let started = Arc::new((Mutex::new(false), Condvar::new()));
        let release = Arc::new((Mutex::new(false), Condvar::new()));
        let run_started = Arc::clone(&started);
        let run_release = Arc::clone(&release);
        let title = "running cancellation rejection";
        let ticket = submit_operation(
            runtime.app(),
            OperationSpec::new(OperationKind::LocalWrite)
                .visible(VisibleOperation::new("git", title)),
            move || {
                let (lock, ready) = &*run_started;
                *lock.lock().unwrap_or_else(|error| error.into_inner()) = true;
                ready.notify_all();
                let (lock, ready) = &*run_release;
                let mut released = lock.lock().unwrap_or_else(|error| error.into_inner());
                while !*released {
                    released = ready
                        .wait(released)
                        .unwrap_or_else(|error| error.into_inner());
                }
                Ok::<_, String>(())
            },
        )
        .unwrap();
        let core_task_id = ticket.handle.task_id.clone();
        let task_id = workspace_list_tasks()
            .into_iter()
            .find(|task| task.title == title)
            .unwrap()
            .id;
        let start_runtime = Arc::clone(&runtime);
        let runner = std::thread::spawn(move || start_runtime.start(&core_task_id));
        let (lock, ready) = &*started;
        let mut has_started = lock.lock().unwrap_or_else(|error| error.into_inner());
        while !*has_started {
            has_started = ready
                .wait(has_started)
                .unwrap_or_else(|error| error.into_inner());
        }
        drop(has_started);

        assert!(workspace_cancel_task(runtime.app(), task_id).is_err());
        assert_eq!(runtime.cancel_calls.load(Ordering::SeqCst), 0);

        let (lock, ready) = &*release;
        *lock.lock().unwrap_or_else(|error| error.into_inner()) = true;
        ready.notify_all();
        runner.join().unwrap();
        ticket.wait().await.unwrap();
    }

    #[tokio::test]
    async fn batch_cancel_claims_every_pending_operation_before_core_cancel() {
        let _guard = test_guard();
        let runtime = Arc::new(ControlledRuntime::default());
        let first_ran = Arc::new(AtomicBool::new(false));
        let second_ran = Arc::new(AtomicBool::new(false));
        let first_flag = Arc::clone(&first_ran);
        let second_flag = Arc::clone(&second_ran);
        let first = submit_operation(
            runtime.app(),
            OperationSpec::new(OperationKind::Bulk),
            move || {
                first_flag.store(true, Ordering::SeqCst);
                Ok::<_, String>(())
            },
        )
        .unwrap();
        let second = submit_operation(
            runtime.app(),
            OperationSpec::new(OperationKind::Bulk),
            move || {
                second_flag.store(true, Ordering::SeqCst);
                Ok::<_, String>(())
            },
        )
        .unwrap();
        let targets = vec![first.cancel_target(), second.cancel_target()];

        cancel_pending_operations(&runtime.app(), &targets, "批量同步已取消").unwrap();

        assert_eq!(runtime.cancel_calls.load(Ordering::SeqCst), 2);
        assert!(!first_ran.load(Ordering::SeqCst));
        assert!(!second_ran.load(Ordering::SeqCst));
        assert!(first.wait().await.unwrap_err().contains("取消"));
        assert!(second.wait().await.unwrap_err().contains("取消"));
    }

    #[tokio::test]
    async fn batch_cancel_rejects_all_targets_when_any_operation_has_started() {
        let _guard = test_guard();
        let runtime = Arc::new(ControlledRuntime::default());
        let started = Arc::new((Mutex::new(false), Condvar::new()));
        let release = Arc::new((Mutex::new(false), Condvar::new()));
        let run_started = Arc::clone(&started);
        let run_release = Arc::clone(&release);
        let first = submit_operation(
            runtime.app(),
            OperationSpec::new(OperationKind::Bulk),
            move || {
                let (lock, ready) = &*run_started;
                *lock.lock().unwrap_or_else(|error| error.into_inner()) = true;
                ready.notify_all();
                let (lock, ready) = &*run_release;
                let mut released = lock.lock().unwrap_or_else(|error| error.into_inner());
                while !*released {
                    released = ready
                        .wait(released)
                        .unwrap_or_else(|error| error.into_inner());
                }
                Ok::<_, String>(())
            },
        )
        .unwrap();
        let second = submit_operation(
            runtime.app(),
            OperationSpec::new(OperationKind::Bulk),
            || Ok::<_, String>(()),
        )
        .unwrap();
        let targets = vec![first.cancel_target(), second.cancel_target()];
        let first_task_id = first.handle.task_id.clone();
        let start_runtime = Arc::clone(&runtime);
        let runner = std::thread::spawn(move || start_runtime.start(&first_task_id));
        let (lock, ready) = &*started;
        let mut has_started = lock.lock().unwrap_or_else(|error| error.into_inner());
        while !*has_started {
            has_started = ready
                .wait(has_started)
                .unwrap_or_else(|error| error.into_inner());
        }
        drop(has_started);

        assert!(cancel_pending_operations(&runtime.app(), &targets, "批量同步已取消").is_err());
        assert_eq!(runtime.cancel_calls.load(Ordering::SeqCst), 0);
        assert!(registry()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .contains_key(&second.operation_id));

        cancel_pending_operation(&runtime.app(), second.cancel_target(), "测试清理").unwrap();
        let (lock, ready) = &*release;
        *lock.lock().unwrap_or_else(|error| error.into_inner()) = true;
        ready.notify_all();
        runner.join().unwrap();
        first.wait().await.unwrap();
        assert_eq!(second.wait().await.unwrap_err(), "测试清理");
    }
}

use std::any::Any;
use std::collections::HashMap;
use std::future::Future;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use tokio::sync::oneshot;

use crate::runtime::WorkspaceContext as AppHandle;
use crate::task_runtime::{ExecutionClass, TaskHandle, TaskSpec};
use crate::workspace::tasks::{
    finish_workspace_task, mark_workspace_task_running, record_pending_operation_task,
    register_pending_task_cancellation,
};

tokio::task_local! {
    static ACTIVE_OPERATION_GROUP_TASK_ID: String;
}

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
    pub fn execution_class(self) -> ExecutionClass {
        match self {
            Self::LocalRead | Self::LocalWrite => ExecutionClass::Blocking,
            Self::GitHubRead | Self::GitHubWrite | Self::GitHubTransfer => ExecutionClass::Io,
            Self::WorkspaceAnalysis | Self::Bulk => ExecutionClass::Cpu,
            Self::LaunchControl => ExecutionClass::Orchestration,
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

pub struct VisibleOperationGroup {
    app: AppHandle,
    task_id: String,
}

impl VisibleOperationGroup {
    pub fn new(app: AppHandle, visible: VisibleOperation, pending_message: Option<String>) -> Self {
        let task = record_pending_operation_task(
            &app,
            &visible.kind,
            &visible.title,
            &visible.priority,
            visible.repo_id,
            pending_message,
        );
        Self {
            app,
            task_id: task.id,
        }
    }

    pub fn task_id(&self) -> &str {
        &self.task_id
    }

    pub fn mark_running(&self, message: Option<String>) -> bool {
        mark_workspace_task_running(&self.app, &self.task_id, message)
    }

    pub fn finish(&self, completion: OperationTaskCompletion) -> bool {
        let (status, message) = match completion {
            OperationTaskCompletion::Success(message) => ("success", message),
            OperationTaskCompletion::Error(message) => ("error", message),
        };
        finish_workspace_task(&self.app, &self.task_id, status, Some(message))
    }

    pub fn finish_cancelled(&self, message: String) -> bool {
        finish_workspace_task(&self.app, &self.task_id, "cancelled", Some(message))
    }

    pub fn register_cancel_targets(
        &self,
        targets: Vec<OperationCancelTarget>,
        reason: &'static str,
    ) -> bool {
        let app = self.app.clone();
        register_pending_task_cancellation(
            &self.app,
            &self.task_id,
            Box::new(move || cancel_pending_operations(&app, &targets, reason)),
        )
    }

    pub async fn run<T, F, Fut, C>(self, operation: F, completion: C) -> Result<T, String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, String>>,
        C: FnOnce(&T) -> OperationTaskCompletion,
    {
        self.mark_running(None);
        let result = ACTIVE_OPERATION_GROUP_TASK_ID
            .scope(self.task_id.clone(), operation())
            .await;
        match result {
            Ok(value) => {
                self.finish(completion(&value));
                Ok(value)
            }
            Err(error) => {
                let status = if error.contains("取消") {
                    "cancelled"
                } else {
                    "error"
                };
                finish_workspace_task(&self.app, &self.task_id, status, Some(error.clone()));
                Err(error)
            }
        }
    }
}

#[derive(Clone, Debug)]
pub struct OperationSpec {
    pub kind: OperationKind,
    pub priority: i64,
    pub visible: Option<VisibleOperation>,
    pub parent_task_id: Option<String>,
}

impl OperationSpec {
    pub fn new(kind: OperationKind) -> Self {
        Self {
            kind,
            priority: 0,
            visible: None,
            parent_task_id: None,
        }
    }

    pub fn priority(mut self, priority: i64) -> Self {
        self.priority = priority;
        self
    }

    pub fn visible(mut self, visible: VisibleOperation) -> Self {
        self.visible = Some(visible);
        self
    }

    pub fn parent_task(mut self, task_id: impl Into<String>) -> Self {
        self.parent_task_id = Some(task_id.into());
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

pub(crate) struct OperationRegistry {
    entries: Mutex<HashMap<String, OperationEntry>>,
    next_id: AtomicU64,
    shutdown: AtomicBool,
}

impl OperationRegistry {
    pub(crate) fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            shutdown: AtomicBool::new(false),
        }
    }

    fn next_operation_id(&self) -> String {
        format!(
            "operation-{}-{}",
            std::process::id(),
            self.next_id.fetch_add(1, Ordering::Relaxed)
        )
    }

    fn insert(&self, operation_id: String, entry: OperationEntry) -> Result<(), String> {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if self.shutdown.load(Ordering::Acquire) {
            return Err("操作执行器已关闭".to_string());
        }
        entries.insert(operation_id, entry);
        Ok(())
    }

    fn remove(&self, operation_id: &str) -> Option<OperationEntry> {
        self.entries
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(operation_id)
    }

    pub(crate) fn shutdown(&self, reason: &str) {
        let entries = {
            let mut entries = self
                .entries
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            self.shutdown.store(true, Ordering::Release);
            entries.drain().map(|(_, entry)| entry).collect::<Vec<_>>()
        };
        for entry in entries {
            let _ = entry
                .sender
                .send(OperationExecution::result(Err(reason.to_string())));
        }
    }
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
    pub(crate) handle: TaskHandle,
    receiver: oneshot::Receiver<TypedResult>,
    marker: std::marker::PhantomData<T>,
}

#[derive(Clone)]
pub struct OperationCancelTarget {
    pub operation_id: String,
    pub(crate) handle: TaskHandle,
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
            .map_err(|_| "操作结果通道已关闭".to_string())??;
        typed
            .downcast::<T>()
            .map(|value| *value)
            .map_err(|_| "操作返回类型不匹配".to_string())
    }
}

async fn monitor_operation(
    app: AppHandle,
    registry: std::sync::Arc<OperationRegistry>,
    operation_id: String,
    visible_task_id: Option<String>,
    business_receiver: oneshot::Receiver<OperationExecution>,
    result_sender: oneshot::Sender<TypedResult>,
) {
    let execution = match business_receiver.await {
        Ok(execution) => execution,
        Err(_) => {
            let error = "操作结果通道已关闭".to_string();
            fail_pending_operation(&registry, &operation_id, &error);
            OperationExecution::result(Err(error))
        }
    };

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
    mut spec: OperationSpec,
    operation: F,
) -> Result<OperationTicket<T>, String>
where
    T: Send + 'static,
    F: FnOnce() -> OperationExecution + Send + 'static,
{
    if spec.parent_task_id.is_none() {
        spec.parent_task_id = ACTIVE_OPERATION_GROUP_TASK_ID.try_with(Clone::clone).ok();
    }
    let registry = app.operation_registry();
    let operation_id = registry.next_operation_id();
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
    if let Err(error) = registry.insert(
        operation_id.clone(),
        OperationEntry {
            app: app.clone(),
            visible_task_id: visible_task_id.clone(),
            parent_task_id: spec.parent_task_id.clone(),
            sender: business_sender,
            run: Box::new(operation),
        },
    ) {
        if let Some(task_id) = visible_task_id.as_deref() {
            finish_workspace_task(&app, task_id, "cancelled", Some(error.clone()));
        }
        return Err(error);
    }

    let task_spec = TaskSpec::new(
        operation_id.clone(),
        spec.priority,
        spec.kind.execution_class(),
    );
    let task_id = operation_id.clone();
    let job_registry = std::sync::Arc::clone(&registry);
    let job = Box::new(move |_| {
        let entry = job_registry
            .remove(&task_id)
            .ok_or_else(|| "操作已取消".to_string())?;
        let lifecycle_task_id = entry
            .visible_task_id
            .as_deref()
            .or(entry.parent_task_id.as_deref());
        if let Some(task_id) = lifecycle_task_id {
            if !mark_workspace_task_running(&entry.app, task_id, None) {
                let _ = entry
                    .sender
                    .send(OperationExecution::result(Err("操作已取消".to_string())));
                return Err("操作已取消".to_string());
            }
        }
        let result = (entry.run)();
        let failure = result
            .result
            .as_ref()
            .err()
            .cloned()
            .unwrap_or_else(|| "后台操作失败".to_string());
        let failed = result.result.is_err();
        let _ = entry.sender.send(result);
        if failed {
            Err(failure)
        } else {
            Ok(())
        }
    });
    let handle = match app.submit_task(task_spec, job) {
        Ok(handle) => handle,
        Err(error) => {
            fail_pending_operation(&registry, &operation_id, &error);
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

    tokio::spawn(monitor_operation(
        app,
        registry,
        operation_id.clone(),
        visible_task_id,
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
    let registry = app.operation_registry();
    let entries = {
        let mut entries = registry
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if targets
            .iter()
            .any(|target| !entries.contains_key(&target.operation_id))
        {
            return Err("批量任务已开始或不支持取消".to_string());
        }
        targets
            .iter()
            .filter_map(|target| entries.remove(&target.operation_id))
            .collect::<Vec<_>>()
    };
    for target in targets {
        let _ = app.cancel_task(&target.handle);
    }
    for entry in entries {
        let _ = entry
            .sender
            .send(OperationExecution::result(Err(reason.to_string())));
    }
    Ok(())
}

fn fail_pending_operation(registry: &OperationRegistry, operation_id: &str, reason: &str) {
    let entry = registry.remove(operation_id);
    if let Some(entry) = entry {
        let _ = entry
            .sender
            .send(OperationExecution::result(Err(reason.to_string())));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::{WorkspaceContext, WorkspaceRuntime};
    use serde_json::Value;
    use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
    use std::sync::Arc;
    use std::thread;

    struct TestRuntime;

    impl WorkspaceRuntime for TestRuntime {
        fn store_get(
            &self,
            _file: &str,
            _key: &str,
        ) -> Result<Option<Value>, crate::runtime::StoreError> {
            Ok(None)
        }
        fn store_set(
            &self,
            _file: &str,
            _key: &str,
            _value: Value,
        ) -> Result<(), crate::runtime::StoreError> {
            Ok(())
        }
        fn store_delete(&self, _file: &str, _key: &str) -> Result<(), crate::runtime::StoreError> {
            Ok(())
        }
        fn store_save(&self, _file: &str) -> Result<(), crate::runtime::StoreError> {
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
    }

    fn app() -> WorkspaceContext {
        WorkspaceContext::new(Arc::new(TestRuntime))
    }

    #[test]
    fn operation_kinds_keep_their_execution_classes() {
        assert_eq!(
            OperationKind::LocalRead.execution_class(),
            ExecutionClass::Blocking
        );
        assert_eq!(
            OperationKind::GitHubRead.execution_class(),
            ExecutionClass::Io
        );
        assert_eq!(
            OperationKind::WorkspaceAnalysis.execution_class(),
            ExecutionClass::Cpu
        );
        assert_eq!(
            OperationKind::LaunchControl.execution_class(),
            ExecutionClass::Orchestration
        );
    }

    #[tokio::test]
    async fn typed_operation_result_round_trips_through_tokio_runtime() {
        let value = run_operation(app(), OperationSpec::new(OperationKind::LocalRead), || {
            Ok::<_, String>(42_u64)
        })
        .await
        .unwrap();
        assert_eq!(value, 42);
    }

    #[tokio::test]
    async fn business_errors_and_panics_remain_terminal_errors() {
        let error =
            run_operation::<(), _>(app(), OperationSpec::new(OperationKind::LocalRead), || {
                Err("domain failure".to_string())
            })
            .await
            .unwrap_err();
        assert_eq!(error, "domain failure");

        let panic =
            run_operation::<(), _>(app(), OperationSpec::new(OperationKind::LocalRead), || {
                panic!("broken operation")
            })
            .await
            .unwrap_err();
        assert!(panic.contains("broken operation"));
    }

    #[tokio::test]
    async fn app_state_shutdown_drains_pending_operations_without_cross_app_leaks() {
        let first_app = app();
        let second_app = app();
        let gate = Arc::new(AtomicBool::new(false));
        let started = Arc::new(AtomicBool::new(false));
        let blocker_gate = Arc::clone(&gate);
        let blocker_started = Arc::clone(&started);
        let blocker = first_app
            .submit_task(
                TaskSpec::new("blocker", 100, ExecutionClass::Cpu),
                Box::new(move |_| {
                    blocker_started.store(true, AtomicOrdering::Release);
                    while !blocker_gate.load(AtomicOrdering::Acquire) {
                        thread::yield_now();
                    }
                    Ok(())
                }),
            )
            .unwrap();
        while !started.load(AtomicOrdering::Acquire) {
            thread::yield_now();
        }
        let ran = Arc::new(AtomicBool::new(false));
        let ran_by_operation = Arc::clone(&ran);
        let pending = submit_operation(
            first_app.clone(),
            OperationSpec::new(OperationKind::WorkspaceAnalysis),
            move || {
                ran_by_operation.store(true, AtomicOrdering::Release);
                Ok::<_, String>(())
            },
        )
        .unwrap();

        first_app.shutdown();
        let error = pending.wait().await.unwrap_err();
        assert!(error.contains("应用已退出"));
        let second_result = run_operation(
            second_app,
            OperationSpec::new(OperationKind::WorkspaceAnalysis),
            || Ok::<_, String>(42_u64),
        )
        .await
        .unwrap();
        assert_eq!(second_result, 42);
        gate.store(true, AtomicOrdering::Release);
        assert!(matches!(
            blocker.wait(),
            crate::task_runtime::TaskOutcome::Completed { .. }
        ));
        assert!(!ran.load(AtomicOrdering::Acquire));
    }
}

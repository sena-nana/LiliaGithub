use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::{fmt, io};

use serde::Serialize;
use serde_json::Value as JsonValue;

use crate::task_runtime::{CancelResult, TaskHandle, TaskJob, TaskSpec, WorkspaceTaskRuntime};
use crate::workspace::github::GitHubRuntimeState;
use crate::workspace::launch::LaunchRuntimeState;
use crate::workspace::operations::OperationRegistry;
use crate::workspace::refresh::RefreshRuntimeState;
use crate::workspace::repo_guard::RepoGuardRuntimeState;
use crate::workspace::settings::SettingsRuntimeState;
use crate::workspace::tasks::WorkspaceTaskRuntimeState;
use crate::workspace::watcher::WatcherRuntimeState;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StoreErrorKind {
    Corrupt,
    Permission,
    Io,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoreError {
    kind: StoreErrorKind,
    message: String,
}

impl StoreError {
    pub fn new(kind: StoreErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn from_io(error: io::Error) -> Self {
        let kind = if error.kind() == io::ErrorKind::PermissionDenied {
            StoreErrorKind::Permission
        } else {
            StoreErrorKind::Io
        };
        Self::new(kind, error.to_string())
    }

    pub fn kind(&self) -> StoreErrorKind {
        self.kind
    }
}

impl fmt::Display for StoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for StoreError {}

impl From<StoreError> for String {
    fn from(error: StoreError) -> Self {
        error.to_string()
    }
}

pub trait WorkspaceRuntime: Send + Sync {
    fn store_get(&self, file: &str, key: &str) -> Result<Option<JsonValue>, StoreError>;
    fn store_set(&self, file: &str, key: &str, value: JsonValue) -> Result<(), StoreError>;
    fn store_delete(&self, file: &str, key: &str) -> Result<(), StoreError>;
    fn store_save(&self, file: &str) -> Result<(), StoreError>;
    fn pick_folder(&self, title: Option<&str>) -> Result<Option<String>, String>;
    fn pick_files(&self, title: Option<&str>) -> Result<Option<Vec<String>>, String>;
    fn open_path(&self, path: &str, with: Option<&str>) -> Result<(), String>;
    fn open_url(&self, url: &str, with: Option<&str>) -> Result<(), String>;
    fn emit(&self, event: &str, payload: JsonValue) -> Result<(), String>;
    fn resource_dir(&self) -> Option<PathBuf> {
        None
    }
}

#[derive(Clone)]
pub struct WorkspaceContext {
    runtime: Arc<dyn WorkspaceRuntime>,
    app_state: WorkspaceAppState,
}

struct WorkspaceAppStateInner {
    task_runtime: Arc<WorkspaceTaskRuntime>,
    operation_registry: Arc<OperationRegistry>,
    workspace_tasks: WorkspaceTaskRuntimeState,
    refresh_runtime: RefreshRuntimeState,
    watcher_runtime: WatcherRuntimeState,
    repo_guards: RepoGuardRuntimeState,
    launch_runtime: LaunchRuntimeState,
    github_runtime: GitHubRuntimeState,
    settings_runtime: SettingsRuntimeState,
    shutdown: AtomicBool,
}

impl WorkspaceAppStateInner {
    fn shutdown(&self) {
        if self.shutdown.swap(true, Ordering::AcqRel) {
            return;
        }
        self.watcher_runtime.shutdown();
        self.refresh_runtime.shutdown();
        self.launch_runtime.shutdown();
        self.operation_registry.shutdown("应用已退出，操作已取消");
        self.task_runtime.shutdown();
        self.workspace_tasks.shutdown();
    }
}

impl Drop for WorkspaceAppStateInner {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[derive(Clone)]
pub struct WorkspaceAppState {
    inner: Arc<WorkspaceAppStateInner>,
}

impl WorkspaceAppState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(WorkspaceAppStateInner {
                task_runtime: WorkspaceTaskRuntime::new(),
                operation_registry: Arc::new(OperationRegistry::new()),
                workspace_tasks: WorkspaceTaskRuntimeState::default(),
                refresh_runtime: RefreshRuntimeState::default(),
                watcher_runtime: WatcherRuntimeState::default(),
                repo_guards: RepoGuardRuntimeState::default(),
                launch_runtime: LaunchRuntimeState::default(),
                github_runtime: GitHubRuntimeState::default(),
                settings_runtime: SettingsRuntimeState::default(),
                shutdown: AtomicBool::new(false),
            }),
        }
    }

    pub fn shutdown(&self) {
        self.inner.shutdown();
    }
}

impl Default for WorkspaceAppState {
    fn default() -> Self {
        Self::new()
    }
}

impl WorkspaceContext {
    pub fn new(runtime: Arc<dyn WorkspaceRuntime>) -> Self {
        Self {
            runtime,
            app_state: WorkspaceAppState::new(),
        }
    }

    pub fn with_app_state(
        runtime: Arc<dyn WorkspaceRuntime>,
        app_state: WorkspaceAppState,
    ) -> Self {
        Self { runtime, app_state }
    }

    pub fn store(&self, file: &str) -> Result<WorkspaceStore, String> {
        Ok(WorkspaceStore {
            context: self.clone(),
            file: file.to_string(),
        })
    }

    pub fn dialog(&self) -> WorkspaceDialog {
        WorkspaceDialog {
            context: self.clone(),
        }
    }

    pub fn opener(&self) -> WorkspaceOpener {
        WorkspaceOpener {
            context: self.clone(),
        }
    }

    pub fn emit<T: Serialize>(&self, event: &str, payload: &T) -> Result<(), String> {
        let payload = serde_json::to_value(payload).map_err(|error| error.to_string())?;
        self.runtime.emit(event, payload)
    }

    pub fn resource_dir(&self) -> Option<PathBuf> {
        self.runtime.resource_dir()
    }

    pub fn submit_task(&self, spec: TaskSpec, job: TaskJob) -> Result<TaskHandle, String> {
        self.app_state.inner.task_runtime.submit(spec, job)
    }

    pub fn cancel_task(&self, handle: &TaskHandle) -> CancelResult {
        self.app_state.inner.task_runtime.cancel(handle)
    }

    pub fn shutdown(&self) {
        self.app_state.shutdown();
    }

    pub(crate) fn operation_registry(&self) -> Arc<OperationRegistry> {
        Arc::clone(&self.app_state.inner.operation_registry)
    }

    pub(crate) fn workspace_tasks(&self) -> &WorkspaceTaskRuntimeState {
        &self.app_state.inner.workspace_tasks
    }

    pub(crate) fn refresh_runtime(&self) -> &RefreshRuntimeState {
        &self.app_state.inner.refresh_runtime
    }

    pub(crate) fn watcher_runtime(&self) -> &WatcherRuntimeState {
        &self.app_state.inner.watcher_runtime
    }

    pub(crate) fn repo_guards(&self) -> &RepoGuardRuntimeState {
        &self.app_state.inner.repo_guards
    }

    pub(crate) fn launch_runtime(&self) -> &LaunchRuntimeState {
        &self.app_state.inner.launch_runtime
    }

    pub(crate) fn github_runtime(&self) -> &GitHubRuntimeState {
        &self.app_state.inner.github_runtime
    }

    pub(crate) fn settings_runtime(&self) -> &SettingsRuntimeState {
        &self.app_state.inner.settings_runtime
    }
}

pub struct WorkspaceStore {
    context: WorkspaceContext,
    file: String,
}

impl WorkspaceStore {
    pub fn get(&self, key: &str) -> Result<Option<JsonValue>, StoreError> {
        self.context.runtime.store_get(&self.file, key)
    }

    pub fn set(&self, key: &str, value: JsonValue) -> Result<(), StoreError> {
        self.context.runtime.store_set(&self.file, key, value)
    }

    pub fn delete(&self, key: &str) -> Result<(), StoreError> {
        self.context.runtime.store_delete(&self.file, key)
    }

    pub fn save(&self) -> Result<(), StoreError> {
        self.context.runtime.store_save(&self.file)
    }
}

pub struct WorkspaceDialog {
    context: WorkspaceContext,
}

impl WorkspaceDialog {
    pub fn file(&self) -> WorkspaceFileDialogBuilder {
        WorkspaceFileDialogBuilder {
            context: self.context.clone(),
            title: None,
        }
    }
}

pub struct WorkspaceFileDialogBuilder {
    context: WorkspaceContext,
    title: Option<String>,
}

impl WorkspaceFileDialogBuilder {
    pub fn set_title(mut self, title: &str) -> Self {
        self.title = Some(title.to_string());
        self
    }

    pub fn blocking_pick_folder(&self) -> Option<String> {
        self.context
            .runtime
            .pick_folder(self.title.as_deref())
            .ok()
            .flatten()
    }

    pub fn blocking_pick_files(&self) -> Option<Vec<String>> {
        self.context
            .runtime
            .pick_files(self.title.as_deref())
            .ok()
            .flatten()
    }
}

pub struct WorkspaceOpener {
    context: WorkspaceContext,
}

impl WorkspaceOpener {
    pub fn open_path(&self, path: String, with: Option<&str>) -> Result<(), String> {
        self.context.runtime.open_path(&path, with)
    }

    pub fn open_url(&self, url: String, with: Option<&str>) -> Result<(), String> {
        self.context.runtime.open_url(&url, with)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FailingStoreRuntime;

    impl WorkspaceRuntime for FailingStoreRuntime {
        fn store_get(&self, _file: &str, _key: &str) -> Result<Option<JsonValue>, StoreError> {
            Err(StoreError::new(StoreErrorKind::Io, "get failed"))
        }

        fn store_set(&self, _file: &str, _key: &str, _value: JsonValue) -> Result<(), StoreError> {
            Err(StoreError::new(StoreErrorKind::Io, "set failed"))
        }

        fn store_delete(&self, _file: &str, _key: &str) -> Result<(), StoreError> {
            Err(StoreError::new(StoreErrorKind::Io, "delete failed"))
        }

        fn store_save(&self, _file: &str) -> Result<(), StoreError> {
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

        fn emit(&self, _event: &str, _payload: JsonValue) -> Result<(), String> {
            Ok(())
        }
    }

    #[test]
    fn workspace_store_propagates_runtime_failures() {
        let context = WorkspaceContext::new(Arc::new(FailingStoreRuntime));
        let store = context.store("settings.json").unwrap();

        assert_eq!(store.get("key").unwrap_err().to_string(), "get failed");
        assert_eq!(
            store.set("key", JsonValue::Null).unwrap_err().to_string(),
            "set failed"
        );
        assert_eq!(
            store.delete("key").unwrap_err().to_string(),
            "delete failed"
        );
    }

    #[test]
    fn application_runtime_state_is_shared_only_within_one_app() {
        let first = WorkspaceContext::new(Arc::new(FailingStoreRuntime));
        let first_clone = first.clone();
        let second = WorkspaceContext::new(Arc::new(FailingStoreRuntime));

        assert!(std::ptr::eq(
            first.workspace_tasks(),
            first_clone.workspace_tasks()
        ));
        assert!(!std::ptr::eq(
            first.workspace_tasks(),
            second.workspace_tasks()
        ));
        assert!(!std::ptr::eq(
            first.refresh_runtime(),
            second.refresh_runtime()
        ));
        assert!(!std::ptr::eq(
            first.watcher_runtime(),
            second.watcher_runtime()
        ));
        assert!(!std::ptr::eq(first.repo_guards(), second.repo_guards()));
        assert!(!std::ptr::eq(
            first.launch_runtime(),
            second.launch_runtime()
        ));
    }
}

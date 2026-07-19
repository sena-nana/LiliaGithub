pub mod bulk;
pub mod code_review;
pub mod conversations;
pub mod file_browser;
pub mod github;
pub mod github_discussions;
pub mod home_attention;
pub mod launch;
mod lilia_code_handoff;
pub mod notifications;
pub(crate) mod operations;
pub(crate) mod readme;
pub(crate) mod refresh;
pub(crate) mod repo_guard;
pub mod repos;
pub mod settings;
mod shared;
pub mod storage;
pub mod system;
pub mod tasks;
pub(crate) mod watcher;

use crate::runtime::WorkspaceContext as AppHandle;
use mutsuki_runtime_contracts::DispatchLane;
use operations::{run_operation, OperationKind, OperationSpec, VisibleOperation};

async fn run_core_operation<T, F>(
    app: AppHandle,
    kind: OperationKind,
    label: &'static str,
    task: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    run_core_operation_as(app, kind, None, label, task).await
}

async fn run_core_operation_as<T, F>(
    app: AppHandle,
    kind: OperationKind,
    visible_kind: Option<&'static str>,
    label: &'static str,
    task: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let mut spec = OperationSpec::new(kind);
    spec = match kind {
        OperationKind::LocalWrite => spec.priority(100),
        OperationKind::GitHubWrite => spec.priority(50),
        OperationKind::GitHubTransfer => spec.priority(25),
        OperationKind::WorkspaceAnalysis => spec.lane(DispatchLane::Background).priority(-50),
        OperationKind::Bulk => spec.lane(DispatchLane::Bulk),
        OperationKind::LaunchControl => spec.lane(DispatchLane::Control),
        _ => spec,
    };
    if visible_kind == Some("repoStatus") {
        spec = spec.lane(DispatchLane::Interactive).priority(50);
    }
    let task_kind = visible_kind.or(match kind {
        OperationKind::LocalWrite => Some("git"),
        OperationKind::GitHubWrite | OperationKind::GitHubTransfer => Some("github"),
        OperationKind::WorkspaceAnalysis => Some("workspace"),
        OperationKind::Bulk => Some("sync"),
        OperationKind::LaunchControl => Some("launch"),
        OperationKind::LocalRead | OperationKind::GitHubRead => None,
    });
    if let Some(task_kind) = task_kind {
        let priority = if visible_kind == Some("repoStatus") {
            "high"
        } else {
            match kind {
                OperationKind::LocalWrite | OperationKind::LaunchControl => "high",
                OperationKind::WorkspaceAnalysis => "low",
                _ => "normal",
            }
        };
        spec = spec.visible(VisibleOperation::new(task_kind, label).priority(priority));
    }
    run_operation(app, spec, task).await
}

#[cfg(test)]
mod tests;

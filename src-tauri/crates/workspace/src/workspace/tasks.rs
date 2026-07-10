use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::shared::now_millis;
use lilia_github_contracts::workspace::WorkspaceTask;

const TASK_CHANGED_EVENT: &str = "workspace://task-changed";
const MAX_WORKSPACE_TASKS: usize = 200;

pub(super) fn workspace_tasks() -> &'static Mutex<Vec<WorkspaceTask>> {
    static TASKS: OnceLock<Mutex<Vec<WorkspaceTask>>> = OnceLock::new();
    TASKS.get_or_init(|| Mutex::new(Vec::new()))
}

pub(super) fn next_workspace_task_id() -> String {
    static INDEX: AtomicU64 = AtomicU64::new(1);
    format!(
        "workspace-task-{}-{}",
        now_millis(),
        INDEX.fetch_add(1, Ordering::Relaxed)
    )
}

pub(super) fn task_priority_rank(priority: &str) -> usize {
    match priority {
        "high" => 0,
        "normal" => 1,
        _ => 2,
    }
}

fn is_terminal_workspace_task(task: &WorkspaceTask) -> bool {
    matches!(task.status.as_str(), "success" | "error" | "cancelled")
}

fn normalize_workspace_tasks(tasks: &mut Vec<WorkspaceTask>) {
    tasks.sort_by(|a, b| {
        task_priority_rank(&a.priority)
            .cmp(&task_priority_rank(&b.priority))
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });

    let protected_count = tasks
        .iter()
        .filter(|task| !is_terminal_workspace_task(task))
        .count();
    let mut terminal_slots = MAX_WORKSPACE_TASKS.saturating_sub(protected_count);
    tasks.retain(|task| {
        if !is_terminal_workspace_task(task) {
            return true;
        }
        if terminal_slots == 0 {
            return false;
        }
        terminal_slots -= 1;
        true
    });
}

pub(super) fn record_workspace_task(
    kind: &str,
    priority: &str,
    repo_id: Option<String>,
    status: &str,
    message: Option<String>,
) -> WorkspaceTask {
    record_workspace_task_with_cancellable(kind, priority, repo_id, status, message, false)
}

fn record_workspace_task_with_cancellable(
    kind: &str,
    priority: &str,
    repo_id: Option<String>,
    status: &str,
    message: Option<String>,
    cancellable: bool,
) -> WorkspaceTask {
    let task = WorkspaceTask {
        id: next_workspace_task_id(),
        kind: kind.to_string(),
        priority: priority.to_string(),
        repo_id,
        status: status.to_string(),
        message,
        cancellable,
        updated_at: now_millis(),
    };
    let mut tasks = workspace_tasks().lock().unwrap_or_else(|e| e.into_inner());
    tasks.push(task.clone());
    normalize_workspace_tasks(&mut tasks);
    task
}

pub(super) fn record_workspace_task_and_emit(
    app: &AppHandle,
    kind: &str,
    priority: &str,
    repo_id: Option<String>,
    status: &str,
    message: Option<String>,
    cancellable: bool,
) -> WorkspaceTask {
    let task = record_workspace_task_with_cancellable(
        kind,
        priority,
        repo_id,
        status,
        message,
        cancellable,
    );
    let _ = app.emit(TASK_CHANGED_EVENT, &task);
    task
}

pub(super) fn update_workspace_task(task_id: &str, status: &str, message: Option<String>) {
    update_workspace_task_value(task_id, status, message, false);
}

fn update_workspace_task_value(
    task_id: &str,
    status: &str,
    message: Option<String>,
    cancellable: bool,
) -> Option<WorkspaceTask> {
    let mut tasks = workspace_tasks().lock().unwrap_or_else(|e| e.into_inner());
    update_workspace_task_in(&mut tasks, task_id, status, message, cancellable)
}

fn update_workspace_task_in(
    tasks: &mut Vec<WorkspaceTask>,
    task_id: &str,
    status: &str,
    message: Option<String>,
    cancellable: bool,
) -> Option<WorkspaceTask> {
    let task = tasks.iter_mut().find(|task| task.id == task_id)?;
    task.status = status.to_string();
    task.message = message;
    task.cancellable = cancellable;
    task.updated_at = now_millis();
    let updated = task.clone();
    normalize_workspace_tasks(tasks);
    Some(updated)
}

pub(super) fn update_workspace_task_and_emit(
    app: &AppHandle,
    task_id: &str,
    status: &str,
    message: Option<String>,
    cancellable: bool,
) -> Option<WorkspaceTask> {
    let updated = update_workspace_task_value(task_id, status, message, cancellable)?;
    let _ = app.emit(TASK_CHANGED_EVENT, &updated);
    Some(updated)
}

pub fn workspace_list_tasks() -> Vec<WorkspaceTask> {
    workspace_tasks()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

pub fn workspace_cancel_task(app: AppHandle, task_id: String) -> Result<(), String> {
    if !crate::workspace::refresh::cancel_pending_refresh(&task_id) {
        return Err("任务已开始或不支持取消".to_string());
    }
    update_workspace_task_and_emit(
        &app,
        &task_id,
        "cancelled",
        Some("已取消".to_string()),
        false,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(id: impl Into<String>, priority: &str, status: &str, updated_at: i64) -> WorkspaceTask {
        WorkspaceTask {
            id: id.into(),
            kind: "test".to_string(),
            priority: priority.to_string(),
            repo_id: None,
            status: status.to_string(),
            message: None,
            cancellable: false,
            updated_at,
        }
    }

    #[test]
    fn running_task_survives_newer_terminal_history_and_can_complete() {
        let mut tasks = vec![task("old-running", "low", "running", 1)];
        tasks.extend((0..MAX_WORKSPACE_TASKS).map(|index| {
            task(
                format!("terminal-{index}"),
                "high",
                "success",
                index as i64 + 1_000,
            )
        }));

        normalize_workspace_tasks(&mut tasks);

        assert_eq!(tasks.len(), MAX_WORKSPACE_TASKS);
        assert!(tasks.iter().any(|task| task.id == "old-running"));

        let updated =
            update_workspace_task_in(&mut tasks, "old-running", "success", None, false).unwrap();

        assert_eq!(updated.status, "success");
        assert_eq!(tasks.len(), MAX_WORKSPACE_TASKS);
        assert!(tasks
            .iter()
            .any(|task| task.id == "old-running" && task.status == "success"));
    }

    #[test]
    fn active_tasks_can_exceed_limit_until_one_completes() {
        let mut tasks = (0..=MAX_WORKSPACE_TASKS)
            .map(|index| {
                task(
                    format!("running-{index}"),
                    "normal",
                    "running",
                    index as i64,
                )
            })
            .collect();

        normalize_workspace_tasks(&mut tasks);
        assert_eq!(tasks.len(), MAX_WORKSPACE_TASKS + 1);

        update_workspace_task_in(&mut tasks, "running-0", "cancelled", None, false).unwrap();

        assert_eq!(tasks.len(), MAX_WORKSPACE_TASKS);
    }
}

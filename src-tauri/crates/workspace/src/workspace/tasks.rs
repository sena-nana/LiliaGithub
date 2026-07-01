use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use crate::workspace::shared::now_millis;
use lilia_github_contracts::workspace::WorkspaceTask;

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

pub(super) fn record_workspace_task(
    kind: &str,
    priority: &str,
    repo_id: Option<String>,
    status: &str,
    message: Option<String>,
) -> WorkspaceTask {
    let task = WorkspaceTask {
        id: next_workspace_task_id(),
        kind: kind.to_string(),
        priority: priority.to_string(),
        repo_id,
        status: status.to_string(),
        message,
        updated_at: now_millis(),
    };
    let mut tasks = workspace_tasks().lock().unwrap_or_else(|e| e.into_inner());
    tasks.push(task.clone());
    tasks.sort_by(|a, b| {
        task_priority_rank(&a.priority)
            .cmp(&task_priority_rank(&b.priority))
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });
    while tasks.len() > 200 {
        tasks.pop();
    }
    task
}

pub(super) fn update_workspace_task(task_id: &str, status: &str, message: Option<String>) {
    let mut tasks = workspace_tasks().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(task) = tasks.iter_mut().find(|task| task.id == task_id) {
        task.status = status.to_string();
        task.message = message;
        task.updated_at = now_millis();
    }
}

pub fn workspace_list_tasks() -> Vec<WorkspaceTask> {
    workspace_tasks()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

pub fn workspace_cancel_task(task_id: String) -> Result<(), String> {
    update_workspace_task(&task_id, "cancelled", Some("已取消".to_string()));
    Ok(())
}

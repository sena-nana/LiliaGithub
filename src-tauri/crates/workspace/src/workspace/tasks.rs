use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::shared::now_millis;
use lilia_github_contracts::workspace::WorkspaceTask;

const TASK_CHANGED_EVENT: &str = "workspace://task-changed";
const MAX_WORKSPACE_TASKS: usize = 200;

pub(crate) type PendingTaskCancellation = Box<dyn FnOnce() -> Result<(), String> + Send>;

#[derive(Default)]
struct WorkspaceTaskState {
    tasks: Vec<WorkspaceTask>,
    pending_cancellations: HashMap<String, PendingTaskCancellation>,
}

fn workspace_task_state() -> &'static Mutex<WorkspaceTaskState> {
    static STATE: OnceLock<Mutex<WorkspaceTaskState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(WorkspaceTaskState::default()))
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

fn workspace_task_title(kind: &str) -> &'static str {
    match kind {
        "repoStatus" => "刷新仓库状态",
        "repoRemote" => "刷新远端状态",
        "repoDetail" => "刷新仓库详情",
        "discoverRepos" => "扫描本地仓库",
        "languageStats" => "统计仓库语言",
        "contributions" => "统计本地贡献",
        "git" => "Git 操作",
        "sync" => "同步仓库",
        "github" => "GitHub 操作",
        "launch" => "项目启停",
        "workspace" => "工作区操作",
        _ => "工作区任务",
    }
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

fn record_workspace_task_with_cancellable(
    kind: &str,
    title: &str,
    priority: &str,
    repo_id: Option<String>,
    status: &str,
    message: Option<String>,
    cancellable: bool,
) -> WorkspaceTask {
    let timestamp = now_millis();
    let task = WorkspaceTask {
        id: next_workspace_task_id(),
        kind: kind.to_string(),
        title: title.to_string(),
        priority: priority.to_string(),
        repo_id,
        status: status.to_string(),
        message,
        cancellable,
        created_at: timestamp,
        updated_at: timestamp,
    };
    let mut state = workspace_task_state()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    state.tasks.push(task.clone());
    normalize_workspace_tasks(&mut state.tasks);
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
        workspace_task_title(kind),
        priority,
        repo_id,
        status,
        message,
        cancellable,
    );
    let _ = app.emit(TASK_CHANGED_EVENT, &task);
    task
}

pub(crate) fn record_pending_operation_task(
    app: &AppHandle,
    kind: &str,
    title: &str,
    priority: &str,
    repo_id: Option<String>,
    message: Option<String>,
) -> WorkspaceTask {
    let task = record_workspace_task_with_cancellable(
        kind, title, priority, repo_id, "pending", message, false,
    );
    let _ = app.emit(TASK_CHANGED_EVENT, &task);
    task
}

fn update_workspace_task_value(
    task_id: &str,
    status: &str,
    message: Option<String>,
    cancellable: bool,
) -> Option<WorkspaceTask> {
    let mut state = workspace_task_state()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let updated =
        update_workspace_task_in(&mut state.tasks, task_id, status, message, cancellable)?;
    if status != "pending" || !cancellable {
        state.pending_cancellations.remove(task_id);
    }
    Some(updated)
}

fn update_workspace_task_in(
    tasks: &mut Vec<WorkspaceTask>,
    task_id: &str,
    status: &str,
    message: Option<String>,
    cancellable: bool,
) -> Option<WorkspaceTask> {
    let task = tasks.iter_mut().find(|task| task.id == task_id)?;
    if is_terminal_workspace_task(task) {
        return None;
    }
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

pub(crate) fn register_pending_task_cancellation(
    app: &AppHandle,
    task_id: &str,
    cancellation: PendingTaskCancellation,
) -> bool {
    let updated = {
        let mut state = workspace_task_state()
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some(task) = state.tasks.iter().find(|task| task.id == task_id) else {
            return false;
        };
        if task.status != "pending" || task.cancellable {
            return false;
        }
        let message = task.message.clone();
        state
            .pending_cancellations
            .insert(task_id.to_string(), cancellation);
        update_workspace_task_in(&mut state.tasks, task_id, "pending", message, true)
    };
    if let Some(task) = updated {
        let _ = app.emit(TASK_CHANGED_EVENT, &task);
        true
    } else {
        false
    }
}

pub(crate) fn mark_workspace_task_running(
    app: &AppHandle,
    task_id: &str,
    message: Option<String>,
) -> bool {
    update_workspace_task_and_emit(app, task_id, "running", message, false).is_some()
}

pub(crate) fn finish_workspace_task(
    app: &AppHandle,
    task_id: &str,
    status: &str,
    message: Option<String>,
) -> bool {
    debug_assert!(matches!(status, "success" | "error" | "cancelled"));
    update_workspace_task_and_emit(app, task_id, status, message, false).is_some()
}

pub fn workspace_list_tasks() -> Vec<WorkspaceTask> {
    workspace_task_state()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .tasks
        .clone()
}

fn reject_pending_cancellation_in(
    tasks: &mut Vec<WorkspaceTask>,
    task_id: &str,
    message: Option<String>,
) -> Option<WorkspaceTask> {
    let task = tasks.iter().find(|task| task.id == task_id)?;
    if task.status != "pending" {
        return None;
    }
    update_workspace_task_in(tasks, task_id, "pending", message, false)
}

fn reject_pending_cancellation(app: &AppHandle, task_id: &str, message: Option<String>) {
    let updated = {
        let mut state = workspace_task_state()
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reject_pending_cancellation_in(&mut state.tasks, task_id, message)
    };
    if let Some(task) = updated {
        let _ = app.emit(TASK_CHANGED_EVENT, &task);
    }
}

fn cancel_pending_operation_in(
    state: &mut WorkspaceTaskState,
    task_id: &str,
) -> Result<Option<(PendingTaskCancellation, Option<String>)>, String> {
    let Some(task) = state.tasks.iter().find(|task| task.id == task_id) else {
        return Err("任务不存在".to_string());
    };
    if task.status != "pending" || !task.cancellable {
        return Err("任务已开始或不支持取消".to_string());
    }
    let message = task.message.clone();
    let Some(cancellation) = state.pending_cancellations.remove(task_id) else {
        return Ok(None);
    };
    Ok(Some((cancellation, message)))
}

pub fn workspace_cancel_task(app: AppHandle, task_id: String) -> Result<(), String> {
    let operation_cancelled = {
        let mut state = workspace_task_state()
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        cancel_pending_operation_in(&mut state, &task_id)?
    };

    if let Some((cancellation, message)) = operation_cancelled {
        if let Err(error) = cancellation() {
            reject_pending_cancellation(&app, &task_id, message);
            return Err(error);
        }
        finish_workspace_task(&app, &task_id, "cancelled", Some("已取消".to_string()));
        return Ok(());
    }

    if !crate::workspace::refresh::cancel_pending_refresh(&task_id) {
        return Err("任务已开始或不支持取消".to_string());
    }
    finish_workspace_task(&app, &task_id, "cancelled", Some("已取消".to_string()));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    fn task(id: impl Into<String>, priority: &str, status: &str, updated_at: i64) -> WorkspaceTask {
        WorkspaceTask {
            id: id.into(),
            kind: "test".to_string(),
            title: "测试任务".to_string(),
            priority: priority.to_string(),
            repo_id: None,
            status: status.to_string(),
            message: None,
            cancellable: false,
            created_at: updated_at,
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

    #[test]
    fn terminal_transition_is_exactly_once() {
        let mut tasks = vec![task("operation", "normal", "running", 1)];

        let completed = update_workspace_task_in(
            &mut tasks,
            "operation",
            "success",
            Some("完成".to_string()),
            false,
        )
        .unwrap();
        let late_error = update_workspace_task_in(
            &mut tasks,
            "operation",
            "error",
            Some("迟到错误".to_string()),
            false,
        );

        assert_eq!(completed.status, "success");
        assert!(late_error.is_none());
        assert_eq!(tasks[0].status, "success");
        assert_eq!(tasks[0].message.as_deref(), Some("完成"));
    }

    #[test]
    fn pending_operation_cancellation_runs_handler_and_prevents_late_start() {
        let called = Arc::new(AtomicBool::new(false));
        let called_by_handler = Arc::clone(&called);
        let mut pending = task("pending", "high", "pending", 1);
        pending.cancellable = true;
        let mut state = WorkspaceTaskState {
            tasks: vec![pending],
            pending_cancellations: HashMap::from([(
                "pending".to_string(),
                Box::new(move || {
                    called_by_handler.store(true, Ordering::SeqCst);
                    Ok(())
                }) as PendingTaskCancellation,
            )]),
        };

        let (cancellation, _) = cancel_pending_operation_in(&mut state, "pending")
            .unwrap()
            .expect("pending task must expose its cancellation handler");
        cancellation().unwrap();
        update_workspace_task_in(
            &mut state.tasks,
            "pending",
            "cancelled",
            Some("已取消".to_string()),
            false,
        );
        assert!(called.load(Ordering::SeqCst));
        assert_eq!(state.tasks[0].status, "cancelled");
        assert!(!state.tasks[0].cancellable);
        assert!(
            update_workspace_task_in(&mut state.tasks, "pending", "running", None, false,)
                .is_none()
        );
    }

    #[test]
    fn running_operation_rejects_pending_cancellation_without_calling_handler() {
        let called = Arc::new(AtomicBool::new(false));
        let called_by_handler = Arc::clone(&called);
        let mut running = task("running", "normal", "running", 1);
        running.cancellable = false;
        let mut state = WorkspaceTaskState {
            tasks: vec![running],
            pending_cancellations: HashMap::from([(
                "running".to_string(),
                Box::new(move || {
                    called_by_handler.store(true, Ordering::SeqCst);
                    Ok(())
                }) as PendingTaskCancellation,
            )]),
        };

        let error = match cancel_pending_operation_in(&mut state, "running") {
            Err(error) => error,
            Ok(_) => panic!("running task cancellation must be rejected"),
        };

        assert_eq!(error, "任务已开始或不支持取消");
        assert!(!called.load(Ordering::SeqCst));
        assert_eq!(state.tasks[0].status, "running");
    }

    #[test]
    fn cancellation_claim_failure_never_moves_a_running_task_back_to_pending() {
        let mut tasks = vec![task("race", "normal", "running", 1)];

        let updated =
            reject_pending_cancellation_in(&mut tasks, "race", Some("等待执行".to_string()));

        assert!(updated.is_none());
        assert_eq!(tasks[0].status, "running");
        assert!(!tasks[0].cancellable);
    }

    #[test]
    fn cancellation_claim_failure_disables_a_still_pending_task() {
        let mut pending = task("race", "normal", "pending", 1);
        pending.cancellable = true;
        let mut tasks = vec![pending];

        let updated =
            reject_pending_cancellation_in(&mut tasks, "race", Some("等待执行".to_string()))
                .unwrap();

        assert_eq!(updated.status, "pending");
        assert!(!updated.cancellable);
    }
}

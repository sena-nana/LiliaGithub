use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::repos::refresh_repo_for_scheduler;
use crate::workspace::settings::{load_startup_cache, repo_path_by_id};
use crate::workspace::shared::now_millis;
use crate::workspace::tasks::{record_workspace_task_and_emit, update_workspace_task_and_emit};
use lilia_github_contracts::workspace::{RepoRefreshRequest, RepoRefreshedEvent};

const REPO_REFRESHED_EVENT: &str = "workspace://repo-refreshed";
const REMOTE_CACHE_TTL_MS: i64 = 10 * 60 * 1_000;
const REMOTE_BACKOFF_MS: [i64; 3] = [60 * 1_000, 5 * 60 * 1_000, 15 * 60 * 1_000];

#[derive(Clone, Copy, PartialEq, Eq)]
enum RefreshLane {
    Local,
    Remote,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum EntryState {
    Pending,
    Running,
}

struct ScheduledRefresh {
    app: AppHandle,
    request: RepoRefreshRequest,
    task_id: String,
    state: EntryState,
    rerun: Option<RepoRefreshRequest>,
    sequence: u64,
}

#[derive(Default)]
struct RemoteBackoff {
    failures: usize,
    retry_at: i64,
}

#[derive(Default)]
struct SchedulerState {
    active_repo: Option<String>,
    local_paused: bool,
    entries: HashMap<String, ScheduledRefresh>,
    remote_backoff: HashMap<String, RemoteBackoff>,
    next_sequence: u64,
}

struct RefreshScheduler {
    state: Mutex<SchedulerState>,
    changed: Condvar,
}

fn scheduler() -> &'static Arc<RefreshScheduler> {
    static SCHEDULER: OnceLock<Arc<RefreshScheduler>> = OnceLock::new();
    SCHEDULER.get_or_init(|| {
        let scheduler = Arc::new(RefreshScheduler {
            state: Mutex::new(SchedulerState::default()),
            changed: Condvar::new(),
        });
        start_worker(scheduler.clone(), RefreshLane::Local);
        start_worker(scheduler.clone(), RefreshLane::Remote);
        scheduler
    })
}

fn start_worker(scheduler: Arc<RefreshScheduler>, lane: RefreshLane) {
    let name = match lane {
        RefreshLane::Local => "repo-refresh-local",
        RefreshLane::Remote => "repo-refresh-remote",
    };
    thread::Builder::new()
        .name(name.to_string())
        .spawn(move || worker_loop(&scheduler, lane))
        .expect("failed to start repository refresh worker");
}

fn worker_loop(scheduler: &RefreshScheduler, lane: RefreshLane) {
    loop {
        let (key, app, request, task_id, include_detail) = {
            let mut state = scheduler
                .state
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            loop {
                if let Some(key) = next_pending_key(&state, lane) {
                    let active_repo = state.active_repo.clone();
                    let entry = state
                        .entries
                        .get_mut(&key)
                        .expect("pending refresh disappeared");
                    entry.state = EntryState::Running;
                    let include_detail = match entry.request.detail_scope.as_str() {
                        "detail" => true,
                        "summary" => false,
                        _ => active_repo.as_deref() == Some(entry.request.repo_id.as_str()),
                    };
                    break (
                        key,
                        entry.app.clone(),
                        entry.request.clone(),
                        entry.task_id.clone(),
                        include_detail,
                    );
                }
                state = scheduler
                    .changed
                    .wait(state)
                    .unwrap_or_else(|error| error.into_inner());
            }
        };

        update_workspace_task_and_emit(
            &app,
            &task_id,
            "running",
            Some(refresh_running_message(lane).to_string()),
            false,
        );

        let result = refresh_repo_for_scheduler(&app, &request, include_detail);
        let mut event = result
            .as_ref()
            .ok()
            .map(
                |(summary, detail_patch, remote_checked_at)| RepoRefreshedEvent {
                    repo_id: request.repo_id.clone(),
                    mode: request.mode.clone(),
                    summary: summary.clone(),
                    detail_patch: detail_patch.clone(),
                    remote_checked_at: *remote_checked_at,
                },
            );

        let rerun = {
            let mut state = scheduler
                .state
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            let owns_entry = state
                .entries
                .get(&key)
                .is_some_and(|entry| entry.task_id == task_id);
            if owns_entry && lane == RefreshLane::Remote {
                update_remote_backoff(&mut state, &request.repo_id, result.is_ok());
            }
            if !owns_entry {
                event = None;
            } else if state.active_repo.as_deref() != Some(request.repo_id.as_str()) {
                if let Some(event) = event.as_mut() {
                    event.detail_patch = None;
                }
            }
            let rerun = if owns_entry {
                state
                    .entries
                    .get_mut(&key)
                    .and_then(|entry| entry.rerun.take())
            } else {
                None
            };
            if owns_entry {
                if let Some(next_request) = rerun.as_ref() {
                    let sequence = next_sequence(&mut state);
                    if let Some(entry) = state.entries.get_mut(&key) {
                        entry.request = next_request.clone();
                        entry.state = EntryState::Pending;
                        entry.sequence = sequence;
                    }
                } else {
                    state.entries.remove(&key);
                }
            }
            rerun
        };
        scheduler.changed.notify_all();

        if let Some(event) = event {
            let _ = app.emit(REPO_REFRESHED_EVENT, &event);
        }

        if rerun.is_some() {
            update_workspace_task_and_emit(
                &app,
                &task_id,
                "pending",
                Some("仓库发生了新的变化，等待再次刷新".to_string()),
                true,
            );
        } else {
            match result {
                Ok(_) => {
                    update_workspace_task_and_emit(
                        &app,
                        &task_id,
                        "success",
                        Some(refresh_success_message(lane).to_string()),
                        false,
                    );
                }
                Err(error) => {
                    update_workspace_task_and_emit(&app, &task_id, "error", Some(error), false);
                }
            }
        }
    }
}

fn next_pending_key(state: &SchedulerState, lane: RefreshLane) -> Option<String> {
    if lane == RefreshLane::Local && state.local_paused {
        return None;
    }
    state
        .entries
        .iter()
        .filter(|(_, entry)| {
            entry.state == EntryState::Pending
                && request_lane(&entry.request) == lane
                && !state.entries.values().any(|running| {
                    running.state == EntryState::Running
                        && running.request.repo_id == entry.request.repo_id
                })
        })
        .min_by_key(|(_, entry)| (priority_rank(&entry.request.priority), entry.sequence))
        .map(|(key, _)| key.clone())
}

fn priority_rank(priority: &str) -> usize {
    match priority {
        "high" => 0,
        "normal" => 1,
        _ => 2,
    }
}

fn next_sequence(state: &mut SchedulerState) -> u64 {
    state.next_sequence = state.next_sequence.wrapping_add(1);
    state.next_sequence
}

fn request_lane(request: &RepoRefreshRequest) -> RefreshLane {
    if request.mode == "remote" {
        RefreshLane::Remote
    } else {
        RefreshLane::Local
    }
}

fn refresh_key(request: &RepoRefreshRequest) -> String {
    format!("repo-{}:{}", request.mode, request.repo_id)
}

fn refresh_running_message(lane: RefreshLane) -> &'static str {
    match lane {
        RefreshLane::Local => "刷新仓库本地状态",
        RefreshLane::Remote => "检查仓库远端更新",
    }
}

fn refresh_success_message(lane: RefreshLane) -> &'static str {
    match lane {
        RefreshLane::Local => "仓库本地状态已更新",
        RefreshLane::Remote => "仓库远端状态已更新",
    }
}

fn normalize_request(mut request: RepoRefreshRequest) -> Result<RepoRefreshRequest, String> {
    request.repo_id = request.repo_id.trim().to_string();
    if request.repo_id.is_empty() {
        return Err("仓库 ID 不能为空".to_string());
    }
    if !matches!(request.mode.as_str(), "local" | "remote") {
        return Err("刷新模式必须是 local 或 remote".to_string());
    }
    if !matches!(request.priority.as_str(), "high" | "normal" | "low") {
        return Err("刷新优先级无效".to_string());
    }
    if !matches!(request.detail_scope.as_str(), "auto" | "summary" | "detail") {
        return Err("刷新详情范围无效".to_string());
    }
    request.trigger = request.trigger.trim().to_string();
    if request.trigger.is_empty() {
        return Err("刷新触发原因不能为空".to_string());
    }
    Ok(request)
}

fn merge_request(target: &mut RepoRefreshRequest, incoming: &RepoRefreshRequest) {
    if priority_rank(&incoming.priority) < priority_rank(&target.priority) {
        target.priority = incoming.priority.clone();
    }
    target.force |= incoming.force;
    target.include_commits |= incoming.include_commits;
    target.include_branches |= incoming.include_branches;
    if detail_scope_rank(&incoming.detail_scope) > detail_scope_rank(&target.detail_scope) {
        target.detail_scope = incoming.detail_scope.clone();
    }
    if incoming.force || incoming.trigger == "manual" {
        target.trigger = incoming.trigger.clone();
    }
}

fn merge_scheduled_entry(
    entry: &mut ScheduledRefresh,
    incoming: &RepoRefreshRequest,
    lane: RefreshLane,
) {
    match entry.state {
        EntryState::Pending => merge_request(&mut entry.request, incoming),
        EntryState::Running if lane == RefreshLane::Local || incoming.force => {
            let rerun = entry.rerun.get_or_insert_with(|| incoming.clone());
            merge_request(rerun, incoming);
        }
        EntryState::Running => {}
    }
}

fn detail_scope_rank(scope: &str) -> usize {
    match scope {
        "detail" => 2,
        "auto" => 1,
        _ => 0,
    }
}

fn remote_cache_is_fresh(app: &AppHandle, repo_id: &str) -> bool {
    let now = now_millis();
    load_startup_cache(app)
        .and_then(|cache| {
            cache
                .repos_by_id
                .get(repo_id)
                .and_then(|entry| entry.remote_checked_at)
        })
        .is_some_and(|checked_at| now.saturating_sub(checked_at) < REMOTE_CACHE_TTL_MS)
}

fn update_remote_backoff(state: &mut SchedulerState, repo_id: &str, success: bool) {
    if success {
        state.remote_backoff.remove(repo_id);
        return;
    }
    let backoff = state.remote_backoff.entry(repo_id.to_string()).or_default();
    backoff.failures = backoff.failures.saturating_add(1);
    let delay = REMOTE_BACKOFF_MS[(backoff.failures - 1).min(REMOTE_BACKOFF_MS.len() - 1)];
    backoff.retry_at = now_millis().saturating_add(delay);
}

fn record_skipped_remote_task(
    app: &AppHandle,
    request: &RepoRefreshRequest,
    message: &str,
) -> String {
    record_workspace_task_and_emit(
        app,
        "repoRemote",
        &request.priority,
        Some(request.repo_id.clone()),
        "success",
        Some(message.to_string()),
        false,
    )
    .id
}

pub fn workspace_enqueue_repo_refresh(
    app: AppHandle,
    request: RepoRefreshRequest,
) -> Result<String, String> {
    let request = normalize_request(request)?;
    repo_path_by_id(&app, &request.repo_id)?;
    let scheduler = scheduler();
    let key = refresh_key(&request);
    let lane = request_lane(&request);

    {
        let mut state = scheduler
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(entry) = state.entries.get_mut(&key) {
            merge_scheduled_entry(entry, &request, lane);
            return Ok(entry.task_id.clone());
        }

        if lane == RefreshLane::Remote && !request.force && request.trigger != "autoSync" {
            let manual = request.priority == "high" || request.trigger == "manual";
            if !manual && state.active_repo.as_deref() != Some(request.repo_id.as_str()) {
                drop(state);
                return Ok(record_skipped_remote_task(
                    &app,
                    &request,
                    "仓库未处于活动状态，未检查远端",
                ));
            }
        }
        if lane == RefreshLane::Remote && !request.force {
            if state
                .remote_backoff
                .get(&request.repo_id)
                .is_some_and(|backoff| backoff.retry_at > now_millis())
            {
                drop(state);
                return Ok(record_skipped_remote_task(
                    &app,
                    &request,
                    "远端检查处于失败退避期",
                ));
            }
        }
    }

    if lane == RefreshLane::Remote
        && !request.force
        && remote_cache_is_fresh(&app, &request.repo_id)
    {
        return Ok(record_skipped_remote_task(
            &app,
            &request,
            "远端状态缓存仍然有效",
        ));
    }

    let kind = if lane == RefreshLane::Remote {
        "repoRemote"
    } else {
        "repoStatus"
    };
    let mut state = scheduler
        .state
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if let Some(existing) = state.entries.get_mut(&key) {
        merge_scheduled_entry(existing, &request, lane);
        return Ok(existing.task_id.clone());
    }
    let task = record_workspace_task_and_emit(
        &app,
        kind,
        &request.priority,
        Some(request.repo_id.clone()),
        "pending",
        Some("等待后台刷新".to_string()),
        true,
    );
    let sequence = next_sequence(&mut state);
    state.entries.insert(
        key,
        ScheduledRefresh {
            app,
            request,
            task_id: task.id.clone(),
            state: EntryState::Pending,
            rerun: None,
            sequence,
        },
    );
    drop(state);
    scheduler.changed.notify_all();
    Ok(task.id)
}

pub fn workspace_set_active_repo(app: AppHandle, repo_id: Option<String>) -> Result<(), String> {
    let repo_id = repo_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(repo_id) = repo_id.as_deref() {
        repo_path_by_id(&app, repo_id)?;
    }
    let scheduler = scheduler();
    let cancelled = {
        let mut state = scheduler
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        state.active_repo = repo_id.clone();
        let keys: Vec<String> = state
            .entries
            .iter()
            .filter(|(_, entry)| {
                entry.state == EntryState::Pending
                    && request_lane(&entry.request) == RefreshLane::Remote
                    && entry.request.trigger != "autoSync"
                    && Some(entry.request.repo_id.as_str()) != repo_id.as_deref()
            })
            .map(|(key, _)| key.clone())
            .collect();
        keys.into_iter()
            .filter_map(|key| state.entries.remove(&key))
            .map(|entry| (entry.app, entry.task_id))
            .collect::<Vec<_>>()
    };
    for (task_app, task_id) in cancelled {
        update_workspace_task_and_emit(
            &task_app,
            &task_id,
            "cancelled",
            Some("已切换到其他仓库".to_string()),
            false,
        );
    }
    Ok(())
}

pub fn workspace_set_refresh_paused(paused: bool) -> Result<(), String> {
    let scheduler = scheduler();
    scheduler
        .state
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .local_paused = paused;
    if !paused {
        scheduler.changed.notify_all();
    }
    Ok(())
}

pub(crate) fn enqueue_watcher_repo_refresh(
    app: AppHandle,
    repo_id: String,
    git_metadata_changed: bool,
) -> String {
    workspace_enqueue_repo_refresh(
        app,
        RepoRefreshRequest {
            repo_id,
            mode: "local".to_string(),
            priority: "low".to_string(),
            force: false,
            detail_scope: "auto".to_string(),
            include_commits: git_metadata_changed,
            include_branches: git_metadata_changed,
            trigger: "watch".to_string(),
        },
    )
    .unwrap_or_default()
}

pub(crate) fn enqueue_uncertain_repo_refreshes<I>(app: AppHandle, repo_ids: I)
where
    I: IntoIterator<Item = String>,
{
    for repo_id in repo_ids {
        let _ = workspace_enqueue_repo_refresh(
            app.clone(),
            RepoRefreshRequest {
                repo_id,
                mode: "local".to_string(),
                priority: "low".to_string(),
                force: false,
                detail_scope: "auto".to_string(),
                include_commits: true,
                include_branches: true,
                trigger: "reconcile".to_string(),
            },
        );
    }
}

pub(crate) fn enqueue_baseline_repo_refreshes<I>(app: AppHandle, repo_ids: I)
where
    I: IntoIterator<Item = String>,
{
    enqueue_uncertain_repo_refreshes(app, repo_ids);
}

pub(crate) fn reset_refresh_scheduler() {
    let scheduler = scheduler();
    let cancelled = {
        let mut state = scheduler
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        state.active_repo = None;
        state.local_paused = false;
        state.remote_backoff.clear();
        state
            .entries
            .drain()
            .filter(|(_, entry)| entry.state == EntryState::Pending)
            .map(|(_, entry)| (entry.app, entry.task_id))
            .collect::<Vec<_>>()
    };
    for (app, task_id) in cancelled {
        update_workspace_task_and_emit(
            &app,
            &task_id,
            "cancelled",
            Some("工作区已切换".to_string()),
            false,
        );
    }
    scheduler.changed.notify_all();
}

pub(super) fn cancel_pending_refresh(task_id: &str) -> bool {
    let scheduler = scheduler();
    let mut state = scheduler
        .state
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    remove_pending_refresh(&mut state, task_id)
}

fn remove_pending_refresh(state: &mut SchedulerState, task_id: &str) -> bool {
    let key = state
        .entries
        .iter()
        .find(|(_, entry)| entry.task_id == task_id && entry.state == EntryState::Pending)
        .map(|(key, _)| key.clone());
    key.and_then(|key| state.entries.remove(&key)).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(repo_id: &str, mode: &str, priority: &str) -> RepoRefreshRequest {
        RepoRefreshRequest {
            repo_id: repo_id.to_string(),
            mode: mode.to_string(),
            priority: priority.to_string(),
            force: false,
            detail_scope: "summary".to_string(),
            include_commits: false,
            include_branches: false,
            trigger: "watch".to_string(),
        }
    }

    #[test]
    fn pending_refresh_selection_respects_lane_priority_and_fifo() {
        let app = AppHandle::new(Arc::new(crate::workspace::tests::NoopWorkspaceRuntime));
        let mut state = SchedulerState::default();
        for (sequence, item) in [
            request("low", "local", "low"),
            request("remote", "remote", "high"),
            request("normal-first", "local", "normal"),
            request("normal-second", "local", "normal"),
        ]
        .into_iter()
        .enumerate()
        {
            let key = refresh_key(&item);
            state.entries.insert(
                key,
                ScheduledRefresh {
                    app: app.clone(),
                    request: item,
                    task_id: format!("task-{sequence}"),
                    state: EntryState::Pending,
                    rerun: None,
                    sequence: sequence as u64,
                },
            );
        }
        assert_eq!(
            next_pending_key(&state, RefreshLane::Local).as_deref(),
            Some("repo-local:normal-first")
        );
        assert_eq!(
            next_pending_key(&state, RefreshLane::Remote).as_deref(),
            Some("repo-remote:remote")
        );
    }

    #[test]
    fn paused_local_lane_keeps_pending_work_until_resumed() {
        let app = AppHandle::new(Arc::new(crate::workspace::tests::NoopWorkspaceRuntime));
        let mut state = SchedulerState {
            local_paused: true,
            ..SchedulerState::default()
        };
        state.entries.insert(
            "repo-local:repo".to_string(),
            ScheduledRefresh {
                app,
                request: request("repo", "local", "low"),
                task_id: "task".to_string(),
                state: EntryState::Pending,
                rerun: None,
                sequence: 1,
            },
        );
        assert!(next_pending_key(&state, RefreshLane::Local).is_none());
        state.local_paused = false;
        assert_eq!(
            next_pending_key(&state, RefreshLane::Local).as_deref(),
            Some("repo-local:repo")
        );
    }

    #[test]
    fn pending_refresh_waits_for_the_other_lane_on_the_same_repo() {
        let app = AppHandle::new(Arc::new(crate::workspace::tests::NoopWorkspaceRuntime));
        let mut state = SchedulerState::default();
        for (item, task_id, entry_state, sequence) in [
            (
                request("shared", "remote", "normal"),
                "remote-running",
                EntryState::Running,
                0,
            ),
            (
                request("shared", "local", "high"),
                "local-blocked",
                EntryState::Pending,
                1,
            ),
            (
                request("other", "local", "low"),
                "local-other",
                EntryState::Pending,
                2,
            ),
        ] {
            state.entries.insert(
                refresh_key(&item),
                ScheduledRefresh {
                    app: app.clone(),
                    request: item,
                    task_id: task_id.to_string(),
                    state: entry_state,
                    rerun: None,
                    sequence,
                },
            );
        }

        assert_eq!(
            next_pending_key(&state, RefreshLane::Local).as_deref(),
            Some("repo-local:other")
        );
        state.entries.remove("repo-remote:shared");
        assert_eq!(
            next_pending_key(&state, RefreshLane::Local).as_deref(),
            Some("repo-local:shared")
        );
    }

    #[test]
    fn coalescing_promotes_priority_and_keeps_expensive_detail_flags() {
        let mut target = request("repo", "local", "low");
        target.detail_scope = "auto".to_string();
        let mut incoming = request("repo", "local", "high");
        incoming.detail_scope = "detail".to_string();
        incoming.include_commits = true;
        incoming.force = true;
        incoming.trigger = "manual".to_string();
        merge_request(&mut target, &incoming);
        assert_eq!(target.priority, "high");
        assert_eq!(target.detail_scope, "detail");
        assert!(target.include_commits);
        assert!(target.force);
        assert_eq!(target.trigger, "manual");
    }

    #[test]
    fn cancellation_removes_only_pending_refreshes() {
        let app = AppHandle::new(Arc::new(crate::workspace::tests::NoopWorkspaceRuntime));
        let mut state = SchedulerState::default();
        for (repo_id, task_id, entry_state) in [
            ("pending", "task-pending", EntryState::Pending),
            ("running", "task-running", EntryState::Running),
        ] {
            let item = request(repo_id, "local", "low");
            state.entries.insert(
                refresh_key(&item),
                ScheduledRefresh {
                    app: app.clone(),
                    request: item,
                    task_id: task_id.to_string(),
                    state: entry_state,
                    rerun: None,
                    sequence: 0,
                },
            );
        }
        assert!(remove_pending_refresh(&mut state, "task-pending"));
        assert!(!remove_pending_refresh(&mut state, "task-running"));
        assert!(state.entries.contains_key("repo-local:running"));
    }

    #[test]
    fn running_local_refresh_keeps_one_merged_rerun() {
        let app = AppHandle::new(Arc::new(crate::workspace::tests::NoopWorkspaceRuntime));
        let initial = request("repo", "local", "low");
        let mut entry = ScheduledRefresh {
            app,
            request: initial,
            task_id: "task".to_string(),
            state: EntryState::Running,
            rerun: None,
            sequence: 0,
        };
        let mut metadata = request("repo", "local", "normal");
        metadata.detail_scope = "auto".to_string();
        metadata.include_commits = true;
        merge_scheduled_entry(&mut entry, &metadata, RefreshLane::Local);

        let mut manual = request("repo", "local", "high");
        manual.detail_scope = "detail".to_string();
        manual.include_branches = true;
        merge_scheduled_entry(&mut entry, &manual, RefreshLane::Local);

        let rerun = entry.rerun.expect("running refresh should keep a rerun");
        assert_eq!(rerun.priority, "high");
        assert_eq!(rerun.detail_scope, "detail");
        assert!(rerun.include_commits);
        assert!(rerun.include_branches);
    }

    #[test]
    fn remote_backoff_uses_one_five_and_fifteen_minute_steps() {
        let mut state = SchedulerState::default();
        let start = now_millis();
        update_remote_backoff(&mut state, "repo", false);
        let first = state.remote_backoff["repo"].retry_at - start;
        update_remote_backoff(&mut state, "repo", false);
        let second = state.remote_backoff["repo"].retry_at - start;
        update_remote_backoff(&mut state, "repo", false);
        update_remote_backoff(&mut state, "repo", false);
        let fourth = state.remote_backoff["repo"].retry_at - start;
        assert!((REMOTE_BACKOFF_MS[0]..=REMOTE_BACKOFF_MS[0] + 100).contains(&first));
        assert!((REMOTE_BACKOFF_MS[1]..=REMOTE_BACKOFF_MS[1] + 100).contains(&second));
        assert!((REMOTE_BACKOFF_MS[2]..=REMOTE_BACKOFF_MS[2] + 100).contains(&fourth));
        update_remote_backoff(&mut state, "repo", true);
        assert!(!state.remote_backoff.contains_key("repo"));
    }
}

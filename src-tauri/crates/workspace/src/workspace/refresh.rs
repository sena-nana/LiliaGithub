use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::runtime::WorkspaceContext as AppHandle;
use crate::task_runtime::{ExecutionClass, TaskHandle, TaskSpec};
use crate::workspace::repo_guard::{with_repo_guard, RepoAccess};
use crate::workspace::repos::{git_common_dir, refresh_repo_for_scheduler};
use crate::workspace::settings::{
    load_settings, load_startup_cache, repo_path_by_id, workspace_context_identity,
    write_startup_repo_summary, write_startup_repo_summary_after_fetch,
};
use crate::workspace::shared::now_millis;
use crate::workspace::tasks::{record_workspace_task_and_emit, update_workspace_task_and_emit};
use lilia_github_contracts::workspace::{
    RepoRefreshDetailScope, RepoRefreshMode, RepoRefreshPriority, RepoRefreshRequest,
    RepoRefreshTrigger, RepoRefreshedEvent,
};
use serde::{Deserialize, Serialize};

const REPO_REFRESHED_EVENT: &str = "workspace://repo-refreshed";
const REMOTE_CACHE_TTL_MS: i64 = 10 * 60 * 1_000;
const ACTIVE_REMOTE_CACHE_TTL_MS: i64 = 60 * 1_000;
const REMOTE_BACKOFF_MS: [i64; 3] = [60 * 1_000, 5 * 60 * 1_000, 15 * 60 * 1_000];
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RefreshLane {
    Local,
    Remote,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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
    runtime_task_id: String,
    runtime_handle: Option<TaskHandle>,
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
    generation: u64,
}

#[derive(Default)]
pub(crate) struct RefreshRuntimeState {
    state: Mutex<SchedulerState>,
}

impl RefreshRuntimeState {
    fn reset(&self, message: &str) {
        let cancelled = {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            state.generation = state.generation.wrapping_add(1);
            state.active_repo = None;
            state.local_paused = false;
            state.remote_backoff.clear();
            state.entries.drain().map(|(_, entry)| entry).collect()
        };
        cancel_entries(cancelled, message);
    }

    pub(crate) fn shutdown(&self) {
        self.reset("应用已退出");
    }
}

fn scheduler(app: &AppHandle) -> &RefreshRuntimeState {
    app.refresh_runtime()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct RefreshPayload {
    key: String,
    generation: u64,
    run_id: String,
}

fn execute_runtime_task(
    app: AppHandle,
    lane: RefreshLane,
    payload: RefreshPayload,
) -> Result<(), String> {
    let Some((app, request, logical_task_id, include_detail)) = begin_run(&app, lane, &payload)
    else {
        return Ok(());
    };

    update_workspace_task_and_emit(
        &app,
        &logical_task_id,
        "running",
        Some(refresh_running_message(lane).to_string()),
        false,
    );
    let mut result = with_common_dir_guard(&app, &request.repo_id, lane, || {
        refresh_repo_for_scheduler(&app, &request, include_detail)
    });
    if let Ok(refresh) = &result {
        if let Err(error) = commit_refresh_result(&app, &payload, refresh) {
            result = Err(error);
        }
    }
    let failed = result.is_err();
    finish_run(lane, &payload, app, request, logical_task_id, result);
    if failed {
        Err("仓库刷新失败".to_string())
    } else {
        Ok(())
    }
}

fn begin_run(
    app: &AppHandle,
    lane: RefreshLane,
    payload: &RefreshPayload,
) -> Option<(AppHandle, RepoRefreshRequest, String, bool)> {
    let mut state = scheduler(app)
        .state
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if payload.generation != state.generation {
        return None;
    }
    let active_repo = state.active_repo.clone();
    let entry = state.entries.get_mut(&payload.key)?;
    if entry.runtime_task_id != payload.run_id || request_lane(&entry.request) != lane {
        return None;
    }
    entry.state = EntryState::Running;
    let include_detail = match entry.request.detail_scope {
        RepoRefreshDetailScope::Detail => true,
        RepoRefreshDetailScope::Summary => false,
        RepoRefreshDetailScope::Auto => {
            active_repo.as_deref() == Some(entry.request.repo_id.as_str())
        }
    };
    Some((
        entry.app.clone(),
        entry.request.clone(),
        entry.task_id.clone(),
        include_detail,
    ))
}

fn with_common_dir_guard<T>(
    app: &AppHandle,
    repo_id: &str,
    lane: RefreshLane,
    run: impl FnOnce() -> T,
) -> T {
    let key = repo_path_by_id(app, repo_id)
        .ok()
        .map(|path| git_common_dir(&path).unwrap_or(path))
        .unwrap_or_else(|| PathBuf::from(repo_id));
    let access = match lane {
        RefreshLane::Local => RepoAccess::Read,
        RefreshLane::Remote => RepoAccess::Write,
    };
    with_repo_guard(app, key, access, run)
}

type RefreshResult = Result<
    (
        lilia_github_contracts::workspace::RepoSummary,
        Option<lilia_github_contracts::workspace::RepoDetailPatch>,
        Option<i64>,
    ),
    String,
>;

fn commit_refresh_result(
    app: &AppHandle,
    payload: &RefreshPayload,
    refresh: &(
        lilia_github_contracts::workspace::RepoSummary,
        Option<lilia_github_contracts::workspace::RepoDetailPatch>,
        Option<i64>,
    ),
) -> Result<(), String> {
    let state = scheduler(app)
        .state
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let owns = payload.generation == state.generation
        && state
            .entries
            .get(&payload.key)
            .is_some_and(|entry| entry.runtime_task_id == payload.run_id);
    if !owns {
        return Err("工作区已切换，已丢弃刷新结果".to_string());
    }
    let settings = load_settings(app)?;
    if let Some(checked_at) = refresh.2 {
        write_startup_repo_summary_after_fetch(app, &settings, &refresh.0, checked_at)
    } else {
        write_startup_repo_summary(app, &settings, &refresh.0)
    }
}

fn finish_run(
    lane: RefreshLane,
    payload: &RefreshPayload,
    app: AppHandle,
    request: RepoRefreshRequest,
    task_id: String,
    result: RefreshResult,
) {
    let (workspace_id, context_revision) = workspace_context_identity(&app);
    let mut event =
        result.as_ref().ok().map(
            |(summary, detail_patch, remote_checked_at)| RepoRefreshedEvent {
                workspace_id: workspace_id.clone(),
                context_revision,
                repo_id: request.repo_id.clone(),
                mode: request.mode,
                summary: summary.clone(),
                detail_patch: detail_patch.clone(),
                remote_checked_at: *remote_checked_at,
            },
        );
    let rerun = {
        let mut state = scheduler(&app)
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let owns = payload.generation == state.generation
            && state
                .entries
                .get(&payload.key)
                .is_some_and(|entry| entry.runtime_task_id == payload.run_id);
        if !owns {
            return;
        }
        if lane == RefreshLane::Remote {
            update_remote_backoff(&mut state, &request.repo_id, result.is_ok());
        }
        if state.active_repo.as_deref() != Some(request.repo_id.as_str()) {
            if let Some(event) = event.as_mut() {
                event.detail_patch = None;
            }
        }
        let rerun = state
            .entries
            .get_mut(&payload.key)
            .and_then(|entry| entry.rerun.take());
        if rerun.is_none() {
            state.entries.remove(&payload.key);
        }
        rerun
    };
    if let Some(event) = event {
        let _ = app.emit(REPO_REFRESHED_EVENT, &event);
    }
    if let Some(next) = rerun {
        update_workspace_task_and_emit(
            &app,
            &task_id,
            "pending",
            Some("仓库发生了新的变化，等待再次刷新".to_string()),
            true,
        );
        if let Err(error) = schedule_rerun(&payload.key, app.clone(), next, &task_id) {
            update_workspace_task_and_emit(&app, &task_id, "error", Some(error), false);
        }
    } else {
        match result {
            Ok(_) => update_workspace_task_and_emit(
                &app,
                &task_id,
                "success",
                Some(refresh_success_message(lane).to_string()),
                false,
            ),
            Err(error) => {
                update_workspace_task_and_emit(&app, &task_id, "error", Some(error), false)
            }
        };
    }
}

fn schedule_rerun(
    key: &str,
    app: AppHandle,
    request: RepoRefreshRequest,
    task_id: &str,
) -> Result<(), String> {
    let (generation, run_id) = {
        let mut state = scheduler(&app)
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let generation = state.generation;
        let sequence = next_sequence(&mut state);
        let run_id = format!("{task_id}:refresh:{generation}:{sequence}");
        state.entries.insert(
            key.to_string(),
            ScheduledRefresh {
                app: app.clone(),
                request,
                task_id: task_id.to_string(),
                state: EntryState::Pending,
                rerun: None,
                runtime_task_id: run_id.clone(),
                runtime_handle: None,
            },
        );
        (generation, run_id)
    };
    if let Err(error) = submit_runtime_task(&app, key, generation, run_id.clone()) {
        if discard_failed_submission(&app, key, generation, &run_id) {
            return Err(error);
        }
    }
    Ok(())
}

fn submit_runtime_task(
    scheduler_app: &AppHandle,
    key: &str,
    generation: u64,
    run_id: String,
) -> Result<(), String> {
    let (app, task_spec, lane, payload) = {
        let state = scheduler(scheduler_app)
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let entry = state
            .entries
            .get(key)
            .ok_or_else(|| "刷新任务已失效".to_string())?;
        let payload = RefreshPayload {
            key: key.to_string(),
            generation,
            run_id: run_id.clone(),
        };
        let execution_class = match request_lane(&entry.request) {
            RefreshLane::Local => ExecutionClass::Blocking,
            RefreshLane::Remote => ExecutionClass::Io,
        };
        let task_spec = TaskSpec::new(
            run_id.clone(),
            refresh_priority(entry.request.priority),
            execution_class,
        );
        (
            entry.app.clone(),
            task_spec,
            request_lane(&entry.request),
            payload,
        )
    };
    let task_app = app.clone();
    let job = Box::new(move |_| execute_runtime_task(task_app, lane, payload));
    let handle = app.submit_task(task_spec, job)?;
    let mut state = scheduler(scheduler_app)
        .state
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let current_generation = state.generation == generation;
    if let Some(entry) = state.entries.get_mut(key) {
        if current_generation && entry.runtime_task_id == run_id {
            entry.runtime_handle = Some(handle);
        }
    }
    Ok(())
}

fn discard_failed_submission(app: &AppHandle, key: &str, generation: u64, run_id: &str) -> bool {
    let mut state = scheduler(app)
        .state
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let owns = state.generation == generation
        && state
            .entries
            .get(key)
            .is_some_and(|entry| entry.runtime_task_id == run_id);
    if owns {
        state.entries.remove(key);
    }
    owns
}

fn refresh_priority(priority: RepoRefreshPriority) -> i64 {
    match priority {
        RepoRefreshPriority::High => 100,
        RepoRefreshPriority::Normal => 0,
        RepoRefreshPriority::Low => -100,
    }
}

fn priority_rank(priority: RepoRefreshPriority) -> usize {
    match priority {
        RepoRefreshPriority::High => 0,
        RepoRefreshPriority::Normal => 1,
        RepoRefreshPriority::Low => 2,
    }
}

fn next_sequence(state: &mut SchedulerState) -> u64 {
    state.next_sequence = state.next_sequence.wrapping_add(1);
    state.next_sequence
}

fn request_lane(request: &RepoRefreshRequest) -> RefreshLane {
    match request.mode {
        RepoRefreshMode::Local => RefreshLane::Local,
        RepoRefreshMode::Remote => RefreshLane::Remote,
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
    Ok(request)
}

fn merge_request(target: &mut RepoRefreshRequest, incoming: &RepoRefreshRequest) {
    if priority_rank(incoming.priority) < priority_rank(target.priority) {
        target.priority = incoming.priority;
    }
    target.force |= incoming.force;
    target.include_commits |= incoming.include_commits;
    target.include_branches |= incoming.include_branches;
    if detail_scope_rank(incoming.detail_scope) > detail_scope_rank(target.detail_scope) {
        target.detail_scope = incoming.detail_scope;
    }
    if incoming.force || incoming.trigger == RepoRefreshTrigger::Manual {
        target.trigger = incoming.trigger;
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

enum ExistingMerge {
    Merged(String),
    Resubmit {
        app: AppHandle,
        key: String,
        task_id: String,
        generation: u64,
        run_id: String,
        previous_handle: Option<TaskHandle>,
    },
}

fn merge_existing_refresh(
    state: &mut SchedulerState,
    key: &str,
    incoming: &RepoRefreshRequest,
    lane: RefreshLane,
) -> Option<ExistingMerge> {
    let promoted = state.entries.get(key).is_some_and(|entry| {
        entry.state == EntryState::Pending
            && priority_rank(incoming.priority) < priority_rank(entry.request.priority)
    });
    let sequence = promoted.then(|| next_sequence(state));
    let generation = state.generation;
    let entry = state.entries.get_mut(key)?;
    merge_scheduled_entry(entry, incoming, lane);
    let Some(sequence) = sequence else {
        return Some(ExistingMerge::Merged(entry.task_id.clone()));
    };
    let run_id = format!("{}:refresh:{generation}:{sequence}", entry.task_id);
    entry.runtime_task_id = run_id.clone();
    Some(ExistingMerge::Resubmit {
        app: entry.app.clone(),
        key: key.to_string(),
        task_id: entry.task_id.clone(),
        generation,
        run_id,
        previous_handle: entry.runtime_handle.take(),
    })
}

fn finish_existing_merge(merged: ExistingMerge) -> Result<String, String> {
    match merged {
        ExistingMerge::Merged(task_id) => Ok(task_id),
        ExistingMerge::Resubmit {
            app,
            key,
            task_id,
            generation,
            run_id,
            previous_handle,
        } => {
            if let Some(handle) = previous_handle {
                let _ = app.cancel_task(&handle);
            }
            if let Err(error) = submit_runtime_task(&app, &key, generation, run_id.clone()) {
                if discard_failed_submission(&app, &key, generation, &run_id) {
                    update_workspace_task_and_emit(
                        &app,
                        &task_id,
                        "error",
                        Some(error.clone()),
                        false,
                    );
                    return Err(error);
                }
            }
            Ok(task_id)
        }
    }
}

fn detail_scope_rank(scope: RepoRefreshDetailScope) -> usize {
    match scope {
        RepoRefreshDetailScope::Detail => 2,
        RepoRefreshDetailScope::Auto => 1,
        RepoRefreshDetailScope::Summary => 0,
    }
}

fn remote_cache_is_fresh(app: &AppHandle, request: &RepoRefreshRequest) -> Result<bool, String> {
    let now = now_millis();
    let ttl = if request.trigger == RepoRefreshTrigger::ActiveRepo {
        ACTIVE_REMOTE_CACHE_TTL_MS
    } else {
        REMOTE_CACHE_TTL_MS
    };
    Ok(load_startup_cache(app)?
        .and_then(|cache| {
            cache
                .repos_by_id
                .get(&request.repo_id)
                .and_then(|entry| entry.remote_checked_at)
        })
        .is_some_and(|checked_at| now.saturating_sub(checked_at) < ttl))
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
        request.priority.as_str(),
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
    let key = refresh_key(&request);
    let lane = request_lane(&request);
    let existing = {
        let mut state = scheduler(&app)
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let existing = merge_existing_refresh(&mut state, &key, &request, lane);
        if existing.is_none()
            && lane == RefreshLane::Remote
            && !request.force
            && request.trigger != RepoRefreshTrigger::AutoSync
        {
            let manual = request.priority == RepoRefreshPriority::High
                || request.trigger == RepoRefreshTrigger::Manual;
            if !manual && state.active_repo.as_deref() != Some(request.repo_id.as_str()) {
                drop(state);
                return Ok(record_skipped_remote_task(
                    &app,
                    &request,
                    "仓库未处于活动状态，未检查远端",
                ));
            }
        }
        if existing.is_none()
            && lane == RefreshLane::Remote
            && !request.force
            && state
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
        existing
    };
    if let Some(existing) = existing {
        return finish_existing_merge(existing);
    }
    if lane == RefreshLane::Remote && !request.force && remote_cache_is_fresh(&app, &request)? {
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
    let (task, generation, run_id) = {
        let mut state = scheduler(&app)
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(existing) = merge_existing_refresh(&mut state, &key, &request, lane) {
            drop(state);
            return finish_existing_merge(existing);
        }
        let task = record_workspace_task_and_emit(
            &app,
            kind,
            request.priority.as_str(),
            Some(request.repo_id.clone()),
            "pending",
            Some("等待后台刷新".to_string()),
            true,
        );
        let generation = state.generation;
        let sequence = next_sequence(&mut state);
        let run_id = format!("{}:refresh:{generation}:{sequence}", task.id);
        state.entries.insert(
            key.clone(),
            ScheduledRefresh {
                app: app.clone(),
                request,
                task_id: task.id.clone(),
                state: EntryState::Pending,
                rerun: None,
                runtime_task_id: run_id.clone(),
                runtime_handle: None,
            },
        );
        (task, generation, run_id)
    };
    if let Err(error) = submit_runtime_task(&app, &key, generation, run_id.clone()) {
        if discard_failed_submission(&app, &key, generation, &run_id) {
            update_workspace_task_and_emit(&app, &task.id, "error", Some(error.clone()), false);
            return Err(error);
        }
    }
    Ok(task.id)
}

pub fn workspace_set_active_repo(app: AppHandle, repo_id: Option<String>) -> Result<(), String> {
    let repo_id = repo_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(repo_id) = repo_id.as_deref() {
        repo_path_by_id(&app, repo_id)?;
    }
    let cancelled = {
        let mut state = scheduler(&app)
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        state.active_repo = repo_id.clone();
        let keys = state
            .entries
            .iter()
            .filter(|(_, entry)| {
                entry.state == EntryState::Pending
                    && request_lane(&entry.request) == RefreshLane::Remote
                    && entry.request.trigger != RepoRefreshTrigger::AutoSync
                    && Some(entry.request.repo_id.as_str()) != repo_id.as_deref()
            })
            .map(|(key, _)| key.clone())
            .collect::<Vec<_>>();
        keys.into_iter()
            .filter_map(|key| state.entries.remove(&key))
            .collect::<Vec<_>>()
    };
    cancel_entries(cancelled, "已切换到其他仓库");
    Ok(())
}

pub fn workspace_set_refresh_paused(app: AppHandle, paused: bool) -> Result<(), String> {
    scheduler(&app)
        .state
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .local_paused = paused;
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
            mode: RepoRefreshMode::Local,
            priority: RepoRefreshPriority::Low,
            force: false,
            detail_scope: RepoRefreshDetailScope::Auto,
            include_commits: git_metadata_changed,
            include_branches: git_metadata_changed,
            trigger: RepoRefreshTrigger::Watch,
        },
    )
    .unwrap_or_default()
}

pub(crate) fn enqueue_uncertain_repo_refreshes<I: IntoIterator<Item = String>>(
    app: AppHandle,
    repo_ids: I,
) {
    for repo_id in repo_ids {
        let _ = workspace_enqueue_repo_refresh(
            app.clone(),
            RepoRefreshRequest {
                repo_id,
                mode: RepoRefreshMode::Local,
                priority: RepoRefreshPriority::Low,
                force: false,
                detail_scope: RepoRefreshDetailScope::Auto,
                include_commits: true,
                include_branches: true,
                trigger: RepoRefreshTrigger::Reconcile,
            },
        );
    }
}

pub(crate) fn enqueue_baseline_repo_refreshes<I: IntoIterator<Item = String>>(
    app: AppHandle,
    repo_ids: I,
) {
    enqueue_uncertain_repo_refreshes(app, repo_ids);
}

pub(crate) fn reset_refresh_scheduler(app: &AppHandle) {
    scheduler(app).reset("工作区已切换");
}

fn cancel_entries(entries: Vec<ScheduledRefresh>, message: &str) {
    for entry in entries {
        if entry.state == EntryState::Pending {
            if let Some(handle) = entry.runtime_handle {
                let _ = entry.app.cancel_task(&handle);
            }
        }
        update_workspace_task_and_emit(
            &entry.app,
            &entry.task_id,
            "cancelled",
            Some(message.to_string()),
            false,
        );
    }
}

pub(super) fn cancel_pending_refresh(app: &AppHandle, task_id: &str) -> bool {
    let entry = {
        let mut state = scheduler(app)
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let key = state
            .entries
            .iter()
            .find(|(_, entry)| entry.task_id == task_id && entry.state == EntryState::Pending)
            .map(|(key, _)| key.clone());
        key.and_then(|key| state.entries.remove(&key))
    };
    if let Some(entry) = entry {
        if let Some(handle) = entry.runtime_handle {
            let _ = entry.app.cancel_task(&handle);
        }
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(repo_id: &str, mode: &str, priority: &str) -> RepoRefreshRequest {
        RepoRefreshRequest {
            repo_id: repo_id.into(),
            mode: match mode {
                "remote" => RepoRefreshMode::Remote,
                _ => RepoRefreshMode::Local,
            },
            priority: match priority {
                "high" => RepoRefreshPriority::High,
                "normal" => RepoRefreshPriority::Normal,
                _ => RepoRefreshPriority::Low,
            },
            force: false,
            detail_scope: RepoRefreshDetailScope::Summary,
            include_commits: false,
            include_branches: false,
            trigger: RepoRefreshTrigger::Watch,
        }
    }

    #[test]
    fn refresh_tasks_use_the_expected_tokio_execution_classes() {
        assert_eq!(
            request_lane(&request("repo", "local", "normal")),
            RefreshLane::Local
        );
        assert_eq!(
            request_lane(&request("repo", "remote", "normal")),
            RefreshLane::Remote
        );
        assert_eq!(
            match request_lane(&request("repo", "local", "normal")) {
                RefreshLane::Local => ExecutionClass::Blocking,
                RefreshLane::Remote => ExecutionClass::Io,
            },
            ExecutionClass::Blocking
        );
        assert_eq!(
            match request_lane(&request("repo", "remote", "normal")) {
                RefreshLane::Local => ExecutionClass::Blocking,
                RefreshLane::Remote => ExecutionClass::Io,
            },
            ExecutionClass::Io
        );
        assert_eq!(refresh_priority(RepoRefreshPriority::High), 100);
        assert_eq!(refresh_priority(RepoRefreshPriority::Normal), 0);
        assert_eq!(refresh_priority(RepoRefreshPriority::Low), -100);
        assert_eq!(crate::task_runtime::TASK_QUEUE_CAPACITY, 64);
    }

    #[test]
    fn coalescing_promotes_priority_and_preserves_expensive_flags() {
        let mut target = request("repo", "local", "low");
        let mut incoming = request("repo", "local", "high");
        incoming.detail_scope = RepoRefreshDetailScope::Detail;
        incoming.include_commits = true;
        incoming.include_branches = true;
        merge_request(&mut target, &incoming);
        assert_eq!(target.priority, RepoRefreshPriority::High);
        assert_eq!(target.detail_scope, RepoRefreshDetailScope::Detail);
        assert!(target.include_commits && target.include_branches);
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
    }
}

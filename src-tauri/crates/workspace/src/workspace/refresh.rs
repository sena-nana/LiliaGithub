use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::repo_guard::{repo_resource_id, with_repo_guard, RepoAccess};
use crate::workspace::repos::{git_common_dir, refresh_repo_for_scheduler, repo_common_dir_by_id};
use crate::workspace::settings::{
    load_settings, load_startup_cache, repo_path_by_id, write_startup_repo_summary,
    write_startup_repo_summary_after_fetch,
};
use crate::workspace::shared::now_millis;
use crate::workspace::tasks::{record_workspace_task_and_emit, update_workspace_task_and_emit};
use lilia_github_contracts::workspace::{RepoRefreshRequest, RepoRefreshedEvent};
use mutsuki_runtime_contracts::{
    CompletionBatch, EntryCompletion, ExecutionClass, OrderingRequirement, ResourceAccessMode,
    ResourceRequirement, RunnerBatchCapability, RunnerDescriptor, RunnerMode, RunnerPurity,
    RunnerResult, RunnerSideEffect, RunnerStatus, Task, TaskHandle, WorkBatch,
};
use mutsuki_runtime_core::{Runner, RunnerContext, RuntimeResult};
use mutsuki_runtime_host::{
    DefaultScheduler, HostRuntimeConfig, RunnerLimits, ScheduleInput, SchedulerPolicy,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

const REPO_REFRESHED_EVENT: &str = "workspace://repo-refreshed";
const REMOTE_CACHE_TTL_MS: i64 = 10 * 60 * 1_000;
const REMOTE_BACKOFF_MS: [i64; 3] = [60 * 1_000, 5 * 60 * 1_000, 15 * 60 * 1_000];
pub const LOCAL_REFRESH_PROTOCOL: &str = "lilia.github.repo.refresh.local.v1";
pub const REMOTE_REFRESH_PROTOCOL: &str = "lilia.github.repo.refresh.remote.v1";

#[derive(Debug)]
struct RefreshSchedulerPolicy;

impl SchedulerPolicy for RefreshSchedulerPolicy {
    fn decide(
        &self,
        input: &ScheduleInput<'_>,
    ) -> RuntimeResult<mutsuki_runtime_core::ScheduleDecision> {
        if input.runner.runner_id == LOCAL_REFRESH_PROTOCOL
            && scheduler()
                .state
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .local_paused
        {
            return Ok(mutsuki_runtime_core::ScheduleDecision::new(
                DefaultScheduler::POLICY_ID,
                0,
                "local.paused",
            ));
        }
        DefaultScheduler.decide(input)
    }
}

pub fn refresh_runtime_config() -> HostRuntimeConfig {
    let mut config = HostRuntimeConfig {
        blocking_threads: 4,
        scheduler_policy: Arc::new(RefreshSchedulerPolicy),
        ..HostRuntimeConfig::default()
    };
    config.runner_limits.insert(
        LOCAL_REFRESH_PROTOCOL.into(),
        RunnerLimits {
            max_running: 4,
            max_inflight: 4,
            ..RunnerLimits::default()
        },
    );
    config.runner_limits.insert(
        REMOTE_REFRESH_PROTOCOL.into(),
        RunnerLimits {
            max_running: 1,
            max_inflight: 1,
            ..RunnerLimits::default()
        },
    );
    for kind in [
        crate::workspace::operations::OperationKind::LocalRead,
        crate::workspace::operations::OperationKind::LocalWrite,
        crate::workspace::operations::OperationKind::GitHubRead,
        crate::workspace::operations::OperationKind::GitHubWrite,
        crate::workspace::operations::OperationKind::GitHubTransfer,
        crate::workspace::operations::OperationKind::WorkspaceAnalysis,
        crate::workspace::operations::OperationKind::Bulk,
        crate::workspace::operations::OperationKind::LaunchControl,
    ] {
        let concurrency = kind.concurrency();
        config.runner_limits.insert(
            kind.protocol().into(),
            RunnerLimits {
                max_running: concurrency,
                max_inflight: concurrency,
                ..RunnerLimits::default()
            },
        );
    }
    config
}

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
struct RefreshScheduler {
    state: Mutex<SchedulerState>,
}

fn scheduler() -> &'static RefreshScheduler {
    static SCHEDULER: OnceLock<RefreshScheduler> = OnceLock::new();
    SCHEDULER.get_or_init(RefreshScheduler::default)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct RefreshPayload {
    key: String,
    generation: u64,
    run_id: String,
}

pub fn repo_refresh_runners() -> Vec<Box<dyn Runner>> {
    vec![
        Box::new(RepoRefreshRunner::new(RefreshLane::Local)),
        Box::new(RepoRefreshRunner::new(RefreshLane::Remote)),
    ]
}

struct RepoRefreshRunner {
    lane: RefreshLane,
    descriptor: RunnerDescriptor,
}

impl RepoRefreshRunner {
    fn new(lane: RefreshLane) -> Self {
        let (runner_id, protocol_id, max_entries) = match lane {
            RefreshLane::Local => (LOCAL_REFRESH_PROTOCOL, LOCAL_REFRESH_PROTOCOL, 4),
            RefreshLane::Remote => (REMOTE_REFRESH_PROTOCOL, REMOTE_REFRESH_PROTOCOL, 1),
        };
        Self {
            lane,
            descriptor: RunnerDescriptor {
                runner_id: runner_id.into(),
                plugin_id: "lilia.github.repo.refresh".into(),
                plugin_generation: 1,
                accepted_protocol_ids: vec![protocol_id.into()],
                purity: RunnerPurity::Pure,
                execution_class: ExecutionClass::Blocking,
                input_schema: json!({ "type": "object" }),
                output_schema: json!({ "type": "object" }),
                batch: RunnerBatchCapability {
                    mode: RunnerMode::NativeBatch,
                    preferred_batch_size: max_entries,
                    max_batch_entries: max_entries,
                    max_entry_concurrency: max_entries,
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
                contract_surfaces: vec![format!("task_protocol:{protocol_id}")],
            },
        }
    }
}

impl Runner for RepoRefreshRunner {
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
        let lane = self.lane;
        let mut by_id = std::thread::scope(|scope| {
            tasks
                .into_iter()
                .map(|task| {
                    let task_id = task.task_id.clone();
                    let worker = scope
                        .spawn(move || (task.task_id.clone(), execute_runtime_task(lane, task)));
                    (task_id, worker)
                })
                .collect::<Vec<_>>()
                .into_iter()
                .map(|(task_id, worker)| {
                    worker.join().unwrap_or_else(|_| {
                        let mut result = RunnerResult::completed(task_id.clone());
                        result.status = RunnerStatus::Failed;
                        (task_id, result)
                    })
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
                    result: Some(by_id.remove(&entry.task_id).unwrap_or_else(|| {
                        let mut result = RunnerResult::completed(entry.task_id.clone());
                        result.status = RunnerStatus::Failed;
                        result
                    })),
                    error: None,
                })
                .collect(),
        ))
    }
}

fn execute_runtime_task(lane: RefreshLane, task: Task) -> RunnerResult {
    let Ok(payload) = serde_json::from_value::<RefreshPayload>(task.payload) else {
        let mut result = RunnerResult::completed(task.task_id);
        result.status = RunnerStatus::Failed;
        return result;
    };
    let Some((app, request, logical_task_id, include_detail)) = begin_run(lane, &payload) else {
        return RunnerResult::completed(task.task_id);
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
    let mut outcome = RunnerResult::completed(task.task_id);
    if failed {
        outcome.status = RunnerStatus::Failed;
    }
    outcome
}

fn begin_run(
    lane: RefreshLane,
    payload: &RefreshPayload,
) -> Option<(AppHandle, RepoRefreshRequest, String, bool)> {
    let mut state = scheduler()
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
    let include_detail = match entry.request.detail_scope.as_str() {
        "detail" => true,
        "summary" => false,
        _ => active_repo.as_deref() == Some(entry.request.repo_id.as_str()),
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
    with_repo_guard(key, access, run)
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
    let state = scheduler()
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
    let settings = load_settings(app);
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
    let mut event =
        result.as_ref().ok().map(
            |(summary, detail_patch, remote_checked_at)| RepoRefreshedEvent {
                repo_id: request.repo_id.clone(),
                mode: request.mode.clone(),
                summary: summary.clone(),
                detail_patch: detail_patch.clone(),
                remote_checked_at: *remote_checked_at,
            },
        );
    let rerun = {
        let mut state = scheduler()
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
        let mut state = scheduler()
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let generation = state.generation;
        let sequence = next_sequence(&mut state);
        let run_id = format!("{task_id}:refresh:{generation}:{sequence}");
        state.entries.insert(
            key.to_string(),
            ScheduledRefresh {
                app,
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
    if let Err(error) = submit_runtime_task(key, generation, run_id.clone()) {
        if discard_failed_submission(key, generation, &run_id) {
            return Err(error);
        }
    }
    Ok(())
}

fn submit_runtime_task(key: &str, generation: u64, run_id: String) -> Result<(), String> {
    let (app, mut task, repo_id, lane) = {
        let state = scheduler()
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let entry = state
            .entries
            .get(key)
            .ok_or_else(|| "刷新任务已失效".to_string())?;
        let protocol = match request_lane(&entry.request) {
            RefreshLane::Local => LOCAL_REFRESH_PROTOCOL,
            RefreshLane::Remote => REMOTE_REFRESH_PROTOCOL,
        };
        let payload = serde_json::to_value(RefreshPayload {
            key: key.to_string(),
            generation,
            run_id: run_id.clone(),
        })
        .map_err(|error| error.to_string())?;
        let mut task = Task::new(run_id.clone(), protocol, payload);
        task.priority = mutsuki_priority(&entry.request.priority);
        task.runner_hint = Some(protocol.to_string());
        task.correlation_id = Some(entry.task_id.clone());
        (
            entry.app.clone(),
            task,
            entry.request.repo_id.clone(),
            request_lane(&entry.request),
        )
    };
    let common_dir = repo_common_dir_by_id(&app, &repo_id)?;
    let (resource_requirements, ordering) = refresh_resource_requirements(lane, common_dir);
    task.idempotency_key = Some(run_id.clone());
    task.resource_requirements = resource_requirements;
    task.ordering = ordering;
    let handle = app.submit_mutsuki_task(task)?;
    let mut state = scheduler()
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

fn refresh_resource_requirements(
    lane: RefreshLane,
    common_dir: PathBuf,
) -> (Vec<ResourceRequirement>, OrderingRequirement) {
    let resource_id = repo_resource_id(common_dir);
    (
        vec![ResourceRequirement {
            ref_id: resource_id.clone(),
            mode: match lane {
                RefreshLane::Local => ResourceAccessMode::Read,
                RefreshLane::Remote => ResourceAccessMode::ExclusiveWrite,
            },
            expected_version: None,
        }],
        OrderingRequirement::SameResourceOrder {
            ref_id: resource_id,
        },
    )
}

fn discard_failed_submission(key: &str, generation: u64, run_id: &str) -> bool {
    let mut state = scheduler()
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

fn mutsuki_priority(priority: &str) -> i64 {
    match priority {
        "high" => 100,
        "normal" => 0,
        _ => -100,
    }
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
            && priority_rank(&incoming.priority) < priority_rank(&entry.request.priority)
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
                let _ = app.cancel_mutsuki_task(handle);
            }
            if let Err(error) = submit_runtime_task(&key, generation, run_id.clone()) {
                if discard_failed_submission(&key, generation, &run_id) {
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
    let key = refresh_key(&request);
    let lane = request_lane(&request);
    let existing = {
        let mut state = scheduler()
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let existing = merge_existing_refresh(&mut state, &key, &request, lane);
        if existing.is_none()
            && lane == RefreshLane::Remote
            && !request.force
            && request.trigger != "autoSync"
        {
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
    let (task, generation, run_id) = {
        let mut state = scheduler()
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
            &request.priority,
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
    if let Err(error) = submit_runtime_task(&key, generation, run_id.clone()) {
        if discard_failed_submission(&key, generation, &run_id) {
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
        let mut state = scheduler()
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
                    && entry.request.trigger != "autoSync"
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

pub fn workspace_set_refresh_paused(paused: bool) -> Result<(), String> {
    scheduler()
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
            mode: "local".into(),
            priority: "low".into(),
            force: false,
            detail_scope: "auto".into(),
            include_commits: git_metadata_changed,
            include_branches: git_metadata_changed,
            trigger: "watch".into(),
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
                mode: "local".into(),
                priority: "low".into(),
                force: false,
                detail_scope: "auto".into(),
                include_commits: true,
                include_branches: true,
                trigger: "reconcile".into(),
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

pub(crate) fn reset_refresh_scheduler() {
    let cancelled = {
        let mut state = scheduler()
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        state.generation = state.generation.wrapping_add(1);
        state.active_repo = None;
        state.local_paused = false;
        state.remote_backoff.clear();
        state
            .entries
            .drain()
            .collect::<Vec<_>>()
            .into_iter()
            .map(|(_, entry)| entry)
            .collect()
    };
    cancel_entries(cancelled, "工作区已切换");
}

fn cancel_entries(entries: Vec<ScheduledRefresh>, message: &str) {
    for entry in entries {
        if entry.state == EntryState::Pending {
            if let Some(handle) = entry.runtime_handle {
                let _ = entry.app.cancel_mutsuki_task(handle);
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

pub(super) fn cancel_pending_refresh(task_id: &str) -> bool {
    let entry = {
        let mut state = scheduler()
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
            let _ = entry.app.cancel_mutsuki_task(handle);
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
            mode: mode.into(),
            priority: priority.into(),
            force: false,
            detail_scope: "summary".into(),
            include_commits: false,
            include_branches: false,
            trigger: "watch".into(),
        }
    }

    #[test]
    fn runners_expose_local_four_remote_one_blocking_capacity() {
        let runners = repo_refresh_runners();
        assert_eq!(
            runners[0].descriptor().execution_class,
            ExecutionClass::Blocking
        );
        assert_eq!(runners[0].descriptor().batch.max_entry_concurrency, 4);
        assert_eq!(runners[1].descriptor().batch.max_entry_concurrency, 1);
        let config = refresh_runtime_config();
        assert_eq!(config.blocking_threads, 4);
        assert_eq!(config.runner_limits[LOCAL_REFRESH_PROTOCOL].max_running, 4);
        assert_eq!(config.runner_limits[REMOTE_REFRESH_PROTOCOL].max_running, 1);
        for (kind, expected) in [
            (crate::workspace::operations::OperationKind::LocalRead, 4),
            (crate::workspace::operations::OperationKind::LocalWrite, 2),
            (crate::workspace::operations::OperationKind::GitHubRead, 4),
            (crate::workspace::operations::OperationKind::GitHubWrite, 2),
            (
                crate::workspace::operations::OperationKind::GitHubTransfer,
                2,
            ),
            (
                crate::workspace::operations::OperationKind::WorkspaceAnalysis,
                2,
            ),
            (crate::workspace::operations::OperationKind::Bulk, 4),
            (
                crate::workspace::operations::OperationKind::LaunchControl,
                2,
            ),
        ] {
            assert_eq!(config.runner_limits[kind.protocol()].max_running, expected);
            assert_eq!(config.runner_limits[kind.protocol()].max_inflight, expected);
        }
    }

    #[test]
    fn remote_refresh_exclusively_orders_the_common_dir_resource() {
        let common_dir = PathBuf::from("shared-repo");
        let (local_resources, local_ordering) =
            refresh_resource_requirements(RefreshLane::Local, common_dir.clone());
        let (remote_resources, remote_ordering) =
            refresh_resource_requirements(RefreshLane::Remote, common_dir);

        assert_eq!(local_resources[0].mode, ResourceAccessMode::Read);
        assert_eq!(remote_resources[0].mode, ResourceAccessMode::ExclusiveWrite);
        assert_eq!(local_resources[0].ref_id, remote_resources[0].ref_id);
        assert_eq!(
            local_ordering,
            OrderingRequirement::SameResourceOrder {
                ref_id: local_resources[0].ref_id.clone()
            }
        );
        assert_eq!(
            remote_ordering,
            OrderingRequirement::SameResourceOrder {
                ref_id: remote_resources[0].ref_id.clone()
            }
        );
    }

    #[test]
    fn coalescing_promotes_priority_and_preserves_expensive_flags() {
        let mut target = request("repo", "local", "low");
        let mut incoming = request("repo", "local", "high");
        incoming.detail_scope = "detail".into();
        incoming.include_commits = true;
        incoming.include_branches = true;
        merge_request(&mut target, &incoming);
        assert_eq!(target.priority, "high");
        assert_eq!(target.detail_scope, "detail");
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

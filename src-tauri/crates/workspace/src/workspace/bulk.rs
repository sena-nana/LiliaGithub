use std::path::{Path, PathBuf};

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::operations::{
    cancel_pending_operations, run_operation, submit_operation, OperationKind, OperationSpec,
    OperationTicket,
};
use crate::workspace::repo_guard::{repo_resource_id, with_repo_guard, RepoAccess};
use crate::workspace::repos::{
    current_branch_upstream, git_command, git_common_dir, prepare_pull_local_changes,
    remember_repo_uses_system_git, repo_conflicts, repo_uses_system_git,
    restore_pull_local_changes, restore_pull_local_changes_after_error, run_fetch, run_pull,
    run_push, run_system_git_push, summarize_repo,
};
use crate::workspace::settings::{repo_path_by_id, workspace_root};
use crate::workspace::tasks::{
    finish_workspace_task, mark_workspace_task_running, record_pending_operation_task,
    register_pending_task_cancellation,
};
use lilia_github_contracts::workspace::{
    BulkSyncPreview, BulkSyncRepo, BulkSyncResult, RepoPullLocalChangesMode, RepoSummary,
};
use mutsuki_runtime_contracts::{DispatchLane, ResourceAccessMode};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BulkSyncTrigger {
    Manual,
    SyncAll,
    AutoSync,
}

impl BulkSyncTrigger {
    fn parse(value: Option<&str>) -> Result<Self, String> {
        match value.unwrap_or("manual") {
            "manual" => Ok(Self::Manual),
            "syncAll" => Ok(Self::SyncAll),
            "autoSync" => Ok(Self::AutoSync),
            _ => Err("无效的批量同步触发来源".to_string()),
        }
    }

    fn title(self, operation: &str) -> &'static str {
        match self {
            Self::SyncAll => "同步全部仓库",
            Self::AutoSync => "自动同步仓库",
            Self::Manual if operation == "pull" => "批量拉取仓库",
            Self::Manual if operation == "push" => "批量推送仓库",
            Self::Manual => "批量同步仓库",
        }
    }

    fn priority(self) -> &'static str {
        match self {
            Self::AutoSync => "normal",
            Self::Manual | Self::SyncAll => "high",
        }
    }

    fn core_priority(self) -> i64 {
        match self {
            Self::Manual => 100,
            Self::SyncAll => 50,
            Self::AutoSync => -50,
        }
    }

    fn lane(self) -> DispatchLane {
        match self {
            Self::AutoSync => DispatchLane::Background,
            Self::Manual | Self::SyncAll => DispatchLane::Bulk,
        }
    }
}

pub(super) fn repo_dirty_count(summary: &RepoSummary) -> usize {
    summary.staged_count + summary.unstaged_count + summary.untracked_count
}

pub(super) fn push_block_reason(summary: &RepoSummary) -> Option<String> {
    if summary.remote_url.is_none() {
        Some("没有 origin remote".to_string())
    } else if summary.current_branch.is_none() {
        Some("当前不是命名分支".to_string())
    } else if summary.behind > 0 {
        Some("当前分支落后于 upstream".to_string())
    } else {
        None
    }
}

#[cfg(test)]
pub(super) fn merge_pull_block_reason(summary: &RepoSummary, has_upstream: bool) -> Option<String> {
    merge_pull_block_reason_with_mode(summary, has_upstream, RepoPullLocalChangesMode::Reject)
}

pub(super) fn merge_pull_block_reason_with_mode(
    summary: &RepoSummary,
    has_upstream: bool,
    local_changes_mode: RepoPullLocalChangesMode,
) -> Option<String> {
    if summary.conflict_count > 0 {
        Some("已有冲突需要先处理".to_string())
    } else if repo_dirty_count(summary) > 0
        && local_changes_mode == RepoPullLocalChangesMode::Reject
    {
        Some("存在未提交变更，已阻止合并拉取".to_string())
    } else if !has_upstream {
        Some("当前分支没有 upstream".to_string())
    } else {
        None
    }
}

pub(super) fn build_bulk_push_preview_with_lookup<F>(
    repos: Vec<RepoSummary>,
    has_upstream: F,
) -> BulkSyncPreview
where
    F: Fn(&RepoSummary) -> bool,
{
    let mut eligible = Vec::new();
    let mut blocked = Vec::new();
    let mut warnings = Vec::new();

    for repo in repos {
        if let Some(reason) = push_block_reason(&repo) {
            blocked.push(BulkSyncRepo { repo, reason });
            continue;
        }
        let has_upstream = has_upstream(&repo);
        let dirty = repo_dirty_count(&repo);
        if !has_upstream {
            eligible.push(BulkSyncRepo {
                repo: repo.clone(),
                reason: "发布当前分支到远端".to_string(),
            });
            if dirty > 0 {
                warnings.push(BulkSyncRepo {
                    repo,
                    reason: "存在未提交变更，但仍可发布当前分支".to_string(),
                });
            }
        } else if repo.ahead > 0 {
            eligible.push(BulkSyncRepo {
                repo: repo.clone(),
                reason: "有本地提交待推送".to_string(),
            });
            if dirty > 0 {
                warnings.push(BulkSyncRepo {
                    repo,
                    reason: "存在未提交变更，但仍可执行 push".to_string(),
                });
            }
        } else {
            warnings.push(BulkSyncRepo {
                repo,
                reason: "没有需要推送的提交".to_string(),
            });
        }
    }

    BulkSyncPreview {
        operation: "push".to_string(),
        eligible,
        blocked,
        warnings,
    }
}

pub(super) fn build_bulk_push_preview(repos: Vec<RepoSummary>) -> BulkSyncPreview {
    build_bulk_push_preview_with_lookup(repos, |repo| {
        current_branch_upstream(&PathBuf::from(&repo.path)).is_some()
    })
}

#[cfg(test)]
pub(super) fn build_bulk_sync_preview_with_lookup<F>(
    repos: Vec<RepoSummary>,
    has_upstream: F,
) -> BulkSyncPreview
where
    F: Fn(&RepoSummary) -> bool,
{
    build_bulk_sync_preview_with_lookup_and_mode(
        repos,
        has_upstream,
        RepoPullLocalChangesMode::Reject,
    )
}

pub(super) fn build_bulk_sync_preview_with_lookup_and_mode<F>(
    repos: Vec<RepoSummary>,
    has_upstream: F,
    local_changes_mode: RepoPullLocalChangesMode,
) -> BulkSyncPreview
where
    F: Fn(&RepoSummary) -> bool,
{
    let mut eligible = Vec::new();
    let mut blocked = Vec::new();
    let mut warnings = Vec::new();

    for repo in repos {
        if repo.remote_url.is_none() {
            blocked.push(BulkSyncRepo {
                repo,
                reason: "没有 origin remote".to_string(),
            });
            continue;
        }
        if repo.current_branch.is_none() {
            blocked.push(BulkSyncRepo {
                repo,
                reason: "当前不是命名分支".to_string(),
            });
            continue;
        }

        let has_upstream = has_upstream(&repo);
        let dirty = repo_dirty_count(&repo);
        if repo.behind > 0 {
            if repo.conflict_count > 0 {
                blocked.push(BulkSyncRepo {
                    repo,
                    reason: "已有冲突需要先处理".to_string(),
                });
            } else if dirty > 0 && local_changes_mode == RepoPullLocalChangesMode::Reject {
                blocked.push(BulkSyncRepo {
                    repo,
                    reason: "存在未提交变更".to_string(),
                });
            } else if !has_upstream {
                blocked.push(BulkSyncRepo {
                    repo,
                    reason: "当前分支没有 upstream".to_string(),
                });
            } else if repo.ahead > 0 {
                eligible.push(BulkSyncRepo {
                    repo,
                    reason: if dirty > 0 {
                        "需处理本地修改，拉取合并后推送".to_string()
                    } else {
                        "需先拉取合并后推送".to_string()
                    },
                });
            } else {
                eligible.push(BulkSyncRepo {
                    repo,
                    reason: if dirty > 0 {
                        "需处理本地修改后拉取远端更新".to_string()
                    } else {
                        "可拉取远端更新".to_string()
                    },
                });
            }
            continue;
        }

        if repo.ahead > 0 {
            if !has_upstream {
                blocked.push(BulkSyncRepo {
                    repo,
                    reason: "当前分支没有 upstream".to_string(),
                });
            } else {
                eligible.push(BulkSyncRepo {
                    repo: repo.clone(),
                    reason: "有本地提交待推送".to_string(),
                });
                if dirty > 0 {
                    warnings.push(BulkSyncRepo {
                        repo,
                        reason: "存在未提交变更，但仍可执行 push".to_string(),
                    });
                }
            }
        } else {
            warnings.push(BulkSyncRepo {
                repo,
                reason: "没有需要同步的更新".to_string(),
            });
        }
    }

    BulkSyncPreview {
        operation: "sync".to_string(),
        eligible,
        blocked,
        warnings,
    }
}

pub(super) fn build_bulk_sync_preview_with_mode(
    repos: Vec<RepoSummary>,
    local_changes_mode: RepoPullLocalChangesMode,
) -> BulkSyncPreview {
    build_bulk_sync_preview_with_lookup_and_mode(
        repos,
        |repo| current_branch_upstream(&PathBuf::from(&repo.path)).is_some(),
        local_changes_mode,
    )
}

#[cfg(test)]
pub(super) fn build_bulk_preview(operation: String, repos: Vec<RepoSummary>) -> BulkSyncPreview {
    build_bulk_preview_with_mode(operation, repos, RepoPullLocalChangesMode::Reject)
}

pub(super) fn build_bulk_preview_with_mode(
    operation: String,
    repos: Vec<RepoSummary>,
    local_changes_mode: RepoPullLocalChangesMode,
) -> BulkSyncPreview {
    if operation == "push" {
        return build_bulk_push_preview(repos);
    }
    if operation == "sync" {
        return build_bulk_sync_preview_with_mode(repos, local_changes_mode);
    }
    let mut eligible = Vec::new();
    let mut blocked = Vec::new();
    let mut warnings = Vec::new();

    for repo in repos {
        if repo.remote_url.is_none() {
            blocked.push(BulkSyncRepo {
                repo,
                reason: "没有 origin remote".to_string(),
            });
            continue;
        }
        if repo.current_branch.is_none() {
            blocked.push(BulkSyncRepo {
                repo,
                reason: "当前不是命名分支".to_string(),
            });
            continue;
        }
        let dirty = repo_dirty_count(&repo);
        if dirty > 0 && local_changes_mode == RepoPullLocalChangesMode::Reject {
            blocked.push(BulkSyncRepo {
                repo,
                reason: "存在未提交变更".to_string(),
            });
        } else if repo.behind > 0 {
            eligible.push(BulkSyncRepo {
                repo,
                reason: if dirty > 0 {
                    "需处理本地修改后拉取远端更新".to_string()
                } else {
                    "可拉取远端更新".to_string()
                },
            });
        } else {
            warnings.push(BulkSyncRepo {
                repo,
                reason: "没有需要拉取的更新".to_string(),
            });
        }
    }

    BulkSyncPreview {
        operation: "pull".to_string(),
        eligible,
        blocked,
        warnings,
    }
}

pub(super) fn bulk_sync_repo(
    app: &AppHandle,
    root: &Path,
    operation: &str,
    repo_id: String,
    local_changes_mode: RepoPullLocalChangesMode,
) -> BulkSyncResult {
    let path = match repo_path_by_id(app, &repo_id) {
        Ok(path) => path,
        Err(err) => return bulk_error_result(repo_id, err),
    };
    let common_dir = git_common_dir(&path).unwrap_or_else(|| path.clone());
    with_repo_guard(common_dir, RepoAccess::Write, || {
        bulk_sync_repo_guarded(app, root, operation, repo_id, path, local_changes_mode)
    })
}

fn bulk_sync_repo_guarded(
    app: &AppHandle,
    root: &Path,
    operation: &str,
    repo_id: String,
    path: PathBuf,
    local_changes_mode: RepoPullLocalChangesMode,
) -> BulkSyncResult {
    let summary = summarize_repo(root, &path);
    if operation == "sync" {
        return sync_repo(app, root, repo_id, &path, &summary, local_changes_mode);
    }
    let run = if operation == "pull" {
        prepare_pull_local_changes(&path, &summary, Some(local_changes_mode), "pull").and_then(
            |local_changes| {
                run_pull(app, &path).map_err(|err| {
                    restore_pull_local_changes_after_error(&path, local_changes.clone(), err)
                })?;
                restore_pull_local_changes(&path, local_changes)
            },
        )
    } else if let Some(reason) = push_block_reason(&summary) {
        Err(format!("{reason}，已跳过 push"))
    } else if current_branch_upstream(&path).is_some() && summary.ahead <= 0 {
        Err("没有需要推送的提交，已跳过 push".to_string())
    } else {
        run_push_with_system_git_fallback(app, &path)
    };

    match run {
        Ok(()) => BulkSyncResult {
            summary: Some(summarize_repo(root, &path)),
            repo_id,
            status: "success".to_string(),
            message: "完成".to_string(),
        },
        Err(err) => bulk_error_result(repo_id, err),
    }
}

pub(super) fn sync_repo(
    app: &AppHandle,
    root: &Path,
    repo_id: String,
    path: &Path,
    summary: &RepoSummary,
    local_changes_mode: RepoPullLocalChangesMode,
) -> BulkSyncResult {
    if summary.ahead <= 0 && summary.behind <= 0 {
        return BulkSyncResult {
            summary: Some(summary.clone()),
            repo_id,
            status: "success".to_string(),
            message: "完成".to_string(),
        };
    }

    let has_upstream = current_branch_upstream(path).is_some();
    let dirty = repo_dirty_count(summary);
    let skip = |message: &str| bulk_error_result(&repo_id, message);
    let run: Result<(), BulkSyncResult> = if summary.behind > 0 {
        if summary.remote_url.is_none() {
            Err(skip("没有 origin remote，已跳过同步"))
        } else if summary.current_branch.is_none() {
            Err(skip("当前不是命名分支，已跳过同步"))
        } else if summary.conflict_count > 0 {
            Err(skip("已有冲突需要先处理，已跳过同步"))
        } else if dirty > 0 && local_changes_mode == RepoPullLocalChangesMode::Reject {
            Err(skip("存在未提交变更，已跳过同步"))
        } else if !has_upstream {
            Err(skip("当前分支没有 upstream，已跳过同步"))
        } else if summary.ahead > 0 {
            run_merge_pull_then_push(
                app,
                root,
                repo_id.clone(),
                path,
                summary,
                local_changes_mode,
            )
        } else {
            prepare_pull_local_changes(path, summary, Some(local_changes_mode), "pull")
                .and_then(|local_changes| {
                    run_pull(app, path).map_err(|err| {
                        restore_pull_local_changes_after_error(path, local_changes.clone(), err)
                    })?;
                    restore_pull_local_changes(path, local_changes)
                })
                .map_err(|err| bulk_error_result(&repo_id, err))
        }
    } else {
        if !has_upstream {
            Err(bulk_error_result(
                &repo_id,
                "当前分支没有 upstream，已跳过同步",
            ))
        } else if let Some(reason) = push_block_reason(summary) {
            Err(bulk_error_result(&repo_id, format!("{reason}，已跳过同步")))
        } else {
            run_push_with_system_git_fallback(app, path)
                .map_err(|err| bulk_error_result(&repo_id, err))
        }
    };

    match run {
        Ok(()) => BulkSyncResult {
            summary: Some(summarize_repo(root, path)),
            repo_id,
            status: "success".to_string(),
            message: "完成".to_string(),
        },
        Err(result) => result,
    }
}

pub(super) fn run_merge_pull_then_push(
    app: &AppHandle,
    root: &Path,
    repo_id: String,
    path: &Path,
    summary: &RepoSummary,
    local_changes_mode: RepoPullLocalChangesMode,
) -> Result<(), BulkSyncResult> {
    let local_changes =
        prepare_pull_local_changes(path, summary, Some(local_changes_mode), "合并拉取")
            .map_err(|err| bulk_error_result(&repo_id, err))?;
    run_fetch(app, path).map_err(|err| {
        bulk_error_result(
            &repo_id,
            restore_pull_local_changes_after_error(path, local_changes.clone(), err),
        )
    })?;
    match git_command(path, &["merge", "--no-edit", "@{u}"], None) {
        Ok(_) => {
            if let Err(err) = restore_pull_local_changes(path, local_changes) {
                let conflicts = repo_conflicts(path);
                if conflicts.files.is_empty() {
                    return Err(bulk_error_result(repo_id, err));
                }
                return Err(BulkSyncResult {
                    repo_id,
                    status: "error".to_string(),
                    message: "拉取完成，stash 还原产生冲突，请处理后推送".to_string(),
                    summary: Some(summarize_repo(root, path)),
                });
            }
            run_push_with_system_git_fallback(app, path)
                .map_err(|err| bulk_error_result(repo_id, err))
        }
        Err(err) => {
            let conflicts = repo_conflicts(path);
            if conflicts.files.is_empty() {
                Err(bulk_error_result(
                    &repo_id,
                    restore_pull_local_changes_after_error(path, local_changes, err),
                ))
            } else {
                Err(BulkSyncResult {
                    repo_id,
                    status: "error".to_string(),
                    message: "合并产生冲突，请处理后推送".to_string(),
                    summary: Some(summarize_repo(root, path)),
                })
            }
        }
    }
}

pub(super) fn should_retry_push_with_system_git(error: &str) -> bool {
    error.contains("当前 GitHub 绑定无权限") || error.contains("无法认证 GitHub 仓库")
}

pub(super) fn run_push_with_system_git_fallback(
    app: &AppHandle,
    path: &Path,
) -> Result<(), String> {
    if repo_uses_system_git(app, path) {
        return run_push(app, path);
    }
    match run_push(app, path) {
        Ok(()) => Ok(()),
        Err(err) if should_retry_push_with_system_git(&err) => {
            run_system_git_push(path)?;
            remember_repo_uses_system_git(app, path)
        }
        Err(err) => Err(err),
    }
}

pub(super) fn bulk_error_result(
    repo_id: impl Into<String>,
    message: impl Into<String>,
) -> BulkSyncResult {
    BulkSyncResult {
        repo_id: repo_id.into(),
        status: "error".to_string(),
        message: message.into(),
        summary: None,
    }
}

pub async fn bulk_sync_preview(
    app: AppHandle,
    operation: String,
    repos: Vec<RepoSummary>,
    local_changes_mode: Option<RepoPullLocalChangesMode>,
) -> Result<BulkSyncPreview, String> {
    run_operation(
        app,
        OperationSpec::new(OperationKind::LocalRead).lane(DispatchLane::Bulk),
        move || {
            Ok(build_bulk_preview_with_mode(
                operation,
                repos,
                local_changes_mode.unwrap_or_default(),
            ))
        },
    )
    .await
}

enum SubmittedBulkRepo {
    Ticket {
        repo_id: String,
        ticket: OperationTicket<BulkSyncResult>,
    },
    Result(BulkSyncResult),
}

async fn aggregate_bulk_sync(
    app: AppHandle,
    parent_task_id: String,
    submitted: Vec<SubmittedBulkRepo>,
) -> Result<Vec<BulkSyncResult>, String> {
    let mut results = Vec::with_capacity(submitted.len());
    let mut cancellation_error = None;
    for item in submitted {
        match item {
            SubmittedBulkRepo::Result(result) => results.push(result),
            SubmittedBulkRepo::Ticket { repo_id, ticket } => match ticket.wait().await {
                Ok(result) => results.push(result),
                Err(error) if error.contains("取消") => {
                    cancellation_error.get_or_insert(error);
                }
                Err(error) => results.push(bulk_error_result(repo_id, error)),
            },
        }
    }
    if let Some(error) = cancellation_error {
        finish_workspace_task(&app, &parent_task_id, "cancelled", Some(error.clone()));
        return Err(error);
    }
    let failures = results
        .iter()
        .filter(|result| result.status == "error")
        .count();
    if failures == 0 {
        finish_workspace_task(
            &app,
            &parent_task_id,
            "success",
            Some(format!("已同步 {} 个仓库", results.len())),
        );
    } else {
        finish_workspace_task(
            &app,
            &parent_task_id,
            "error",
            Some(format!("{} 个仓库同步失败", failures)),
        );
    }
    Ok(results)
}

pub async fn bulk_sync_execute(
    app: AppHandle,
    operation: String,
    repo_ids: Vec<String>,
    local_changes_mode: Option<RepoPullLocalChangesMode>,
    trigger: Option<String>,
) -> Result<Vec<BulkSyncResult>, String> {
    if repo_ids.is_empty() {
        return Ok(Vec::new());
    }
    let trigger = BulkSyncTrigger::parse(trigger.as_deref())?;
    let parent = record_pending_operation_task(
        &app,
        "sync",
        trigger.title(&operation),
        trigger.priority(),
        None,
        Some(format!("等待同步 {} 个仓库", repo_ids.len())),
    );
    let root = match workspace_root(&app) {
        Ok(root) => root,
        Err(error) => {
            finish_workspace_task(&app, &parent.id, "error", Some(error.clone()));
            return Err(error);
        }
    };
    let local_changes_mode = local_changes_mode.unwrap_or_default();
    let mut submitted = Vec::with_capacity(repo_ids.len());
    let mut cancel_targets = Vec::with_capacity(repo_ids.len());
    for repo_id in repo_ids {
        let path = match repo_path_by_id(&app, &repo_id) {
            Ok(path) => path,
            Err(error) => {
                submitted.push(SubmittedBulkRepo::Result(bulk_error_result(repo_id, error)));
                continue;
            }
        };
        let common_dir = git_common_dir(&path).unwrap_or(path);
        let resource = repo_resource_id(&common_dir);
        let run_app = app.clone();
        let run_root = root.clone();
        let run_operation_name = operation.clone();
        let run_repo_id = repo_id.clone();
        let spec = OperationSpec::new(OperationKind::Bulk)
            .lane(trigger.lane())
            .priority(trigger.core_priority())
            .parent_task(parent.id.clone())
            .resource(resource.clone(), ResourceAccessMode::ExclusiveWrite)
            .same_resource_order(resource);
        match submit_operation(app.clone(), spec, move || {
            Ok(bulk_sync_repo(
                &run_app,
                &run_root,
                &run_operation_name,
                run_repo_id,
                local_changes_mode,
            ))
        }) {
            Ok(ticket) => {
                cancel_targets.push(ticket.cancel_target());
                submitted.push(SubmittedBulkRepo::Ticket { repo_id, ticket });
            }
            Err(error) => {
                submitted.push(SubmittedBulkRepo::Result(bulk_error_result(repo_id, error)));
            }
        }
    }

    if cancel_targets.is_empty() {
        mark_workspace_task_running(&app, &parent.id, Some("正在汇总同步结果".to_string()));
    } else {
        let cancel_app = app.clone();
        register_pending_task_cancellation(
            &app,
            &parent.id,
            Box::new(move || {
                cancel_pending_operations(&cancel_app, &cancel_targets, "批量同步已取消")
            }),
        );
    }

    tokio::spawn(aggregate_bulk_sync(app, parent.id, submitted))
        .await
        .map_err(|_| "批量同步结果通道已关闭".to_string())?
}

#[cfg(test)]
mod trigger_tests {
    use super::*;
    use crate::runtime::WorkspaceRuntime;
    use crate::workspace::tasks::workspace_list_tasks;
    use serde_json::Value;
    use std::sync::Arc;

    struct TestRuntime;

    impl WorkspaceRuntime for TestRuntime {
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
    }

    fn test_app() -> AppHandle {
        AppHandle::new(Arc::new(TestRuntime))
    }

    fn result(repo_id: &str, status: &str) -> BulkSyncResult {
        BulkSyncResult {
            repo_id: repo_id.to_string(),
            status: status.to_string(),
            message: if status == "success" {
                "完成".to_string()
            } else {
                "失败".to_string()
            },
            summary: None,
        }
    }

    async fn wait_for_parent_status(task_id: &str, status: &str) {
        for _ in 0..200 {
            if workspace_list_tasks()
                .iter()
                .any(|task| task.id == task_id && task.status == status)
            {
                return;
            }
            tokio::task::yield_now().await;
        }
        panic!("bulk parent {task_id} did not reach {status}");
    }

    #[test]
    fn bulk_trigger_controls_task_projection() {
        assert_eq!(
            BulkSyncTrigger::parse(None).unwrap(),
            BulkSyncTrigger::Manual
        );
        assert_eq!(
            BulkSyncTrigger::parse(Some("syncAll"))
                .unwrap()
                .title("sync"),
            "同步全部仓库"
        );
        assert_eq!(
            BulkSyncTrigger::parse(Some("autoSync")).unwrap().priority(),
            "normal"
        );
        assert!(BulkSyncTrigger::parse(Some("unknown")).is_err());
    }

    #[tokio::test]
    async fn aggregation_preserves_input_order_and_projects_partial_failure() {
        let app = test_app();
        let parent = record_pending_operation_task(
            &app,
            "sync",
            "bulk aggregate ordering",
            "high",
            None,
            None,
        );
        mark_workspace_task_running(&app, &parent.id, None);
        let submitted = vec![
            SubmittedBulkRepo::Result(result("third", "success")),
            SubmittedBulkRepo::Result(result("first", "error")),
            SubmittedBulkRepo::Result(result("second", "success")),
        ];

        let results = aggregate_bulk_sync(app, parent.id.clone(), submitted)
            .await
            .unwrap();

        assert_eq!(
            results
                .iter()
                .map(|result| result.repo_id.as_str())
                .collect::<Vec<_>>(),
            vec!["third", "first", "second"]
        );
        wait_for_parent_status(&parent.id, "error").await;
    }

    #[tokio::test]
    async fn detached_aggregation_finishes_parent_after_command_waiter_is_dropped() {
        let app = test_app();
        let parent = record_pending_operation_task(
            &app,
            "sync",
            "detached bulk aggregation",
            "high",
            None,
            None,
        );
        mark_workspace_task_running(&app, &parent.id, None);
        let waiter = tokio::spawn(aggregate_bulk_sync(
            app,
            parent.id.clone(),
            vec![SubmittedBulkRepo::Result(result("repo", "success"))],
        ));

        drop(waiter);

        wait_for_parent_status(&parent.id, "success").await;
    }
}

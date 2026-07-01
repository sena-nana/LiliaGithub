use std::path::{Path, PathBuf};
use std::thread;

use crate::workspace::repos::{
    current_branch_upstream, git_command, prepare_pull_local_changes,
    remember_repo_uses_system_git, repo_conflicts, repo_uses_system_git,
    restore_pull_local_changes, restore_pull_local_changes_after_error, run_fetch, run_pull,
    run_push, run_system_git_push, summarize_repo,
};
use crate::workspace::run_blocking;
use crate::workspace::settings::{repo_path_by_id, workspace_root};
use crate::workspace::types::{
    BulkSyncPreview, BulkSyncRepo, BulkSyncResult, RepoPullLocalChangesMode, RepoSummary,
};
use tauri::AppHandle;

pub(super) fn repo_dirty_count(summary: &RepoSummary) -> usize {
    summary.staged_count + summary.unstaged_count + summary.untracked_count
}

pub(super) fn push_block_reason(summary: &RepoSummary, has_upstream: bool) -> Option<String> {
    if summary.remote_url.is_none() {
        Some("没有 origin remote".to_string())
    } else if summary.current_branch.is_none() {
        Some("当前不是命名分支".to_string())
    } else if !has_upstream {
        Some("当前分支没有 upstream".to_string())
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
        if let Some(reason) = push_block_reason(&repo, has_upstream(&repo)) {
            blocked.push(BulkSyncRepo { repo, reason });
            continue;
        }
        let dirty = repo_dirty_count(&repo);
        if repo.ahead > 0 {
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
            if let Some(reason) = push_block_reason(&repo, has_upstream) {
                blocked.push(BulkSyncRepo { repo, reason });
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
    let op = if operation == "push" { "push" } else { "pull" }.to_string();

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
        if op == "pull" {
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
        } else if repo.ahead > 0 {
            eligible.push(BulkSyncRepo {
                repo,
                reason: "有本地提交待推送".to_string(),
            });
        } else {
            warnings.push(BulkSyncRepo {
                repo,
                reason: "没有需要推送的提交".to_string(),
            });
        }
    }

    BulkSyncPreview {
        operation: op,
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
    } else if let Some(reason) =
        push_block_reason(&summary, current_branch_upstream(&path).is_some())
    {
        Err(format!("{reason}，已跳过 push"))
    } else if summary.ahead <= 0 {
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
    let has_upstream = current_branch_upstream(path).is_some();
    let dirty = repo_dirty_count(summary);
    let skip = |message: &str| bulk_error_result_for(&repo_id, message);
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
                .map_err(|err| bulk_error_result_for(&repo_id, err))
        }
    } else if summary.ahead > 0 {
        if let Some(reason) = push_block_reason(summary, has_upstream) {
            Err(bulk_error_result_for(
                &repo_id,
                format!("{reason}，已跳过同步"),
            ))
        } else {
            run_push_with_system_git_fallback(app, path)
                .map_err(|err| bulk_error_result_for(&repo_id, err))
        }
    } else {
        Err(skip("没有需要同步的更新，已跳过同步"))
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
            .map_err(|err| bulk_error_result_for(&repo_id, err))?;
    run_fetch(app, path).map_err(|err| {
        bulk_error_result_for(
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
                Err(bulk_error_result_for(
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

pub(super) fn run_bulk_sync_parallel<F>(repo_ids: Vec<String>, run: F) -> Vec<BulkSyncResult>
where
    F: Fn(String) -> BulkSyncResult + Sync,
{
    thread::scope(|scope| {
        let run = &run;
        let handles: Vec<_> = repo_ids
            .into_iter()
            .map(|repo_id| scope.spawn(move || run(repo_id)))
            .collect();

        handles
            .into_iter()
            .map(|handle| {
                handle
                    .join()
                    .unwrap_or_else(|_| bulk_error_result_for("unknown", "批量执行线程异常"))
            })
            .collect()
    })
}

pub(super) fn bulk_error_result(repo_id: String, message: String) -> BulkSyncResult {
    BulkSyncResult {
        repo_id,
        status: "error".to_string(),
        message,
        summary: None,
    }
}

pub(super) fn bulk_error_result_for(repo_id: &str, message: impl Into<String>) -> BulkSyncResult {
    bulk_error_result(repo_id.to_string(), message.into())
}

#[tauri::command]
pub async fn bulk_sync_preview(
    _app: AppHandle,
    operation: String,
    repos: Vec<RepoSummary>,
    local_changes_mode: Option<RepoPullLocalChangesMode>,
) -> Result<BulkSyncPreview, String> {
    run_blocking("批量预览", move || {
        Ok(build_bulk_preview_with_mode(
            operation,
            repos,
            local_changes_mode.unwrap_or_default(),
        ))
    })
    .await
}

#[tauri::command]
pub async fn bulk_sync_execute(
    app: AppHandle,
    operation: String,
    repo_ids: Vec<String>,
    local_changes_mode: Option<RepoPullLocalChangesMode>,
) -> Result<Vec<BulkSyncResult>, String> {
    run_blocking("批量同步", move || {
        let root = workspace_root(&app)?;
        let local_changes_mode = local_changes_mode.unwrap_or_default();
        Ok(run_bulk_sync_parallel(repo_ids, |repo_id| {
            bulk_sync_repo(&app, &root, &operation, repo_id, local_changes_mode)
        }))
    })
    .await
}

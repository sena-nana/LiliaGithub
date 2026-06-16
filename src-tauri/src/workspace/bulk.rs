use super::*;

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

pub(super) fn merge_pull_block_reason(summary: &RepoSummary, has_upstream: bool) -> Option<String> {
    if summary.conflict_count > 0 {
        Some("已有冲突需要先处理".to_string())
    } else if repo_dirty_count(summary) > 0 {
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

pub(super) fn build_bulk_sync_preview_with_lookup<F>(
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
            } else if dirty > 0 {
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
                    reason: "需先拉取合并后推送".to_string(),
                });
            } else {
                eligible.push(BulkSyncRepo {
                    repo,
                    reason: "可拉取远端更新".to_string(),
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

pub(super) fn build_bulk_sync_preview(repos: Vec<RepoSummary>) -> BulkSyncPreview {
    build_bulk_sync_preview_with_lookup(repos, |repo| {
        current_branch_upstream(&PathBuf::from(&repo.path)).is_some()
    })
}

pub(super) fn build_bulk_preview(operation: String, repos: Vec<RepoSummary>) -> BulkSyncPreview {
    if operation == "push" {
        return build_bulk_push_preview(repos);
    }
    if operation == "sync" {
        return build_bulk_sync_preview(repos);
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
            if dirty > 0 {
                blocked.push(BulkSyncRepo {
                    repo,
                    reason: "存在未提交变更".to_string(),
                });
            } else if repo.behind > 0 {
                eligible.push(BulkSyncRepo {
                    repo,
                    reason: "可拉取远端更新".to_string(),
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
) -> BulkSyncResult {
    let path = match repo_path_by_id(app, &repo_id) {
        Ok(path) => path,
        Err(err) => return bulk_error_result(repo_id, err),
    };
    let summary = summarize_repo(root, &path);
    if operation == "sync" {
        return sync_repo(app, root, repo_id, &path, &summary);
    }
    let run = if operation == "pull" {
        if repo_dirty_count(&summary) > 0 {
            Err("存在未提交变更，已跳过 pull".to_string())
        } else {
            run_pull(app, &path)
        }
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
        } else if dirty > 0 {
            Err(skip("存在未提交变更，已跳过同步"))
        } else if !has_upstream {
            Err(skip("当前分支没有 upstream，已跳过同步"))
        } else if summary.ahead > 0 {
            run_merge_pull_then_push(app, root, repo_id.clone(), path)
        } else {
            run_pull(app, path).map_err(|err| bulk_error_result_for(&repo_id, err))
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
) -> Result<(), BulkSyncResult> {
    run_fetch(app, path).map_err(|err| bulk_error_result_for(&repo_id, err))?;
    match git_command(path, &["merge", "--no-edit", "@{u}"], None) {
        Ok(_) => run_push_with_system_git_fallback(app, path)
            .map_err(|err| bulk_error_result(repo_id, err)),
        Err(err) => {
            let conflicts = repo_conflicts(path);
            if conflicts.files.is_empty() {
                Err(bulk_error_result_for(&repo_id, err))
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
) -> Result<BulkSyncPreview, String> {
    run_blocking("批量预览", move || {
        Ok(build_bulk_preview(operation, repos))
    })
    .await
}

#[tauri::command]
pub async fn bulk_sync_execute(
    app: AppHandle,
    operation: String,
    repo_ids: Vec<String>,
) -> Result<Vec<BulkSyncResult>, String> {
    run_blocking("批量同步", move || {
        let root = workspace_root(&app)?;
        Ok(run_bulk_sync_parallel(repo_ids, |repo_id| {
            bulk_sync_repo(&app, &root, &operation, repo_id)
        }))
    })
    .await
}

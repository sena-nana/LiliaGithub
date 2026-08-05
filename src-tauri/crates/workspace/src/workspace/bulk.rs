use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::operations::{
    run_operation, submit_operation, OperationKind, OperationSpec, OperationTaskCompletion,
    OperationTicket, VisibleOperation, VisibleOperationGroup,
};
use crate::workspace::repo_guard::{with_repo_guard, RepoAccess};
use crate::workspace::repos::{
    git_common_dir, require_valid_remote_sync_config, run_configured_pull,
    run_configured_pull_with_config, run_multi_remote_push, summarize_repo, sync_result,
};
use crate::workspace::settings::{repo_path_by_id, repo_root_and_path_by_id};
use lilia_github_contracts::workspace::{
    BulkSyncOperation, BulkSyncPreview, BulkSyncRepo, BulkSyncResult, BulkSyncTrigger,
    RepoPullLocalChangesMode, RepoRemoteSyncPolicy, RepoSummary,
};

fn bulk_sync_title(trigger: BulkSyncTrigger, operation: BulkSyncOperation) -> &'static str {
    match trigger {
        BulkSyncTrigger::SyncAll => "同步全部仓库",
        BulkSyncTrigger::AutoSync => "自动同步仓库",
        BulkSyncTrigger::Manual if operation == BulkSyncOperation::Pull => "批量拉取仓库",
        BulkSyncTrigger::Manual if operation == BulkSyncOperation::Push => "批量推送仓库",
        BulkSyncTrigger::Manual => "批量同步仓库",
    }
}

fn bulk_sync_priority(trigger: BulkSyncTrigger) -> &'static str {
    match trigger {
        BulkSyncTrigger::AutoSync => "normal",
        BulkSyncTrigger::Manual | BulkSyncTrigger::SyncAll => "high",
    }
}

fn bulk_sync_core_priority(trigger: BulkSyncTrigger) -> i64 {
    match trigger {
        BulkSyncTrigger::Manual => 100,
        BulkSyncTrigger::SyncAll => 50,
        BulkSyncTrigger::AutoSync => -50,
    }
}

pub(super) fn repo_dirty_count(summary: &RepoSummary) -> usize {
    summary.staged_count + summary.unstaged_count + summary.untracked_count
}

#[derive(Clone, Copy, Default)]
pub(super) struct RemoteSyncNeeds {
    pub(super) pull: bool,
    pub(super) push: bool,
    pub(super) divergent: bool,
    pub(super) unpushable_commits: bool,
}

pub(super) fn remote_sync_needs(
    summary: &RepoSummary,
    policy: &RepoRemoteSyncPolicy,
) -> RemoteSyncNeeds {
    let pull_remotes = policy.pull_remotes.iter().collect::<HashSet<_>>();
    let push_remotes = policy.push_remotes.iter().collect::<HashSet<_>>();
    let mut needs = RemoteSyncNeeds::default();
    for state in &summary.remote_branch_states {
        if pull_remotes.contains(&state.remote) {
            needs.pull |= state.needs_pull;
            needs.divergent |= state.needs_pull && state.ahead > 0;
            needs.unpushable_commits |= state.needs_push;
        }
        needs.push |= push_remotes.contains(&state.remote) && state.needs_push;
    }
    needs
}

pub(super) fn bulk_sync_repo(
    app: &AppHandle,
    root: &Path,
    operation: BulkSyncOperation,
    repo_id: String,
    local_changes_mode: RepoPullLocalChangesMode,
) -> BulkSyncResult {
    let path = match repo_path_by_id(app, &repo_id) {
        Ok(path) => path,
        Err(err) => return bulk_error_result(repo_id, err),
    };
    let common_dir = git_common_dir(&path).unwrap_or_else(|| path.clone());
    with_repo_guard(app, common_dir, RepoAccess::Write, || {
        bulk_sync_repo_guarded(app, root, operation, repo_id, path, local_changes_mode)
    })
}

fn bulk_sync_repo_guarded(
    app: &AppHandle,
    root: &Path,
    operation: BulkSyncOperation,
    repo_id: String,
    path: PathBuf,
    local_changes_mode: RepoPullLocalChangesMode,
) -> BulkSyncResult {
    if operation == BulkSyncOperation::Sync {
        let summary = summarize_repo(root, &path);
        return sync_repo(app, root, repo_id, &path, &summary, local_changes_mode);
    }
    let result = if operation == BulkSyncOperation::Pull {
        run_configured_pull(app, root, &repo_id, &path, Some(local_changes_mode), false)
    } else {
        require_valid_remote_sync_config(app, &repo_id, &path).and_then(|config| {
            run_multi_remote_push(app, &path, &config, None, None, false)
                .map(|steps| sync_result(root, &path, steps, "推送已执行"))
        })
    };
    match result {
        Ok(result) => bulk_result_from_operation(repo_id, result),
        Err(err) => bulk_error_result(repo_id, err),
    }
}

fn bulk_result_from_operation(
    repo_id: String,
    result: lilia_github_contracts::workspace::RepoSyncOperationResult,
) -> BulkSyncResult {
    BulkSyncResult {
        repo_id,
        status: result.status,
        message: result.message,
        summary: Some(result.summary),
        steps: result.steps,
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
    if summary.ahead <= 0
        && summary.behind <= 0
        && summary.remotes_needing_pull == 0
        && summary.remotes_needing_push == 0
    {
        return BulkSyncResult {
            summary: Some(summary.clone()),
            repo_id,
            status: "success".to_string(),
            message: "完成".to_string(),
            steps: Vec::new(),
        };
    }

    let config = match require_valid_remote_sync_config(app, &repo_id, path) {
        Ok(config) => config,
        Err(error) => return bulk_error_result(repo_id, error),
    };
    let needs = remote_sync_needs(summary, &config.resolved_policy);
    let mut steps = Vec::new();
    if needs.pull {
        match run_configured_pull_with_config(
            app,
            root,
            path,
            &config,
            Some(local_changes_mode),
            needs.divergent || config.resolved_policy.pull_remotes.len() > 1,
        ) {
            Ok(result) if result.status == "success" => steps.extend(result.steps),
            Ok(result) => return bulk_result_from_operation(repo_id, result),
            Err(error) => return bulk_error_result(repo_id, error),
        }
    }
    let refreshed = summarize_repo(root, path);
    if remote_sync_needs(&refreshed, &config.resolved_policy).push {
        match run_multi_remote_push(app, path, &config, None, None, false) {
            Ok(push_steps) => steps.extend(push_steps),
            Err(error) => return bulk_error_result(repo_id, error),
        }
    }
    bulk_result_from_operation(repo_id, sync_result(root, path, steps, "同步已执行"))
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
        steps: Vec::new(),
    }
}

pub async fn bulk_sync_preview(
    app: AppHandle,
    operation: BulkSyncOperation,
    repo_ids: Vec<String>,
    local_changes_mode: Option<RepoPullLocalChangesMode>,
) -> Result<BulkSyncPreview, String> {
    let operation_app = app.clone();
    run_operation(
        app,
        OperationSpec::new(OperationKind::LocalRead),
        move || {
            build_live_bulk_preview(
                &operation_app,
                operation,
                repo_ids,
                local_changes_mode.unwrap_or_default(),
            )
        },
    )
    .await
}

fn build_live_bulk_preview(
    app: &AppHandle,
    operation: BulkSyncOperation,
    repo_ids: Vec<String>,
    local_changes_mode: RepoPullLocalChangesMode,
) -> Result<BulkSyncPreview, String> {
    let mut eligible = Vec::new();
    let mut blocked = Vec::new();
    let mut warnings = Vec::new();
    for repo_id in repo_ids {
        let (root, path) = repo_root_and_path_by_id(app, &repo_id)?;
        let repo = summarize_repo(&root, &path);
        let config = match require_valid_remote_sync_config(app, &repo_id, &path) {
            Ok(config) => config,
            Err(reason) => {
                blocked.push(BulkSyncRepo { repo, reason });
                continue;
            }
        };
        if repo.current_branch.is_none() {
            blocked.push(BulkSyncRepo {
                repo,
                reason: "当前不是命名分支".to_string(),
            });
            continue;
        }
        let needs = remote_sync_needs(&repo, &config.resolved_policy);
        let pull_requested = operation != BulkSyncOperation::Push;
        let push_requested = operation != BulkSyncOperation::Pull;
        if pull_requested && repo.conflict_count > 0 {
            blocked.push(BulkSyncRepo {
                repo,
                reason: "已有冲突需要先处理".to_string(),
            });
        } else if pull_requested
            && repo_dirty_count(&repo) > 0
            && local_changes_mode == RepoPullLocalChangesMode::Reject
        {
            blocked.push(BulkSyncRepo {
                repo,
                reason: "存在未提交变更".to_string(),
            });
        } else if push_requested
            && config.resolved_policy.push_remotes.is_empty()
            && !needs.pull
            && (operation == BulkSyncOperation::Push || needs.unpushable_commits)
        {
            blocked.push(BulkSyncRepo {
                repo,
                reason: "未配置推送目标".to_string(),
            });
        } else if (pull_requested && needs.pull) || (push_requested && needs.push) {
            eligible.push(BulkSyncRepo {
                repo,
                reason: match (needs.pull, needs.push) {
                    (true, true) => "有远端更新待合并及本地提交待推送",
                    (true, false) => "有远端更新待拉取",
                    (false, true) => "有本地提交待推送",
                    _ => unreachable!(),
                }
                .to_string(),
            });
        } else {
            warnings.push(BulkSyncRepo {
                repo,
                reason: "没有需要同步的更新".to_string(),
            });
        }
    }
    Ok(BulkSyncPreview {
        operation,
        eligible,
        blocked,
        warnings,
    })
}

enum SubmittedBulkRepo {
    Ticket {
        repo_id: String,
        ticket: OperationTicket<BulkSyncResult>,
    },
    Result(Box<BulkSyncResult>),
}

async fn aggregate_bulk_sync(
    group: VisibleOperationGroup,
    submitted: Vec<SubmittedBulkRepo>,
) -> Result<Vec<BulkSyncResult>, String> {
    let mut results = Vec::with_capacity(submitted.len());
    let mut cancellation_error = None;
    for item in submitted {
        match item {
            SubmittedBulkRepo::Result(result) => results.push(*result),
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
        group.finish_cancelled(error.clone());
        return Err(error);
    }
    let failures = results
        .iter()
        .filter(|result| result.status == "error")
        .count();
    if failures == 0 {
        group.finish(OperationTaskCompletion::Success(format!(
            "已同步 {} 个仓库",
            results.len()
        )));
    } else {
        group.finish(OperationTaskCompletion::Error(format!(
            "{} 个仓库同步失败",
            failures
        )));
    }
    Ok(results)
}

pub async fn bulk_sync_execute(
    app: AppHandle,
    operation: BulkSyncOperation,
    repo_ids: Vec<String>,
    local_changes_mode: Option<RepoPullLocalChangesMode>,
    trigger: Option<BulkSyncTrigger>,
) -> Result<Vec<BulkSyncResult>, String> {
    if repo_ids.is_empty() {
        return Ok(Vec::new());
    }
    let trigger = trigger.unwrap_or_default();
    let parent = VisibleOperationGroup::new(
        app.clone(),
        VisibleOperation::new("sync", bulk_sync_title(trigger, operation))
            .priority(bulk_sync_priority(trigger)),
        Some(format!("等待同步 {} 个仓库", repo_ids.len())),
    );
    let local_changes_mode = local_changes_mode.unwrap_or_default();
    let mut submitted = Vec::with_capacity(repo_ids.len());
    let mut cancel_targets = Vec::with_capacity(repo_ids.len());
    for repo_id in repo_ids {
        let (root, _) = match repo_root_and_path_by_id(&app, &repo_id) {
            Ok(value) => value,
            Err(error) => {
                submitted.push(SubmittedBulkRepo::Result(Box::new(bulk_error_result(
                    repo_id, error,
                ))));
                continue;
            }
        };
        let run_app = app.clone();
        let run_root = root;
        let run_operation = operation;
        let run_repo_id = repo_id.clone();
        let spec = OperationSpec::new(OperationKind::Bulk)
            .priority(bulk_sync_core_priority(trigger))
            .parent_task(parent.task_id().to_string());
        match submit_operation(app.clone(), spec, move || {
            Ok(bulk_sync_repo(
                &run_app,
                &run_root,
                run_operation,
                run_repo_id,
                local_changes_mode,
            ))
        }) {
            Ok(ticket) => {
                cancel_targets.push(ticket.cancel_target());
                submitted.push(SubmittedBulkRepo::Ticket { repo_id, ticket });
            }
            Err(error) => {
                submitted.push(SubmittedBulkRepo::Result(Box::new(bulk_error_result(
                    repo_id, error,
                ))));
            }
        }
    }

    if cancel_targets.is_empty() {
        parent.mark_running(Some("正在汇总同步结果".to_string()));
    } else {
        parent.register_cancel_targets(cancel_targets, "批量同步已取消");
    }

    tokio::spawn(aggregate_bulk_sync(parent, submitted))
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
        fn store_get(
            &self,
            _file: &str,
            _key: &str,
        ) -> Result<Option<Value>, crate::runtime::StoreError> {
            Ok(None)
        }
        fn store_set(
            &self,
            _file: &str,
            _key: &str,
            _value: Value,
        ) -> Result<(), crate::runtime::StoreError> {
            Ok(())
        }
        fn store_delete(&self, _file: &str, _key: &str) -> Result<(), crate::runtime::StoreError> {
            Ok(())
        }
        fn store_save(&self, _file: &str) -> Result<(), crate::runtime::StoreError> {
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
            steps: Vec::new(),
        }
    }

    async fn wait_for_parent_status(app: &AppHandle, task_id: &str, status: &str) {
        for _ in 0..200 {
            if workspace_list_tasks(app.clone())
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
            bulk_sync_title(BulkSyncTrigger::SyncAll, BulkSyncOperation::Sync),
            "同步全部仓库"
        );
        assert_eq!(bulk_sync_priority(BulkSyncTrigger::AutoSync), "normal");
    }

    #[tokio::test]
    async fn aggregation_preserves_input_order_and_projects_partial_failure() {
        let app = test_app();
        let parent = VisibleOperationGroup::new(
            app.clone(),
            VisibleOperation::new("sync", "bulk aggregate ordering").priority("high"),
            None,
        );
        parent.mark_running(None);
        let parent_id = parent.task_id().to_string();
        let submitted = vec![
            SubmittedBulkRepo::Result(Box::new(result("third", "success"))),
            SubmittedBulkRepo::Result(Box::new(result("first", "error"))),
            SubmittedBulkRepo::Result(Box::new(result("second", "success"))),
        ];

        let results = aggregate_bulk_sync(parent, submitted).await.unwrap();

        assert_eq!(
            results
                .iter()
                .map(|result| result.repo_id.as_str())
                .collect::<Vec<_>>(),
            vec!["third", "first", "second"]
        );
        wait_for_parent_status(&app, &parent_id, "error").await;
    }

    #[tokio::test]
    async fn detached_aggregation_finishes_parent_after_command_waiter_is_dropped() {
        let app = test_app();
        let parent = VisibleOperationGroup::new(
            app.clone(),
            VisibleOperation::new("sync", "detached bulk aggregation").priority("high"),
            None,
        );
        parent.mark_running(None);
        let parent_id = parent.task_id().to_string();
        let waiter = tokio::spawn(aggregate_bulk_sync(
            parent,
            vec![SubmittedBulkRepo::Result(Box::new(result(
                "repo", "success",
            )))],
        ));

        drop(waiter);

        wait_for_parent_status(&app, &parent_id, "success").await;
    }
}

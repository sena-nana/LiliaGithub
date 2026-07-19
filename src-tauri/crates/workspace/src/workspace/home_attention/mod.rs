mod aggregate;
mod pull_requests;
mod time;
mod workflows;

use std::collections::BTreeSet;

use lilia_github_contracts::home_attention::GitHubHomeAttentionResult;

use self::aggregate::normalize_repository_batch;
use self::pull_requests::scan_pending_pull_requests;
use self::workflows::scan_failed_workflows;
use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::operations::{
    OperationTaskCompletion, VisibleOperation, VisibleOperationGroup,
};

pub async fn github_list_home_attention(
    app: AppHandle,
    repo_full_names: Vec<String>,
    force_refresh: Option<bool>,
) -> Result<GitHubHomeAttentionResult, String> {
    let repositories = normalize_repository_batch(repo_full_names);
    let repository_count = repositories.len();
    let group = VisibleOperationGroup::new(
        app.clone(),
        VisibleOperation::new("github", "更新首页待处理").priority("low"),
        Some(format!("等待扫描 {repository_count} 个仓库")),
    );
    group
        .run(
            move || async move {
                let (pending_pull_requests, failed_workflows) = tokio::join!(
                    scan_pending_pull_requests(app.clone(), repositories.clone(), force_refresh),
                    scan_failed_workflows(app, repositories, force_refresh),
                );
                Ok(GitHubHomeAttentionResult {
                    pending_pull_requests,
                    failed_workflows,
                })
            },
            scan_completion,
        )
        .await
}

fn scan_completion(result: &GitHubHomeAttentionResult) -> OperationTaskCompletion {
    let failures = scan_failure_repositories(result);
    let requested = result.pending_pull_requests.requested_repository_count;
    if failures.is_empty() {
        OperationTaskCompletion::Success(format!("已扫描 {requested} 个仓库"))
    } else {
        OperationTaskCompletion::Error(format!("{} 个仓库扫描不完整", failures.len()))
    }
}

fn scan_failure_repositories(result: &GitHubHomeAttentionResult) -> BTreeSet<&str> {
    [
        &result.pending_pull_requests.failures,
        &result.failed_workflows.failures,
    ]
    .into_iter()
    .flat_map(|failures| failures.iter())
    .map(|failure| failure.repo_full_name.as_str())
    .collect()
}

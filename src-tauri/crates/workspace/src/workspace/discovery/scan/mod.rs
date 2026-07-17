mod aggregate;
mod issues;
mod pull_requests;
mod releases;
mod repository_status;
mod time;
mod workflows;

use std::collections::BTreeSet;

use lilia_github_contracts::discovery::{GitHubDiscoveryScanRequest, GitHubDiscoveryScanResult};

use self::aggregate::normalize_repository_batch;
use self::issues::scan_assigned_issues;
use self::pull_requests::scan_pending_pull_requests;
use self::releases::scan_recent_releases;
use self::repository_status::scan_repository_statuses;
use self::workflows::scan_failed_workflows;
use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::operations::{
    OperationTaskCompletion, VisibleOperation, VisibleOperationGroup,
};

pub async fn github_discovery_scan(
    app: AppHandle,
    request: GitHubDiscoveryScanRequest,
) -> Result<GitHubDiscoveryScanResult, String> {
    let repositories = normalize_repository_batch(request.repo_full_names);
    let repository_count = repositories.len();
    let force_refresh = request.force_refresh;
    let group = VisibleOperationGroup::new(
        app.clone(),
        VisibleOperation::new("github", "更新发现").priority("low"),
        Some(format!("等待扫描 {repository_count} 个仓库")),
    );
    group
        .run(
            move || async move {
                let (
                    pending_pull_requests,
                    assigned_issues,
                    failed_workflows,
                    recent_releases,
                    repository_statuses,
                ) = tokio::join!(
                    scan_pending_pull_requests(app.clone(), repositories.clone(), force_refresh),
                    scan_assigned_issues(app.clone(), repositories.clone(), force_refresh),
                    scan_failed_workflows(app.clone(), repositories.clone(), force_refresh),
                    scan_recent_releases(app.clone(), repositories.clone(), force_refresh),
                    scan_repository_statuses(app, repositories, force_refresh),
                );
                Ok(GitHubDiscoveryScanResult {
                    pending_pull_requests,
                    assigned_issues,
                    failed_workflows,
                    recent_releases,
                    repository_statuses,
                })
            },
            scan_completion,
        )
        .await
}

fn scan_completion(result: &GitHubDiscoveryScanResult) -> OperationTaskCompletion {
    let failures = scan_failure_repositories(result);
    let requested = result.pending_pull_requests.requested_repository_count;
    if failures.is_empty() {
        OperationTaskCompletion::Success(format!("已扫描 {requested} 个仓库"))
    } else {
        OperationTaskCompletion::Error(format!("{} 个仓库扫描不完整", failures.len()))
    }
}

fn scan_failure_repositories(result: &GitHubDiscoveryScanResult) -> BTreeSet<&str> {
    [
        &result.pending_pull_requests.failures,
        &result.assigned_issues.failures,
        &result.failed_workflows.failures,
        &result.recent_releases.failures,
        &result.repository_statuses.failures,
    ]
    .into_iter()
    .flat_map(|failures| failures.iter())
    .map(|failure| failure.repo_full_name.as_str())
    .collect()
}

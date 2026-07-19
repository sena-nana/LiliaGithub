use serde::{Deserialize, Serialize};

use crate::workspace::{GitHubPullRequest, GitHubWorkflowRun};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GitHubHomeAttentionPullRequestReason {
    ReviewRequested,
    Assigned,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubHomeAttentionRepositoryFailure {
    pub repo_full_name: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubHomeAttentionSection<T> {
    pub items: Vec<T>,
    pub failures: Vec<GitHubHomeAttentionRepositoryFailure>,
    pub truncated: bool,
    pub requested_repository_count: usize,
    pub successful_repository_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubHomeAttentionPendingPullRequest {
    pub repo_full_name: String,
    pub pull_request: GitHubPullRequest,
    pub reasons: Vec<GitHubHomeAttentionPullRequestReason>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubHomeAttentionWorkflowRun {
    pub repo_full_name: String,
    pub run: GitHubWorkflowRun,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubHomeAttentionResult {
    pub pending_pull_requests: GitHubHomeAttentionSection<GitHubHomeAttentionPendingPullRequest>,
    pub workflow_runs: GitHubHomeAttentionSection<GitHubHomeAttentionWorkflowRun>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pull_request_reasons_use_the_public_snake_case_values() {
        assert_eq!(
            serde_json::to_value([
                GitHubHomeAttentionPullRequestReason::ReviewRequested,
                GitHubHomeAttentionPullRequestReason::Assigned,
            ])
            .unwrap(),
            serde_json::json!(["review_requested", "assigned"])
        );
    }
}

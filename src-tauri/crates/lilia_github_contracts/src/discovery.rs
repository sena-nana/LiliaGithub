use serde::{Deserialize, Serialize};

use crate::workspace::{
    GitHubIssue, GitHubPullRequest, GitHubRelease, GitHubRepositoryPermissions, GitHubWorkflowRun,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDiscoveryRepositoryStatus {
    pub full_name: String,
    pub updated_at: String,
    pub private: bool,
    pub archived: bool,
    pub disabled: bool,
    pub permissions: GitHubRepositoryPermissions,
    pub allow_merge_commit: bool,
    pub allow_squash_merge: bool,
    pub allow_rebase_merge: bool,
    pub html_url: String,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GitHubPullRequestReviewEvent {
    Approve,
    RequestChanges,
    Comment,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubSubmitPullRequestReviewRequest {
    pub event: GitHubPullRequestReviewEvent,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDiscoveryScanRequest {
    #[serde(default)]
    pub repo_full_names: Vec<String>,
    #[serde(default)]
    pub force_refresh: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDiscoveryRepositoryFailure {
    pub repo_full_name: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDiscoverySection<T> {
    pub items: Vec<T>,
    pub failures: Vec<GitHubDiscoveryRepositoryFailure>,
    pub truncated: bool,
    pub requested_repository_count: usize,
    pub successful_repository_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDiscoveryPendingPullRequest {
    pub repo_full_name: String,
    pub pull_request: GitHubPullRequest,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDiscoveryAssignedIssue {
    pub repo_full_name: String,
    pub issue: GitHubIssue,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDiscoveryFailedWorkflowRun {
    pub repo_full_name: String,
    pub run: GitHubWorkflowRun,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDiscoveryRecentRelease {
    pub repo_full_name: String,
    pub release: GitHubRelease,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDiscoveryRepositoryStatusItem {
    pub repo_full_name: String,
    pub status: GitHubDiscoveryRepositoryStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDiscoveryScanResult {
    pub pending_pull_requests: GitHubDiscoverySection<GitHubDiscoveryPendingPullRequest>,
    pub assigned_issues: GitHubDiscoverySection<GitHubDiscoveryAssignedIssue>,
    pub failed_workflows: GitHubDiscoverySection<GitHubDiscoveryFailedWorkflowRun>,
    pub recent_releases: GitHubDiscoverySection<GitHubDiscoveryRecentRelease>,
    pub repository_statuses: GitHubDiscoverySection<GitHubDiscoveryRepositoryStatusItem>,
}

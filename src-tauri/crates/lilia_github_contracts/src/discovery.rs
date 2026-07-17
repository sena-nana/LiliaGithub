use serde::{Deserialize, Serialize};

use crate::workspace::GitHubRepositoryPermissions;

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

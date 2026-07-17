use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPullRequestCodeReviewDetail {
    pub files: Vec<GitHubPullRequestChangedFile>,
    pub reviews: Vec<GitHubPullRequestReview>,
    pub threads: Vec<GitHubPullRequestReviewThread>,
    #[serde(default)]
    pub review_decision: Option<String>,
    #[serde(default)]
    pub mergeable: Option<bool>,
    #[serde(default)]
    pub merge_state_status: Option<String>,
    pub base_branch: String,
    pub base_sha: String,
    pub head_sha: String,
    pub branch_protection: GitHubPullRequestBranchProtectionSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPullRequestChangedFile {
    pub sha: String,
    pub filename: String,
    pub status: String,
    pub additions: u64,
    pub deletions: u64,
    pub changes: u64,
    #[serde(default)]
    pub blob_url: Option<String>,
    #[serde(default)]
    pub raw_url: Option<String>,
    #[serde(default)]
    pub patch: Option<String>,
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPullRequestReview {
    pub id: u64,
    pub author: String,
    pub state: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub submitted_at: Option<String>,
    #[serde(default)]
    pub html_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPullRequestReviewThread {
    pub id: String,
    pub is_resolved: bool,
    #[serde(default)]
    pub is_outdated: bool,
    pub path: String,
    #[serde(default)]
    pub line: Option<u64>,
    #[serde(default)]
    pub original_line: Option<u64>,
    #[serde(default)]
    pub side: Option<String>,
    #[serde(default)]
    pub diff_hunk: Option<String>,
    pub comments: Vec<GitHubPullRequestReviewComment>,
    #[serde(default)]
    pub comments_truncated: bool,
    #[serde(default)]
    pub comments_unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPullRequestReviewComment {
    pub id: String,
    #[serde(default)]
    pub database_id: Option<u64>,
    pub author: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
    pub html_url: String,
    #[serde(default)]
    pub reply_to_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPullRequestBranchProtectionSummary {
    pub available: bool,
    pub protected: bool,
    #[serde(default)]
    pub required_approvals: u64,
    #[serde(default)]
    pub require_code_owner_reviews: bool,
    #[serde(default)]
    pub required_status_checks: Vec<String>,
    #[serde(default)]
    pub enforce_admins: bool,
    #[serde(default)]
    pub require_conversation_resolution: bool,
    #[serde(default)]
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum GitHubPullRequestDiffSide {
    Left,
    Right,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCreatePullRequestLineCommentRequest {
    pub body: String,
    pub commit_id: String,
    pub path: String,
    pub line: u64,
    pub side: GitHubPullRequestDiffSide,
    #[serde(default)]
    pub start_line: Option<u64>,
    #[serde(default)]
    pub start_side: Option<GitHubPullRequestDiffSide>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubReplyPullRequestReviewThreadRequest {
    pub thread_id: String,
    pub body: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GitHubPullRequestCodeReviewEvent {
    Approve,
    RequestChanges,
    Comment,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubSubmitPullRequestCodeReviewRequest {
    pub event: GitHubPullRequestCodeReviewEvent,
    #[serde(default)]
    pub body: Option<String>,
}

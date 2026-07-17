use std::collections::HashSet;

use lilia_github_contracts::code_review::{
    GitHubPullRequestBranchProtectionSummary, GitHubPullRequestChangedFile,
    GitHubPullRequestReview, GitHubPullRequestReviewComment,
};
use serde::Deserialize;
use serde_json::Value as JsonValue;

pub(super) const MAX_INLINE_PATCH_BYTES: usize = 120_000;
pub(super) const MAX_INLINE_PATCH_CHANGES: u64 = 2_000;

#[derive(Debug, Deserialize)]
pub(super) struct PullRequestRefResponse {
    #[serde(rename = "ref")]
    pub(super) branch: String,
    pub(super) sha: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct PullRequestResponse {
    pub(super) base: PullRequestRefResponse,
    pub(super) head: PullRequestRefResponse,
    #[serde(default)]
    pub(super) mergeable: Option<bool>,
    #[serde(default)]
    pub(super) mergeable_state: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct ChangedFileResponse {
    pub(super) sha: String,
    pub(super) filename: String,
    pub(super) status: String,
    pub(super) additions: u64,
    pub(super) deletions: u64,
    pub(super) changes: u64,
    #[serde(default)]
    pub(super) blob_url: Option<String>,
    #[serde(default)]
    pub(super) raw_url: Option<String>,
    #[serde(default)]
    pub(super) patch: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct ActorResponse {
    pub(super) login: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct ReviewResponse {
    pub(super) id: u64,
    #[serde(default)]
    pub(super) user: Option<ActorResponse>,
    pub(super) state: String,
    #[serde(default)]
    pub(super) body: Option<String>,
    #[serde(default)]
    pub(super) submitted_at: Option<String>,
    #[serde(default)]
    pub(super) html_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct RestCommentResponse {
    pub(super) id: u64,
    #[serde(default)]
    pub(super) node_id: Option<String>,
    #[serde(default)]
    pub(super) user: Option<ActorResponse>,
    pub(super) body: String,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    pub(super) html_url: String,
    #[serde(default)]
    pub(super) in_reply_to_id: Option<u64>,
}

pub(super) fn changed_file_from_response(
    file: ChangedFileResponse,
) -> GitHubPullRequestChangedFile {
    let patch_too_large = file
        .patch
        .as_ref()
        .is_some_and(|patch| patch.len() > MAX_INLINE_PATCH_BYTES)
        || file.changes > MAX_INLINE_PATCH_CHANGES;
    let patch_missing = file.patch.is_none() && file.changes > 0;
    GitHubPullRequestChangedFile {
        sha: file.sha,
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        blob_url: file.blob_url,
        raw_url: file.raw_url,
        patch: if patch_too_large { None } else { file.patch },
        truncated: patch_too_large || patch_missing,
    }
}

pub(super) fn review_from_response(review: ReviewResponse) -> GitHubPullRequestReview {
    GitHubPullRequestReview {
        id: review.id,
        author: review
            .user
            .map(|user| user.login)
            .unwrap_or_else(|| "ghost".to_string()),
        state: review.state,
        body: review.body.and_then(non_empty),
        submitted_at: review.submitted_at,
        html_url: review.html_url,
    }
}

pub(super) fn non_empty(value: String) -> Option<String> {
    let value = value.trim().to_string();
    (!value.is_empty()).then_some(value)
}

pub(super) fn rest_comment(comment: RestCommentResponse) -> GitHubPullRequestReviewComment {
    GitHubPullRequestReviewComment {
        id: comment.node_id.unwrap_or_else(|| comment.id.to_string()),
        database_id: Some(comment.id),
        author: comment
            .user
            .map(|user| user.login)
            .unwrap_or_else(|| "ghost".to_string()),
        body: comment.body,
        created_at: comment.created_at,
        updated_at: comment.updated_at,
        html_url: comment.html_url,
        reply_to_id: comment.in_reply_to_id.map(|id| id.to_string()),
    }
}

pub(super) fn branch_protection_summary(
    protection: Option<JsonValue>,
) -> GitHubPullRequestBranchProtectionSummary {
    let Some(protection) = protection else {
        return GitHubPullRequestBranchProtectionSummary {
            available: true,
            protected: false,
            ..Default::default()
        };
    };
    let review = protection.get("required_pull_request_reviews");
    let required_approvals = review
        .and_then(|value| value.get("required_approving_review_count"))
        .and_then(JsonValue::as_u64)
        .unwrap_or_default();
    let require_code_owner_reviews = review
        .and_then(|value| value.get("require_code_owner_reviews"))
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);
    let status_checks = protection.get("required_status_checks");
    let mut required_status_checks = status_checks
        .and_then(|value| value.get("contexts"))
        .and_then(JsonValue::as_array)
        .into_iter()
        .flatten()
        .filter_map(JsonValue::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    required_status_checks.extend(
        status_checks
            .and_then(|value| value.get("checks"))
            .and_then(JsonValue::as_array)
            .into_iter()
            .flatten()
            .filter_map(|value| value.get("context").and_then(JsonValue::as_str))
            .map(str::to_string),
    );
    let mut seen = HashSet::new();
    required_status_checks.retain(|value| seen.insert(value.clone()));
    let enforce_admins = protection
        .get("enforce_admins")
        .and_then(|value| value.get("enabled"))
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);
    let require_conversation_resolution = protection
        .get("required_conversation_resolution")
        .and_then(|value| value.get("enabled"))
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);
    GitHubPullRequestBranchProtectionSummary {
        available: true,
        protected: true,
        required_approvals,
        require_code_owner_reviews,
        required_status_checks,
        enforce_admins,
        require_conversation_resolution,
        unavailable_reason: None,
    }
}

pub(super) fn unavailable_branch_protection(
    reason: String,
) -> GitHubPullRequestBranchProtectionSummary {
    GitHubPullRequestBranchProtectionSummary {
        available: false,
        unavailable_reason: Some(reason),
        ..Default::default()
    }
}

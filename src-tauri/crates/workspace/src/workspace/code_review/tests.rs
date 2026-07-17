use lilia_github_contracts::code_review::{
    GitHubCreatePullRequestLineCommentRequest, GitHubPullRequestCodeReviewEvent,
    GitHubPullRequestDiffSide, GitHubSubmitPullRequestCodeReviewRequest,
};
use serde_json::json;

use super::graphql::{GraphQlPageInfo, ReviewCommentPagination, MAX_REVIEW_THREAD_COMMENT_PAGES};
use super::mapping::{
    branch_protection_summary, changed_file_from_response, ChangedFileResponse,
    MAX_INLINE_PATCH_BYTES,
};
use super::mutations::{line_comment_payload, submit_review_payload};

fn changed_file(patch: Option<String>, changes: u64) -> ChangedFileResponse {
    ChangedFileResponse {
        sha: "abc".to_string(),
        filename: "src/lib.rs".to_string(),
        status: "modified".to_string(),
        additions: changes,
        deletions: 0,
        changes,
        blob_url: None,
        raw_url: None,
        patch,
    }
}

#[test]
fn changed_files_degrade_when_patch_is_missing_or_too_large() {
    let missing = changed_file_from_response(changed_file(None, 4));
    assert!(missing.truncated);
    assert!(missing.patch.is_none());

    let large = changed_file_from_response(changed_file(
        Some("x".repeat(MAX_INLINE_PATCH_BYTES + 1)),
        4,
    ));
    assert!(large.truncated);
    assert!(large.patch.is_none());

    let normal = changed_file_from_response(changed_file(Some("@@ -1 +1 @@".to_string()), 1));
    assert!(!normal.truncated);
    assert!(normal.patch.is_some());
}

#[test]
fn branch_protection_summary_collects_review_and_check_requirements() {
    let summary = branch_protection_summary(Some(json!({
        "required_pull_request_reviews": {
            "required_approving_review_count": 2,
            "require_code_owner_reviews": true
        },
        "required_status_checks": {
            "contexts": ["build"],
            "checks": [{ "context": "build" }, { "context": "test" }]
        },
        "enforce_admins": { "enabled": true },
        "required_conversation_resolution": { "enabled": true }
    })));
    assert!(summary.available);
    assert!(summary.protected);
    assert_eq!(summary.required_approvals, 2);
    assert!(summary.require_code_owner_reviews);
    assert_eq!(summary.required_status_checks, vec!["build", "test"]);
    assert!(summary.enforce_admins);
    assert!(summary.require_conversation_resolution);
}

#[test]
fn line_comment_payload_validates_body_location_and_multiline_shape() {
    let payload = line_comment_payload(GitHubCreatePullRequestLineCommentRequest {
        body: "  explain this  ".to_string(),
        commit_id: "abc".to_string(),
        path: "src/lib.rs".to_string(),
        line: 8,
        side: GitHubPullRequestDiffSide::Right,
        start_line: Some(6),
        start_side: Some(GitHubPullRequestDiffSide::Right),
    })
    .unwrap();
    assert_eq!(payload["body"], "explain this");
    assert_eq!(payload["line"], 8);
    assert_eq!(payload["side"], "RIGHT");
    assert_eq!(payload["start_line"], 6);

    assert!(
        line_comment_payload(GitHubCreatePullRequestLineCommentRequest {
            body: " ".to_string(),
            commit_id: "abc".to_string(),
            path: "src/lib.rs".to_string(),
            line: 8,
            side: GitHubPullRequestDiffSide::Right,
            start_line: None,
            start_side: None,
        })
        .is_err()
    );
}

#[test]
fn submit_review_requires_explanation_for_changes_and_comment() {
    assert_eq!(
        submit_review_payload(GitHubSubmitPullRequestCodeReviewRequest {
            event: GitHubPullRequestCodeReviewEvent::Approve,
            body: None,
        })
        .unwrap(),
        json!({ "event": "APPROVE" })
    );
    assert!(
        submit_review_payload(GitHubSubmitPullRequestCodeReviewRequest {
            event: GitHubPullRequestCodeReviewEvent::RequestChanges,
            body: Some(" ".to_string()),
        })
        .is_err()
    );
    assert_eq!(
        submit_review_payload(GitHubSubmitPullRequestCodeReviewRequest {
            event: GitHubPullRequestCodeReviewEvent::Comment,
            body: Some(" note ".to_string()),
        })
        .unwrap(),
        json!({ "event": "COMMENT", "body": "note" })
    );
}

#[test]
fn review_comment_pagination_stops_at_the_page_budget_and_rejects_bad_cursors() {
    let mut pagination = ReviewCommentPagination::new();
    for index in 1..MAX_REVIEW_THREAD_COMMENT_PAGES {
        let cursor = format!("cursor-{index}");
        assert_eq!(
            pagination
                .next_cursor(&GraphQlPageInfo {
                    has_next_page: true,
                    end_cursor: Some(cursor.clone()),
                })
                .unwrap(),
            Some(cursor)
        );
    }
    assert!(pagination
        .next_cursor(&GraphQlPageInfo {
            has_next_page: true,
            end_cursor: Some("cursor-over-budget".to_string()),
        })
        .unwrap_err()
        .contains("500"));

    let mut repeated = ReviewCommentPagination::new();
    let page = GraphQlPageInfo {
        has_next_page: true,
        end_cursor: Some("same-cursor".to_string()),
    };
    assert!(repeated.next_cursor(&page).unwrap().is_some());
    assert!(repeated.next_cursor(&page).is_err());

    let mut missing = ReviewCommentPagination::new();
    assert!(missing
        .next_cursor(&GraphQlPageInfo {
            has_next_page: true,
            end_cursor: None,
        })
        .is_err());
}

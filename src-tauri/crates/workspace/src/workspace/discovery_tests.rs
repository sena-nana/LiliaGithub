use super::*;

fn review(
    event: GitHubPullRequestReviewEvent,
    body: Option<&str>,
) -> GitHubSubmitPullRequestReviewRequest {
    GitHubSubmitPullRequestReviewRequest {
        event,
        body: body.map(str::to_string),
    }
}

#[test]
fn maps_repository_status_response() {
    let status = repository_status_from_response(RepositoryStatusResponse {
        full_name: "lilia/app".to_string(),
        updated_at: "2026-07-17T00:00:00Z".to_string(),
        private: true,
        archived: false,
        disabled: false,
        permissions: GitHubRepositoryPermissions {
            pull: true,
            push: true,
            admin: false,
        },
        allow_merge_commit: false,
        allow_squash_merge: true,
        allow_rebase_merge: true,
        html_url: "https://github.com/lilia/app".to_string(),
    });

    assert_eq!(status.full_name, "lilia/app");
    assert!(status.private);
    assert!(status.permissions.push);
    assert!(!status.allow_merge_commit);
    assert!(status.allow_squash_merge);
}

#[test]
fn review_payload_maps_events_and_trims_body() {
    assert_eq!(
        review_payload(review(GitHubPullRequestReviewEvent::Approve, None)).unwrap(),
        serde_json::json!({ "event": "APPROVE" })
    );
    assert_eq!(
        review_payload(review(
            GitHubPullRequestReviewEvent::RequestChanges,
            Some("  revise  ")
        ))
        .unwrap(),
        serde_json::json!({ "event": "REQUEST_CHANGES", "body": "revise" })
    );
    assert_eq!(
        review_payload(review(
            GitHubPullRequestReviewEvent::Comment,
            Some(" note ")
        ))
        .unwrap(),
        serde_json::json!({ "event": "COMMENT", "body": "note" })
    );
}

#[test]
fn review_request_deserializes_public_event_names() {
    let request = serde_json::from_value::<GitHubSubmitPullRequestReviewRequest>(
        serde_json::json!({ "event": "request_changes", "body": "revise" }),
    )
    .unwrap();

    assert_eq!(request.event, GitHubPullRequestReviewEvent::RequestChanges);
}

#[test]
fn review_payload_requires_body_for_changes_and_comments() {
    assert!(review_payload(review(
        GitHubPullRequestReviewEvent::RequestChanges,
        Some("  ")
    ))
    .is_err());
    assert!(review_payload(review(GitHubPullRequestReviewEvent::Comment, None)).is_err());
}

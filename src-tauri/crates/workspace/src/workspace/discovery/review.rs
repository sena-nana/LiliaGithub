use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::github::{
    build_client, clear_github_project_pull_request_cache, github_headers, github_json,
    github_repo_api_url, github_require_token, github_send,
};
use crate::workspace::operations::OperationKind;
use crate::workspace::run_core_operation;
use lilia_github_contracts::discovery::{
    GitHubPullRequestReviewEvent, GitHubSubmitPullRequestReviewRequest,
};

fn review_payload(
    request: GitHubSubmitPullRequestReviewRequest,
) -> Result<serde_json::Value, String> {
    let body = request
        .body
        .map(|body| body.trim().to_string())
        .filter(|body| !body.is_empty());
    let event = match request.event {
        GitHubPullRequestReviewEvent::Approve => "APPROVE",
        GitHubPullRequestReviewEvent::RequestChanges => {
            if body.is_none() {
                return Err("请求修改时必须填写说明".to_string());
            }
            "REQUEST_CHANGES"
        }
        GitHubPullRequestReviewEvent::Comment => {
            if body.is_none() {
                return Err("提交评论时必须填写内容".to_string());
            }
            "COMMENT"
        }
    };
    let mut payload = serde_json::json!({ "event": event });
    if let Some(body) = body {
        payload["body"] = serde_json::Value::String(body);
    }
    Ok(payload)
}

pub async fn github_discovery_submit_pull_request_review(
    app: AppHandle,
    repo_full_name: String,
    pull_number: u64,
    request: GitHubSubmitPullRequestReviewRequest,
) -> Result<(), String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "提交 Pull Request Review",
        move || {
            if pull_number == 0 {
                return Err("Pull Request 编号不合法".to_string());
            }
            let payload = review_payload(request)?;
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "提交 Pull Request Review 失败",
                github_headers(
                    client
                        .post(format!(
                            "{}/pulls/{pull_number}/reviews",
                            github_repo_api_url(&repo_full_name)?
                        ))
                        .json(&payload),
                    Some(&token),
                ),
            )?;
            let _: serde_json::Value = github_json("提交 Pull Request Review 失败", response)?;
            clear_github_project_pull_request_cache(&app, &repo_full_name)?;
            Ok(())
        },
    )
    .await
}

#[cfg(test)]
mod tests {
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
    fn review_payload_requires_body_for_changes_and_comments() {
        assert!(review_payload(review(
            GitHubPullRequestReviewEvent::RequestChanges,
            Some("  ")
        ))
        .is_err());
        assert!(review_payload(review(GitHubPullRequestReviewEvent::Comment, None)).is_err());
    }
}

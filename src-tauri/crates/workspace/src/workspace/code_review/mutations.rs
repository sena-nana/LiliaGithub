use lilia_github_contracts::code_review::{
    GitHubCreatePullRequestLineCommentRequest, GitHubPullRequestCodeReviewEvent,
    GitHubPullRequestReview, GitHubPullRequestReviewComment,
    GitHubReplyPullRequestReviewThreadRequest, GitHubSubmitPullRequestCodeReviewRequest,
};
use serde_json::{json, Value as JsonValue};

use super::graphql::reply_to_review_thread;
use super::mapping::{
    non_empty, rest_comment, review_from_response, RestCommentResponse, ReviewResponse,
};
use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::github::{
    build_client, clear_github_project_pull_request_cache, github_headers, github_json,
    github_repo_api_url, github_require_scope, github_require_token, github_send,
    GITHUB_REPO_SCOPE,
};
use crate::workspace::operations::OperationKind;
use crate::workspace::run_core_operation;

pub(super) fn line_comment_payload(
    request: GitHubCreatePullRequestLineCommentRequest,
) -> Result<JsonValue, String> {
    let body = non_empty(request.body).ok_or_else(|| "行评论内容不能为空".to_string())?;
    let commit_id = non_empty(request.commit_id)
        .ok_or_else(|| "Pull Request head commit 不可用，请刷新后重试".to_string())?;
    let path = non_empty(request.path).ok_or_else(|| "评论文件路径不能为空".to_string())?;
    if request.line == 0 {
        return Err("评论行号不合法".to_string());
    }
    if request
        .start_line
        .is_some_and(|start| start == 0 || start > request.line)
    {
        return Err("评论起始行号不合法".to_string());
    }
    if request.start_line.is_some() != request.start_side.is_some() {
        return Err("多行评论必须同时提供起始行和起始侧".to_string());
    }
    let mut payload = json!({
        "body": body,
        "commit_id": commit_id,
        "path": path,
        "line": request.line,
        "side": request.side,
    });
    if let Some(start_line) = request.start_line {
        payload["start_line"] = json!(start_line);
        payload["start_side"] = json!(request.start_side);
    }
    Ok(payload)
}

pub async fn github_create_pull_request_line_comment(
    app: AppHandle,
    repo_full_name: String,
    pull_number: u64,
    request: GitHubCreatePullRequestLineCommentRequest,
) -> Result<GitHubPullRequestReviewComment, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "提交 Pull Request 行评论",
        move || {
            if pull_number == 0 {
                return Err("Pull Request 编号不合法".to_string());
            }
            let payload = line_comment_payload(request)?;
            let (binding, token) = github_require_token(&app)?;
            github_require_scope(&binding, GITHUB_REPO_SCOPE)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "提交 Pull Request 行评论失败",
                github_headers(
                    client
                        .post(format!(
                            "{}/pulls/{pull_number}/comments",
                            github_repo_api_url(&repo_full_name)?
                        ))
                        .json(&payload),
                    Some(&token),
                ),
            )?;
            let comment =
                github_json::<RestCommentResponse>("提交 Pull Request 行评论失败", response)?;
            clear_github_project_pull_request_cache(&app, &repo_full_name)?;
            Ok(rest_comment(comment))
        },
    )
    .await
}

pub async fn github_reply_pull_request_review_thread(
    app: AppHandle,
    repo_full_name: String,
    request: GitHubReplyPullRequestReviewThreadRequest,
) -> Result<GitHubPullRequestReviewComment, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "回复 Pull Request Review Thread",
        move || {
            let thread_id = non_empty(request.thread_id)
                .ok_or_else(|| "Review Thread 不可用，请刷新后重试".to_string())?;
            let body = non_empty(request.body).ok_or_else(|| "回复内容不能为空".to_string())?;
            let (binding, token) = github_require_token(&app)?;
            github_require_scope(&binding, GITHUB_REPO_SCOPE)?;
            let client = build_client()?;
            let comment = reply_to_review_thread(&app, &client, &token, &thread_id, &body)?;
            clear_github_project_pull_request_cache(&app, &repo_full_name)?;
            Ok(comment)
        },
    )
    .await
}

pub(super) fn submit_review_payload(
    request: GitHubSubmitPullRequestCodeReviewRequest,
) -> Result<JsonValue, String> {
    let body = request.body.and_then(non_empty);
    let event = match request.event {
        GitHubPullRequestCodeReviewEvent::Approve => "APPROVE",
        GitHubPullRequestCodeReviewEvent::RequestChanges => {
            if body.is_none() {
                return Err("请求修改时必须填写说明".to_string());
            }
            "REQUEST_CHANGES"
        }
        GitHubPullRequestCodeReviewEvent::Comment => {
            if body.is_none() {
                return Err("提交评论时必须填写内容".to_string());
            }
            "COMMENT"
        }
    };
    let mut payload = json!({ "event": event });
    if let Some(body) = body {
        payload["body"] = JsonValue::String(body);
    }
    Ok(payload)
}

pub async fn github_submit_pull_request_code_review(
    app: AppHandle,
    repo_full_name: String,
    pull_number: u64,
    request: GitHubSubmitPullRequestCodeReviewRequest,
) -> Result<GitHubPullRequestReview, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "提交 Pull Request Code Review",
        move || {
            if pull_number == 0 {
                return Err("Pull Request 编号不合法".to_string());
            }
            let payload = submit_review_payload(request)?;
            let (binding, token) = github_require_token(&app)?;
            github_require_scope(&binding, GITHUB_REPO_SCOPE)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "提交 Pull Request Code Review 失败",
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
            let review =
                github_json::<ReviewResponse>("提交 Pull Request Code Review 失败", response)?;
            clear_github_project_pull_request_cache(&app, &repo_full_name)?;
            Ok(review_from_response(review))
        },
    )
    .await
}

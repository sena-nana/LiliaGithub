use lilia_github_contracts::workspace::{
    GitHubDiscussionTimelineItem, GitHubIssueCommentReactionRequest, GitHubIssueCommentRequest,
};

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::github::{
    build_client, clear_github_project_issue_cache, clear_github_project_pull_request_cache,
    github_headers, github_http_error, github_json, github_repo_api_url, github_require_token,
    github_send, github_timeline_item_from_response, GitHubIssueTimelineResponse,
};
use crate::workspace::operations::OperationKind;
use crate::workspace::run_core_operation;

fn comment_body(request: GitHubIssueCommentRequest) -> Result<String, String> {
    let body = request.body.trim();
    if body.is_empty() {
        Err("评论内容不能为空".to_string())
    } else {
        Ok(body.to_string())
    }
}

fn validate_comment_id(comment_id: u64) -> Result<u64, String> {
    if comment_id == 0 {
        Err("评论 ID 不合法".to_string())
    } else {
        Ok(comment_id)
    }
}

fn validate_reaction(content: String) -> Result<String, String> {
    const VALUES: [&str; 8] = [
        "+1", "-1", "laugh", "hooray", "confused", "heart", "rocket", "eyes",
    ];
    if VALUES.contains(&content.as_str()) {
        Ok(content)
    } else {
        Err("Reaction 类型不合法".to_string())
    }
}

pub async fn github_create_issue_comment(
    app: AppHandle,
    repo_full_name: String,
    issue_number: u64,
    request: GitHubIssueCommentRequest,
) -> Result<GitHubDiscussionTimelineItem, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "新增 GitHub 评论",
        move || {
            if issue_number == 0 {
                return Err("Issue 或 Pull Request 编号不合法".to_string());
            }
            let body = comment_body(request)?;
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "新增 GitHub 评论失败",
                github_headers(
                    client
                        .post(format!(
                            "{}/issues/{issue_number}/comments",
                            github_repo_api_url(&repo_full_name)?
                        ))
                        .json(&serde_json::json!({ "body": body })),
                    Some(&token),
                ),
            )?;
            let comment =
                github_json::<GitHubIssueTimelineResponse>("新增 GitHub 评论失败", response)?;
            clear_comment_caches(&app, &repo_full_name)?;
            Ok(github_timeline_item_from_response(comment))
        },
    )
    .await
}

pub async fn github_update_issue_comment(
    app: AppHandle,
    repo_full_name: String,
    comment_id: u64,
    request: GitHubIssueCommentRequest,
) -> Result<GitHubDiscussionTimelineItem, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "编辑 GitHub 评论",
        move || {
            let comment_id = validate_comment_id(comment_id)?;
            let body = comment_body(request)?;
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "编辑 GitHub 评论失败",
                github_headers(
                    client
                        .patch(format!(
                            "{}/issues/comments/{comment_id}",
                            github_repo_api_url(&repo_full_name)?
                        ))
                        .json(&serde_json::json!({ "body": body })),
                    Some(&token),
                ),
            )?;
            let comment =
                github_json::<GitHubIssueTimelineResponse>("编辑 GitHub 评论失败", response)?;
            clear_comment_caches(&app, &repo_full_name)?;
            Ok(github_timeline_item_from_response(comment))
        },
    )
    .await
}

pub async fn github_delete_issue_comment(
    app: AppHandle,
    repo_full_name: String,
    comment_id: u64,
) -> Result<(), String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "删除 GitHub 评论",
        move || {
            let comment_id = validate_comment_id(comment_id)?;
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "删除 GitHub 评论失败",
                github_headers(
                    client.delete(format!(
                        "{}/issues/comments/{comment_id}",
                        github_repo_api_url(&repo_full_name)?
                    )),
                    Some(&token),
                ),
            )?;
            if !response.status().is_success() {
                return Err(github_http_error("删除 GitHub 评论失败", response));
            }
            clear_comment_caches(&app, &repo_full_name)
        },
    )
    .await
}

pub async fn github_add_issue_comment_reaction(
    app: AppHandle,
    repo_full_name: String,
    comment_id: u64,
    request: GitHubIssueCommentReactionRequest,
) -> Result<(), String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "添加 GitHub Reaction",
        move || {
            let comment_id = validate_comment_id(comment_id)?;
            let content = validate_reaction(request.content)?;
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "添加 GitHub Reaction 失败",
                github_headers(
                    client
                        .post(format!(
                            "{}/issues/comments/{comment_id}/reactions",
                            github_repo_api_url(&repo_full_name)?
                        ))
                        .json(&serde_json::json!({ "content": content })),
                    Some(&token),
                ),
            )?;
            if !response.status().is_success() {
                return Err(github_http_error("添加 GitHub Reaction 失败", response));
            }
            Ok(())
        },
    )
    .await
}

fn clear_comment_caches(app: &AppHandle, repo_full_name: &str) -> Result<(), String> {
    clear_github_project_issue_cache(app, repo_full_name)?;
    clear_github_project_pull_request_cache(app, repo_full_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_comment_writes_before_network_access() {
        assert!(comment_body(GitHubIssueCommentRequest { body: "  ".into() }).is_err());
        assert_eq!(
            comment_body(GitHubIssueCommentRequest {
                body: " hello ".into()
            })
            .unwrap(),
            "hello"
        );
        assert!(validate_comment_id(0).is_err());
        assert!(validate_reaction("heart".into()).is_ok());
        assert!(validate_reaction("like".into()).is_err());
    }
}

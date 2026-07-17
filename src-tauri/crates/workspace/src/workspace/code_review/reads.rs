use lilia_github_contracts::code_review::{
    GitHubPullRequestBranchProtectionSummary, GitHubPullRequestCodeReviewDetail,
};
use reqwest::blocking::Client;

use super::graphql::{fetch_review_graphql, review_thread_from_graphql};
use super::mapping::{
    branch_protection_summary, changed_file_from_response, review_from_response,
    unavailable_branch_protection, ChangedFileResponse, PullRequestResponse, ReviewResponse,
};
use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::github::{
    build_client, github_branch_protection_api_url, github_branch_protection_from_response,
    github_fetch_paginated, github_headers, github_json, github_repo_api_url, github_require_token,
    github_send,
};
use crate::workspace::operations::OperationKind;
use crate::workspace::run_core_operation;

fn fetch_branch_protection(
    app: &AppHandle,
    client: &Client,
    token: &str,
    repo_full_name: &str,
    branch: &str,
) -> GitHubPullRequestBranchProtectionSummary {
    let result = (|| {
        let response = github_send(
            app,
            "读取 GitHub 分支保护失败",
            github_headers(
                client.get(github_branch_protection_api_url(repo_full_name, branch)?),
                Some(token),
            ),
        )?;
        github_branch_protection_from_response("读取 GitHub 分支保护失败", response)
    })();
    match result {
        Ok(protection) => branch_protection_summary(protection),
        Err(error) => unavailable_branch_protection(error),
    }
}

pub async fn github_get_pull_request_code_review(
    app: AppHandle,
    repo_full_name: String,
    pull_number: u64,
) -> Result<GitHubPullRequestCodeReviewDetail, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 Pull Request Code Review",
        move || {
            if pull_number == 0 {
                return Err("Pull Request 编号不合法".to_string());
            }
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let repo_url = github_repo_api_url(&repo_full_name)?;
            let pull_response = github_send(
                &app,
                "读取 Pull Request 合并状态失败",
                github_headers(
                    client.get(format!("{repo_url}/pulls/{pull_number}")),
                    Some(&token),
                ),
            )?;
            let pull = github_json::<PullRequestResponse>(
                "读取 Pull Request 合并状态失败",
                pull_response,
            )?;
            let files = github_fetch_paginated::<ChangedFileResponse>(
                &app,
                &client,
                &token,
                format!("{repo_url}/pulls/{pull_number}/files"),
                "读取 Pull Request Changed Files 失败",
            )?
            .into_iter()
            .map(changed_file_from_response)
            .collect();
            let reviews = github_fetch_paginated::<ReviewResponse>(
                &app,
                &client,
                &token,
                format!("{repo_url}/pulls/{pull_number}/reviews"),
                "读取 Pull Request Reviews 失败",
            )?
            .into_iter()
            .map(review_from_response)
            .collect();
            let graphql =
                fetch_review_graphql(&app, &client, &token, &repo_full_name, pull_number)?;
            let branch_protection =
                fetch_branch_protection(&app, &client, &token, &repo_full_name, &pull.base.branch);
            let graphql_mergeable = graphql.mergeable.as_deref().and_then(|value| match value {
                "MERGEABLE" => Some(true),
                "CONFLICTING" => Some(false),
                _ => None,
            });
            Ok(GitHubPullRequestCodeReviewDetail {
                files,
                reviews,
                threads: graphql
                    .review_threads
                    .nodes
                    .into_iter()
                    .flatten()
                    .map(review_thread_from_graphql)
                    .collect(),
                review_decision: graphql.review_decision,
                mergeable: graphql_mergeable.or(pull.mergeable),
                merge_state_status: graphql
                    .merge_state_status
                    .or_else(|| pull.mergeable_state.map(|value| value.to_ascii_uppercase())),
                base_branch: pull.base.branch,
                base_sha: pull.base.sha,
                head_sha: pull.head.sha,
                branch_protection,
            })
        },
    )
    .await
}

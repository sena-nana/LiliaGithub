use lilia_github_contracts::workspace::{
    GitHubCreateRepositoryDiscussionRequest, GitHubRepositoryDiscussion,
    GitHubRepositoryDiscussionCommentPage, GitHubRepositoryDiscussionMetadata,
    GitHubRepositoryDiscussionPage,
};
use lilia_github_github::discussions::{
    comments_request, create_request, detail_request, list_request, metadata_request,
    parse_comments_response, parse_create_response, parse_detail_response, parse_list_response,
    parse_metadata_response, parse_replies_response, replies_request, GitHubGraphQlRequest,
};
use reqwest::blocking::Client;
use serde_json::Value;

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::github::{
    build_client, github_headers, github_json, github_require_token, github_send,
};
use crate::workspace::operations::OperationKind;
use crate::workspace::run_core_operation;

const GITHUB_GRAPHQL_URL: &str = "https://api.github.com/graphql";

pub async fn github_get_discussion_metadata(
    app: AppHandle,
    repo_full_name: String,
) -> Result<GitHubRepositoryDiscussionMetadata, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Discussion 分类",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let request = metadata_request(&repo_full_name)?;
            let value = send_graphql(
                &app,
                &client,
                &token,
                "读取 GitHub Discussion 分类失败",
                &request,
            )?;
            parse_metadata_response(value)
                .map(|context| context.metadata)
                .map_err(|error| error.contextualize("读取 GitHub Discussion 分类失败"))
        },
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn github_list_discussions(
    app: AppHandle,
    repo_full_name: String,
    first: Option<u32>,
    after: Option<String>,
    category_id: Option<String>,
    answered: Option<bool>,
    state: Option<String>,
    sort: Option<String>,
    direction: Option<String>,
) -> Result<GitHubRepositoryDiscussionPage, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Discussions",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let request = list_request(
                &repo_full_name,
                first,
                after,
                category_id,
                answered,
                state,
                sort,
                direction,
            )?;
            let value = send_graphql(
                &app,
                &client,
                &token,
                "读取 GitHub Discussions 失败",
                &request,
            )?;
            parse_list_response(value)
                .map_err(|error| error.contextualize("读取 GitHub Discussions 失败"))
        },
    )
    .await
}

pub async fn github_get_discussion(
    app: AppHandle,
    repo_full_name: String,
    discussion_number: u64,
) -> Result<GitHubRepositoryDiscussion, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Discussion",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let request = detail_request(&repo_full_name, discussion_number)?;
            let value = send_graphql(
                &app,
                &client,
                &token,
                "读取 GitHub Discussion 失败",
                &request,
            )?;
            parse_detail_response(value)
                .map_err(|error| error.contextualize("读取 GitHub Discussion 失败"))
        },
    )
    .await
}

pub async fn github_list_discussion_comments(
    app: AppHandle,
    repo_full_name: String,
    discussion_number: u64,
    first: Option<u32>,
    after: Option<String>,
) -> Result<GitHubRepositoryDiscussionCommentPage, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Discussion 评论",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let request = comments_request(&repo_full_name, discussion_number, first, after)?;
            let value = send_graphql(
                &app,
                &client,
                &token,
                "读取 GitHub Discussion 评论失败",
                &request,
            )?;
            parse_comments_response(value)
                .map_err(|error| error.contextualize("读取 GitHub Discussion 评论失败"))
        },
    )
    .await
}

pub async fn github_list_discussion_comment_replies(
    app: AppHandle,
    repo_full_name: String,
    comment_id: String,
    first: Option<u32>,
    after: Option<String>,
) -> Result<GitHubRepositoryDiscussionCommentPage, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Discussion 评论回复",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let request = replies_request(comment_id, first, after)?;
            let value = send_graphql(
                &app,
                &client,
                &token,
                "读取 GitHub Discussion 评论回复失败",
                &request,
            )?;
            parse_replies_response(value, &repo_full_name)
                .map_err(|error| error.contextualize("读取 GitHub Discussion 评论回复失败"))
        },
    )
    .await
}

pub async fn github_create_discussion(
    app: AppHandle,
    repo_full_name: String,
    request: GitHubCreateRepositoryDiscussionRequest,
) -> Result<GitHubRepositoryDiscussion, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "创建 GitHub Discussion",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let metadata = metadata_request(&repo_full_name)?;
            let metadata_value = send_graphql(
                &app,
                &client,
                &token,
                "读取 GitHub Discussion 创建信息失败",
                &metadata,
            )?;
            let context = parse_metadata_response(metadata_value)
                .map_err(|error| error.contextualize("读取 GitHub Discussion 创建信息失败"))?;
            let request = create_request(&context, request)?;
            let value = send_graphql(
                &app,
                &client,
                &token,
                "创建 GitHub Discussion 失败",
                &request,
            )?;
            parse_create_response(value)
                .map_err(|error| error.contextualize("创建 GitHub Discussion 失败"))
        },
    )
    .await
}

fn send_graphql(
    app: &AppHandle,
    client: &Client,
    token: &str,
    prefix: &str,
    request: &GitHubGraphQlRequest,
) -> Result<Value, String> {
    let response = github_send(
        app,
        prefix,
        github_headers(
            client.post(GITHUB_GRAPHQL_URL).json(&request.payload()),
            Some(token),
        ),
    )?;
    github_json(prefix, response)
}

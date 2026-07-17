use lilia_github_contracts::workspace::{
    GitHubCreateDiscussionCommentRequest, GitHubCreateRepositoryDiscussionRequest,
    GitHubDiscussionAnswerRequest, GitHubDiscussionReactionRequest, GitHubDiscussionStateRequest,
    GitHubRepositoryDiscussion, GitHubRepositoryDiscussionComment,
    GitHubRepositoryDiscussionCommentPage, GitHubRepositoryDiscussionMetadata,
    GitHubRepositoryDiscussionPage, GitHubUpdateDiscussionCommentRequest,
};
use lilia_github_github::discussions::{
    add_comment_request, answer_request, comments_request, create_request, delete_comment_request,
    detail_request, discussion_state_request, list_request, metadata_request,
    parse_comment_mutation_response, parse_comments_response, parse_create_response,
    parse_detail_response, parse_list_response, parse_metadata_response, parse_mutation_response,
    parse_replies_response, reaction_request, replies_request, update_comment_request,
    GitHubGraphQlRequest,
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

pub async fn github_create_discussion_comment(
    app: AppHandle,
    request: GitHubCreateDiscussionCommentRequest,
) -> Result<GitHubRepositoryDiscussionComment, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "新增 GitHub Discussion 评论",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let graphql =
                add_comment_request(request.discussion_id, request.body, request.reply_to_id)?;
            let value = send_graphql(
                &app,
                &client,
                &token,
                "新增 GitHub Discussion 评论失败",
                &graphql,
            )?;
            parse_comment_mutation_response(value, "addDiscussionComment")
                .map_err(|error| error.contextualize("新增 GitHub Discussion 评论失败"))
        },
    )
    .await
}

pub async fn github_update_discussion_comment(
    app: AppHandle,
    request: GitHubUpdateDiscussionCommentRequest,
) -> Result<GitHubRepositoryDiscussionComment, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "编辑 GitHub Discussion 评论",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let graphql = update_comment_request(request.comment_id, request.body)?;
            let value = send_graphql(
                &app,
                &client,
                &token,
                "编辑 GitHub Discussion 评论失败",
                &graphql,
            )?;
            parse_comment_mutation_response(value, "updateDiscussionComment")
                .map_err(|error| error.contextualize("编辑 GitHub Discussion 评论失败"))
        },
    )
    .await
}

pub async fn github_delete_discussion_comment(
    app: AppHandle,
    comment_id: String,
) -> Result<(), String> {
    run_discussion_mutation(app, "删除 GitHub Discussion 评论", move || {
        delete_comment_request(comment_id)
    })
    .await
}

pub async fn github_update_discussion_reaction(
    app: AppHandle,
    request: GitHubDiscussionReactionRequest,
) -> Result<(), String> {
    run_discussion_mutation(app, "更新 GitHub Discussion Reaction", move || {
        reaction_request(request.subject_id, request.content, request.remove)
    })
    .await
}

pub async fn github_update_discussion_state(
    app: AppHandle,
    request: GitHubDiscussionStateRequest,
) -> Result<(), String> {
    run_discussion_mutation(app, "更新 GitHub Discussion 状态", move || {
        discussion_state_request(request.discussion_id, &request.action)
    })
    .await
}

pub async fn github_update_discussion_answer(
    app: AppHandle,
    request: GitHubDiscussionAnswerRequest,
) -> Result<(), String> {
    run_discussion_mutation(app, "更新 GitHub Discussion 答案", move || {
        answer_request(request.comment_id, request.mark)
    })
    .await
}

async fn run_discussion_mutation<F>(
    app: AppHandle,
    label: &'static str,
    build: F,
) -> Result<(), String>
where
    F: FnOnce() -> Result<GitHubGraphQlRequest, String> + Send + 'static,
{
    run_core_operation(app.clone(), OperationKind::GitHubWrite, label, move || {
        let (_binding, token) = github_require_token(&app)?;
        let client = build_client()?;
        let graphql = build()?;
        let value = send_graphql(&app, &client, &token, label, &graphql)?;
        parse_mutation_response(value).map_err(|error| error.contextualize(label))
    })
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

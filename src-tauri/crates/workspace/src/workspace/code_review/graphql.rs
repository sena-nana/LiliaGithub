use std::collections::HashSet;

use lilia_github_contracts::code_review::{
    GitHubPullRequestReviewComment, GitHubPullRequestReviewThread,
};
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::json;

use super::mapping::{non_empty, ActorResponse};
use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::github::{github_headers, github_json, github_send};

const GRAPHQL_URL: &str = "https://api.github.com/graphql";
pub(super) const MAX_REVIEW_THREAD_COMMENT_PAGES: usize = 5;

const REVIEW_DETAIL_QUERY: &str = r#"
query PullRequestCodeReview($owner: String!, $name: String!, $number: Int!, $threadCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewDecision
      mergeable
      mergeStateStatus
      reviewThreads(first: 100, after: $threadCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          diffSide
          comments(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              databaseId
              body
              createdAt
              updatedAt
              url
              diffHunk
              author { login }
              replyTo { id }
            }
          }
        }
      }
    }
  }
}
"#;

const REVIEW_THREAD_COMMENTS_QUERY: &str = r#"
query PullRequestReviewThreadComments($threadId: ID!, $commentCursor: String) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
      comments(first: 100, after: $commentCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          databaseId
          body
          createdAt
          updatedAt
          url
          diffHunk
          author { login }
          replyTo { id }
        }
      }
    }
  }
}
"#;

const REPLY_THREAD_MUTATION: &str = r#"
mutation ReplyPullRequestReviewThread($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
    comment {
      id
      databaseId
      body
      createdAt
      updatedAt
      url
      author { login }
      replyTo { id }
    }
  }
}
"#;

#[derive(Debug, Deserialize)]
struct GraphQlResponse<T> {
    data: Option<T>,
    #[serde(default)]
    errors: Vec<GraphQlError>,
}

#[derive(Debug, Deserialize)]
struct GraphQlError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct ReviewDetailData {
    repository: Option<ReviewDetailRepository>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewDetailRepository {
    pull_request: Option<ReviewDetailPullRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReviewDetailPullRequest {
    #[serde(default)]
    pub(super) review_decision: Option<String>,
    #[serde(default)]
    pub(super) mergeable: Option<String>,
    #[serde(default)]
    pub(super) merge_state_status: Option<String>,
    pub(super) review_threads: ReviewThreadConnection,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReviewThreadConnection {
    #[serde(default)]
    pub(super) nodes: Vec<Option<ReviewThreadNode>>,
    page_info: GraphQlPageInfo,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GraphQlPageInfo {
    pub(super) has_next_page: bool,
    #[serde(default)]
    pub(super) end_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReviewThreadNode {
    id: String,
    is_resolved: bool,
    #[serde(default)]
    is_outdated: bool,
    path: String,
    #[serde(default)]
    line: Option<u64>,
    #[serde(default)]
    original_line: Option<u64>,
    #[serde(default)]
    diff_side: Option<String>,
    comments: ReviewCommentConnection,
    #[serde(default)]
    comments_truncated: bool,
    #[serde(default)]
    comments_unavailable_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ReviewCommentConnection {
    #[serde(default)]
    nodes: Vec<Option<ReviewCommentNode>>,
    page_info: GraphQlPageInfo,
}

#[derive(Debug, Deserialize)]
struct ReviewThreadCommentsData {
    node: Option<ReviewThreadCommentsNode>,
}

#[derive(Debug, Deserialize)]
struct ReviewThreadCommentsNode {
    comments: ReviewCommentConnection,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewCommentNode {
    id: String,
    #[serde(default)]
    database_id: Option<u64>,
    #[serde(default)]
    author: Option<ActorResponse>,
    body: String,
    created_at: String,
    updated_at: String,
    url: String,
    #[serde(default)]
    diff_hunk: Option<String>,
    #[serde(default)]
    reply_to: Option<GraphQlId>,
}

#[derive(Debug, Deserialize)]
struct GraphQlId {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplyMutationData {
    add_pull_request_review_thread_reply: Option<ReplyMutationPayload>,
}

#[derive(Debug, Deserialize)]
struct ReplyMutationPayload {
    comment: Option<ReviewCommentNode>,
}

fn split_repo_full_name(repo_full_name: &str) -> Result<(&str, &str), String> {
    let (owner, name) = repo_full_name
        .trim()
        .split_once('/')
        .ok_or_else(|| "GitHub 仓库名称必须使用 owner/repo 格式".to_string())?;
    if owner.trim().is_empty() || name.trim().is_empty() || name.contains('/') {
        return Err("GitHub 仓库名称必须使用 owner/repo 格式".to_string());
    }
    Ok((owner, name))
}

fn review_comment_from_graphql(comment: ReviewCommentNode) -> GitHubPullRequestReviewComment {
    GitHubPullRequestReviewComment {
        id: comment.id,
        database_id: comment.database_id,
        author: comment
            .author
            .map(|author| author.login)
            .unwrap_or_else(|| "ghost".to_string()),
        body: comment.body,
        created_at: comment.created_at,
        updated_at: comment.updated_at,
        html_url: comment.url,
        reply_to_id: comment.reply_to.map(|reply| reply.id),
    }
}

pub(super) fn review_thread_from_graphql(
    thread: ReviewThreadNode,
) -> GitHubPullRequestReviewThread {
    let mut diff_hunk = None;
    let comments = thread
        .comments
        .nodes
        .into_iter()
        .flatten()
        .map(|comment| {
            if diff_hunk.is_none() {
                diff_hunk = comment.diff_hunk.clone().and_then(non_empty);
            }
            review_comment_from_graphql(comment)
        })
        .collect();
    GitHubPullRequestReviewThread {
        id: thread.id,
        is_resolved: thread.is_resolved,
        is_outdated: thread.is_outdated,
        path: thread.path,
        line: thread.line,
        original_line: thread.original_line,
        side: thread.diff_side,
        diff_hunk,
        comments,
        comments_truncated: thread.comments_truncated,
        comments_unavailable_reason: thread.comments_unavailable_reason,
    }
}

fn graph_ql_error<T>(prefix: &str, response: &GraphQlResponse<T>) -> Option<String> {
    (!response.errors.is_empty()).then(|| {
        format!(
            "{prefix}：{}",
            response
                .errors
                .iter()
                .map(|error| error.message.as_str())
                .collect::<Vec<_>>()
                .join("；")
        )
    })
}

pub(super) fn fetch_review_graphql(
    app: &AppHandle,
    client: &Client,
    token: &str,
    repo_full_name: &str,
    pull_number: u64,
) -> Result<ReviewDetailPullRequest, String> {
    let (owner, name) = split_repo_full_name(repo_full_name)?;
    let mut cursor: Option<String> = None;
    let mut seen_cursors = HashSet::new();
    let mut detail: Option<ReviewDetailPullRequest> = None;

    loop {
        let response = github_send(
            app,
            "读取 Pull Request Review Threads 失败",
            github_headers(
                client.post(GRAPHQL_URL).json(&json!({
                    "query": REVIEW_DETAIL_QUERY,
                    "variables": {
                        "owner": owner,
                        "name": name,
                        "number": pull_number,
                        "threadCursor": cursor,
                    }
                })),
                Some(token),
            ),
        )?;
        let result = github_json::<GraphQlResponse<ReviewDetailData>>(
            "读取 Pull Request Review Threads 失败",
            response,
        )?;
        if let Some(error) = graph_ql_error("读取 Pull Request Review Threads 失败", &result) {
            return Err(error);
        }
        let mut page = result
            .data
            .and_then(|data| data.repository)
            .and_then(|repository| repository.pull_request)
            .ok_or_else(|| "Pull Request 不存在或无权访问".to_string())?;
        let has_next_page = page.review_threads.page_info.has_next_page;
        let next_cursor = page.review_threads.page_info.end_cursor.clone();
        if let Some(detail) = detail.as_mut() {
            detail
                .review_threads
                .nodes
                .append(&mut page.review_threads.nodes);
        } else {
            detail = Some(page);
        }
        if !has_next_page {
            break;
        }
        let next_cursor = next_cursor
            .ok_or_else(|| "GitHub Review Threads 分页缺少游标，请刷新后重试".to_string())?;
        if !seen_cursors.insert(next_cursor.clone()) {
            return Err("GitHub Review Threads 分页游标重复，请刷新后重试".to_string());
        }
        cursor = Some(next_cursor);
    }

    let mut detail = detail.ok_or_else(|| "Pull Request 不存在或无权访问".to_string())?;
    for thread in detail.review_threads.nodes.iter_mut().flatten() {
        if let Some(reason) =
            fetch_remaining_review_comments(app, client, token, &thread.id, &mut thread.comments)
        {
            thread.comments_truncated = true;
            thread.comments_unavailable_reason = Some(reason);
        }
    }
    Ok(detail)
}

pub(super) struct ReviewCommentPagination {
    loaded_pages: usize,
    seen_cursors: HashSet<String>,
}

impl ReviewCommentPagination {
    pub(super) fn new() -> Self {
        Self {
            loaded_pages: 1,
            seen_cursors: HashSet::new(),
        }
    }

    pub(super) fn next_cursor(
        &mut self,
        page_info: &GraphQlPageInfo,
    ) -> Result<Option<String>, String> {
        if !page_info.has_next_page {
            return Ok(None);
        }
        if self.loaded_pages >= MAX_REVIEW_THREAD_COMMENT_PAGES {
            return Err(format!(
                "此 Review Thread 回复较多，当前仅显示前 {} 条。",
                MAX_REVIEW_THREAD_COMMENT_PAGES * 100
            ));
        }
        let cursor = page_info
            .end_cursor
            .clone()
            .ok_or_else(|| "Review Thread 回复暂未完整加载，请刷新后重试。".to_string())?;
        if !self.seen_cursors.insert(cursor.clone()) {
            return Err("Review Thread 回复暂未完整加载，请刷新后重试。".to_string());
        }
        self.loaded_pages += 1;
        Ok(Some(cursor))
    }
}

fn fetch_remaining_review_comments(
    app: &AppHandle,
    client: &Client,
    token: &str,
    thread_id: &str,
    comments: &mut ReviewCommentConnection,
) -> Option<String> {
    let mut pagination = ReviewCommentPagination::new();
    loop {
        let cursor = match pagination.next_cursor(&comments.page_info) {
            Ok(Some(cursor)) => cursor,
            Ok(None) => return None,
            Err(reason) => return Some(reason),
        };
        let response = match github_send(
            app,
            "读取 Pull Request Review Thread 评论失败",
            github_headers(
                client.post(GRAPHQL_URL).json(&json!({
                    "query": REVIEW_THREAD_COMMENTS_QUERY,
                    "variables": {
                        "threadId": thread_id,
                        "commentCursor": cursor,
                    }
                })),
                Some(token),
            ),
        ) {
            Ok(response) => response,
            Err(error) => return Some(error),
        };
        let result = match github_json::<GraphQlResponse<ReviewThreadCommentsData>>(
            "读取 Pull Request Review Thread 评论失败",
            response,
        ) {
            Ok(result) => result,
            Err(error) => return Some(error),
        };
        if let Some(error) = graph_ql_error("读取 Pull Request Review Thread 评论失败", &result)
        {
            return Some(error);
        }
        let Some(mut page) = result
            .data
            .and_then(|data| data.node)
            .map(|node| node.comments)
        else {
            return Some("Review Thread 回复暂未完整加载，请刷新后重试。".to_string());
        };
        comments.nodes.append(&mut page.nodes);
        comments.page_info = page.page_info;
    }
}

pub(super) fn reply_to_review_thread(
    app: &AppHandle,
    client: &Client,
    token: &str,
    thread_id: &str,
    body: &str,
) -> Result<GitHubPullRequestReviewComment, String> {
    let response = github_send(
        app,
        "回复 Pull Request Review Thread 失败",
        github_headers(
            client.post(GRAPHQL_URL).json(&json!({
                "query": REPLY_THREAD_MUTATION,
                "variables": { "threadId": thread_id, "body": body }
            })),
            Some(token),
        ),
    )?;
    let result = github_json::<GraphQlResponse<ReplyMutationData>>(
        "回复 Pull Request Review Thread 失败",
        response,
    )?;
    let error = graph_ql_error("回复 Pull Request Review Thread 失败", &result);
    let comment = result
        .data
        .and_then(|data| data.add_pull_request_review_thread_reply)
        .and_then(|payload| payload.comment)
        .ok_or_else(|| error.unwrap_or_else(|| "GitHub 未返回回复结果".to_string()))?;
    Ok(review_comment_from_graphql(comment))
}

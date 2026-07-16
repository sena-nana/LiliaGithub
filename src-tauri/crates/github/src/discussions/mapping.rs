use lilia_github_contracts::workspace::{
    GitHubCursorPageInfo, GitHubRepositoryDiscussion, GitHubRepositoryDiscussionAuthor,
    GitHubRepositoryDiscussionCategory, GitHubRepositoryDiscussionComment,
    GitHubRepositoryDiscussionCommentPage, GitHubRepositoryDiscussionMetadata,
    GitHubRepositoryDiscussionPage, GitHubRepositoryDiscussionSummary,
};
use serde::de::DeserializeOwned;
use serde_json::Value;

use super::wire::*;
use super::{GitHubDiscussionApiError, GitHubRepositoryDiscussionContext};

pub fn parse_metadata_response(
    value: Value,
) -> Result<GitHubRepositoryDiscussionContext, GitHubDiscussionApiError> {
    let data: RepositoryData<WireMetadataRepository> = decode_data(value)?;
    let repository = require_repository(data.repository)?;
    Ok(GitHubRepositoryDiscussionContext {
        repository_id: repository.id,
        metadata: GitHubRepositoryDiscussionMetadata {
            enabled: repository.has_discussions_enabled,
            categories: map_categories(repository.all_categories.nodes),
            creatable_categories: map_categories(repository.creatable_categories.nodes),
        },
    })
}

pub fn parse_list_response(
    value: Value,
) -> Result<GitHubRepositoryDiscussionPage, GitHubDiscussionApiError> {
    let data: RepositoryData<WireListRepository> = decode_data(value)?;
    let repository = require_repository(data.repository)?;
    if !repository.has_discussions_enabled {
        return Ok(empty_discussion_page());
    }
    Ok(GitHubRepositoryDiscussionPage {
        items: repository
            .discussions
            .nodes
            .into_iter()
            .flatten()
            .map(map_summary)
            .collect(),
        page_info: repository.discussions.page_info.into(),
        total_count: repository.discussions.total_count,
    })
}

pub fn parse_detail_response(
    value: Value,
) -> Result<GitHubRepositoryDiscussion, GitHubDiscussionApiError> {
    let data: RepositoryData<WireDetailRepository> = decode_data(value)?;
    let repository = require_repository(data.repository)?;
    require_discussions_enabled(repository.has_discussions_enabled)?;
    repository.discussion.map(map_discussion).ok_or_else(|| {
        GitHubDiscussionApiError::new("github_discussion_not_found", "未找到 Discussion")
    })
}

pub fn parse_comments_response(
    value: Value,
) -> Result<GitHubRepositoryDiscussionCommentPage, GitHubDiscussionApiError> {
    let data: RepositoryData<WireCommentsRepository> = decode_data(value)?;
    let repository = require_repository(data.repository)?;
    require_discussions_enabled(repository.has_discussions_enabled)?;
    let discussion = repository.discussion.ok_or_else(|| {
        GitHubDiscussionApiError::new("github_discussion_not_found", "未找到 Discussion")
    })?;
    Ok(map_comment_page(discussion.comments))
}

pub fn parse_replies_response(
    value: Value,
    repo_full_name: &str,
) -> Result<GitHubRepositoryDiscussionCommentPage, GitHubDiscussionApiError> {
    let data: NodeData = decode_data(value)?;
    let comment = data.node.ok_or_else(|| {
        GitHubDiscussionApiError::new(
            "github_discussion_comment_not_found",
            "未找到 Discussion 评论",
        )
    })?;
    if comment.type_name != "DiscussionComment" {
        return Err(GitHubDiscussionApiError::new(
            "github_discussion_comment_not_found",
            "节点不是 GitHub Discussion 评论",
        ));
    }
    let discussion = comment.discussion.ok_or_else(|| {
        GitHubDiscussionApiError::new(
            "github_discussion_comment_not_found",
            "Discussion 评论响应缺少所属 Discussion",
        )
    })?;
    if !discussion
        .repository
        .name_with_owner
        .eq_ignore_ascii_case(repo_full_name.trim())
    {
        return Err(GitHubDiscussionApiError::new(
            "github_repository_not_accessible",
            "Discussion 评论不属于当前仓库",
        ));
    }
    comment.replies.map(map_comment_page).ok_or_else(|| {
        GitHubDiscussionApiError::new(
            "github_discussion_comment_not_found",
            "Discussion 评论响应缺少回复列表",
        )
    })
}

pub fn parse_create_response(
    value: Value,
) -> Result<GitHubRepositoryDiscussion, GitHubDiscussionApiError> {
    let data: CreateData = decode_data(value)?;
    data.create_discussion
        .and_then(|payload| payload.discussion)
        .map(map_discussion)
        .ok_or_else(|| {
            GitHubDiscussionApiError::new("github_graphql_error", "GitHub 未返回新建的 Discussion")
        })
}

fn decode_data<T: DeserializeOwned>(value: Value) -> Result<T, GitHubDiscussionApiError> {
    let response: WireResponse<T> = serde_json::from_value(value).map_err(|error| {
        GitHubDiscussionApiError::new(
            "github_graphql_error",
            format!("解析 GraphQL 响应失败：{error}"),
        )
    })?;
    if !response.errors.is_empty() {
        return Err(map_graphql_errors(response.errors));
    }
    response.data.ok_or_else(|| {
        GitHubDiscussionApiError::new("github_graphql_error", "GraphQL 响应缺少 data")
    })
}

fn map_graphql_errors(errors: Vec<WireGraphQlError>) -> GitHubDiscussionApiError {
    let detail = errors
        .iter()
        .map(|error| error.message.trim())
        .filter(|message| !message.is_empty())
        .collect::<Vec<_>>()
        .join("; ");
    let kinds = errors
        .iter()
        .filter_map(|error| error.kind.as_deref())
        .map(str::to_ascii_uppercase)
        .collect::<Vec<_>>();
    let lower = detail.to_ascii_lowercase();
    let code = if kinds.iter().any(|kind| kind == "FORBIDDEN") {
        "github_forbidden"
    } else if kinds.iter().any(|kind| kind == "UNAUTHORIZED") {
        "github_authentication_required"
    } else if kinds.iter().any(|kind| kind == "RATE_LIMITED") || lower.contains("rate limit") {
        "github_rate_limited"
    } else if kinds.iter().any(|kind| kind == "NOT_FOUND") {
        "github_repository_not_accessible"
    } else {
        "github_graphql_error"
    };
    GitHubDiscussionApiError::new(
        code,
        if detail.is_empty() {
            "GitHub GraphQL 请求失败".to_string()
        } else {
            detail
        },
    )
}

fn require_repository<T>(repository: Option<T>) -> Result<T, GitHubDiscussionApiError> {
    repository.ok_or_else(|| {
        GitHubDiscussionApiError::new(
            "github_repository_not_accessible",
            "仓库不存在或当前 GitHub 授权无法访问",
        )
    })
}

fn require_discussions_enabled(enabled: bool) -> Result<(), GitHubDiscussionApiError> {
    if enabled {
        Ok(())
    } else {
        Err(GitHubDiscussionApiError::new(
            "github_discussions_disabled",
            "该仓库未启用 GitHub Discussions",
        ))
    }
}

fn empty_discussion_page() -> GitHubRepositoryDiscussionPage {
    GitHubRepositoryDiscussionPage {
        items: Vec::new(),
        page_info: GitHubCursorPageInfo {
            end_cursor: None,
            has_next_page: false,
        },
        total_count: 0,
    }
}

fn map_categories(nodes: Vec<Option<WireCategory>>) -> Vec<GitHubRepositoryDiscussionCategory> {
    nodes.into_iter().flatten().map(Into::into).collect()
}

fn map_summary(value: WireDiscussionSummary) -> GitHubRepositoryDiscussionSummary {
    GitHubRepositoryDiscussionSummary {
        id: value.id,
        number: value.number,
        title: value.title,
        category: value.category.into(),
        author: value.author.map(Into::into),
        comment_count: value.comments.total_count,
        is_answered: value.is_answered.unwrap_or(false),
        closed: value.closed,
        locked: value.locked,
        created_at: value.created_at,
        updated_at: value.updated_at,
        url: value.url,
    }
}

fn map_discussion(value: WireDiscussion) -> GitHubRepositoryDiscussion {
    GitHubRepositoryDiscussion {
        id: value.id,
        number: value.number,
        title: value.title,
        body: value.body,
        category: value.category.into(),
        author: value.author.map(Into::into),
        comment_count: value.comments.total_count,
        is_answered: value.is_answered.unwrap_or(false),
        answer_id: value.answer.map(|answer| answer.id),
        closed: value.closed,
        locked: value.locked,
        created_at: value.created_at,
        updated_at: value.updated_at,
        url: value.url,
    }
}

fn map_comment_page(value: WireCommentConnection) -> GitHubRepositoryDiscussionCommentPage {
    GitHubRepositoryDiscussionCommentPage {
        items: value
            .nodes
            .into_iter()
            .flatten()
            .map(|comment| GitHubRepositoryDiscussionComment {
                id: comment.id,
                author: comment.author.map(Into::into),
                body: comment.body,
                created_at: comment.created_at,
                updated_at: comment.updated_at,
                url: comment.url,
                is_answer: comment.is_answer,
                reply_to_id: comment.reply_to.map(|reply| reply.id),
                reply_count: comment.replies.total_count,
            })
            .collect(),
        page_info: value.page_info.into(),
        total_count: value.total_count,
    }
}

impl From<WirePageInfo> for GitHubCursorPageInfo {
    fn from(value: WirePageInfo) -> Self {
        Self {
            end_cursor: value.end_cursor,
            has_next_page: value.has_next_page,
        }
    }
}

impl From<WireCategory> for GitHubRepositoryDiscussionCategory {
    fn from(value: WireCategory) -> Self {
        Self {
            id: value.id,
            name: value.name,
            slug: value.slug,
            description: value.description,
            emoji: value.emoji,
            is_answerable: value.is_answerable,
        }
    }
}

impl From<WireActor> for GitHubRepositoryDiscussionAuthor {
    fn from(value: WireActor) -> Self {
        Self {
            login: value.login,
            avatar_url: value.avatar_url,
            url: value.url,
        }
    }
}

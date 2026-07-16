use lilia_github_contracts::workspace::GitHubCreateRepositoryDiscussionRequest;
use serde_json::json;

use crate::normalize_github_repo_input;

use super::validation::{
    normalize_direction, normalize_optional, normalize_sort, normalize_states, require_text,
    validate_first, validate_number,
};
use super::{GitHubGraphQlRequest, GitHubRepositoryDiscussionContext};

const METADATA_QUERY: &str = r#"
    query RepositoryDiscussionMetadata($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        id
        hasDiscussionsEnabled
        allCategories: discussionCategories(first: 25) {
          nodes { id name slug description emoji isAnswerable }
        }
        creatableCategories: discussionCategories(first: 25, filterByAssignable: true) {
          nodes { id name slug description emoji isAnswerable }
        }
      }
    }
"#;

const LIST_QUERY: &str = r#"
    query RepositoryDiscussions(
      $owner: String!, $name: String!, $first: Int!, $after: String,
      $categoryId: ID, $answered: Boolean, $states: [DiscussionState!],
      $orderBy: DiscussionOrder!
    ) {
      repository(owner: $owner, name: $name) {
        hasDiscussionsEnabled
        discussions(
          first: $first, after: $after, categoryId: $categoryId,
          answered: $answered, states: $states, orderBy: $orderBy
        ) {
          totalCount
          pageInfo { endCursor hasNextPage }
          nodes {
            id number title
            category { id name slug description emoji isAnswerable }
            author { login avatarUrl url }
            comments { totalCount }
            isAnswered closed locked createdAt updatedAt url
          }
        }
      }
    }
"#;

const DETAIL_QUERY: &str = r#"
    query RepositoryDiscussion($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        hasDiscussionsEnabled
        discussion(number: $number) {
          id number title body
          category { id name slug description emoji isAnswerable }
          author { login avatarUrl url }
          comments { totalCount }
          isAnswered answer { id }
          closed locked createdAt updatedAt url
        }
      }
    }
"#;

const COMMENTS_QUERY: &str = r#"
    query RepositoryDiscussionComments(
      $owner: String!, $name: String!, $number: Int!, $first: Int!, $after: String
    ) {
      repository(owner: $owner, name: $name) {
        hasDiscussionsEnabled
        discussion(number: $number) {
          comments(first: $first, after: $after) {
            totalCount
            pageInfo { endCursor hasNextPage }
            nodes {
              id author { login avatarUrl url } body createdAt updatedAt url isAnswer
              replyTo { id }
              replies { totalCount }
            }
          }
        }
      }
    }
"#;

const REPLIES_QUERY: &str = r#"
    query RepositoryDiscussionCommentReplies($commentId: ID!, $first: Int!, $after: String) {
      node(id: $commentId) {
        __typename
        ... on DiscussionComment {
          discussion { repository { nameWithOwner } }
          replies(first: $first, after: $after) {
            totalCount
            pageInfo { endCursor hasNextPage }
            nodes {
              id author { login avatarUrl url } body createdAt updatedAt url isAnswer
              replyTo { id }
              replies { totalCount }
            }
          }
        }
      }
    }
"#;

const CREATE_QUERY: &str = r#"
    mutation CreateRepositoryDiscussion(
      $repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!
    ) {
      createDiscussion(input: {
        repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body
      }) {
        discussion {
          id number title body
          category { id name slug description emoji isAnswerable }
          author { login avatarUrl url }
          comments { totalCount }
          isAnswered answer { id }
          closed locked createdAt updatedAt url
        }
      }
    }
"#;

pub fn metadata_request(repo_full_name: &str) -> Result<GitHubGraphQlRequest, String> {
    let repo = normalize_github_repo_input(repo_full_name)?;
    Ok(GitHubGraphQlRequest {
        query: METADATA_QUERY,
        variables: json!({ "owner": repo.owner, "name": repo.name }),
    })
}

#[allow(clippy::too_many_arguments)]
pub fn list_request(
    repo_full_name: &str,
    first: Option<u32>,
    after: Option<String>,
    category_id: Option<String>,
    answered: Option<bool>,
    state: Option<String>,
    sort: Option<String>,
    direction: Option<String>,
) -> Result<GitHubGraphQlRequest, String> {
    let repo = normalize_github_repo_input(repo_full_name)?;
    let first = validate_first(first)?;
    Ok(GitHubGraphQlRequest {
        query: LIST_QUERY,
        variables: json!({
            "owner": repo.owner,
            "name": repo.name,
            "first": first,
            "after": normalize_optional(after),
            "categoryId": normalize_optional(category_id),
            "answered": answered,
            "states": normalize_states(state)?,
            "orderBy": {
                "field": normalize_sort(sort)?,
                "direction": normalize_direction(direction)?,
            },
        }),
    })
}

pub fn detail_request(
    repo_full_name: &str,
    discussion_number: u64,
) -> Result<GitHubGraphQlRequest, String> {
    let repo = normalize_github_repo_input(repo_full_name)?;
    let number = validate_number(discussion_number)?;
    Ok(GitHubGraphQlRequest {
        query: DETAIL_QUERY,
        variables: json!({ "owner": repo.owner, "name": repo.name, "number": number }),
    })
}

pub fn comments_request(
    repo_full_name: &str,
    discussion_number: u64,
    first: Option<u32>,
    after: Option<String>,
) -> Result<GitHubGraphQlRequest, String> {
    let repo = normalize_github_repo_input(repo_full_name)?;
    let number = validate_number(discussion_number)?;
    Ok(GitHubGraphQlRequest {
        query: COMMENTS_QUERY,
        variables: json!({
            "owner": repo.owner,
            "name": repo.name,
            "number": number,
            "first": validate_first(first)?,
            "after": normalize_optional(after),
        }),
    })
}

pub fn replies_request(
    comment_id: String,
    first: Option<u32>,
    after: Option<String>,
) -> Result<GitHubGraphQlRequest, String> {
    Ok(GitHubGraphQlRequest {
        query: REPLIES_QUERY,
        variables: json!({
            "commentId": require_text(comment_id, "Discussion 评论 ID 不能为空")?,
            "first": validate_first(first)?,
            "after": normalize_optional(after),
        }),
    })
}

pub fn create_request(
    context: &GitHubRepositoryDiscussionContext,
    request: GitHubCreateRepositoryDiscussionRequest,
) -> Result<GitHubGraphQlRequest, String> {
    if !context.metadata.enabled {
        return Err("github_discussions_disabled：该仓库未启用 GitHub Discussions".to_string());
    }
    let category_id = require_text(request.category_id, "Discussion 分类不能为空")?;
    if !context
        .metadata
        .creatable_categories
        .iter()
        .any(|category| category.id == category_id)
    {
        return Err(
            "github_discussion_category_not_creatable：当前账号不能在所选分类创建 Discussion"
                .to_string(),
        );
    }
    Ok(GitHubGraphQlRequest {
        query: CREATE_QUERY,
        variables: json!({
            "repositoryId": context.repository_id,
            "categoryId": category_id,
            "title": require_text(request.title, "Discussion 标题不能为空")?,
            "body": require_text(request.body, "Discussion 内容不能为空")?,
        }),
    })
}

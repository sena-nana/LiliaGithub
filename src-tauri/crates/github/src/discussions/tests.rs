use lilia_github_contracts::workspace::{
    GitHubCreateRepositoryDiscussionRequest, GitHubRepositoryDiscussionCategory,
};
use serde_json::json;

use super::*;

fn category(id: &str, name: &str) -> Value {
    json!({
        "id": id,
        "name": name,
        "slug": name.to_ascii_lowercase(),
        "description": format!("{name} description"),
        "emoji": ":speech_balloon:",
        "isAnswerable": name == "Q&A",
    })
}

fn actor() -> Value {
    json!({
        "login": "octocat",
        "avatarUrl": "https://avatars.example/octocat.png",
        "url": "https://github.com/octocat",
    })
}

fn discussion(include_body: bool) -> Value {
    let mut value = json!({
        "id": "D_kwD1",
        "number": 14,
        "title": "Discussion title",
        "category": category("DC_kwD1", "Q&A"),
        "author": actor(),
        "comments": { "totalCount": 7 },
        "isAnswered": true,
        "closed": false,
        "locked": false,
        "createdAt": "2026-07-16T01:00:00Z",
        "updatedAt": "2026-07-16T02:00:00Z",
        "url": "https://github.com/acme/project/discussions/14",
    });
    if include_body {
        value["body"] = json!("# Raw Markdown\n\nA **safe** body.");
        value["answer"] = json!({ "id": "DC_answer" });
    }
    value
}

fn comment(id: &str, reply_to: Option<&str>, reply_count: u64) -> Value {
    json!({
        "id": id,
        "author": actor(),
        "body": "Reply with `Markdown`.",
        "createdAt": "2026-07-16T03:00:00Z",
        "updatedAt": "2026-07-16T03:05:00Z",
        "url": format!("https://github.com/acme/project/discussions/14#discussioncomment-{id}"),
        "isAnswer": id == "DC_answer",
        "replyTo": reply_to.map(|id| json!({ "id": id })),
        "replies": { "totalCount": reply_count },
    })
}

#[test]
fn request_builders_validate_pagination_filters_and_numbers() {
    let request = list_request(
        "acme/project",
        Some(50),
        Some(" cursor ".to_string()),
        Some(" category ".to_string()),
        Some(false),
        Some("closed".to_string()),
        Some("created".to_string()),
        Some("asc".to_string()),
    )
    .unwrap();

    assert_eq!(request.variables["first"], 50);
    assert_eq!(request.variables["after"], "cursor");
    assert_eq!(request.variables["categoryId"], "category");
    assert_eq!(request.variables["states"], json!(["CLOSED"]));
    assert_eq!(request.variables["orderBy"]["field"], "CREATED_AT");
    assert_eq!(request.variables["orderBy"]["direction"], "ASC");
    assert!(list_request("acme/project", Some(0), None, None, None, None, None, None).is_err());
    assert!(list_request(
        "acme/project",
        Some(101),
        None,
        None,
        None,
        None,
        None,
        None
    )
    .is_err());
    assert!(list_request(
        "acme/project",
        None,
        None,
        None,
        None,
        Some("merged".to_string()),
        None,
        None,
    )
    .is_err());
    assert!(detail_request("acme/project", 0).is_err());
    assert!(detail_request("acme/project", i32::MAX as u64 + 1).is_err());
}

#[test]
fn mutation_builders_validate_content_and_map_updated_comment() {
    let request = add_comment_request("D_1".into(), " hello ".into(), Some("DC_1".into())).unwrap();
    assert_eq!(request.variables["discussionId"], "D_1");
    assert_eq!(request.variables["body"], "hello");
    assert_eq!(request.variables["replyToId"], "DC_1");
    assert!(add_comment_request("".into(), "hello".into(), None).is_err());
    assert!(reaction_request("DC_1".into(), "heart".into(), false).is_ok());
    assert!(reaction_request("DC_1".into(), "like".into(), false).is_err());
    assert!(discussion_state_request("D_1".into(), "merge").is_err());

    let mapped = parse_comment_mutation_response(
        json!({
            "data": { "updateDiscussionComment": { "comment": comment("DC_1", None, 2) } }
        }),
        "updateDiscussionComment",
    )
    .unwrap();
    assert_eq!(mapped.id, "DC_1");
    assert_eq!(mapped.reply_count, 2);
}

#[test]
fn metadata_keeps_all_and_assignable_categories_separate() {
    let context = parse_metadata_response(json!({
        "data": {
            "repository": {
                "id": "R_kgD1",
                "hasDiscussionsEnabled": true,
                "allCategories": { "nodes": [category("DC_1", "General"), category("DC_2", "Q&A")] },
                "creatableCategories": { "nodes": [category("DC_2", "Q&A")] },
            }
        }
    }))
    .unwrap();

    assert_eq!(context.repository_id, "R_kgD1");
    assert!(context.metadata.enabled);
    assert_eq!(context.metadata.categories.len(), 2);
    assert_eq!(context.metadata.creatable_categories.len(), 1);
    assert_eq!(context.metadata.creatable_categories[0].id, "DC_2");
    assert!(context.metadata.creatable_categories[0].is_answerable);
}

#[test]
fn list_maps_cursor_and_returns_business_empty_state_when_disabled() {
    let page = parse_list_response(json!({
        "data": {
            "repository": {
                "hasDiscussionsEnabled": true,
                "discussions": {
                    "totalCount": 31,
                    "pageInfo": { "endCursor": "cursor-30", "hasNextPage": true },
                    "nodes": [discussion(false), null],
                }
            }
        }
    }))
    .unwrap();
    assert_eq!(page.total_count, 31);
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].comment_count, 7);
    assert_eq!(page.page_info.end_cursor.as_deref(), Some("cursor-30"));
    assert!(page.page_info.has_next_page);

    let disabled = parse_list_response(json!({
        "data": {
            "repository": {
                "hasDiscussionsEnabled": false,
                "discussions": {
                    "totalCount": 0,
                    "pageInfo": { "endCursor": null, "hasNextPage": false },
                    "nodes": [],
                }
            }
        }
    }))
    .unwrap();
    assert!(disabled.items.is_empty());
    assert_eq!(disabled.total_count, 0);
}

#[test]
fn detail_preserves_raw_markdown_and_answer_identity() {
    let detail = parse_detail_response(json!({
        "data": {
            "repository": {
                "hasDiscussionsEnabled": true,
                "discussion": discussion(true),
            }
        }
    }))
    .unwrap();

    assert_eq!(detail.body, "# Raw Markdown\n\nA **safe** body.");
    assert_eq!(detail.answer_id.as_deref(), Some("DC_answer"));
    assert!(detail.is_answered);
    assert_eq!(detail.author.unwrap().login, "octocat");
}

#[test]
fn comments_and_replies_keep_independent_cursor_and_thread_metadata() {
    let comments = parse_comments_response(json!({
        "data": {
            "repository": {
                "hasDiscussionsEnabled": true,
                "discussion": {
                    "comments": {
                        "totalCount": 2,
                        "pageInfo": { "endCursor": "comment-cursor", "hasNextPage": true },
                        "nodes": [comment("DC_top", None, 4)]
                    }
                }
            }
        }
    }))
    .unwrap();
    assert_eq!(comments.total_count, 2);
    assert_eq!(comments.items[0].reply_count, 4);
    assert!(comments.items[0].reply_to_id.is_none());

    let replies = parse_replies_response(
        json!({
            "data": {
                "node": {
                    "__typename": "DiscussionComment",
                    "discussion": { "repository": { "nameWithOwner": "Acme/Project" } },
                    "replies": {
                        "totalCount": 4,
                        "pageInfo": { "endCursor": "reply-cursor", "hasNextPage": false },
                        "nodes": [comment("DC_reply", Some("DC_top"), 0)]
                    }
                }
            }
        }),
        "acme/project",
    )
    .unwrap();
    assert_eq!(replies.items[0].reply_to_id.as_deref(), Some("DC_top"));
    assert_eq!(
        replies.page_info.end_cursor.as_deref(),
        Some("reply-cursor")
    );

    let wrong_repo = parse_replies_response(
        json!({
            "data": {
                "node": {
                    "__typename": "DiscussionComment",
                    "discussion": { "repository": { "nameWithOwner": "other/project" } },
                    "replies": {
                        "totalCount": 0,
                        "pageInfo": { "endCursor": null, "hasNextPage": false },
                        "nodes": []
                    }
                }
            }
        }),
        "acme/project",
    )
    .unwrap_err();
    assert_eq!(wrong_repo.code, "github_repository_not_accessible");

    let wrong_node = parse_replies_response(
        json!({ "data": { "node": { "__typename": "Discussion" } } }),
        "acme/project",
    )
    .unwrap_err();
    assert_eq!(wrong_node.code, "github_discussion_comment_not_found");
}

#[test]
fn graphql_errors_are_strict_even_when_partial_data_exists() {
    let error = parse_list_response(json!({
        "data": {
            "repository": {
                "hasDiscussionsEnabled": true,
                "discussions": {
                    "totalCount": 0,
                    "pageInfo": { "endCursor": null, "hasNextPage": false },
                    "nodes": []
                }
            }
        },
        "errors": [{
            "type": "FORBIDDEN",
            "path": ["repository", "discussions"],
            "message": "Resource not accessible by integration"
        }]
    }))
    .unwrap_err();
    assert_eq!(error.code, "github_forbidden");
    assert!(error.message.contains("Resource not accessible"));

    let rate_limit = parse_metadata_response(json!({
        "data": null,
        "errors": [{ "type": "RATE_LIMITED", "message": "API rate limit exceeded" }]
    }))
    .unwrap_err();
    assert_eq!(rate_limit.code, "github_rate_limited");
}

#[test]
fn create_requires_enabled_assignable_category_and_nonempty_content() {
    let context = GitHubRepositoryDiscussionContext {
        repository_id: "R_kgD1".to_string(),
        metadata: GitHubRepositoryDiscussionMetadata {
            enabled: true,
            categories: vec![],
            creatable_categories: vec![GitHubRepositoryDiscussionCategory {
                id: "DC_2".to_string(),
                name: "Q&A".to_string(),
                slug: "q-a".to_string(),
                description: None,
                emoji: ":question:".to_string(),
                is_answerable: true,
            }],
        },
    };
    let request = create_request(
        &context,
        GitHubCreateRepositoryDiscussionRequest {
            category_id: " DC_2 ".to_string(),
            title: " Title ".to_string(),
            body: " Body ".to_string(),
        },
    )
    .unwrap();
    assert_eq!(request.variables["repositoryId"], "R_kgD1");
    assert_eq!(request.variables["categoryId"], "DC_2");
    assert_eq!(request.variables["title"], "Title");
    assert_eq!(request.variables["body"], "Body");

    let invalid_category = create_request(
        &context,
        GitHubCreateRepositoryDiscussionRequest {
            category_id: "DC_other".to_string(),
            title: "Title".to_string(),
            body: "Body".to_string(),
        },
    )
    .unwrap_err();
    assert!(invalid_category.starts_with("github_discussion_category_not_creatable"));

    let empty_body = create_request(
        &context,
        GitHubCreateRepositoryDiscussionRequest {
            category_id: "DC_2".to_string(),
            title: "Title".to_string(),
            body: "  ".to_string(),
        },
    )
    .unwrap_err();
    assert_eq!(empty_body, "Discussion 内容不能为空");
}

#[test]
fn create_response_maps_created_discussion_without_html_rendering() {
    let created = parse_create_response(json!({
        "data": {
            "createDiscussion": { "discussion": discussion(true) }
        }
    }))
    .unwrap();
    assert_eq!(created.number, 14);
    assert!(created.body.contains("**safe**"));
}

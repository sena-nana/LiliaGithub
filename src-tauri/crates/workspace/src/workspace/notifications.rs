use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::github::{
    build_client, github_headers, github_http_error, github_json,
    github_require_notifications_scope, github_require_token, github_send,
    normalize_optional_string, GitHubNotificationResponse,
};
use crate::workspace::operations::OperationKind;
use crate::workspace::run_core_operation;
use lilia_github_contracts::notifications::{
    GitHubNotification, GitHubNotificationMutationFailure, GitHubNotificationMutationResult,
    GitHubNotificationPage,
};
use reqwest::header::LINK;

pub async fn github_list_notifications(
    app: AppHandle,
    all: bool,
    page: u32,
    per_page: u32,
    _force_refresh: Option<bool>,
) -> Result<GitHubNotificationPage, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取通知收件箱",
        move || {
            let (binding, token) = github_require_token(&app)?;
            github_require_notifications_scope(&binding)?;
            let page = page.max(1);
            let per_page = per_page.clamp(1, 100);
            let client = build_client()?;
            let response = github_send(
                &app,
                "读取通知收件箱失败",
                github_headers(
                    client.get("https://api.github.com/notifications").query(&[
                        ("all", if all { "true" } else { "false" }.to_string()),
                        ("participating", "false".to_string()),
                        ("page", page.to_string()),
                        ("per_page", per_page.to_string()),
                    ]),
                    Some(&token),
                ),
            )?;
            let has_next_page = response
                .headers()
                .get(LINK)
                .and_then(|value| value.to_str().ok())
                .is_some_and(github_link_has_next);
            let items =
                github_json::<Vec<GitHubNotificationResponse>>("读取通知收件箱失败", response)?
                    .into_iter()
                    .map(notification_from_response)
                    .collect();
            Ok(GitHubNotificationPage {
                items,
                page,
                has_next_page,
            })
        },
    )
    .await
}

pub async fn github_mark_notifications_read(
    app: AppHandle,
    notification_ids: Vec<String>,
) -> Result<GitHubNotificationMutationResult, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "标记 GitHub 通知为已读",
        move || {
            let (binding, token) = github_require_token(&app)?;
            github_require_notifications_scope(&binding)?;
            let notification_ids = normalize_notification_ids(notification_ids)?;
            let client = build_client()?;
            let mut succeeded_ids = Vec::new();
            let mut failures = Vec::new();
            for notification_id in notification_ids {
                let result = notification_request(
                    &app,
                    "标记 GitHub 通知为已读失败",
                    github_headers(
                        client.patch(notification_thread_url(&notification_id)?),
                        Some(&token),
                    ),
                );
                match result {
                    Ok(()) => succeeded_ids.push(notification_id),
                    Err(message) => failures.push(GitHubNotificationMutationFailure {
                        notification_id,
                        message,
                    }),
                }
            }
            Ok(GitHubNotificationMutationResult {
                succeeded_ids,
                failures,
            })
        },
    )
    .await
}

pub async fn github_unsubscribe_notification(
    app: AppHandle,
    notification_id: String,
) -> Result<(), String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "取消订阅 GitHub 通知",
        move || {
            let (binding, token) = github_require_token(&app)?;
            github_require_notifications_scope(&binding)?;
            let notification_id = validate_notification_id(&notification_id)?;
            let client = build_client()?;
            notification_request(
                &app,
                "取消订阅 GitHub 通知失败",
                github_headers(
                    client.delete(format!(
                        "{}/subscription",
                        notification_thread_url(notification_id)?
                    )),
                    Some(&token),
                ),
            )
        },
    )
    .await
}

pub(super) fn notification_from_response(
    notification: GitHubNotificationResponse,
) -> GitHubNotification {
    GitHubNotification {
        id: notification.id,
        repo_full_name: notification.repository.full_name,
        title: notification.subject.title,
        reason: notification.reason.trim().to_string(),
        subject_type: notification.subject.kind.trim().to_string(),
        subject_url: normalize_optional_string(notification.subject.url),
        latest_comment_url: normalize_optional_string(notification.subject.latest_comment_url),
        updated_at: notification.updated_at,
        unread: notification.unread,
    }
}

fn notification_request(
    app: &AppHandle,
    prefix: &str,
    builder: reqwest::blocking::RequestBuilder,
) -> Result<(), String> {
    let response = github_send(app, prefix, builder)?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(github_http_error(prefix, response))
    }
}

fn normalize_notification_ids(notification_ids: Vec<String>) -> Result<Vec<String>, String> {
    let mut normalized = notification_ids
        .iter()
        .map(|id| validate_notification_id(id).map(str::to_string))
        .collect::<Result<Vec<_>, _>>()?;
    normalized.sort();
    normalized.dedup();
    if normalized.is_empty() {
        return Err("请选择要标记为已读的通知".to_string());
    }
    if normalized.len() > 100 {
        return Err("单次最多处理 100 条通知".to_string());
    }
    Ok(normalized)
}

fn validate_notification_id(notification_id: &str) -> Result<&str, String> {
    let notification_id = notification_id.trim();
    if notification_id.is_empty()
        || notification_id.len() > 40
        || !notification_id.bytes().all(|value| value.is_ascii_digit())
    {
        return Err("GitHub 通知 ID 无效".to_string());
    }
    Ok(notification_id)
}

fn notification_thread_url(notification_id: &str) -> Result<String, String> {
    Ok(format!(
        "https://api.github.com/notifications/threads/{}",
        validate_notification_id(notification_id)?
    ))
}

fn github_link_has_next(link: &str) -> bool {
    link.split(',')
        .any(|part| part.split(';').any(|value| value.trim() == "rel=\"next\""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_mapping_keeps_object_identity() {
        let response: GitHubNotificationResponse = serde_json::from_value(serde_json::json!({
            "id": "725519447",
            "repository": { "full_name": "sena-nana/LiliaGithub" },
            "subject": {
                "title": "Inbox",
                "url": "https://api.github.com/repos/sena-nana/LiliaGithub/issues/26",
                "latest_comment_url": null,
                "type": "Issue"
            },
            "reason": "assign",
            "updated_at": "2026-07-17T08:00:00Z",
            "unread": true
        }))
        .unwrap();

        let notification = notification_from_response(response);

        assert_eq!(notification.id, "725519447");
        assert_eq!(notification.repo_full_name, "sena-nana/LiliaGithub");
        assert_eq!(notification.subject_type, "Issue");
        assert!(notification.unread);
    }

    #[test]
    fn pagination_and_thread_targets_are_validated() {
        assert!(github_link_has_next(
            "<https://api.github.com/notifications?page=2>; rel=\"next\", <https://api.github.com/notifications?page=4>; rel=\"last\""
        ));
        assert!(!github_link_has_next(
            "<https://api.github.com/notifications?page=1>; rel=\"prev\""
        ));
        assert_eq!(
            notification_thread_url(" 725519447 ").unwrap(),
            "https://api.github.com/notifications/threads/725519447"
        );
        assert!(notification_thread_url("../settings").is_err());
    }

    #[test]
    fn batch_ids_are_deduplicated_and_bounded() {
        assert_eq!(
            normalize_notification_ids(vec!["20".into(), "10".into(), "20".into()]).unwrap(),
            vec!["10", "20"]
        );
        assert!(normalize_notification_ids(Vec::new()).is_err());
        assert!(normalize_notification_ids((0..101).map(|id| id.to_string()).collect()).is_err());
    }
}

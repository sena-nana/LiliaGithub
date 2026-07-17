use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::github::{
    build_client, github_account_issue_item_from_response, github_headers, github_json,
    github_require_notifications_scope, github_require_token, github_send, GitHubIssueResponse,
    GitHubNotificationResponse,
};
use crate::workspace::notifications::notification_from_response;
use crate::workspace::operations::OperationKind;
use crate::workspace::run_core_operation;
use crate::workspace::settings::{
    load_settings, repo_path_by_id, save_settings, settings_write_lock, visible_workspace_settings,
};
use crate::workspace::shared::now_millis;
use lilia_github_contracts::personal_home::PersonalHomeNotification;
use lilia_github_contracts::workspace::{
    GitHubAccountIssueItem, RecentLocalRepoVisit, WorkspaceSettings,
};

const RECENT_LOCAL_REPO_LIMIT: usize = 12;

pub async fn github_list_assigned_work(
    app: AppHandle,
    per_page: Option<u32>,
    _force_refresh: Option<bool>,
) -> Result<Vec<GitHubAccountIssueItem>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取分配给我的工作",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let per_page = per_page.unwrap_or(100).clamp(1, 100).to_string();
            let client = build_client()?;
            let response = github_send(
                &app,
                "读取分配给我的工作失败",
                github_headers(
                    client.get("https://api.github.com/issues").query(&[
                        ("filter", "assigned"),
                        ("state", "open"),
                        ("per_page", per_page.as_str()),
                        ("sort", "updated"),
                        ("direction", "desc"),
                    ]),
                    Some(&token),
                ),
            )?;
            let items =
                github_json::<Vec<GitHubIssueResponse>>("读取分配给我的工作失败", response)?;
            Ok(items
                .into_iter()
                .filter_map(github_account_issue_item_from_response)
                .collect())
        },
    )
    .await
}

pub async fn github_list_personal_notifications(
    app: AppHandle,
    per_page: Option<u32>,
    _force_refresh: Option<bool>,
) -> Result<Vec<PersonalHomeNotification>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取个人通知",
        move || {
            let (binding, token) = github_require_token(&app)?;
            github_require_notifications_scope(&binding)?;
            let per_page = per_page.unwrap_or(50).clamp(1, 100).to_string();
            let client = build_client()?;
            let response = github_send(
                &app,
                "读取个人通知失败",
                github_headers(
                    client.get("https://api.github.com/notifications").query(&[
                        ("all", "false"),
                        ("participating", "false"),
                        ("per_page", per_page.as_str()),
                    ]),
                    Some(&token),
                ),
            )?;
            let notifications =
                github_json::<Vec<GitHubNotificationResponse>>("读取个人通知失败", response)?;
            Ok(notifications
                .into_iter()
                .map(notification_from_response)
                .collect())
        },
    )
    .await
}

pub fn workspace_record_recent_local_repo(
    app: AppHandle,
    repo_id: String,
) -> Result<WorkspaceSettings, String> {
    let repo_id = repo_id.trim();
    if repo_id.is_empty() {
        return Err("仓库 ID 不能为空".to_string());
    }
    repo_path_by_id(&app, repo_id)?;

    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let mut settings = load_settings(&app);
    record_recent_local_repo_visit(&mut settings.recent_local_repos, repo_id, now_millis());
    save_settings(&app, &settings)?;
    Ok(visible_workspace_settings(settings))
}

fn record_recent_local_repo_visit(
    visits: &mut Vec<RecentLocalRepoVisit>,
    repo_id: &str,
    opened_at: i64,
) {
    visits.retain(|visit| !visit.repo_id.trim().is_empty() && visit.repo_id != repo_id);
    visits.push(RecentLocalRepoVisit {
        repo_id: repo_id.to_string(),
        opened_at,
    });
    visits.sort_by(|left, right| {
        right
            .opened_at
            .cmp(&left.opened_at)
            .then_with(|| left.repo_id.cmp(&right.repo_id))
    });
    visits.dedup_by(|left, right| left.repo_id == right.repo_id);
    visits.truncate(RECENT_LOCAL_REPO_LIMIT);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_mapping_keeps_non_workflow_notifications() {
        let response: GitHubNotificationResponse = serde_json::from_value(serde_json::json!({
            "id": "notification-7",
            "repository": { "full_name": "sena-nana/LiliaGithub" },
            "subject": {
                "title": "Personal home",
                "url": "https://api.github.com/repos/sena-nana/LiliaGithub/issues/21",
                "latest_comment_url": null,
                "type": "Issue"
            },
            "reason": "assign",
            "updated_at": "2026-07-16T08:00:00Z",
            "unread": true
        }))
        .unwrap();

        let notification = notification_from_response(response);

        assert_eq!(notification.repo_full_name, "sena-nana/LiliaGithub");
        assert_eq!(notification.subject_type, "Issue");
        assert_eq!(notification.reason, "assign");
        assert!(notification.unread);
    }

    #[test]
    fn assigned_work_mapping_keeps_repository_identity_and_pull_request_kind() {
        let response: GitHubIssueResponse = serde_json::from_value(serde_json::json!({
            "number": 21,
            "title": "Personal home",
            "state": "open",
            "body": null,
            "html_url": "https://github.com/sena-nana/LiliaGithub/issues/21",
            "updated_at": "2026-07-16T08:00:00Z",
            "created_at": "2026-07-15T08:00:00Z",
            "labels": [],
            "assignees": [{ "login": "sena-nana" }],
            "pull_request": { "url": "https://api.github.com/repos/sena-nana/LiliaGithub/pulls/21" },
            "repository": { "full_name": "sena-nana/LiliaGithub" }
        }))
        .unwrap();

        let item = github_account_issue_item_from_response(response).unwrap();

        assert_eq!(item.repo_full_name, "sena-nana/LiliaGithub");
        assert_eq!(item.issue.assignees, vec!["sena-nana"]);
        assert!(item.pull_request);
    }

    #[test]
    fn recent_local_repo_visits_are_deduplicated_ordered_and_limited() {
        let mut visits = (0..RECENT_LOCAL_REPO_LIMIT + 3)
            .map(|index| RecentLocalRepoVisit {
                repo_id: format!("repo-{index}"),
                opened_at: index as i64,
            })
            .collect::<Vec<_>>();

        record_recent_local_repo_visit(&mut visits, "repo-0", 100);

        assert_eq!(visits.len(), RECENT_LOCAL_REPO_LIMIT);
        assert_eq!(visits[0].repo_id, "repo-0");
        assert_eq!(
            visits
                .iter()
                .filter(|visit| visit.repo_id == "repo-0")
                .count(),
            1
        );
        assert!(visits
            .windows(2)
            .all(|pair| pair[0].opened_at >= pair[1].opened_at));
    }
}

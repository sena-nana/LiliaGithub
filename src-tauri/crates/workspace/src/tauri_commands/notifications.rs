use lilia_github_contracts::notifications::{
    GitHubNotificationMutationResult, GitHubNotificationPage,
};

delegate_command!(async notifications; fn github_list_notifications(
    app: AppHandle,
    all: bool,
    page: u32,
    per_page: u32,
    _force_refresh: Option<bool>,
) -> Result<GitHubNotificationPage, String>);
delegate_command!(async notifications; fn github_mark_notifications_read(
    app: AppHandle,
    notification_ids: Vec<String>,
) -> Result<GitHubNotificationMutationResult, String>);
delegate_command!(async notifications; fn github_unsubscribe_notification(
    app: AppHandle,
    notification_id: String,
) -> Result<(), String>);

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubNotification {
    pub id: String,
    pub repo_full_name: String,
    pub title: String,
    pub reason: String,
    pub subject_type: String,
    #[serde(default)]
    pub subject_url: Option<String>,
    #[serde(default)]
    pub latest_comment_url: Option<String>,
    pub updated_at: String,
    pub unread: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubNotificationPage {
    pub items: Vec<GitHubNotification>,
    pub page: u32,
    pub has_next_page: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubNotificationMutationFailure {
    pub notification_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubNotificationMutationResult {
    pub succeeded_ids: Vec<String>,
    pub failures: Vec<GitHubNotificationMutationFailure>,
}

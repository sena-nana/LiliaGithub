use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersonalHomeNotification {
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

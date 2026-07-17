use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCursorPageInfo {
    #[serde(default)]
    pub end_cursor: Option<String>,
    pub has_next_page: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepositoryDiscussionCategory {
    pub id: String,
    pub name: String,
    pub slug: String,
    #[serde(default)]
    pub description: Option<String>,
    pub emoji: String,
    pub is_answerable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepositoryDiscussionMetadata {
    pub enabled: bool,
    pub categories: Vec<GitHubRepositoryDiscussionCategory>,
    pub creatable_categories: Vec<GitHubRepositoryDiscussionCategory>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepositoryDiscussionAuthor {
    pub login: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepositoryDiscussionSummary {
    pub id: String,
    pub number: u64,
    pub title: String,
    pub category: GitHubRepositoryDiscussionCategory,
    #[serde(default)]
    pub author: Option<GitHubRepositoryDiscussionAuthor>,
    pub comment_count: u64,
    pub is_answered: bool,
    pub closed: bool,
    pub locked: bool,
    pub created_at: String,
    pub updated_at: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepositoryDiscussion {
    pub id: String,
    pub number: u64,
    pub title: String,
    pub body: String,
    pub category: GitHubRepositoryDiscussionCategory,
    #[serde(default)]
    pub author: Option<GitHubRepositoryDiscussionAuthor>,
    pub comment_count: u64,
    pub is_answered: bool,
    #[serde(default)]
    pub answer_id: Option<String>,
    pub closed: bool,
    pub locked: bool,
    pub created_at: String,
    pub updated_at: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepositoryDiscussionPage {
    pub items: Vec<GitHubRepositoryDiscussionSummary>,
    pub page_info: GitHubCursorPageInfo,
    pub total_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepositoryDiscussionComment {
    pub id: String,
    #[serde(default)]
    pub author: Option<GitHubRepositoryDiscussionAuthor>,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
    pub url: String,
    pub is_answer: bool,
    #[serde(default)]
    pub reply_to_id: Option<String>,
    pub reply_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepositoryDiscussionCommentPage {
    pub items: Vec<GitHubRepositoryDiscussionComment>,
    pub page_info: GitHubCursorPageInfo,
    pub total_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCreateRepositoryDiscussionRequest {
    pub category_id: String,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCreateDiscussionCommentRequest {
    pub discussion_id: String,
    pub body: String,
    #[serde(default)]
    pub reply_to_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubUpdateDiscussionCommentRequest {
    pub comment_id: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDiscussionReactionRequest {
    pub subject_id: String,
    pub content: String,
    #[serde(default)]
    pub remove: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDiscussionStateRequest {
    pub discussion_id: String,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDiscussionAnswerRequest {
    pub comment_id: String,
    pub mark: bool,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn discussion_contracts_use_camel_case_at_the_tauri_boundary() {
        let category = GitHubRepositoryDiscussionCategory {
            id: "DC_1".to_string(),
            name: "General".to_string(),
            slug: "general".to_string(),
            description: None,
            emoji: ":speech_balloon:".to_string(),
            is_answerable: false,
        };
        let value = serde_json::to_value(GitHubRepositoryDiscussionMetadata {
            enabled: true,
            categories: vec![category.clone()],
            creatable_categories: vec![category],
        })
        .unwrap();
        assert_eq!(value["creatableCategories"][0]["isAnswerable"], false);
        assert!(value.get("creatable_categories").is_none());

        let request: GitHubCreateRepositoryDiscussionRequest = serde_json::from_value(json!({
            "categoryId": "DC_1",
            "title": "Title",
            "body": "Markdown",
        }))
        .unwrap();
        assert_eq!(request.category_id, "DC_1");
    }
}

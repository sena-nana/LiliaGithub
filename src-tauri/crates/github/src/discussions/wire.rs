use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub(super) struct WireResponse<T> {
    pub(super) data: Option<T>,
    #[serde(default)]
    pub(super) errors: Vec<WireGraphQlError>,
}

#[derive(Debug, Deserialize)]
pub(super) struct WireGraphQlError {
    pub(super) message: String,
    #[serde(rename = "type", default)]
    pub(super) kind: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct RepositoryData<T> {
    pub(super) repository: Option<T>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireMetadataRepository {
    pub(super) id: String,
    pub(super) has_discussions_enabled: bool,
    pub(super) all_categories: WireCategoryConnection,
    pub(super) creatable_categories: WireCategoryConnection,
}

#[derive(Debug, Deserialize)]
pub(super) struct WireCategoryConnection {
    #[serde(default)]
    pub(super) nodes: Vec<Option<WireCategory>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireCategory {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) slug: String,
    #[serde(default)]
    pub(super) description: Option<String>,
    pub(super) emoji: String,
    pub(super) is_answerable: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireListRepository {
    pub(super) has_discussions_enabled: bool,
    pub(super) discussions: WireDiscussionConnection,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireDetailRepository {
    pub(super) has_discussions_enabled: bool,
    pub(super) discussion: Option<WireDiscussion>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireCommentsRepository {
    pub(super) has_discussions_enabled: bool,
    pub(super) discussion: Option<WireDiscussionComments>,
}

#[derive(Debug, Deserialize)]
pub(super) struct WireDiscussionComments {
    pub(super) comments: WireCommentConnection,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireDiscussionConnection {
    pub(super) total_count: u64,
    pub(super) page_info: WirePageInfo,
    #[serde(default)]
    pub(super) nodes: Vec<Option<WireDiscussionSummary>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireDiscussionSummary {
    pub(super) id: String,
    pub(super) number: u64,
    pub(super) title: String,
    pub(super) category: WireCategory,
    pub(super) author: Option<WireActor>,
    pub(super) comments: WireCount,
    pub(super) is_answered: Option<bool>,
    pub(super) closed: bool,
    pub(super) locked: bool,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    pub(super) url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireDiscussion {
    pub(super) id: String,
    pub(super) number: u64,
    pub(super) title: String,
    pub(super) body: String,
    pub(super) category: WireCategory,
    pub(super) author: Option<WireActor>,
    pub(super) comments: WireCount,
    pub(super) is_answered: Option<bool>,
    pub(super) answer: Option<WireId>,
    pub(super) closed: bool,
    pub(super) locked: bool,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    pub(super) url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireActor {
    pub(super) login: String,
    #[serde(default)]
    pub(super) avatar_url: Option<String>,
    #[serde(default)]
    pub(super) url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireCount {
    pub(super) total_count: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WirePageInfo {
    #[serde(default)]
    pub(super) end_cursor: Option<String>,
    pub(super) has_next_page: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireCommentConnection {
    pub(super) total_count: u64,
    pub(super) page_info: WirePageInfo,
    #[serde(default)]
    pub(super) nodes: Vec<Option<WireComment>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireComment {
    pub(super) id: String,
    pub(super) author: Option<WireActor>,
    pub(super) body: String,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    pub(super) url: String,
    pub(super) is_answer: bool,
    #[serde(default)]
    pub(super) reply_to: Option<WireId>,
    pub(super) replies: WireCount,
}

#[derive(Debug, Deserialize)]
pub(super) struct WireId {
    pub(super) id: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct NodeData {
    pub(super) node: Option<WireCommentNode>,
}

#[derive(Debug, Deserialize)]
pub(super) struct WireCommentNode {
    #[serde(rename = "__typename")]
    pub(super) type_name: String,
    pub(super) discussion: Option<WireCommentDiscussion>,
    pub(super) replies: Option<WireCommentConnection>,
}

#[derive(Debug, Deserialize)]
pub(super) struct WireCommentDiscussion {
    pub(super) repository: WireCommentRepository,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireCommentRepository {
    pub(super) name_with_owner: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreateData {
    pub(super) create_discussion: Option<CreatePayload>,
}

#[derive(Debug, Deserialize)]
pub(super) struct CreatePayload {
    pub(super) discussion: Option<WireDiscussion>,
}

use lilia_github_contracts::workspace::*;

delegate_command!(async github_discussions; fn github_get_discussion_metadata(app: AppHandle, repo_full_name: String,) -> Result<GitHubRepositoryDiscussionMetadata, String>);
delegate_command!(async github_discussions; fn github_list_discussions(app: AppHandle, repo_full_name: String, first: Option<u32>, after: Option<String>, category_id: Option<String>, answered: Option<bool>, state: Option<String>, sort: Option<String>, direction: Option<String>,) -> Result<GitHubRepositoryDiscussionPage, String>);
delegate_command!(async github_discussions; fn github_get_discussion(app: AppHandle, repo_full_name: String, discussion_number: u64,) -> Result<GitHubRepositoryDiscussion, String>);
delegate_command!(async github_discussions; fn github_list_discussion_comments(app: AppHandle, repo_full_name: String, discussion_number: u64, first: Option<u32>, after: Option<String>,) -> Result<GitHubRepositoryDiscussionCommentPage, String>);
delegate_command!(async github_discussions; fn github_list_discussion_comment_replies(app: AppHandle, repo_full_name: String, comment_id: String, first: Option<u32>, after: Option<String>,) -> Result<GitHubRepositoryDiscussionCommentPage, String>);
delegate_command!(async github_discussions; fn github_create_discussion(app: AppHandle, repo_full_name: String, request: GitHubCreateRepositoryDiscussionRequest,) -> Result<GitHubRepositoryDiscussion, String>);
delegate_command!(async github_discussions; fn github_create_discussion_comment(app: AppHandle, request: GitHubCreateDiscussionCommentRequest,) -> Result<GitHubRepositoryDiscussionComment, String>);
delegate_command!(async github_discussions; fn github_update_discussion_comment(app: AppHandle, request: GitHubUpdateDiscussionCommentRequest,) -> Result<GitHubRepositoryDiscussionComment, String>);
delegate_command!(async github_discussions; fn github_delete_discussion_comment(app: AppHandle, comment_id: String,) -> Result<(), String>);
delegate_command!(async github_discussions; fn github_update_discussion_reaction(app: AppHandle, request: GitHubDiscussionReactionRequest,) -> Result<(), String>);
delegate_command!(async github_discussions; fn github_update_discussion_state(app: AppHandle, request: GitHubDiscussionStateRequest,) -> Result<(), String>);
delegate_command!(async github_discussions; fn github_update_discussion_answer(app: AppHandle, request: GitHubDiscussionAnswerRequest,) -> Result<(), String>);

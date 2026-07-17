use lilia_github_contracts::workspace::*;

delegate_command!(async conversations; fn github_create_issue_comment(app: AppHandle, repo_full_name: String, issue_number: u64, request: GitHubIssueCommentRequest,) -> Result<GitHubDiscussionTimelineItem, String>);
delegate_command!(async conversations; fn github_update_issue_comment(app: AppHandle, repo_full_name: String, comment_id: u64, request: GitHubIssueCommentRequest,) -> Result<GitHubDiscussionTimelineItem, String>);
delegate_command!(async conversations; fn github_delete_issue_comment(app: AppHandle, repo_full_name: String, comment_id: u64,) -> Result<(), String>);
delegate_command!(async conversations; fn github_add_issue_comment_reaction(app: AppHandle, repo_full_name: String, comment_id: u64, request: GitHubIssueCommentReactionRequest,) -> Result<(), String>);

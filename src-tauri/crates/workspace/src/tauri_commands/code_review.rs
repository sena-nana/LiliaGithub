use lilia_github_contracts::code_review::*;

delegate_command!(async code_review; fn github_get_pull_request_code_review(app: AppHandle, repo_full_name: String, pull_number: u64,) -> Result<GitHubPullRequestCodeReviewDetail, String>);
delegate_command!(async code_review; fn github_create_pull_request_line_comment(app: AppHandle, repo_full_name: String, pull_number: u64, request: GitHubCreatePullRequestLineCommentRequest,) -> Result<GitHubPullRequestReviewComment, String>);
delegate_command!(async code_review; fn github_reply_pull_request_review_thread(app: AppHandle, repo_full_name: String, request: GitHubReplyPullRequestReviewThreadRequest,) -> Result<GitHubPullRequestReviewComment, String>);
delegate_command!(async code_review; fn github_submit_pull_request_code_review(app: AppHandle, repo_full_name: String, pull_number: u64, request: GitHubSubmitPullRequestCodeReviewRequest,) -> Result<GitHubPullRequestReview, String>);

use lilia_github_contracts::discovery::{
    GitHubDiscoveryRepositoryStatus, GitHubDiscoveryScanRequest, GitHubDiscoveryScanResult,
    GitHubSubmitPullRequestReviewRequest,
};

delegate_command!(async discovery; fn github_discovery_get_repository_status(app: AppHandle, repo_full_name: String, force_refresh: Option<bool>,) -> Result<GitHubDiscoveryRepositoryStatus, String>);
delegate_command!(async discovery; fn github_discovery_scan(app: AppHandle, request: GitHubDiscoveryScanRequest,) -> Result<GitHubDiscoveryScanResult, String>);
delegate_command!(async discovery; fn github_discovery_submit_pull_request_review(app: AppHandle, repo_full_name: String, pull_number: u64, request: GitHubSubmitPullRequestReviewRequest,) -> Result<(), String>);

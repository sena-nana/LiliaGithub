use super::*;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSettings {
    pub workspace_root: Option<String>,
    pub github_binding: Option<GitHubBindingMetadata>,
    #[serde(default)]
    pub project_launch_configs: HashMap<String, ProjectLaunchConfig>,
    #[serde(default)]
    pub repo_sync_preferences: HashMap<String, RepoSyncPreference>,
    #[serde(default)]
    pub hidden_repo_ids: Vec<String>,
    #[serde(default)]
    pub managed_repo_ids: Vec<String>,
    #[serde(default)]
    pub system_git_repo_ids: Vec<String>,
    #[serde(default)]
    pub repo_groups: Vec<WorkspaceRepoGroup>,
    #[serde(default)]
    pub remote_repo_shortcuts: Vec<RemoteRepoShortcut>,
    #[serde(default)]
    pub local_contribution_cache: HashMap<String, HashMap<String, LocalContributionDayCache>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStartupCache {
    #[serde(default)]
    pub workspace_root: Option<String>,
    #[serde(default)]
    pub binding_login: Option<String>,
    #[serde(default)]
    pub repos_by_id: HashMap<String, CachedRepoSummary>,
    #[serde(default)]
    pub contributions: Option<CachedContributionResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedRepoSummary {
    pub summary: RepoSummary,
    pub cached_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedContributionResult {
    pub days: Vec<GitHubContributionDay>,
    pub meta: GitHubContributionMeta,
    pub cached_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStartupContributions {
    #[serde(default)]
    pub days: Vec<GitHubContributionDay>,
    pub meta: GitHubContributionMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRepoGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub repo_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalContributionDayCache {
    pub count: usize,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepoSyncPreference {
    #[serde(default)]
    pub auto_sync: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLaunchConfig {
    pub command: String,
    #[serde(default)]
    pub cwd: Option<String>,
    pub source: String,
    #[serde(default)]
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLaunchCandidate {
    pub command: String,
    pub label: String,
    #[serde(default)]
    pub hint: Option<String>,
    pub kind: String,
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLaunchStatus {
    pub repo_id: String,
    pub state: String,
    #[serde(default)]
    pub pid: Option<u32>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub started_at: Option<i64>,
    #[serde(default)]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLaunchLog {
    pub index: u64,
    pub repo_id: String,
    pub stream: String,
    pub line: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubBindingMetadata {
    pub login: String,
    pub avatar_url: Option<String>,
    pub bound_at: i64,
    #[serde(default)]
    pub scopes: Vec<String>,
    pub client_id_source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubBindingStatus {
    pub state: String,
    pub client_id_configured: bool,
    pub client_id_source: String,
    pub binding: Option<GitHubBindingMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDeviceFlowStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_at: i64,
    pub interval_seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDeviceFlowPollResult {
    pub status: String,
    pub interval_seconds: i64,
    pub binding_status: Option<GitHubBindingStatus>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubContributionDay {
    pub date: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubContributionMeta {
    pub repo_count: usize,
    pub requested_repo_count: usize,
    pub repo_limit: usize,
    pub truncated: bool,
    pub skipped_repo_count: usize,
    pub refreshed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubContributionResult {
    pub days: Vec<GitHubContributionDay>,
    pub meta: GitHubContributionMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepoSummary {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub owner_login: String,
    pub private: bool,
    pub disabled: bool,
    pub archived: bool,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub default_branch: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub clone_url: String,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRepoShortcut {
    pub full_name: String,
    pub name: String,
    pub private: bool,
    pub archived: bool,
    #[serde(default)]
    pub default_branch: Option<String>,
    pub html_url: String,
    pub clone_url: String,
    #[serde(default)]
    pub opened_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepoPage {
    pub items: Vec<GitHubRepoSummary>,
    #[serde(default)]
    pub next_page: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageStat {
    pub language: String,
    pub bytes: u64,
    pub lines: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoWorktree {
    pub role: String,
    pub shared_repo_key: String,
    #[serde(default)]
    pub main_repo_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    pub id: String,
    pub name: String,
    pub path: String,
    pub relative_path: String,
    pub current_branch: Option<String>,
    pub remote_url: Option<String>,
    pub github_full_name: Option<String>,
    pub ahead: i32,
    pub behind: i32,
    pub staged_count: usize,
    pub unstaged_count: usize,
    pub untracked_count: usize,
    pub conflict_count: usize,
    pub last_commit_at: Option<i64>,
    pub last_commit_message: Option<String>,
    #[serde(default)]
    pub language_stats: Vec<LanguageStat>,
    #[serde(default)]
    pub language_stats_updated_at: i64,
    pub worktree: RepoWorktree,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRefreshSummaryOptions {
    #[serde(default)]
    pub fetch_remote: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoChange {
    pub path: String,
    pub old_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub conflicted: bool,
    pub diff: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoConflictState {
    pub operation: String,
    pub files: Vec<RepoConflictFile>,
    pub all_resolved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoConflictFile {
    pub path: String,
    pub status: String,
    pub resolved: bool,
    pub binary: bool,
    pub hunks: Vec<RepoConflictHunk>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoConflictHunk {
    pub id: String,
    pub start_line: usize,
    pub end_line: usize,
    pub ours_label: String,
    pub theirs_label: String,
    pub ours_lines: Vec<String>,
    pub theirs_lines: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoConflictChoice {
    pub hunk_id: String,
    pub side: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoMergePullResult {
    pub status: String,
    pub message: String,
    pub summary: RepoSummary,
    pub conflicts: RepoConflictState,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RepoPullLocalChangesMode {
    Reject,
    Stash,
    Discard,
}

impl Default for RepoPullLocalChangesMode {
    fn default() -> Self {
        Self::Reject
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoOperationResult {
    pub status: String,
    pub message: String,
    pub summary: RepoSummary,
    pub conflicts: RepoConflictState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    #[serde(default)]
    pub author_email: Option<String>,
    pub timestamp: i64,
    pub subject: String,
    #[serde(default)]
    pub parents: Vec<String>,
    #[serde(default)]
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDiffLine {
    pub kind: String,
    pub content: String,
    #[serde(default)]
    pub old_line: Option<i32>,
    #[serde(default)]
    pub new_line: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDiffHunk {
    pub header: String,
    pub old_start: i32,
    pub old_lines: i32,
    pub new_start: i32,
    pub new_lines: i32,
    pub lines: Vec<CommitDiffLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileChange {
    pub path: String,
    #[serde(default)]
    pub old_path: Option<String>,
    pub status: String,
    pub additions: i32,
    pub deletions: i32,
    pub patch: String,
    pub hunks: Vec<CommitDiffHunk>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    #[serde(default)]
    pub author_email: Option<String>,
    pub committer: String,
    #[serde(default)]
    pub committer_email: Option<String>,
    pub timestamp: i64,
    pub subject: String,
    pub body: String,
    #[serde(default)]
    pub parents: Vec<String>,
    #[serde(default)]
    pub refs: Vec<String>,
    pub files: Vec<CommitFileChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStashEntry {
    pub id: String,
    pub index: usize,
    #[serde(default)]
    pub branch: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStashDetail {
    pub entry: RepoStashEntry,
    pub files: Vec<CommitFileChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRemote {
    pub name: String,
    pub fetch_url: String,
    #[serde(default)]
    pub push_url: Option<String>,
    pub current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchSummary {
    pub name: String,
    pub remote: bool,
    pub current: bool,
    pub upstream: Option<String>,
    pub ahead: i32,
    pub behind: i32,
    #[serde(default)]
    pub protected: bool,
    #[serde(default)]
    pub tip_timestamp: Option<i64>,
    #[serde(default)]
    pub checked_out_worktree_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoDetail {
    pub summary: RepoSummary,
    pub changes: Vec<RepoChange>,
    pub commits: Vec<CommitSummary>,
    pub branches: Vec<BranchSummary>,
    pub conflicts: RepoConflictState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoFileTreeEntry {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub has_children: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoFilePreview {
    pub path: String,
    pub name: String,
    pub preview_kind: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub data_url: Option<String>,
    #[serde(default)]
    pub images: HashMap<String, String>,
    pub size: u64,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkSyncPreview {
    pub operation: String,
    pub eligible: Vec<BulkSyncRepo>,
    pub blocked: Vec<BulkSyncRepo>,
    pub warnings: Vec<BulkSyncRepo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkSyncRepo {
    pub repo: RepoSummary,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkSyncResult {
    pub repo_id: String,
    pub status: String,
    pub message: String,
    pub summary: Option<RepoSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenRepo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTask {
    pub id: String,
    pub kind: String,
    pub priority: String,
    #[serde(default)]
    pub repo_id: Option<String>,
    pub status: String,
    #[serde(default)]
    pub message: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepoOwner {
    pub login: String,
    pub kind: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCreateLocalRepoRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub add_readme: bool,
    #[serde(default)]
    pub gitignore_template: Option<String>,
    #[serde(default)]
    pub license_template: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCreateRepoRequest {
    pub owner: String,
    pub owner_kind: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub private: bool,
    #[serde(default)]
    pub auto_init: bool,
    #[serde(default)]
    pub gitignore_template: Option<String>,
    #[serde(default)]
    pub license_template: Option<String>,
    #[serde(default = "default_true")]
    pub has_issues: bool,
    #[serde(default = "default_true")]
    pub has_wiki: bool,
    #[serde(default)]
    pub template_full_name: Option<String>,
    #[serde(default)]
    pub include_all_branches: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepoLicense {
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub spdx_id: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepoManagement {
    pub full_name: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub topics: Vec<String>,
    pub private: bool,
    pub default_branch: String,
    pub has_issues: bool,
    pub has_wiki: bool,
    pub has_projects: bool,
    pub has_discussions: bool,
    pub allow_merge_commit: bool,
    pub allow_squash_merge: bool,
    pub allow_rebase_merge: bool,
    pub allow_auto_merge: bool,
    pub delete_branch_on_merge: bool,
    pub allow_forking: bool,
    pub web_commit_signoff_required: bool,
    pub stargazers_count: u64,
    pub watchers_count: u64,
    pub forks_count: u64,
    pub html_url: String,
    #[serde(default)]
    pub license: Option<GitHubRepoLicense>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubUpdateRepoSettingsRequest {
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub topics: Option<Vec<String>>,
    #[serde(default)]
    pub private: Option<bool>,
    #[serde(default)]
    pub default_branch: Option<String>,
    #[serde(default)]
    pub has_issues: Option<bool>,
    #[serde(default)]
    pub has_wiki: Option<bool>,
    #[serde(default)]
    pub has_projects: Option<bool>,
    #[serde(default)]
    pub has_discussions: Option<bool>,
    #[serde(default)]
    pub allow_merge_commit: Option<bool>,
    #[serde(default)]
    pub allow_squash_merge: Option<bool>,
    #[serde(default)]
    pub allow_rebase_merge: Option<bool>,
    #[serde(default)]
    pub allow_auto_merge: Option<bool>,
    #[serde(default)]
    pub delete_branch_on_merge: Option<bool>,
    #[serde(default)]
    pub allow_forking: Option<bool>,
    #[serde(default)]
    pub web_commit_signoff_required: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubIssue {
    pub number: u64,
    pub title: String,
    pub state: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub assignees: Vec<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub milestone: Option<GitHubIssueMilestone>,
    #[serde(default)]
    pub comments: u64,
    #[serde(default)]
    pub project_items: Vec<GitHubIssueProjectItem>,
    #[serde(default)]
    pub development_items: Vec<GitHubDevelopmentItem>,
    pub html_url: String,
    pub updated_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubIssueMilestone {
    pub number: u64,
    pub title: String,
    #[serde(default)]
    pub state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubIssueProjectItem {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDevelopmentItem {
    pub id: String,
    pub kind: String,
    pub label: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub number: Option<u64>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub repository_full_name: Option<String>,
    #[serde(default)]
    pub ref_name: Option<String>,
    #[serde(default)]
    pub sha: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitHubIssueFilterMetadata {
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub assignees: Vec<String>,
    #[serde(default)]
    pub milestones: Vec<GitHubIssueMilestone>,
    #[serde(default)]
    pub projects: Vec<GitHubIssueProjectItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDiscussionTimelineItem {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub actor: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub event: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub line: Option<u64>,
    #[serde(default)]
    pub original_line: Option<u64>,
    #[serde(default)]
    pub commit_id: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubIssueDiscussion {
    pub issue: GitHubIssue,
    pub timeline: Vec<GitHubDiscussionTimelineItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPullRequest {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub draft: bool,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub assignees: Vec<String>,
    #[serde(default)]
    pub milestone: Option<GitHubIssueMilestone>,
    #[serde(default)]
    pub comments: u64,
    #[serde(default)]
    pub project_items: Vec<GitHubIssueProjectItem>,
    #[serde(default)]
    pub reviewers: Vec<GitHubPullRequestReviewer>,
    #[serde(default)]
    pub development_items: Vec<GitHubDevelopmentItem>,
    #[serde(default)]
    pub commit_count: Option<u64>,
    pub html_url: String,
    pub updated_at: String,
    pub created_at: String,
    pub author: String,
    pub base_branch: String,
    pub head_branch: String,
    pub merged: bool,
    #[serde(default)]
    pub mergeable: Option<bool>,
    #[serde(default)]
    pub mergeable_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPullRequestReviewer {
    pub login: String,
    pub kind: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPullRequestCheck {
    pub id: u64,
    pub name: String,
    pub status: String,
    #[serde(default)]
    pub conclusion: Option<String>,
    #[serde(default)]
    pub details_url: Option<String>,
    #[serde(default)]
    pub html_url: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPullRequestDiscussion {
    pub pull_request: GitHubPullRequest,
    pub timeline: Vec<GitHubDiscussionTimelineItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkflowRun {
    pub id: u64,
    pub name: String,
    pub display_title: String,
    pub status: String,
    #[serde(default)]
    pub conclusion: Option<String>,
    pub branch: String,
    pub event: String,
    pub html_url: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub actor: Option<String>,
    #[serde(default)]
    pub head_sha: Option<String>,
    #[serde(default)]
    pub run_number: Option<u64>,
    #[serde(default)]
    pub run_attempt: Option<u64>,
    #[serde(default)]
    pub workflow_id: Option<u64>,
    #[serde(default)]
    pub run_started_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkflowJobStep {
    pub name: String,
    pub status: String,
    #[serde(default)]
    pub conclusion: Option<String>,
    pub number: u64,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkflowJob {
    pub id: u64,
    pub name: String,
    pub status: String,
    #[serde(default)]
    pub conclusion: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub html_url: Option<String>,
    #[serde(default)]
    pub runner_name: Option<String>,
    #[serde(default)]
    pub steps: Vec<GitHubWorkflowJobStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkflowArtifact {
    pub id: u64,
    pub name: String,
    pub size_in_bytes: u64,
    pub expired: bool,
    pub created_at: String,
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkflowDefinition {
    pub id: u64,
    pub path: String,
    pub ref_name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkflowRunDetail {
    pub run: GitHubWorkflowRun,
    pub jobs: Vec<GitHubWorkflowJob>,
    pub artifacts: Vec<GitHubWorkflowArtifact>,
    #[serde(default)]
    pub workflow: Option<GitHubWorkflowDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkflowJobLog {
    pub job_id: u64,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkflowArtifactEntry {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubReleaseAsset {
    pub id: u64,
    pub name: String,
    #[serde(default)]
    pub label: Option<String>,
    pub content_type: String,
    pub size: u64,
    pub download_count: u64,
    pub state: String,
    pub browser_download_url: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub uploader: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRelease {
    pub id: u64,
    pub tag_name: String,
    pub target_commitish: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    pub draft: bool,
    pub prerelease: bool,
    pub immutable: bool,
    #[serde(default)]
    pub make_latest: Option<String>,
    pub html_url: String,
    pub upload_url: String,
    #[serde(default)]
    pub tarball_url: Option<String>,
    #[serde(default)]
    pub zipball_url: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCreateReleaseRequest {
    pub tag_name: String,
    #[serde(default)]
    pub target_commitish: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub draft: Option<bool>,
    #[serde(default)]
    pub prerelease: Option<bool>,
    #[serde(default)]
    pub generate_release_notes: Option<bool>,
    #[serde(default)]
    pub make_latest: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubUpdateReleaseRequest {
    #[serde(default)]
    pub tag_name: Option<String>,
    #[serde(default)]
    pub target_commitish: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub draft: Option<bool>,
    #[serde(default)]
    pub prerelease: Option<bool>,
    #[serde(default)]
    pub make_latest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitHubProjectCache {
    #[serde(default)]
    pub repos: HashMap<String, GitHubProjectRepoCache>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitHubProjectRepoCache {
    #[serde(default)]
    pub management: Option<GitHubRepoManagement>,
    #[serde(default)]
    pub issues: HashMap<String, Vec<GitHubIssue>>,
    #[serde(default)]
    pub issue_discussions: HashMap<String, GitHubIssueDiscussion>,
    #[serde(default)]
    pub pull_requests: HashMap<String, Vec<GitHubPullRequest>>,
    #[serde(default)]
    pub pull_request_discussions: HashMap<String, GitHubPullRequestDiscussion>,
    #[serde(default)]
    pub pull_request_checks: HashMap<String, Vec<GitHubPullRequestCheck>>,
    #[serde(default)]
    pub workflow_runs: HashMap<String, Vec<GitHubWorkflowRun>>,
    #[serde(default)]
    pub releases: Option<Vec<GitHubRelease>>,
    #[serde(default)]
    pub commits: HashMap<String, Vec<CommitSummary>>,
    #[serde(default)]
    pub commit_details: HashMap<String, CommitDetail>,
    #[serde(default)]
    pub issue_labels: Option<Vec<String>>,
    #[serde(default)]
    pub issue_assignees: Option<Vec<String>>,
    #[serde(default)]
    pub issue_filter_metadata: Option<GitHubIssueFilterMetadata>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCreateIssueRequest {
    pub title: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub assignees: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubUpdateIssueRequest {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub labels: Option<Vec<String>>,
    #[serde(default)]
    pub assignees: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCreatePullRequestRequest {
    pub title: String,
    #[serde(default)]
    pub body: Option<String>,
    pub head: String,
    pub base: String,
    #[serde(default)]
    pub draft: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitHubUpdatePullRequestRequest {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub base: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitHubMergePullRequestRequest {
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub commit_title: Option<String>,
    #[serde(default)]
    pub commit_message: Option<String>,
    #[serde(default)]
    pub sha: Option<String>,
}

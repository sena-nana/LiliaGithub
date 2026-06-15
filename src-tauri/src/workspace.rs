use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use keyring_core::{Entry, Error as KeyringError};
use reqwest::blocking::{Client, RequestBuilder, Response};
use reqwest::header::{ACCEPT, LINK, USER_AGENT};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::StoreExt;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(unix)]
use std::os::unix::process::CommandExt;

const STORE_FILE: &str = "lilia-github.json";
const SETTINGS_KEY: &str = "workspace.settings";
const GITHUB_CLIENT_ID: &str = "Ov23liJWTEjz4jgqx19u";
const GITHUB_SCOPE: &str = "repo workflow read:user delete_repo";
const GITHUB_DELETE_REPO_SCOPE: &str = "delete_repo";
const GITHUB_SERVICE: &str = "com.lilia.desktop.github";
const GITHUB_ACCEPT: &str = "application/vnd.github+json";
const GITHUB_OAUTH_ACCEPT: &str = "application/json";
const GITHUB_USER_AGENT: &str = "LiliaGithub/0.1";
const LAUNCH_LOG_LIMIT: usize = 500;
const GITHUB_CONTRIBUTIONS_REPO_LIMIT: usize = 30;
const GITHUB_CONTRIBUTION_DAYS: usize = 371;
const GITHUB_COMMITS_PER_PAGE: usize = 100;
const GITHUB_COMMITS_MAX_PAGES: usize = 10;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

async fn run_blocking<T, F>(label: &'static str, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|e| format!("{label}后台任务异常：{e}"))?
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSettings {
    pub workspace_root: Option<String>,
    pub github_binding: Option<GitHubBindingMetadata>,
    #[serde(default)]
    pub project_launch_configs: HashMap<String, ProjectLaunchConfig>,
    #[serde(default)]
    pub hidden_repo_ids: Vec<String>,
    #[serde(default)]
    pub managed_repo_ids: Vec<String>,
    #[serde(default)]
    pub remote_repo_shortcuts: Vec<RemoteRepoShortcut>,
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
    pub working_tree_language_stats: Vec<LanguageStat>,
    #[serde(default)]
    pub language_stats_updated_at: i64,
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct RepoStatusEntry {
    index: String,
    worktree: String,
    path: String,
    old_path: Option<String>,
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
pub struct BranchSummary {
    pub name: String,
    pub remote: bool,
    pub current: bool,
    pub upstream: Option<String>,
    pub ahead: i32,
    pub behind: i32,
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
pub struct RepoReadme {
    pub repo_id: String,
    pub path: String,
    pub images: HashMap<String, String>,
    pub content: String,
    pub format: String,
    #[serde(default)]
    pub updated_at: Option<i64>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: i64,
    interval: i64,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    scope: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubErrorResponse {
    error: Option<String>,
    error_description: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubUserResponse {
    login: String,
    avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubRepoOwnerResponse {
    login: String,
}

#[derive(Debug, Deserialize)]
struct GitHubRepoResponse {
    id: u64,
    name: String,
    full_name: String,
    private: bool,
    #[serde(default)]
    disabled: bool,
    #[serde(default)]
    archived: bool,
    description: Option<String>,
    default_branch: Option<String>,
    created_at: String,
    updated_at: String,
    clone_url: String,
    html_url: String,
    owner: GitHubRepoOwnerResponse,
    #[serde(default)]
    homepage: Option<String>,
    #[serde(default)]
    has_issues: bool,
    #[serde(default)]
    has_wiki: bool,
    #[serde(default)]
    has_projects: bool,
    #[serde(default)]
    has_discussions: bool,
    #[serde(default)]
    allow_merge_commit: bool,
    #[serde(default)]
    allow_squash_merge: bool,
    #[serde(default)]
    allow_rebase_merge: bool,
    #[serde(default)]
    allow_auto_merge: bool,
    #[serde(default)]
    delete_branch_on_merge: bool,
    #[serde(default)]
    allow_forking: bool,
    #[serde(default)]
    web_commit_signoff_required: bool,
}

#[derive(Debug, Deserialize)]
struct GitHubContentListItem {
    name: String,
    path: String,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Debug, Deserialize)]
struct GitHubContentFileResponse {
    name: String,
    path: String,
    encoding: Option<String>,
    content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepoOwner {
    pub login: String,
    pub kind: String,
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
    pub html_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubUpdateRepoSettingsRequest {
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
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
    pub html_url: String,
    pub updated_at: String,
    pub created_at: String,
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

#[derive(Debug, Deserialize)]
struct GitHubOrgResponse {
    login: String,
}

#[derive(Debug, Deserialize)]
struct GitHubLabelResponse {
    name: String,
}

#[derive(Debug, Deserialize)]
struct GitHubAssigneeResponse {
    login: String,
}

#[derive(Debug, Deserialize)]
struct GitHubIssueResponse {
    number: u64,
    title: String,
    state: String,
    body: Option<String>,
    html_url: String,
    updated_at: String,
    created_at: String,
    #[serde(default)]
    labels: Vec<GitHubLabelResponse>,
    #[serde(default)]
    assignees: Vec<GitHubAssigneeResponse>,
    #[serde(default)]
    pull_request: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct GitHubWorkflowRunsResponse {
    #[serde(default)]
    workflow_runs: Vec<GitHubWorkflowRunResponse>,
}

#[derive(Debug, Deserialize)]
struct GitHubWorkflowRunResponse {
    id: u64,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    display_title: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    conclusion: Option<String>,
    #[serde(default)]
    head_branch: Option<String>,
    #[serde(default)]
    event: Option<String>,
    html_url: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedGitHubRepo {
    owner: String,
    name: String,
    full_name: String,
    clone_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RepoFetchFailure {
    repo_name: String,
    error: String,
}

#[derive(Debug, Deserialize)]
struct GitHubCommitResponse {
    commit: GitHubCommitPayload,
}

#[derive(Debug, Deserialize)]
struct GitHubCommitPayload {
    author: Option<GitHubCommitAuthor>,
}

#[derive(Debug, Deserialize)]
struct GitHubCommitAuthor {
    date: Option<String>,
}

struct LaunchEntry {
    child: Option<Child>,
    status: ProjectLaunchStatus,
}

struct KeyringGuard;

impl Drop for KeyringGuard {
    fn drop(&mut self) {
        keyring::release_store();
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
}

fn default_true() -> bool {
    true
}

fn launch_runtime() -> &'static Mutex<HashMap<String, LaunchEntry>> {
    static RUNTIME: OnceLock<Mutex<HashMap<String, LaunchEntry>>> = OnceLock::new();
    RUNTIME.get_or_init(|| Mutex::new(HashMap::new()))
}

fn launch_logs() -> &'static Mutex<HashMap<String, VecDeque<ProjectLaunchLog>>> {
    static LOGS: OnceLock<Mutex<HashMap<String, VecDeque<ProjectLaunchLog>>>> = OnceLock::new();
    LOGS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn workspace_tasks() -> &'static Mutex<Vec<WorkspaceTask>> {
    static TASKS: OnceLock<Mutex<Vec<WorkspaceTask>>> = OnceLock::new();
    TASKS.get_or_init(|| Mutex::new(Vec::new()))
}

fn next_launch_log_index() -> u64 {
    static INDEX: AtomicU64 = AtomicU64::new(1);
    INDEX.fetch_add(1, Ordering::Relaxed)
}

fn next_workspace_task_id() -> String {
    static INDEX: AtomicU64 = AtomicU64::new(1);
    format!(
        "workspace-task-{}-{}",
        now_millis(),
        INDEX.fetch_add(1, Ordering::Relaxed)
    )
}

fn idle_launch_status(repo_id: &str) -> ProjectLaunchStatus {
    ProjectLaunchStatus {
        repo_id: repo_id.to_string(),
        state: "idle".to_string(),
        pid: None,
        command: None,
        started_at: None,
        exit_code: None,
        error: None,
    }
}

fn push_launch_log(repo_id: &str, stream: &str, line: impl Into<String>) {
    let mut logs = launch_logs().lock().unwrap_or_else(|e| e.into_inner());
    let repo_logs = logs.entry(repo_id.to_string()).or_default();
    repo_logs.push_back(ProjectLaunchLog {
        index: next_launch_log_index(),
        repo_id: repo_id.to_string(),
        stream: stream.to_string(),
        line: line.into(),
        timestamp: now_millis(),
    });
    while repo_logs.len() > LAUNCH_LOG_LIMIT {
        repo_logs.pop_front();
    }
}

fn refresh_launch_entry(repo_id: &str, entry: &mut LaunchEntry) {
    if entry.status.state != "running" {
        return;
    }
    let Some(child) = entry.child.as_mut() else {
        entry.status.state = "idle".to_string();
        entry.status.pid = None;
        return;
    };
    match child.try_wait() {
        Ok(Some(status)) => {
            let exit_code = status.code();
            entry.child = None;
            entry.status.state = "exited".to_string();
            entry.status.pid = None;
            entry.status.exit_code = exit_code;
            entry.status.error = None;
            push_launch_log(
                repo_id,
                "system",
                format!("进程已退出：exit {}", exit_code.unwrap_or(-1)),
            );
        }
        Ok(None) => {}
        Err(err) => {
            entry.child = None;
            entry.status.state = "error".to_string();
            entry.status.pid = None;
            entry.status.error = Some(err.to_string());
            push_launch_log(repo_id, "system", format!("读取进程状态失败：{err}"));
        }
    }
}

fn load_settings(app: &AppHandle) -> WorkspaceSettings {
    app.store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(SETTINGS_KEY))
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, settings: &WorkspaceSettings) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("打开配置存储失败：{e}"))?;
    store.set(
        SETTINGS_KEY,
        serde_json::to_value(settings).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| format!("保存配置失败：{e}"))
}

fn task_priority_rank(priority: &str) -> usize {
    match priority {
        "high" => 0,
        "normal" => 1,
        _ => 2,
    }
}

fn record_workspace_task(
    kind: &str,
    priority: &str,
    repo_id: Option<String>,
    status: &str,
    message: Option<String>,
) -> WorkspaceTask {
    let task = WorkspaceTask {
        id: next_workspace_task_id(),
        kind: kind.to_string(),
        priority: priority.to_string(),
        repo_id,
        status: status.to_string(),
        message,
        updated_at: now_millis(),
    };
    let mut tasks = workspace_tasks().lock().unwrap_or_else(|e| e.into_inner());
    tasks.push(task.clone());
    tasks.sort_by(|a, b| {
        task_priority_rank(&a.priority)
            .cmp(&task_priority_rank(&b.priority))
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });
    while tasks.len() > 200 {
        tasks.pop();
    }
    task
}

fn update_workspace_task(task_id: &str, status: &str, message: Option<String>) {
    let mut tasks = workspace_tasks().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(task) = tasks.iter_mut().find(|task| task.id == task_id) {
        task.status = status.to_string();
        task.message = message;
        task.updated_at = now_millis();
    }
}

fn client_id() -> Option<&'static str> {
    let trimmed = GITHUB_CLIENT_ID.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn client_id_source() -> &'static str {
    if client_id().is_some() {
        "bundled"
    } else {
        "none"
    }
}

fn binding_status(binding: Option<GitHubBindingMetadata>) -> GitHubBindingStatus {
    GitHubBindingStatus {
        state: if binding.is_some() {
            "bound".to_string()
        } else {
            "unbound".to_string()
        },
        client_id_configured: client_id().is_some(),
        client_id_source: client_id_source().to_string(),
        binding,
    }
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| format!("构造 GitHub HTTP 客户端失败：{e}"))
}

fn init_keyring() -> Result<KeyringGuard, String> {
    keyring::use_native_store(true).map_err(|e| format!("系统钥匙串不可用：{e}"))?;
    Ok(KeyringGuard)
}

fn keyring_entry(login: &str) -> Result<Entry, String> {
    Entry::new(GITHUB_SERVICE, login).map_err(|e| format!("创建 GitHub 凭证项失败：{e}"))
}

fn read_token(login: &str) -> Result<Option<String>, String> {
    let _guard = init_keyring()?;
    let entry = keyring_entry(login)?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(format!("读取 GitHub 凭证失败：{err}")),
    }
}

fn write_token(login: &str, token: &str) -> Result<(), String> {
    let _guard = init_keyring()?;
    keyring_entry(login)?
        .set_password(token)
        .map_err(|e| format!("保存 GitHub 凭证失败：{e}"))
}

fn normalize_scope_list(scope: Option<&str>) -> Vec<String> {
    scope
        .unwrap_or("")
        .split(|ch: char| ch == ',' || ch.is_whitespace())
        .filter(|part| !part.trim().is_empty())
        .map(|part| part.trim().to_string())
        .collect()
}

fn github_headers(
    builder: RequestBuilder,
    token: Option<&str>,
) -> RequestBuilder {
    let builder = builder
        .header(USER_AGENT, GITHUB_USER_AGENT)
        .header(ACCEPT, GITHUB_ACCEPT)
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(token) = token {
        builder.bearer_auth(token)
    } else {
        builder
    }
}

fn github_oauth_headers(
    builder: RequestBuilder,
) -> RequestBuilder {
    builder
        .header(USER_AGENT, GITHUB_USER_AGENT)
        .header(ACCEPT, GITHUB_OAUTH_ACCEPT)
}

fn github_http_error(prefix: &str, response: Response) -> String {
    let status = response.status();
    let body = response.text().unwrap_or_default();
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return format!("{prefix}：HTTP {status}");
    }
    if let Ok(error) = serde_json::from_str::<GitHubErrorResponse>(trimmed) {
        if let Some(detail) = error
            .error_description
            .or(error.message)
            .or(error.error)
            .filter(|value| !value.trim().is_empty())
        {
            return format!("{prefix}：HTTP {status}：{detail}");
        }
    }
    let detail = trimmed.chars().take(240).collect::<String>();
    format!("{prefix}：HTTP {status}：{detail}")
}

fn github_binding_expired_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::UNAUTHORIZED
}

fn github_json<T: for<'de> Deserialize<'de>>(
    prefix: &str,
    response: Response,
) -> Result<T, String> {
    if !response.status().is_success() {
        return Err(github_http_error(prefix, response));
    }
    response
        .json::<T>()
        .map_err(|e| format!("{prefix}：解析响应失败：{e}"))
}

fn github_require_token(app: &AppHandle) -> Result<(GitHubBindingMetadata, String), String> {
    let mut settings = load_settings(app);
    let Some(binding) = settings.github_binding.clone() else {
        return Err("请先绑定 GitHub".to_string());
    };
    let Some(token) = read_token(&binding.login)? else {
        settings.github_binding = None;
        save_settings(app, &settings)?;
        return Err("GitHub 绑定已失效，请重新绑定".to_string());
    };
    Ok((binding, token))
}

fn github_require_scope(binding: &GitHubBindingMetadata, scope: &str) -> Result<(), String> {
    if binding.scopes.iter().any(|item| item == scope) {
        return Ok(());
    }
    Err(format!("GitHub 绑定缺少 {scope} 权限，请重新绑定 GitHub 后再试"))
}

fn github_send(app: &AppHandle, prefix: &str, builder: RequestBuilder) -> Result<Response, String> {
    let response = builder
        .send()
        .map_err(|e| format!("{prefix}：{e}"))?;
    if github_binding_expired_status(response.status()) {
        let mut settings = load_settings(app);
        settings.github_binding = None;
        save_settings(app, &settings)?;
        return Err("GitHub 绑定已失效，请重新绑定".to_string());
    }
    Ok(response)
}

fn github_repo_summary_from_response(repo: GitHubRepoResponse) -> GitHubRepoSummary {
    GitHubRepoSummary {
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        owner_login: repo.owner.login,
        private: repo.private,
        disabled: repo.disabled,
        archived: repo.archived,
        description: repo.description,
        default_branch: repo.default_branch,
        created_at: repo.created_at,
        updated_at: repo.updated_at,
        clone_url: repo.clone_url,
        html_url: repo.html_url,
    }
}

fn normalize_remote_repo_shortcut(mut shortcut: RemoteRepoShortcut) -> Result<RemoteRepoShortcut, String> {
    let repo = normalize_github_repo_input(&shortcut.full_name)?;
    shortcut.full_name = repo.full_name;
    shortcut.name = normalize_optional_string(Some(shortcut.name))
        .unwrap_or_else(|| repo.name.clone());
    shortcut.default_branch = normalize_optional_string(shortcut.default_branch);
    shortcut.html_url = normalize_optional_string(Some(shortcut.html_url))
        .unwrap_or_else(|| format!("https://github.com/{}", shortcut.full_name));
    shortcut.clone_url = normalize_optional_string(Some(shortcut.clone_url))
        .unwrap_or(repo.clone_url);
    shortcut.opened_at = now_millis();
    Ok(shortcut)
}

fn remember_remote_repo_shortcut(
    shortcuts: &mut Vec<RemoteRepoShortcut>,
    shortcut: RemoteRepoShortcut,
) -> Result<(), String> {
    let shortcut = normalize_remote_repo_shortcut(shortcut)?;
    shortcuts.retain(|item| item.full_name != shortcut.full_name);
    shortcuts.push(shortcut);
    shortcuts.sort_by(|a, b| {
        b.opened_at
            .cmp(&a.opened_at)
            .then_with(|| a.full_name.cmp(&b.full_name))
    });
    Ok(())
}

fn forget_remote_repo_shortcut(shortcuts: &mut Vec<RemoteRepoShortcut>, full_name: &str) -> Result<(), String> {
    let repo = normalize_github_repo_input(full_name)?;
    shortcuts.retain(|item| item.full_name != repo.full_name);
    Ok(())
}

fn github_repo_management_from_response(repo: GitHubRepoResponse) -> GitHubRepoManagement {
    GitHubRepoManagement {
        full_name: repo.full_name,
        name: repo.name,
        description: repo.description,
        homepage: repo.homepage,
        private: repo.private,
        default_branch: repo.default_branch.unwrap_or_default(),
        has_issues: repo.has_issues,
        has_wiki: repo.has_wiki,
        has_projects: repo.has_projects,
        has_discussions: repo.has_discussions,
        allow_merge_commit: repo.allow_merge_commit,
        allow_squash_merge: repo.allow_squash_merge,
        allow_rebase_merge: repo.allow_rebase_merge,
        allow_auto_merge: repo.allow_auto_merge,
        delete_branch_on_merge: repo.delete_branch_on_merge,
        allow_forking: repo.allow_forking,
        web_commit_signoff_required: repo.web_commit_signoff_required,
        html_url: repo.html_url,
    }
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn github_repo_api_url(repo_full_name: &str) -> Result<String, String> {
    let repo = normalize_github_repo_input(repo_full_name)?;
    Ok(format!(
        "https://api.github.com/repos/{}",
        github_api_repo_path(&repo.full_name)
    ))
}

fn github_update_repo_settings_payload(
    request: GitHubUpdateRepoSettingsRequest,
) -> serde_json::Map<String, serde_json::Value> {
    let mut payload = serde_json::Map::new();
    if let Some(value) = request.description {
        payload.insert("description".to_string(), serde_json::Value::String(value));
    }
    if let Some(value) = request.homepage {
        payload.insert("homepage".to_string(), serde_json::Value::String(value));
    }
    if let Some(value) = request.private {
        payload.insert("private".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = normalize_optional_string(request.default_branch) {
        payload.insert("default_branch".to_string(), serde_json::Value::String(value));
    }
    if let Some(value) = request.has_issues {
        payload.insert("has_issues".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = request.has_wiki {
        payload.insert("has_wiki".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = request.has_projects {
        payload.insert("has_projects".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = request.has_discussions {
        payload.insert("has_discussions".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = request.allow_merge_commit {
        payload.insert("allow_merge_commit".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = request.allow_squash_merge {
        payload.insert("allow_squash_merge".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = request.allow_rebase_merge {
        payload.insert("allow_rebase_merge".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = request.allow_auto_merge {
        payload.insert("allow_auto_merge".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = request.delete_branch_on_merge {
        payload.insert("delete_branch_on_merge".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = request.allow_forking {
        payload.insert("allow_forking".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = request.web_commit_signoff_required {
        payload.insert(
            "web_commit_signoff_required".to_string(),
            serde_json::Value::Bool(value),
        );
    }
    payload
}

fn github_issue_from_response(issue: GitHubIssueResponse) -> Option<GitHubIssue> {
    if issue.pull_request.is_some() {
        return None;
    }
    Some(GitHubIssue {
        number: issue.number,
        title: issue.title,
        state: issue.state,
        body: issue.body,
        labels: issue.labels.into_iter().map(|label| label.name).collect(),
        assignees: issue
            .assignees
            .into_iter()
            .map(|assignee| assignee.login)
            .collect(),
        html_url: issue.html_url,
        updated_at: issue.updated_at,
        created_at: issue.created_at,
    })
}

fn github_workflow_run_from_response(run: GitHubWorkflowRunResponse) -> GitHubWorkflowRun {
    let name = normalize_optional_string(run.name).unwrap_or_else(|| "Workflow".to_string());
    let display_title = normalize_optional_string(run.display_title.clone()).unwrap_or_else(|| name.clone());
    GitHubWorkflowRun {
        id: run.id,
        name,
        display_title,
        status: normalize_optional_string(run.status).unwrap_or_else(|| "unknown".to_string()),
        conclusion: normalize_optional_string(run.conclusion),
        branch: normalize_optional_string(run.head_branch).unwrap_or_else(|| "unknown".to_string()),
        event: normalize_optional_string(run.event).unwrap_or_else(|| "unknown".to_string()),
        html_url: run.html_url,
        created_at: run.created_at,
        updated_at: run.updated_at,
    }
}

fn github_auth_header(token: &str) -> String {
    let encoded = STANDARD.encode(format!("x-access-token:{token}"));
    format!("AUTHORIZATION: basic {encoded}")
}

fn normalize_github_repo_input(input: &str) -> Result<NormalizedGitHubRepo, String> {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("仓库输入不能为空".to_string());
    }

    let path = if let Some(rest) = trimmed.strip_prefix("https://github.com/") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("http://github.com/") {
        rest
    } else {
        trimmed
    };
    let path = path.trim_end_matches(".git");
    let parts = path
        .split('/')
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>();

    if parts.len() != 2 {
        return Err("请输入 owner/repo 或 https://github.com/owner/repo.git".to_string());
    }

    let owner = parts[0].trim();
    let name = parts[1].trim();
    if owner.is_empty() || name.is_empty() {
        return Err("请输入 owner/repo 或 https://github.com/owner/repo.git".to_string());
    }

    Ok(NormalizedGitHubRepo {
        owner: owner.to_string(),
        name: name.to_string(),
        full_name: format!("{owner}/{name}"),
        clone_url: format!("https://github.com/{owner}/{name}.git"),
    })
}

fn parse_next_page(link: Option<&str>) -> Option<u32> {
    let link = link?;
    for part in link.split(',') {
        if !part.contains("rel=\"next\"") {
            continue;
        }
        let page_part = part.split('?').nth(1)?;
        let query = page_part.split('>').next()?;
        for pair in query.split('&') {
            let (key, value) = pair.split_once('=')?;
            if key == "page" {
                if let Ok(page) = value.parse::<u32>() {
                    return Some(page);
                }
            }
        }
    }
    None
}

fn normalize_github_contribution_repos(repo_full_names: Vec<String>) -> (Vec<String>, usize) {
    let mut seen = HashSet::new();
    let mut valid_repos = Vec::new();
    for name in repo_full_names {
        let trimmed = name.trim().trim_matches('/').to_string();
        if trimmed.is_empty() || !trimmed.contains('/') || !seen.insert(trimmed.clone()) {
            continue;
        }
        valid_repos.push(trimmed);
    }
    let requested_repo_count = valid_repos.len();
    valid_repos.truncate(GITHUB_CONTRIBUTIONS_REPO_LIMIT);
    (valid_repos, requested_repo_count)
}

fn github_api_repo_path(repo_full_name: &str) -> String {
    repo_full_name
        .split('/')
        .map(url_encode_path_segment)
        .collect::<Vec<_>>()
        .join("/")
}

fn url_encode_path_segment(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn current_utc_day_index() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|value| (value.as_secs() / 86_400) as i64)
        .unwrap_or_default()
}

fn format_day_index(day_index: i64) -> String {
    let (year, month, day) = civil_from_days(day_index);
    format!("{year:04}-{month:02}-{day:02}")
}

fn parse_github_date_day(date: &str) -> Option<i64> {
    if date.len() < 10 {
        return None;
    }
    let year = date.get(0..4)?.parse::<i32>().ok()?;
    let month = date.get(5..7)?.parse::<u32>().ok()?;
    let day = date.get(8..10)?.parse::<u32>().ok()?;
    if date.as_bytes().get(4) != Some(&b'-') || date.as_bytes().get(7) != Some(&b'-') {
        return None;
    }
    Some(days_from_civil(year, month, day))
}

fn github_contribution_days(
    counts: &HashMap<String, usize>,
    end_day_index: i64,
) -> Vec<GitHubContributionDay> {
    let start = end_day_index - GITHUB_CONTRIBUTION_DAYS as i64 + 1;
    (0..GITHUB_CONTRIBUTION_DAYS)
        .map(|offset| {
            let date = format_day_index(start + offset as i64);
            GitHubContributionDay {
                count: counts.get(&date).copied().unwrap_or_default(),
                date,
            }
        })
        .collect()
}

fn github_contribution_meta(
    repo_count: usize,
    requested_repo_count: usize,
    skipped_repo_count: usize,
) -> GitHubContributionMeta {
    GitHubContributionMeta {
        repo_count,
        requested_repo_count,
        repo_limit: GITHUB_CONTRIBUTIONS_REPO_LIMIT,
        truncated: requested_repo_count > repo_count,
        skipped_repo_count,
        refreshed_at: now_millis(),
    }
}

fn is_recoverable_github_contribution_status(status: StatusCode) -> bool {
    matches!(status, StatusCode::NOT_FOUND | StatusCode::CONFLICT)
}

fn add_commit_contributions(
    counts: &mut HashMap<String, usize>,
    commits: &[GitHubCommitResponse],
    start_day_index: i64,
    end_day_index: i64,
) {
    for commit in commits {
        let Some(date) = commit
            .commit
            .author
            .as_ref()
            .and_then(|author| author.date.as_deref())
        else {
            continue;
        };
        let Some(day_index) = parse_github_date_day(date) else {
            continue;
        };
        if day_index < start_day_index || day_index > end_day_index {
            continue;
        }
        *counts.entry(format_day_index(day_index)).or_default() += 1;
    }
}

fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let year = year - if month <= 2 { 1 } else { 0 };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let month = month as i32;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day as i32 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146_097 + doe - 719_468) as i64
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let days = days + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let doe = days - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = year + if month <= 2 { 1 } else { 0 };
    (year as i32, month as u32, day as u32)
}

fn token_for_binding(app: &AppHandle) -> Result<Option<String>, String> {
    let settings = load_settings(app);
    let Some(binding) = settings.github_binding else {
        return Ok(None);
    };
    read_token(&binding.login)
}

fn git_command(
    repo_path: &Path,
    args: &[&str],
    auth_header: Option<&str>,
) -> Result<String, String> {
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(repo_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(header) = auth_header {
        command
            .env("GIT_CONFIG_COUNT", "1")
            .env("GIT_CONFIG_KEY_0", "http.https://github.com/.extraheader")
            .env("GIT_CONFIG_VALUE_0", header);
    }
    let output = command
        .output()
        .map_err(|e| format!("无法启动 git（请确认 git 在 PATH 中）：{e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(if detail.is_empty() {
            format!(
                "git {:?} 失败：exit {}",
                args,
                output.status.code().unwrap_or(-1)
            )
        } else {
            detail
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn git_command_lossy(repo_path: &Path, args: &[&str]) -> Option<String> {
    git_command(repo_path, args, None)
        .ok()
        .map(|s| s.trim().to_string())
}

fn should_skip_dir(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    matches!(
        name,
        "node_modules" | "target" | "dist" | ".cache" | ".yarn"
    )
}

fn is_git_repo(path: &Path) -> bool {
    path.join(".git").exists()
}

fn repo_id(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .ok()
        .and_then(|p| p.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| path.file_name().and_then(|v| v.to_str()).unwrap_or("repo"))
        .replace('\\', "/")
}

fn sort_dedup(values: &mut Vec<String>) {
    values.sort();
    values.dedup();
}

fn add_managed_repo_id(settings: &mut WorkspaceSettings, repo_id: String) {
    if !settings.managed_repo_ids.iter().any(|id| id == &repo_id) {
        settings.managed_repo_ids.push(repo_id);
        sort_dedup(&mut settings.managed_repo_ids);
    }
}

fn normalize_repo_path(root: &Path, repo_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(repo_path.trim());
    let absolute = if path.is_absolute() {
        path
    } else {
        root.join(path)
    };
    if !absolute.exists() || !absolute.is_dir() {
        return Err(format!("仓库目录不存在：{}", absolute.display()));
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("读取工作区路径失败：{e}"))?;
    let canonical_path = absolute
        .canonicalize()
        .map_err(|e| format!("读取仓库路径失败：{e}"))?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err("仓库必须位于当前工作区内".to_string());
    }
    if !is_git_repo(&canonical_path) {
        return Err(format!("不是 Git 仓库：{}", canonical_path.display()));
    }
    Ok(canonical_path)
}

fn infer_clone_directory_name(remote_url: &str) -> Result<String, String> {
    let trimmed = remote_url.trim().trim_end_matches('/').trim_end_matches(".git");
    if trimmed.is_empty() {
        return Err("远端 URL 不能为空".to_string());
    }
    if let Some(full_name) = parse_github_remote(trimmed) {
        if let Some(name) = full_name.rsplit('/').next().filter(|value| !value.is_empty()) {
            return Ok(name.to_string());
        }
    }
    let source = trimmed
        .split_once(':')
        .filter(|(prefix, _)| prefix.contains('@') && !prefix.contains('/'))
        .map(|(_, path)| path)
        .unwrap_or(trimmed);
    source
        .split(['/', '\\'])
        .filter(|part| !part.is_empty())
        .last()
        .map(|value| value.to_string())
        .ok_or_else(|| "无法从远端 URL 推导目录名".to_string())
}

fn normalize_clone_directory_name(
    remote_url: &str,
    directory_name: Option<String>,
) -> Result<String, String> {
    let name = directory_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .map(Ok)
        .unwrap_or_else(|| infer_clone_directory_name(remote_url))?;
    validate_clone_directory_name(&name)?;
    Ok(name)
}

fn validate_clone_directory_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("目录名不能为空".to_string());
    }
    if trimmed != name || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("目录名只能是单层目录名".to_string());
    }
    let mut components = Path::new(trimmed).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(value)), None) if value.to_string_lossy() != ".." => Ok(()),
        _ => Err("目录名只能是单层目录名".to_string()),
    }
}

fn github_full_name_from_remote(remote: &str) -> Option<String> {
    parse_github_remote(remote)
}

fn repo_head_language_stats(path: &Path) -> Vec<LanguageStat> {
    let output =
        git_command(path, &["ls-tree", "-r", "-z", "-l", "HEAD"], None).unwrap_or_default();
    let mut stats: HashMap<String, u64> = HashMap::new();
    for entry in output.split('\0').filter(|value| !value.is_empty()) {
        let Some((metadata, raw_path)) = entry.split_once('\t') else {
            continue;
        };
        let Some(bytes) = metadata
            .split_whitespace()
            .last()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|bytes| *bytes > 0)
        else {
            continue;
        };
        let relative = Path::new(raw_path);
        if should_skip_language_path(relative) {
            continue;
        }
        let Some(language) = language_for_path(relative) else {
            continue;
        };
        *stats.entry(language.to_string()).or_default() += bytes;
    }
    language_stats_from_map(stats)
}

fn repo_working_tree_language_stats(path: &Path) -> Vec<LanguageStat> {
    let output = git_command(
        path,
        &[
            "ls-files",
            "-z",
            "--cached",
            "--modified",
            "--others",
            "--exclude-standard",
        ],
        None,
    )
    .unwrap_or_default();
    let mut stats: HashMap<String, u64> = HashMap::new();
    let mut seen = HashSet::new();
    for raw_path in output.split('\0').filter(|value| !value.is_empty()) {
        if !seen.insert(raw_path.to_string()) {
            continue;
        }
        let relative = Path::new(raw_path);
        if should_skip_language_path(relative) {
            continue;
        }
        let Some(language) = language_for_path(relative) else {
            continue;
        };
        let Some(bytes) = fs::metadata(path.join(relative))
            .ok()
            .map(|metadata| metadata.len())
            .filter(|bytes| *bytes > 0)
        else {
            continue;
        };
        *stats.entry(language.to_string()).or_default() += bytes;
    }
    language_stats_from_map(stats)
}

fn language_stats_from_map(stats: HashMap<String, u64>) -> Vec<LanguageStat> {
    let mut items = stats
        .into_iter()
        .map(|(language, bytes)| LanguageStat { language, bytes })
        .collect::<Vec<_>>();
    items.sort_by(|a, b| {
        b.bytes
            .cmp(&a.bytes)
            .then_with(|| a.language.cmp(&b.language))
    });
    items
}

fn should_skip_language_path(path: &Path) -> bool {
    if path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .map(|name| is_skipped_language_dir(&name.to_ascii_lowercase()))
            .unwrap_or(false)
    }) {
        return true;
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    is_skipped_language_file(&name)
}

fn is_skipped_language_dir(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".cache"
            | ".next"
            | ".nuxt"
            | ".parcel-cache"
            | ".svelte-kit"
            | ".tauri"
            | ".yarn"
            | "build"
            | "coverage"
            | "dist"
            | "node_modules"
            | "out"
            | "target"
            | "vendor"
    )
}

fn is_skipped_language_file(name: &str) -> bool {
    matches!(
        name,
        "bun.lock"
            | "cargo.lock"
            | "package-lock.json"
            | "pnpm-lock.yaml"
            | "yarn.lock"
    ) || name.ends_with(".lock")
        || matches!(
            Path::new(name)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or(""),
            "7z" | "avif"
                | "bmp"
                | "dll"
                | "dylib"
                | "exe"
                | "gif"
                | "ico"
                | "jar"
                | "jpeg"
                | "jpg"
                | "mp3"
                | "mp4"
                | "otf"
                | "pdf"
                | "png"
                | "so"
                | "ttf"
                | "webp"
                | "woff"
                | "woff2"
                | "zip"
        )
}

fn language_for_path(path: &Path) -> Option<&'static str> {
    let file_name = path.file_name()?.to_str()?.to_ascii_lowercase();
    match file_name.as_str() {
        "dockerfile" => return Some("Dockerfile"),
        "makefile" => return Some("Makefile"),
        _ => {}
    }
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "c" => Some("C"),
        "cc" | "cpp" | "cxx" | "h" | "hpp" | "hxx" => Some("C++"),
        "cs" => Some("C#"),
        "css" | "scss" | "sass" | "less" => Some("CSS"),
        "go" => Some("Go"),
        "html" | "htm" => Some("HTML"),
        "java" => Some("Java"),
        "js" | "cjs" | "mjs" | "jsx" => Some("JavaScript"),
        "json" | "jsonc" => Some("JSON"),
        "kt" | "kts" => Some("Kotlin"),
        "md" | "mdx" => Some("Markdown"),
        "ps1" | "psm1" | "psd1" => Some("PowerShell"),
        "py" | "pyw" => Some("Python"),
        "rs" => Some("Rust"),
        "sh" | "bash" | "zsh" | "fish" => Some("Shell"),
        "swift" => Some("Swift"),
        "toml" => Some("TOML"),
        "ts" | "tsx" | "mts" | "cts" => Some("TypeScript"),
        "vue" => Some("Vue"),
        "yaml" | "yml" => Some("YAML"),
        _ => None,
    }
}

fn summarize_repo(root: &Path, path: &Path) -> RepoSummary {
    let status = git_command_lossy(path, &["status", "--porcelain=v1", "-b", "--ahead-behind"])
        .unwrap_or_default();
    let entries = repo_status_entries(path);
    let mut current_branch = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut staged_count = 0;
    let mut unstaged_count = 0;
    let mut untracked_count = 0;
    let mut conflict_count = 0;

    for line in status.lines() {
        if let Some(header) = line.strip_prefix("## ") {
            let branch_part = header.split("...").next().unwrap_or(header).trim();
            if branch_part != "HEAD (no branch)" {
                current_branch = Some(branch_part.to_string());
            }
            if let Some(start) = header.find("[") {
                if let Some(end) = header[start..].find("]") {
                    let counts = &header[start + 1..start + end];
                    for part in counts.split(',') {
                        let trimmed = part.trim();
                        if let Some(value) = trimmed.strip_prefix("ahead ") {
                            ahead = value.parse::<i32>().unwrap_or(0);
                        } else if let Some(value) = trimmed.strip_prefix("behind ") {
                            behind = value.parse::<i32>().unwrap_or(0);
                        }
                    }
                }
            }
            continue;
        }
    }

    for entry in entries {
        if is_conflict_status(&entry.index, &entry.worktree) {
            conflict_count += 1;
        } else if entry.index == "?" && entry.worktree == "?" {
            untracked_count += 1;
        } else {
            if entry.index != " " {
                staged_count += 1;
            }
            if entry.worktree != " " {
                unstaged_count += 1;
            }
        }
    }

    let remote_url = git_command_lossy(path, &["remote", "get-url", "origin"]);
    let last_commit_at = git_command_lossy(path, &["log", "-1", "--format=%ct"])
        .and_then(|value| value.parse::<i64>().ok());
    let last_commit_message =
        git_command_lossy(path, &["log", "-1", "--format=%s"]).filter(|value| !value.is_empty());
    let relative_path = repo_id(root, path);

    RepoSummary {
        id: relative_path.clone(),
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("repo")
            .to_string(),
        path: path.to_string_lossy().to_string(),
        relative_path,
        current_branch,
        github_full_name: remote_url.as_deref().and_then(github_full_name_from_remote),
        remote_url,
        ahead,
        behind,
        staged_count,
        unstaged_count,
        untracked_count,
        conflict_count,
        last_commit_at,
        last_commit_message,
        language_stats: Vec::new(),
        working_tree_language_stats: Vec::new(),
        language_stats_updated_at: 0,
    }
}

fn lightweight_repo_summary(root: &Path, path: &Path) -> RepoSummary {
    let relative_path = repo_id(root, path);
    RepoSummary {
        id: relative_path.clone(),
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("repo")
            .to_string(),
        path: path.to_string_lossy().to_string(),
        relative_path,
        current_branch: None,
        remote_url: None,
        github_full_name: None,
        ahead: 0,
        behind: 0,
        staged_count: 0,
        unstaged_count: 0,
        untracked_count: 0,
        conflict_count: 0,
        last_commit_at: None,
        last_commit_message: None,
        language_stats: Vec::new(),
        working_tree_language_stats: Vec::new(),
        language_stats_updated_at: 0,
    }
}

fn summarize_repo_with_language_stats(root: &Path, path: &Path) -> RepoSummary {
    let mut summary = summarize_repo(root, path);
    summary.language_stats = repo_head_language_stats(path);
    summary.working_tree_language_stats = repo_working_tree_language_stats(path);
    summary.language_stats_updated_at = now_millis();
    summary
}

fn status_pair(line: &str) -> (String, String) {
    let mut chars = line.chars();
    let first = chars.next().unwrap_or(' ');
    let second = chars.next().unwrap_or(' ');
    (first.to_string(), second.to_string())
}

fn repo_status_entries(path: &Path) -> Vec<RepoStatusEntry> {
    let status = git_command(
        path,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        None,
    )
    .unwrap_or_default();
    parse_status_entries(&status)
}

fn parse_status_entries(status: &str) -> Vec<RepoStatusEntry> {
    let mut entries = Vec::new();
    let mut records = status.split('\0').filter(|record| !record.is_empty());
    while let Some(record) = records.next() {
        if record.len() < 3 {
            continue;
        }
        let (index, worktree) = status_pair(record);
        let path = record.get(3..).unwrap_or("").to_string();
        let old_path = if matches!(index.as_str(), "R" | "C") {
            records
                .next()
                .map(str::to_string)
                .filter(|value| !value.is_empty())
        } else {
            None
        };
        entries.push(RepoStatusEntry {
            index,
            worktree,
            path,
            old_path,
        });
    }
    entries
}

fn is_conflict_status(index: &str, worktree: &str) -> bool {
    matches!(
        (index, worktree),
        ("A", "A")
            | ("D", "D")
            | ("U", "U")
            | ("A", "U")
            | ("U", "A")
            | ("D", "U")
            | ("U", "D")
    )
}

fn collect_repos(root: &Path) -> Vec<PathBuf> {
    fn visit(path: &Path, repos: &mut Vec<PathBuf>) {
        if should_skip_dir(path) {
            return;
        }
        if is_git_repo(path) {
            repos.push(path.to_path_buf());
            return;
        }
        let Ok(entries) = fs::read_dir(path) else {
            return;
        };
        for entry in entries.flatten() {
            let child = entry.path();
            if child.is_dir() {
                visit(&child, repos);
            }
        }
    }

    let mut repos = Vec::new();
    visit(root, &mut repos);
    repos
}

fn summarize_repos(root: &Path, paths: Vec<PathBuf>) -> Vec<RepoSummary> {
    thread::scope(|scope| {
        let handles: Vec<_> = paths
            .into_iter()
            .map(|path| scope.spawn(move || summarize_repo(root, &path)))
            .collect();
        handles
            .into_iter()
            .map(|handle| handle.join().expect("repo summary worker panicked"))
            .collect()
    })
}

fn lightweight_managed_repos(root: &Path, settings: &WorkspaceSettings) -> Vec<RepoSummary> {
    let mut repos: Vec<_> = managed_repo_paths(root, settings)
        .into_iter()
        .map(|path| lightweight_repo_summary(root, &path))
        .collect();
    sort_repos(&mut repos);
    repos
}

fn repo_refresh_success_message(repo_count: usize) -> String {
    format!("已刷新 {repo_count} 个仓库并同步远端状态")
}

fn repo_refresh_partial_failure_message(
    repo_count: usize,
    failures: &[RepoFetchFailure],
) -> String {
    let repo_names = failures
        .iter()
        .take(3)
        .map(|failure| failure.repo_name.as_str())
        .collect::<Vec<_>>()
        .join("、");
    let repo_label = if failures.len() > 3 {
        format!("{repo_names} 等")
    } else {
        repo_names
    };
    format!(
        "已刷新 {repo_count} 个仓库，{} 个仓库 fetch 失败：{}（{}）",
        failures.len(),
        repo_label,
        failures[0].error
    )
}

fn refresh_managed_repo_remotes(
    root: &Path,
    paths: &[PathBuf],
    mut fetch_repo: impl FnMut(&Path) -> Result<(), String>,
) -> Vec<RepoFetchFailure> {
    let mut failures = Vec::new();
    for path in paths {
        let summary = summarize_repo(root, path);
        if summary.remote_url.is_none() {
            continue;
        }
        if let Err(error) = fetch_repo(path) {
            failures.push(RepoFetchFailure {
                repo_name: summary.name,
                error,
            });
        }
    }
    failures
}

fn managed_repo_paths(root: &Path, settings: &WorkspaceSettings) -> Vec<PathBuf> {
    settings
        .managed_repo_ids
        .iter()
        .filter(|id| !settings.hidden_repo_ids.iter().any(|hidden| hidden == *id))
        .map(|id| root.join(id.replace('/', std::path::MAIN_SEPARATOR_STR)))
        .filter(|path| path.exists() && is_git_repo(path))
        .collect()
}

fn sort_repos(repos: &mut [RepoSummary]) {
    repos.sort_by(|a, b| {
        b.last_commit_at
            .cmp(&a.last_commit_at)
            .then_with(|| a.name.cmp(&b.name))
    });
}

fn filter_hidden_repos(repos: Vec<RepoSummary>, hidden_repo_ids: &[String]) -> Vec<RepoSummary> {
    if hidden_repo_ids.is_empty() {
        return repos;
    }
    let hidden: HashSet<&str> = hidden_repo_ids.iter().map(String::as_str).collect();
    repos
        .into_iter()
        .filter(|repo| !hidden.contains(repo.id.as_str()))
        .collect()
}

fn workspace_root(app: &AppHandle) -> Result<PathBuf, String> {
    let settings = load_settings(app);
    let Some(root) = settings.workspace_root else {
        return Err("请先选择工作区文件夹".to_string());
    };
    let path = PathBuf::from(root);
    if !path.exists() || !path.is_dir() {
        return Err(format!("工作区不存在或不是文件夹：{}", path.display()));
    }
    Ok(path)
}

fn repo_path_by_id(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let root = workspace_root(app)?;
    let target = root.join(id.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !target.exists() || !is_git_repo(&target) {
        return Err(format!("未找到 Git 仓库：{id}"));
    }
    Ok(target)
}

fn readme_name_priority(name: &str) -> Option<usize> {
    let name = name.to_ascii_lowercase();
    match name.as_str() {
        "readme.md" => Some(0),
        "readme.markdown" => Some(1),
        "readme" => Some(2),
        "readme.txt" => Some(3),
        _ if name.starts_with("readme.") && matches!(
            Path::new(&name).extension()?.to_str()?.to_ascii_lowercase().as_str(),
            "md" | "markdown" | "txt"
        ) => Some(4),
        _ => None,
    }
}

fn repo_readme_priority(path: &Path) -> Option<usize> {
    let name = path.file_name()?.to_str()?;
    readme_name_priority(name)
}

fn repo_readme_paths(repo_path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut paths = fs::read_dir(repo_path)
        .map_err(|e| format!("读取仓库目录失败：{}（{e}）", repo_path.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_file() && repo_readme_priority(path).is_some())
        .collect::<Vec<_>>();
    paths.sort_by(|a, b| {
        let a_priority = repo_readme_priority(a).unwrap_or(usize::MAX);
        let b_priority = repo_readme_priority(b).unwrap_or(usize::MAX);
        a_priority.cmp(&b_priority).then_with(|| {
            let a_name = a.file_name().and_then(|name| name.to_str()).unwrap_or("").to_ascii_lowercase();
            let b_name = b.file_name().and_then(|name| name.to_str()).unwrap_or("").to_ascii_lowercase();
            a_name.cmp(&b_name)
        })
    });
    Ok(paths)
}

fn read_repo_readme_file(repo_id: &str, repo_path: &Path, path: &Path) -> Result<RepoReadme, String> {
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取 README 失败：{}（{e}）", path.display()))?;
    let updated_at = path
        .metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64);
    let relative_path = path
        .strip_prefix(repo_path)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    let readme_dir = path.parent().unwrap_or(repo_path);
    let images = readme_image_data_urls(&content, readme_dir, repo_path);
    let format = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .filter(|extension| extension == "md" || extension == "markdown")
        .unwrap_or_else(|| "text".to_string());
    Ok(RepoReadme {
        repo_id: repo_id.to_string(),
        path: relative_path,
        images,
        content,
        format,
        updated_at,
    })
}

fn read_repo_readmes(repo_id: &str, repo_path: &Path) -> Result<Vec<RepoReadme>, String> {
    repo_readme_paths(repo_path)?
        .into_iter()
        .map(|path| read_repo_readme_file(repo_id, repo_path, &path))
        .collect()
}

fn read_repo_readme(repo_id: &str, repo_path: &Path) -> Result<Option<RepoReadme>, String> {
    Ok(read_repo_readmes(repo_id, repo_path)?.into_iter().next())
}

fn readme_format_for_path(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .filter(|extension| extension == "md" || extension == "markdown")
        .unwrap_or_else(|| "text".to_string())
}

fn decode_github_file_content(
    prefix: &str,
    repo_full_name: &str,
    file: GitHubContentFileResponse,
) -> Result<RepoReadme, String> {
    let encoding = file.encoding.unwrap_or_default();
    if encoding.to_ascii_lowercase() != "base64" {
        return Err(format!("{prefix}：不支持的 README 编码：{encoding}"));
    }
    let encoded = file
        .content
        .unwrap_or_default()
        .chars()
        .filter(|value| !value.is_whitespace())
        .collect::<String>();
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|e| format!("{prefix}：README 解码失败：{e}"))?;
    let content = String::from_utf8(bytes)
        .map_err(|e| format!("{prefix}：README 不是 UTF-8 文本：{e}"))?;
    Ok(RepoReadme {
        repo_id: format!("github:{repo_full_name}"),
        path: file.path.clone(),
        images: HashMap::new(),
        content,
        format: readme_format_for_path(&file.name),
        updated_at: None,
    })
}

fn read_github_repo_readmes(app: &AppHandle, repo_full_name: &str) -> Result<Vec<RepoReadme>, String> {
    let repo = normalize_github_repo_input(repo_full_name)?;
    let (_, token) = github_require_token(app)?;
    let client = build_client()?;
    let repo_path = github_api_repo_path(&repo.full_name);
    let repo_url = format!("https://api.github.com/repos/{repo_path}");
    let repo_response = github_send(
        app,
        "读取 GitHub 仓库信息失败",
        github_headers(client.get(repo_url), Some(&token)),
    )?;
    let repo_info: GitHubRepoResponse = github_json("读取 GitHub 仓库信息失败", repo_response)?;
    let branch = repo_info.default_branch.unwrap_or_else(|| "main".to_string());
    let root_url = format!(
        "https://api.github.com/repos/{repo_path}/contents?ref={}",
        url_encode_path_segment(&branch),
    );
    let root_response = github_send(
        app,
        "读取 GitHub README 失败",
        github_headers(client.get(root_url), Some(&token)),
    )?;
    if root_response.status() == StatusCode::NOT_FOUND {
        return Ok(Vec::new());
    }
    let mut candidates: Vec<GitHubContentListItem> =
        github_json("读取 GitHub README 失败", root_response)?;
    candidates.retain(|item| item.kind == "file" && readme_name_priority(&item.name).is_some());
    candidates.sort_by(|a, b| {
        let a_priority = readme_name_priority(&a.name).unwrap_or(usize::MAX);
        let b_priority = readme_name_priority(&b.name).unwrap_or(usize::MAX);
        a_priority.cmp(&b_priority).then_with(|| {
            a.name
                .to_ascii_lowercase()
                .cmp(&b.name.to_ascii_lowercase())
        })
    });
    let mut readmes = Vec::new();
    for item in candidates {
        let file_url = format!(
            "https://api.github.com/repos/{repo_path}/contents/{}?ref={}",
            github_api_repo_path(&item.path),
            url_encode_path_segment(&branch),
        );
        let file_response = github_send(
            app,
            "读取 GitHub README 失败",
            github_headers(client.get(file_url), Some(&token)),
        )?;
        if file_response.status() == StatusCode::NOT_FOUND {
            continue;
        }
        let file: GitHubContentFileResponse =
            github_json("读取 GitHub README 失败", file_response)?;
        readmes.push(decode_github_file_content(
            "读取 GitHub README 失败",
            &repo.full_name,
            file,
        )?);
    }
    Ok(readmes)
}

fn readme_image_data_urls(content: &str, readme_dir: &Path, repo_path: &Path) -> HashMap<String, String> {
    readme_image_sources(content)
        .into_iter()
        .filter_map(|source| {
            let file_path = resolve_readme_image_path(readme_dir, repo_path, &source)?;
            let mime = image_mime_for_path(&file_path)?;
            let bytes = fs::read(file_path).ok()?;
            Some((source, format!("data:{mime};base64,{}", STANDARD.encode(bytes))))
        })
        .collect()
}

fn readme_image_sources(content: &str) -> HashSet<String> {
    let mut sources = HashSet::new();

    collect_readme_image_sources(content, "](", ')', &mut sources);
    collect_readme_image_sources(content, "src=\"", '"', &mut sources);
    collect_readme_image_sources(content, "src='", '\'', &mut sources);

    sources
}

fn collect_readme_image_sources(content: &str, prefix: &str, suffix: char, sources: &mut HashSet<String>) {
    for capture in content.match_indices(prefix) {
        let value = &content[capture.0 + prefix.len()..];
        let Some(end) = value.find(suffix) else {
            continue;
        };
        let source = value[..end].trim();
        if is_relative_readme_image_source(source) {
            sources.insert(source.to_string());
        }
    }
}

fn is_relative_readme_image_source(source: &str) -> bool {
    !source.is_empty()
        && !source.starts_with('#')
        && !source.starts_with("//")
        && !source.contains(':')
        && image_extension(source).is_some()
}

fn resolve_readme_image_path(readme_dir: &Path, repo_path: &Path, source: &str) -> Option<PathBuf> {
    let relative = Path::new(clean_readme_image_source(source));
    if relative.is_absolute() || relative.components().any(|component| matches!(component, Component::ParentDir)) {
        return None;
    }

    let path = readme_dir.join(relative);
    let canonical = path.canonicalize().ok()?;
    let repo = repo_path.canonicalize().ok()?;
    if !canonical.starts_with(repo) || !canonical.is_file() {
        return None;
    }
    Some(canonical)
}

fn image_mime_for_path(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "gif" => Some("image/gif"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn image_extension(source: &str) -> Option<String> {
    clean_readme_image_source(source)
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
}

fn clean_readme_image_source(source: &str) -> &str {
    source
        .split('#')
        .next()
        .unwrap_or(source)
        .split('?')
        .next()
        .unwrap_or(source)
}

fn package_manager(repo_path: &Path, package_manager_field: Option<&str>) -> &'static str {
    if let Some(field) = package_manager_field {
        let name = field.split('@').next().unwrap_or("").trim();
        if name == "yarn" || name == "pnpm" || name == "npm" {
            return match name {
                "yarn" => "yarn",
                "pnpm" => "pnpm",
                _ => "npm",
            };
        }
    }
    if repo_path.join("yarn.lock").exists() {
        "yarn"
    } else if repo_path.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else {
        "npm"
    }
}

fn package_script_command(pm: &str, script: &str) -> String {
    if pm == "npm" {
        format!("npm run {script}")
    } else {
        format!("{pm} {script}")
    }
}

fn infer_launch_config(repo_path: &Path) -> Option<ProjectLaunchConfig> {
    let package_path = repo_path.join("package.json");
    if package_path.exists() {
        let parsed = fs::read_to_string(&package_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
        if let Some(package) = parsed {
            let scripts = package.get("scripts").and_then(|value| value.as_object());
            let pm = package_manager(
                repo_path,
                package
                    .get("packageManager")
                    .and_then(|value| value.as_str()),
            );
            if let Some(scripts) = scripts {
                if repo_path.join("src-tauri").exists() && scripts.contains_key("tauri:dev") {
                    return Some(ProjectLaunchConfig {
                        command: package_script_command(pm, "tauri:dev"),
                        cwd: None,
                        source: "inferred".to_string(),
                        updated_at: None,
                    });
                }
                for script in ["dev", "start", "serve"] {
                    if scripts.contains_key(script) {
                        return Some(ProjectLaunchConfig {
                            command: package_script_command(pm, script),
                            cwd: None,
                            source: "inferred".to_string(),
                            updated_at: None,
                        });
                    }
                }
            }
        }
    }
    if repo_path.join("Cargo.toml").exists() {
        return Some(ProjectLaunchConfig {
            command: "cargo run".to_string(),
            cwd: None,
            source: "inferred".to_string(),
            updated_at: None,
        });
    }
    None
}

fn launch_config_for_repo(
    app: &AppHandle,
    repo_id: &str,
) -> Result<Option<ProjectLaunchConfig>, String> {
    let settings = load_settings(app);
    if let Some(config) = settings
        .project_launch_configs
        .get(repo_id)
        .filter(|config| !config.command.trim().is_empty())
    {
        let mut config = config.clone();
        config.source = "manual".to_string();
        return Ok(Some(config));
    }
    let path = repo_path_by_id(app, repo_id)?;
    Ok(infer_launch_config(&path))
}

fn resolve_launch_cwd(repo_path: &Path, cwd: Option<&str>) -> Result<PathBuf, String> {
    let Some(cwd) = cwd.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(repo_path.to_path_buf());
    };
    let path = PathBuf::from(cwd);
    let resolved = if path.is_absolute() {
        path
    } else {
        repo_path.join(path)
    };
    if !resolved.exists() || !resolved.is_dir() {
        return Err(format!(
            "启动工作目录不存在或不是文件夹：{}",
            resolved.display()
        ));
    }
    Ok(resolved)
}

fn spawn_launch_command(command: &str, cwd: &Path) -> Result<Child, String> {
    #[cfg(target_os = "windows")]
    let mut process = {
        let mut command_process = Command::new("cmd");
        command_process.args(["/C", command]);
        command_process.creation_flags(CREATE_NO_WINDOW);
        command_process
    };

    #[cfg(not(target_os = "windows"))]
    let mut process = {
        let mut command_process = Command::new("sh");
        command_process.args(["-c", command]);
        #[cfg(unix)]
        unsafe {
            command_process.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        command_process
    };

    process
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动项目失败：{e}"))
}

fn stop_launch_child(child: &mut Child) -> Result<i32, String> {
    let pid = child.id();
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("停止项目进程树失败：{e}"))?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let already_exited = detail.contains("not found")
                || detail.contains("not running")
                || detail.contains("没有找到")
                || detail.contains("不存在");
            if !already_exited {
                return Err(if detail.is_empty() {
                    format!(
                        "停止项目进程树失败：exit {}",
                        output.status.code().unwrap_or(-1)
                    )
                } else {
                    detail
                });
            }
        }
    }

    #[cfg(unix)]
    unsafe {
        let pgid = pid as libc::pid_t;
        if libc::kill(-pgid, libc::SIGTERM) == -1 {
            let err = std::io::Error::last_os_error();
            if err.raw_os_error() != Some(libc::ESRCH) {
                return Err(format!("停止项目进程组失败：{err}"));
            }
        }
    }

    #[cfg(not(any(target_os = "windows", unix)))]
    {
        child.kill().map_err(|e| format!("停止项目失败：{e}"))?;
    }

    child
        .wait()
        .map(|status| status.code().unwrap_or(-1))
        .map_err(|e| format!("等待项目退出失败：{e}"))
}

fn pipe_launch_output(
    repo_id: String,
    stream: &'static str,
    reader: impl std::io::Read + Send + 'static,
) {
    std::thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines() {
            match line {
                Ok(line) => push_launch_log(&repo_id, stream, line),
                Err(err) => {
                    push_launch_log(&repo_id, "system", format!("读取 {stream} 失败：{err}"));
                    break;
                }
            }
        }
    });
}

#[tauri::command]
pub fn workspace_get_settings(app: AppHandle) -> WorkspaceSettings {
    load_settings(&app)
}

#[tauri::command]
pub fn workspace_set_root(
    app: AppHandle,
    workspace_root: String,
) -> Result<WorkspaceSettings, String> {
    let root = PathBuf::from(workspace_root.trim());
    if !root.exists() || !root.is_dir() {
        return Err(format!("工作区不存在或不是文件夹：{}", root.display()));
    }
    let mut settings = load_settings(&app);
    settings.workspace_root = Some(root.to_string_lossy().to_string());
    save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn workspace_pick_root(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("选择 Git 工作区")
        .blocking_pick_folder();
    Ok(picked.map(|path| path.to_string()))
}

#[tauri::command]
pub fn workspace_pick_repo(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("选择 Git 仓库")
        .blocking_pick_folder();
    Ok(picked.map(|path| path.to_string()))
}

#[tauri::command]
pub async fn workspace_refresh_repos(app: AppHandle) -> Result<Vec<RepoSummary>, String> {
    run_blocking("刷新仓库", move || {
        let root = workspace_root(&app)?;
        let settings = load_settings(&app);
        let task = record_workspace_task(
            "repoStatus",
            "high",
            None,
            "running",
            Some("刷新已管理仓库并同步远端状态".to_string()),
        );
        let paths = managed_repo_paths(&root, &settings);
        let failures = refresh_managed_repo_remotes(&root, &paths, |path| run_fetch(&app, path));
        let mut repos = summarize_repos(&root, paths);
        sort_repos(&mut repos);
        if failures.is_empty() {
            update_workspace_task(
                &task.id,
                "success",
                Some(repo_refresh_success_message(repos.len())),
            );
        } else {
            update_workspace_task(
                &task.id,
                "error",
                Some(repo_refresh_partial_failure_message(repos.len(), &failures)),
            );
        }
        Ok(repos)
    })
    .await
}

#[tauri::command]
pub async fn workspace_list_managed_repos(app: AppHandle) -> Result<Vec<RepoSummary>, String> {
    run_blocking("读取已管理仓库", move || {
        let root = workspace_root(&app)?;
        let settings = load_settings(&app);
        Ok(lightweight_managed_repos(&root, &settings))
    })
    .await
}

#[tauri::command]
pub async fn workspace_scan_repos(app: AppHandle) -> Result<Vec<RepoSummary>, String> {
    workspace_refresh_repos(app).await
}

#[tauri::command]
pub async fn workspace_discover_repos(app: AppHandle) -> Result<Vec<RepoSummary>, String> {
    run_blocking("发现仓库", move || {
        let root = workspace_root(&app)?;
        let task = record_workspace_task(
            "discoverRepos",
            "low",
            None,
            "running",
            Some("后台发现工作区仓库".to_string()),
        );
        let paths = collect_repos(&root);
        let mut settings = load_settings(&app);
        for path in &paths {
            add_managed_repo_id(&mut settings, repo_id(&root, path));
        }
        save_settings(&app, &settings)?;
        let mut repos =
            filter_hidden_repos(summarize_repos(&root, paths), &settings.hidden_repo_ids);
        sort_repos(&mut repos);
        update_workspace_task(&task.id, "success", Some(format!("发现 {} 个仓库", repos.len())));
        Ok(repos)
    })
    .await
}

#[tauri::command]
pub async fn workspace_add_repo(app: AppHandle, repo_path: String) -> Result<RepoSummary, String> {
    run_blocking("添加仓库", move || {
        let root = workspace_root(&app)?;
        let path = normalize_repo_path(&root, &repo_path)?;
        let repo_id = repo_id(&root, &path);
        let task = record_workspace_task(
            "repoStatus",
            "high",
            Some(repo_id.clone()),
            "running",
            Some("添加本地仓库".to_string()),
        );
        let mut settings = load_settings(&app);
        add_managed_repo_id(&mut settings, repo_id.clone());
        settings.hidden_repo_ids.retain(|id| id != &repo_id);
        save_settings(&app, &settings)?;
        let summary = summarize_repo(&root, &path);
        update_workspace_task(&task.id, "success", Some("已添加仓库".to_string()));
        Ok(summary)
    })
    .await
}

#[tauri::command]
pub async fn workspace_clone_repo(
    app: AppHandle,
    remote_url: String,
    directory_name: Option<String>,
) -> Result<RepoSummary, String> {
    run_blocking("克隆仓库", move || {
        let root = workspace_root(&app)?;
        let input = remote_url.trim();
        if input.is_empty() {
            return Err("远端 URL 不能为空".to_string());
        }
        let normalized_github = normalize_github_repo_input(input).ok();
        let remote = normalized_github
            .as_ref()
            .map(|repo| repo.clone_url.as_str())
            .unwrap_or(input);
        let directory = normalize_clone_directory_name(remote, directory_name)?;
        let target = root.join(&directory);
        if target.exists() {
            return Err(format!("目标目录已存在：{}", target.display()));
        }
        if target.parent() != Some(root.as_path()) {
            return Err("目标目录必须位于工作区内".to_string());
        }
        let auth_header = if normalized_github.is_some() || parse_github_remote(remote).is_some() {
            token_for_binding(&app)?.map(|token| github_auth_header(&token))
        } else {
            None
        };
        git_command(
            &root,
            &["clone", remote, directory.as_str()],
            auth_header.as_deref(),
        )?;
        let mut settings = load_settings(&app);
        add_managed_repo_id(&mut settings, repo_id(&root, &target));
        save_settings(&app, &settings)?;
        Ok(summarize_repo(&root, &target))
    })
    .await
}

#[tauri::command]
pub fn workspace_hide_repo(app: AppHandle, repo_id: String) -> Result<WorkspaceSettings, String> {
    let normalized = repo_id.trim();
    if normalized.is_empty() {
        return Err("仓库 ID 不能为空".to_string());
    }
    repo_path_by_id(&app, normalized)?;
    let mut settings = load_settings(&app);
    if !settings.hidden_repo_ids.iter().any(|id| id == normalized) {
        settings.hidden_repo_ids.push(normalized.to_string());
        settings.hidden_repo_ids.sort();
    }
    save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn workspace_remember_remote_repo(
    app: AppHandle,
    repo: RemoteRepoShortcut,
) -> Result<WorkspaceSettings, String> {
    let mut settings = load_settings(&app);
    remember_remote_repo_shortcut(&mut settings.remote_repo_shortcuts, repo)?;
    save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn workspace_forget_remote_repo(
    app: AppHandle,
    full_name: String,
) -> Result<WorkspaceSettings, String> {
    let mut settings = load_settings(&app);
    forget_remote_repo_shortcut(&mut settings.remote_repo_shortcuts, &full_name)?;
    save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn workspace_unhide_repo(app: AppHandle, repo_id: String) -> Result<WorkspaceSettings, String> {
    let normalized = repo_id.trim();
    let mut settings = load_settings(&app);
    settings.hidden_repo_ids.retain(|id| id != normalized);
    save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn workspace_list_hidden_repos(app: AppHandle) -> Vec<HiddenRepo> {
    let settings = load_settings(&app);
    let root = workspace_root(&app).ok();
    settings
        .hidden_repo_ids
        .into_iter()
        .map(|id| {
            let name = root
                .as_ref()
                .map(|root| root.join(id.replace('/', std::path::MAIN_SEPARATOR_STR)))
                .and_then(|path| {
                    path.file_name()
                        .and_then(|value| value.to_str())
                        .map(|value| value.to_string())
                })
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| id.clone());
            HiddenRepo { id, name }
        })
        .collect()
}

#[tauri::command]
pub fn workspace_list_tasks() -> Vec<WorkspaceTask> {
    workspace_tasks()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

#[tauri::command]
pub fn workspace_cancel_task(task_id: String) -> Result<(), String> {
    update_workspace_task(&task_id, "cancelled", Some("已取消".to_string()));
    Ok(())
}

#[tauri::command]
pub fn github_get_binding_status(app: AppHandle) -> Result<GitHubBindingStatus, String> {
    let mut settings = load_settings(&app);
    if let Some(binding) = settings.github_binding.clone() {
        if read_token(&binding.login)?.is_some() {
            return Ok(binding_status(Some(binding)));
        }
        settings.github_binding = None;
        save_settings(&app, &settings)?;
    }
    Ok(binding_status(None))
}

#[tauri::command]
pub async fn github_start_device_flow() -> Result<GitHubDeviceFlowStart, String> {
    run_blocking("启动 GitHub 设备授权", move || {
        let Some(client_id) = client_id() else {
            return Err("GitHub Client ID 未配置".to_string());
        };
        let client = build_client()?;
        let response = github_oauth_headers(client.post("https://github.com/login/device/code"))
            .form(&[("client_id", client_id), ("scope", GITHUB_SCOPE)])
            .send()
            .map_err(|e| format!("启动 GitHub 设备授权失败：{e}"))?;
        if !response.status().is_success() {
            return Err(github_http_error("启动 GitHub 设备授权失败", response));
        }
        let body = response
            .json::<DeviceCodeResponse>()
            .map_err(|e| format!("解析 GitHub 设备授权响应失败：{e}"))?;
        Ok(GitHubDeviceFlowStart {
            device_code: body.device_code,
            user_code: body.user_code,
            verification_uri: body.verification_uri,
            expires_at: now_millis() + body.expires_in * 1000,
            interval_seconds: body.interval,
        })
    })
    .await
}

#[tauri::command]
pub async fn github_poll_device_flow(
    app: AppHandle,
    device_code: String,
    interval_seconds: Option<i64>,
) -> Result<GitHubDeviceFlowPollResult, String> {
    run_blocking("轮询 GitHub 授权", move || {
        let Some(client_id) = client_id() else {
            return Err("GitHub Client ID 未配置".to_string());
        };
        let client = build_client()?;
        let response =
            github_oauth_headers(client.post("https://github.com/login/oauth/access_token"))
                .form(&[
                    ("client_id", client_id),
                    ("device_code", device_code.trim()),
                    ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ])
                .send()
                .map_err(|e| format!("轮询 GitHub 授权失败：{e}"))?;
        if !response.status().is_success() {
            return Err(github_http_error("轮询 GitHub 授权失败", response));
        }
        let body = response
            .json::<TokenResponse>()
            .map_err(|e| format!("解析 GitHub 授权结果失败：{e}"))?;
        if let Some(token) = body.access_token {
            let user_response = github_headers(client.get("https://api.github.com/user"), Some(&token))
            .send()
            .map_err(|e| format!("读取 GitHub 账号信息失败：{e}"))?;
            if !user_response.status().is_success() {
                return Err(format!(
                    "读取 GitHub 账号信息失败：HTTP {}",
                    user_response.status()
                ));
            }
            let user = user_response
                .json::<GitHubUserResponse>()
                .map_err(|e| format!("解析 GitHub 账号信息失败：{e}"))?;
            write_token(&user.login, &token)?;
            let mut settings = load_settings(&app);
            let binding = GitHubBindingMetadata {
                login: user.login,
                avatar_url: user.avatar_url,
                bound_at: now_millis(),
                scopes: normalize_scope_list(body.scope.as_deref()),
                client_id_source: client_id_source().to_string(),
            };
            settings.github_binding = Some(binding.clone());
            save_settings(&app, &settings)?;
            return Ok(GitHubDeviceFlowPollResult {
                status: "authorized".to_string(),
                interval_seconds: interval_seconds.unwrap_or(5),
                binding_status: Some(binding_status(Some(binding))),
                error: None,
            });
        }

        match body.error.as_deref() {
            Some("authorization_pending") | Some("slow_down") => Ok(GitHubDeviceFlowPollResult {
                status: "pending".to_string(),
                interval_seconds: interval_seconds.unwrap_or(5)
                    + if body.error.as_deref() == Some("slow_down") {
                        5
                    } else {
                        0
                    },
                binding_status: None,
                error: None,
            }),
            Some("expired_token") => Ok(GitHubDeviceFlowPollResult {
                status: "expired".to_string(),
                interval_seconds: interval_seconds.unwrap_or(5),
                binding_status: None,
                error: body.error,
            }),
            _ => Ok(GitHubDeviceFlowPollResult {
                status: "pending".to_string(),
                interval_seconds: interval_seconds.unwrap_or(5),
                binding_status: None,
                error: body.error,
            }),
        }
    })
    .await
}

#[tauri::command]
pub fn github_unbind(app: AppHandle) -> Result<(), String> {
    let mut settings = load_settings(&app);
    settings.github_binding = None;
    save_settings(&app, &settings)
}

#[tauri::command]
pub async fn github_list_repos(app: AppHandle, page: Option<u32>) -> Result<GitHubRepoPage, String> {
    run_blocking("读取 GitHub 仓库", move || {
        let page = page.unwrap_or(1).max(1);
        let (_binding, token) = github_require_token(&app)?;
        let client = build_client()?;
        let response = github_send(&app, "读取 GitHub 仓库失败", github_headers(
            client.get("https://api.github.com/user/repos").query(&[
                ("affiliation", "owner"),
                ("visibility", "all"),
                ("sort", "updated"),
                ("per_page", "100"),
                ("page", &page.to_string()),
            ]),
            Some(&token),
        ))?;

        if !response.status().is_success() {
            return Err(github_http_error("读取 GitHub 仓库失败", response));
        }

        let next_page = parse_next_page(
            response
                .headers()
                .get(LINK)
                .and_then(|value| value.to_str().ok()),
        );
        let repos = response
            .json::<Vec<GitHubRepoResponse>>()
            .map_err(|e| format!("解析 GitHub 仓库列表失败：{e}"))?;

        Ok(GitHubRepoPage {
            items: repos
                .into_iter()
                .map(github_repo_summary_from_response)
                .collect(),
            next_page,
        })
    })
    .await
}

#[tauri::command]
pub async fn github_list_repo_owners(app: AppHandle) -> Result<Vec<GitHubRepoOwner>, String> {
    run_blocking("读取 GitHub 仓库 owner", move || {
        let (binding, token) = github_require_token(&app)?;
        let client = build_client()?;
        let response = github_send(
            &app,
            "读取 GitHub 组织失败",
            github_headers(
                client
                    .get("https://api.github.com/user/orgs")
                    .query(&[("per_page", "100")]),
                Some(&token),
            ),
        )?;
        let orgs = github_json::<Vec<GitHubOrgResponse>>("读取 GitHub 组织失败", response)?;
        let mut owners = vec![GitHubRepoOwner {
            login: binding.login,
            kind: "user".to_string(),
        }];
        owners.extend(orgs.into_iter().map(|org| GitHubRepoOwner {
            login: org.login,
            kind: "org".to_string(),
        }));
        owners.sort_by(|a, b| a.kind.cmp(&b.kind).then_with(|| a.login.cmp(&b.login)));
        Ok(owners)
    })
    .await
}

#[tauri::command]
pub async fn github_create_repo(
    app: AppHandle,
    request: GitHubCreateRepoRequest,
) -> Result<GitHubRepoSummary, String> {
    run_blocking("创建 GitHub 仓库", move || {
        let (_binding, token) = github_require_token(&app)?;
        let owner = request.owner.trim();
        let name = request.name.trim();
        if owner.is_empty() || name.is_empty() {
            return Err("owner 和仓库名不能为空".to_string());
        }
        let mut payload = serde_json::json!({
            "name": name,
            "private": request.private,
            "auto_init": request.auto_init,
            "has_issues": request.has_issues,
            "has_wiki": request.has_wiki,
        });
        if let Some(map) = payload.as_object_mut() {
            if let Some(value) = normalize_optional_string(request.description) {
                map.insert("description".to_string(), serde_json::Value::String(value));
            }
            if let Some(value) = normalize_optional_string(request.gitignore_template) {
                map.insert("gitignore_template".to_string(), serde_json::Value::String(value));
            }
            if let Some(value) = normalize_optional_string(request.license_template) {
                map.insert("license_template".to_string(), serde_json::Value::String(value));
            }
        }
        let client = build_client()?;
        let url = if request.owner_kind == "org" {
            format!(
                "https://api.github.com/orgs/{}/repos",
                url_encode_path_segment(owner)
            )
        } else {
            "https://api.github.com/user/repos".to_string()
        };
        let response = github_send(
            &app,
            "创建 GitHub 仓库失败",
            github_headers(client.post(url).json(&payload), Some(&token)),
        )?;
        let repo = github_json::<GitHubRepoResponse>("创建 GitHub 仓库失败", response)?;
        Ok(github_repo_summary_from_response(repo))
    })
    .await
}

#[tauri::command]
pub async fn github_get_repo_management(
    app: AppHandle,
    repo_full_name: String,
) -> Result<GitHubRepoManagement, String> {
    run_blocking("读取 GitHub 仓库设置", move || {
        let (_binding, token) = github_require_token(&app)?;
        let client = build_client()?;
        let response = github_send(
            &app,
            "读取 GitHub 仓库设置失败",
            github_headers(client.get(github_repo_api_url(&repo_full_name)?), Some(&token)),
        )?;
        let repo = github_json::<GitHubRepoResponse>("读取 GitHub 仓库设置失败", response)?;
        Ok(github_repo_management_from_response(repo))
    })
    .await
}

#[tauri::command]
pub async fn github_update_repo_settings(
    app: AppHandle,
    repo_full_name: String,
    request: GitHubUpdateRepoSettingsRequest,
) -> Result<GitHubRepoManagement, String> {
    run_blocking("更新 GitHub 仓库设置", move || {
        let (_binding, token) = github_require_token(&app)?;
        let payload = github_update_repo_settings_payload(request);
        let client = build_client()?;
        let response = github_send(
            &app,
            "更新 GitHub 仓库设置失败",
            github_headers(
                client
                    .patch(github_repo_api_url(&repo_full_name)?)
                    .json(&payload),
                Some(&token),
            ),
        )?;
        let repo = github_json::<GitHubRepoResponse>("更新 GitHub 仓库设置失败", response)?;
        Ok(github_repo_management_from_response(repo))
    })
    .await
}

#[tauri::command]
pub async fn github_delete_repo(app: AppHandle, repo_full_name: String) -> Result<(), String> {
    run_blocking("删除 GitHub 仓库", move || {
        let (binding, token) = github_require_token(&app)?;
        github_require_scope(&binding, GITHUB_DELETE_REPO_SCOPE)?;
        let client = build_client()?;
        let response = github_send(
            &app,
            "删除 GitHub 仓库失败",
            github_headers(client.delete(github_repo_api_url(&repo_full_name)?), Some(&token)),
        )?;
        if !response.status().is_success() {
            return Err(github_http_error("删除 GitHub 仓库失败", response));
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn github_list_issues(
    app: AppHandle,
    repo_full_name: String,
    state: Option<String>,
    per_page: Option<u32>,
    sort: Option<String>,
    direction: Option<String>,
    since: Option<String>,
) -> Result<Vec<GitHubIssue>, String> {
    run_blocking("读取 GitHub Issue", move || {
        let (_binding, token) = github_require_token(&app)?;
        let issue_state = state.unwrap_or_else(|| "open".to_string());
        let issue_per_page = per_page.unwrap_or(100).clamp(1, 100).to_string();
        let issue_sort = match sort.as_deref() {
            Some("updated") => "updated",
            Some("comments") => "comments",
            _ => "created",
        };
        let issue_direction = match direction.as_deref() {
            Some("asc") => "asc",
            _ => "desc",
        };
        let mut query = vec![
            ("state", issue_state),
            ("per_page", issue_per_page),
            ("sort", issue_sort.to_string()),
            ("direction", issue_direction.to_string()),
        ];
        if let Some(issue_since) = normalize_optional_string(since) {
            query.push(("since", issue_since));
        }
        let client = build_client()?;
        let response = github_send(
            &app,
            "读取 GitHub Issue 失败",
            github_headers(
                client
                    .get(format!("{}/issues", github_repo_api_url(&repo_full_name)?))
                    .query(&query),
                Some(&token),
            ),
        )?;
        let issues = github_json::<Vec<GitHubIssueResponse>>("读取 GitHub Issue 失败", response)?;
        Ok(issues.into_iter().filter_map(github_issue_from_response).collect())
    })
    .await
}

#[tauri::command]
pub async fn github_create_issue(
    app: AppHandle,
    repo_full_name: String,
    request: GitHubCreateIssueRequest,
) -> Result<GitHubIssue, String> {
    run_blocking("创建 GitHub Issue", move || {
        let (_binding, token) = github_require_token(&app)?;
        let title = request.title.trim();
        if title.is_empty() {
            return Err("Issue 标题不能为空".to_string());
        }
        let mut payload = serde_json::json!({
            "title": title,
            "labels": request.labels,
            "assignees": request.assignees,
        });
        if let Some(map) = payload.as_object_mut() {
            if let Some(value) = normalize_optional_string(request.body) {
                map.insert("body".to_string(), serde_json::Value::String(value));
            }
        }
        let client = build_client()?;
        let response = github_send(
            &app,
            "创建 GitHub Issue 失败",
            github_headers(
                client
                    .post(format!("{}/issues", github_repo_api_url(&repo_full_name)?))
                    .json(&payload),
                Some(&token),
            ),
        )?;
        let issue = github_json::<GitHubIssueResponse>("创建 GitHub Issue 失败", response)?;
        github_issue_from_response(issue).ok_or_else(|| "GitHub 返回了 Pull Request 记录".to_string())
    })
    .await
}

#[tauri::command]
pub async fn github_update_issue(
    app: AppHandle,
    repo_full_name: String,
    issue_number: u64,
    request: GitHubUpdateIssueRequest,
) -> Result<GitHubIssue, String> {
    run_blocking("更新 GitHub Issue", move || {
        if issue_number == 0 {
            return Err("Issue 编号不合法".to_string());
        }
        let (_binding, token) = github_require_token(&app)?;
        let mut payload = serde_json::Map::new();
        if let Some(value) = normalize_optional_string(request.title) {
            payload.insert("title".to_string(), serde_json::Value::String(value));
        }
        if let Some(value) = request.body {
            payload.insert("body".to_string(), serde_json::Value::String(value));
        }
        if let Some(value) = request.state {
            if value != "open" && value != "closed" {
                return Err("Issue 状态只能是 open 或 closed".to_string());
            }
            payload.insert("state".to_string(), serde_json::Value::String(value));
        }
        if let Some(value) = request.labels {
            payload.insert("labels".to_string(), serde_json::json!(value));
        }
        if let Some(value) = request.assignees {
            payload.insert("assignees".to_string(), serde_json::json!(value));
        }
        let client = build_client()?;
        let response = github_send(
            &app,
            "更新 GitHub Issue 失败",
            github_headers(
                client
                    .patch(format!(
                        "{}/issues/{issue_number}",
                        github_repo_api_url(&repo_full_name)?
                    ))
                    .json(&payload),
                Some(&token),
            ),
        )?;
        let issue = github_json::<GitHubIssueResponse>("更新 GitHub Issue 失败", response)?;
        github_issue_from_response(issue).ok_or_else(|| "GitHub 返回了 Pull Request 记录".to_string())
    })
    .await
}

#[tauri::command]
pub async fn github_list_workflow_runs(
    app: AppHandle,
    repo_full_name: String,
    per_page: Option<u32>,
) -> Result<Vec<GitHubWorkflowRun>, String> {
    run_blocking("读取 GitHub Actions", move || {
        let (_binding, token) = github_require_token(&app)?;
        let runs_per_page = per_page.unwrap_or(30).clamp(1, 100).to_string();
        let client = build_client()?;
        let response = github_send(
            &app,
            "读取 GitHub Actions 失败",
            github_headers(
                client
                    .get(format!("{}/actions/runs", github_repo_api_url(&repo_full_name)?))
                    .query(&[("per_page", runs_per_page)]),
                Some(&token),
            ),
        )?;
        let runs = github_json::<GitHubWorkflowRunsResponse>("读取 GitHub Actions 失败", response)?;
        Ok(runs
            .workflow_runs
            .into_iter()
            .map(github_workflow_run_from_response)
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn github_list_repo_contributions(
    app: AppHandle,
    repo_full_names: Vec<String>,
) -> Result<GitHubContributionResult, String> {
    run_blocking("读取 GitHub 提交贡献", move || {
        let (repos, requested_repo_count) = normalize_github_contribution_repos(repo_full_names);
        let repo_count = repos.len();
        let end_day_index = current_utc_day_index();
        let start_day_index = end_day_index - GITHUB_CONTRIBUTION_DAYS as i64 + 1;
        if repos.is_empty() {
            return Ok(GitHubContributionResult {
                days: github_contribution_days(&HashMap::new(), end_day_index),
                meta: github_contribution_meta(repo_count, requested_repo_count, 0),
            });
        }
        let token = token_for_binding(&app)?;
        let client = build_client()?;
        let since = format!("{}T00:00:00Z", format_day_index(start_day_index));
        let until = format!("{}T23:59:59Z", format_day_index(end_day_index));
        let mut counts: HashMap<String, usize> = HashMap::new();
        let mut skipped_repo_count = 0;
        for repo in repos {
            for page in 1..=GITHUB_COMMITS_MAX_PAGES {
                let url = format!(
                    "https://api.github.com/repos/{}/commits?since={since}&until={until}&per_page={}&page={page}",
                    github_api_repo_path(&repo),
                    GITHUB_COMMITS_PER_PAGE,
                );
                let response = github_headers(client.get(url), token.as_deref())
                    .send()
                    .map_err(|e| format!("读取 GitHub 提交贡献失败：{e}"))?;
                if !response.status().is_success() {
                    if page == 1 && is_recoverable_github_contribution_status(response.status()) {
                        skipped_repo_count += 1;
                        break;
                    }
                    return Err(github_http_error("读取 GitHub 提交贡献失败", response));
                }
                let commits = response
                    .json::<Vec<GitHubCommitResponse>>()
                    .map_err(|e| format!("解析 GitHub 提交贡献失败：{e}"))?;
                let is_last_page = commits.len() < GITHUB_COMMITS_PER_PAGE;
                add_commit_contributions(&mut counts, &commits, start_day_index, end_day_index);
                if is_last_page {
                    break;
                }
            }
        }
        Ok(GitHubContributionResult {
            days: github_contribution_days(&counts, end_day_index),
            meta: github_contribution_meta(repo_count, requested_repo_count, skipped_repo_count),
        })
    })
    .await
}

#[tauri::command]
pub async fn github_list_repo_readmes(
    app: AppHandle,
    repo_full_name: String,
) -> Result<Vec<RepoReadme>, String> {
    run_blocking("读取 GitHub README", move || {
        read_github_repo_readmes(&app, &repo_full_name)
    })
    .await
}

#[tauri::command]
pub async fn repo_get_summary(app: AppHandle, repo_id: String) -> Result<RepoSummary, String> {
    run_blocking("读取仓库摘要", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        Ok(summarize_repo(&root, &path))
    })
    .await
}

#[tauri::command]
pub async fn repo_refresh_summary(
    app: AppHandle,
    repo_id: String,
    options: Option<RepoRefreshSummaryOptions>,
) -> Result<RepoSummary, String> {
    run_blocking("刷新仓库摘要", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let task = record_workspace_task(
            "repoStatus",
            "normal",
            Some(repo_id),
            "running",
            Some("刷新仓库状态".to_string()),
        );
        let fetch_error = if options.map(|value| value.fetch_remote).unwrap_or(false) {
            summarize_repo(&root, &path)
                .remote_url
                .as_ref()
                .and_then(|_| run_fetch(&app, &path).err())
        } else {
            None
        };
        let summary = summarize_repo(&root, &path);
        if let Some(error) = fetch_error {
            update_workspace_task(
                &task.id,
                "error",
                Some(format!("仓库状态已刷新，远端同步失败：{error}")),
            );
        } else {
            update_workspace_task(&task.id, "success", Some("仓库状态已更新".to_string()));
        }
        Ok(summary)
    })
    .await
}

#[tauri::command]
pub async fn repo_refresh_language_stats(app: AppHandle, repo_id: String) -> Result<RepoSummary, String> {
    run_blocking("刷新语言统计", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let task = record_workspace_task(
            "languageStats",
            "low",
            Some(repo_id),
            "running",
            Some("刷新语言统计".to_string()),
        );
        let summary = summarize_repo_with_language_stats(&root, &path);
        update_workspace_task(&task.id, "success", Some("语言统计已更新".to_string()));
        Ok(summary)
    })
    .await
}

#[tauri::command]
pub async fn repo_get_readme(app: AppHandle, repo_id: String) -> Result<Option<RepoReadme>, String> {
    run_blocking("读取 README", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        read_repo_readme(&repo_id, &path)
    })
    .await
}

#[tauri::command]
pub async fn repo_list_readmes(app: AppHandle, repo_id: String) -> Result<Vec<RepoReadme>, String> {
    run_blocking("读取 README", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        read_repo_readmes(&repo_id, &path)
    })
    .await
}

#[tauri::command]
pub async fn repo_get_changes(app: AppHandle, repo_id: String) -> Result<Vec<RepoChange>, String> {
    run_blocking("读取仓库改动", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        Ok(repo_changes(&path))
    })
    .await
}

#[tauri::command]
pub async fn repo_get_history(app: AppHandle, repo_id: String) -> Result<Vec<CommitSummary>, String> {
    run_blocking("读取提交历史", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        Ok(repo_history(&path))
    })
    .await
}

#[tauri::command]
pub async fn repo_get_commit_detail(
    app: AppHandle,
    repo_id: String,
    hash: String,
) -> Result<CommitDetail, String> {
    run_blocking("读取提交详情", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        repo_commit_detail(&path, &hash)
    })
    .await
}

#[tauri::command]
pub async fn repo_get_branches(app: AppHandle, repo_id: String) -> Result<Vec<BranchSummary>, String> {
    run_blocking("读取仓库分支", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        Ok(repo_branches(&path))
    })
    .await
}

#[tauri::command]
pub async fn repo_get_conflicts(app: AppHandle, repo_id: String) -> Result<RepoConflictState, String> {
    run_blocking("读取冲突状态", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        Ok(repo_conflicts(&path))
    })
    .await
}

#[tauri::command]
pub async fn repo_get_detail(app: AppHandle, repo_id: String) -> Result<RepoDetail, String> {
    run_blocking("读取仓库详情", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let (summary, changes, commits, branches, conflicts) = thread::scope(|scope| {
            let summary = scope.spawn(|| summarize_repo_with_language_stats(&root, &path));
            let changes = scope.spawn(|| repo_changes(&path));
            let commits = scope.spawn(|| repo_history(&path));
            let branches = scope.spawn(|| repo_branches(&path));
            let conflicts = scope.spawn(|| repo_conflicts(&path));
            (
                summary.join().expect("repo summary worker panicked"),
                changes.join().expect("repo changes worker panicked"),
                commits.join().expect("repo history worker panicked"),
                branches.join().expect("repo branches worker panicked"),
                conflicts.join().expect("repo conflicts worker panicked"),
            )
        });
        Ok(RepoDetail {
            summary,
            changes,
            commits,
            branches,
            conflicts,
        })
    })
    .await
}

#[tauri::command]
pub fn repo_get_launch_config(
    app: AppHandle,
    repo_id: String,
) -> Result<Option<ProjectLaunchConfig>, String> {
    launch_config_for_repo(&app, &repo_id)
}

#[tauri::command]
pub fn repo_save_launch_config(
    app: AppHandle,
    repo_id: String,
    command: String,
    cwd: Option<String>,
) -> Result<ProjectLaunchConfig, String> {
    repo_path_by_id(&app, &repo_id)?;
    let command = command.trim().to_string();
    if command.is_empty() {
        return Err("启动命令不能为空".to_string());
    }
    let cwd = cwd
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let config = ProjectLaunchConfig {
        command,
        cwd,
        source: "manual".to_string(),
        updated_at: Some(now_millis()),
    };
    let mut settings = load_settings(&app);
    settings
        .project_launch_configs
        .insert(repo_id, config.clone());
    save_settings(&app, &settings)?;
    Ok(config)
}

#[tauri::command]
pub fn repo_get_launch_status(repo_id: String) -> Result<ProjectLaunchStatus, String> {
    let mut runtime = launch_runtime().lock().unwrap_or_else(|e| e.into_inner());
    let Some(entry) = runtime.get_mut(&repo_id) else {
        return Ok(idle_launch_status(&repo_id));
    };
    refresh_launch_entry(&repo_id, entry);
    Ok(entry.status.clone())
}

#[tauri::command]
pub fn repo_get_launch_logs(
    repo_id: String,
    since: Option<u64>,
) -> Result<Vec<ProjectLaunchLog>, String> {
    let logs = launch_logs().lock().unwrap_or_else(|e| e.into_inner());
    let since = since.unwrap_or(0);
    Ok(logs
        .get(&repo_id)
        .map(|repo_logs| {
            repo_logs
                .iter()
                .filter(|entry| entry.index > since)
                .cloned()
                .collect()
        })
        .unwrap_or_default())
}

#[tauri::command]
pub fn repo_start_launch(app: AppHandle, repo_id: String) -> Result<ProjectLaunchStatus, String> {
    let repo_path = repo_path_by_id(&app, &repo_id)?;
    let Some(config) = launch_config_for_repo(&app, &repo_id)? else {
        return Err("未配置快速启动脚本".to_string());
    };
    let command = config.command.trim().to_string();
    if command.is_empty() {
        return Err("启动命令不能为空".to_string());
    }
    let cwd = resolve_launch_cwd(&repo_path, config.cwd.as_deref())?;

    let mut runtime = launch_runtime().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(entry) = runtime.get_mut(&repo_id) {
        refresh_launch_entry(&repo_id, entry);
        if entry.status.state == "running" {
            return Ok(entry.status.clone());
        }
    }

    let mut child = spawn_launch_command(&command, &cwd)?;
    let pid = child.id();
    if let Some(stdout) = child.stdout.take() {
        pipe_launch_output(repo_id.clone(), "stdout", stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        pipe_launch_output(repo_id.clone(), "stderr", stderr);
    }

    let status = ProjectLaunchStatus {
        repo_id: repo_id.clone(),
        state: "running".to_string(),
        pid: Some(pid),
        command: Some(command.clone()),
        started_at: Some(now_millis()),
        exit_code: None,
        error: None,
    };
    runtime.insert(
        repo_id.clone(),
        LaunchEntry {
            child: Some(child),
            status: status.clone(),
        },
    );
    push_launch_log(&repo_id, "system", format!("启动命令：{command}"));
    push_launch_log(&repo_id, "system", format!("工作目录：{}", cwd.display()));
    Ok(status)
}

#[tauri::command]
pub fn repo_stop_launch(repo_id: String) -> Result<ProjectLaunchStatus, String> {
    let mut runtime = launch_runtime().lock().unwrap_or_else(|e| e.into_inner());
    let Some(entry) = runtime.get_mut(&repo_id) else {
        return Ok(idle_launch_status(&repo_id));
    };
    refresh_launch_entry(&repo_id, entry);
    if entry.status.state != "running" {
        return Ok(entry.status.clone());
    }
    if let Some(child) = entry.child.as_mut() {
        let exit_code = stop_launch_child(child)?;
        entry.status.state = "exited".to_string();
        entry.status.pid = None;
        entry.status.exit_code = Some(exit_code);
        entry.status.error = None;
        entry.child = None;
        push_launch_log(&repo_id, "system", "已停止快速启动进程");
    }
    Ok(entry.status.clone())
}

#[tauri::command]
pub async fn repo_stage_files(app: AppHandle, repo_id: String, files: Vec<String>) -> Result<(), String> {
    run_blocking("暂存文件", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        for file in selected_repo_files(&path, files)? {
            git_command(&path, &["add", "--", &file], None)?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn repo_unstage_files(
    app: AppHandle,
    repo_id: String,
    files: Vec<String>,
) -> Result<(), String> {
    run_blocking("取消暂存文件", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        for file in selected_repo_files(&path, files)? {
            git_command(&path, &["restore", "--staged", "--", &file], None)?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn repo_commit(
    app: AppHandle,
    repo_id: String,
    files: Vec<String>,
    message: String,
    push_after: bool,
) -> Result<RepoSummary, String> {
    run_blocking("提交仓库", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let trimmed = message.trim();
        if trimmed.is_empty() {
            return Err("提交说明不能为空".to_string());
        }
        for file in selected_repo_files(&path, files)? {
            git_command(&path, &["add", "--", &file], None)?;
        }
        git_command(&path, &["commit", "-m", trimmed], None)?;
        if push_after {
            run_push(&app, &path)?;
        }
        Ok(summarize_repo(&root, &path))
    })
    .await
}

#[tauri::command]
pub async fn repo_pull(app: AppHandle, repo_id: String) -> Result<RepoSummary, String> {
    run_blocking("拉取仓库", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let summary = summarize_repo(&root, &path);
        if repo_dirty_count(&summary) > 0 {
            return Err("存在未提交变更，已阻止 pull".to_string());
        }
        run_pull(&app, &path)?;
        Ok(summarize_repo(&root, &path))
    })
    .await
}

#[tauri::command]
pub async fn repo_merge_pull(app: AppHandle, repo_id: String) -> Result<RepoMergePullResult, String> {
    run_blocking("合并拉取仓库", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let summary = summarize_repo(&root, &path);
        if let Some(reason) =
            merge_pull_block_reason(&summary, current_branch_upstream(&path).is_some())
        {
            return Err(reason);
        }

        run_fetch(&app, &path)?;
        match git_command(&path, &["merge", "--no-edit", "@{u}"], None) {
            Ok(_) => {
                let summary = summarize_repo(&root, &path);
                Ok(RepoMergePullResult {
                    status: "success".to_string(),
                    message: "合并完成".to_string(),
                    conflicts: repo_conflicts(&path),
                    summary,
                })
            }
            Err(err) => {
                let conflicts = repo_conflicts(&path);
                let summary = summarize_repo(&root, &path);
                if conflicts.files.is_empty() {
                    Err(err)
                } else {
                    Ok(RepoMergePullResult {
                        status: "conflicts".to_string(),
                        message: "合并产生冲突，请处理后提交".to_string(),
                        summary,
                        conflicts,
                    })
                }
            }
        }
    })
    .await
}

#[tauri::command]
pub async fn repo_push(app: AppHandle, repo_id: String) -> Result<RepoSummary, String> {
    run_blocking("推送仓库", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        run_push(&app, &path)?;
        Ok(summarize_repo(&root, &path))
    })
    .await
}

#[tauri::command]
pub async fn repo_checkout_branch(
    app: AppHandle,
    repo_id: String,
    branch: String,
) -> Result<RepoSummary, String> {
    run_blocking("切换分支", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let branch = branch.trim();
        if branch.is_empty() {
            return Err("分支名不能为空".to_string());
        }
        git_command(&path, &["checkout", branch], None)?;
        Ok(summarize_repo(&root, &path))
    })
    .await
}

#[tauri::command]
pub async fn repo_accept_conflict_file(
    app: AppHandle,
    repo_id: String,
    path: String,
    side: String,
    stage: bool,
) -> Result<RepoSummary, String> {
    run_blocking("接受冲突文件", move || {
        let root = workspace_root(&app)?;
        let repo_path = repo_path_by_id(&app, &repo_id)?;
        let checkout_side = conflict_checkout_side(&side)?;
        git_command(&repo_path, &["checkout", checkout_side, "--", &path], None)?;
        if stage {
            git_command(&repo_path, &["add", "--", &path], None)?;
        }
        Ok(summarize_repo(&root, &repo_path))
    })
    .await
}

#[tauri::command]
pub async fn repo_resolve_conflict_file(
    app: AppHandle,
    repo_id: String,
    path: String,
    choices: Vec<RepoConflictChoice>,
    stage: bool,
) -> Result<RepoSummary, String> {
    run_blocking("解决冲突文件", move || {
        let root = workspace_root(&app)?;
        let repo_path = repo_path_by_id(&app, &repo_id)?;
        let file_path = safe_repo_file_path(&repo_path, &path)?;
        let content = fs::read_to_string(&file_path).map_err(|e| format!("读取冲突文件失败：{e}"))?;
        let resolved = resolve_conflict_content(&content, &choices)?;
        fs::write(&file_path, resolved).map_err(|e| format!("写入冲突文件失败：{e}"))?;
        if stage {
            git_command(&repo_path, &["add", "--", &path], None)?;
        }
        Ok(summarize_repo(&root, &repo_path))
    })
    .await
}

#[tauri::command]
pub async fn repo_mark_file_resolved(
    app: AppHandle,
    repo_id: String,
    path: String,
) -> Result<RepoSummary, String> {
    run_blocking("标记冲突文件已解决", move || {
        let root = workspace_root(&app)?;
        let repo_path = repo_path_by_id(&app, &repo_id)?;
        git_command(&repo_path, &["add", "--", &path], None)?;
        Ok(summarize_repo(&root, &repo_path))
    })
    .await
}

#[tauri::command]
pub async fn repo_abort_conflict_operation(
    app: AppHandle,
    repo_id: String,
) -> Result<RepoSummary, String> {
    run_blocking("终止冲突操作", move || {
        let root = workspace_root(&app)?;
        let repo_path = repo_path_by_id(&app, &repo_id)?;
        let operation = conflict_operation(&repo_path);
        let args = conflict_operation_args(&operation, "终止")?;
        git_command(&repo_path, args, None)?;
        Ok(summarize_repo(&root, &repo_path))
    })
    .await
}

#[tauri::command]
pub async fn repo_continue_conflict_operation(
    app: AppHandle,
    repo_id: String,
) -> Result<RepoSummary, String> {
    run_blocking("继续冲突操作", move || {
        let root = workspace_root(&app)?;
        let repo_path = repo_path_by_id(&app, &repo_id)?;
        let conflicts = repo_conflicts(&repo_path);
        if !conflicts.files.is_empty() {
            return Err("仍有冲突文件未解决".to_string());
        }
        let args = conflict_operation_args(&conflicts.operation, "继续")?;
        git_command(&repo_path, args, None)?;
        Ok(summarize_repo(&root, &repo_path))
    })
    .await
}

#[tauri::command]
pub async fn bulk_sync_preview(_app: AppHandle, operation: String, repos: Vec<RepoSummary>) -> Result<BulkSyncPreview, String> {
    run_blocking("批量预览", move || {
        Ok(build_bulk_preview(operation, repos))
    })
    .await
}

#[tauri::command]
pub async fn bulk_sync_execute(
    app: AppHandle,
    operation: String,
    repo_ids: Vec<String>,
) -> Result<Vec<BulkSyncResult>, String> {
    run_blocking("批量同步", move || {
        let root = workspace_root(&app)?;
        Ok(run_bulk_sync_parallel(repo_ids, |repo_id| {
            bulk_sync_repo(&app, &root, &operation, repo_id)
        }))
    })
    .await
}

#[tauri::command]
pub fn system_open_path(app: AppHandle, path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(format!("路径不存在：{path}"));
    }
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("打开路径失败：{e}"))
}

#[tauri::command]
pub fn system_open_url(app: AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("打开链接失败：{e}"))
}

fn repo_conflicts(path: &Path) -> RepoConflictState {
    let entries = conflict_status_entries(path);
    let files: Vec<_> = entries
        .into_iter()
        .map(|(status, file_path)| conflict_file_from_status(path, status, file_path))
        .collect();
    RepoConflictState {
        operation: conflict_operation(path),
        all_resolved: files.is_empty(),
        files,
    }
}

fn conflict_status_entries(path: &Path) -> Vec<(String, String)> {
    repo_status_entries(path)
        .into_iter()
        .filter_map(|entry| {
            if !is_conflict_status(&entry.index, &entry.worktree) {
                return None;
            }
            Some((format!("{}{}", entry.index, entry.worktree), entry.path))
        })
        .collect()
}

fn conflict_file_from_status(path: &Path, status: String, file_path: String) -> RepoConflictFile {
    let full_path = path.join(&file_path);
    match fs::read_to_string(&full_path) {
        Ok(content) => RepoConflictFile {
            path: file_path,
            status,
            resolved: false,
            binary: false,
            hunks: parse_conflict_hunks(&content),
        },
        Err(_) => RepoConflictFile {
            path: file_path,
            status,
            resolved: false,
            binary: true,
            hunks: Vec::new(),
        },
    }
}

fn conflict_operation(path: &Path) -> String {
    if git_state_file_exists(path, "MERGE_HEAD") {
        "merge".to_string()
    } else if git_state_file_exists(path, "CHERRY_PICK_HEAD") {
        "cherry-pick".to_string()
    } else if git_state_file_exists(path, "REBASE_HEAD")
        || git_state_file_exists(path, "rebase-merge")
        || git_state_file_exists(path, "rebase-apply")
    {
        "rebase".to_string()
    } else {
        "none".to_string()
    }
}

fn git_state_file_exists(path: &Path, name: &str) -> bool {
    git_command_lossy(path, &["rev-parse", "--git-path", name])
        .map(PathBuf::from)
        .map(|state_path| {
            if state_path.is_absolute() {
                state_path.exists()
            } else {
                path.join(state_path).exists()
            }
        })
        .unwrap_or(false)
}

fn parse_conflict_hunks(content: &str) -> Vec<RepoConflictHunk> {
    let mut hunks = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut index = 0;
    while index < lines.len() {
        let line = lines[index];
        if !line.starts_with("<<<<<<<") {
            index += 1;
            continue;
        }

        let start_line = index + 1;
        let ours_label = conflict_marker_label(line, "<<<<<<<", "ours");
        index += 1;
        let mut ours_lines = Vec::new();
        while index < lines.len() && !lines[index].starts_with("=======") {
            ours_lines.push(lines[index].to_string());
            index += 1;
        }
        if index >= lines.len() {
            break;
        }
        index += 1;
        let mut theirs_lines = Vec::new();
        while index < lines.len() && !lines[index].starts_with(">>>>>>>") {
            theirs_lines.push(lines[index].to_string());
            index += 1;
        }
        if index >= lines.len() {
            break;
        }
        let theirs_label = conflict_marker_label(lines[index], ">>>>>>>", "theirs");
        let end_line = index + 1;
        hunks.push(RepoConflictHunk {
            id: format!("hunk-{}", hunks.len() + 1),
            start_line,
            end_line,
            ours_label,
            theirs_label,
            ours_lines,
            theirs_lines,
        });
        index += 1;
    }
    hunks
}

fn conflict_marker_label(line: &str, marker: &str, fallback: &str) -> String {
    let label = line.trim_start_matches(marker).trim();
    if label.is_empty() {
        fallback.to_string()
    } else {
        label.to_string()
    }
}

fn resolve_conflict_content(
    content: &str,
    choices: &[RepoConflictChoice],
) -> Result<String, String> {
    let choice_map: HashMap<&str, &str> = choices
        .iter()
        .map(|choice| (choice.hunk_id.as_str(), choice.side.as_str()))
        .collect();
    let mut output = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut index = 0;
    let mut hunk_index = 1;
    while index < lines.len() {
        let line = lines[index];
        if !line.starts_with("<<<<<<<") {
            output.push(line.to_string());
            index += 1;
            continue;
        }

        let hunk_id = format!("hunk-{hunk_index}");
        hunk_index += 1;
        index += 1;
        let mut ours_lines = Vec::new();
        while index < lines.len() && !lines[index].starts_with("=======") {
            ours_lines.push(lines[index].to_string());
            index += 1;
        }
        if index >= lines.len() {
            return Err("冲突 marker 不完整".to_string());
        }
        index += 1;
        let mut theirs_lines = Vec::new();
        while index < lines.len() && !lines[index].starts_with(">>>>>>>") {
            theirs_lines.push(lines[index].to_string());
            index += 1;
        }
        if index >= lines.len() {
            return Err("冲突 marker 不完整".to_string());
        }
        index += 1;

        match choice_map.get(hunk_id.as_str()).copied() {
            Some("ours") => output.extend(ours_lines),
            Some("theirs") => output.extend(theirs_lines),
            Some(_) => return Err(format!("{hunk_id} 的选择无效")),
            None => return Err(format!("{hunk_id} 缺少解决选择")),
        }
    }

    let mut resolved = output.join("\n");
    if content.ends_with('\n') {
        resolved.push('\n');
    }
    Ok(resolved)
}

fn conflict_checkout_side(side: &str) -> Result<&'static str, String> {
    match side {
        "ours" => Ok("--ours"),
        "theirs" => Ok("--theirs"),
        _ => Err("冲突侧只能是 ours 或 theirs".to_string()),
    }
}

fn conflict_operation_args(
    operation: &str,
    action: &str,
) -> Result<&'static [&'static str], String> {
    match (operation, action) {
        ("merge", "终止") => Ok(&["merge", "--abort"]),
        ("rebase", "终止") => Ok(&["rebase", "--abort"]),
        ("cherry-pick", "终止") => Ok(&["cherry-pick", "--abort"]),
        ("merge", "继续") => Ok(&["commit", "--no-edit"]),
        ("rebase", "继续") => Ok(&["rebase", "--continue"]),
        ("cherry-pick", "继续") => Ok(&["cherry-pick", "--continue"]),
        ("none", _) => Err("当前没有进行中的冲突操作".to_string()),
        _ => Err(format!("不支持{action} {operation} 冲突")),
    }
}

fn safe_repo_file_path(repo_path: &Path, file_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(file_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("文件路径必须位于仓库内".to_string());
    }
    Ok(repo_path.join(relative))
}

fn selected_repo_files(path: &Path, files: Vec<String>) -> Result<Vec<String>, String> {
    let available: HashSet<_> = repo_status_entries(path)
        .into_iter()
        .map(|entry| entry.path)
        .collect();
    let mut seen = HashSet::new();
    let mut selected = Vec::new();
    for file in files {
        if file.is_empty() {
            continue;
        }
        safe_repo_file_path(path, &file)?;
        if !available.contains(&file) {
            return Err(format!("选择的文件不在当前变更中：{file}"));
        }
        if seen.insert(file.clone()) {
            selected.push(file);
        }
    }
    if selected.is_empty() {
        return Err("请选择要提交的文件".to_string());
    }
    Ok(selected)
}

fn repo_changes(path: &Path) -> Vec<RepoChange> {
    let entries = repo_status_entries(path);

    thread::scope(|scope| {
        let handles: Vec<_> = entries
            .into_iter()
            .map(|entry| {
                scope.spawn(move || {
                    let RepoStatusEntry {
                        index,
                        worktree,
                        path: file_path,
                        old_path,
                    } = entry;
                    let untracked = index == "?" && worktree == "?";
                    let conflicted = is_conflict_status(&index, &worktree);
                    let staged = !untracked && index != " ";
                    let unstaged = !untracked && worktree != " ";
                    let diff = if untracked {
                        String::new()
                    } else if staged {
                        git_command_lossy(path, &["diff", "--cached", "--", &file_path])
                            .unwrap_or_default()
                    } else {
                        git_command_lossy(path, &["diff", "--", &file_path]).unwrap_or_default()
                    };
                    RepoChange {
                        path: file_path,
                        old_path,
                        index_status: index,
                        worktree_status: worktree,
                        staged,
                        unstaged,
                        untracked,
                        conflicted,
                        diff,
                    }
                })
            })
            .collect();

        handles
            .into_iter()
            .map(|handle| handle.join().expect("repo diff worker panicked"))
            .collect()
    })
}

fn repo_history(path: &Path) -> Vec<CommitSummary> {
    let output = git_command_lossy(
        path,
        &[
            "log",
            "--max-count=80",
            "--decorate=short",
            "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%ct%x1f%P%x1f%D%x1f%s",
        ],
    )
    .unwrap_or_default();
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\x1f');
            let hash = parts.next()?.to_string();
            let short_hash = parts.next()?.to_string();
            let author = parts.next()?.to_string();
            let author_email = optional_text(parts.next().unwrap_or(""));
            let timestamp = parts.next()?.parse::<i64>().ok()?;
            let parents = split_words(parts.next().unwrap_or(""));
            let refs = split_refs(parts.next().unwrap_or(""));
            let subject = parts.next().unwrap_or("").to_string();
            Some(CommitSummary {
                hash,
                short_hash,
                author,
                author_email,
                timestamp,
                subject,
                parents,
                refs,
            })
        })
        .collect()
}

fn repo_commit_detail(path: &Path, hash: &str) -> Result<CommitDetail, String> {
    let normalized = hash.trim();
    if normalized.is_empty() {
        return Err("提交 hash 不能为空".to_string());
    }
    let format = "%H%x1f%h%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%ct%x1f%P%x1f%D%x1f%s%x1f%b";
    let output = git_command(
        path,
        &[
            "show",
            "--no-patch",
            "--decorate=short",
            &format!("--format={format}"),
            normalized,
        ],
        None,
    )?;
    let mut parts = output.trim_end().splitn(11, '\x1f');
    let hash = parts.next().unwrap_or("").to_string();
    if hash.is_empty() {
        return Err("未找到提交".to_string());
    }
    let short_hash = parts.next().unwrap_or("").to_string();
    let author = parts.next().unwrap_or("").to_string();
    let author_email = optional_text(parts.next().unwrap_or(""));
    let committer = parts.next().unwrap_or("").to_string();
    let committer_email = optional_text(parts.next().unwrap_or(""));
    let timestamp = parts
        .next()
        .unwrap_or("")
        .parse::<i64>()
        .map_err(|_| "提交时间解析失败".to_string())?;
    let parents = split_words(parts.next().unwrap_or(""));
    let refs = split_refs(parts.next().unwrap_or(""));
    let subject = parts.next().unwrap_or("").to_string();
    let body = parts.next().unwrap_or("").trim().to_string();
    let files = repo_commit_file_changes(path, &hash, parents.first().map(String::as_str));
    Ok(CommitDetail {
        hash,
        short_hash,
        author,
        author_email,
        committer,
        committer_email,
        timestamp,
        subject,
        body,
        parents,
        refs,
        files,
    })
}

fn repo_commit_file_changes(path: &Path, hash: &str, first_parent: Option<&str>) -> Vec<CommitFileChange> {
    let status_args = commit_diff_args("--name-status", hash, first_parent);
    let status_refs = status_args.iter().map(String::as_str).collect::<Vec<_>>();
    let status_output = git_command_lossy(path, &status_refs).unwrap_or_default();
    let statuses = commit_file_statuses(&status_output);
    let numstat_args = commit_diff_args("--numstat", hash, first_parent);
    let numstat_refs = numstat_args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = git_command_lossy(path, &numstat_refs).unwrap_or_default();
    let stats = commit_file_numstats(&output);
    let mut files = statuses
        .into_iter()
        .map(|status| commit_file_change_from_status(status, &stats))
        .collect::<Vec<_>>();
    let patch_args = commit_diff_args("--patch", hash, first_parent);
    let patch_refs = patch_args.iter().map(String::as_str).collect::<Vec<_>>();
    let patches = commit_file_patches(&git_command_lossy(path, &patch_refs).unwrap_or_default());
    for file in &mut files {
        if let Some(parsed) = patches.get(&file.path) {
            file.patch = parsed.patch.clone();
            file.hunks = parsed.hunks.clone();
        }
    }
    files
}

fn commit_diff_args(format_arg: &str, hash: &str, first_parent: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "diff-tree".to_string(),
        "--no-commit-id".to_string(),
        format_arg.to_string(),
        "--find-renames".to_string(),
        "-r".to_string(),
    ];
    if let Some(parent) = first_parent {
        args.push(parent.to_string());
    } else {
        args.push("--root".to_string());
    }
    args.push(hash.to_string());
    args
}

#[derive(Debug, Clone)]
struct CommitFileStatus {
    path: String,
    old_path: Option<String>,
    status: String,
}

fn commit_file_statuses(output: &str) -> Vec<CommitFileStatus> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let status_code = parts.next()?.trim();
            let first_path = parts.next()?.trim();
            let second_path = parts.next().map(str::trim).filter(|value| !value.is_empty());
            let path = second_path.unwrap_or(first_path).to_string();
            if path.is_empty() {
                return None;
            }
            Some(CommitFileStatus {
                path,
                old_path: second_path.map(|_| first_path.to_string()),
                status: status_text(status_code).to_string(),
            })
        })
        .collect()
}

fn status_text(status_code: &str) -> &str {
    match status_code.chars().next().unwrap_or('M') {
        'A' => "added",
        'D' => "deleted",
        'R' => "renamed",
        'C' => "copied",
        _ => "modified",
    }
}

fn commit_file_change_from_status(
    status: CommitFileStatus,
    stats: &HashMap<String, (i32, i32)>,
) -> CommitFileChange {
    let (additions, deletions) = stats.get(&status.path).copied().unwrap_or((0, 0));
    CommitFileChange {
        path: status.path,
        old_path: status.old_path,
        status: status.status,
        additions,
        deletions,
        patch: String::new(),
        hunks: Vec::new(),
    }
}

fn commit_file_numstats(output: &str) -> HashMap<String, (i32, i32)> {
    output
        .lines()
        .filter_map(parse_commit_file_numstat)
        .map(|(path, additions, deletions)| (path, (additions, deletions)))
        .collect()
}

fn parse_commit_file_numstat(line: &str) -> Option<(String, i32, i32)> {
    let mut parts = line.split('\t');
    let additions = parse_numstat_count(parts.next().unwrap_or(""));
    let deletions = parse_numstat_count(parts.next().unwrap_or(""));
    let path = parts.next()?.trim();
    if path.is_empty() {
        return None;
    }
    let extra = parts.next().map(str::trim).filter(|value| !value.is_empty());
    let next_path = if let Some(next) = extra {
        next.to_string()
    } else {
        normalize_numstat_path(path)
    };
    Some((next_path, additions, deletions))
}

fn normalize_numstat_path(path: &str) -> String {
    let Some(arrow_index) = path.find(" => ") else {
        return path.to_string();
    };
    let before_arrow = &path[..arrow_index];
    let after_arrow = &path[arrow_index + 4..];
    if let Some(open_index) = before_arrow.rfind('{') {
        if let Some(close_index) = after_arrow.find('}') {
            let prefix = &before_arrow[..open_index];
            let changed = &after_arrow[..close_index];
            let suffix = &after_arrow[close_index + 1..];
            return format!("{prefix}{changed}{suffix}");
        }
    }
    after_arrow.replace('}', "")
}

fn parse_numstat_count(value: &str) -> i32 {
    value.parse::<i32>().unwrap_or(0)
}

#[derive(Debug, Clone)]
struct ParsedCommitPatch {
    path: String,
    patch: String,
    hunks: Vec<CommitDiffHunk>,
}

fn commit_file_patches(output: &str) -> HashMap<String, ParsedCommitPatch> {
    split_commit_patch_blocks(output)
        .into_iter()
        .filter_map(|block| parse_commit_patch_block(&block))
        .map(|patch| (patch.path.clone(), patch))
        .collect()
}

fn split_commit_patch_blocks(output: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut current = Vec::new();
    for line in output.lines() {
        if line.starts_with("diff --git ") && !current.is_empty() {
            blocks.push(current.join("\n"));
            current.clear();
        }
        if line.starts_with("diff --git ") || !current.is_empty() {
            current.push(line.to_string());
        }
    }
    if !current.is_empty() {
        blocks.push(current.join("\n"));
    }
    blocks
}

fn parse_commit_patch_block(block: &str) -> Option<ParsedCommitPatch> {
    let path = patch_target_path(block)?;
    Some(ParsedCommitPatch {
        path,
        patch: block.to_string(),
        hunks: parse_commit_diff_hunks(block),
    })
}

fn patch_target_path(block: &str) -> Option<String> {
    for line in block.lines() {
        if let Some(path) = line.strip_prefix("+++ b/") {
            return Some(path.to_string());
        }
    }
    block
        .lines()
        .find_map(|line| line.strip_prefix("diff --git "))
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|path| path.strip_prefix("b/").or_else(|| path.strip_prefix("a/")))
        .map(ToOwned::to_owned)
}

fn parse_commit_diff_hunks(block: &str) -> Vec<CommitDiffHunk> {
    let mut hunks = Vec::new();
    let mut current: Option<CommitDiffHunk> = None;
    let mut old_line = 0;
    let mut new_line = 0;
    for line in block.lines() {
        if line.starts_with("@@ ") {
            if let Some(hunk) = current.take() {
                hunks.push(hunk);
            }
            let Some((old_start, old_lines, new_start, new_lines)) = parse_hunk_header(line) else {
                current = Some(CommitDiffHunk {
                    header: line.to_string(),
                    old_start: 0,
                    old_lines: 0,
                    new_start: 0,
                    new_lines: 0,
                    lines: Vec::new(),
                });
                continue;
            };
            old_line = old_start;
            new_line = new_start;
            current = Some(CommitDiffHunk {
                header: line.to_string(),
                old_start,
                old_lines,
                new_start,
                new_lines,
                lines: Vec::new(),
            });
            continue;
        }
        let Some(hunk) = current.as_mut() else {
            continue;
        };
        let (kind, content, old_number, new_number) = if let Some(content) = line.strip_prefix('+') {
            let number = new_line;
            new_line += 1;
            ("added", content.to_string(), None, Some(number))
        } else if let Some(content) = line.strip_prefix('-') {
            let number = old_line;
            old_line += 1;
            ("deleted", content.to_string(), Some(number), None)
        } else if let Some(content) = line.strip_prefix(' ') {
            let old_number = old_line;
            let new_number = new_line;
            old_line += 1;
            new_line += 1;
            ("context", content.to_string(), Some(old_number), Some(new_number))
        } else {
            ("meta", line.to_string(), None, None)
        };
        hunk.lines.push(CommitDiffLine {
            kind: kind.to_string(),
            content,
            old_line: old_number,
            new_line: new_number,
        });
    }
    if let Some(hunk) = current {
        hunks.push(hunk);
    }
    hunks
}

fn parse_hunk_header(header: &str) -> Option<(i32, i32, i32, i32)> {
    let body = header.strip_prefix("@@ ")?;
    let body = body.split(" @@").next()?;
    let mut parts = body.split_whitespace();
    let old = parse_hunk_range(parts.next()?, '-')?;
    let new = parse_hunk_range(parts.next()?, '+')?;
    Some((old.0, old.1, new.0, new.1))
}

fn parse_hunk_range(value: &str, prefix: char) -> Option<(i32, i32)> {
    let value = value.strip_prefix(prefix)?;
    let mut parts = value.splitn(2, ',');
    let start = parts.next()?.parse::<i32>().ok()?;
    let lines = parts
        .next()
        .map(|part| part.parse::<i32>().ok())
        .unwrap_or(Some(1))?;
    Some((start, lines))
}

fn optional_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn split_words(value: &str) -> Vec<String> {
    value
        .split_whitespace()
        .filter(|part| !part.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn split_refs(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn repo_branches(path: &Path) -> Vec<BranchSummary> {
    let output = git_command_lossy(
        path,
        &[
            "branch",
            "--all",
            "--format=%(HEAD)%x1f%(refname:short)%x1f%(upstream:short)%x1f%(upstream:track)",
        ],
    )
    .unwrap_or_default();
    let mut seen = HashSet::new();
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\x1f');
            let current = parts.next().unwrap_or("") == "*";
            let raw_name = parts.next().unwrap_or("").trim();
            if raw_name.is_empty() || raw_name == "remotes/origin/HEAD" {
                return None;
            }
            let remote = raw_name.starts_with("remotes/");
            let name = raw_name
                .strip_prefix("remotes/")
                .unwrap_or(raw_name)
                .to_string();
            if !seen.insert(format!("{remote}:{name}")) {
                return None;
            }
            let upstream = parts
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned);
            let track = parts.next().unwrap_or("");
            let (ahead, behind) = parse_track(track);
            Some(BranchSummary {
                name,
                remote,
                current,
                upstream,
                ahead,
                behind,
            })
        })
        .collect()
}

fn parse_track(track: &str) -> (i32, i32) {
    let mut ahead = 0;
    let mut behind = 0;
    for part in track.trim_matches(|c| c == '[' || c == ']').split(',') {
        let trimmed = part.trim();
        if let Some(value) = trimmed.strip_prefix("ahead ") {
            ahead = value.parse().unwrap_or(0);
        } else if let Some(value) = trimmed.strip_prefix("behind ") {
            behind = value.parse().unwrap_or(0);
        }
    }
    (ahead, behind)
}

fn run_pull(app: &AppHandle, path: &Path) -> Result<(), String> {
    let auth = token_for_binding(app)?.map(|token| github_auth_header(&token));
    git_command(path, &["pull", "--ff-only"], auth.as_deref()).map(|_| ())
}

fn run_fetch(app: &AppHandle, path: &Path) -> Result<(), String> {
    let auth = token_for_binding(app)?.map(|token| github_auth_header(&token));
    git_command(path, &["fetch"], auth.as_deref()).map(|_| ())
}

fn run_push(app: &AppHandle, path: &Path) -> Result<(), String> {
    let auth = token_for_binding(app)?.map(|token| github_auth_header(&token));
    git_command(path, &["push"], auth.as_deref()).map(|_| ())
}

fn current_branch_upstream(path: &Path) -> Option<String> {
    git_command_lossy(path, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .filter(|value| !value.is_empty())
}

fn repo_dirty_count(summary: &RepoSummary) -> usize {
    summary.staged_count + summary.unstaged_count + summary.untracked_count
}

fn push_block_reason(summary: &RepoSummary, has_upstream: bool) -> Option<String> {
    if summary.remote_url.is_none() {
        Some("没有 origin remote".to_string())
    } else if summary.current_branch.is_none() {
        Some("当前不是命名分支".to_string())
    } else if !has_upstream {
        Some("当前分支没有 upstream".to_string())
    } else if summary.behind > 0 {
        Some("当前分支落后于 upstream".to_string())
    } else {
        None
    }
}

fn merge_pull_block_reason(summary: &RepoSummary, has_upstream: bool) -> Option<String> {
    if summary.conflict_count > 0 {
        Some("已有冲突需要先处理".to_string())
    } else if repo_dirty_count(summary) > 0 {
        Some("存在未提交变更，已阻止合并拉取".to_string())
    } else if !has_upstream {
        Some("当前分支没有 upstream".to_string())
    } else {
        None
    }
}

fn build_bulk_push_preview_with_lookup<F>(repos: Vec<RepoSummary>, has_upstream: F) -> BulkSyncPreview
where
    F: Fn(&RepoSummary) -> bool,
{
    let mut eligible = Vec::new();
    let mut blocked = Vec::new();
    let mut warnings = Vec::new();

    for repo in repos {
        if let Some(reason) = push_block_reason(&repo, has_upstream(&repo)) {
            blocked.push(BulkSyncRepo { repo, reason });
            continue;
        }
        let dirty = repo_dirty_count(&repo);
        if repo.ahead > 0 {
            eligible.push(BulkSyncRepo {
                repo: repo.clone(),
                reason: "有本地提交待推送".to_string(),
            });
            if dirty > 0 {
                warnings.push(BulkSyncRepo {
                    repo,
                    reason: "存在未提交变更，但仍可执行 push".to_string(),
                });
            }
        } else {
            warnings.push(BulkSyncRepo {
                repo,
                reason: "没有需要推送的提交".to_string(),
            });
        }
    }

    BulkSyncPreview {
        operation: "push".to_string(),
        eligible,
        blocked,
        warnings,
    }
}

fn build_bulk_push_preview(repos: Vec<RepoSummary>) -> BulkSyncPreview {
    build_bulk_push_preview_with_lookup(repos, |repo| {
        current_branch_upstream(&PathBuf::from(&repo.path)).is_some()
    })
}

fn build_bulk_sync_preview_with_lookup<F>(
    repos: Vec<RepoSummary>,
    has_upstream: F,
) -> BulkSyncPreview
where
    F: Fn(&RepoSummary) -> bool,
{
    let mut eligible = Vec::new();
    let mut blocked = Vec::new();
    let mut warnings = Vec::new();

    for repo in repos {
        if repo.remote_url.is_none() {
            blocked.push(BulkSyncRepo {
                repo,
                reason: "没有 origin remote".to_string(),
            });
            continue;
        }
        if repo.current_branch.is_none() {
            blocked.push(BulkSyncRepo {
                repo,
                reason: "当前不是命名分支".to_string(),
            });
            continue;
        }

        let has_upstream = has_upstream(&repo);
        let dirty = repo_dirty_count(&repo);
        if repo.behind > 0 {
            if repo.conflict_count > 0 {
                blocked.push(BulkSyncRepo {
                    repo,
                    reason: "已有冲突需要先处理".to_string(),
                });
            } else if dirty > 0 {
                blocked.push(BulkSyncRepo {
                    repo,
                    reason: "存在未提交变更".to_string(),
                });
            } else if !has_upstream {
                blocked.push(BulkSyncRepo {
                    repo,
                    reason: "当前分支没有 upstream".to_string(),
                });
            } else if repo.ahead > 0 {
                eligible.push(BulkSyncRepo {
                    repo,
                    reason: "需先拉取合并后推送".to_string(),
                });
            } else {
                eligible.push(BulkSyncRepo {
                    repo,
                    reason: "可拉取远端更新".to_string(),
                });
            }
            continue;
        }

        if repo.ahead > 0 {
            if let Some(reason) = push_block_reason(&repo, has_upstream) {
                blocked.push(BulkSyncRepo { repo, reason });
            } else {
                eligible.push(BulkSyncRepo {
                    repo: repo.clone(),
                    reason: "有本地提交待推送".to_string(),
                });
                if dirty > 0 {
                    warnings.push(BulkSyncRepo {
                        repo,
                        reason: "存在未提交变更，但仍可执行 push".to_string(),
                    });
                }
            }
        } else {
            warnings.push(BulkSyncRepo {
                repo,
                reason: "没有需要同步的更新".to_string(),
            });
        }
    }

    BulkSyncPreview {
        operation: "sync".to_string(),
        eligible,
        blocked,
        warnings,
    }
}

fn build_bulk_sync_preview(repos: Vec<RepoSummary>) -> BulkSyncPreview {
    build_bulk_sync_preview_with_lookup(repos, |repo| {
        current_branch_upstream(&PathBuf::from(&repo.path)).is_some()
    })
}

fn build_bulk_preview(operation: String, repos: Vec<RepoSummary>) -> BulkSyncPreview {
    if operation == "push" {
        return build_bulk_push_preview(repos);
    }
    if operation == "sync" {
        return build_bulk_sync_preview(repos);
    }
    let mut eligible = Vec::new();
    let mut blocked = Vec::new();
    let mut warnings = Vec::new();
    let op = if operation == "push" { "push" } else { "pull" }.to_string();

    for repo in repos {
        if repo.remote_url.is_none() {
            blocked.push(BulkSyncRepo {
                repo,
                reason: "没有 origin remote".to_string(),
            });
            continue;
        }
        if repo.current_branch.is_none() {
            blocked.push(BulkSyncRepo {
                repo,
                reason: "当前不是命名分支".to_string(),
            });
            continue;
        }
        let dirty = repo_dirty_count(&repo);
        if op == "pull" {
            if dirty > 0 {
                blocked.push(BulkSyncRepo {
                    repo,
                    reason: "存在未提交变更".to_string(),
                });
            } else if repo.behind > 0 {
                eligible.push(BulkSyncRepo {
                    repo,
                    reason: "可拉取远端更新".to_string(),
                });
            } else {
                warnings.push(BulkSyncRepo {
                    repo,
                    reason: "没有需要拉取的更新".to_string(),
                });
            }
        } else if repo.ahead > 0 {
            eligible.push(BulkSyncRepo {
                repo,
                reason: "有本地提交待推送".to_string(),
            });
        } else {
            warnings.push(BulkSyncRepo {
                repo,
                reason: "没有需要推送的提交".to_string(),
            });
        }
    }

    BulkSyncPreview {
        operation: op,
        eligible,
        blocked,
        warnings,
    }
}

fn bulk_sync_repo(
    app: &AppHandle,
    root: &Path,
    operation: &str,
    repo_id: String,
) -> BulkSyncResult {
    let path = match repo_path_by_id(app, &repo_id) {
        Ok(path) => path,
        Err(err) => return bulk_error_result(repo_id, err),
    };
    let summary = summarize_repo(root, &path);
    if operation == "sync" {
        return sync_repo(app, root, repo_id, &path, &summary);
    }
    let run = if operation == "pull" {
        if repo_dirty_count(&summary) > 0 {
            Err("存在未提交变更，已跳过 pull".to_string())
        } else {
            run_pull(app, &path)
        }
    } else if let Some(reason) =
        push_block_reason(&summary, current_branch_upstream(&path).is_some())
    {
        Err(format!("{reason}，已跳过 push"))
    } else if summary.ahead <= 0 {
        Err("没有需要推送的提交，已跳过 push".to_string())
    } else {
        run_push(app, &path)
    };

    match run {
        Ok(()) => BulkSyncResult {
            summary: Some(summarize_repo(root, &path)),
            repo_id,
            status: "success".to_string(),
            message: "完成".to_string(),
        },
        Err(err) => bulk_error_result(repo_id, err),
    }
}

fn sync_repo(
    app: &AppHandle,
    root: &Path,
    repo_id: String,
    path: &Path,
    summary: &RepoSummary,
) -> BulkSyncResult {
    let has_upstream = current_branch_upstream(path).is_some();
    let dirty = repo_dirty_count(summary);
    let skip = |message: &str| bulk_error_result_for(&repo_id, message);
    let run: Result<(), BulkSyncResult> = if summary.behind > 0 {
        if summary.remote_url.is_none() {
            Err(skip("没有 origin remote，已跳过同步"))
        } else if summary.current_branch.is_none() {
            Err(skip("当前不是命名分支，已跳过同步"))
        } else if summary.conflict_count > 0 {
            Err(skip("已有冲突需要先处理，已跳过同步"))
        } else if dirty > 0 {
            Err(skip("存在未提交变更，已跳过同步"))
        } else if !has_upstream {
            Err(skip("当前分支没有 upstream，已跳过同步"))
        } else if summary.ahead > 0 {
            run_merge_pull_then_push(app, root, repo_id.clone(), path)
        } else {
            run_pull(app, path).map_err(|err| bulk_error_result_for(&repo_id, err))
        }
    } else if summary.ahead > 0 {
        if let Some(reason) = push_block_reason(summary, has_upstream) {
            Err(bulk_error_result_for(
                &repo_id,
                format!("{reason}，已跳过同步"),
            ))
        } else {
            run_push(app, path).map_err(|err| bulk_error_result_for(&repo_id, err))
        }
    } else {
        Err(skip("没有需要同步的更新，已跳过同步"))
    };

    match run {
        Ok(()) => BulkSyncResult {
            summary: Some(summarize_repo(root, path)),
            repo_id,
            status: "success".to_string(),
            message: "完成".to_string(),
        },
        Err(result) => result,
    }
}

fn run_merge_pull_then_push(
    app: &AppHandle,
    root: &Path,
    repo_id: String,
    path: &Path,
) -> Result<(), BulkSyncResult> {
    run_fetch(app, path).map_err(|err| bulk_error_result_for(&repo_id, err))?;
    match git_command(path, &["merge", "--no-edit", "@{u}"], None) {
        Ok(_) => run_push(app, path).map_err(|err| bulk_error_result(repo_id, err)),
        Err(err) => {
            let conflicts = repo_conflicts(path);
            if conflicts.files.is_empty() {
                Err(bulk_error_result_for(&repo_id, err))
            } else {
                Err(BulkSyncResult {
                    repo_id,
                    status: "error".to_string(),
                    message: "合并产生冲突，请处理后推送".to_string(),
                    summary: Some(summarize_repo(root, path)),
                })
            }
        }
    }
}

fn run_bulk_sync_parallel<F>(repo_ids: Vec<String>, run: F) -> Vec<BulkSyncResult>
where
    F: Fn(String) -> BulkSyncResult + Sync,
{
    thread::scope(|scope| {
        let run = &run;
        let handles: Vec<_> = repo_ids
            .into_iter()
            .map(|repo_id| scope.spawn(move || run(repo_id)))
            .collect();

        handles
            .into_iter()
            .map(|handle| {
                handle
                    .join()
                    .unwrap_or_else(|_| bulk_error_result_for("unknown", "批量执行线程异常"))
            })
            .collect()
    })
}

fn bulk_error_result(repo_id: String, message: String) -> BulkSyncResult {
    BulkSyncResult {
        repo_id,
        status: "error".to_string(),
        message,
        summary: None,
    }
}

fn bulk_error_result_for(repo_id: &str, message: impl Into<String>) -> BulkSyncResult {
    bulk_error_result(repo_id.to_string(), message.into())
}

pub(crate) fn parse_github_remote(remote: &str) -> Option<String> {
    let trimmed = remote.trim().trim_end_matches(".git");
    let path = if let Some(rest) = trimmed.strip_prefix("https://github.com/") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("http://github.com/") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("git@github.com:") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("ssh://git@github.com/") {
        rest
    } else {
        return None;
    };
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() >= 2 && !parts[0].is_empty() && !parts[1].is_empty() {
        Some(format!("{}/{}", parts[0], parts[1]))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
    use std::time::Duration as TestDuration;

    fn temp_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("lilia-github-{name}-{}", now_millis()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_package(path: &Path, body: &str) {
        fs::write(path.join("package.json"), body).unwrap();
    }

    fn run_git(path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn init_git_repo(path: &Path) {
        fs::create_dir_all(path).unwrap();
        run_git(path, &["init"]);
        run_git(path, &["config", "user.email", "test@example.com"]);
        run_git(path, &["config", "user.name", "Test User"]);
    }

    fn test_repo_summary(overrides: impl FnOnce(&mut RepoSummary)) -> RepoSummary {
        let mut summary = RepoSummary {
            id: "repo".to_string(),
            name: "repo".to_string(),
            path: "C:/repo".to_string(),
            relative_path: "repo".to_string(),
            current_branch: Some("main".to_string()),
            remote_url: Some("https://github.com/a/repo.git".to_string()),
            github_full_name: Some("a/repo".to_string()),
            ahead: 0,
            behind: 0,
            staged_count: 0,
            unstaged_count: 0,
            untracked_count: 0,
            conflict_count: 0,
            last_commit_at: None,
            last_commit_message: None,
            language_stats: Vec::new(),
            working_tree_language_stats: Vec::new(),
            language_stats_updated_at: 0,
        };
        overrides(&mut summary);
        summary
    }

    #[test]
    fn parses_github_remote_variants() {
        assert_eq!(
            parse_github_remote("https://github.com/sena-nana/Lilia.git"),
            Some("sena-nana/Lilia".to_string())
        );
        assert_eq!(
            parse_github_remote("git@github.com:sena-nana/Lilia.git"),
            Some("sena-nana/Lilia".to_string())
        );
        assert_eq!(parse_github_remote("https://example.com/a/b.git"), None);
    }

    #[test]
    fn normalizes_github_contribution_repo_inputs() {
        let (repos, requested_repo_count) = normalize_github_contribution_repos(vec![
            " sena-nana/LiliaGithub ".to_string(),
            "".to_string(),
            "invalid".to_string(),
            "sena-nana/LiliaGithub".to_string(),
            "sena-nana/Lilia".to_string(),
        ]);

        assert_eq!(repos, vec!["sena-nana/LiliaGithub", "sena-nana/Lilia"]);
        assert_eq!(requested_repo_count, 2);
    }

    #[test]
    fn marks_github_contribution_repo_limit_truncation() {
        let names = (0..GITHUB_CONTRIBUTIONS_REPO_LIMIT + 1)
            .map(|index| format!("sena-nana/repo-{index}"))
            .collect::<Vec<_>>();
        let (repos, requested_repo_count) = normalize_github_contribution_repos(names);
        let meta = github_contribution_meta(repos.len(), requested_repo_count, 0);

        assert_eq!(repos.len(), GITHUB_CONTRIBUTIONS_REPO_LIMIT);
        assert_eq!(requested_repo_count, GITHUB_CONTRIBUTIONS_REPO_LIMIT + 1);
        assert_eq!(meta.repo_count, GITHUB_CONTRIBUTIONS_REPO_LIMIT);
        assert_eq!(meta.requested_repo_count, GITHUB_CONTRIBUTIONS_REPO_LIMIT + 1);
        assert_eq!(meta.repo_limit, GITHUB_CONTRIBUTIONS_REPO_LIMIT);
        assert_eq!(meta.skipped_repo_count, 0);
        assert!(meta.truncated);
    }

    #[test]
    fn treats_missing_or_empty_repos_as_recoverable_contribution_sources() {
        assert!(is_recoverable_github_contribution_status(StatusCode::NOT_FOUND));
        assert!(is_recoverable_github_contribution_status(StatusCode::CONFLICT));
        assert!(!is_recoverable_github_contribution_status(StatusCode::FORBIDDEN));
        assert!(!is_recoverable_github_contribution_status(StatusCode::UNAUTHORIZED));
    }

    fn test_remote_shortcut(full_name: &str) -> RemoteRepoShortcut {
        let repo = normalize_github_repo_input(full_name).unwrap();
        RemoteRepoShortcut {
            full_name: repo.full_name,
            name: repo.name,
            private: false,
            archived: false,
            default_branch: Some("main".to_string()),
            html_url: format!("https://github.com/{full_name}"),
            clone_url: format!("https://github.com/{full_name}.git"),
            opened_at: 1,
        }
    }

    #[test]
    fn remote_repo_shortcuts_are_upserted_by_full_name() {
        let mut shortcuts = Vec::new();
        remember_remote_repo_shortcut(&mut shortcuts, test_remote_shortcut("sena-nana/Remote")).unwrap();
        let first_opened_at = shortcuts[0].opened_at;
        let mut updated = test_remote_shortcut("https://github.com/sena-nana/Remote.git");
        updated.private = true;
        updated.clone_url = "https://github.com/sena-nana/Remote-updated.git".to_string();

        remember_remote_repo_shortcut(&mut shortcuts, updated).unwrap();

        assert_eq!(shortcuts.len(), 1);
        assert_eq!(shortcuts[0].full_name, "sena-nana/Remote");
        assert!(shortcuts[0].private);
        assert_eq!(shortcuts[0].clone_url, "https://github.com/sena-nana/Remote-updated.git");
        assert!(shortcuts[0].opened_at >= first_opened_at);
    }

    #[test]
    fn forget_remote_repo_shortcut_removes_only_matching_repo() {
        let mut shortcuts = vec![
            test_remote_shortcut("sena-nana/Keep"),
            test_remote_shortcut("sena-nana/Remove"),
        ];

        forget_remote_repo_shortcut(&mut shortcuts, "https://github.com/sena-nana/Remove").unwrap();

        assert_eq!(shortcuts.len(), 1);
        assert_eq!(shortcuts[0].full_name, "sena-nana/Keep");
    }

    #[test]
    fn readme_name_priority_supports_remote_readme_candidates() {
        let mut names = vec![
            "README.txt",
            "README.zh-CN.md",
            "README",
            "readme.markdown",
            "README.md",
            "docs.md",
        ];
        names.sort_by(|a, b| {
            let a_priority = readme_name_priority(a).unwrap_or(usize::MAX);
            let b_priority = readme_name_priority(b).unwrap_or(usize::MAX);
            a_priority.cmp(&b_priority).then_with(|| a.cmp(b))
        });

        assert_eq!(
            names,
            vec!["README.md", "readme.markdown", "README", "README.txt", "README.zh-CN.md", "docs.md"],
        );
    }

    #[test]
    fn detects_source_languages_by_path() {
        assert_eq!(language_for_path(Path::new("src/app.ts")), Some("TypeScript"));
        assert_eq!(language_for_path(Path::new("src/App.vue")), Some("Vue"));
        assert_eq!(language_for_path(Path::new("src/main.rs")), Some("Rust"));
        assert_eq!(language_for_path(Path::new("scripts/build.ps1")), Some("PowerShell"));
        assert_eq!(language_for_path(Path::new("Dockerfile")), Some("Dockerfile"));
        assert_eq!(language_for_path(Path::new("assets/icon.png")), None);
    }

    #[test]
    fn skips_generated_lock_and_binary_language_paths() {
        assert!(should_skip_language_path(Path::new("dist/app.ts")));
        assert!(should_skip_language_path(Path::new("node_modules/pkg/index.js")));
        assert!(should_skip_language_path(Path::new("package-lock.json")));
        assert!(should_skip_language_path(Path::new("assets/icon.png")));
        assert!(!should_skip_language_path(Path::new("src/app.ts")));
    }

    #[test]
    fn aggregates_language_stats_from_head_tree() {
        let path = temp_dir("language-stats");
        run_git(&path, &["init"]);
        run_git(&path, &["config", "user.email", "test@example.com"]);
        run_git(&path, &["config", "user.name", "Test User"]);
        fs::create_dir_all(path.join("src")).unwrap();
        fs::create_dir_all(path.join("dist")).unwrap();
        fs::write(path.join("src").join("app.ts"), "console.log('typescript');\n").unwrap();
        fs::write(path.join("src").join("view.vue"), "<template>Vue</template>\n").unwrap();
        fs::write(path.join("README.unknown"), "plain text\n").unwrap();
        fs::write(path.join("dist").join("generated.ts"), "ignored\n").unwrap();
        fs::write(path.join("binary.dat"), [0_u8, 159, 146, 150]).unwrap();
        run_git(
            &path,
            &[
                "add",
                "src/app.ts",
                "src/view.vue",
                "README.unknown",
                "dist/generated.ts",
                "binary.dat",
            ],
        );
        run_git(&path, &["commit", "-m", "initial"]);
        fs::write(path.join("src").join("app.ts"), "changed\n").unwrap();
        fs::remove_file(path.join("src").join("view.vue")).unwrap();

        let stats = repo_head_language_stats(&path);

        assert_eq!(
            stats,
            vec![
                LanguageStat {
                    language: "TypeScript".to_string(),
                    bytes: 27,
                },
                LanguageStat {
                    language: "Vue".to_string(),
                    bytes: 25,
                },
            ]
        );
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn aggregates_language_stats_from_working_tree() {
        let path = temp_dir("language-stats-working-tree");
        run_git(&path, &["init"]);
        run_git(&path, &["config", "user.email", "test@example.com"]);
        run_git(&path, &["config", "user.name", "Test User"]);
        fs::create_dir_all(path.join("src")).unwrap();
        fs::write(
            path.join("src").join("app.ts"),
            "console.log('typescript');\n",
        )
        .unwrap();
        fs::write(
            path.join("src").join("view.vue"),
            "<template>Vue</template>\n",
        )
        .unwrap();
        run_git(&path, &["add", "src/app.ts", "src/view.vue"]);
        run_git(&path, &["commit", "-m", "initial"]);
        fs::write(path.join("src").join("app.ts"), "changed\n").unwrap();
        fs::remove_file(path.join("src").join("view.vue")).unwrap();
        fs::write(path.join("src").join("panel.rs"), "fn main() {}\n").unwrap();

        let head_stats = repo_head_language_stats(&path);
        let working_tree_stats = repo_working_tree_language_stats(&path);

        assert_eq!(
            head_stats,
            vec![
                LanguageStat {
                    language: "TypeScript".to_string(),
                    bytes: 27,
                },
                LanguageStat {
                    language: "Vue".to_string(),
                    bytes: 25,
                },
            ]
        );
        assert_eq!(
            working_tree_stats,
            vec![
                LanguageStat {
                    language: "Rust".to_string(),
                    bytes: 13,
                },
                LanguageStat {
                    language: "TypeScript".to_string(),
                    bytes: 8,
                },
            ]
        );
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn aggregates_github_commit_contribution_days() {
        let mut counts = HashMap::new();
        let commits = vec![
            GitHubCommitResponse {
                commit: GitHubCommitPayload {
                    author: Some(GitHubCommitAuthor {
                        date: Some("2026-06-11T08:00:00Z".to_string()),
                    }),
                },
            },
            GitHubCommitResponse {
                commit: GitHubCommitPayload {
                    author: Some(GitHubCommitAuthor {
                        date: Some("2026-06-11T12:00:00Z".to_string()),
                    }),
                },
            },
            GitHubCommitResponse {
                commit: GitHubCommitPayload {
                    author: Some(GitHubCommitAuthor {
                        date: Some("2026-06-10T12:00:00Z".to_string()),
                    }),
                },
            },
        ];
        let end = days_from_civil(2026, 6, 11);
        add_commit_contributions(&mut counts, &commits, end - 2, end);
        let days = github_contribution_days(&counts, end);

        assert_eq!(days.len(), GITHUB_CONTRIBUTION_DAYS);
        assert_eq!(days.last().unwrap().date, "2026-06-11");
        assert_eq!(days.last().unwrap().count, 2);
        assert_eq!(days[days.len() - 2].date, "2026-06-10");
        assert_eq!(days[days.len() - 2].count, 1);
    }

    #[test]
    fn converts_civil_dates_for_github_contributions() {
        let day = days_from_civil(2026, 6, 11);
        assert_eq!(format_day_index(day), "2026-06-11");
        assert_eq!(parse_github_date_day("2026-06-11T08:00:00Z"), Some(day));
        assert_eq!(parse_github_date_day("bad-date"), None);
    }

    #[test]
    fn infers_clone_directory_from_remote_url() {
        assert_eq!(
            infer_clone_directory_name("https://github.com/sena-nana/LiliaGithub.git").unwrap(),
            "LiliaGithub"
        );
        assert_eq!(
            infer_clone_directory_name("git@github.com:sena-nana/Lilia.git").unwrap(),
            "Lilia"
        );
        assert_eq!(
            infer_clone_directory_name("ssh://git@example.com/tools/example-repo.git").unwrap(),
            "example-repo"
        );
    }

    #[test]
    fn validates_clone_directory_name_as_single_segment() {
        assert!(validate_clone_directory_name("new-repo").is_ok());
        assert!(validate_clone_directory_name("nested/repo").is_err());
        assert!(validate_clone_directory_name("nested\\repo").is_err());
        assert!(validate_clone_directory_name("../repo").is_err());
        assert!(validate_clone_directory_name("..").is_err());
        assert!(validate_clone_directory_name(" repo ").is_err());
        assert!(validate_clone_directory_name("").is_err());
    }

    #[test]
    fn normalizes_clone_directory_name_with_user_override() {
        assert_eq!(
            normalize_clone_directory_name(
                "https://github.com/sena-nana/source-name.git",
                Some("target-name".to_string())
            )
            .unwrap(),
            "target-name"
        );
        assert!(normalize_clone_directory_name(
            "https://github.com/sena-nana/source-name.git",
            Some("../target".to_string())
        )
        .is_err());
    }

    #[test]
    fn parses_status_pair_and_path() {
        assert_eq!(
            status_pair(" M src/main.ts"),
            (" ".to_string(), "M".to_string())
        );
        assert_eq!(
            parse_status_entries(" M src/main.ts\0R  new.ts\0old.ts\0"),
            vec![
                RepoStatusEntry {
                    index: " ".to_string(),
                    worktree: "M".to_string(),
                    path: "src/main.ts".to_string(),
                    old_path: None,
                },
                RepoStatusEntry {
                    index: "R".to_string(),
                    worktree: " ".to_string(),
                    path: "new.ts".to_string(),
                    old_path: Some("old.ts".to_string()),
                },
            ]
        );
    }

    #[test]
    fn selects_repo_files_from_porcelain_z_status() {
        let path = temp_dir("selected-repo-files");
        run_git(&path, &["init"]);
        run_git(&path, &["config", "user.email", "test@example.com"]);
        run_git(&path, &["config", "user.name", "Test User"]);
        fs::create_dir_all(path.join("src").join("components").join("repo")).unwrap();
        fs::write(
            path.join("src")
                .join("components")
                .join("repo")
                .join("Repo Changes Panel.vue"),
            "<template />\n",
        )
        .unwrap();

        let selected = selected_repo_files(
            &path,
            vec![
                "src/components/repo/Repo Changes Panel.vue".to_string(),
                "src/components/repo/Repo Changes Panel.vue".to_string(),
            ],
        )
        .unwrap();

        assert_eq!(
            selected,
            vec!["src/components/repo/Repo Changes Panel.vue".to_string()]
        );
        assert!(selected_repo_files(
            &path,
            vec!["rc/components/repo/Repo Changes Panel.vue".to_string()]
        )
        .is_err());
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn detects_unmerged_status_pairs() {
        for (index, worktree) in [
            ("U", "U"),
            ("A", "A"),
            ("D", "D"),
            ("A", "U"),
            ("U", "A"),
            ("D", "U"),
            ("U", "D"),
        ] {
            assert!(is_conflict_status(index, worktree));
        }
        assert!(!is_conflict_status("M", " "));
        assert!(!is_conflict_status("?", "?"));
    }

    #[test]
    fn parses_conflict_marker_hunks() {
        let content = [
            "before",
            &format!("{} HEAD", "<<<<<<<"),
            "ours one",
            "=======",
            "theirs one",
            &format!("{} origin/main", ">>>>>>>"),
            "middle",
            &format!("{} feature", "<<<<<<<"),
            "ours two",
            "=======",
            "theirs two",
            &format!("{} main", ">>>>>>>"),
            "after",
            "",
        ]
        .join("\n");

        let hunks = parse_conflict_hunks(&content);

        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].id, "hunk-1");
        assert_eq!(hunks[0].start_line, 2);
        assert_eq!(hunks[0].end_line, 6);
        assert_eq!(hunks[0].ours_label, "HEAD");
        assert_eq!(hunks[0].theirs_label, "origin/main");
        assert_eq!(hunks[0].ours_lines, vec!["ours one".to_string()]);
        assert_eq!(hunks[0].theirs_lines, vec!["theirs one".to_string()]);
        assert_eq!(hunks[1].id, "hunk-2");
    }

    #[test]
    fn resolves_conflict_content_from_hunk_choices() {
        let content = [
            "keep",
            &format!("{} HEAD", "<<<<<<<"),
            "ours one",
            "=======",
            "theirs one",
            &format!("{} origin/main", ">>>>>>>"),
            &format!("{} HEAD", "<<<<<<<"),
            "ours two",
            "=======",
            "theirs two",
            &format!("{} origin/main", ">>>>>>>"),
            "",
        ]
        .join("\n");
        let resolved = resolve_conflict_content(
            &content,
            &[
                RepoConflictChoice {
                    hunk_id: "hunk-1".to_string(),
                    side: "ours".to_string(),
                },
                RepoConflictChoice {
                    hunk_id: "hunk-2".to_string(),
                    side: "theirs".to_string(),
                },
            ],
        )
        .unwrap();

        assert_eq!(resolved, "keep\nours one\ntheirs two\n");
        assert!(!resolved.contains("<<<<<<<"));
        assert!(!resolved.contains("======="));
        assert!(!resolved.contains(">>>>>>>"));
    }

    #[test]
    fn maps_conflict_abort_and_continue_args() {
        assert_eq!(
            conflict_operation_args("merge", "终止").unwrap(),
            ["merge", "--abort"]
        );
        assert_eq!(
            conflict_operation_args("rebase", "终止").unwrap(),
            ["rebase", "--abort"]
        );
        assert_eq!(
            conflict_operation_args("cherry-pick", "终止").unwrap(),
            ["cherry-pick", "--abort"]
        );
        assert_eq!(
            conflict_operation_args("merge", "继续").unwrap(),
            ["commit", "--no-edit"]
        );
        assert_eq!(
            conflict_operation_args("rebase", "继续").unwrap(),
            ["rebase", "--continue"]
        );
        assert_eq!(
            conflict_operation_args("cherry-pick", "继续").unwrap(),
            ["cherry-pick", "--continue"]
        );
    }

    #[test]
    fn rejects_missing_or_unknown_conflict_operations() {
        assert_eq!(
            conflict_operation_args("none", "终止").unwrap_err(),
            "当前没有进行中的冲突操作"
        );
        assert_eq!(
            conflict_operation_args("none", "继续").unwrap_err(),
            "当前没有进行中的冲突操作"
        );
        assert_eq!(
            conflict_operation_args("am", "终止").unwrap_err(),
            "不支持终止 am 冲突"
        );
        assert_eq!(
            conflict_operation_args("am", "继续").unwrap_err(),
            "不支持继续 am 冲突"
        );
    }

    #[test]
    fn merge_pull_blocks_unsafe_states() {
        assert_eq!(
            merge_pull_block_reason(&test_repo_summary(|summary| summary.conflict_count = 1), true),
            Some("已有冲突需要先处理".to_string())
        );
        assert_eq!(
            merge_pull_block_reason(&test_repo_summary(|summary| summary.unstaged_count = 1), true),
            Some("存在未提交变更，已阻止合并拉取".to_string())
        );
        assert_eq!(
            merge_pull_block_reason(&test_repo_summary(|_| {}), false),
            Some("当前分支没有 upstream".to_string())
        );
        assert_eq!(merge_pull_block_reason(&test_repo_summary(|_| {}), true), None);
    }

    #[test]
    fn parses_commit_patch_hunks_and_line_numbers() {
        let patch = "\
diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import app from './app'
-console.log('old')
+console.log('new')
+console.log('ready')
 export default app";

        let patches = commit_file_patches(patch);
        let parsed = patches.get("src/app.ts").expect("patch should be parsed");

        assert_eq!(parsed.hunks.len(), 1);
        let hunk = &parsed.hunks[0];
        assert_eq!(hunk.header, "@@ -1,3 +1,4 @@");
        assert_eq!((hunk.old_start, hunk.old_lines), (1, 3));
        assert_eq!((hunk.new_start, hunk.new_lines), (1, 4));
        assert_eq!(hunk.lines[0].kind, "context");
        assert_eq!((hunk.lines[0].old_line, hunk.lines[0].new_line), (Some(1), Some(1)));
        assert_eq!(hunk.lines[1].kind, "deleted");
        assert_eq!((hunk.lines[1].old_line, hunk.lines[1].new_line), (Some(2), None));
        assert_eq!(hunk.lines[2].kind, "added");
        assert_eq!((hunk.lines[2].old_line, hunk.lines[2].new_line), (None, Some(2)));
        assert_eq!(hunk.lines[3].kind, "added");
        assert_eq!((hunk.lines[3].old_line, hunk.lines[3].new_line), (None, Some(3)));
        assert_eq!((hunk.lines[4].old_line, hunk.lines[4].new_line), (Some(3), Some(4)));
    }

    #[test]
    fn binds_renamed_commit_patch_to_new_path() {
        let status = commit_file_statuses("R072\tsrc/old.ts\tsrc/new.ts")
            .into_iter()
            .next()
            .expect("rename status should parse");
        let stats = commit_file_numstats("1\t1\tsrc/{old => new}.ts");
        let mut file = commit_file_change_from_status(status, &stats);
        let patches = commit_file_patches(
            "\
diff --git a/src/old.ts b/src/new.ts
similarity index 72%
rename from src/old.ts
rename to src/new.ts
--- a/src/old.ts
+++ b/src/new.ts
@@ -1 +1 @@
-oldName()
+newName()",
        );

        if let Some(parsed) = patches.get(&file.path) {
            file.patch = parsed.patch.clone();
            file.hunks = parsed.hunks.clone();
        }

        assert_eq!(file.status, "renamed");
        assert_eq!(file.old_path.as_deref(), Some("src/old.ts"));
        assert_eq!(file.path, "src/new.ts");
        assert_eq!((file.additions, file.deletions), (1, 1));
        assert!(file.patch.contains("rename to src/new.ts"));
        assert_eq!(file.hunks.len(), 1);
        assert_eq!(file.hunks[0].lines[0].content, "oldName()");
        assert_eq!(file.hunks[0].lines[1].content, "newName()");
    }

    #[test]
    fn binds_pure_rename_patch_without_hunks() {
        let status = commit_file_statuses("R100\tdocs/old.md\tdocs/new.md")
            .into_iter()
            .next()
            .expect("pure rename status should parse");
        let patches = commit_file_patches(
            "\
diff --git a/docs/old.md b/docs/new.md
similarity index 100%
rename from docs/old.md
rename to docs/new.md",
        );

        let parsed = patches
            .get(&status.path)
            .expect("pure rename patch should bind to new path");

        assert_eq!(status.status, "renamed");
        assert_eq!(status.old_path.as_deref(), Some("docs/old.md"));
        assert_eq!(status.path, "docs/new.md");
        assert!(parsed.patch.contains("rename to docs/new.md"));
        assert!(parsed.hunks.is_empty());
    }

    #[test]
    fn bulk_preview_blocks_dirty_pull_and_allows_push() {
        let dirty_pull_repo = test_repo_summary(|summary| {
            summary.id = "app".to_string();
            summary.ahead = 1;
            summary.behind = 2;
            summary.unstaged_count = 1;
        });
        let pull = build_bulk_preview("pull".to_string(), vec![dirty_pull_repo]);
        assert_eq!(pull.blocked.len(), 1);

        let push_repo = test_repo_summary(|summary| {
            summary.id = "push".to_string();
            summary.ahead = 1;
            summary.unstaged_count = 1;
        });
        let push = build_bulk_push_preview_with_lookup(vec![push_repo], |_| true);
        assert_eq!(push.eligible.len(), 1);
        assert_eq!(push.warnings.len(), 1);
    }

    #[test]
    fn push_preview_blocks_missing_remote_detached_and_behind() {
        let no_remote = test_repo_summary(|summary| {
            summary.id = "no-remote".to_string();
            summary.remote_url = None;
            summary.github_full_name = None;
            summary.ahead = 1;
        });
        let detached = test_repo_summary(|summary| {
            summary.id = "detached".to_string();
            summary.current_branch = None;
            summary.ahead = 1;
        });
        let behind = test_repo_summary(|summary| {
            summary.id = "behind".to_string();
            summary.ahead = 1;
            summary.behind = 2;
        });

        let preview = build_bulk_push_preview_with_lookup(vec![no_remote, detached, behind], |_| true);

        assert_eq!(preview.blocked.len(), 3);
        assert!(preview
            .blocked
            .iter()
            .any(|item| item.reason == "没有 origin remote"));
        assert!(preview
            .blocked
            .iter()
            .any(|item| item.reason == "当前不是命名分支"));
        assert!(preview
            .blocked
            .iter()
            .any(|item| item.reason == "当前分支落后于 upstream"));
    }

    #[test]
    fn push_preview_warns_dirty_push_and_idle_repos() {
        let ready = test_repo_summary(|summary| {
            summary.id = "ready".to_string();
            summary.ahead = 1;
            summary.staged_count = 1;
        });
        let idle = test_repo_summary(|summary| {
            summary.id = "idle".to_string();
        });

        let preview = build_bulk_push_preview_with_lookup(vec![ready.clone(), idle.clone()], |_| true);

        assert_eq!(preview.eligible.len(), 1);
        assert_eq!(preview.eligible[0].repo.id, ready.id);
        assert!(preview
            .warnings
            .iter()
            .any(|item| item.repo.id == ready.id && item.reason == "存在未提交变更，但仍可执行 push"));
        assert!(preview
            .warnings
            .iter()
            .any(|item| item.repo.id == idle.id && item.reason == "没有需要推送的提交"));
    }

    #[test]
    fn push_preview_blocks_repo_without_upstream() {
        let repo = test_repo_summary(|summary| {
            summary.id = "no-upstream".to_string();
            summary.ahead = 1;
        });

        let preview = build_bulk_push_preview_with_lookup(vec![repo], |_| false);

        assert_eq!(preview.blocked.len(), 1);
        assert_eq!(preview.blocked[0].reason, "当前分支没有 upstream");
    }

    #[test]
    fn sync_preview_classifies_pull_push_merge_and_idle_repos() {
        let pull_only = test_repo_summary(|summary| {
            summary.id = "pull-only".to_string();
            summary.behind = 2;
        });
        let push_only = test_repo_summary(|summary| {
            summary.id = "push-only".to_string();
            summary.ahead = 1;
        });
        let diverged = test_repo_summary(|summary| {
            summary.id = "diverged".to_string();
            summary.ahead = 1;
            summary.behind = 1;
        });
        let idle = test_repo_summary(|summary| {
            summary.id = "idle".to_string();
        });

        let preview =
            build_bulk_sync_preview_with_lookup(vec![pull_only, push_only, diverged, idle], |_| {
                true
            });

        assert_eq!(preview.operation, "sync");
        assert!(preview
            .eligible
            .iter()
            .any(|item| { item.repo.id == "pull-only" && item.reason == "可拉取远端更新" }));
        assert!(preview.eligible.iter().any(|item| {
            item.repo.id == "push-only" && item.reason == "有本地提交待推送"
        }));
        assert!(preview.eligible.iter().any(|item| {
            item.repo.id == "diverged" && item.reason == "需先拉取合并后推送"
        }));
        assert!(preview.warnings.iter().any(|item| {
            item.repo.id == "idle" && item.reason == "没有需要同步的更新"
        }));
    }

    #[test]
    fn sync_preview_blocks_unsafe_merge_states() {
        let dirty = test_repo_summary(|summary| {
            summary.id = "dirty".to_string();
            summary.behind = 1;
            summary.unstaged_count = 1;
        });
        let conflicted = test_repo_summary(|summary| {
            summary.id = "conflicted".to_string();
            summary.behind = 1;
            summary.conflict_count = 1;
        });
        let no_upstream = test_repo_summary(|summary| {
            summary.id = "no-upstream".to_string();
            summary.behind = 1;
        });

        let preview =
            build_bulk_sync_preview_with_lookup(vec![dirty, conflicted, no_upstream], |repo| {
                repo.id != "no-upstream"
            });

        assert_eq!(preview.eligible.len(), 0);
        assert!(preview
            .blocked
            .iter()
            .any(|item| { item.repo.id == "dirty" && item.reason == "存在未提交变更" }));
        assert!(preview.blocked.iter().any(|item| {
            item.repo.id == "conflicted" && item.reason == "已有冲突需要先处理"
        }));
        assert!(preview.blocked.iter().any(|item| {
            item.repo.id == "no-upstream" && item.reason == "当前分支没有 upstream"
        }));
    }

    #[test]
    fn bulk_sync_parallel_returns_all_results_after_repo_error() {
        let active = AtomicUsize::new(0);
        let peak = AtomicUsize::new(0);

        let results =
            run_bulk_sync_parallel(vec!["ok".to_string(), "failed".to_string()], |repo_id| {
                let current = active.fetch_add(1, AtomicOrdering::SeqCst) + 1;
                peak.fetch_max(current, AtomicOrdering::SeqCst);
                std::thread::sleep(TestDuration::from_millis(30));
                active.fetch_sub(1, AtomicOrdering::SeqCst);

                if repo_id == "failed" {
                    return bulk_error_result(repo_id, "认证失败".to_string());
                }
                BulkSyncResult {
                    repo_id,
                    status: "success".to_string(),
                    message: "完成".to_string(),
                    summary: None,
                }
            });

        assert_eq!(results.len(), 2);
        assert!(peak.load(AtomicOrdering::SeqCst) > 1);
        assert!(results.iter().any(|result| result.status == "success"));
        assert!(results
            .iter()
            .any(|result| result.status == "error" && result.message == "认证失败"));
    }

    #[test]
    fn filters_hidden_repositories_by_id() {
        let visible = test_repo_summary(|summary| {
            summary.id = "visible".to_string();
            summary.remote_url = None;
            summary.github_full_name = None;
        });
        let hidden = test_repo_summary(|summary| {
            summary.id = "hidden".to_string();
            summary.remote_url = None;
            summary.github_full_name = None;
        });

        let repos = filter_hidden_repos(vec![visible.clone(), hidden], &["hidden".to_string()]);

        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].id, visible.id);
    }

    #[test]
    fn github_delete_repo_requires_delete_repo_scope() {
        let mut binding = GitHubBindingMetadata {
            login: "lilia-user".to_string(),
            avatar_url: None,
            bound_at: 1,
            scopes: vec!["repo".to_string(), "workflow".to_string(), "read:user".to_string()],
            client_id_source: "bundled".to_string(),
        };

        assert!(github_require_scope(&binding, GITHUB_DELETE_REPO_SCOPE).is_err());

        binding.scopes.push(GITHUB_DELETE_REPO_SCOPE.to_string());

        assert!(github_require_scope(&binding, GITHUB_DELETE_REPO_SCOPE).is_ok());
    }

    #[test]
    fn workspace_task_priority_orders_high_before_low() {
        assert!(task_priority_rank("high") < task_priority_rank("normal"));
        assert!(task_priority_rank("normal") < task_priority_rank("low"));
    }

    #[test]
    fn normalize_github_repo_input_accepts_owner_repo() {
        let repo = normalize_github_repo_input("sena-nana/LiliaGithub").unwrap();

        assert_eq!(repo.owner, "sena-nana");
        assert_eq!(repo.name, "LiliaGithub");
        assert_eq!(repo.full_name, "sena-nana/LiliaGithub");
        assert_eq!(
            repo.clone_url,
            "https://github.com/sena-nana/LiliaGithub.git"
        );
    }

    #[test]
    fn normalize_github_repo_input_accepts_https_url() {
        let repo =
            normalize_github_repo_input("https://github.com/sena-nana/LiliaGithub.git").unwrap();

        assert_eq!(repo.full_name, "sena-nana/LiliaGithub");
        assert_eq!(
            repo.clone_url,
            "https://github.com/sena-nana/LiliaGithub.git"
        );
    }

    #[test]
    fn normalize_github_repo_input_rejects_invalid_values() {
        assert!(normalize_github_repo_input("sena-nana").is_err());
        assert!(normalize_github_repo_input("https://example.com/foo/bar").is_err());
    }

    #[test]
    fn parses_github_next_page_from_link_header() {
        let link = r#"<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=4>; rel="last""#;

        assert_eq!(parse_next_page(Some(link)), Some(2));
        assert_eq!(parse_next_page(Some(r#"<https://api.github.com/user/repos?page=4>; rel="last""#)), None);
        assert_eq!(parse_next_page(None), None);
    }

    #[test]
    fn builds_github_repo_settings_patch_with_changed_fields_only() {
        let payload = github_update_repo_settings_payload(GitHubUpdateRepoSettingsRequest {
            description: Some("new desc".to_string()),
            homepage: None,
            private: Some(true),
            default_branch: Some(" main ".to_string()),
            has_issues: None,
            has_wiki: Some(false),
            has_projects: None,
            has_discussions: None,
            allow_merge_commit: None,
            allow_squash_merge: None,
            allow_rebase_merge: None,
            allow_auto_merge: None,
            delete_branch_on_merge: Some(true),
            allow_forking: None,
            web_commit_signoff_required: None,
        });

        assert_eq!(payload.len(), 5);
        assert_eq!(payload.get("description").unwrap(), "new desc");
        assert_eq!(payload.get("private").unwrap(), true);
        assert_eq!(payload.get("default_branch").unwrap(), "main");
        assert_eq!(payload.get("has_wiki").unwrap(), false);
        assert_eq!(payload.get("delete_branch_on_merge").unwrap(), true);
        assert!(payload.get("homepage").is_none());
    }

    #[test]
    fn filters_pull_requests_from_github_issues() {
        let issue = GitHubIssueResponse {
            number: 1,
            title: "Issue".to_string(),
            state: "open".to_string(),
            body: None,
            html_url: "https://github.com/a/repo/issues/1".to_string(),
            updated_at: "2026-06-11T00:00:00Z".to_string(),
            created_at: "2026-06-11T00:00:00Z".to_string(),
            labels: vec![GitHubLabelResponse { name: "bug".to_string() }],
            assignees: vec![GitHubAssigneeResponse { login: "octo".to_string() }],
            pull_request: None,
        };
        let pr = GitHubIssueResponse {
            pull_request: Some(serde_json::json!({ "url": "https://api.github.com/repos/a/repo/pulls/2" })),
            number: 2,
            title: "PR".to_string(),
            state: "open".to_string(),
            body: None,
            html_url: "https://github.com/a/repo/pull/2".to_string(),
            updated_at: "2026-06-11T00:00:00Z".to_string(),
            created_at: "2026-06-11T00:00:00Z".to_string(),
            labels: Vec::new(),
            assignees: Vec::new(),
        };

        let mapped = github_issue_from_response(issue).unwrap();
        assert_eq!(mapped.labels, vec!["bug"]);
        assert_eq!(mapped.assignees, vec!["octo"]);
        assert!(github_issue_from_response(pr).is_none());
    }

    #[test]
    fn maps_github_workflow_runs_with_defaults() {
        let mapped = github_workflow_run_from_response(GitHubWorkflowRunResponse {
            id: 42,
            name: Some("CI".to_string()),
            display_title: None,
            status: Some("completed".to_string()),
            conclusion: Some("success".to_string()),
            head_branch: Some("main".to_string()),
            event: Some("push".to_string()),
            html_url: "https://github.com/a/repo/actions/runs/42".to_string(),
            created_at: "2026-06-12T10:00:00Z".to_string(),
            updated_at: "2026-06-12T10:05:00Z".to_string(),
        });

        assert_eq!(mapped.id, 42);
        assert_eq!(mapped.name, "CI");
        assert_eq!(mapped.display_title, "CI");
        assert_eq!(mapped.status, "completed");
        assert_eq!(mapped.conclusion.as_deref(), Some("success"));
        assert_eq!(mapped.branch, "main");
        assert_eq!(mapped.event, "push");
    }

    #[test]
    fn reads_first_supported_repo_readme() {
        let repo = temp_dir("repo-readme");
        fs::write(repo.join("README.md"), "# Main\n").unwrap();
        fs::write(repo.join("README"), "# Plain\n").unwrap();

        let readme = read_repo_readme("repo", &repo).unwrap().unwrap();

        assert_eq!(readme.repo_id, "repo");
        assert_eq!(readme.path, "README.md");
        assert_eq!(readme.format, "md");
        assert_eq!(readme.content, "# Main\n");
    }

    #[test]
    fn lists_supported_root_readmes_in_priority_order() {
        let repo = temp_dir("repo-readme-list");
        fs::create_dir_all(repo.join("docs")).unwrap();
        fs::write(repo.join("README.txt"), "Text\n").unwrap();
        fs::write(repo.join("README.unknown"), "Unknown\n").unwrap();
        fs::write(repo.join("readme.markdown"), "# Markdown\n").unwrap();
        fs::write(repo.join("README"), "Plain\n").unwrap();
        fs::write(repo.join("README.md"), "# Main\n").unwrap();
        fs::write(repo.join("README.zh-CN.md"), "# Chinese\n").unwrap();
        fs::write(repo.join("docs").join("README.md"), "# Nested\n").unwrap();

        let readmes = read_repo_readmes("repo", &repo).unwrap();
        let paths = readmes.iter().map(|readme| readme.path.as_str()).collect::<Vec<_>>();

        assert_eq!(
            paths,
            vec!["README.md", "readme.markdown", "README", "README.txt", "README.zh-CN.md"],
        );
        assert_eq!(readmes[0].content, "# Main\n");
        assert_eq!(readmes[1].format, "markdown");
        assert_eq!(readmes[2].format, "text");
    }

    #[test]
    fn reads_repo_readme_image_data_urls() {
        let repo = temp_dir("repo-readme-images");
        fs::create_dir_all(repo.join(".github").join("assets")).unwrap();
        fs::write(repo.join(".github").join("assets").join("main-window.png"), [1_u8, 2, 3]).unwrap();
        fs::write(
            repo.join("README.md"),
            "![window](./.github/assets/main-window.png)\n<img src='./.github/assets/main-window.png'>\n",
        )
        .unwrap();

        let readme = read_repo_readme("repo", &repo).unwrap().unwrap();

        assert_eq!(
            readme.images.get("./.github/assets/main-window.png").map(String::as_str),
            Some("data:image/png;base64,AQID"),
        );
    }

    #[test]
    fn managed_repo_ids_are_deduplicated_and_sorted() {
        let mut settings = WorkspaceSettings::default();

        add_managed_repo_id(&mut settings, "z-repo".to_string());
        add_managed_repo_id(&mut settings, "a-repo".to_string());
        add_managed_repo_id(&mut settings, "z-repo".to_string());

        assert_eq!(settings.managed_repo_ids, vec!["a-repo", "z-repo"]);
    }

    #[test]
    fn managed_repo_paths_only_returns_visible_git_repos() {
        let root = temp_dir("managed-repos");
        let visible = root.join("visible");
        let hidden = root.join("hidden");
        let missing = root.join("missing");
        fs::create_dir_all(visible.join(".git")).unwrap();
        fs::create_dir_all(hidden.join(".git")).unwrap();
        let settings = WorkspaceSettings {
            workspace_root: Some(root.to_string_lossy().to_string()),
            hidden_repo_ids: vec!["hidden".to_string()],
            managed_repo_ids: vec![
                "visible".to_string(),
                "hidden".to_string(),
                "missing".to_string(),
            ],
            ..WorkspaceSettings::default()
        };

        let paths = managed_repo_paths(&root, &settings);

        assert_eq!(paths, vec![visible]);
        assert!(!missing.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn lightweight_managed_repos_returns_visible_repo_list_without_git_metadata() {
        let root = temp_dir("lightweight-managed-repos");
        let visible = root.join("visible");
        let hidden = root.join("hidden");
        fs::create_dir_all(visible.join(".git")).unwrap();
        fs::create_dir_all(hidden.join(".git")).unwrap();
        let settings = WorkspaceSettings {
            workspace_root: Some(root.to_string_lossy().to_string()),
            hidden_repo_ids: vec!["hidden".to_string()],
            managed_repo_ids: vec!["visible".to_string(), "hidden".to_string()],
            ..WorkspaceSettings::default()
        };

        let repos = lightweight_managed_repos(&root, &settings);

        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].id, "visible");
        assert_eq!(repos[0].name, "visible");
        assert_eq!(repos[0].current_branch, None);
        assert_eq!(repos[0].remote_url, None);
        assert_eq!(repos[0].github_full_name, None);
        assert_eq!(repos[0].ahead, 0);
        assert_eq!(repos[0].behind, 0);
        assert_eq!(repos[0].staged_count, 0);
        assert_eq!(repos[0].unstaged_count, 0);
        assert_eq!(repos[0].untracked_count, 0);
        assert_eq!(repos[0].conflict_count, 0);
        assert_eq!(repos[0].last_commit_at, None);
        assert_eq!(repos[0].last_commit_message, None);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refresh_managed_repo_remotes_fetches_only_repos_with_origin() {
        let root = temp_dir("managed-fetch");
        let with_origin = root.join("with-origin");
        let local_only = root.join("local-only");
        init_git_repo(&with_origin);
        init_git_repo(&local_only);
        run_git(
            &with_origin,
            &["remote", "add", "origin", "https://github.com/a/repo.git"],
        );
        let paths = vec![with_origin.clone(), local_only];
        let mut fetched = Vec::new();

        let failures = refresh_managed_repo_remotes(&root, &paths, |path| {
            fetched.push(repo_id(&root, path));
            Ok(())
        });

        assert!(failures.is_empty());
        assert_eq!(fetched, vec!["with-origin"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refresh_managed_repo_remotes_keeps_going_after_fetch_failure() {
        let root = temp_dir("managed-fetch-failure");
        let failing = root.join("failing");
        let succeeding = root.join("succeeding");
        init_git_repo(&failing);
        init_git_repo(&succeeding);
        run_git(
            &failing,
            &[
                "remote",
                "add",
                "origin",
                "https://github.com/a/failing.git",
            ],
        );
        run_git(
            &succeeding,
            &[
                "remote",
                "add",
                "origin",
                "https://github.com/a/succeeding.git",
            ],
        );
        let paths = vec![failing.clone(), succeeding.clone()];
        let mut fetched = Vec::new();

        let failures = refresh_managed_repo_remotes(&root, &paths, |path| {
            let id = repo_id(&root, path);
            fetched.push(id.clone());
            if id == "failing" {
                Err("network unavailable".to_string())
            } else {
                Ok(())
            }
        });

        assert_eq!(fetched, vec!["failing", "succeeding"]);
        assert_eq!(
            failures,
            vec![RepoFetchFailure {
                repo_name: "failing".to_string(),
                error: "network unavailable".to_string(),
            }]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn repo_refresh_task_messages_cover_success_and_partial_failure() {
        assert_eq!(
            repo_refresh_success_message(2),
            "已刷新 2 个仓库并同步远端状态"
        );

        let failures = vec![RepoFetchFailure {
            repo_name: "repo".to_string(),
            error: "network unavailable".to_string(),
        }];
        assert_eq!(
            repo_refresh_partial_failure_message(3, &failures),
            "已刷新 3 个仓库，1 个仓库 fetch 失败：repo（network unavailable）"
        );
    }

    #[test]
    fn infers_tauri_dev_script_first() {
        let path = temp_dir("tauri-dev");
        fs::create_dir_all(path.join("src-tauri")).unwrap();
        write_package(
            &path,
            r#"{
              "packageManager": "yarn@4.14.1",
              "scripts": {
                "dev": "vite",
                "tauri:dev": "tauri dev"
              }
            }"#,
        );

        let config = infer_launch_config(&path).unwrap();
        assert_eq!(config.command, "yarn tauri:dev");
        assert_eq!(config.source, "inferred");
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn infers_js_script_by_lockfile_and_priority() {
        let path = temp_dir("js-dev");
        fs::write(path.join("pnpm-lock.yaml"), "").unwrap();
        write_package(
            &path,
            r#"{
              "scripts": {
                "start": "vite --host",
                "serve": "vite preview"
              }
            }"#,
        );

        let config = infer_launch_config(&path).unwrap();
        assert_eq!(config.command, "pnpm start");
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn infers_npm_dev_and_cargo_fallback() {
        let js_path = temp_dir("npm-dev");
        write_package(
            &js_path,
            r#"{
              "scripts": {
                "dev": "vite"
              }
            }"#,
        );
        assert_eq!(
            infer_launch_config(&js_path).unwrap().command,
            "npm run dev"
        );
        fs::remove_dir_all(js_path).unwrap();

        let cargo_path = temp_dir("cargo");
        fs::write(
            cargo_path.join("Cargo.toml"),
            "[package]\nname = \"demo\"\n",
        )
        .unwrap();
        assert_eq!(
            infer_launch_config(&cargo_path).unwrap().command,
            "cargo run"
        );
        fs::remove_dir_all(cargo_path).unwrap();
    }

    #[test]
    fn returns_none_without_known_launch_entrypoint() {
        let path = temp_dir("no-entrypoint");
        assert!(infer_launch_config(&path).is_none());
        fs::remove_dir_all(path).unwrap();
    }
}

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
use reqwest::blocking::{Client, Response};
use reqwest::header::{ACCEPT, USER_AGENT};
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
const GITHUB_SCOPE: &str = "repo workflow read:user";
const GITHUB_SERVICE: &str = "com.lilia.desktop.github";
const GITHUB_ACCEPT: &str = "application/vnd.github+json";
const GITHUB_OAUTH_ACCEPT: &str = "application/json";
const GITHUB_USER_AGENT: &str = "LiliaGithub/0.1";
const LAUNCH_LOG_LIMIT: usize = 500;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSettings {
    pub workspace_root: Option<String>,
    pub github_binding: Option<GitHubBindingMetadata>,
    #[serde(default)]
    pub project_launch_configs: HashMap<String, ProjectLaunchConfig>,
    #[serde(default)]
    pub hidden_repo_ids: Vec<String>,
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

fn launch_runtime() -> &'static Mutex<HashMap<String, LaunchEntry>> {
    static RUNTIME: OnceLock<Mutex<HashMap<String, LaunchEntry>>> = OnceLock::new();
    RUNTIME.get_or_init(|| Mutex::new(HashMap::new()))
}

fn launch_logs() -> &'static Mutex<HashMap<String, VecDeque<ProjectLaunchLog>>> {
    static LOGS: OnceLock<Mutex<HashMap<String, VecDeque<ProjectLaunchLog>>>> = OnceLock::new();
    LOGS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn next_launch_log_index() -> u64 {
    static INDEX: AtomicU64 = AtomicU64::new(1);
    INDEX.fetch_add(1, Ordering::Relaxed)
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
    builder: reqwest::blocking::RequestBuilder,
    token: Option<&str>,
) -> reqwest::blocking::RequestBuilder {
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
    builder: reqwest::blocking::RequestBuilder,
) -> reqwest::blocking::RequestBuilder {
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

fn github_auth_header(token: &str) -> String {
    let encoded = STANDARD.encode(format!("x-access-token:{token}"));
    format!("AUTHORIZATION: basic {encoded}")
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

fn summarize_repo(root: &Path, path: &Path) -> RepoSummary {
    let status = git_command_lossy(path, &["status", "--porcelain=v1", "-b", "--ahead-behind"])
        .unwrap_or_default();
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
        let (index, worktree) = status_pair(line);
        if is_conflict_status(&index, &worktree) {
            conflict_count += 1;
        } else if index == "?" && worktree == "?" {
            untracked_count += 1;
        } else {
            if index != " " {
                staged_count += 1;
            }
            if worktree != " " {
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
    }
}

fn status_pair(line: &str) -> (String, String) {
    let mut chars = line.chars();
    let first = chars.next().unwrap_or(' ');
    let second = chars.next().unwrap_or(' ');
    (first.to_string(), second.to_string())
}

fn parse_status_path(line: &str) -> (Option<String>, String) {
    let raw = line.get(3..).unwrap_or("").trim();
    if let Some((old, new)) = raw.split_once(" -> ") {
        (Some(old.to_string()), new.to_string())
    } else {
        (None, raw.to_string())
    }
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
pub fn workspace_scan_repos(app: AppHandle) -> Result<Vec<RepoSummary>, String> {
    let root = workspace_root(&app)?;
    let settings = load_settings(&app);
    let mut repos = filter_hidden_repos(
        summarize_repos(&root, collect_repos(&root)),
        &settings.hidden_repo_ids,
    );
    repos.sort_by(|a, b| {
        b.last_commit_at
            .cmp(&a.last_commit_at)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(repos)
}

#[tauri::command]
pub fn workspace_clone_repo(
    app: AppHandle,
    remote_url: String,
    directory_name: Option<String>,
) -> Result<RepoSummary, String> {
    let root = workspace_root(&app)?;
    let remote = remote_url.trim();
    if remote.is_empty() {
        return Err("远端 URL 不能为空".to_string());
    }
    let directory = normalize_clone_directory_name(remote, directory_name)?;
    let target = root.join(&directory);
    if target.exists() {
        return Err(format!("目标目录已存在：{}", target.display()));
    }
    if target.parent() != Some(root.as_path()) {
        return Err("目标目录必须位于工作区内".to_string());
    }
    let auth_header = if parse_github_remote(remote).is_some() {
        token_for_binding(&app)?.map(|token| github_auth_header(&token))
    } else {
        None
    };
    git_command(
        &root,
        &["clone", remote, directory.as_str()],
        auth_header.as_deref(),
    )?;
    Ok(summarize_repo(&root, &target))
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
pub fn github_start_device_flow() -> Result<GitHubDeviceFlowStart, String> {
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
}

#[tauri::command]
pub fn github_poll_device_flow(
    app: AppHandle,
    device_code: String,
    interval_seconds: Option<i64>,
) -> Result<GitHubDeviceFlowPollResult, String> {
    let Some(client_id) = client_id() else {
        return Err("GitHub Client ID 未配置".to_string());
    };
    let client = build_client()?;
    let response = github_oauth_headers(client.post("https://github.com/login/oauth/access_token"))
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
}

#[tauri::command]
pub fn github_unbind(app: AppHandle) -> Result<(), String> {
    let mut settings = load_settings(&app);
    settings.github_binding = None;
    save_settings(&app, &settings)
}

#[tauri::command]
pub fn repo_get_summary(app: AppHandle, repo_id: String) -> Result<RepoSummary, String> {
    let root = workspace_root(&app)?;
    let path = repo_path_by_id(&app, &repo_id)?;
    Ok(summarize_repo(&root, &path))
}

#[tauri::command]
pub fn repo_get_changes(app: AppHandle, repo_id: String) -> Result<Vec<RepoChange>, String> {
    let path = repo_path_by_id(&app, &repo_id)?;
    Ok(repo_changes(&path))
}

#[tauri::command]
pub fn repo_get_history(app: AppHandle, repo_id: String) -> Result<Vec<CommitSummary>, String> {
    let path = repo_path_by_id(&app, &repo_id)?;
    Ok(repo_history(&path))
}

#[tauri::command]
pub fn repo_get_commit_detail(
    app: AppHandle,
    repo_id: String,
    hash: String,
) -> Result<CommitDetail, String> {
    let path = repo_path_by_id(&app, &repo_id)?;
    repo_commit_detail(&path, &hash)
}

#[tauri::command]
pub fn repo_get_branches(app: AppHandle, repo_id: String) -> Result<Vec<BranchSummary>, String> {
    let path = repo_path_by_id(&app, &repo_id)?;
    Ok(repo_branches(&path))
}

#[tauri::command]
pub fn repo_get_conflicts(app: AppHandle, repo_id: String) -> Result<RepoConflictState, String> {
    let path = repo_path_by_id(&app, &repo_id)?;
    Ok(repo_conflicts(&path))
}

#[tauri::command]
pub fn repo_get_detail(app: AppHandle, repo_id: String) -> Result<RepoDetail, String> {
    let root = workspace_root(&app)?;
    let path = repo_path_by_id(&app, &repo_id)?;
    let (summary, changes, commits, branches, conflicts) = thread::scope(|scope| {
        let summary = scope.spawn(|| summarize_repo(&root, &path));
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
pub fn repo_stage_files(app: AppHandle, repo_id: String, files: Vec<String>) -> Result<(), String> {
    let path = repo_path_by_id(&app, &repo_id)?;
    for file in files {
        git_command(&path, &["add", "--", &file], None)?;
    }
    Ok(())
}

#[tauri::command]
pub fn repo_unstage_files(
    app: AppHandle,
    repo_id: String,
    files: Vec<String>,
) -> Result<(), String> {
    let path = repo_path_by_id(&app, &repo_id)?;
    for file in files {
        git_command(&path, &["restore", "--staged", "--", &file], None)?;
    }
    Ok(())
}

#[tauri::command]
pub fn repo_commit(
    app: AppHandle,
    repo_id: String,
    files: Vec<String>,
    message: String,
    push_after: bool,
) -> Result<RepoSummary, String> {
    let root = workspace_root(&app)?;
    let path = repo_path_by_id(&app, &repo_id)?;
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("提交说明不能为空".to_string());
    }
    if files.is_empty() {
        return Err("请选择要提交的文件".to_string());
    }
    for file in files {
        git_command(&path, &["add", "--", &file], None)?;
    }
    git_command(&path, &["commit", "-m", trimmed], None)?;
    if push_after {
        run_push(&app, &path)?;
    }
    Ok(summarize_repo(&root, &path))
}

#[tauri::command]
pub fn repo_pull(app: AppHandle, repo_id: String) -> Result<RepoSummary, String> {
    let root = workspace_root(&app)?;
    let path = repo_path_by_id(&app, &repo_id)?;
    let summary = summarize_repo(&root, &path);
    if repo_dirty_count(&summary) > 0 {
        return Err("存在未提交变更，已阻止 pull".to_string());
    }
    run_pull(&app, &path)?;
    Ok(summarize_repo(&root, &path))
}

#[tauri::command]
pub fn repo_merge_pull(app: AppHandle, repo_id: String) -> Result<RepoMergePullResult, String> {
    let root = workspace_root(&app)?;
    let path = repo_path_by_id(&app, &repo_id)?;
    let summary = summarize_repo(&root, &path);
    if let Some(reason) = merge_pull_block_reason(&summary, current_branch_upstream(&path).is_some()) {
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
}

#[tauri::command]
pub fn repo_push(app: AppHandle, repo_id: String) -> Result<RepoSummary, String> {
    let root = workspace_root(&app)?;
    let path = repo_path_by_id(&app, &repo_id)?;
    run_push(&app, &path)?;
    Ok(summarize_repo(&root, &path))
}

#[tauri::command]
pub fn repo_checkout_branch(
    app: AppHandle,
    repo_id: String,
    branch: String,
) -> Result<RepoSummary, String> {
    let root = workspace_root(&app)?;
    let path = repo_path_by_id(&app, &repo_id)?;
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("分支名不能为空".to_string());
    }
    git_command(&path, &["checkout", branch], None)?;
    Ok(summarize_repo(&root, &path))
}

#[tauri::command]
pub fn repo_accept_conflict_file(
    app: AppHandle,
    repo_id: String,
    path: String,
    side: String,
    stage: bool,
) -> Result<RepoSummary, String> {
    let root = workspace_root(&app)?;
    let repo_path = repo_path_by_id(&app, &repo_id)?;
    let checkout_side = conflict_checkout_side(&side)?;
    git_command(&repo_path, &["checkout", checkout_side, "--", &path], None)?;
    if stage {
        git_command(&repo_path, &["add", "--", &path], None)?;
    }
    Ok(summarize_repo(&root, &repo_path))
}

#[tauri::command]
pub fn repo_resolve_conflict_file(
    app: AppHandle,
    repo_id: String,
    path: String,
    choices: Vec<RepoConflictChoice>,
    stage: bool,
) -> Result<RepoSummary, String> {
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
}

#[tauri::command]
pub fn repo_mark_file_resolved(
    app: AppHandle,
    repo_id: String,
    path: String,
) -> Result<RepoSummary, String> {
    let root = workspace_root(&app)?;
    let repo_path = repo_path_by_id(&app, &repo_id)?;
    git_command(&repo_path, &["add", "--", &path], None)?;
    Ok(summarize_repo(&root, &repo_path))
}

#[tauri::command]
pub fn repo_abort_conflict_operation(
    app: AppHandle,
    repo_id: String,
) -> Result<RepoSummary, String> {
    let root = workspace_root(&app)?;
    let repo_path = repo_path_by_id(&app, &repo_id)?;
    let operation = conflict_operation(&repo_path);
    let args = conflict_operation_args(&operation, "终止")?;
    git_command(&repo_path, args, None)?;
    Ok(summarize_repo(&root, &repo_path))
}

#[tauri::command]
pub fn repo_continue_conflict_operation(
    app: AppHandle,
    repo_id: String,
) -> Result<RepoSummary, String> {
    let root = workspace_root(&app)?;
    let repo_path = repo_path_by_id(&app, &repo_id)?;
    let conflicts = repo_conflicts(&repo_path);
    if !conflicts.files.is_empty() {
        return Err("仍有冲突文件未解决".to_string());
    }
    let args = conflict_operation_args(&conflicts.operation, "继续")?;
    git_command(&repo_path, args, None)?;
    Ok(summarize_repo(&root, &repo_path))
}

#[tauri::command]
pub async fn bulk_sync_preview(app: AppHandle, operation: String) -> Result<BulkSyncPreview, String> {
    tokio::task::spawn_blocking(move || {
        let repos = workspace_scan_repos(app)?;
        Ok(build_bulk_preview(operation, repos))
    })
    .await
    .map_err(|e| format!("批量预览后台任务异常：{e}"))?
}

#[tauri::command]
pub async fn bulk_sync_execute(
    app: AppHandle,
    operation: String,
    repo_ids: Vec<String>,
) -> Result<Vec<BulkSyncResult>, String> {
    tokio::task::spawn_blocking(move || {
        let root = workspace_root(&app)?;
        Ok(run_bulk_sync_parallel(repo_ids, |repo_id| {
            bulk_sync_repo(&app, &root, &operation, repo_id)
        }))
    })
    .await
    .map_err(|e| format!("批量同步后台任务异常：{e}"))?
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
    let status = git_command_lossy(path, &["status", "--porcelain=v1"]).unwrap_or_default();
    status
        .lines()
        .filter(|line| line.len() >= 3)
        .filter_map(|line| {
            let (index, worktree) = status_pair(line);
            if !is_conflict_status(&index, &worktree) {
                return None;
            }
            let (_, file_path) = parse_status_path(line);
            Some((format!("{index}{worktree}"), file_path))
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

fn repo_changes(path: &Path) -> Vec<RepoChange> {
    let status = git_command_lossy(path, &["status", "--porcelain=v1"]).unwrap_or_default();
    let entries: Vec<_> = status
        .lines()
        .filter(|line| line.len() >= 3)
        .map(|line| {
            let (index, worktree) = status_pair(line);
            let (old_path, file_path) = parse_status_path(line);
            (index, worktree, old_path, file_path)
        })
        .collect();

    thread::scope(|scope| {
        let handles: Vec<_> = entries
            .into_iter()
            .map(|(index, worktree, old_path, file_path)| {
                scope.spawn(move || {
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
            parse_status_path("R  old.ts -> new.ts"),
            (Some("old.ts".to_string()), "new.ts".to_string())
        );
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
        let dirty_pull_repo = RepoSummary {
            id: "app".to_string(),
            name: "app".to_string(),
            path: "C:/app".to_string(),
            relative_path: "app".to_string(),
            current_branch: Some("main".to_string()),
            remote_url: Some("https://github.com/a/b.git".to_string()),
            github_full_name: Some("a/b".to_string()),
            ahead: 1,
            behind: 2,
            staged_count: 0,
            unstaged_count: 1,
            untracked_count: 0,
            conflict_count: 0,
            last_commit_at: None,
            last_commit_message: None,
        };
        let pull = build_bulk_preview("pull".to_string(), vec![dirty_pull_repo]);
        assert_eq!(pull.blocked.len(), 1);

        let push_repo = RepoSummary {
            id: "push".to_string(),
            name: "push".to_string(),
            path: "C:/push".to_string(),
            relative_path: "push".to_string(),
            current_branch: Some("main".to_string()),
            remote_url: Some("https://github.com/a/b.git".to_string()),
            github_full_name: Some("a/b".to_string()),
            ahead: 1,
            behind: 0,
            staged_count: 0,
            unstaged_count: 1,
            untracked_count: 0,
            conflict_count: 0,
            last_commit_at: None,
            last_commit_message: None,
        };
        let push = build_bulk_push_preview_with_lookup(vec![push_repo], |_| true);
        assert_eq!(push.eligible.len(), 1);
        assert_eq!(push.warnings.len(), 1);
    }

    #[test]
    fn push_preview_blocks_missing_remote_detached_and_behind() {
        let no_remote = RepoSummary {
            id: "no-remote".to_string(),
            name: "no-remote".to_string(),
            path: "C:/no-remote".to_string(),
            relative_path: "no-remote".to_string(),
            current_branch: Some("main".to_string()),
            remote_url: None,
            github_full_name: None,
            ahead: 1,
            behind: 0,
            staged_count: 0,
            unstaged_count: 0,
            untracked_count: 0,
            conflict_count: 0,
            last_commit_at: None,
            last_commit_message: None,
        };
        let detached = RepoSummary {
            id: "detached".to_string(),
            name: "detached".to_string(),
            path: "C:/detached".to_string(),
            relative_path: "detached".to_string(),
            current_branch: None,
            remote_url: Some("https://github.com/a/b.git".to_string()),
            github_full_name: Some("a/b".to_string()),
            ahead: 1,
            behind: 0,
            staged_count: 0,
            unstaged_count: 0,
            untracked_count: 0,
            conflict_count: 0,
            last_commit_at: None,
            last_commit_message: None,
        };
        let behind = RepoSummary {
            id: "behind".to_string(),
            name: "behind".to_string(),
            path: "C:/behind".to_string(),
            relative_path: "behind".to_string(),
            current_branch: Some("main".to_string()),
            remote_url: Some("https://github.com/a/b.git".to_string()),
            github_full_name: Some("a/b".to_string()),
            ahead: 1,
            behind: 2,
            staged_count: 0,
            unstaged_count: 0,
            untracked_count: 0,
            conflict_count: 0,
            last_commit_at: None,
            last_commit_message: None,
        };

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
        let ready = RepoSummary {
            id: "ready".to_string(),
            name: "ready".to_string(),
            path: "C:/ready".to_string(),
            relative_path: "ready".to_string(),
            current_branch: Some("main".to_string()),
            remote_url: Some("https://github.com/a/b.git".to_string()),
            github_full_name: Some("a/b".to_string()),
            ahead: 1,
            behind: 0,
            staged_count: 1,
            unstaged_count: 0,
            untracked_count: 0,
            conflict_count: 0,
            last_commit_at: None,
            last_commit_message: None,
        };
        let idle = RepoSummary {
            id: "idle".to_string(),
            name: "idle".to_string(),
            path: "C:/idle".to_string(),
            relative_path: "idle".to_string(),
            current_branch: Some("main".to_string()),
            remote_url: Some("https://github.com/a/b.git".to_string()),
            github_full_name: Some("a/b".to_string()),
            ahead: 0,
            behind: 0,
            staged_count: 0,
            unstaged_count: 0,
            untracked_count: 0,
            conflict_count: 0,
            last_commit_at: None,
            last_commit_message: None,
        };

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
        let repo = RepoSummary {
            id: "no-upstream".to_string(),
            name: "no-upstream".to_string(),
            path: "C:/no-upstream".to_string(),
            relative_path: "no-upstream".to_string(),
            current_branch: Some("main".to_string()),
            remote_url: Some("https://github.com/a/b.git".to_string()),
            github_full_name: Some("a/b".to_string()),
            ahead: 1,
            behind: 0,
            staged_count: 0,
            unstaged_count: 0,
            untracked_count: 0,
            conflict_count: 0,
            last_commit_at: None,
            last_commit_message: None,
        };

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
        let visible = RepoSummary {
            id: "visible".to_string(),
            name: "visible".to_string(),
            path: "C:/visible".to_string(),
            relative_path: "visible".to_string(),
            current_branch: Some("main".to_string()),
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
        };
        let hidden = RepoSummary {
            id: "hidden".to_string(),
            name: "hidden".to_string(),
            path: "C:/hidden".to_string(),
            relative_path: "hidden".to_string(),
            current_branch: Some("main".to_string()),
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
        };

        let repos = filter_hidden_repos(vec![visible.clone(), hidden], &["hidden".to_string()]);

        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].id, visible.id);
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

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use keyring_core::{Entry, Error as KeyringError};
use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, USER_AGENT};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "lilia-github.json";
const SETTINGS_KEY: &str = "workspace.settings";
const GITHUB_CLIENT_ID: &str = "Ov23liJWTEjz4jgqx19u";
const GITHUB_SCOPE: &str = "repo read:user";
const GITHUB_SERVICE: &str = "com.lilia.desktop.github";
const GITHUB_ACCEPT: &str = "application/vnd.github+json";
const GITHUB_USER_AGENT: &str = "LiliaGithub/0.1";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSettings {
    pub workspace_root: Option<String>,
    pub github_binding: Option<GitHubBindingMetadata>,
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
    pub diff: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub timestamp: i64,
    pub subject: String,
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
struct GitHubUserResponse {
    login: String,
    avatar_url: Option<String>,
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
        if index == "?" && worktree == "?" {
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
    let mut repos: Vec<_> = collect_repos(&root)
        .into_iter()
        .map(|path| summarize_repo(&root, &path))
        .collect();
    repos.sort_by(|a, b| {
        b.last_commit_at
            .cmp(&a.last_commit_at)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(repos)
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
    let response = client
        .post("https://github.com/login/device/code")
        .form(&[("client_id", client_id), ("scope", GITHUB_SCOPE)])
        .send()
        .map_err(|e| format!("启动 GitHub 设备授权失败：{e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "启动 GitHub 设备授权失败：HTTP {}",
            response.status()
        ));
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
    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header(ACCEPT, "application/json")
        .form(&[
            ("client_id", client_id),
            ("device_code", device_code.trim()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .map_err(|e| format!("轮询 GitHub 授权失败：{e}"))?;
    if !response.status().is_success() {
        return Err(format!("轮询 GitHub 授权失败：HTTP {}", response.status()));
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
pub fn repo_get_branches(app: AppHandle, repo_id: String) -> Result<Vec<BranchSummary>, String> {
    let path = repo_path_by_id(&app, &repo_id)?;
    Ok(repo_branches(&path))
}

#[tauri::command]
pub fn repo_get_detail(app: AppHandle, repo_id: String) -> Result<RepoDetail, String> {
    let root = workspace_root(&app)?;
    let path = repo_path_by_id(&app, &repo_id)?;
    Ok(RepoDetail {
        summary: summarize_repo(&root, &path),
        changes: repo_changes(&path),
        commits: repo_history(&path),
        branches: repo_branches(&path),
    })
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
    if summary.staged_count + summary.unstaged_count + summary.untracked_count > 0 {
        return Err("存在未提交变更，已阻止 pull".to_string());
    }
    run_pull(&app, &path)?;
    Ok(summarize_repo(&root, &path))
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
pub fn bulk_sync_preview(app: AppHandle, operation: String) -> Result<BulkSyncPreview, String> {
    let repos = workspace_scan_repos(app)?;
    Ok(build_bulk_preview(operation, repos))
}

#[tauri::command]
pub fn bulk_sync_execute(
    app: AppHandle,
    operation: String,
    repo_ids: Vec<String>,
) -> Result<Vec<BulkSyncResult>, String> {
    let mut results = Vec::new();
    for repo_id in repo_ids {
        let result = match repo_path_by_id(&app, &repo_id) {
            Ok(path) => {
                let root = workspace_root(&app)?;
                let summary = summarize_repo(&root, &path);
                let run = if operation == "pull" {
                    if summary.staged_count + summary.unstaged_count + summary.untracked_count > 0 {
                        Err("存在未提交变更，已跳过 pull".to_string())
                    } else {
                        run_pull(&app, &path)
                    }
                } else {
                    run_push(&app, &path)
                };
                match run {
                    Ok(()) => BulkSyncResult {
                        repo_id,
                        status: "success".to_string(),
                        message: "完成".to_string(),
                    },
                    Err(err) => BulkSyncResult {
                        repo_id,
                        status: "error".to_string(),
                        message: err,
                    },
                }
            }
            Err(err) => BulkSyncResult {
                repo_id,
                status: "error".to_string(),
                message: err,
            },
        };
        results.push(result);
    }
    Ok(results)
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

fn repo_changes(path: &Path) -> Vec<RepoChange> {
    let status = git_command_lossy(path, &["status", "--porcelain=v1"]).unwrap_or_default();
    status
        .lines()
        .filter(|line| line.len() >= 3)
        .map(|line| {
            let (index, worktree) = status_pair(line);
            let (old_path, file_path) = parse_status_path(line);
            let untracked = index == "?" && worktree == "?";
            let staged = !untracked && index != " ";
            let unstaged = !untracked && worktree != " ";
            let diff = if untracked {
                String::new()
            } else if staged {
                git_command_lossy(path, &["diff", "--cached", "--", &file_path]).unwrap_or_default()
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
                diff,
            }
        })
        .collect()
}

fn repo_history(path: &Path) -> Vec<CommitSummary> {
    let output = git_command_lossy(
        path,
        &[
            "log",
            "--max-count=80",
            "--format=%H%x1f%h%x1f%an%x1f%ct%x1f%s",
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
            let timestamp = parts.next()?.parse::<i64>().ok()?;
            let subject = parts.next().unwrap_or("").to_string();
            Some(CommitSummary {
                hash,
                short_hash,
                author,
                timestamp,
                subject,
            })
        })
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

fn run_push(app: &AppHandle, path: &Path) -> Result<(), String> {
    let auth = token_for_binding(app)?.map(|token| github_auth_header(&token));
    git_command(path, &["push"], auth.as_deref()).map(|_| ())
}

fn build_bulk_preview(operation: String, repos: Vec<RepoSummary>) -> BulkSyncPreview {
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
        let dirty = repo.staged_count + repo.unstaged_count + repo.untracked_count;
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
    fn bulk_preview_blocks_dirty_pull_and_allows_push() {
        let repo = RepoSummary {
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
            last_commit_at: None,
            last_commit_message: None,
        };
        let pull = build_bulk_preview("pull".to_string(), vec![repo.clone()]);
        assert_eq!(pull.blocked.len(), 1);
        let push = build_bulk_preview("push".to_string(), vec![repo]);
        assert_eq!(push.eligible.len(), 1);
    }
}

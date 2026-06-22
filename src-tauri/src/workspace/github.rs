use std::io::{Cursor, Read};

use super::*;

pub(super) const GITHUB_CLIENT_ID: &str = "Ov23liJWTEjz4jgqx19u";
pub(super) const GITHUB_SCOPE: &str = "repo workflow read:user delete_repo read:project";
pub(super) const GITHUB_DELETE_REPO_SCOPE: &str = "delete_repo";
pub(super) const GITHUB_READ_PROJECT_SCOPE: &str = "read:project";
pub(super) const GITHUB_SERVICE: &str = "com.lilia.desktop.github";
pub(super) const GITHUB_ACCEPT: &str = "application/vnd.github+json";
pub(super) const GITHUB_OAUTH_ACCEPT: &str = "application/json";
pub(super) const GITHUB_USER_AGENT: &str = "LiliaGithub/0.1";
pub(super) const GITHUB_CONTRIBUTIONS_REPO_LIMIT: usize = 30;
pub(super) const GITHUB_CONTRIBUTION_DAYS: usize = 371;
pub(super) const GITHUB_PROJECT_CACHE_KEY: &str = "workspace.githubProjectCache";
pub(super) const GITHUB_ACTIONS_ARTIFACT_MAX_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) struct DeviceCodeResponse {
    pub(super) device_code: String,
    pub(super) user_code: String,
    pub(super) verification_uri: String,
    pub(super) expires_in: i64,
    pub(super) interval: i64,
}

#[derive(Debug, Deserialize)]
pub(super) struct TokenResponse {
    pub(super) access_token: Option<String>,
    pub(super) scope: Option<String>,
    pub(super) error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubErrorResponse {
    pub(super) error: Option<String>,
    pub(super) error_description: Option<String>,
    pub(super) message: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubUserResponse {
    pub(super) login: String,
    pub(super) avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubRepoOwnerResponse {
    pub(super) login: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubRepoLicenseResponse {
    pub(super) key: String,
    pub(super) name: String,
    pub(super) spdx_id: Option<String>,
    pub(super) url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubRepoResponse {
    pub(super) id: u64,
    pub(super) name: String,
    pub(super) full_name: String,
    pub(super) private: bool,
    #[serde(default)]
    pub(super) disabled: bool,
    #[serde(default)]
    pub(super) archived: bool,
    pub(super) description: Option<String>,
    pub(super) default_branch: Option<String>,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    pub(super) clone_url: String,
    pub(super) html_url: String,
    pub(super) owner: GitHubRepoOwnerResponse,
    #[serde(default)]
    pub(super) homepage: Option<String>,
    #[serde(default)]
    pub(super) has_issues: bool,
    #[serde(default)]
    pub(super) has_wiki: bool,
    #[serde(default)]
    pub(super) has_projects: bool,
    #[serde(default)]
    pub(super) has_discussions: bool,
    #[serde(default)]
    pub(super) allow_merge_commit: bool,
    #[serde(default)]
    pub(super) allow_squash_merge: bool,
    #[serde(default)]
    pub(super) allow_rebase_merge: bool,
    #[serde(default)]
    pub(super) allow_auto_merge: bool,
    #[serde(default)]
    pub(super) delete_branch_on_merge: bool,
    #[serde(default)]
    pub(super) allow_forking: bool,
    #[serde(default)]
    pub(super) web_commit_signoff_required: bool,
    #[serde(default)]
    pub(super) stargazers_count: u64,
    #[serde(default)]
    pub(super) subscribers_count: u64,
    #[serde(default)]
    pub(super) forks_count: u64,
    #[serde(default)]
    pub(super) license: Option<GitHubRepoLicenseResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubRepoTopicsResponse {
    #[serde(default)]
    pub(super) names: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubContentListItem {
    pub(super) name: String,
    pub(super) path: String,
    #[serde(rename = "type")]
    pub(super) kind: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubContentFileResponse {
    pub(super) name: String,
    pub(super) path: String,
    pub(super) encoding: Option<String>,
    pub(super) content: Option<String>,
    #[serde(default)]
    pub(super) size: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubOrgResponse {
    pub(super) login: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubLabelResponse {
    pub(super) name: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubAssigneeResponse {
    pub(super) login: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubIssueMilestoneResponse {
    pub(super) number: u64,
    pub(super) title: String,
    #[serde(default)]
    pub(super) state: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubIssueResponse {
    pub(super) number: u64,
    pub(super) title: String,
    pub(super) state: String,
    pub(super) body: Option<String>,
    pub(super) html_url: String,
    pub(super) updated_at: String,
    pub(super) created_at: String,
    #[serde(default)]
    pub(super) user: Option<GitHubAssigneeResponse>,
    #[serde(default)]
    pub(super) milestone: Option<GitHubIssueMilestoneResponse>,
    #[serde(default)]
    pub(super) comments: u64,
    #[serde(default)]
    pub(super) labels: Vec<GitHubLabelResponse>,
    #[serde(default)]
    pub(super) assignees: Vec<GitHubAssigneeResponse>,
    #[serde(default)]
    pub(super) pull_request: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubIssueSearchResponse {
    #[serde(default)]
    pub(super) items: Vec<GitHubIssueResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubIssueTimelineResponse {
    #[serde(default)]
    pub(super) id: Option<serde_json::Value>,
    #[serde(default)]
    pub(super) node_id: Option<String>,
    #[serde(default)]
    pub(super) event: Option<String>,
    #[serde(default)]
    pub(super) actor: Option<GitHubAssigneeResponse>,
    #[serde(default)]
    pub(super) user: Option<GitHubAssigneeResponse>,
    #[serde(default)]
    pub(super) body: Option<String>,
    #[serde(default)]
    pub(super) html_url: Option<String>,
    #[serde(default)]
    pub(super) created_at: Option<String>,
    #[serde(default)]
    pub(super) updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubGraphQlResponse<T> {
    pub(super) data: Option<T>,
    #[serde(default)]
    pub(super) errors: Vec<GitHubGraphQlError>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubGraphQlError {
    pub(super) message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitHubIssueProjectsGraphQlData {
    pub(super) repository: Option<GitHubIssueProjectsRepository>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubIssueProjectsRepository {
    pub(super) issues: GitHubIssueProjectsConnection,
    #[serde(rename = "pullRequests", default)]
    pub(super) pull_requests: GitHubIssueProjectsConnection,
}

#[derive(Debug, Deserialize, Default)]
pub(super) struct GitHubIssueProjectsConnection {
    #[serde(default)]
    pub(super) nodes: Vec<Option<GitHubIssueProjectsNode>>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubIssueProjectsNode {
    pub(super) number: u64,
    #[serde(rename = "projectItems")]
    pub(super) project_items: GitHubProjectItemsConnection,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubProjectItemsConnection {
    #[serde(default)]
    pub(super) nodes: Vec<Option<GitHubProjectItemNode>>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubProjectItemNode {
    pub(super) project: Option<GitHubProjectItemProject>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubProjectItemProject {
    pub(super) id: String,
    pub(super) title: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubPullRequestUserResponse {
    pub(super) login: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubPullRequestBranchRefResponse {
    #[serde(rename = "ref")]
    pub(super) branch: String,
    #[serde(default)]
    pub(super) sha: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubPullRequestResponse {
    pub(super) number: u64,
    pub(super) title: String,
    pub(super) state: String,
    #[serde(default)]
    pub(super) draft: bool,
    #[serde(default)]
    pub(super) body: Option<String>,
    pub(super) html_url: String,
    pub(super) updated_at: String,
    pub(super) created_at: String,
    #[serde(default)]
    pub(super) user: Option<GitHubPullRequestUserResponse>,
    pub(super) base: GitHubPullRequestBranchRefResponse,
    pub(super) head: GitHubPullRequestBranchRefResponse,
    #[serde(default)]
    pub(super) merged_at: Option<String>,
    #[serde(default)]
    pub(super) mergeable: Option<bool>,
    #[serde(default)]
    pub(super) mergeable_state: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubPullRequestCheckRunsResponse {
    #[serde(default)]
    pub(super) check_runs: Vec<GitHubPullRequestCheckRunResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubPullRequestReviewResponse {
    pub(super) id: u64,
    #[serde(default)]
    pub(super) user: Option<GitHubPullRequestUserResponse>,
    #[serde(default)]
    pub(super) body: Option<String>,
    pub(super) state: String,
    #[serde(default)]
    pub(super) html_url: Option<String>,
    #[serde(default)]
    pub(super) submitted_at: Option<String>,
    #[serde(default)]
    pub(super) commit_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubPullRequestReviewCommentResponse {
    pub(super) id: u64,
    #[serde(default)]
    pub(super) user: Option<GitHubPullRequestUserResponse>,
    #[serde(default)]
    pub(super) body: Option<String>,
    #[serde(default)]
    pub(super) html_url: Option<String>,
    #[serde(default)]
    pub(super) path: Option<String>,
    #[serde(default)]
    pub(super) line: Option<u64>,
    #[serde(default)]
    pub(super) original_line: Option<u64>,
    #[serde(default)]
    pub(super) commit_id: Option<String>,
    pub(super) created_at: String,
    #[serde(default)]
    pub(super) updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubPullRequestCheckRunResponse {
    pub(super) id: u64,
    pub(super) name: String,
    #[serde(default)]
    pub(super) status: Option<String>,
    #[serde(default)]
    pub(super) conclusion: Option<String>,
    #[serde(default)]
    pub(super) details_url: Option<String>,
    #[serde(default)]
    pub(super) html_url: Option<String>,
    #[serde(default)]
    pub(super) started_at: Option<String>,
    #[serde(default)]
    pub(super) completed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubWorkflowRunsResponse {
    #[serde(default)]
    pub(super) workflow_runs: Vec<GitHubWorkflowRunResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubWorkflowResponse {
    pub(super) id: u64,
    #[serde(default)]
    pub(super) path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubWorkflowActorResponse {
    pub(super) login: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubWorkflowRunResponse {
    pub(super) id: u64,
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) display_title: Option<String>,
    #[serde(default)]
    pub(super) status: Option<String>,
    #[serde(default)]
    pub(super) conclusion: Option<String>,
    #[serde(default)]
    pub(super) head_branch: Option<String>,
    #[serde(default)]
    pub(super) event: Option<String>,
    pub(super) html_url: String,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    #[serde(default)]
    pub(super) actor: Option<GitHubWorkflowActorResponse>,
    #[serde(default)]
    pub(super) head_sha: Option<String>,
    #[serde(default)]
    pub(super) run_number: Option<u64>,
    #[serde(default)]
    pub(super) run_attempt: Option<u64>,
    #[serde(default)]
    pub(super) workflow_id: Option<u64>,
    #[serde(default)]
    pub(super) run_started_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubWorkflowJobsResponse {
    #[serde(default)]
    pub(super) jobs: Vec<GitHubWorkflowJobResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubWorkflowJobResponse {
    pub(super) id: u64,
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) status: Option<String>,
    #[serde(default)]
    pub(super) conclusion: Option<String>,
    #[serde(default)]
    pub(super) started_at: Option<String>,
    #[serde(default)]
    pub(super) completed_at: Option<String>,
    #[serde(default)]
    pub(super) html_url: Option<String>,
    #[serde(default)]
    pub(super) runner_name: Option<String>,
    #[serde(default)]
    pub(super) steps: Vec<GitHubWorkflowJobStepResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubWorkflowJobStepResponse {
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) status: Option<String>,
    #[serde(default)]
    pub(super) conclusion: Option<String>,
    #[serde(default)]
    pub(super) number: Option<u64>,
    #[serde(default)]
    pub(super) started_at: Option<String>,
    #[serde(default)]
    pub(super) completed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubWorkflowArtifactsResponse {
    #[serde(default)]
    pub(super) artifacts: Vec<GitHubWorkflowArtifactResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubWorkflowArtifactResponse {
    pub(super) id: u64,
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) size_in_bytes: Option<u64>,
    #[serde(default)]
    pub(super) expired: bool,
    pub(super) created_at: String,
    #[serde(default)]
    pub(super) expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubCommitUserResponse {
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) email: Option<String>,
    #[serde(default)]
    pub(super) date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubCommitPayloadResponse {
    #[serde(default)]
    pub(super) author: Option<GitHubCommitUserResponse>,
    #[serde(default)]
    pub(super) committer: Option<GitHubCommitUserResponse>,
    pub(super) message: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubCommitParentResponse {
    pub(super) sha: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubCommitFileResponse {
    pub(super) filename: String,
    pub(super) status: String,
    #[serde(default)]
    pub(super) previous_filename: Option<String>,
    #[serde(default)]
    pub(super) additions: i32,
    #[serde(default)]
    pub(super) deletions: i32,
    #[serde(default)]
    pub(super) patch: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubCommitResponse {
    pub(super) sha: String,
    pub(super) commit: GitHubCommitPayloadResponse,
    #[serde(default)]
    pub(super) parents: Vec<GitHubCommitParentResponse>,
    #[serde(default)]
    pub(super) files: Vec<GitHubCommitFileResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubBranchResponse {
    pub(super) name: String,
    #[serde(default)]
    pub(super) protected: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct NormalizedGitHubRepo {
    pub(super) owner: String,
    pub(super) name: String,
    pub(super) full_name: String,
    pub(super) clone_url: String,
}

pub(super) struct KeyringGuard;

impl Drop for KeyringGuard {
    fn drop(&mut self) {
        keyring::release_store();
    }
}

pub(super) fn client_id() -> Option<&'static str> {
    let trimmed = GITHUB_CLIENT_ID.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

pub(super) fn client_id_source() -> &'static str {
    if client_id().is_some() {
        "bundled"
    } else {
        "none"
    }
}

pub(super) fn binding_status(binding: Option<GitHubBindingMetadata>) -> GitHubBindingStatus {
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

pub(super) fn build_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| format!("构造 GitHub HTTP 客户端失败：{e}"))
}

pub(super) fn init_keyring() -> Result<KeyringGuard, String> {
    keyring::use_native_store(true).map_err(|e| format!("系统钥匙串不可用：{e}"))?;
    Ok(KeyringGuard)
}

pub(super) fn keyring_entry(login: &str) -> Result<Entry, String> {
    Entry::new(GITHUB_SERVICE, login).map_err(|e| format!("创建 GitHub 凭证项失败：{e}"))
}

pub(super) fn read_token(login: &str) -> Result<Option<String>, String> {
    let _guard = init_keyring()?;
    let entry = keyring_entry(login)?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(format!("读取 GitHub 凭证失败：{err}")),
    }
}

pub(super) fn write_token(login: &str, token: &str) -> Result<(), String> {
    let _guard = init_keyring()?;
    keyring_entry(login)?
        .set_password(token)
        .map_err(|e| format!("保存 GitHub 凭证失败：{e}"))
}

pub(super) fn normalize_scope_list(scope: Option<&str>) -> Vec<String> {
    scope
        .unwrap_or("")
        .split(|ch: char| ch == ',' || ch.is_whitespace())
        .filter(|part| !part.trim().is_empty())
        .map(|part| part.trim().to_string())
        .collect()
}

pub(super) fn github_headers(builder: RequestBuilder, token: Option<&str>) -> RequestBuilder {
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

pub(super) fn github_oauth_headers(builder: RequestBuilder) -> RequestBuilder {
    builder
        .header(USER_AGENT, GITHUB_USER_AGENT)
        .header(ACCEPT, GITHUB_OAUTH_ACCEPT)
}

pub(super) fn github_http_error(prefix: &str, response: Response) -> String {
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

pub(super) fn github_binding_expired_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::UNAUTHORIZED
}

pub(super) fn github_json<T: for<'de> Deserialize<'de>>(
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

pub(super) fn github_graphql_errors_require_read_project(errors: &[GitHubGraphQlError]) -> bool {
    !errors.is_empty()
        && errors.iter().all(|error| {
            let message = error.message.as_str();
            message.contains(GITHUB_READ_PROJECT_SCOPE) && message.contains("scopes")
        })
}

pub(super) fn load_github_project_cache(app: &AppHandle) -> GitHubProjectCache {
    app.store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(GITHUB_PROJECT_CACHE_KEY))
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

pub(super) fn save_github_project_cache(
    app: &AppHandle,
    cache: &GitHubProjectCache,
) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("打开 GitHub 项目缓存失败：{e}"))?;
    store.set(
        GITHUB_PROJECT_CACHE_KEY,
        serde_json::to_value(cache).map_err(|e| e.to_string())?,
    );
    store
        .save()
        .map_err(|e| format!("保存 GitHub 项目缓存失败：{e}"))
}

pub(super) fn github_project_cache_repo_key(repo_full_name: &str) -> Result<String, String> {
    Ok(normalize_github_repo_input(repo_full_name)?
        .full_name
        .to_ascii_lowercase())
}

pub(super) fn github_project_cache_enabled(force_refresh: Option<bool>) -> bool {
    !force_refresh.unwrap_or(false)
}

pub(super) fn update_github_project_repo_cache(
    app: &AppHandle,
    repo_full_name: &str,
    update: impl FnOnce(&mut GitHubProjectRepoCache),
) -> Result<(), String> {
    let key = github_project_cache_repo_key(repo_full_name)?;
    let mut cache = load_github_project_cache(app);
    let repo_cache = cache.repos.entry(key).or_default();
    update(repo_cache);
    save_github_project_cache(app, &cache)
}

pub(super) fn clear_github_project_repo_cache(
    app: &AppHandle,
    repo_full_name: &str,
) -> Result<(), String> {
    let key = github_project_cache_repo_key(repo_full_name)?;
    let mut cache = load_github_project_cache(app);
    cache.repos.remove(&key);
    save_github_project_cache(app, &cache)
}

pub(super) fn clear_github_project_issue_cache(
    app: &AppHandle,
    repo_full_name: &str,
) -> Result<(), String> {
    update_github_project_repo_cache(app, repo_full_name, |repo_cache| {
        repo_cache.issues.clear();
        repo_cache.issue_discussions.clear();
        repo_cache.issue_filter_metadata = None;
    })
}

pub(super) fn clear_github_project_pull_request_cache(
    app: &AppHandle,
    repo_full_name: &str,
) -> Result<(), String> {
    update_github_project_repo_cache(app, repo_full_name, |repo_cache| {
        repo_cache.pull_requests.clear();
        repo_cache.pull_request_discussions.clear();
        repo_cache.pull_request_checks.clear();
    })
}

pub(super) fn github_issue_cache_key(
    state: Option<&str>,
    per_page: Option<u32>,
    sort: Option<&str>,
    direction: Option<&str>,
    since: Option<&str>,
    creator: Option<&str>,
    assignee: Option<&str>,
    labels: Option<&[String]>,
    milestone: Option<&str>,
    project: Option<&str>,
    query: Option<&str>,
) -> String {
    let issue_state = state.unwrap_or("open");
    let issue_per_page = per_page.unwrap_or(100).clamp(1, 100);
    let issue_sort = match sort {
        Some("updated") => "updated",
        Some("comments") => "comments",
        _ => "created",
    };
    let issue_direction = match direction {
        Some("asc") => "asc",
        _ => "desc",
    };
    let issue_since = since
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let issue_creator = creator
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let issue_assignee = assignee
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let mut issue_labels = labels
        .unwrap_or(&[])
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    issue_labels.sort();
    let issue_milestone = milestone
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let issue_project = project
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let issue_query = query
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    serde_json::json!({
        "state": issue_state,
        "perPage": issue_per_page,
        "sort": issue_sort,
        "direction": issue_direction,
        "since": issue_since,
        "creator": issue_creator,
        "assignee": issue_assignee,
        "labels": issue_labels,
        "milestone": issue_milestone,
        "project": issue_project,
        "query": issue_query,
    })
    .to_string()
}

pub(super) fn github_pull_request_cache_key(
    state: Option<&str>,
    per_page: Option<u32>,
    sort: Option<&str>,
    direction: Option<&str>,
    creator: Option<&str>,
    assignee: Option<&str>,
    labels: Option<&[String]>,
    milestone: Option<&str>,
    project: Option<&str>,
    review: Option<&str>,
    query: Option<&str>,
) -> String {
    let pull_state = match state {
        Some("closed") => "closed",
        Some("merged") => "merged",
        Some("all") => "all",
        _ => "open",
    };
    let pull_per_page = per_page.unwrap_or(100).clamp(1, 100);
    let pull_sort = match sort {
        Some("created") => "created",
        Some("comments") => "comments",
        _ => "updated",
    };
    let pull_direction = match direction {
        Some("asc") => "asc",
        _ => "desc",
    };
    let pull_creator = creator
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let pull_assignee = assignee
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let mut pull_labels = labels
        .unwrap_or(&[])
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    pull_labels.sort();
    let pull_milestone = milestone
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let pull_project = project
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let pull_review = review
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let pull_query = query
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    serde_json::json!({
        "state": pull_state,
        "perPage": pull_per_page,
        "sort": pull_sort,
        "direction": pull_direction,
        "creator": pull_creator,
        "assignee": pull_assignee,
        "labels": pull_labels,
        "milestone": pull_milestone,
        "project": pull_project,
        "review": pull_review,
        "query": pull_query,
    })
    .to_string()
}

pub(super) fn github_workflow_runs_cache_key(per_page: Option<u32>) -> String {
    per_page.unwrap_or(30).clamp(1, 100).to_string()
}

pub(super) fn github_commit_list_cache_key(per_page: Option<u32>, sha: Option<&str>) -> String {
    let commit_per_page = per_page.unwrap_or(100).clamp(1, 100);
    let commit_sha = sha
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    format!("{commit_per_page}|{commit_sha}")
}

pub(super) fn github_require_token(
    app: &AppHandle,
) -> Result<(GitHubBindingMetadata, String), String> {
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

pub(super) fn github_binding_has_scope(binding: &GitHubBindingMetadata, scope: &str) -> bool {
    binding.scopes.iter().any(|item| item == scope)
}

pub(super) fn github_require_scope(
    binding: &GitHubBindingMetadata,
    scope: &str,
) -> Result<(), String> {
    if github_binding_has_scope(binding, scope) {
        return Ok(());
    }
    Err(format!(
        "GitHub 绑定缺少 {scope} 权限，请重新绑定 GitHub 后再试"
    ))
}

pub(super) fn github_send(
    app: &AppHandle,
    prefix: &str,
    builder: RequestBuilder,
) -> Result<Response, String> {
    let response = builder
        .send()
        .map_err(|e| format!("{prefix}：GitHub API 连接失败，请检查网络、代理或系统证书：{e}"))?;
    if github_binding_expired_status(response.status()) {
        let mut settings = load_settings(app);
        settings.github_binding = None;
        save_settings(app, &settings)?;
        return Err("GitHub 绑定已失效，请重新绑定".to_string());
    }
    Ok(response)
}

pub(super) fn github_repo_summary_from_response(repo: GitHubRepoResponse) -> GitHubRepoSummary {
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

pub(super) fn normalize_remote_repo_shortcut(
    mut shortcut: RemoteRepoShortcut,
) -> Result<RemoteRepoShortcut, String> {
    let repo = normalize_github_repo_input(&shortcut.full_name)?;
    shortcut.full_name = repo.full_name;
    shortcut.name =
        normalize_optional_string(Some(shortcut.name)).unwrap_or_else(|| repo.name.clone());
    shortcut.default_branch = normalize_optional_string(shortcut.default_branch);
    shortcut.html_url = normalize_optional_string(Some(shortcut.html_url))
        .unwrap_or_else(|| format!("https://github.com/{}", shortcut.full_name));
    shortcut.clone_url =
        normalize_optional_string(Some(shortcut.clone_url)).unwrap_or(repo.clone_url);
    shortcut.opened_at = now_millis();
    Ok(shortcut)
}

pub(super) fn remember_remote_repo_shortcut(
    shortcuts: &mut Vec<RemoteRepoShortcut>,
    shortcut: RemoteRepoShortcut,
) -> Result<(), String> {
    let shortcut = normalize_remote_repo_shortcut(shortcut)?;
    let target = normalize_github_repo_input(&shortcut.full_name)?.full_name;
    shortcuts.retain(|item| {
        normalize_github_repo_input(&item.full_name)
            .map(|repo| !repo.full_name.eq_ignore_ascii_case(&target))
            .unwrap_or(true)
    });
    shortcuts.push(shortcut);
    shortcuts.sort_by(|a, b| {
        b.opened_at
            .cmp(&a.opened_at)
            .then_with(|| a.full_name.cmp(&b.full_name))
    });
    Ok(())
}

pub(super) fn forget_remote_repo_shortcut(
    shortcuts: &mut Vec<RemoteRepoShortcut>,
    full_name: &str,
) -> Result<(), String> {
    let repo = normalize_github_repo_input(full_name)?;
    let target = repo.full_name;
    shortcuts.retain(|item| {
        normalize_github_repo_input(&item.full_name)
            .map(|current| !current.full_name.eq_ignore_ascii_case(&target))
            .unwrap_or(true)
    });
    Ok(())
}

pub(super) fn github_repo_management_from_response(
    repo: GitHubRepoResponse,
    topics: Vec<String>,
) -> GitHubRepoManagement {
    GitHubRepoManagement {
        full_name: repo.full_name,
        name: repo.name,
        description: repo.description,
        homepage: repo.homepage,
        topics,
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
        stargazers_count: repo.stargazers_count,
        watchers_count: repo.subscribers_count,
        forks_count: repo.forks_count,
        html_url: repo.html_url,
        license: repo.license.map(|license| GitHubRepoLicense {
            key: license.key,
            name: license.name,
            spdx_id: license.spdx_id,
            url: license.url,
        }),
    }
}

pub(super) fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn github_repo_api_url(repo_full_name: &str) -> Result<String, String> {
    let repo = normalize_github_repo_input(repo_full_name)?;
    Ok(format!(
        "https://api.github.com/repos/{}",
        github_api_repo_path(&repo.full_name)
    ))
}

pub(super) fn normalize_github_content_path(path: Option<&str>) -> Result<String, String> {
    let Some(path) = path else {
        return Ok(String::new());
    };
    let trimmed = path.trim().trim_matches('/');
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if trimmed.contains('\\') {
        return Err("GitHub 文件路径必须使用 / 分隔".to_string());
    }
    let parts = trimmed.split('/').collect::<Vec<_>>();
    if parts
        .iter()
        .any(|part| part.is_empty() || *part == "." || *part == "..")
    {
        return Err("GitHub 文件路径不能包含 . 或 ..".to_string());
    }
    Ok(parts.join("/"))
}

pub(super) fn normalize_github_ref_name(ref_name: Option<&str>) -> Option<String> {
    ref_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(super) fn github_repo_contents_api_url(
    repo_full_name: &str,
    path: Option<&str>,
) -> Result<String, String> {
    let path = normalize_github_content_path(path)?;
    let base = format!("{}/contents", github_repo_api_url(repo_full_name)?);
    if path.is_empty() {
        Ok(base)
    } else {
        Ok(format!("{base}/{}", github_api_repo_path(&path)))
    }
}

pub(super) fn sort_repo_file_tree_entries(entries: &mut [RepoFileTreeEntry]) {
    entries.sort_by(|left, right| {
        let left_kind = left.kind == "dir";
        let right_kind = right.kind == "dir";
        right_kind
            .cmp(&left_kind)
            .then_with(|| {
                left.name
                    .to_ascii_lowercase()
                    .cmp(&right.name.to_ascii_lowercase())
            })
            .then_with(|| left.name.cmp(&right.name))
    });
}

pub(super) fn github_content_items_to_file_entries(
    items: Vec<GitHubContentListItem>,
) -> Vec<RepoFileTreeEntry> {
    let mut entries = items
        .into_iter()
        .filter_map(|item| {
            let kind = match item.kind.as_str() {
                "dir" => "dir",
                "file" | "symlink" => "file",
                _ => return None,
            };
            Some(RepoFileTreeEntry {
                path: item.path,
                name: item.name,
                kind: kind.to_string(),
                has_children: kind == "dir",
            })
        })
        .collect::<Vec<_>>();
    sort_repo_file_tree_entries(&mut entries);
    entries
}

pub(super) fn is_markdown_preview_path(path: &str) -> bool {
    matches!(
        Path::new(path)
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase()),
        Some(extension) if extension == "md" || extension == "markdown"
    )
}

pub(super) fn decode_github_preview_bytes(
    prefix: &str,
    file: &GitHubContentFileResponse,
) -> Result<Vec<u8>, String> {
    let encoding = file.encoding.as_deref().unwrap_or_default();
    if encoding.to_ascii_lowercase() != "base64" {
        return Err(format!("{prefix}：不支持的文件编码：{encoding}"));
    }
    let encoded = file
        .content
        .as_deref()
        .unwrap_or_default()
        .chars()
        .filter(|value| !value.is_whitespace())
        .collect::<String>();
    STANDARD
        .decode(encoded)
        .map_err(|e| format!("{prefix}：文件解码失败：{e}"))
}

pub(super) fn github_text_content_from_file(
    prefix: &str,
    file: GitHubContentFileResponse,
) -> Result<String, String> {
    let bytes = decode_github_preview_bytes(prefix, &file)?;
    String::from_utf8(bytes).map_err(|e| format!("{prefix}：文件不是 UTF-8 文本：{e}"))
}

pub(super) fn github_file_preview_from_content(
    prefix: &str,
    file: GitHubContentFileResponse,
) -> Result<RepoFilePreview, String> {
    let declared_size = file.size;
    let path = file.path.clone();
    let name = file.name.clone();
    let mime = super::file_browser::file_preview_mime(Path::new(&path)).map(str::to_string);
    if declared_size.unwrap_or_default() > super::file_browser::MAX_FILE_PREVIEW_BYTES {
        return Ok(RepoFilePreview {
            path,
            name,
            preview_kind: "tooLarge".to_string(),
            content: None,
            data_url: None,
            images: HashMap::new(),
            size: declared_size.unwrap_or_default(),
            mime_type: mime,
            truncated: false,
        });
    }

    let bytes = decode_github_preview_bytes(prefix, &file)?;
    let size = declared_size.unwrap_or(bytes.len() as u64);
    if is_markdown_preview_path(&path) {
        let content = String::from_utf8(bytes)
            .map_err(|e| format!("{prefix}：Markdown 文件不是 UTF-8 文本：{e}"))?;
        return Ok(RepoFilePreview {
            path,
            name,
            preview_kind: "markdown".to_string(),
            content: Some(content),
            data_url: None,
            images: HashMap::new(),
            size,
            mime_type: Some("text/markdown".to_string()),
            truncated: false,
        });
    }

    if let Some(image_mime) = image_mime_for_path(Path::new(&path)) {
        return Ok(RepoFilePreview {
            path,
            name,
            preview_kind: "image".to_string(),
            content: None,
            data_url: Some(format!(
                "data:{image_mime};base64,{}",
                STANDARD.encode(bytes)
            )),
            images: HashMap::new(),
            size,
            mime_type: Some(image_mime.to_string()),
            truncated: false,
        });
    }

    if let Ok(content) = String::from_utf8(bytes) {
        if !content.contains('\0') {
            return Ok(RepoFilePreview {
                path,
                name,
                preview_kind: "text".to_string(),
                content: Some(content),
                data_url: None,
                images: HashMap::new(),
                size,
                mime_type: mime.or_else(|| Some("text/plain".to_string())),
                truncated: false,
            });
        }
    }

    Ok(RepoFilePreview {
        path,
        name,
        preview_kind: "binary".to_string(),
        content: None,
        data_url: None,
        images: HashMap::new(),
        size,
        mime_type: mime,
        truncated: false,
    })
}

pub(super) fn github_repo_topics_api_url(repo_full_name: &str) -> Result<String, String> {
    Ok(format!("{}/topics", github_repo_api_url(repo_full_name)?))
}

pub(super) fn normalize_github_topics(topics: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for topic in topics {
        let topic = topic.trim().trim_start_matches('#').to_ascii_lowercase();
        if topic.is_empty() || normalized.iter().any(|item| item == &topic) {
            continue;
        }
        normalized.push(topic);
    }
    normalized
}

pub(super) fn github_fetch_pull_request_response(
    app: &AppHandle,
    repo_full_name: &str,
    pull_number: u64,
    token: &str,
    prefix: &str,
) -> Result<GitHubPullRequestResponse, String> {
    let client = build_client()?;
    let response = github_send(
        app,
        prefix,
        github_headers(
            client.get(format!(
                "{}/pulls/{pull_number}",
                github_repo_api_url(repo_full_name)?
            )),
            Some(token),
        ),
    )?;
    github_json::<GitHubPullRequestResponse>(prefix, response)
}

pub(super) fn github_fetch_issue_response(
    app: &AppHandle,
    repo_full_name: &str,
    issue_number: u64,
    token: &str,
    prefix: &str,
) -> Result<GitHubIssueResponse, String> {
    let client = build_client()?;
    let response = github_send(
        app,
        prefix,
        github_headers(
            client.get(format!(
                "{}/issues/{issue_number}",
                github_repo_api_url(repo_full_name)?
            )),
            Some(token),
        ),
    )?;
    github_json::<GitHubIssueResponse>(prefix, response)
}

pub(super) fn github_fetch_paginated<T>(
    app: &AppHandle,
    client: &Client,
    token: &str,
    url: String,
    prefix: &str,
) -> Result<Vec<T>, String>
where
    T: serde::de::DeserializeOwned,
{
    let mut page = 1_u32;
    let mut items = Vec::new();
    loop {
        let page_string = page.to_string();
        let response = github_send(
            app,
            prefix,
            github_headers(
                client
                    .get(&url)
                    .query(&[("per_page", "100"), ("page", page_string.as_str())]),
                Some(token),
            ),
        )?;
        let next_page = parse_next_page(
            response
                .headers()
                .get(LINK)
                .and_then(|value| value.to_str().ok()),
        );
        items.extend(github_json::<Vec<T>>(prefix, response)?);
        if let Some(next) = next_page {
            page = next;
        } else {
            break;
        }
    }
    Ok(items)
}

pub(super) fn github_update_repo_settings_payload(
    request: &GitHubUpdateRepoSettingsRequest,
) -> serde_json::Map<String, serde_json::Value> {
    let mut payload = serde_json::Map::new();
    if let Some(value) = request.description.clone() {
        payload.insert("description".to_string(), serde_json::Value::String(value));
    }
    if let Some(value) = request.homepage.clone() {
        payload.insert("homepage".to_string(), serde_json::Value::String(value));
    }
    if let Some(value) = request.private {
        payload.insert("private".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = normalize_optional_string(request.default_branch.clone()) {
        payload.insert(
            "default_branch".to_string(),
            serde_json::Value::String(value),
        );
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
        payload.insert(
            "has_discussions".to_string(),
            serde_json::Value::Bool(value),
        );
    }
    if let Some(value) = request.allow_merge_commit {
        payload.insert(
            "allow_merge_commit".to_string(),
            serde_json::Value::Bool(value),
        );
    }
    if let Some(value) = request.allow_squash_merge {
        payload.insert(
            "allow_squash_merge".to_string(),
            serde_json::Value::Bool(value),
        );
    }
    if let Some(value) = request.allow_rebase_merge {
        payload.insert(
            "allow_rebase_merge".to_string(),
            serde_json::Value::Bool(value),
        );
    }
    if let Some(value) = request.allow_auto_merge {
        payload.insert(
            "allow_auto_merge".to_string(),
            serde_json::Value::Bool(value),
        );
    }
    if let Some(value) = request.delete_branch_on_merge {
        payload.insert(
            "delete_branch_on_merge".to_string(),
            serde_json::Value::Bool(value),
        );
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

pub(super) fn github_issue_from_response(issue: GitHubIssueResponse) -> Option<GitHubIssue> {
    if issue.pull_request.is_some() {
        return None;
    }
    Some(github_issue_like_from_response(issue))
}

fn github_pull_request_issue_from_response(issue: GitHubIssueResponse) -> Option<GitHubIssue> {
    if issue.pull_request.is_none() {
        return None;
    }
    Some(github_issue_like_from_response(issue))
}

fn github_issue_like_from_response(issue: GitHubIssueResponse) -> GitHubIssue {
    GitHubIssue {
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
        author: issue.user.map(|user| user.login),
        milestone: issue.milestone.map(|milestone| GitHubIssueMilestone {
            number: milestone.number,
            title: milestone.title,
            state: normalize_optional_string(milestone.state),
        }),
        comments: issue.comments,
        project_items: Vec::new(),
        html_url: issue.html_url,
        updated_at: issue.updated_at,
        created_at: issue.created_at,
    }
}

pub(super) fn github_pull_request_from_response(
    pull_request: GitHubPullRequestResponse,
) -> GitHubPullRequest {
    GitHubPullRequest {
        number: pull_request.number,
        title: pull_request.title,
        state: pull_request.state,
        draft: pull_request.draft,
        body: pull_request.body,
        labels: Vec::new(),
        assignees: Vec::new(),
        milestone: None,
        comments: 0,
        project_items: Vec::new(),
        html_url: pull_request.html_url,
        updated_at: pull_request.updated_at,
        created_at: pull_request.created_at,
        author: pull_request
            .user
            .map(|user| user.login)
            .unwrap_or_else(|| "unknown".to_string()),
        base_branch: pull_request.base.branch,
        head_branch: pull_request.head.branch,
        merged: pull_request.merged_at.is_some(),
        mergeable: pull_request.mergeable,
        mergeable_state: normalize_optional_string(pull_request.mergeable_state),
    }
}

fn github_pull_request_with_issue_metadata(
    mut pull_request: GitHubPullRequest,
    issue: GitHubIssue,
) -> GitHubPullRequest {
    pull_request.labels = issue.labels;
    pull_request.assignees = issue.assignees;
    pull_request.milestone = issue.milestone;
    pull_request.comments = issue.comments;
    pull_request.project_items = issue.project_items;
    pull_request
}

pub(super) fn github_pull_request_check_from_response(
    check: GitHubPullRequestCheckRunResponse,
) -> GitHubPullRequestCheck {
    GitHubPullRequestCheck {
        id: check.id,
        name: check.name,
        status: normalize_optional_string(check.status).unwrap_or_else(|| "queued".to_string()),
        conclusion: normalize_optional_string(check.conclusion),
        details_url: normalize_optional_string(check.details_url.clone()),
        html_url: normalize_optional_string(check.html_url).or(check.details_url),
        started_at: normalize_optional_string(check.started_at),
        completed_at: normalize_optional_string(check.completed_at),
    }
}

fn github_json_id(value: Option<serde_json::Value>, fallback: &str) -> String {
    match value {
        Some(serde_json::Value::Number(number)) => number.to_string(),
        Some(serde_json::Value::String(value)) if !value.trim().is_empty() => value,
        _ => fallback.to_string(),
    }
}

fn github_timeline_item_from_issue(issue: &GitHubIssue) -> GitHubDiscussionTimelineItem {
    GitHubDiscussionTimelineItem {
        id: format!("issue-{}-body", issue.number),
        kind: "body".to_string(),
        actor: issue.author.clone(),
        body: issue.body.clone(),
        url: Some(issue.html_url.clone()),
        event: None,
        state: None,
        title: None,
        path: None,
        line: None,
        original_line: None,
        commit_id: None,
        created_at: issue.created_at.clone(),
        updated_at: Some(issue.updated_at.clone()),
    }
}

fn github_timeline_item_from_pull_request(
    pull_request: &GitHubPullRequest,
) -> GitHubDiscussionTimelineItem {
    GitHubDiscussionTimelineItem {
        id: format!("pull-{}-body", pull_request.number),
        kind: "body".to_string(),
        actor: Some(pull_request.author.clone()),
        body: pull_request.body.clone(),
        url: Some(pull_request.html_url.clone()),
        event: None,
        state: None,
        title: None,
        path: None,
        line: None,
        original_line: None,
        commit_id: None,
        created_at: pull_request.created_at.clone(),
        updated_at: Some(pull_request.updated_at.clone()),
    }
}

pub(super) fn github_timeline_item_from_response(
    item: GitHubIssueTimelineResponse,
) -> GitHubDiscussionTimelineItem {
    let is_comment = item
        .body
        .as_ref()
        .is_some_and(|body| !body.trim().is_empty());
    let event = normalize_optional_string(item.event);
    let id = item
        .node_id
        .clone()
        .unwrap_or_else(|| github_json_id(item.id, event.as_deref().unwrap_or("timeline")));
    let actor = item.actor.or(item.user).map(|user| user.login);
    let created_at = item
        .created_at
        .clone()
        .or_else(|| item.updated_at.clone())
        .unwrap_or_default();
    GitHubDiscussionTimelineItem {
        id,
        kind: if is_comment { "comment" } else { "event" }.to_string(),
        actor,
        body: normalize_optional_string(item.body),
        url: normalize_optional_string(item.html_url),
        event: event.clone(),
        state: None,
        title: event.map(|value| github_timeline_event_title(&value)),
        path: None,
        line: None,
        original_line: None,
        commit_id: None,
        created_at,
        updated_at: normalize_optional_string(item.updated_at),
    }
}

pub(super) fn github_review_timeline_item_from_response(
    review: GitHubPullRequestReviewResponse,
) -> GitHubDiscussionTimelineItem {
    let created_at = review.submitted_at.clone().unwrap_or_default();
    GitHubDiscussionTimelineItem {
        id: format!("review-{}", review.id),
        kind: "review".to_string(),
        actor: review.user.map(|user| user.login),
        body: normalize_optional_string(review.body),
        url: normalize_optional_string(review.html_url),
        event: None,
        state: Some(review.state),
        title: None,
        path: None,
        line: None,
        original_line: None,
        commit_id: normalize_optional_string(review.commit_id),
        created_at,
        updated_at: review.submitted_at,
    }
}

pub(super) fn github_review_comment_timeline_item_from_response(
    comment: GitHubPullRequestReviewCommentResponse,
) -> GitHubDiscussionTimelineItem {
    GitHubDiscussionTimelineItem {
        id: format!("review-comment-{}", comment.id),
        kind: "reviewComment".to_string(),
        actor: comment.user.map(|user| user.login),
        body: normalize_optional_string(comment.body),
        url: normalize_optional_string(comment.html_url),
        event: None,
        state: None,
        title: None,
        path: normalize_optional_string(comment.path),
        line: comment.line,
        original_line: comment.original_line,
        commit_id: normalize_optional_string(comment.commit_id),
        created_at: comment.created_at,
        updated_at: normalize_optional_string(comment.updated_at),
    }
}

fn github_timeline_event_title(event: &str) -> String {
    let title = match event {
        "closed" => "关闭了讨论",
        "reopened" => "重新打开讨论",
        "merged" => "合并了 Pull Request",
        "labeled" => "添加了标签",
        "unlabeled" => "移除了标签",
        "assigned" => "分配了负责人",
        "unassigned" => "移除了负责人",
        "milestoned" => "设置了里程碑",
        "demilestoned" => "移除了里程碑",
        "renamed" => "修改了标题",
        "review_requested" => "请求了 Review",
        "review_request_removed" => "移除了 Review 请求",
        "ready_for_review" => "标记为 ready for review",
        "converted_to_draft" => "转换为草稿",
        "referenced" => "引用了该讨论",
        "cross-referenced" => "交叉引用了该讨论",
        "commented" => "发表了评论",
        value => return value.replace('_', " ").replace('-', " "),
    };
    title.to_string()
}

pub(super) fn sort_github_discussion_timeline(items: &mut [GitHubDiscussionTimelineItem]) {
    items.sort_by(|left, right| {
        let left_time = parse_github_datetime(&left.created_at).unwrap_or(0);
        let right_time = parse_github_datetime(&right.created_at).unwrap_or(0);
        left_time
            .cmp(&right_time)
            .then_with(|| left.id.cmp(&right.id))
    });
}

pub(super) fn github_issue_labels_param(labels: Option<Vec<String>>) -> Option<String> {
    let labels = labels?
        .into_iter()
        .map(|label| label.trim().to_string())
        .filter(|label| !label.is_empty())
        .collect::<Vec<_>>();
    if labels.is_empty() {
        None
    } else {
        Some(labels.join(","))
    }
}

pub(super) fn github_issue_milestone_param(value: Option<serde_json::Value>) -> Option<String> {
    match value? {
        serde_json::Value::Number(number) => number.as_u64().map(|value| value.to_string()),
        serde_json::Value::String(value) => normalize_optional_string(Some(value)),
        _ => None,
    }
}

fn github_search_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn github_search_qualifier(name: &str, value: &str) -> String {
    if value.chars().any(char::is_whitespace) {
        format!("{name}:\"{}\"", github_search_escape(value))
    } else {
        format!("{name}:{value}")
    }
}

fn github_issue_search_query(
    repo_full_name: &str,
    state: &str,
    text: &str,
    since: Option<&str>,
    creator: Option<&str>,
    assignee: Option<&str>,
    labels: Option<&[String]>,
    milestone: Option<&str>,
) -> String {
    let mut parts = vec![
        github_search_qualifier("repo", repo_full_name),
        "is:issue".to_string(),
    ];
    let text = text.trim();
    if !text.is_empty() {
        parts.push(text.to_string());
    }
    if state == "open" || state == "closed" {
        parts.push(github_search_qualifier("state", state));
    }
    if let Some(value) = since.map(str::trim).filter(|value| !value.is_empty()) {
        parts.push(format!("updated:>={value}"));
    }
    if let Some(value) = creator.map(str::trim).filter(|value| !value.is_empty()) {
        parts.push(github_search_qualifier("author", value));
    }
    if let Some(value) = assignee.map(str::trim).filter(|value| !value.is_empty()) {
        if value == "none" {
            parts.push("no:assignee".to_string());
        } else {
            parts.push(github_search_qualifier("assignee", value));
        }
    }
    for label in labels
        .unwrap_or(&[])
        .iter()
        .map(|label| label.trim())
        .filter(|label| !label.is_empty())
    {
        parts.push(github_search_qualifier("label", label));
    }
    if let Some(value) = milestone.map(str::trim).filter(|value| !value.is_empty()) {
        if value == "none" {
            parts.push("no:milestone".to_string());
        } else {
            parts.push(github_search_qualifier("milestone", value));
        }
    }
    parts.join(" ")
}

pub(super) fn github_pull_request_search_query(
    repo_full_name: &str,
    state: &str,
    text: &str,
    creator: Option<&str>,
    assignee: Option<&str>,
    labels: Option<&[String]>,
    milestone: Option<&str>,
    review: Option<&str>,
) -> String {
    let mut parts = vec![
        github_search_qualifier("repo", repo_full_name),
        "is:pr".to_string(),
    ];
    let text = text.trim();
    if !text.is_empty() {
        parts.push(text.to_string());
    }
    match state {
        "merged" => parts.push("is:merged".to_string()),
        "closed" => {
            parts.push(github_search_qualifier("state", "closed"));
            parts.push("-is:merged".to_string());
        }
        "all" => {}
        _ => parts.push(github_search_qualifier("state", "open")),
    }
    if let Some(value) = creator.map(str::trim).filter(|value| !value.is_empty()) {
        parts.push(github_search_qualifier("author", value));
    }
    if let Some(value) = assignee.map(str::trim).filter(|value| !value.is_empty()) {
        if value == "none" {
            parts.push("no:assignee".to_string());
        } else {
            parts.push(github_search_qualifier("assignee", value));
        }
    }
    for label in labels
        .unwrap_or(&[])
        .iter()
        .map(|label| label.trim())
        .filter(|label| !label.is_empty())
    {
        parts.push(github_search_qualifier("label", label));
    }
    if let Some(value) = milestone.map(str::trim).filter(|value| !value.is_empty()) {
        if value == "none" {
            parts.push("no:milestone".to_string());
        } else {
            parts.push(github_search_qualifier("milestone", value));
        }
    }
    if let Some(value) = review.map(str::trim).filter(|value| !value.is_empty()) {
        parts.push(github_search_qualifier("review", value));
    }
    parts.join(" ")
}

pub(super) fn github_issue_project_items_from_graphql(
    data: GitHubIssueProjectsGraphQlData,
) -> std::collections::HashMap<u64, Vec<GitHubIssueProjectItem>> {
    let mut map = std::collections::HashMap::new();
    let Some(repository) = data.repository else {
        return map;
    };
    for issue in repository
        .issues
        .nodes
        .into_iter()
        .chain(repository.pull_requests.nodes.into_iter())
        .flatten()
    {
        let projects = issue
            .project_items
            .nodes
            .into_iter()
            .flatten()
            .filter_map(|item| {
                let project = item.project?;
                Some(GitHubIssueProjectItem {
                    id: project.id,
                    title: project.title,
                })
            })
            .collect::<Vec<_>>();
        map.insert(issue.number, projects);
    }
    map
}

pub(super) fn fetch_github_issue_project_items(
    app: &AppHandle,
    repo_full_name: &str,
    binding: &GitHubBindingMetadata,
    token: &str,
) -> Result<std::collections::HashMap<u64, Vec<GitHubIssueProjectItem>>, String> {
    if !github_binding_has_scope(binding, GITHUB_READ_PROJECT_SCOPE) {
        return Ok(std::collections::HashMap::new());
    }
    let repo = normalize_github_repo_input(repo_full_name)?;
    let client = build_client()?;
    let query = r#"
      query RepoIssueProjects($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          issues(first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes {
              number
              projectItems(first: 20) {
                nodes {
                  id
                  project {
                    id
                    title
                  }
                }
              }
            }
          }
          pullRequests(first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes {
              number
              projectItems(first: 20) {
                nodes {
                  id
                  project {
                    id
                    title
                  }
                }
              }
            }
          }
        }
      }
    "#;
    let response = github_send(
        app,
        "读取 GitHub Issue Projects 失败",
        github_headers(
            client
                .post("https://api.github.com/graphql")
                .json(&serde_json::json!({
                    "query": query,
                    "variables": {
                        "owner": repo.owner,
                        "name": repo.name,
                    },
                })),
            Some(token),
        ),
    )?;
    let result = github_json::<GitHubGraphQlResponse<GitHubIssueProjectsGraphQlData>>(
        "读取 GitHub Issue Projects 失败",
        response,
    )?;
    if !result.errors.is_empty() {
        if github_graphql_errors_require_read_project(&result.errors) {
            return Ok(std::collections::HashMap::new());
        }
        let detail = result
            .errors
            .into_iter()
            .map(|error| error.message)
            .collect::<Vec<_>>()
            .join("; ");
        return Err(format!("读取 GitHub Issue Projects 失败：{detail}"));
    }
    let data = result
        .data
        .ok_or_else(|| "读取 GitHub Issue Projects 失败：GraphQL 响应缺少 data".to_string())?;
    Ok(github_issue_project_items_from_graphql(data))
}

pub(super) fn enrich_github_issues_with_projects(
    app: &AppHandle,
    repo_full_name: &str,
    binding: &GitHubBindingMetadata,
    token: &str,
    issues: &mut [GitHubIssue],
) -> Result<(), String> {
    if issues.is_empty() {
        return Ok(());
    }
    let project_items = fetch_github_issue_project_items(app, repo_full_name, binding, token)?;
    for issue in issues {
        issue.project_items = project_items
            .get(&issue.number)
            .cloned()
            .unwrap_or_default();
    }
    Ok(())
}

pub(super) fn github_issue_filter_metadata_from_issues(
    issues: &[GitHubIssue],
) -> GitHubIssueFilterMetadata {
    let mut authors = issues
        .iter()
        .filter_map(|issue| issue.author.clone())
        .filter(|author| !author.trim().is_empty())
        .collect::<Vec<_>>();
    authors.sort();
    authors.dedup();

    let mut labels = issues
        .iter()
        .flat_map(|issue| issue.labels.clone())
        .filter(|label| !label.trim().is_empty())
        .collect::<Vec<_>>();
    labels.sort();
    labels.dedup();

    let mut assignees = issues
        .iter()
        .flat_map(|issue| issue.assignees.clone())
        .filter(|assignee| !assignee.trim().is_empty())
        .collect::<Vec<_>>();
    assignees.sort();
    assignees.dedup();

    let mut milestone_map = std::collections::HashMap::<u64, GitHubIssueMilestone>::new();
    let mut project_map = std::collections::HashMap::<String, GitHubIssueProjectItem>::new();
    for issue in issues {
        if let Some(milestone) = &issue.milestone {
            milestone_map.insert(milestone.number, milestone.clone());
        }
        for project in &issue.project_items {
            project_map.insert(project.id.clone(), project.clone());
        }
    }
    let mut milestones = milestone_map.into_values().collect::<Vec<_>>();
    milestones.sort_by(|left, right| left.title.cmp(&right.title));
    let mut projects = project_map.into_values().collect::<Vec<_>>();
    projects.sort_by(|left, right| left.title.cmp(&right.title));

    GitHubIssueFilterMetadata {
        authors,
        labels,
        assignees,
        milestones,
        projects,
    }
}

fn merge_unique_sorted_strings(left: Vec<String>, right: Vec<String>) -> Vec<String> {
    let mut values = left
        .into_iter()
        .chain(right)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    values.sort();
    values.dedup();
    values
}

pub(super) fn github_workflow_run_from_response(
    run: GitHubWorkflowRunResponse,
) -> GitHubWorkflowRun {
    let name = normalize_optional_string(run.name).unwrap_or_else(|| "Workflow".to_string());
    let display_title =
        normalize_optional_string(run.display_title.clone()).unwrap_or_else(|| name.clone());
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
        actor: run.actor.map(|actor| actor.login),
        head_sha: normalize_optional_string(run.head_sha),
        run_number: run.run_number,
        run_attempt: run.run_attempt,
        workflow_id: run.workflow_id,
        run_started_at: normalize_optional_string(run.run_started_at),
    }
}

pub(super) fn github_workflow_job_from_response(
    job: GitHubWorkflowJobResponse,
) -> GitHubWorkflowJob {
    GitHubWorkflowJob {
        id: job.id,
        name: normalize_optional_string(job.name).unwrap_or_else(|| "Job".to_string()),
        status: normalize_optional_string(job.status).unwrap_or_else(|| "unknown".to_string()),
        conclusion: normalize_optional_string(job.conclusion),
        started_at: normalize_optional_string(job.started_at),
        completed_at: normalize_optional_string(job.completed_at),
        html_url: normalize_optional_string(job.html_url),
        runner_name: normalize_optional_string(job.runner_name),
        steps: job
            .steps
            .into_iter()
            .enumerate()
            .map(|(index, step)| GitHubWorkflowJobStep {
                name: normalize_optional_string(step.name)
                    .unwrap_or_else(|| format!("Step {}", index + 1)),
                status: normalize_optional_string(step.status)
                    .unwrap_or_else(|| "unknown".to_string()),
                conclusion: normalize_optional_string(step.conclusion),
                number: step.number.unwrap_or((index + 1) as u64),
                started_at: normalize_optional_string(step.started_at),
                completed_at: normalize_optional_string(step.completed_at),
            })
            .collect(),
    }
}

pub(super) fn github_workflow_artifact_from_response(
    artifact: GitHubWorkflowArtifactResponse,
) -> GitHubWorkflowArtifact {
    GitHubWorkflowArtifact {
        id: artifact.id,
        name: normalize_optional_string(artifact.name).unwrap_or_else(|| "artifact".to_string()),
        size_in_bytes: artifact.size_in_bytes.unwrap_or_default(),
        expired: artifact.expired,
        created_at: artifact.created_at,
        expires_at: normalize_optional_string(artifact.expires_at),
    }
}

pub(super) fn github_workflow_definition_from_file(
    workflow: GitHubWorkflowResponse,
    ref_name: String,
    file: GitHubContentFileResponse,
) -> Result<Option<GitHubWorkflowDefinition>, String> {
    let Some(path) = normalize_optional_string(workflow.path) else {
        return Ok(None);
    };
    let content = github_text_content_from_file("读取 GitHub Actions workflow 文件失败", file)?;
    Ok(Some(GitHubWorkflowDefinition {
        id: workflow.id,
        path,
        ref_name,
        content,
    }))
}

pub(super) fn github_workflow_definition_for_run(
    app: &AppHandle,
    client: &reqwest::blocking::Client,
    repo_api_url: &str,
    repo_full_name: &str,
    token: &str,
    run: &GitHubWorkflowRun,
) -> Result<Option<GitHubWorkflowDefinition>, String> {
    let Some(workflow_id) = run.workflow_id else {
        return Ok(None);
    };
    let Some(ref_name) = normalize_github_ref_name(run.head_sha.as_deref()) else {
        return Ok(None);
    };
    let workflow_response = github_send(
        app,
        "读取 GitHub Actions workflow 失败",
        github_headers(
            client.get(format!("{repo_api_url}/actions/workflows/{workflow_id}")),
            Some(token),
        ),
    )?;
    let workflow = github_json::<GitHubWorkflowResponse>(
        "读取 GitHub Actions workflow 失败",
        workflow_response,
    )?;
    let Some(path) = normalize_optional_string(workflow.path.clone()) else {
        return Ok(None);
    };
    let file_response = github_send(
        app,
        "读取 GitHub Actions workflow 文件失败",
        github_headers(
            client
                .get(github_repo_contents_api_url(repo_full_name, Some(&path))?)
                .query(&[("ref", ref_name.as_str())]),
            Some(token),
        ),
    )?;
    let file = github_json::<GitHubContentFileResponse>(
        "读取 GitHub Actions workflow 文件失败",
        file_response,
    )?;
    github_workflow_definition_from_file(workflow, ref_name, file)
}

pub(super) fn github_artifact_cache_path(repo_full_name: &str, artifact_id: u64) -> PathBuf {
    let safe_repo = repo_full_name
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() || matches!(value, '-' | '_' | '.') {
                value
            } else {
                '_'
            }
        })
        .collect::<String>();
    std::env::temp_dir()
        .join("lilia-github-actions")
        .join(safe_repo)
        .join(format!("{artifact_id}.zip"))
}

pub(super) fn github_artifact_entry_path(path: &Path) -> Result<String, String> {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let normalized = normalized.trim_matches('/').to_string();
    if normalized.is_empty() {
        return Err("artifact 文件路径不能为空".to_string());
    }
    Ok(normalized)
}

pub(super) fn github_artifact_entry_from_zip_file<R: Read>(
    file: &zip::read::ZipFile<'_, R>,
) -> Result<Option<GitHubWorkflowArtifactEntry>, String> {
    let Some(path) = file.enclosed_name() else {
        return Ok(None);
    };
    let path = github_artifact_entry_path(&path)?;
    let name = Path::new(&path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&path)
        .to_string();
    Ok(Some(GitHubWorkflowArtifactEntry {
        path,
        name,
        kind: if file.is_dir() { "dir" } else { "file" }.to_string(),
        size: file.size(),
    }))
}

pub(super) fn github_artifact_preview_from_bytes(
    path: String,
    size: u64,
    bytes: Vec<u8>,
) -> RepoFilePreview {
    let name = Path::new(&path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&path)
        .to_string();
    let preview_path = Path::new(&path);
    let mime = super::file_browser::file_preview_mime(preview_path).map(str::to_string);
    if size > super::file_browser::MAX_FILE_PREVIEW_BYTES {
        return RepoFilePreview {
            path,
            name,
            preview_kind: "tooLarge".to_string(),
            content: None,
            data_url: None,
            images: HashMap::new(),
            size,
            mime_type: mime,
            truncated: false,
        };
    }
    if is_markdown_preview_path(&path) {
        if let Ok(content) = String::from_utf8(bytes) {
            return RepoFilePreview {
                path,
                name,
                preview_kind: "markdown".to_string(),
                content: Some(content),
                data_url: None,
                images: HashMap::new(),
                size,
                mime_type: Some("text/markdown".to_string()),
                truncated: false,
            };
        }
        return RepoFilePreview {
            path,
            name,
            preview_kind: "binary".to_string(),
            content: None,
            data_url: None,
            images: HashMap::new(),
            size,
            mime_type: Some("text/markdown".to_string()),
            truncated: false,
        };
    }
    if let Some(image_mime) = image_mime_for_path(preview_path) {
        return RepoFilePreview {
            path,
            name,
            preview_kind: "image".to_string(),
            content: None,
            data_url: Some(format!(
                "data:{image_mime};base64,{}",
                STANDARD.encode(bytes)
            )),
            images: HashMap::new(),
            size,
            mime_type: Some(image_mime.to_string()),
            truncated: false,
        };
    }
    if let Ok(content) = String::from_utf8(bytes) {
        if !content.contains('\0') {
            return RepoFilePreview {
                path,
                name,
                preview_kind: "text".to_string(),
                content: Some(content),
                data_url: None,
                images: HashMap::new(),
                size,
                mime_type: mime.or_else(|| Some("text/plain".to_string())),
                truncated: false,
            };
        }
    }
    RepoFilePreview {
        path,
        name,
        preview_kind: "binary".to_string(),
        content: None,
        data_url: None,
        images: HashMap::new(),
        size,
        mime_type: mime,
        truncated: false,
    }
}

pub(super) fn github_commit_summary_from_response(commit: GitHubCommitResponse) -> CommitSummary {
    let author = commit.commit.author.as_ref();
    let subject = commit
        .commit
        .message
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    CommitSummary {
        short_hash: short_github_hash(&commit.sha),
        hash: commit.sha,
        author: author
            .and_then(|item| normalize_optional_string(item.name.clone()))
            .unwrap_or_else(|| "unknown".to_string()),
        author_email: author.and_then(|item| normalize_optional_string(item.email.clone())),
        timestamp: author
            .and_then(|item| item.date.as_deref())
            .and_then(parse_github_datetime)
            .unwrap_or_default(),
        subject,
        parents: commit
            .parents
            .into_iter()
            .map(|parent| parent.sha)
            .collect(),
        refs: Vec::new(),
    }
}

pub(super) fn github_commit_detail_from_response(commit: GitHubCommitResponse) -> CommitDetail {
    let author = commit.commit.author.as_ref();
    let committer = commit.commit.committer.as_ref();
    let mut message_lines = commit.commit.message.lines();
    let subject = message_lines.next().unwrap_or("").trim().to_string();
    let body = message_lines
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    let timestamp = author
        .and_then(|item| item.date.as_deref())
        .and_then(parse_github_datetime)
        .unwrap_or_default();
    CommitDetail {
        short_hash: short_github_hash(&commit.sha),
        hash: commit.sha,
        author: author
            .and_then(|item| normalize_optional_string(item.name.clone()))
            .unwrap_or_else(|| "unknown".to_string()),
        author_email: author.and_then(|item| normalize_optional_string(item.email.clone())),
        committer: committer
            .and_then(|item| normalize_optional_string(item.name.clone()))
            .unwrap_or_else(|| "unknown".to_string()),
        committer_email: committer.and_then(|item| normalize_optional_string(item.email.clone())),
        timestamp,
        subject,
        body,
        parents: commit
            .parents
            .into_iter()
            .map(|parent| parent.sha)
            .collect(),
        refs: Vec::new(),
        files: github_commit_file_changes(commit.files),
    }
}

pub(super) fn github_commit_file_changes(
    files: Vec<GitHubCommitFileResponse>,
) -> Vec<CommitFileChange> {
    let patch_output = files
        .iter()
        .filter_map(github_commit_file_patch_block)
        .collect::<Vec<_>>()
        .join("\n");
    let patches = commit_file_patches(&patch_output);
    files
        .into_iter()
        .map(|file| {
            let path = file.filename;
            let parsed = patches.get(&path);
            CommitFileChange {
                path,
                old_path: file.previous_filename,
                status: github_commit_file_status(&file.status).to_string(),
                additions: file.additions,
                deletions: file.deletions,
                patch: parsed.map(|patch| patch.patch.clone()).unwrap_or_default(),
                hunks: parsed.map(|patch| patch.hunks.clone()).unwrap_or_default(),
            }
        })
        .collect()
}

pub(super) fn github_commit_file_patch_block(file: &GitHubCommitFileResponse) -> Option<String> {
    let patch = file.patch.as_ref()?.trim_end();
    if patch.is_empty() {
        return None;
    }
    let old_path = file.previous_filename.as_deref().unwrap_or(&file.filename);
    let old_header = if file.status == "added" {
        "/dev/null".to_string()
    } else {
        format!("a/{old_path}")
    };
    let new_header = if file.status == "removed" {
        "/dev/null".to_string()
    } else {
        format!("b/{new_path}", new_path = file.filename)
    };
    Some(format!(
        "diff --git a/{old_path} b/{new_path}\n--- {old_header}\n+++ {new_header}\n{patch}",
        new_path = file.filename,
    ))
}

pub(super) fn github_commit_file_status(status: &str) -> &str {
    match status {
        "added" => "added",
        "removed" => "deleted",
        "renamed" => "renamed",
        "copied" => "copied",
        _ => "modified",
    }
}

pub(super) fn short_github_hash(hash: &str) -> String {
    hash.chars().take(7).collect()
}

pub(super) fn parse_github_datetime(value: &str) -> Option<i64> {
    let trimmed = value.trim().trim_end_matches('Z');
    let (date, time) = trimmed.split_once('T')?;
    let mut date_parts = date.split('-');
    let year = date_parts.next()?.parse::<i32>().ok()?;
    let month = date_parts.next()?.parse::<i32>().ok()?;
    let day = date_parts.next()?.parse::<i32>().ok()?;
    let mut time_parts = time.split(':');
    let hour = time_parts.next()?.parse::<i64>().ok()?;
    let minute = time_parts.next()?.parse::<i64>().ok()?;
    let second = time_parts.next()?.split('.').next()?.parse::<i64>().ok()?;
    let days = days_from_civil(year, month, day)?;
    Some(days * 86_400 + hour * 3_600 + minute * 60 + second)
}

pub(super) fn days_from_civil(year: i32, month: i32, day: i32) -> Option<i64> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let y = year - i32::from(month <= 2);
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some((era * 146_097 + doe - 719_468) as i64)
}

pub(super) fn github_branch_from_response(branch: GitHubBranchResponse) -> BranchSummary {
    BranchSummary {
        name: branch.name,
        remote: true,
        current: false,
        upstream: None,
        ahead: 0,
        behind: 0,
        protected: branch.protected,
        tip_timestamp: None,
        checked_out_worktree_paths: Vec::new(),
    }
}

pub(super) fn github_auth_header(token: &str) -> String {
    let encoded = STANDARD.encode(format!("x-access-token:{token}"));
    format!("AUTHORIZATION: basic {encoded}")
}

pub(super) fn normalize_github_repo_input(input: &str) -> Result<NormalizedGitHubRepo, String> {
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

pub(super) fn parse_next_page(link: Option<&str>) -> Option<u32> {
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

pub(super) fn github_api_repo_path(repo_full_name: &str) -> String {
    repo_full_name
        .split('/')
        .map(url_encode_path_segment)
        .collect::<Vec<_>>()
        .join("/")
}

pub(super) fn url_encode_path_segment(value: &str) -> String {
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

pub(super) fn token_for_binding(app: &AppHandle) -> Result<Option<String>, String> {
    let settings = load_settings(app);
    let Some(binding) = settings.github_binding else {
        return Ok(None);
    };
    read_token(&binding.login)
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
            let user_response =
                github_headers(client.get("https://api.github.com/user"), Some(&token))
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
pub async fn github_list_repos(
    app: AppHandle,
    page: Option<u32>,
) -> Result<GitHubRepoPage, String> {
    run_blocking("读取 GitHub 仓库", move || {
        let page = page.unwrap_or(1).max(1);
        let (_binding, token) = github_require_token(&app)?;
        let client = build_client()?;
        let response = github_send(
            &app,
            "读取 GitHub 仓库失败",
            github_headers(
                client.get("https://api.github.com/user/repos").query(&[
                    ("affiliation", "owner"),
                    ("visibility", "all"),
                    ("sort", "updated"),
                    ("per_page", "100"),
                    ("page", &page.to_string()),
                ]),
                Some(&token),
            ),
        )?;

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
                map.insert(
                    "gitignore_template".to_string(),
                    serde_json::Value::String(value),
                );
            }
            if let Some(value) = normalize_optional_string(request.license_template) {
                map.insert(
                    "license_template".to_string(),
                    serde_json::Value::String(value),
                );
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

fn fetch_github_repo_management(
    app: &AppHandle,
    repo_full_name: &str,
) -> Result<GitHubRepoManagement, String> {
    let (_binding, token) = github_require_token(app)?;
    let client = build_client()?;
    let repo_url = github_repo_api_url(repo_full_name)?;
    let response = github_send(
        app,
        "读取 GitHub 仓库设置失败",
        github_headers(client.get(&repo_url), Some(&token)),
    )?;
    let repo = github_json::<GitHubRepoResponse>("读取 GitHub 仓库设置失败", response)?;
    let topics_response = github_send(
        app,
        "读取 GitHub 仓库 topics 失败",
        github_headers(
            client.get(github_repo_topics_api_url(repo_full_name)?),
            Some(&token),
        ),
    )?;
    let topics =
        github_json::<GitHubRepoTopicsResponse>("读取 GitHub 仓库 topics 失败", topics_response)?;
    Ok(github_repo_management_from_response(repo, topics.names))
}

#[tauri::command]
pub async fn github_get_repo_management(
    app: AppHandle,
    repo_full_name: String,
    force_refresh: Option<bool>,
) -> Result<GitHubRepoManagement, String> {
    run_blocking("读取 GitHub 仓库设置", move || {
        let cache_key = github_project_cache_repo_key(&repo_full_name)?;
        if github_project_cache_enabled(force_refresh) {
            if let Some(cached) = load_github_project_cache(&app)
                .repos
                .get(&cache_key)
                .and_then(|repo_cache| repo_cache.management.clone())
            {
                return Ok(cached);
            }
        }
        let next = fetch_github_repo_management(&app, &repo_full_name)?;
        update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
            repo_cache.management = Some(next.clone());
        })?;
        Ok(next)
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
        let payload = github_update_repo_settings_payload(&request);
        let client = build_client()?;
        let repo_url = github_repo_api_url(&repo_full_name)?;
        let repo = if payload.is_empty() {
            let response = github_send(
                &app,
                "读取 GitHub 仓库设置失败",
                github_headers(client.get(&repo_url), Some(&token)),
            )?;
            github_json::<GitHubRepoResponse>("读取 GitHub 仓库设置失败", response)?
        } else {
            let response = github_send(
                &app,
                "更新 GitHub 仓库设置失败",
                github_headers(client.patch(&repo_url).json(&payload), Some(&token)),
            )?;
            github_json::<GitHubRepoResponse>("更新 GitHub 仓库设置失败", response)?
        };
        let topics = if let Some(topics) = request.topics {
            let response = github_send(
                &app,
                "更新 GitHub 仓库 topics 失败",
                github_headers(
                    client
                        .put(github_repo_topics_api_url(&repo_full_name)?)
                        .json(&serde_json::json!({ "names": normalize_github_topics(topics) })),
                    Some(&token),
                ),
            )?;
            github_json::<GitHubRepoTopicsResponse>("更新 GitHub 仓库 topics 失败", response)?.names
        } else {
            let response = github_send(
                &app,
                "读取 GitHub 仓库 topics 失败",
                github_headers(
                    client.get(github_repo_topics_api_url(&repo_full_name)?),
                    Some(&token),
                ),
            )?;
            github_json::<GitHubRepoTopicsResponse>("读取 GitHub 仓库 topics 失败", response)?.names
        };
        let management = github_repo_management_from_response(repo, topics);
        update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
            repo_cache.management = Some(management.clone());
        })?;
        Ok(management)
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
            github_headers(
                client.delete(github_repo_api_url(&repo_full_name)?),
                Some(&token),
            ),
        )?;
        if !response.status().is_success() {
            return Err(github_http_error("删除 GitHub 仓库失败", response));
        }
        clear_github_project_repo_cache(&app, &repo_full_name)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn github_list_branches(
    app: AppHandle,
    repo_full_name: String,
) -> Result<Vec<BranchSummary>, String> {
    run_blocking("读取 GitHub 分支", move || {
        let (_binding, token) = github_require_token(&app)?;
        let client = build_client()?;
        let repo_url = github_repo_api_url(&repo_full_name)?;
        let response = github_send(
            &app,
            "读取 GitHub 分支失败",
            github_headers(
                client
                    .get(format!("{repo_url}/branches"))
                    .query(&[("per_page", "100")]),
                Some(&token),
            ),
        )?;
        let branches = github_json::<Vec<GitHubBranchResponse>>("读取 GitHub 分支失败", response)?;
        Ok(branches
            .into_iter()
            .map(github_branch_from_response)
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn github_delete_branch(
    app: AppHandle,
    repo_full_name: String,
    branch_name: String,
) -> Result<(), String> {
    run_blocking("删除 GitHub 分支", move || {
        let (_binding, token) = github_require_token(&app)?;
        let branch = branch_name.trim();
        if branch.is_empty() {
            return Err("分支名不能为空".to_string());
        }
        let client = build_client()?;
        let response = github_send(
            &app,
            "删除 GitHub 分支失败",
            github_headers(
                client.delete(format!(
                    "{}/git/refs/heads/{}",
                    github_repo_api_url(&repo_full_name)?,
                    url_encode_path_segment(branch)
                )),
                Some(&token),
            ),
        )?;
        if !response.status().is_success() {
            return Err(github_http_error("删除 GitHub 分支失败", response));
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn github_list_pull_requests(
    app: AppHandle,
    repo_full_name: String,
    state: Option<String>,
    per_page: Option<u32>,
    sort: Option<String>,
    direction: Option<String>,
    creator: Option<String>,
    assignee: Option<String>,
    labels: Option<Vec<String>>,
    milestone: Option<serde_json::Value>,
    project: Option<String>,
    review: Option<String>,
    query: Option<String>,
    force_refresh: Option<bool>,
) -> Result<Vec<GitHubPullRequest>, String> {
    run_blocking("读取 GitHub Pull Requests", move || {
        let milestone_key = github_issue_milestone_param(milestone.clone());
        let search_query = normalize_optional_string(query.clone());
        let pull_key = github_pull_request_cache_key(
            state.as_deref(),
            per_page,
            sort.as_deref(),
            direction.as_deref(),
            creator.as_deref(),
            assignee.as_deref(),
            labels.as_deref(),
            milestone_key.as_deref(),
            project.as_deref(),
            review.as_deref(),
            search_query.as_deref(),
        );
        let cache_key = github_project_cache_repo_key(&repo_full_name)?;
        if github_project_cache_enabled(force_refresh) {
            if let Some(cached) = load_github_project_cache(&app)
                .repos
                .get(&cache_key)
                .and_then(|repo_cache| repo_cache.pull_requests.get(&pull_key).cloned())
            {
                return Ok(cached);
            }
        }
        let (binding, token) = github_require_token(&app)?;
        let pull_state = match state.as_deref() {
            Some("closed") => "closed",
            Some("merged") => "merged",
            Some("all") => "all",
            _ => "open",
        };
        let pull_per_page = per_page.unwrap_or(100).clamp(1, 100).to_string();
        let pull_sort = match sort.as_deref() {
            Some("created") => "created",
            Some("comments") => "comments",
            _ => "updated",
        };
        let pull_direction = match direction.as_deref() {
            Some("asc") => "asc",
            _ => "desc",
        };
        let pull_creator = normalize_optional_string(creator);
        let pull_assignee = normalize_optional_string(assignee);
        let pull_review = normalize_optional_string(review);
        let client = build_client()?;
        let search_q = github_pull_request_search_query(
            &repo_full_name,
            pull_state,
            search_query.as_deref().unwrap_or(""),
            pull_creator.as_deref(),
            pull_assignee.as_deref(),
            labels.as_deref(),
            milestone_key.as_deref(),
            pull_review.as_deref(),
        );
        let search_params = vec![
            ("q", search_q),
            ("per_page", pull_per_page),
            ("sort", pull_sort.to_string()),
            ("order", pull_direction.to_string()),
        ];
        let response = github_send(
            &app,
            "读取 GitHub Pull Requests 失败",
            github_headers(
                client
                    .get("https://api.github.com/search/issues")
                    .query(&search_params),
                Some(&token),
            ),
        )?;
        let mut issues =
            github_json::<GitHubIssueSearchResponse>("读取 GitHub Pull Requests 失败", response)?
                .items
                .into_iter()
                .filter_map(github_pull_request_issue_from_response)
                .collect::<Vec<_>>();
        enrich_github_issues_with_projects(&app, &repo_full_name, &binding, &token, &mut issues)?;
        if let Some(project_filter) = normalize_optional_string(project) {
            issues.retain(|issue| {
                issue
                    .project_items
                    .iter()
                    .any(|item| item.id == project_filter || item.title == project_filter)
            });
        }
        let mut pulls = Vec::with_capacity(issues.len());
        for issue in issues {
            let pull_request = github_fetch_pull_request_response(
                &app,
                &repo_full_name,
                issue.number,
                &token,
                "读取 GitHub Pull Request 失败",
            )?;
            pulls.push(github_pull_request_with_issue_metadata(
                github_pull_request_from_response(pull_request),
                issue,
            ));
        }
        update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
            repo_cache.pull_requests.insert(pull_key, pulls.clone());
        })?;
        Ok(pulls)
    })
    .await
}

#[tauri::command]
pub async fn github_get_pull_request(
    app: AppHandle,
    repo_full_name: String,
    pull_number: u64,
) -> Result<GitHubPullRequest, String> {
    run_blocking("读取 GitHub Pull Request", move || {
        let (_binding, token) = github_require_token(&app)?;
        let pull_request = github_fetch_pull_request_response(
            &app,
            &repo_full_name,
            pull_number,
            &token,
            "读取 GitHub Pull Request 失败",
        )?;
        Ok(github_pull_request_from_response(pull_request))
    })
    .await
}

#[tauri::command]
pub async fn github_get_pull_request_discussion(
    app: AppHandle,
    repo_full_name: String,
    pull_number: u64,
    force_refresh: Option<bool>,
) -> Result<GitHubPullRequestDiscussion, String> {
    run_blocking("读取 GitHub Pull Request 讨论", move || {
        if pull_number == 0 {
            return Err("Pull Request 编号不合法".to_string());
        }
        let cache_key = github_project_cache_repo_key(&repo_full_name)?;
        let discussion_key = pull_number.to_string();
        if github_project_cache_enabled(force_refresh) {
            if let Some(cached) = load_github_project_cache(&app)
                .repos
                .get(&cache_key)
                .and_then(|repo_cache| {
                    repo_cache
                        .pull_request_discussions
                        .get(&discussion_key)
                        .cloned()
                })
            {
                return Ok(cached);
            }
        }
        let (_binding, token) = github_require_token(&app)?;
        let pull_request_response = github_fetch_pull_request_response(
            &app,
            &repo_full_name,
            pull_number,
            &token,
            "读取 GitHub Pull Request 失败",
        )?;
        let pull_request_issue = github_fetch_issue_response(
            &app,
            &repo_full_name,
            pull_number,
            &token,
            "读取 GitHub Pull Request 元数据失败",
        )?;
        let issue_metadata = github_pull_request_issue_from_response(pull_request_issue);
        let mut pull_request = github_pull_request_from_response(pull_request_response);
        if let Some(issue) = issue_metadata {
            pull_request = github_pull_request_with_issue_metadata(pull_request, issue);
        }
        let client = build_client()?;
        let repo_url = github_repo_api_url(&repo_full_name)?;
        let mut timeline = vec![github_timeline_item_from_pull_request(&pull_request)];
        timeline.extend(
            github_fetch_paginated::<GitHubIssueTimelineResponse>(
                &app,
                &client,
                &token,
                format!("{repo_url}/issues/{pull_number}/timeline"),
                "读取 GitHub Pull Request 时间线失败",
            )?
            .into_iter()
            .map(github_timeline_item_from_response),
        );
        timeline.extend(
            github_fetch_paginated::<GitHubPullRequestReviewResponse>(
                &app,
                &client,
                &token,
                format!("{repo_url}/pulls/{pull_number}/reviews"),
                "读取 GitHub Pull Request Reviews 失败",
            )?
            .into_iter()
            .map(github_review_timeline_item_from_response),
        );
        timeline.extend(
            github_fetch_paginated::<GitHubPullRequestReviewCommentResponse>(
                &app,
                &client,
                &token,
                format!("{repo_url}/pulls/{pull_number}/comments"),
                "读取 GitHub Pull Request Review Comments 失败",
            )?
            .into_iter()
            .map(github_review_comment_timeline_item_from_response),
        );
        let mut seen = HashSet::new();
        timeline.retain(|item| seen.insert(format!("{}:{}", item.kind, item.id)));
        sort_github_discussion_timeline(&mut timeline);
        let discussion = GitHubPullRequestDiscussion {
            pull_request,
            timeline,
        };
        update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
            repo_cache
                .pull_request_discussions
                .insert(discussion_key, discussion.clone());
        })?;
        Ok(discussion)
    })
    .await
}

#[tauri::command]
pub async fn github_create_pull_request(
    app: AppHandle,
    repo_full_name: String,
    request: GitHubCreatePullRequestRequest,
) -> Result<GitHubPullRequest, String> {
    run_blocking("创建 GitHub Pull Request", move || {
        let (_binding, token) = github_require_token(&app)?;
        let title = request.title.trim();
        let head = request.head.trim();
        let base = request.base.trim();
        if title.is_empty() || head.is_empty() || base.is_empty() {
            return Err("Pull Request 标题、head 和 base 不能为空".to_string());
        }
        let mut payload = serde_json::json!({
            "title": title,
            "head": head,
            "base": base,
            "draft": request.draft,
        });
        if let Some(map) = payload.as_object_mut() {
            if let Some(value) = normalize_optional_string(request.body) {
                map.insert("body".to_string(), serde_json::Value::String(value));
            }
        }
        let client = build_client()?;
        let response = github_send(
            &app,
            "创建 GitHub Pull Request 失败",
            github_headers(
                client
                    .post(format!("{}/pulls", github_repo_api_url(&repo_full_name)?))
                    .json(&payload),
                Some(&token),
            ),
        )?;
        let pull_request =
            github_json::<GitHubPullRequestResponse>("创建 GitHub Pull Request 失败", response)?;
        let pull = github_pull_request_from_response(pull_request);
        clear_github_project_pull_request_cache(&app, &repo_full_name)?;
        Ok(pull)
    })
    .await
}

#[tauri::command]
pub async fn github_update_pull_request(
    app: AppHandle,
    repo_full_name: String,
    pull_number: u64,
    request: GitHubUpdatePullRequestRequest,
) -> Result<GitHubPullRequest, String> {
    run_blocking("更新 GitHub Pull Request", move || {
        if pull_number == 0 {
            return Err("Pull Request 编号不合法".to_string());
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
            let trimmed = value.trim().to_string();
            if trimmed != "open" && trimmed != "closed" {
                return Err("Pull Request 状态只能是 open 或 closed".to_string());
            }
            payload.insert("state".to_string(), serde_json::Value::String(trimmed));
        }
        if let Some(value) = normalize_optional_string(request.base) {
            payload.insert("base".to_string(), serde_json::Value::String(value));
        }
        let client = build_client()?;
        let response = github_send(
            &app,
            "更新 GitHub Pull Request 失败",
            github_headers(
                client
                    .patch(format!(
                        "{}/pulls/{pull_number}",
                        github_repo_api_url(&repo_full_name)?
                    ))
                    .json(&payload),
                Some(&token),
            ),
        )?;
        let pull_request =
            github_json::<GitHubPullRequestResponse>("更新 GitHub Pull Request 失败", response)?;
        let pull = github_pull_request_from_response(pull_request);
        clear_github_project_pull_request_cache(&app, &repo_full_name)?;
        Ok(pull)
    })
    .await
}

#[tauri::command]
pub async fn github_merge_pull_request(
    app: AppHandle,
    repo_full_name: String,
    pull_number: u64,
    request: GitHubMergePullRequestRequest,
) -> Result<GitHubPullRequest, String> {
    run_blocking("合并 GitHub Pull Request", move || {
        if pull_number == 0 {
            return Err("Pull Request 编号不合法".to_string());
        }
        let (_binding, token) = github_require_token(&app)?;
        let mut payload = serde_json::Map::new();
        if let Some(value) = normalize_optional_string(request.method) {
            payload.insert("merge_method".to_string(), serde_json::Value::String(value));
        }
        if let Some(value) = normalize_optional_string(request.commit_title) {
            payload.insert("commit_title".to_string(), serde_json::Value::String(value));
        }
        if let Some(value) = normalize_optional_string(request.commit_message) {
            payload.insert(
                "commit_message".to_string(),
                serde_json::Value::String(value),
            );
        }
        if let Some(value) = normalize_optional_string(request.sha) {
            payload.insert("sha".to_string(), serde_json::Value::String(value));
        }
        let client = build_client()?;
        let response = github_send(
            &app,
            "合并 GitHub Pull Request 失败",
            github_headers(
                client
                    .put(format!(
                        "{}/pulls/{pull_number}/merge",
                        github_repo_api_url(&repo_full_name)?
                    ))
                    .json(&payload),
                Some(&token),
            ),
        )?;
        if !response.status().is_success() {
            return Err(github_http_error("合并 GitHub Pull Request 失败", response));
        }
        let pull_request = github_fetch_pull_request_response(
            &app,
            &repo_full_name,
            pull_number,
            &token,
            "读取合并后的 Pull Request 失败",
        )?;
        let pull = github_pull_request_from_response(pull_request);
        clear_github_project_pull_request_cache(&app, &repo_full_name)?;
        Ok(pull)
    })
    .await
}

#[tauri::command]
pub async fn github_list_pull_request_checks(
    app: AppHandle,
    repo_full_name: String,
    pull_number: u64,
    force_refresh: Option<bool>,
) -> Result<Vec<GitHubPullRequestCheck>, String> {
    run_blocking("读取 GitHub Pull Request Checks", move || {
        if pull_number == 0 {
            return Err("Pull Request 编号不合法".to_string());
        }
        let checks_key = pull_number.to_string();
        let cache_key = github_project_cache_repo_key(&repo_full_name)?;
        if github_project_cache_enabled(force_refresh) {
            if let Some(cached) = load_github_project_cache(&app)
                .repos
                .get(&cache_key)
                .and_then(|repo_cache| repo_cache.pull_request_checks.get(&checks_key).cloned())
            {
                return Ok(cached);
            }
        }
        let (_binding, token) = github_require_token(&app)?;
        let pull_request = github_fetch_pull_request_response(
            &app,
            &repo_full_name,
            pull_number,
            &token,
            "读取 GitHub Pull Request Checks 失败",
        )?;
        let head_sha = pull_request
            .head
            .sha
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "Pull Request 缺少 head sha".to_string())?;
        let client = build_client()?;
        let response = github_send(
            &app,
            "读取 GitHub Pull Request Checks 失败",
            github_headers(
                client
                    .get(format!(
                        "{}/commits/{}/check-runs",
                        github_repo_api_url(&repo_full_name)?,
                        url_encode_path_segment(&head_sha)
                    ))
                    .query(&[("per_page", "100")]),
                Some(&token),
            ),
        )?;
        let checks = github_json::<GitHubPullRequestCheckRunsResponse>(
            "读取 GitHub Pull Request Checks 失败",
            response,
        )?;
        let checks = checks
            .check_runs
            .into_iter()
            .map(github_pull_request_check_from_response)
            .collect::<Vec<_>>();
        update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
            repo_cache
                .pull_request_checks
                .insert(checks_key, checks.clone());
        })?;
        Ok(checks)
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
    creator: Option<String>,
    assignee: Option<String>,
    labels: Option<Vec<String>>,
    milestone: Option<serde_json::Value>,
    project: Option<String>,
    query: Option<String>,
    force_refresh: Option<bool>,
) -> Result<Vec<GitHubIssue>, String> {
    run_blocking("读取 GitHub Issue", move || {
        let milestone_key = github_issue_milestone_param(milestone.clone());
        let search_query = normalize_optional_string(query.clone());
        let issue_key = github_issue_cache_key(
            state.as_deref(),
            per_page,
            sort.as_deref(),
            direction.as_deref(),
            since.as_deref(),
            creator.as_deref(),
            assignee.as_deref(),
            labels.as_deref(),
            milestone_key.as_deref(),
            project.as_deref(),
            search_query.as_deref(),
        );
        let cache_key = github_project_cache_repo_key(&repo_full_name)?;
        if github_project_cache_enabled(force_refresh) {
            if let Some(cached) = load_github_project_cache(&app)
                .repos
                .get(&cache_key)
                .and_then(|repo_cache| repo_cache.issues.get(&issue_key).cloned())
            {
                return Ok(cached);
            }
        }
        let (binding, token) = github_require_token(&app)?;
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
        let issue_since = normalize_optional_string(since);
        let issue_creator = normalize_optional_string(creator);
        let issue_assignee = normalize_optional_string(assignee);
        let issue_labels = github_issue_labels_param(labels.clone());
        let issue_milestone = milestone_key.clone();
        let mut rest_query = vec![
            ("state", issue_state.clone()),
            ("per_page", issue_per_page.clone()),
            ("sort", issue_sort.to_string()),
            ("direction", issue_direction.to_string()),
        ];
        if let Some(issue_since) = issue_since.clone() {
            rest_query.push(("since", issue_since));
        }
        if let Some(issue_creator) = issue_creator.clone() {
            rest_query.push(("creator", issue_creator));
        }
        if let Some(issue_assignee) = issue_assignee.clone() {
            rest_query.push(("assignee", issue_assignee));
        }
        if let Some(issue_labels) = issue_labels.clone() {
            rest_query.push(("labels", issue_labels));
        }
        if let Some(issue_milestone) = issue_milestone.clone() {
            rest_query.push(("milestone", issue_milestone));
        }
        let client = build_client()?;
        let issues = if let Some(search_text) = search_query {
            let search_sort = match issue_sort {
                "updated" => "updated",
                "comments" => "comments",
                _ => "created",
            };
            let search_q = github_issue_search_query(
                &repo_full_name,
                &issue_state,
                &search_text,
                issue_since.as_deref(),
                issue_creator.as_deref(),
                issue_assignee.as_deref(),
                labels.as_deref(),
                milestone_key.as_deref(),
            );
            let search_params = vec![
                ("q", search_q),
                ("per_page", issue_per_page),
                ("sort", search_sort.to_string()),
                ("order", issue_direction.to_string()),
            ];
            let response = github_send(
                &app,
                "搜索 GitHub Issue 失败",
                github_headers(
                    client
                        .get("https://api.github.com/search/issues")
                        .query(&search_params),
                    Some(&token),
                ),
            )?;
            github_json::<GitHubIssueSearchResponse>("搜索 GitHub Issue 失败", response)?.items
        } else {
            let response = github_send(
                &app,
                "读取 GitHub Issue 失败",
                github_headers(
                    client
                        .get(format!("{}/issues", github_repo_api_url(&repo_full_name)?))
                        .query(&rest_query),
                    Some(&token),
                ),
            )?;
            github_json::<Vec<GitHubIssueResponse>>("读取 GitHub Issue 失败", response)?
        };
        let mut issues = issues
            .into_iter()
            .filter_map(github_issue_from_response)
            .collect::<Vec<_>>();
        enrich_github_issues_with_projects(&app, &repo_full_name, &binding, &token, &mut issues)?;
        if let Some(project_filter) = normalize_optional_string(project) {
            issues.retain(|issue| {
                issue
                    .project_items
                    .iter()
                    .any(|item| item.id == project_filter || item.title == project_filter)
            });
        }
        update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
            repo_cache.issues.insert(issue_key, issues.clone());
        })?;
        Ok(issues)
    })
    .await
}

#[tauri::command]
pub async fn github_get_issue_discussion(
    app: AppHandle,
    repo_full_name: String,
    issue_number: u64,
    force_refresh: Option<bool>,
) -> Result<GitHubIssueDiscussion, String> {
    run_blocking("读取 GitHub Issue 讨论", move || {
        if issue_number == 0 {
            return Err("Issue 编号不合法".to_string());
        }
        let cache_key = github_project_cache_repo_key(&repo_full_name)?;
        let discussion_key = issue_number.to_string();
        if github_project_cache_enabled(force_refresh) {
            if let Some(cached) = load_github_project_cache(&app)
                .repos
                .get(&cache_key)
                .and_then(|repo_cache| repo_cache.issue_discussions.get(&discussion_key).cloned())
            {
                return Ok(cached);
            }
        }
        let (_binding, token) = github_require_token(&app)?;
        let issue_response = github_fetch_issue_response(
            &app,
            &repo_full_name,
            issue_number,
            &token,
            "读取 GitHub Issue 失败",
        )?;
        let issue = github_issue_from_response(issue_response)
            .ok_or_else(|| format!("#{issue_number} 是 Pull Request，不是 Issue"))?;
        let client = build_client()?;
        let repo_url = github_repo_api_url(&repo_full_name)?;
        let mut timeline = vec![github_timeline_item_from_issue(&issue)];
        timeline.extend(
            github_fetch_paginated::<GitHubIssueTimelineResponse>(
                &app,
                &client,
                &token,
                format!("{repo_url}/issues/{issue_number}/timeline"),
                "读取 GitHub Issue 时间线失败",
            )?
            .into_iter()
            .map(github_timeline_item_from_response),
        );
        let mut seen = HashSet::new();
        timeline.retain(|item| seen.insert(format!("{}:{}", item.kind, item.id)));
        sort_github_discussion_timeline(&mut timeline);
        let discussion = GitHubIssueDiscussion { issue, timeline };
        update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
            repo_cache
                .issue_discussions
                .insert(discussion_key, discussion.clone());
        })?;
        Ok(discussion)
    })
    .await
}

#[tauri::command]
pub async fn github_get_issue_filter_metadata(
    app: AppHandle,
    repo_full_name: String,
    force_refresh: Option<bool>,
) -> Result<GitHubIssueFilterMetadata, String> {
    run_blocking("读取 GitHub Issue 筛选项", move || {
        let cache_key = github_project_cache_repo_key(&repo_full_name)?;
        if github_project_cache_enabled(force_refresh) {
            let cache = load_github_project_cache(&app);
            if let Some(repo_cache) = cache.repos.get(&cache_key) {
                if let Some(cached) = repo_cache.issue_filter_metadata.clone() {
                    if !cached.labels.is_empty() || repo_cache.issue_labels.is_some() {
                        return Ok(cached);
                    }
                }
            }
        }
        let (binding, token) = github_require_token(&app)?;
        let client = build_client()?;
        let query = vec![
            ("state", "all".to_string()),
            ("per_page", "100".to_string()),
            ("sort", "updated".to_string()),
            ("direction", "desc".to_string()),
        ];
        let response = github_send(
            &app,
            "读取 GitHub Issue 筛选项失败",
            github_headers(
                client
                    .get(format!("{}/issues", github_repo_api_url(&repo_full_name)?))
                    .query(&query),
                Some(&token),
            ),
        )?;
        let issues =
            github_json::<Vec<GitHubIssueResponse>>("读取 GitHub Issue 筛选项失败", response)?;
        let mut issues = issues
            .into_iter()
            .filter_map(github_issue_from_response)
            .collect::<Vec<_>>();
        enrich_github_issues_with_projects(&app, &repo_full_name, &binding, &token, &mut issues)?;
        let mut metadata = github_issue_filter_metadata_from_issues(&issues);
        let repo_labels = list_github_issue_labels_inner(&app, &repo_full_name, force_refresh)?;
        metadata.labels = merge_unique_sorted_strings(metadata.labels, repo_labels);
        update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
            repo_cache.issue_filter_metadata = Some(metadata.clone());
        })?;
        Ok(metadata)
    })
    .await
}

fn list_github_issue_values(
    app: &AppHandle,
    repo_full_name: &str,
    force_refresh: Option<bool>,
    cache_read: impl Fn(&GitHubProjectRepoCache) -> Option<Vec<String>>,
    cache_write: impl Fn(&mut GitHubProjectRepoCache, Vec<String>),
    endpoint: &str,
    error_label: &'static str,
    parse_values: impl Fn(Response) -> Result<Vec<String>, String>,
) -> Result<Vec<String>, String> {
    let cache_key = github_project_cache_repo_key(repo_full_name)?;
    if github_project_cache_enabled(force_refresh) {
        if let Some(cached) = load_github_project_cache(app)
            .repos
            .get(&cache_key)
            .and_then(cache_read)
        {
            return Ok(cached);
        }
    }
    let (_binding, token) = github_require_token(app)?;
    let client = build_client()?;
    let response = github_send(
        app,
        error_label,
        github_headers(
            client
                .get(format!(
                    "{}/{}",
                    github_repo_api_url(repo_full_name)?,
                    endpoint
                ))
                .query(&[("per_page", "100")]),
            Some(&token),
        ),
    )?;
    let values = parse_values(response)?;
    update_github_project_repo_cache(app, repo_full_name, |repo_cache| {
        cache_write(repo_cache, values.clone());
    })?;
    Ok(values)
}

fn list_github_issue_labels_inner(
    app: &AppHandle,
    repo_full_name: &str,
    force_refresh: Option<bool>,
) -> Result<Vec<String>, String> {
    list_github_issue_values(
        app,
        repo_full_name,
        force_refresh,
        |repo_cache| repo_cache.issue_labels.clone(),
        |repo_cache, labels| repo_cache.issue_labels = Some(labels),
        "labels",
        "读取 GitHub Issue Labels 失败",
        |response| {
            Ok(
                github_json::<Vec<GitHubLabelResponse>>("读取 GitHub Issue Labels 失败", response)?
                    .into_iter()
                    .map(|label| label.name)
                    .filter(|label| !label.trim().is_empty())
                    .collect(),
            )
        },
    )
}

fn list_github_issue_assignees_inner(
    app: &AppHandle,
    repo_full_name: &str,
    force_refresh: Option<bool>,
) -> Result<Vec<String>, String> {
    list_github_issue_values(
        app,
        repo_full_name,
        force_refresh,
        |repo_cache| repo_cache.issue_assignees.clone(),
        |repo_cache, assignees| repo_cache.issue_assignees = Some(assignees),
        "assignees",
        "读取 GitHub Issue Assignees 失败",
        |response| {
            Ok(github_json::<Vec<GitHubAssigneeResponse>>(
                "读取 GitHub Issue Assignees 失败",
                response,
            )?
            .into_iter()
            .map(|assignee| assignee.login)
            .filter(|assignee| !assignee.trim().is_empty())
            .collect())
        },
    )
}

#[tauri::command]
pub async fn github_list_issue_labels(
    app: AppHandle,
    repo_full_name: String,
    force_refresh: Option<bool>,
) -> Result<Vec<String>, String> {
    run_blocking("读取 GitHub Issue Labels", move || {
        list_github_issue_labels_inner(&app, &repo_full_name, force_refresh)
    })
    .await
}

#[tauri::command]
pub async fn github_list_issue_assignees(
    app: AppHandle,
    repo_full_name: String,
    force_refresh: Option<bool>,
) -> Result<Vec<String>, String> {
    run_blocking("读取 GitHub Issue Assignees", move || {
        list_github_issue_assignees_inner(&app, &repo_full_name, force_refresh)
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
        let issue = github_issue_from_response(issue)
            .ok_or_else(|| "GitHub 返回了 Pull Request 记录".to_string())?;
        clear_github_project_issue_cache(&app, &repo_full_name)?;
        Ok(issue)
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
        let issue = github_issue_from_response(issue)
            .ok_or_else(|| "GitHub 返回了 Pull Request 记录".to_string())?;
        clear_github_project_issue_cache(&app, &repo_full_name)?;
        Ok(issue)
    })
    .await
}

#[tauri::command]
pub async fn github_list_workflow_runs(
    app: AppHandle,
    repo_full_name: String,
    per_page: Option<u32>,
    force_refresh: Option<bool>,
) -> Result<Vec<GitHubWorkflowRun>, String> {
    run_blocking("读取 GitHub Actions", move || {
        let runs_key = github_workflow_runs_cache_key(per_page);
        let cache_key = github_project_cache_repo_key(&repo_full_name)?;
        if github_project_cache_enabled(force_refresh) {
            if let Some(cached) = load_github_project_cache(&app)
                .repos
                .get(&cache_key)
                .and_then(|repo_cache| repo_cache.workflow_runs.get(&runs_key).cloned())
            {
                return Ok(cached);
            }
        }
        let (_binding, token) = github_require_token(&app)?;
        let runs_per_page = per_page.unwrap_or(30).clamp(1, 100).to_string();
        let client = build_client()?;
        let response = github_send(
            &app,
            "读取 GitHub Actions 失败",
            github_headers(
                client
                    .get(format!(
                        "{}/actions/runs",
                        github_repo_api_url(&repo_full_name)?
                    ))
                    .query(&[("per_page", runs_per_page)]),
                Some(&token),
            ),
        )?;
        let runs = github_json::<GitHubWorkflowRunsResponse>("读取 GitHub Actions 失败", response)?;
        let runs = runs
            .workflow_runs
            .into_iter()
            .map(github_workflow_run_from_response)
            .collect::<Vec<_>>();
        update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
            repo_cache.workflow_runs.insert(runs_key, runs.clone());
        })?;
        Ok(runs)
    })
    .await
}

#[tauri::command]
pub async fn github_get_workflow_run_detail(
    app: AppHandle,
    repo_full_name: String,
    run_id: u64,
    _force_refresh: Option<bool>,
) -> Result<GitHubWorkflowRunDetail, String> {
    run_blocking("读取 GitHub Actions 详情", move || {
        let (_binding, token) = github_require_token(&app)?;
        let client = build_client()?;
        let repo_api_url = github_repo_api_url(&repo_full_name)?;
        let run_response = github_send(
            &app,
            "读取 GitHub Actions 详情失败",
            github_headers(
                client.get(format!("{repo_api_url}/actions/runs/{run_id}")),
                Some(&token),
            ),
        )?;
        let run = github_workflow_run_from_response(github_json::<GitHubWorkflowRunResponse>(
            "读取 GitHub Actions 详情失败",
            run_response,
        )?);
        let jobs_response = github_send(
            &app,
            "读取 GitHub Actions jobs 失败",
            github_headers(
                client
                    .get(format!("{repo_api_url}/actions/runs/{run_id}/jobs"))
                    .query(&[("per_page", "100")]),
                Some(&token),
            ),
        )?;
        let jobs = github_json::<GitHubWorkflowJobsResponse>(
            "读取 GitHub Actions jobs 失败",
            jobs_response,
        )?
        .jobs
        .into_iter()
        .map(github_workflow_job_from_response)
        .collect::<Vec<_>>();
        let artifacts_response = github_send(
            &app,
            "读取 GitHub Actions artifacts 失败",
            github_headers(
                client
                    .get(format!("{repo_api_url}/actions/runs/{run_id}/artifacts"))
                    .query(&[("per_page", "100")]),
                Some(&token),
            ),
        )?;
        let artifacts = github_json::<GitHubWorkflowArtifactsResponse>(
            "读取 GitHub Actions artifacts 失败",
            artifacts_response,
        )?
        .artifacts
        .into_iter()
        .map(github_workflow_artifact_from_response)
        .collect::<Vec<_>>();
        let workflow = github_workflow_definition_for_run(
            &app,
            &client,
            &repo_api_url,
            &repo_full_name,
            &token,
            &run,
        )
        .ok()
        .flatten();
        Ok(GitHubWorkflowRunDetail {
            run,
            jobs,
            artifacts,
            workflow,
        })
    })
    .await
}

#[tauri::command]
pub async fn github_get_workflow_job_log(
    app: AppHandle,
    repo_full_name: String,
    job_id: u64,
    _force_refresh: Option<bool>,
) -> Result<GitHubWorkflowJobLog, String> {
    run_blocking("读取 GitHub Actions 日志", move || {
        let (_binding, token) = github_require_token(&app)?;
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|e| format!("构造 GitHub HTTP 客户端失败：{e}"))?;
        let response = github_send(
            &app,
            "读取 GitHub Actions 日志失败",
            github_headers(
                client.get(format!(
                    "{}/actions/jobs/{job_id}/logs",
                    github_repo_api_url(&repo_full_name)?
                )),
                Some(&token),
            ),
        )?;
        let content = response
            .text()
            .map_err(|e| format!("读取 GitHub Actions 日志失败：读取响应失败：{e}"))?;
        Ok(GitHubWorkflowJobLog { job_id, content })
    })
    .await
}

fn ensure_github_artifact_zip(
    app: &AppHandle,
    repo_full_name: &str,
    artifact_id: u64,
) -> Result<PathBuf, String> {
    let path = github_artifact_cache_path(repo_full_name, artifact_id);
    if let Ok(metadata) = fs::metadata(&path) {
        if metadata.len() <= GITHUB_ACTIONS_ARTIFACT_MAX_BYTES {
            return Ok(path);
        }
        let _ = fs::remove_file(&path);
    }
    let (_binding, token) = github_require_token(app)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("构造 GitHub HTTP 客户端失败：{e}"))?;
    let response = github_send(
        app,
        "下载 GitHub Actions artifact 失败",
        github_headers(
            client.get(format!(
                "{}/actions/artifacts/{artifact_id}/zip",
                github_repo_api_url(repo_full_name)?
            )),
            Some(&token),
        ),
    )?;
    if response
        .content_length()
        .is_some_and(|size| size > GITHUB_ACTIONS_ARTIFACT_MAX_BYTES)
    {
        return Err("artifact 超过 200 MB，已跳过内置预览".to_string());
    }
    let bytes = response
        .bytes()
        .map_err(|e| format!("下载 GitHub Actions artifact 失败：读取响应失败：{e}"))?;
    if bytes.len() as u64 > GITHUB_ACTIONS_ARTIFACT_MAX_BYTES {
        return Err("artifact 超过 200 MB，已跳过内置预览".to_string());
    }
    let Some(parent) = path.parent() else {
        return Err("artifact 缓存路径无效".to_string());
    };
    fs::create_dir_all(parent)
        .map_err(|e| format!("创建 artifact 缓存目录失败：{}（{e}）", parent.display()))?;
    fs::write(&path, bytes)
        .map_err(|e| format!("保存 artifact 缓存失败：{}（{e}）", path.display()))?;
    Ok(path)
}

#[tauri::command]
pub async fn github_list_workflow_artifact_files(
    app: AppHandle,
    repo_full_name: String,
    artifact_id: u64,
) -> Result<Vec<GitHubWorkflowArtifactEntry>, String> {
    run_blocking("读取 GitHub Actions artifact", move || {
        let path = ensure_github_artifact_zip(&app, &repo_full_name, artifact_id)?;
        let bytes = fs::read(&path)
            .map_err(|e| format!("读取 artifact 缓存失败：{}（{e}）", path.display()))?;
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
            .map_err(|e| format!("读取 artifact ZIP 失败：{e}"))?;
        let mut entries = Vec::new();
        for index in 0..archive.len() {
            let file = archive
                .by_index(index)
                .map_err(|e| format!("读取 artifact ZIP 条目失败：{e}"))?;
            if let Some(entry) = github_artifact_entry_from_zip_file(&file)? {
                entries.push(entry);
            }
        }
        entries.sort_by(|left, right| {
            (right.kind == "dir")
                .cmp(&(left.kind == "dir"))
                .then_with(|| {
                    left.path
                        .to_ascii_lowercase()
                        .cmp(&right.path.to_ascii_lowercase())
                })
                .then_with(|| left.path.cmp(&right.path))
        });
        Ok(entries)
    })
    .await
}

#[tauri::command]
pub async fn github_get_workflow_artifact_file_preview(
    app: AppHandle,
    repo_full_name: String,
    artifact_id: u64,
    path: String,
) -> Result<RepoFilePreview, String> {
    run_blocking("预览 GitHub Actions artifact 文件", move || {
        let requested_path = path.trim().trim_matches('/').replace('\\', "/");
        if requested_path.is_empty()
            || Path::new(&requested_path).components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err("artifact 文件路径无效".to_string());
        }
        let cache_path = ensure_github_artifact_zip(&app, &repo_full_name, artifact_id)?;
        let bytes = fs::read(&cache_path)
            .map_err(|e| format!("读取 artifact 缓存失败：{}（{e}）", cache_path.display()))?;
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
            .map_err(|e| format!("读取 artifact ZIP 失败：{e}"))?;
        for index in 0..archive.len() {
            let mut file = archive
                .by_index(index)
                .map_err(|e| format!("读取 artifact ZIP 条目失败：{e}"))?;
            let Some(enclosed_name) = file.enclosed_name() else {
                continue;
            };
            let entry_path = github_artifact_entry_path(&enclosed_name)?;
            if entry_path != requested_path {
                continue;
            }
            if file.is_dir() {
                return Err("不能预览 artifact 目录".to_string());
            }
            let size = file.size();
            if size > super::file_browser::MAX_FILE_PREVIEW_BYTES {
                return Ok(github_artifact_preview_from_bytes(
                    entry_path,
                    size,
                    Vec::new(),
                ));
            }
            let mut file_bytes = Vec::with_capacity(size as usize);
            file.read_to_end(&mut file_bytes)
                .map_err(|e| format!("读取 artifact 文件失败：{e}"))?;
            return Ok(github_artifact_preview_from_bytes(
                entry_path, size, file_bytes,
            ));
        }
        Err("artifact 文件不存在".to_string())
    })
    .await
}

#[tauri::command]
pub async fn github_list_repo_commits(
    app: AppHandle,
    repo_full_name: String,
    per_page: Option<u32>,
    sha: Option<String>,
    force_refresh: Option<bool>,
) -> Result<Vec<CommitSummary>, String> {
    run_blocking("读取 GitHub 提交历史", move || {
        let sha = sha
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let commits_key = github_commit_list_cache_key(per_page, sha.as_deref());
        let cache_key = github_project_cache_repo_key(&repo_full_name)?;
        if github_project_cache_enabled(force_refresh) {
            if let Some(cached) = load_github_project_cache(&app)
                .repos
                .get(&cache_key)
                .and_then(|repo_cache| repo_cache.commits.get(&commits_key).cloned())
            {
                return Ok(cached);
            }
        }
        let (_binding, token) = github_require_token(&app)?;
        let commits_per_page = per_page.unwrap_or(100).clamp(1, 100).to_string();
        let client = build_client()?;
        let mut request = client
            .get(format!("{}/commits", github_repo_api_url(&repo_full_name)?))
            .query(&[("per_page", commits_per_page.as_str())]);
        if let Some(sha) = sha.as_deref() {
            request = request.query(&[("sha", sha)]);
        }
        let response = github_send(
            &app,
            "读取 GitHub 提交历史失败",
            github_headers(request, Some(&token)),
        )?;
        let commits =
            github_json::<Vec<GitHubCommitResponse>>("读取 GitHub 提交历史失败", response)?
                .into_iter()
                .map(github_commit_summary_from_response)
                .collect::<Vec<_>>();
        update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
            repo_cache.commits.insert(commits_key, commits.clone());
        })?;
        Ok(commits)
    })
    .await
}

#[tauri::command]
pub async fn github_get_repo_commit_detail(
    app: AppHandle,
    repo_full_name: String,
    hash: String,
    force_refresh: Option<bool>,
) -> Result<CommitDetail, String> {
    run_blocking("读取 GitHub 提交详情", move || {
        let hash = hash.trim().to_string();
        if hash.is_empty() {
            return Err("提交 hash 不能为空".to_string());
        }
        let cache_key = github_project_cache_repo_key(&repo_full_name)?;
        if github_project_cache_enabled(force_refresh) {
            if let Some(cached) = load_github_project_cache(&app)
                .repos
                .get(&cache_key)
                .and_then(|repo_cache| {
                    repo_cache.commit_details.get(&hash).cloned().or_else(|| {
                        repo_cache
                            .commit_details
                            .values()
                            .find(|detail| detail.hash == hash || detail.short_hash == hash)
                            .cloned()
                    })
                })
            {
                return Ok(cached);
            }
        }
        let (_binding, token) = github_require_token(&app)?;
        let client = build_client()?;
        let response = github_send(
            &app,
            "读取 GitHub 提交详情失败",
            github_headers(
                client.get(format!(
                    "{}/commits/{}",
                    github_repo_api_url(&repo_full_name)?,
                    hash
                )),
                Some(&token),
            ),
        )?;
        let detail = github_commit_detail_from_response(github_json::<GitHubCommitResponse>(
            "读取 GitHub 提交详情失败",
            response,
        )?);
        update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
            repo_cache
                .commit_details
                .insert(detail.hash.clone(), detail.clone());
            repo_cache
                .commit_details
                .insert(detail.short_hash.clone(), detail.clone());
        })?;
        Ok(detail)
    })
    .await
}

#[tauri::command]
pub async fn github_list_repo_files(
    app: AppHandle,
    repo_full_name: String,
    parent_path: Option<String>,
    ref_name: Option<String>,
    _force_refresh: Option<bool>,
) -> Result<Vec<RepoFileTreeEntry>, String> {
    run_blocking("读取 GitHub 文件树", move || {
        let (_binding, token) = github_require_token(&app)?;
        let client = build_client()?;
        let mut request = client.get(github_repo_contents_api_url(
            &repo_full_name,
            parent_path.as_deref(),
        )?);
        if let Some(ref_name) = normalize_github_ref_name(ref_name.as_deref()) {
            request = request.query(&[("ref", ref_name)]);
        }
        let response = github_send(
            &app,
            "读取 GitHub 文件树失败",
            github_headers(request, Some(&token)),
        )?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(Vec::new());
        }
        let items = github_json::<Vec<GitHubContentListItem>>("读取 GitHub 文件树失败", response)?;
        Ok(github_content_items_to_file_entries(items))
    })
    .await
}

#[tauri::command]
pub async fn github_get_repo_file_preview(
    app: AppHandle,
    repo_full_name: String,
    path: String,
    ref_name: Option<String>,
    _force_refresh: Option<bool>,
) -> Result<RepoFilePreview, String> {
    run_blocking("读取 GitHub 文件预览", move || {
        let path = normalize_github_content_path(Some(&path))?;
        if path.is_empty() {
            return Err("GitHub 文件路径不能为空".to_string());
        }
        let (_binding, token) = github_require_token(&app)?;
        let client = build_client()?;
        let mut request = client.get(github_repo_contents_api_url(&repo_full_name, Some(&path))?);
        if let Some(ref_name) = normalize_github_ref_name(ref_name.as_deref()) {
            request = request.query(&[("ref", ref_name)]);
        }
        let response = github_send(
            &app,
            "读取 GitHub 文件预览失败",
            github_headers(request, Some(&token)),
        )?;
        let file = github_json::<GitHubContentFileResponse>("读取 GitHub 文件预览失败", response)?;
        github_file_preview_from_content("读取 GitHub 文件预览失败", file)
    })
    .await
}

#[tauri::command]
pub async fn github_list_repo_contribution(
    app: AppHandle,
    repo_full_name: String,
) -> Result<GitHubContributionResult, String> {
    run_blocking("读取本地提交贡献", move || {
        let end_day_index = current_utc_day_index();
        let start_day_index = end_day_index - GITHUB_CONTRIBUTION_DAYS as i64 + 1;
        let Some(repo_id) = normalize_local_contribution_repo_id(&repo_full_name) else {
            return Ok(GitHubContributionResult {
                days: github_contribution_days(&HashMap::new(), end_day_index),
                meta: github_contribution_meta(0, 0, 0),
            });
        };
        let path = repo_path_by_id(&app, &repo_id)?;
        let today = format_day_index(end_day_index);
        let mut settings = load_settings(&app);
        let mut counts: HashMap<String, usize> = HashMap::new();
        if let Some(count) = cached_local_contribution_count(&settings, &repo_id, &today) {
            collect_local_contribution_counts(
                &path,
                start_day_index,
                end_day_index - 1,
                &mut counts,
            )?;
            counts.insert(today, count);
        } else {
            collect_local_contribution_counts(&path, start_day_index, end_day_index, &mut counts)?;
            let today_count = counts.get(&today).copied().unwrap_or_default();
            write_local_contribution_cache(&mut settings, &repo_id, &today, today_count);
            save_settings(&app, &settings)?;
        }
        Ok(GitHubContributionResult {
            days: github_contribution_days(&counts, end_day_index),
            meta: github_contribution_meta(1, 1, 0),
        })
    })
    .await
}

use super::*;

pub(super) const GITHUB_CLIENT_ID: &str = "Ov23liJWTEjz4jgqx19u";
pub(super) const GITHUB_SCOPE: &str = "repo workflow read:user delete_repo";
pub(super) const GITHUB_DELETE_REPO_SCOPE: &str = "delete_repo";
pub(super) const GITHUB_SERVICE: &str = "com.lilia.desktop.github";
pub(super) const GITHUB_ACCEPT: &str = "application/vnd.github+json";
pub(super) const GITHUB_OAUTH_ACCEPT: &str = "application/json";
pub(super) const GITHUB_USER_AGENT: &str = "LiliaGithub/0.1";
pub(super) const GITHUB_CONTRIBUTIONS_REPO_LIMIT: usize = 30;
pub(super) const GITHUB_CONTRIBUTION_DAYS: usize = 371;
pub(super) const GITHUB_PROJECT_CACHE_KEY: &str = "workspace.githubProjectCache";

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
pub(super) struct GitHubIssueResponse {
    pub(super) number: u64,
    pub(super) title: String,
    pub(super) state: String,
    pub(super) body: Option<String>,
    pub(super) html_url: String,
    pub(super) updated_at: String,
    pub(super) created_at: String,
    #[serde(default)]
    pub(super) labels: Vec<GitHubLabelResponse>,
    #[serde(default)]
    pub(super) assignees: Vec<GitHubAssigneeResponse>,
    #[serde(default)]
    pub(super) pull_request: Option<serde_json::Value>,
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
    })
}

pub(super) fn clear_github_project_pull_request_cache(
    app: &AppHandle,
    repo_full_name: &str,
) -> Result<(), String> {
    update_github_project_repo_cache(app, repo_full_name, |repo_cache| {
        repo_cache.pull_requests.clear();
        repo_cache.pull_request_checks.clear();
    })
}

pub(super) fn github_issue_cache_key(
    state: Option<&str>,
    per_page: Option<u32>,
    sort: Option<&str>,
    direction: Option<&str>,
    since: Option<&str>,
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
    format!("{issue_state}|{issue_per_page}|{issue_sort}|{issue_direction}|{issue_since}")
}

pub(super) fn github_pull_request_cache_key(state: Option<&str>) -> String {
    match state {
        Some("closed") => "closed",
        Some("all") => "all",
        _ => "open",
    }
    .to_string()
}

pub(super) fn github_workflow_runs_cache_key(per_page: Option<u32>) -> String {
    per_page.unwrap_or(30).clamp(1, 100).to_string()
}

pub(super) fn github_commit_list_cache_key(per_page: Option<u32>, sha: Option<&str>) -> String {
    let commit_per_page = per_page.unwrap_or(100).clamp(1, 100);
    let commit_sha = sha.map(str::trim).filter(|value| !value.is_empty()).unwrap_or("");
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

pub(super) fn github_require_scope(
    binding: &GitHubBindingMetadata,
    scope: &str,
) -> Result<(), String> {
    if binding.scopes.iter().any(|item| item == scope) {
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
    let response = builder.send().map_err(|e| {
        format!("{prefix}：GitHub API 连接失败，请检查网络、代理或系统证书：{e}")
    })?;
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
            .then_with(|| left.name.to_ascii_lowercase().cmp(&right.name.to_ascii_lowercase()))
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
            data_url: Some(format!("data:{image_mime};base64,{}", STANDARD.encode(bytes))),
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

pub(super) fn github_pull_request_from_response(
    pull_request: GitHubPullRequestResponse,
) -> GitHubPullRequest {
    GitHubPullRequest {
        number: pull_request.number,
        title: pull_request.title,
        state: pull_request.state,
        draft: pull_request.draft,
        body: pull_request.body,
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
        parents: commit.parents.into_iter().map(|parent| parent.sha).collect(),
        refs: Vec::new(),
    }
}

pub(super) fn github_commit_detail_from_response(commit: GitHubCommitResponse) -> CommitDetail {
    let author = commit.commit.author.as_ref();
    let committer = commit.commit.committer.as_ref();
    let mut message_lines = commit.commit.message.lines();
    let subject = message_lines.next().unwrap_or("").trim().to_string();
    let body = message_lines.collect::<Vec<_>>().join("\n").trim().to_string();
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
        parents: commit.parents.into_iter().map(|parent| parent.sha).collect(),
        refs: Vec::new(),
        files: github_commit_file_changes(commit.files),
    }
}

pub(super) fn github_commit_file_changes(files: Vec<GitHubCommitFileResponse>) -> Vec<CommitFileChange> {
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
    let second = time_parts
        .next()?
        .split('.')
        .next()?
        .parse::<i64>()
        .ok()?;
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
    let topics = github_json::<GitHubRepoTopicsResponse>(
        "读取 GitHub 仓库 topics 失败",
        topics_response,
    )?;
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
    force_refresh: Option<bool>,
) -> Result<Vec<GitHubPullRequest>, String> {
    run_blocking("读取 GitHub Pull Requests", move || {
        let pull_key = github_pull_request_cache_key(state.as_deref());
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
        let (_binding, token) = github_require_token(&app)?;
        let pull_state = match state.as_deref() {
            Some("closed") => "closed",
            Some("all") => "all",
            _ => "open",
        };
        let client = build_client()?;
        let response = github_send(
            &app,
            "读取 GitHub Pull Requests 失败",
            github_headers(
                client
                    .get(format!("{}/pulls", github_repo_api_url(&repo_full_name)?))
                    .query(&[("state", pull_state), ("per_page", "50"), ("sort", "updated"), ("direction", "desc")]),
                Some(&token),
            ),
        )?;
        let pull_requests = github_json::<Vec<GitHubPullRequestResponse>>(
            "读取 GitHub Pull Requests 失败",
            response,
        )?;
        let pulls = pull_requests
            .into_iter()
            .map(github_pull_request_from_response)
            .collect::<Vec<_>>();
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
        let pull_request = github_json::<GitHubPullRequestResponse>(
            "创建 GitHub Pull Request 失败",
            response,
        )?;
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
        let pull_request = github_json::<GitHubPullRequestResponse>(
            "更新 GitHub Pull Request 失败",
            response,
        )?;
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
            payload.insert("commit_message".to_string(), serde_json::Value::String(value));
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
    force_refresh: Option<bool>,
) -> Result<Vec<GitHubIssue>, String> {
    run_blocking("读取 GitHub Issue", move || {
        let issue_key = github_issue_cache_key(
            state.as_deref(),
            per_page,
            sort.as_deref(),
            direction.as_deref(),
            since.as_deref(),
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
        let issues = issues
            .into_iter()
            .filter_map(github_issue_from_response)
            .collect::<Vec<_>>();
        update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
            repo_cache.issues.insert(issue_key, issues.clone());
        })?;
        Ok(issues)
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
                .get(format!("{}/{}", github_repo_api_url(repo_full_name)?, endpoint))
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

#[tauri::command]
pub async fn github_list_issue_labels(
    app: AppHandle,
    repo_full_name: String,
    force_refresh: Option<bool>,
) -> Result<Vec<String>, String> {
    run_blocking("读取 GitHub Issue Labels", move || {
        list_github_issue_values(
            &app,
            &repo_full_name,
            force_refresh,
            |repo_cache| repo_cache.issue_labels.clone(),
            |repo_cache, labels| repo_cache.issue_labels = Some(labels),
            "labels",
            "读取 GitHub Issue Labels 失败",
            |response| Ok(github_json::<Vec<GitHubLabelResponse>>("读取 GitHub Issue Labels 失败", response)?
                .into_iter()
                .map(|label| label.name)
                .filter(|label| !label.trim().is_empty())
                .collect()),
        )
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
        list_github_issue_values(
            &app,
            &repo_full_name,
            force_refresh,
            |repo_cache| repo_cache.issue_assignees.clone(),
            |repo_cache, assignees| repo_cache.issue_assignees = Some(assignees),
            "assignees",
            "读取 GitHub Issue Assignees 失败",
            |response| Ok(github_json::<Vec<GitHubAssigneeResponse>>(
                "读取 GitHub Issue Assignees 失败",
                response,
            )?
            .into_iter()
            .map(|assignee| assignee.login)
            .filter(|assignee| !assignee.trim().is_empty())
            .collect()),
        )
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
pub async fn github_list_repo_commits(
    app: AppHandle,
    repo_full_name: String,
    per_page: Option<u32>,
    sha: Option<String>,
    force_refresh: Option<bool>,
) -> Result<Vec<CommitSummary>, String> {
    run_blocking("读取 GitHub 提交历史", move || {
        let sha = sha.map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
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
        let commits = github_json::<Vec<GitHubCommitResponse>>(
            "读取 GitHub 提交历史失败",
            response,
        )?
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
                    repo_cache
                        .commit_details
                        .get(&hash)
                        .cloned()
                        .or_else(|| {
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

#[tauri::command]
pub async fn github_list_repo_readmes(
    app: AppHandle,
    repo_full_name: String,
    force_refresh: Option<bool>,
) -> Result<Vec<RepoReadme>, String> {
    run_blocking("读取 GitHub README", move || {
        let cache_key = github_project_cache_repo_key(&repo_full_name)?;
        if github_project_cache_enabled(force_refresh) {
            if let Some(cached) = load_github_project_cache(&app)
                .repos
                .get(&cache_key)
                .and_then(|repo_cache| repo_cache.readmes.clone())
            {
                return Ok(cached);
            }
        }
        let readmes = read_github_repo_readmes(&app, &repo_full_name)?;
        update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
            repo_cache.readmes = Some(readmes.clone());
        })?;
        Ok(readmes)
    })
    .await
}

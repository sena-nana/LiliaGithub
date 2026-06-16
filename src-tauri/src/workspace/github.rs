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
    let response = builder.send().map_err(|e| format!("{prefix}：{e}"))?;
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
) -> GitHubRepoManagement {
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

pub(super) fn github_update_repo_settings_payload(
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

pub(super) fn github_branch_from_response(branch: GitHubBranchResponse) -> BranchSummary {
    BranchSummary {
        name: branch.name,
        remote: true,
        current: false,
        upstream: None,
        ahead: 0,
        behind: 0,
        protected: branch.protected,
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
            github_headers(
                client.get(github_repo_api_url(&repo_full_name)?),
                Some(&token),
            ),
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
            github_headers(
                client.delete(github_repo_api_url(&repo_full_name)?),
                Some(&token),
            ),
        )?;
        if !response.status().is_success() {
            return Err(github_http_error("删除 GitHub 仓库失败", response));
        }
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
        Ok(issues
            .into_iter()
            .filter_map(github_issue_from_response)
            .collect())
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
        github_issue_from_response(issue)
            .ok_or_else(|| "GitHub 返回了 Pull Request 记录".to_string())
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
        github_issue_from_response(issue)
            .ok_or_else(|| "GitHub 返回了 Pull Request 记录".to_string())
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
                    .get(format!(
                        "{}/actions/runs",
                        github_repo_api_url(&repo_full_name)?
                    ))
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
) -> Result<Vec<RepoReadme>, String> {
    run_blocking("读取 GitHub README", move || {
        read_github_repo_readmes(&app, &repo_full_name)
    })
    .await
}

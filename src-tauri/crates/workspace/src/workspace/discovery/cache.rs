use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::github::{
    build_client, github_headers, github_json, github_project_cache_repo_key, github_repo_api_url,
    github_require_token, github_send,
};
use crate::workspace::operations::OperationKind;
use crate::workspace::run_core_operation;
use lilia_github_contracts::discovery::GitHubDiscoveryRepositoryStatus;
use lilia_github_contracts::workspace::GitHubRepositoryPermissions;
use serde::Deserialize;

type RepositoryStatusCacheKey = (String, String);

#[derive(Debug, Deserialize)]
struct RepositoryStatusResponse {
    full_name: String,
    updated_at: String,
    private: bool,
    #[serde(default)]
    archived: bool,
    #[serde(default)]
    disabled: bool,
    #[serde(default)]
    permissions: GitHubRepositoryPermissions,
    #[serde(default)]
    allow_merge_commit: bool,
    #[serde(default)]
    allow_squash_merge: bool,
    #[serde(default)]
    allow_rebase_merge: bool,
    html_url: String,
}

fn repository_status_cache(
) -> &'static Mutex<HashMap<RepositoryStatusCacheKey, GitHubDiscoveryRepositoryStatus>> {
    static CACHE: OnceLock<
        Mutex<HashMap<RepositoryStatusCacheKey, GitHubDiscoveryRepositoryStatus>>,
    > = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

impl From<RepositoryStatusResponse> for GitHubDiscoveryRepositoryStatus {
    fn from(response: RepositoryStatusResponse) -> Self {
        Self {
            full_name: response.full_name,
            updated_at: response.updated_at,
            private: response.private,
            archived: response.archived,
            disabled: response.disabled,
            permissions: response.permissions,
            allow_merge_commit: response.allow_merge_commit,
            allow_squash_merge: response.allow_squash_merge,
            allow_rebase_merge: response.allow_rebase_merge,
            html_url: response.html_url,
        }
    }
}

pub(crate) fn clear_repository_status_cache() {
    repository_status_cache()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clear();
}

pub(crate) fn invalidate_repository_status(repo_full_name: &str) {
    let Ok(repo_key) = github_project_cache_repo_key(repo_full_name) else {
        return;
    };
    repository_status_cache()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .retain(|(_, cached_repo), _| cached_repo != &repo_key);
}

pub async fn github_discovery_get_repository_status(
    app: AppHandle,
    repo_full_name: String,
    force_refresh: Option<bool>,
) -> Result<GitHubDiscoveryRepositoryStatus, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取跨仓库状态",
        move || {
            let (binding, token) = github_require_token(&app)?;
            let repo_key = github_project_cache_repo_key(&repo_full_name)?;
            let cache_key = (binding.login.to_ascii_lowercase(), repo_key);
            if !force_refresh.unwrap_or(false) {
                if let Some(cached) = repository_status_cache()
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .get(&cache_key)
                    .cloned()
                {
                    return Ok(cached);
                }
            }
            let client = build_client()?;
            let response = github_send(
                &app,
                "读取跨仓库状态失败",
                github_headers(
                    client.get(github_repo_api_url(&repo_full_name)?),
                    Some(&token),
                ),
            )?;
            let status = GitHubDiscoveryRepositoryStatus::from(github_json::<
                RepositoryStatusResponse,
            >(
                "读取跨仓库状态失败", response
            )?);
            repository_status_cache()
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .insert(cache_key, status.clone());
            Ok(status)
        },
    )
    .await
}

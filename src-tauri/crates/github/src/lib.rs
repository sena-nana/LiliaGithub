use base64::{engine::general_purpose::STANDARD, Engine as _};
use lilia_github_contracts::workspace::{
    GitHubBindingMetadata, GitHubBindingState, GitHubBindingStatus, GitHubIssue,
    GitHubIssueMilestone, GitHubIssueProjectItem,
};
use serde::Deserialize;
use std::time::Duration;

pub mod discussions;

pub const GITHUB_CLIENT_ID: &str = "Ov23liJWTEjz4jgqx19u";
pub const GITHUB_DELETE_REPO_SCOPE: &str = "delete_repo";
pub const GITHUB_READ_PROJECT_SCOPE: &str = "read:project";
pub const GITHUB_RELEASE_ASSET_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const GITHUB_JSON_TIMEOUT: Duration = Duration::from_secs(8);
pub const GITHUB_TRANSFER_TIMEOUT: Duration = Duration::from_secs(30 * 60);

pub struct GitHubApiClient {
    json: Option<reqwest::blocking::Client>,
    transfer: Option<reqwest::blocking::Client>,
}

impl GitHubApiClient {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            json: Some(
                reqwest::blocking::Client::builder()
                    .timeout(GITHUB_JSON_TIMEOUT)
                    .build()
                    .map_err(|error| format!("构造 GitHub JSON 客户端失败：{error}"))?,
            ),
            transfer: Some(
                reqwest::blocking::Client::builder()
                    .timeout(GITHUB_TRANSFER_TIMEOUT)
                    .build()
                    .map_err(|error| format!("构造 GitHub 传输客户端失败：{error}"))?,
            ),
        })
    }

    pub fn json(&self) -> reqwest::blocking::Client {
        self.json
            .as_ref()
            .expect("GitHubApiClient is alive")
            .clone()
    }

    pub fn transfer(&self) -> reqwest::blocking::Client {
        self.transfer
            .as_ref()
            .expect("GitHubApiClient is alive")
            .clone()
    }
}

impl Drop for GitHubApiClient {
    fn drop(&mut self) {
        let clients = (self.json.take(), self.transfer.take());
        let _ = std::thread::Builder::new()
            .name("github-client-drop".to_string())
            .spawn(move || drop(clients))
            .and_then(|thread| {
                thread
                    .join()
                    .map_err(|_| std::io::Error::other("GitHub client drop thread panicked"))
            });
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedGitHubRepo {
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub clone_url: String,
}

#[derive(Debug, Deserialize)]
pub struct GitHubGraphQlError {
    pub message: String,
}

pub fn client_id() -> Option<&'static str> {
    let trimmed = GITHUB_CLIENT_ID.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

pub fn client_id_source() -> &'static str {
    if client_id().is_some() {
        "bundled"
    } else {
        "none"
    }
}

pub fn binding_status(binding: Option<GitHubBindingMetadata>) -> GitHubBindingStatus {
    GitHubBindingStatus {
        state: if binding.is_some() {
            GitHubBindingState::Bound
        } else {
            GitHubBindingState::Unbound
        },
        client_id_configured: client_id().is_some(),
        client_id_source: client_id_source().to_string(),
        binding,
    }
}

pub fn normalize_scope_list(scope: Option<&str>) -> Vec<String> {
    scope
        .unwrap_or("")
        .split(|ch: char| ch == ',' || ch.is_whitespace())
        .filter(|part| !part.trim().is_empty())
        .map(|part| part.trim().to_string())
        .collect()
}

pub fn github_binding_has_scope(binding: &GitHubBindingMetadata, scope: &str) -> bool {
    binding.scopes.iter().any(|item| item == scope)
}

pub fn github_require_scope(binding: &GitHubBindingMetadata, scope: &str) -> Result<(), String> {
    if github_binding_has_scope(binding, scope) {
        return Ok(());
    }
    Err(format!(
        "GitHub 绑定缺少 {scope} 权限，请重新绑定 GitHub 后再试"
    ))
}

pub fn github_auth_header(token: &str) -> String {
    let encoded = STANDARD.encode(format!("x-access-token:{token}"));
    format!("AUTHORIZATION: basic {encoded}")
}

pub fn github_release_validate_asset_file_size(size: u64) -> Result<(), String> {
    if size > GITHUB_RELEASE_ASSET_MAX_BYTES {
        return Err(format!(
            "Release asset 文件过大：最大支持 {} MB",
            GITHUB_RELEASE_ASSET_MAX_BYTES / 1024 / 1024
        ));
    }
    Ok(())
}

pub fn normalize_github_repo_input(input: &str) -> Result<NormalizedGitHubRepo, String> {
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

pub fn github_project_cache_repo_key(repo_full_name: &str) -> Result<String, String> {
    Ok(normalize_github_repo_input(repo_full_name)?
        .full_name
        .to_ascii_lowercase())
}

#[derive(Clone, Copy, Debug, Default)]
pub struct GitHubIssueCacheQuery<'a> {
    pub state: Option<&'a str>,
    pub per_page: Option<u32>,
    pub sort: Option<&'a str>,
    pub direction: Option<&'a str>,
    pub since: Option<&'a str>,
    pub creator: Option<&'a str>,
    pub assignee: Option<&'a str>,
    pub labels: Option<&'a [String]>,
    pub milestone: Option<&'a str>,
    pub project: Option<&'a str>,
    pub query: Option<&'a str>,
}

pub fn github_issue_cache_key(filter: GitHubIssueCacheQuery<'_>) -> String {
    let mut issue_labels = filter
        .labels
        .unwrap_or(&[])
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    issue_labels.sort();
    serde_json::json!({
        "state": filter.state.unwrap_or("open"),
        "perPage": filter.per_page.unwrap_or(100).clamp(1, 100),
        "sort": match filter.sort {
            Some("updated") => "updated",
            Some("comments") => "comments",
            _ => "created",
        },
        "direction": match filter.direction {
            Some("asc") => "asc",
            _ => "desc",
        },
        "since": trimmed_or_empty(filter.since),
        "creator": trimmed_or_empty(filter.creator),
        "assignee": trimmed_or_empty(filter.assignee),
        "labels": issue_labels,
        "milestone": trimmed_or_empty(filter.milestone),
        "project": trimmed_or_empty(filter.project),
        "query": trimmed_or_empty(filter.query),
    })
    .to_string()
}

#[derive(Clone, Copy, Debug, Default)]
pub struct GitHubPullRequestCacheQuery<'a> {
    pub state: Option<&'a str>,
    pub per_page: Option<u32>,
    pub sort: Option<&'a str>,
    pub direction: Option<&'a str>,
    pub creator: Option<&'a str>,
    pub assignee: Option<&'a str>,
    pub labels: Option<&'a [String]>,
    pub milestone: Option<&'a str>,
    pub project: Option<&'a str>,
    pub review: Option<&'a str>,
    pub query: Option<&'a str>,
}

pub fn github_pull_request_cache_key(filter: GitHubPullRequestCacheQuery<'_>) -> String {
    let mut labels = filter
        .labels
        .unwrap_or(&[])
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    labels.sort();
    serde_json::json!({
        "state": match filter.state {
            Some("closed") => "closed",
            Some("merged") => "merged",
            Some("all") => "all",
            _ => "open",
        },
        "perPage": filter.per_page.unwrap_or(100).clamp(1, 100),
        "sort": match filter.sort {
            Some("created") => "created",
            Some("comments") => "comments",
            _ => "updated",
        },
        "direction": match filter.direction {
            Some("asc") => "asc",
            _ => "desc",
        },
        "creator": trimmed_or_empty(filter.creator),
        "assignee": trimmed_or_empty(filter.assignee),
        "labels": labels,
        "milestone": trimmed_or_empty(filter.milestone),
        "project": trimmed_or_empty(filter.project),
        "review": trimmed_or_empty(filter.review),
        "query": trimmed_or_empty(filter.query),
    })
    .to_string()
}

fn trimmed_or_empty(value: Option<&str>) -> &str {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("")
}

pub fn parse_next_page(link: Option<&str>) -> Option<u32> {
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

pub fn github_graphql_errors_require_read_project(errors: &[GitHubGraphQlError]) -> bool {
    !errors.is_empty()
        && errors.iter().all(|error| {
            let message = error.message.as_str();
            message.contains(GITHUB_READ_PROJECT_SCOPE) && message.contains("scopes")
        })
}

pub fn github_issue_filter_metadata_from_issues(
    issues: &[GitHubIssue],
) -> lilia_github_contracts::workspace::GitHubIssueFilterMetadata {
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

    lilia_github_contracts::workspace::GitHubIssueFilterMetadata {
        authors,
        labels,
        assignees,
        milestones,
        projects,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_github_repo_input_accepts_owner_repo_and_urls() {
        let short = normalize_github_repo_input("sena-nana/LiliaGithub").unwrap();
        assert_eq!(short.owner, "sena-nana");
        assert_eq!(short.name, "LiliaGithub");
        assert_eq!(
            short.clone_url,
            "https://github.com/sena-nana/LiliaGithub.git"
        );

        let url =
            normalize_github_repo_input("https://github.com/sena-nana/LiliaGithub.git").unwrap();
        assert_eq!(url.full_name, "sena-nana/LiliaGithub");
        assert!(normalize_github_repo_input("https://example.com/sena-nana/LiliaGithub").is_err());
    }

    #[test]
    fn parses_github_next_page_from_link_header() {
        let link = r#"<https://api.github.com/repositories/1/issues?page=2>; rel="next", <https://api.github.com/repositories/1/issues?page=5>; rel="last""#;
        assert_eq!(parse_next_page(Some(link)), Some(2));
        assert_eq!(parse_next_page(None), None);
    }

    #[test]
    fn github_scope_checks_use_binding_scopes() {
        let binding = GitHubBindingMetadata {
            login: "octo".to_string(),
            avatar_url: None,
            bound_at: 1,
            scopes: vec!["repo".to_string(), GITHUB_READ_PROJECT_SCOPE.to_string()],
            client_id_source: "test".to_string(),
        };

        assert!(github_binding_has_scope(
            &binding,
            GITHUB_READ_PROJECT_SCOPE
        ));
        assert!(github_require_scope(&binding, GITHUB_READ_PROJECT_SCOPE).is_ok());
        assert!(github_require_scope(&binding, GITHUB_DELETE_REPO_SCOPE).is_err());
    }

    #[test]
    fn github_project_cache_keys_are_normalized_and_parameterized() {
        assert_eq!(
            github_project_cache_repo_key("https://github.com/Sena-Nana/LiliaGithub.git").unwrap(),
            "sena-nana/liliagithub"
        );
        assert_ne!(
            github_issue_cache_key(GitHubIssueCacheQuery {
                state: Some("open"),
                per_page: Some(10),
                sort: Some("created"),
                direction: Some("desc"),
                labels: Some(&["bug".to_string()]),
                query: Some("alpha"),
                ..GitHubIssueCacheQuery::default()
            },),
            github_issue_cache_key(GitHubIssueCacheQuery {
                state: Some("open"),
                per_page: Some(10),
                sort: Some("created"),
                direction: Some("desc"),
                labels: Some(&["bug".to_string()]),
                query: Some("beta"),
                ..GitHubIssueCacheQuery::default()
            },),
        );
    }
}

use base64::{engine::general_purpose::STANDARD, Engine as _};
use lilia_github_contracts::workspace::{
    GitHubBindingMetadata, GitHubBindingStatus, GitHubIssue, GitHubIssueMilestone,
    GitHubIssueProjectItem,
};
use serde::Deserialize;

pub const GITHUB_CLIENT_ID: &str = "Ov23liJWTEjz4jgqx19u";
pub const GITHUB_DELETE_REPO_SCOPE: &str = "delete_repo";
pub const GITHUB_READ_PROJECT_SCOPE: &str = "read:project";
pub const GITHUB_RELEASE_ASSET_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;

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
            "bound".to_string()
        } else {
            "unbound".to_string()
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

pub fn github_issue_cache_key(
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
    let mut issue_labels = labels
        .unwrap_or(&[])
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    issue_labels.sort();
    serde_json::json!({
        "state": state.unwrap_or("open"),
        "perPage": per_page.unwrap_or(100).clamp(1, 100),
        "sort": match sort {
            Some("updated") => "updated",
            Some("comments") => "comments",
            _ => "created",
        },
        "direction": match direction {
            Some("asc") => "asc",
            _ => "desc",
        },
        "since": trimmed_or_empty(since),
        "creator": trimmed_or_empty(creator),
        "assignee": trimmed_or_empty(assignee),
        "labels": issue_labels,
        "milestone": trimmed_or_empty(milestone),
        "project": trimmed_or_empty(project),
        "query": trimmed_or_empty(query),
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
            github_issue_cache_key(
                Some("open"),
                Some(10),
                Some("created"),
                Some("desc"),
                None,
                None,
                None,
                Some(&["bug".to_string()]),
                None,
                None,
                Some("alpha"),
            ),
            github_issue_cache_key(
                Some("open"),
                Some(10),
                Some("created"),
                Some("desc"),
                None,
                None,
                None,
                Some(&["bug".to_string()]),
                None,
                None,
                Some("beta"),
            ),
        );
    }
}

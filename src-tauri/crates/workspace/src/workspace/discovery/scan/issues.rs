use lilia_github_contracts::discovery::{GitHubDiscoveryAssignedIssue, GitHubDiscoverySection};

use super::aggregate::{aggregate_repositories, RepositoryItems, SOURCE_PAGE_SIZE};
use super::time::timestamp;
use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::github::github_list_issues;

pub(super) async fn scan_assigned_issues(
    app: AppHandle,
    repositories: Vec<String>,
    force_refresh: Option<bool>,
) -> GitHubDiscoverySection<GitHubDiscoveryAssignedIssue> {
    let mut section = aggregate_repositories(repositories, move |repo_full_name| {
        let app = app.clone();
        async move {
            let issues = github_list_issues(
                app,
                repo_full_name.clone(),
                Some("open".to_string()),
                Some(SOURCE_PAGE_SIZE),
                Some("updated".to_string()),
                Some("desc".to_string()),
                None,
                None,
                Some("@me".to_string()),
                None,
                None,
                None,
                None,
                force_refresh,
            )
            .await?;
            let truncated = issues.len() >= SOURCE_PAGE_SIZE as usize;
            Ok(RepositoryItems {
                items: issues
                    .into_iter()
                    .filter(|issue| issue.state == "open")
                    .map(|issue| GitHubDiscoveryAssignedIssue {
                        repo_full_name: repo_full_name.clone(),
                        issue,
                    })
                    .collect(),
                truncated,
            })
        }
    })
    .await;
    section.items.sort_by(|left, right| {
        timestamp(&right.issue.updated_at).cmp(&timestamp(&left.issue.updated_at))
    });
    section
}

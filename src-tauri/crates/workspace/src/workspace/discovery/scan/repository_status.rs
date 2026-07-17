use lilia_github_contracts::discovery::{
    GitHubDiscoveryRepositoryStatusItem, GitHubDiscoverySection,
};

use super::aggregate::{aggregate_repositories, RepositoryItems};
use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::discovery::github_discovery_get_repository_status;

pub(super) async fn scan_repository_statuses(
    app: AppHandle,
    repositories: Vec<String>,
    force_refresh: Option<bool>,
) -> GitHubDiscoverySection<GitHubDiscoveryRepositoryStatusItem> {
    aggregate_repositories(repositories, move |repo_full_name| {
        let app = app.clone();
        async move {
            let status =
                github_discovery_get_repository_status(app, repo_full_name.clone(), force_refresh)
                    .await?;
            Ok(RepositoryItems {
                items: vec![GitHubDiscoveryRepositoryStatusItem {
                    repo_full_name,
                    status,
                }],
                truncated: false,
            })
        }
    })
    .await
}

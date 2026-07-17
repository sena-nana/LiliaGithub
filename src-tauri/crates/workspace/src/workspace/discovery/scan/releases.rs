use lilia_github_contracts::discovery::{GitHubDiscoveryRecentRelease, GitHubDiscoverySection};
use lilia_github_contracts::workspace::GitHubRelease;

use super::aggregate::{aggregate_repositories, RepositoryItems, SOURCE_PAGE_SIZE};
use super::time::{is_within_recent_window, timestamp};
use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::github::github_list_releases;
use crate::workspace::shared::now_millis;

pub(super) async fn scan_recent_releases(
    app: AppHandle,
    repositories: Vec<String>,
    force_refresh: Option<bool>,
) -> GitHubDiscoverySection<GitHubDiscoveryRecentRelease> {
    let now = now_millis() / 1_000;
    let mut section = aggregate_repositories(repositories, move |repo_full_name| {
        let app = app.clone();
        async move {
            let releases = github_list_releases(app, repo_full_name.clone(), force_refresh).await?;
            let truncated = releases.len() >= SOURCE_PAGE_SIZE as usize;
            Ok(RepositoryItems {
                items: releases
                    .into_iter()
                    .filter(|release| is_recent_published_release(release, now))
                    .map(|release| GitHubDiscoveryRecentRelease {
                        repo_full_name: repo_full_name.clone(),
                        release,
                    })
                    .collect(),
                truncated,
            })
        }
    })
    .await;
    section.items.sort_by(|left, right| {
        timestamp(right.release.published_at.as_deref().unwrap_or("")).cmp(&timestamp(
            left.release.published_at.as_deref().unwrap_or(""),
        ))
    });
    section
}

fn is_recent_published_release(release: &GitHubRelease, now: i64) -> bool {
    !release.draft
        && release
            .published_at
            .as_deref()
            .is_some_and(|published_at| is_within_recent_window(published_at, now))
}

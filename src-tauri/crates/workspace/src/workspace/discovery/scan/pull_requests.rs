use std::collections::HashMap;
use std::future::Future;

use futures_util::stream::{self, StreamExt};
use lilia_github_contracts::discovery::{
    GitHubDiscoveryPendingPullRequest, GitHubDiscoverySection,
};
use lilia_github_contracts::workspace::GitHubPullRequest;

use super::aggregate::{
    aggregate_repositories, RepositoryItems, REPOSITORY_CONCURRENCY, SOURCE_PAGE_SIZE,
};
use super::time::timestamp;
use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::github::{github_get_pull_request, github_list_pull_requests};

pub(super) async fn scan_pending_pull_requests(
    app: AppHandle,
    repositories: Vec<String>,
    force_refresh: Option<bool>,
) -> GitHubDiscoverySection<GitHubDiscoveryPendingPullRequest> {
    let mut section = aggregate_repositories(repositories, move |repo_full_name| {
        let app = app.clone();
        async move { load_pending_pull_requests(app, repo_full_name, force_refresh).await }
    })
    .await;
    section.items.sort_by(|left, right| {
        timestamp(&right.pull_request.updated_at).cmp(&timestamp(&left.pull_request.updated_at))
    });
    section
}

async fn load_pending_pull_requests(
    app: AppHandle,
    repo_full_name: String,
    force_refresh: Option<bool>,
) -> Result<RepositoryItems<GitHubDiscoveryPendingPullRequest>, String> {
    let (review_requested, assigned) = tokio::join!(
        list_open_pull_requests(
            app.clone(),
            repo_full_name.clone(),
            None,
            Some("review-requested:@me".to_string()),
            force_refresh,
        ),
        list_open_pull_requests(
            app.clone(),
            repo_full_name.clone(),
            Some("@me".to_string()),
            None,
            force_refresh,
        ),
    );
    let review_requested = review_requested?;
    let assigned = assigned?;
    let truncated = review_requested.len() >= SOURCE_PAGE_SIZE as usize
        || assigned.len() >= SOURCE_PAGE_SIZE as usize;
    let candidates = merge_pull_request_candidates(review_requested, assigned);
    let loaded = stream::iter(candidates.into_iter().map(|(number, reasons)| {
        let app = app.clone();
        let repo_full_name = repo_full_name.clone();
        async move {
            github_get_pull_request(app, repo_full_name, number)
                .await
                .map(|pull_request| (pull_request, reasons))
        }
    }))
    .buffer_unordered(REPOSITORY_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;
    let mut items = Vec::with_capacity(loaded.len());
    for result in loaded {
        let (pull_request, reasons) = result?;
        if pull_request.state != "open" || pull_request.draft {
            continue;
        }
        items.push(GitHubDiscoveryPendingPullRequest {
            repo_full_name: repo_full_name.clone(),
            pull_request,
            reasons,
        });
    }
    Ok(RepositoryItems { items, truncated })
}

fn list_open_pull_requests(
    app: AppHandle,
    repo_full_name: String,
    assignee: Option<String>,
    query: Option<String>,
    force_refresh: Option<bool>,
) -> impl Future<Output = Result<Vec<GitHubPullRequest>, String>> {
    github_list_pull_requests(
        app,
        repo_full_name,
        Some("open".to_string()),
        Some(SOURCE_PAGE_SIZE),
        Some("updated".to_string()),
        Some("desc".to_string()),
        None,
        assignee,
        None,
        None,
        None,
        None,
        query,
        force_refresh,
    )
}

fn merge_pull_request_candidates(
    review_requested: Vec<GitHubPullRequest>,
    assigned: Vec<GitHubPullRequest>,
) -> HashMap<u64, Vec<String>> {
    let mut candidates = HashMap::<u64, Vec<String>>::new();
    for (pulls, reason) in [
        (review_requested, "review_requested"),
        (assigned, "assigned"),
    ] {
        for pull_request in pulls {
            let reasons = candidates.entry(pull_request.number).or_default();
            if !reasons.iter().any(|value| value == reason) {
                reasons.push(reason.to_string());
            }
        }
    }
    candidates
}

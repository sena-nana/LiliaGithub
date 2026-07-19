use std::collections::HashMap;
use std::future::Future;

use lilia_github_contracts::home_attention::{
    GitHubHomeAttentionPendingPullRequest, GitHubHomeAttentionPullRequestReason,
    GitHubHomeAttentionSection,
};
use lilia_github_contracts::workspace::GitHubPullRequest;

use super::aggregate::{aggregate_repositories, RepositoryItems, SOURCE_PAGE_SIZE};
use super::time::timestamp;
use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::github::github_list_pull_requests;

pub(super) async fn scan_pending_pull_requests(
    app: AppHandle,
    repositories: Vec<String>,
    force_refresh: Option<bool>,
) -> GitHubHomeAttentionSection<GitHubHomeAttentionPendingPullRequest> {
    let mut section = aggregate_repositories(repositories, move |repo_full_name| {
        let app = app.clone();
        async move { load_pending_pull_requests(app, repo_full_name, force_refresh).await }
    })
    .await;
    section.items.sort_by(|left, right| {
        timestamp(&right.pull_request.updated_at)
            .cmp(&timestamp(&left.pull_request.updated_at))
            .then_with(|| {
                left.repo_full_name
                    .to_ascii_lowercase()
                    .cmp(&right.repo_full_name.to_ascii_lowercase())
            })
            .then_with(|| left.pull_request.number.cmp(&right.pull_request.number))
    });
    section
}

async fn load_pending_pull_requests(
    app: AppHandle,
    repo_full_name: String,
    force_refresh: Option<bool>,
) -> Result<RepositoryItems<GitHubHomeAttentionPendingPullRequest>, String> {
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
    let items = merge_pull_request_candidates(&repo_full_name, review_requested, assigned);
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
    repo_full_name: &str,
    review_requested: Vec<GitHubPullRequest>,
    assigned: Vec<GitHubPullRequest>,
) -> Vec<GitHubHomeAttentionPendingPullRequest> {
    let mut candidates = HashMap::<u64, GitHubHomeAttentionPendingPullRequest>::new();
    for (pulls, reason) in [
        (
            review_requested,
            GitHubHomeAttentionPullRequestReason::ReviewRequested,
        ),
        (assigned, GitHubHomeAttentionPullRequestReason::Assigned),
    ] {
        for pull_request in pulls {
            let candidate = candidates.entry(pull_request.number).or_insert_with(|| {
                GitHubHomeAttentionPendingPullRequest {
                    repo_full_name: repo_full_name.to_string(),
                    pull_request,
                    reasons: Vec::new(),
                }
            });
            if !candidate.reasons.contains(&reason) {
                candidate.reasons.push(reason);
            }
        }
    }
    candidates
        .into_values()
        .filter(|candidate| candidate.pull_request.state == "open" && !candidate.pull_request.draft)
        .collect()
}

use lilia_github_contracts::home_attention::{
    GitHubHomeAttentionFailedWorkflowRun, GitHubHomeAttentionSection,
};
use lilia_github_contracts::workspace::GitHubWorkflowRun;

use super::aggregate::{aggregate_repositories, RepositoryItems, SOURCE_PAGE_SIZE};
use super::time::{is_within_recent_window, timestamp};
use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::github::github_list_workflow_runs;
use crate::workspace::shared::now_millis;

pub(super) async fn scan_failed_workflows(
    app: AppHandle,
    repositories: Vec<String>,
    force_refresh: Option<bool>,
) -> GitHubHomeAttentionSection<GitHubHomeAttentionFailedWorkflowRun> {
    let now = now_millis() / 1_000;
    let mut section = aggregate_repositories(repositories, move |repo_full_name| {
        let app = app.clone();
        async move {
            let runs = github_list_workflow_runs(
                app,
                repo_full_name.clone(),
                Some(SOURCE_PAGE_SIZE),
                force_refresh,
            )
            .await?;
            let truncated = runs.len() >= SOURCE_PAGE_SIZE as usize;
            Ok(RepositoryItems {
                items: runs
                    .into_iter()
                    .filter(|run| is_recent_actionable_workflow(run, now))
                    .map(|run| GitHubHomeAttentionFailedWorkflowRun {
                        repo_full_name: repo_full_name.clone(),
                        run,
                    })
                    .collect(),
                truncated,
            })
        }
    })
    .await;
    section.items.sort_by(|left, right| {
        timestamp(&right.run.updated_at)
            .cmp(&timestamp(&left.run.updated_at))
            .then_with(|| {
                left.repo_full_name
                    .to_ascii_lowercase()
                    .cmp(&right.repo_full_name.to_ascii_lowercase())
            })
            .then_with(|| left.run.id.cmp(&right.run.id))
    });
    section
}

fn is_recent_actionable_workflow(run: &GitHubWorkflowRun, now: i64) -> bool {
    matches!(
        run.conclusion.as_deref(),
        Some("failure" | "timed_out" | "action_required" | "startup_failure")
    ) && is_within_recent_window(
        if run.updated_at.is_empty() {
            &run.created_at
        } else {
            &run.updated_at
        },
        now,
    )
}

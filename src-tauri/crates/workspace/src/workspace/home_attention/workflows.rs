use lilia_github_contracts::home_attention::{
    GitHubHomeAttentionSection, GitHubHomeAttentionWorkflowRun,
};
use lilia_github_contracts::workspace::GitHubWorkflowRun;

use super::aggregate::{aggregate_repositories, RepositoryItems, SOURCE_PAGE_SIZE};
use super::time::{is_within_recent_window, timestamp};
use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::github::github_list_workflow_runs;
use crate::workspace::shared::now_millis;

pub(super) async fn scan_workflow_runs(
    app: AppHandle,
    repositories: Vec<String>,
    force_refresh: Option<bool>,
) -> GitHubHomeAttentionSection<GitHubHomeAttentionWorkflowRun> {
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
                    .map(|run| GitHubHomeAttentionWorkflowRun {
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
        workflow_priority(&left.run)
            .cmp(&workflow_priority(&right.run))
            .then_with(|| workflow_timestamp(&right.run).cmp(&workflow_timestamp(&left.run)))
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
    match run.status.as_str() {
        "queued" | "in_progress" => true,
        "completed" => {
            matches!(
                run.conclusion.as_deref(),
                Some("failure" | "timed_out" | "action_required" | "startup_failure")
            ) && is_within_recent_window(workflow_date(run), now)
        }
        _ => false,
    }
}

fn workflow_priority(run: &GitHubWorkflowRun) -> u8 {
    if run.status == "completed" {
        0
    } else {
        1
    }
}

fn workflow_timestamp(run: &GitHubWorkflowRun) -> i64 {
    timestamp(workflow_date(run))
}

fn workflow_date(run: &GitHubWorkflowRun) -> &str {
    if run.updated_at.is_empty() {
        &run.created_at
    } else {
        &run.updated_at
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_735_689_600;

    fn workflow_run(status: &str, conclusion: Option<&str>, updated_at: &str) -> GitHubWorkflowRun {
        GitHubWorkflowRun {
            id: 42,
            name: "CI".to_string(),
            display_title: "test".to_string(),
            status: status.to_string(),
            conclusion: conclusion.map(str::to_string),
            branch: "main".to_string(),
            event: "push".to_string(),
            html_url: "https://github.com/acme/repo/actions/runs/42".to_string(),
            created_at: updated_at.to_string(),
            updated_at: updated_at.to_string(),
            actor: None,
            head_sha: None,
            run_number: None,
            run_attempt: None,
            workflow_id: None,
            run_started_at: None,
        }
    }

    #[test]
    fn includes_active_runs_without_applying_the_failure_window() {
        for status in ["queued", "in_progress"] {
            let run = workflow_run(status, None, "2020-01-01T00:00:00Z");
            assert!(is_recent_actionable_workflow(&run, NOW));
        }
    }

    #[test]
    fn includes_only_recent_completed_actionable_failures() {
        for conclusion in ["failure", "timed_out", "action_required", "startup_failure"] {
            let run = workflow_run("completed", Some(conclusion), "2024-12-15T00:00:00Z");
            assert!(is_recent_actionable_workflow(&run, NOW), "{conclusion}");
        }

        let expired = workflow_run("completed", Some("failure"), "2024-10-01T00:00:00Z");
        assert!(!is_recent_actionable_workflow(&expired, NOW));
    }

    #[test]
    fn excludes_non_actionable_and_unknown_states() {
        for (status, conclusion) in [
            ("completed", Some("success")),
            ("completed", Some("cancelled")),
            ("completed", Some("skipped")),
            ("waiting", None),
            ("requested", None),
            ("pending", None),
            ("unknown", None),
        ] {
            let run = workflow_run(status, conclusion, "2024-12-15T00:00:00Z");
            assert!(
                !is_recent_actionable_workflow(&run, NOW),
                "{status} {conclusion:?}"
            );
        }
    }
}

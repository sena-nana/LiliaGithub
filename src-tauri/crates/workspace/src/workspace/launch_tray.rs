use std::collections::{HashMap, HashSet};

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::launch::{
    load_launch_history, repo_save_launch_config, repo_start_launch, repo_stop_launch,
};
use crate::workspace::settings::repo_path_by_id;
use lilia_github_contracts::workspace::{ProjectLaunchHistoryEntry, ProjectLaunchStatus};

const STOP_PREFIX: &str = "lilia.github.tray.stop:";
const START_PREFIX: &str = "lilia.github.tray.start:";
const RECENT_LIMIT: usize = 8;
const COMMAND_MAX_CHARS: usize = 40;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaunchTrayMenuNode {
    Separator,
    Item { id: String, label: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LaunchTrayStartTarget {
    repo_id: String,
    command: String,
    cwd: Option<String>,
}

pub fn launch_tray_menu_nodes(app: &AppHandle) -> Vec<LaunchTrayMenuNode> {
    let running = app.launch_runtime().running_launch_statuses();
    compose_launch_tray_menu(&running, &recent_launch_targets(app, &running), |repo_id| {
        launch_repo_display_name(app, repo_id)
    })
}

pub async fn handle_launch_tray_event(app: AppHandle, id: &str) -> Result<(), String> {
    if let Some(repo_id) = id.strip_prefix(STOP_PREFIX) {
        repo_stop_launch(app, repo_id.to_string()).await?;
        return Ok(());
    }
    if let Some(token) = id.strip_prefix(START_PREFIX) {
        let index = token
            .parse::<usize>()
            .map_err(|_| "启动项已失效，请重新打开托盘菜单".to_string())?;
        let running = app.launch_runtime().running_launch_statuses();
        let target = recent_launch_targets(&app, &running)
            .into_iter()
            .nth(index)
            .ok_or_else(|| "启动项已失效，请重新打开托盘菜单".to_string())?;
        repo_save_launch_config(
            app.clone(),
            target.repo_id.clone(),
            target.command,
            target.cwd,
        )?;
        repo_start_launch(app, target.repo_id).await?;
    }
    Ok(())
}

fn recent_launch_targets(
    app: &AppHandle,
    running: &[ProjectLaunchStatus],
) -> Vec<LaunchTrayStartTarget> {
    let running_repos = running
        .iter()
        .map(|status| status.repo_id.as_str())
        .collect::<HashSet<_>>();
    collect_recent_launch_targets(
        flatten_launch_history(load_launch_history(app)),
        |repo_id| !running_repos.contains(repo_id) && launch_repo_available(app, repo_id),
    )
}

fn flatten_launch_history(
    history: HashMap<String, Vec<ProjectLaunchHistoryEntry>>,
) -> Vec<ProjectLaunchHistoryEntry> {
    history.into_values().flatten().collect()
}

fn launch_repo_available(app: &AppHandle, repo_id: &str) -> bool {
    repo_path_by_id(app, repo_id)
        .map(|path| path.is_dir())
        .unwrap_or(false)
}

fn launch_repo_display_name(app: &AppHandle, repo_id: &str) -> String {
    repo_path_by_id(app, repo_id)
        .ok()
        .and_then(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.is_empty())
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| {
            repo_id
                .rsplit('/')
                .next()
                .filter(|name| !name.is_empty())
                .unwrap_or(repo_id)
                .to_string()
        })
}

fn collect_recent_launch_targets(
    mut history: Vec<ProjectLaunchHistoryEntry>,
    include: impl Fn(&str) -> bool,
) -> Vec<LaunchTrayStartTarget> {
    history.sort_by(|left, right| {
        right
            .started_at
            .cmp(&left.started_at)
            .then_with(|| left.repo_id.cmp(&right.repo_id))
            .then_with(|| left.command.cmp(&right.command))
    });
    let mut seen = HashSet::new();
    let mut recent = Vec::new();
    for entry in history {
        if !include(&entry.repo_id) {
            continue;
        }
        let key = (
            entry.repo_id.clone(),
            entry.command.clone(),
            entry.cwd.clone(),
        );
        if !seen.insert(key) {
            continue;
        }
        recent.push(LaunchTrayStartTarget {
            repo_id: entry.repo_id,
            command: entry.command,
            cwd: entry.cwd,
        });
        if recent.len() >= RECENT_LIMIT {
            break;
        }
    }
    recent
}

fn compose_launch_tray_menu(
    running: &[ProjectLaunchStatus],
    recent: &[LaunchTrayStartTarget],
    repo_name: impl Fn(&str) -> String,
) -> Vec<LaunchTrayMenuNode> {
    let mut nodes = running
        .iter()
        .map(|status| LaunchTrayMenuNode::Item {
            id: format!("{STOP_PREFIX}{}", status.repo_id),
            label: launch_tray_label(
                "停止",
                &repo_name(&status.repo_id),
                status.command.as_deref().unwrap_or(""),
            ),
        })
        .collect::<Vec<_>>();
    if !nodes.is_empty() && !recent.is_empty() {
        nodes.push(LaunchTrayMenuNode::Separator);
    }
    nodes.extend(
        recent
            .iter()
            .enumerate()
            .map(|(index, target)| LaunchTrayMenuNode::Item {
                id: format!("{START_PREFIX}{index}"),
                label: launch_tray_label("运行", &repo_name(&target.repo_id), &target.command),
            }),
    );
    nodes
}

fn launch_tray_label(action: &str, repo_name: &str, command: &str) -> String {
    let mut command = command
        .trim()
        .chars()
        .take(COMMAND_MAX_CHARS + 1)
        .collect::<String>();
    if command.chars().count() > COMMAND_MAX_CHARS {
        command = command.chars().take(COMMAND_MAX_CHARS).collect();
        command.push('…');
    }
    if command.is_empty() {
        command = "未命名脚本".to_string();
    }
    format!("{action} {repo_name} · {command}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use lilia_github_contracts::workspace::ProjectLaunchState;

    fn status(repo_id: &str, command: &str) -> ProjectLaunchStatus {
        ProjectLaunchStatus {
            workspace_id: None,
            context_revision: 0,
            repo_id: repo_id.to_string(),
            state: ProjectLaunchState::Running,
            pid: Some(1),
            command: Some(command.to_string()),
            started_at: Some(1),
            exit_code: None,
            error: None,
        }
    }

    fn target(repo_id: &str, command: &str, cwd: Option<&str>) -> LaunchTrayStartTarget {
        LaunchTrayStartTarget {
            repo_id: repo_id.to_string(),
            command: command.to_string(),
            cwd: cwd.map(ToString::to_string),
        }
    }

    fn name(repo_id: &str) -> String {
        repo_id.rsplit('/').next().unwrap_or(repo_id).to_string()
    }

    #[test]
    fn empty_sources_produce_no_placeholder_items() {
        assert!(compose_launch_tray_menu(&[], &[], name).is_empty());
    }

    #[test]
    fn running_items_come_before_recent() {
        assert_eq!(
            compose_launch_tray_menu(
                &[status("local:root/LiliaGithub", "yarn tauri:dev")],
                &[
                    target("local:root/LiliaUI", "yarn docs:dev", None),
                    target("local:root/LiliaUI", "yarn test", None),
                ],
                name,
            ),
            vec![
                LaunchTrayMenuNode::Item {
                    id: format!("{STOP_PREFIX}local:root/LiliaGithub"),
                    label: "停止 LiliaGithub · yarn tauri:dev".to_string(),
                },
                LaunchTrayMenuNode::Separator,
                LaunchTrayMenuNode::Item {
                    id: format!("{START_PREFIX}0"),
                    label: "运行 LiliaUI · yarn docs:dev".to_string(),
                },
                LaunchTrayMenuNode::Item {
                    id: format!("{START_PREFIX}1"),
                    label: "运行 LiliaUI · yarn test".to_string(),
                },
            ]
        );
    }

    #[test]
    fn recent_items_dedupe_drop_excluded_repos_and_limit() {
        let history = (0..12)
            .map(|index| ProjectLaunchHistoryEntry {
                id: index.to_string(),
                repo_id: format!("local:root/repo-{index}"),
                command: "yarn dev".to_string(),
                cwd: None,
                started_at: 100 - index,
                finished_at: None,
                state: ProjectLaunchState::Exited,
                exit_code: None,
                error: None,
                last_output: None,
            })
            .chain([
                ProjectLaunchHistoryEntry {
                    id: "gone".to_string(),
                    repo_id: "local:root/Gone".to_string(),
                    command: "yarn dev".to_string(),
                    cwd: None,
                    started_at: 200,
                    finished_at: None,
                    state: ProjectLaunchState::Exited,
                    exit_code: None,
                    error: None,
                    last_output: None,
                },
                ProjectLaunchHistoryEntry {
                    id: "dup".to_string(),
                    repo_id: "local:root/repo-0".to_string(),
                    command: "yarn dev".to_string(),
                    cwd: None,
                    started_at: 50,
                    finished_at: None,
                    state: ProjectLaunchState::Exited,
                    exit_code: None,
                    error: None,
                    last_output: None,
                },
            ])
            .collect();
        let recent = collect_recent_launch_targets(history, |repo_id| repo_id != "local:root/Gone");
        assert_eq!(recent.len(), RECENT_LIMIT);
        assert_eq!(recent[0].repo_id, "local:root/repo-0");
        assert!(recent
            .iter()
            .all(|target| target.repo_id != "local:root/Gone"));
    }

    #[test]
    fn long_commands_are_truncated() {
        let label = launch_tray_label(
            "运行",
            "repo",
            "cargo run --example a-very-long-launch-command-name",
        );
        assert!(label.starts_with("运行 repo · "));
        assert!(label.ends_with('…'));
    }
}

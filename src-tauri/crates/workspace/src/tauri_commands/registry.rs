use serde::Serialize;
use tauri::Runtime;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCommandDescriptor {
    pub command: &'static str,
    pub domain: &'static str,
}

macro_rules! workspace_command_registry {
    ($( $domain:ident { $( $module:ident::$command:ident ),+ $(,)? } )+) => {
        const WORKSPACE_COMMAND_MANIFEST: &[WorkspaceCommandDescriptor] = &[
            $(
                $(
                    WorkspaceCommandDescriptor {
                        command: stringify!($command),
                        domain: stringify!($domain),
                    },
                )+
            )+
        ];

        pub fn invoke_handler<R: Runtime>()
            -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static
        {
            tauri::generate_handler![
                $(
                    $(super::$module::$command,)+
                )+
            ]
        }
    };
}

workspace_command_registry! {
    workspace {
        settings::workspace_get_bootstrap,
        settings::workspace_get_settings,
        settings::workspace_read_startup_cache,
        settings::workspace_clear_startup_cache,
        settings::workspace_write_startup_contributions,
        settings::workspace_create,
        settings::workspace_rename,
        settings::workspace_delete,
        settings::workspace_switch,
        settings::workspace_add_root,
        settings::workspace_remove_root,
        settings::workspace_set_primary_root,
        settings::workspace_update_view_preferences,
        settings::workspace_update_recent_context,
        settings::workspace_update_account_preferences,
        settings::workspace_set_contribution_identities,
        settings::workspace_scan_contribution_identities,
        settings::repo_set_preference,
        settings::repo_set_auto_sync,
        settings::workspace_pick_root,
        settings::workspace_pick_repo,
        settings::workspace_pick_files,
        repos::workspace_refresh_repos,
        repos::workspace_list_managed_repos,
        repos::workspace_scan_repos,
        repos::workspace_discover_repos,
        repos::workspace_add_repo,
        repos::workspace_create_local_repo,
        repos::workspace_clone_repo,
        settings::workspace_hide_repo,
        settings::workspace_reconcile_organization_repo_groups,
        settings::workspace_create_repo_group,
        settings::workspace_rename_repo_group,
        settings::workspace_delete_repo_group,
        settings::workspace_move_repo_to_group,
        settings::workspace_relocate_local_repo,
        settings::workspace_set_local_repo_favorite,
        settings::workspace_delete_local_repo,
        settings::workspace_remember_remote_repo,
        settings::workspace_set_remote_repo_favorite,
        settings::workspace_forget_remote_repo,
        settings::workspace_unhide_repo,
        settings::workspace_list_hidden_repos,
        tasks::workspace_list_tasks,
        tasks::workspace_cancel_task,
        refresh::workspace_set_active_repo,
        settings::workspace_record_recent_local_repo,
        refresh::workspace_set_refresh_paused,
        refresh::workspace_enqueue_repo_refresh
    }
    github {
        github::github_get_binding_status,
        github::github_start_device_flow,
        github::github_poll_device_flow,
        github::github_unbind,
        github::github_get_account_profile,
        github::github_get_account_readme,
        github::github_update_account_profile,
        github::github_get_organization_profile,
        github::github_get_organization_overview,
        github::github_list_repos,
        github::github_list_watched_repos,
        github::github_get_repo_subscription,
        github::github_update_repo_subscription,
        github::github_list_account_issues,
        home_attention::github_list_home_attention,
        github::github_list_action_notifications,
        github::github_list_repo_contribution,
        github::github_list_repo_owners,
        github::github_list_repo_templates,
        github::github_list_repo_licenses,
        github::github_create_repo,
        github::github_get_repo_management,
        github::github_update_repo_settings,
        github::github_get_repo_settings_section,
        github::github_update_repo_actions_permissions,
        github::github_update_repo_workflow_permissions,
        github::github_delete_repo,
        github::github_list_branches,
        github::github_get_branch_protection,
        github::github_update_branch_protection,
        github::github_list_repo_rulesets,
        github::github_get_repo_ruleset,
        github::github_update_repo_ruleset,
        github::github_delete_branch,
        github::github_list_pull_requests,
        github::github_get_pull_request,
        github::github_get_pull_request_discussion,
        github::github_create_pull_request,
        github::github_update_pull_request,
        github::github_merge_pull_request,
        github::github_list_pull_request_checks,
        code_review::github_get_pull_request_code_review,
        code_review::github_create_pull_request_line_comment,
        code_review::github_reply_pull_request_review_thread,
        code_review::github_submit_pull_request_code_review,
        github::github_list_repo_files,
        github::github_get_repo_file_preview,
        github::github_list_issues,
        github::github_get_issue_discussion,
        github::github_get_issue_filter_metadata,
        github::github_list_issue_labels,
        github::github_list_issue_assignees,
        github::github_create_issue,
        github::github_update_issue,
        github_discussions::github_get_discussion_metadata,
        github_discussions::github_list_discussions,
        github_discussions::github_get_discussion,
        github_discussions::github_list_discussion_comments,
        github_discussions::github_list_discussion_comment_replies,
        github_discussions::github_create_discussion,
        github_discussions::github_create_discussion_comment,
        github_discussions::github_update_discussion_comment,
        github_discussions::github_delete_discussion_comment,
        github_discussions::github_update_discussion_reaction,
        github_discussions::github_update_discussion_state,
        github_discussions::github_update_discussion_answer,
        conversations::github_create_issue_comment,
        conversations::github_update_issue_comment,
        conversations::github_delete_issue_comment,
        conversations::github_add_issue_comment_reaction,
        github::github_list_workflow_runs,
        github::github_get_workflow_run_detail,
        github::github_get_workflow_job_log,
        github::github_cancel_workflow_run,
        github::github_rerun_failed_workflow_run,
        github::github_rerun_workflow_job,
        github::github_list_workflow_artifact_files,
        github::github_get_workflow_artifact_file_preview,
        github::github_list_repo_commits,
        github::github_get_repo_commit_detail,
        github::github_list_releases,
        github::github_get_release_by_tag,
        github::github_create_release,
        github::github_update_release,
        github::github_delete_release,
        github::github_upload_release_asset,
        github::github_attach_workflow_artifact_asset,
        github::github_delete_release_asset
    }
    repo {
        repos::repo_get_summary,
        storage::repo_get_storage_stats,
        repos::repo_refresh_summary,
        repos::repo_refresh_language_stats,
        file_browser::repo_list_files,
        file_browser::repo_get_file_preview,
        file_browser::repo_delete_file,
        repos::repo_get_changes,
        repos::repo_get_history,
        repos::repo_get_commit_detail,
        repos::repo_get_branches,
        repos::repo_get_conflicts,
        repos::repo_get_detail,
        settings::repo_get_remote_sync_config,
        settings::repo_set_remote_sync_policy,
        repos::repo_refresh_detail_patch,
        launch::repo_get_launch_config,
        launch::repo_list_launch_candidates,
        launch::repo_save_launch_config,
        launch::repo_get_launch_status,
        launch::repo_get_launch_logs,
        launch::repo_list_launch_history,
        launch::repo_start_launch,
        launch::repo_stop_launch,
        repos::repo_stage_files,
        repos::repo_unstage_files,
        repos::repo_discard_files,
        repos::repo_add_files_to_gitignore,
        repos::repo_commit,
        repos::repo_pull,
        repos::repo_merge_pull,
        repos::repo_fetch,
        repos::repo_start_rebase,
        repos::repo_push,
        repos::repo_push_new_branch,
        repos::repo_push_with_system_git,
        settings::repo_use_default_token_auth,
        repos::repo_checkout_branch,
        repos::repo_create_branch,
        repos::repo_rename_branch,
        repos::repo_merge_branch,
        repos::repo_delete_branch,
        repos::repo_set_upstream,
        repos::repo_list_stashes,
        repos::repo_get_stash_detail,
        repos::repo_stash_save,
        repos::repo_stash_apply,
        repos::repo_stash_pop,
        repos::repo_stash_drop,
        repos::repo_list_remotes,
        repos::repo_cherry_pick_commit,
        repos::repo_revert_commit,
        repos::repo_reset_to_commit,
        repos::repo_accept_conflict_file,
        repos::repo_resolve_conflict_file,
        repos::repo_mark_file_resolved,
        repos::repo_abort_conflict_operation,
        repos::repo_continue_conflict_operation
    }
    bulk {
        bulk::bulk_sync_preview,
        bulk::bulk_sync_execute
    }
    system {
        system::system_open_path,
        system::system_open_path_target,
        system::system_open_url,
        system::lilia_code_create_task_handoff,
        system::lilia_code_get_task_handoff_status,
        system::lilia_code_open_task_handoff_result
    }
}

pub fn workspace_command_manifest() -> &'static [WorkspaceCommandDescriptor] {
    WORKSPACE_COMMAND_MANIFEST
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn command_registry_is_complete_and_unique() {
        let commands = workspace_command_manifest();
        let unique = commands
            .iter()
            .map(|entry| entry.command)
            .collect::<BTreeSet<_>>();

        assert_eq!(commands.len(), 203);
        assert_eq!(unique.len(), commands.len());
        assert!(commands.iter().all(|entry| {
            matches!(
                entry.domain,
                "workspace" | "github" | "repo" | "bulk" | "system"
            )
        }));
    }
}

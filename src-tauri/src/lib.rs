use tauri::{utils::config::Color, Manager, WindowEvent};

const MAIN_WINDOW_LABEL: &str = "main";
const BG: Color = Color(0x18, 0x18, 0x18, 0xFF);

mod window_state;
mod workspace;
mod agent_debug;

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = window.set_background_color(Some(BG));
                if let Some(state) = window_state::load_main_window_state(app.handle()) {
                    window_state::restore_main_window_state(&window, state);
                }
                let _ = window.show();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != MAIN_WINDOW_LABEL {
                return;
            }
            if matches!(
                event,
                WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
            ) {
                if let Some(webview_window) = window.get_webview_window(MAIN_WINDOW_LABEL) {
                    window_state::persist_main_window_state(&window.app_handle(), &webview_window);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            agent_debug::agent_debug_status,
            agent_debug::agent_debug_logs,
            agent_debug::agent_debug_runtime_snapshot,
            agent_debug::agent_debug_record_action,
            agent_debug::agent_debug_reset_state,
            ping,
            workspace::settings::workspace_get_settings,
            workspace::settings::workspace_read_startup_cache,
            workspace::settings::workspace_clear_startup_cache,
            workspace::settings::workspace_write_startup_contributions,
            workspace::settings::workspace_set_root,
            workspace::settings::workspace_set_keyboard_shortcut,
            workspace::settings::repo_set_preference,
            workspace::settings::repo_set_auto_sync,
            workspace::settings::workspace_pick_root,
            workspace::settings::workspace_pick_repo,
            workspace::settings::workspace_pick_files,
            workspace::repos::workspace_refresh_repos,
            workspace::repos::workspace_list_managed_repos,
            workspace::repos::workspace_scan_repos,
            workspace::repos::workspace_discover_repos,
            workspace::repos::workspace_add_repo,
            workspace::repos::workspace_create_local_repo,
            workspace::repos::workspace_clone_repo,
            workspace::settings::workspace_hide_repo,
            workspace::settings::workspace_create_repo_group,
            workspace::settings::workspace_rename_repo_group,
            workspace::settings::workspace_delete_repo_group,
            workspace::settings::workspace_move_repo_to_group,
            workspace::settings::workspace_delete_local_repo,
            workspace::settings::workspace_remember_remote_repo,
            workspace::settings::workspace_forget_remote_repo,
            workspace::settings::workspace_unhide_repo,
            workspace::settings::workspace_list_hidden_repos,
            workspace::tasks::workspace_list_tasks,
            workspace::tasks::workspace_cancel_task,
            workspace::github::github_get_binding_status,
            workspace::github::github_start_device_flow,
            workspace::github::github_poll_device_flow,
            workspace::github::github_unbind,
            workspace::github::github_list_repos,
            workspace::github::github_list_repo_contribution,
            workspace::github::github_list_repo_owners,
            workspace::github::github_create_repo,
            workspace::github::github_get_repo_management,
            workspace::github::github_update_repo_settings,
            workspace::github::github_delete_repo,
            workspace::github::github_list_branches,
            workspace::github::github_delete_branch,
            workspace::github::github_list_pull_requests,
            workspace::github::github_get_pull_request,
            workspace::github::github_get_pull_request_discussion,
            workspace::github::github_create_pull_request,
            workspace::github::github_update_pull_request,
            workspace::github::github_merge_pull_request,
            workspace::github::github_list_pull_request_checks,
            workspace::github::github_list_repo_files,
            workspace::github::github_get_repo_file_preview,
            workspace::github::github_list_issues,
            workspace::github::github_get_issue_discussion,
            workspace::github::github_get_issue_filter_metadata,
            workspace::github::github_list_issue_labels,
            workspace::github::github_list_issue_assignees,
            workspace::github::github_create_issue,
            workspace::github::github_update_issue,
            workspace::github::github_list_workflow_runs,
            workspace::github::github_get_workflow_run_detail,
            workspace::github::github_get_workflow_job_log,
            workspace::github::github_list_workflow_artifact_files,
            workspace::github::github_get_workflow_artifact_file_preview,
            workspace::github::github_list_repo_commits,
            workspace::github::github_get_repo_commit_detail,
            workspace::github::github_list_releases,
            workspace::github::github_create_release,
            workspace::github::github_update_release,
            workspace::github::github_delete_release,
            workspace::github::github_upload_release_asset,
            workspace::github::github_attach_workflow_artifact_asset,
            workspace::github::github_delete_release_asset,
            workspace::repos::repo_get_summary,
            workspace::repos::repo_refresh_summary,
            workspace::repos::repo_refresh_language_stats,
            workspace::file_browser::repo_list_files,
            workspace::file_browser::repo_get_file_preview,
            workspace::repos::repo_get_changes,
            workspace::repos::repo_get_history,
            workspace::repos::repo_get_commit_detail,
            workspace::repos::repo_get_branches,
            workspace::repos::repo_get_conflicts,
            workspace::repos::repo_get_detail,
            workspace::launch::repo_get_launch_config,
            workspace::launch::repo_list_launch_candidates,
            workspace::launch::repo_save_launch_config,
            workspace::launch::repo_get_launch_status,
            workspace::launch::repo_get_launch_logs,
            workspace::launch::repo_list_launch_history,
            workspace::launch::repo_start_launch,
            workspace::launch::repo_stop_launch,
            workspace::repos::repo_stage_files,
            workspace::repos::repo_unstage_files,
            workspace::repos::repo_discard_files,
            workspace::repos::repo_add_files_to_gitignore,
            workspace::repos::repo_commit,
            workspace::repos::repo_pull,
            workspace::repos::repo_merge_pull,
            workspace::repos::repo_fetch,
            workspace::repos::repo_start_rebase,
            workspace::repos::repo_push,
            workspace::repos::repo_push_new_branch,
            workspace::repos::repo_push_with_system_git,
            workspace::settings::repo_use_default_token_auth,
            workspace::repos::repo_checkout_branch,
            workspace::repos::repo_create_branch,
            workspace::repos::repo_rename_branch,
            workspace::repos::repo_merge_branch,
            workspace::repos::repo_delete_branch,
            workspace::repos::repo_set_upstream,
            workspace::repos::repo_list_stashes,
            workspace::repos::repo_get_stash_detail,
            workspace::repos::repo_stash_save,
            workspace::repos::repo_stash_apply,
            workspace::repos::repo_stash_pop,
            workspace::repos::repo_stash_drop,
            workspace::repos::repo_list_remotes,
            workspace::repos::repo_cherry_pick_commit,
            workspace::repos::repo_revert_commit,
            workspace::repos::repo_reset_to_commit,
            workspace::repos::repo_accept_conflict_file,
            workspace::repos::repo_resolve_conflict_file,
            workspace::repos::repo_mark_file_resolved,
            workspace::repos::repo_abort_conflict_operation,
            workspace::repos::repo_continue_conflict_operation,
            workspace::bulk::bulk_sync_preview,
            workspace::bulk::bulk_sync_execute,
            workspace::system::system_open_path,
            workspace::system::system_open_path_target,
            workspace::system::system_open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

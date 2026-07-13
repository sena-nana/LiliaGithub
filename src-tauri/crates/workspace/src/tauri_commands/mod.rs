use std::sync::Arc;

use mutsuki_runtime_contracts::{Task, TaskBatch, TaskHandle, TaskOutcome};
use mutsuki_tauri_bridge::TaskResultRequest;
use mutsuki_tauri_host::MutsukiTauriHost;
use serde_json::Value as JsonValue;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::StoreExt;

use crate::runtime::{WorkspaceContext, WorkspaceRuntime};

macro_rules! delegate_command {
    (async $module:ident; fn $name:ident($app:ident: AppHandle $(, $arg:ident: $arg_ty:ty)* $(,)?) -> $ret:ty) => {
        #[tauri::command]
        pub async fn $name<R: tauri::Runtime>($app: tauri::AppHandle<R>, $($arg: $arg_ty),*) -> $ret {
            let app = crate::tauri_commands::workspace_context($app);
            crate::workspace::$module::$name(app, $($arg),*).await
        }
    };
    ($module:ident; fn $name:ident($app:ident: AppHandle $(, $arg:ident: $arg_ty:ty)* $(,)?) -> $ret:ty) => {
        #[tauri::command]
        pub fn $name<R: tauri::Runtime>($app: tauri::AppHandle<R>, $($arg: $arg_ty),*) -> $ret {
            let app = crate::tauri_commands::workspace_context($app);
            crate::workspace::$module::$name(app, $($arg),*)
        }
    };
    (async $module:ident; fn $name:ident($($arg:ident: $arg_ty:ty),* $(,)?) -> $ret:ty) => {
        #[tauri::command]
        pub async fn $name($($arg: $arg_ty),*) -> $ret {
            crate::workspace::$module::$name($($arg),*).await
        }
    };
    ($module:ident; fn $name:ident($($arg:ident: $arg_ty:ty),* $(,)?) -> $ret:ty) => {
        #[tauri::command]
        pub fn $name($($arg: $arg_ty),*) -> $ret {
            crate::workspace::$module::$name($($arg),*)
        }
    };
}

mod bulk;
mod file_browser;
mod github;
mod launch;
mod refresh;
mod repos;
mod settings;
mod storage;
mod system;
mod tasks;

#[derive(Clone)]
struct TauriWorkspaceRuntime<R: Runtime> {
    app: AppHandle<R>,
}

fn workspace_context<R: Runtime>(app: AppHandle<R>) -> WorkspaceContext {
    WorkspaceContext::new(Arc::new(TauriWorkspaceRuntime { app }))
}

impl<R: Runtime> WorkspaceRuntime for TauriWorkspaceRuntime<R> {
    fn store_get(&self, file: &str, key: &str) -> Result<Option<JsonValue>, String> {
        let store = self.app.store(file).map_err(|error| error.to_string())?;
        Ok(store.get(key))
    }

    fn store_set(&self, file: &str, key: &str, value: JsonValue) -> Result<(), String> {
        let store = self.app.store(file).map_err(|error| error.to_string())?;
        store.set(key, value);
        Ok(())
    }

    fn store_delete(&self, file: &str, key: &str) -> Result<(), String> {
        let store = self.app.store(file).map_err(|error| error.to_string())?;
        store.delete(key);
        Ok(())
    }

    fn store_save(&self, file: &str) -> Result<(), String> {
        let store = self.app.store(file).map_err(|error| error.to_string())?;
        store.save().map_err(|error| error.to_string())
    }

    fn pick_folder(&self, title: Option<&str>) -> Result<Option<String>, String> {
        let mut dialog = self.app.dialog().file();
        if let Some(title) = title {
            dialog = dialog.set_title(title);
        }
        Ok(dialog.blocking_pick_folder().map(|path| path.to_string()))
    }

    fn pick_files(&self, title: Option<&str>) -> Result<Option<Vec<String>>, String> {
        let mut dialog = self.app.dialog().file();
        if let Some(title) = title {
            dialog = dialog.set_title(title);
        }
        Ok(dialog
            .blocking_pick_files()
            .map(|paths| paths.into_iter().map(|path| path.to_string()).collect()))
    }

    fn open_path(&self, path: &str, with: Option<&str>) -> Result<(), String> {
        self.app
            .opener()
            .open_path(path, with)
            .map_err(|error| error.to_string())
    }

    fn open_url(&self, url: &str, with: Option<&str>) -> Result<(), String> {
        self.app
            .opener()
            .open_url(url, with)
            .map_err(|error| error.to_string())
    }

    fn emit(&self, event: &str, payload: JsonValue) -> Result<(), String> {
        self.app
            .emit(event, payload)
            .map_err(|error| error.to_string())
    }

    fn submit_mutsuki_task(&self, task: Task) -> Result<TaskHandle, String> {
        self.app
            .state::<Arc<MutsukiTauriHost>>()
            .submit_task(task)
            .map_err(|error| error.to_string())
    }

    fn submit_mutsuki_batch(&self, batch: TaskBatch) -> Result<Vec<TaskHandle>, String> {
        self.app
            .state::<Arc<MutsukiTauriHost>>()
            .submit_batch(batch)
            .map_err(|error| error.to_string())
    }

    fn wait_mutsuki_task(&self, task_id: &str) -> Result<TaskOutcome, String> {
        self.app
            .state::<Arc<MutsukiTauriHost>>()
            .task_result(TaskResultRequest {
                task_id: task_id.to_string(),
            })
            .map_err(|error| error.to_string())?
            .outcome
            .ok_or_else(|| format!("Mutsuki task {task_id} ended without an outcome"))
    }

    fn cancel_mutsuki_task(&self, handle: TaskHandle) -> Result<(), String> {
        self.app
            .state::<Arc<MutsukiTauriHost>>()
            .cancel_task_handle(handle)
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    fn resource_dir(&self) -> Option<std::path::PathBuf> {
        self.app.path().resource_dir().ok()
    }
}

pub fn invoke_handler<R: Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static
{
    tauri::generate_handler![
        settings::workspace_get_settings,
        settings::workspace_read_startup_cache,
        settings::workspace_clear_startup_cache,
        settings::workspace_write_startup_contributions,
        settings::workspace_set_root,
        settings::workspace_set_contribution_identities,
        settings::workspace_scan_contribution_identities,
        settings::repo_set_preference,
        settings::repo_set_auto_sync,
        settings::workspace_pick_root,
        settings::workspace_pick_repo,
        settings::workspace_pick_files,
        refresh::workspace_set_active_repo,
        refresh::workspace_set_refresh_paused,
        refresh::workspace_enqueue_repo_refresh,
        repos::workspace_refresh_repos,
        repos::workspace_list_managed_repos,
        repos::workspace_scan_repos,
        repos::workspace_discover_repos,
        repos::workspace_add_repo,
        repos::workspace_create_local_repo,
        repos::workspace_clone_repo,
        settings::workspace_hide_repo,
        settings::workspace_create_repo_group,
        settings::workspace_rename_repo_group,
        settings::workspace_delete_repo_group,
        settings::workspace_move_repo_to_group,
        settings::workspace_delete_local_repo,
        settings::workspace_remember_remote_repo,
        settings::workspace_forget_remote_repo,
        settings::workspace_unhide_repo,
        settings::workspace_list_hidden_repos,
        tasks::workspace_list_tasks,
        tasks::workspace_cancel_task,
        github::github_get_binding_status,
        github::github_start_device_flow,
        github::github_poll_device_flow,
        github::github_unbind,
        github::github_list_repos,
        github::github_list_account_issues,
        github::github_list_action_notifications,
        github::github_list_repo_contribution,
        github::github_list_repo_owners,
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
        github::github_list_repo_files,
        github::github_get_repo_file_preview,
        github::github_list_issues,
        github::github_get_issue_discussion,
        github::github_get_issue_filter_metadata,
        github::github_list_issue_labels,
        github::github_list_issue_assignees,
        github::github_create_issue,
        github::github_update_issue,
        github::github_list_workflow_runs,
        github::github_get_workflow_run_detail,
        github::github_get_workflow_job_log,
        github::github_rerun_failed_workflow_run,
        github::github_rerun_workflow_job,
        github::github_list_workflow_artifact_files,
        github::github_get_workflow_artifact_file_preview,
        github::github_list_repo_commits,
        github::github_get_repo_commit_detail,
        github::github_list_releases,
        github::github_create_release,
        github::github_update_release,
        github::github_delete_release,
        github::github_upload_release_asset,
        github::github_attach_workflow_artifact_asset,
        github::github_delete_release_asset,
        repos::repo_get_summary,
        storage::repo_get_storage_stats,
        repos::repo_clear_local_cache,
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
        repos::repo_continue_conflict_operation,
        bulk::bulk_sync_preview,
        bulk::bulk_sync_execute,
        system::system_open_path,
        system::system_open_path_target,
        system::system_open_url
    ]
}

pub fn handle_invoke<R: Runtime>(invoke: tauri::ipc::Invoke<R>) -> bool {
    invoke_handler::<R>()(invoke)
}

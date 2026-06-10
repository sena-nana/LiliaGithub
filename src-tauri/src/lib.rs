use tauri::{utils::config::Color, Manager, WindowEvent};

const MAIN_WINDOW_LABEL: &str = "main";
const BG: Color = Color(0x18, 0x18, 0x18, 0xFF);

mod window_state;
mod workspace;

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
            ping,
            workspace::workspace_get_settings,
            workspace::workspace_set_root,
            workspace::workspace_pick_root,
            workspace::workspace_scan_repos,
            workspace::github_get_binding_status,
            workspace::github_start_device_flow,
            workspace::github_poll_device_flow,
            workspace::github_unbind,
            workspace::repo_get_summary,
            workspace::repo_get_changes,
            workspace::repo_get_history,
            workspace::repo_get_branches,
            workspace::repo_get_detail,
            workspace::repo_stage_files,
            workspace::repo_unstage_files,
            workspace::repo_commit,
            workspace::repo_pull,
            workspace::repo_push,
            workspace::repo_checkout_branch,
            workspace::bulk_sync_preview,
            workspace::bulk_sync_execute,
            workspace::system_open_path,
            workspace::system_open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(lilia_github_workspace::WorkspaceAppState::new())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_lilia::Builder::new()
                .tray(
                    tauri_plugin_lilia::TrayOptions::new()
                        .show_window_label("显示主窗口")
                        .quit_label("退出"),
                )
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(feature = "agent-debug-webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    let app = builder
        .invoke_handler(handle_invoke)
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app.state::<lilia_github_workspace::WorkspaceAppState>()
                .shutdown();
        }
    });
}

fn handle_invoke<R: tauri::Runtime>(invoke: tauri::ipc::Invoke<R>) -> bool {
    let is_agent_debug_command = invoke.message.command().starts_with("agent_debug_");
    if is_agent_debug_command {
        return lilia_github_agent_debug::tauri_commands::handle_invoke(invoke);
    }
    lilia_github_workspace::tauri_commands::handle_invoke(invoke)
}

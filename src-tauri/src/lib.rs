#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_lilia::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_mutsuki::init_with_app(|_app| {
            Ok(lilia_github_workspace::mutsuki_host_builder())
        }))
        .invoke_handler(handle_invoke)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn handle_invoke<R: tauri::Runtime>(invoke: tauri::ipc::Invoke<R>) -> bool {
    let is_agent_debug_command = invoke.message.command().starts_with("agent_debug_");
    if is_agent_debug_command {
        return lilia_github_agent_debug::tauri_commands::handle_invoke(invoke);
    }
    lilia_github_workspace::tauri_commands::handle_invoke(invoke)
}

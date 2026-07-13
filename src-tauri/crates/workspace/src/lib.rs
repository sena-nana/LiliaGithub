pub mod runtime;
pub mod tauri_commands;
pub mod workspace;

pub fn mutsuki_host_builder() -> mutsuki_tauri_host::MutsukiTauriHostBuilder {
    let mut builder = mutsuki_tauri_host::MutsukiTauriHost::builder().app_name("LiliaGithub");
    builder = builder.runtime_config(workspace::refresh::refresh_runtime_config());
    for runner in workspace::refresh::repo_refresh_runners() {
        builder = builder.runner(runner);
    }
    for runner in workspace::operations::operation_runners() {
        builder = builder.runner(runner);
    }
    builder
}

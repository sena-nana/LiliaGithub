fn main() {
    let manifest = lilia_github_workspace::tauri_commands::workspace_command_manifest();
    println!(
        "{}",
        serde_json::to_string_pretty(manifest).expect("workspace command manifest must serialize"),
    );
}

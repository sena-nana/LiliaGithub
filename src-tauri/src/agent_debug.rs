use lilia_github_agent_debug::{
    agent_debug_enabled, agent_debug_logs as core_agent_debug_logs,
    agent_debug_record_action as core_agent_debug_record_action,
    agent_debug_reset_state as core_agent_debug_reset_state,
    agent_debug_status as core_agent_debug_status, disabled_reason, now_millis, AgentDebugLogEntry,
    AgentDebugStatus,
};
use serde_json::{json, Value as JsonValue};
use tauri::{AppHandle, Manager};

#[tauri::command]
pub(crate) fn agent_debug_status() -> AgentDebugStatus {
    core_agent_debug_status()
}

#[tauri::command]
pub(crate) fn agent_debug_logs(limit: Option<usize>) -> Result<Vec<AgentDebugLogEntry>, String> {
    core_agent_debug_logs(limit)
}

#[tauri::command]
pub(crate) fn agent_debug_record_action(entry: AgentDebugLogEntry) -> Result<(), String> {
    core_agent_debug_record_action(entry)
}

#[tauri::command]
pub(crate) fn agent_debug_reset_state() -> Result<AgentDebugStatus, String> {
    core_agent_debug_reset_state()
}

#[tauri::command]
pub(crate) fn agent_debug_runtime_snapshot(app: AppHandle) -> Result<JsonValue, String> {
    if !agent_debug_enabled() {
        return Err(disabled_reason().unwrap_or_else(|| "agent debug disabled".to_string()));
    }
    Ok(json!({
        "enabled": true,
        "capturedAt": now_millis(),
        "mainWindowPresent": app.get_webview_window(crate::MAIN_WINDOW_LABEL).is_some(),
        "app": "LiliaGithub",
    }))
}

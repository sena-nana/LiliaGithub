delegate_command!(system; fn system_open_path(app: AppHandle, path: String) -> Result<(), String>);
delegate_command!(system; fn system_open_path_target(app: AppHandle, path: String, target: String) -> Result<(), String>);
delegate_command!(system; fn system_open_url(app: AppHandle, url: String) -> Result<(), String>);
delegate_command!(async system; fn lilia_code_create_task_handoff(app: AppHandle, handoff: lilia_github_contracts::workspace::LiliaCodeTaskHandoff,) -> Result<lilia_github_contracts::workspace::LiliaCodeTaskHandoffStatus, String>);
delegate_command!(system; fn lilia_code_get_task_handoff_status(app: AppHandle, handoff_id: String,) -> Result<lilia_github_contracts::workspace::LiliaCodeTaskHandoffStatus, String>);
delegate_command!(async system; fn lilia_code_open_task_handoff_result(app: AppHandle, handoff_id: String,) -> Result<(), String>);

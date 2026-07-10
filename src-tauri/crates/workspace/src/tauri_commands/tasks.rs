use lilia_github_contracts::workspace::*;

delegate_command!(tasks; fn workspace_list_tasks() -> Vec<WorkspaceTask>);
delegate_command!(tasks; fn workspace_cancel_task(app: AppHandle, task_id: String) -> Result<(), String>);

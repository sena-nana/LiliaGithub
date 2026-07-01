delegate_command!(system; fn system_open_path(app: AppHandle, path: String) -> Result<(), String>);
delegate_command!(system; fn system_open_path_target(app: AppHandle, path: String, target: String) -> Result<(), String>);
delegate_command!(system; fn system_open_url(app: AppHandle, url: String) -> Result<(), String>);

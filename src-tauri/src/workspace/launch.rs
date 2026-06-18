use super::*;

pub(super) const LAUNCH_LOG_LIMIT: usize = 500;
#[cfg(target_os = "windows")]
pub(super) const CREATE_NO_WINDOW: u32 = 0x08000000;
pub(super) const ROOT_SCRIPT_PRIORITY: [&str; 6] =
    ["tauri:dev", "dev", "start", "serve", "preview", "docs:dev"];

pub(super) struct LaunchEntry {
    pub(super) child: Option<Child>,
    pub(super) status: ProjectLaunchStatus,
}

pub(super) fn launch_runtime() -> &'static Mutex<HashMap<String, LaunchEntry>> {
    static RUNTIME: OnceLock<Mutex<HashMap<String, LaunchEntry>>> = OnceLock::new();
    RUNTIME.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(super) fn launch_logs() -> &'static Mutex<HashMap<String, VecDeque<ProjectLaunchLog>>> {
    static LOGS: OnceLock<Mutex<HashMap<String, VecDeque<ProjectLaunchLog>>>> = OnceLock::new();
    LOGS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(super) fn next_launch_log_index() -> u64 {
    static INDEX: AtomicU64 = AtomicU64::new(1);
    INDEX.fetch_add(1, Ordering::Relaxed)
}

pub(super) fn idle_launch_status(repo_id: &str) -> ProjectLaunchStatus {
    ProjectLaunchStatus {
        repo_id: repo_id.to_string(),
        state: "idle".to_string(),
        pid: None,
        command: None,
        started_at: None,
        exit_code: None,
        error: None,
    }
}

pub(super) fn push_launch_log(repo_id: &str, stream: &str, line: impl Into<String>) {
    let mut logs = launch_logs().lock().unwrap_or_else(|e| e.into_inner());
    let repo_logs = logs.entry(repo_id.to_string()).or_default();
    repo_logs.push_back(ProjectLaunchLog {
        index: next_launch_log_index(),
        repo_id: repo_id.to_string(),
        stream: stream.to_string(),
        line: line.into(),
        timestamp: now_millis(),
    });
    while repo_logs.len() > LAUNCH_LOG_LIMIT {
        repo_logs.pop_front();
    }
}

pub(super) fn clear_launch_logs(repo_id: &str) {
    launch_logs()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(repo_id);
}

pub(super) fn refresh_launch_entry(repo_id: &str, entry: &mut LaunchEntry) {
    if entry.status.state != "running" {
        return;
    }
    let Some(child) = entry.child.as_mut() else {
        entry.status.state = "idle".to_string();
        entry.status.pid = None;
        return;
    };
    match child.try_wait() {
        Ok(Some(status)) => {
            let exit_code = status.code();
            entry.child = None;
            entry.status.state = "exited".to_string();
            entry.status.pid = None;
            entry.status.exit_code = exit_code;
            entry.status.error = None;
            push_launch_log(
                repo_id,
                "system",
                format!("进程已退出：exit {}", exit_code.unwrap_or(-1)),
            );
        }
        Ok(None) => {}
        Err(err) => {
            entry.child = None;
            entry.status.state = "error".to_string();
            entry.status.pid = None;
            entry.status.error = Some(err.to_string());
            push_launch_log(repo_id, "system", format!("读取进程状态失败：{err}"));
        }
    }
}

pub(super) fn package_manager(
    repo_path: &Path,
    package_manager_field: Option<&str>,
) -> &'static str {
    if let Some(field) = package_manager_field {
        let name = field.split('@').next().unwrap_or("").trim();
        if name == "yarn" || name == "pnpm" || name == "npm" {
            return match name {
                "yarn" => "yarn",
                "pnpm" => "pnpm",
                _ => "npm",
            };
        }
    }
    if repo_path.join("yarn.lock").exists() {
        "yarn"
    } else if repo_path.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else {
        "npm"
    }
}

pub(super) fn package_script_command(pm: &str, script: &str) -> String {
    if pm == "npm" {
        format!("npm run {script}")
    } else {
        format!("{pm} {script}")
    }
}

pub(super) fn root_script_rank(script: &str) -> usize {
    ROOT_SCRIPT_PRIORITY
        .iter()
        .position(|name| *name == script)
        .unwrap_or(ROOT_SCRIPT_PRIORITY.len())
}

pub(super) fn sort_root_script_names(script_names: &mut [String]) {
    script_names.sort_by(|left, right| {
        root_script_rank(left)
            .cmp(&root_script_rank(right))
            .then_with(|| left.cmp(right))
    });
}

pub(super) fn push_launch_candidate(
    candidates: &mut Vec<ProjectLaunchCandidate>,
    command: String,
    label: String,
    hint: Option<String>,
    kind: &str,
    cwd: Option<String>,
) {
    let key = (command.clone(), cwd.clone());
    if candidates
        .iter()
        .any(|candidate| candidate.command == key.0 && candidate.cwd == key.1)
    {
        return;
    }
    candidates.push(ProjectLaunchCandidate {
        command,
        label,
        hint,
        kind: kind.to_string(),
        cwd,
    });
}

pub(super) fn common_script_file_candidates(repo_path: &Path) -> Vec<ProjectLaunchCandidate> {
    let mut candidates = Vec::new();
    for folder in ["scripts", "bin"] {
        let dir = repo_path.join(folder);
        if !dir.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        let mut files: Vec<_> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.is_file())
            .collect();
        files.sort();
        for file_path in files {
            let Some(ext) = file_path.extension().and_then(|value| value.to_str()) else {
                continue;
            };
            let rel = file_path.strip_prefix(repo_path).unwrap_or(&file_path);
            let rel_label = rel
                .components()
                .filter_map(|component| match component {
                    Component::Normal(value) => Some(value.to_string_lossy().to_string()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("/");
            match ext {
                "sh" => push_launch_candidate(
                    &mut candidates,
                    format!("sh {rel_label}"),
                    rel_label.clone(),
                    Some(folder.to_string()),
                    "script",
                    None,
                ),
                "cmd" | "bat" => push_launch_candidate(
                    &mut candidates,
                    rel_label.clone(),
                    rel_label.clone(),
                    Some(folder.to_string()),
                    "script",
                    None,
                ),
                "ps1" => push_launch_candidate(
                    &mut candidates,
                    format!("powershell -ExecutionPolicy Bypass -File {rel_label}"),
                    rel_label.clone(),
                    Some(folder.to_string()),
                    "script",
                    None,
                ),
                "mjs" | "js" => push_launch_candidate(
                    &mut candidates,
                    format!("node {rel_label}"),
                    rel_label.clone(),
                    Some(folder.to_string()),
                    "script",
                    None,
                ),
                "ts" | "tsx" => push_launch_candidate(
                    &mut candidates,
                    format!("node --experimental-strip-types {rel_label}"),
                    rel_label.clone(),
                    Some(folder.to_string()),
                    "script",
                    None,
                ),
                _ => {}
            }
        }
    }
    candidates
}

pub(super) fn infer_launch_candidates(repo_path: &Path) -> Vec<ProjectLaunchCandidate> {
    let mut candidates = Vec::new();
    let package_path = repo_path.join("package.json");
    if package_path.exists() {
        let parsed = fs::read_to_string(&package_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
        if let Some(package) = parsed {
            let scripts = package.get("scripts").and_then(|value| value.as_object());
            let pm = package_manager(
                repo_path,
                package
                    .get("packageManager")
                    .and_then(|value| value.as_str()),
            );
            if let Some(scripts) = scripts {
                let mut script_names: Vec<_> = scripts
                    .keys()
                    .map(|name| name.to_string())
                    .collect();
                sort_root_script_names(&mut script_names);
                for script in script_names {
                    push_launch_candidate(
                        &mut candidates,
                        package_script_command(pm, &script),
                        script.clone(),
                        Some("package.json".to_string()),
                        "package",
                        None,
                    );
                }
            }
        }
    }
    if repo_path.join("Cargo.toml").exists() {
        push_launch_candidate(
            &mut candidates,
            "cargo run".to_string(),
            "cargo run".to_string(),
            Some("Cargo.toml".to_string()),
            "cargo",
            None,
        );
    }
    candidates.extend(common_script_file_candidates(repo_path));
    candidates
}

pub(super) fn infer_launch_config(repo_path: &Path) -> Option<ProjectLaunchConfig> {
    infer_launch_candidates(repo_path)
        .into_iter()
        .next()
        .map(|candidate| ProjectLaunchConfig {
            command: candidate.command,
            cwd: candidate.cwd,
            source: "inferred".to_string(),
            updated_at: None,
        })
}

pub(super) fn current_launch_candidate(config: &ProjectLaunchConfig) -> ProjectLaunchCandidate {
    ProjectLaunchCandidate {
        command: config.command.clone(),
        label: "当前指令".to_string(),
        hint: config.cwd.clone(),
        kind: "current".to_string(),
        cwd: config.cwd.clone(),
    }
}

pub(super) fn launch_candidates_for_repo(
    app: &AppHandle,
    repo_id: &str,
) -> Result<Vec<ProjectLaunchCandidate>, String> {
    let settings = load_settings(app);
    let path = repo_path_by_id(app, repo_id)?;
    let mut candidates = infer_launch_candidates(&path);
    let current_config = settings
        .project_launch_configs
        .get(repo_id)
        .cloned()
        .or_else(|| infer_launch_config(&path));
    if let Some(config) = current_config {
        if !candidates
            .iter()
            .any(|candidate| candidate.command == config.command && candidate.cwd == config.cwd)
        {
            candidates.insert(0, current_launch_candidate(&config));
        }
    }
    Ok(candidates)
}

pub(super) fn launch_config_for_repo(
    app: &AppHandle,
    repo_id: &str,
) -> Result<Option<ProjectLaunchConfig>, String> {
    let settings = load_settings(app);
    if let Some(config) = settings
        .project_launch_configs
        .get(repo_id)
        .filter(|config| !config.command.trim().is_empty())
    {
        let mut config = config.clone();
        config.source = "manual".to_string();
        return Ok(Some(config));
    }
    let path = repo_path_by_id(app, repo_id)?;
    Ok(infer_launch_config(&path))
}

pub(super) fn resolve_launch_cwd(repo_path: &Path, cwd: Option<&str>) -> Result<PathBuf, String> {
    let Some(cwd) = cwd.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(repo_path.to_path_buf());
    };
    let path = PathBuf::from(cwd);
    let resolved = if path.is_absolute() {
        path
    } else {
        repo_path.join(path)
    };
    if !resolved.exists() || !resolved.is_dir() {
        return Err(format!(
            "启动工作目录不存在或不是文件夹：{}",
            resolved.display()
        ));
    }
    Ok(resolved)
}

pub(super) fn spawn_launch_command(command: &str, cwd: &Path) -> Result<Child, String> {
    #[cfg(target_os = "windows")]
    let mut process = {
        let mut command_process = Command::new("cmd");
        command_process.args(["/C", command]);
        command_process.creation_flags(CREATE_NO_WINDOW);
        command_process
    };

    #[cfg(not(target_os = "windows"))]
    let mut process = {
        let mut command_process = Command::new("sh");
        command_process.args(["-c", command]);
        #[cfg(unix)]
        unsafe {
            command_process.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        command_process
    };

    process
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动项目失败：{e}"))
}

pub(super) fn stop_launch_child(child: &mut Child) -> Result<i32, String> {
    let pid = child.id();
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("停止项目进程树失败：{e}"))?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let already_exited = detail.contains("not found")
                || detail.contains("not running")
                || detail.contains("没有找到")
                || detail.contains("不存在");
            if !already_exited {
                return Err(if detail.is_empty() {
                    format!(
                        "停止项目进程树失败：exit {}",
                        output.status.code().unwrap_or(-1)
                    )
                } else {
                    detail
                });
            }
        }
    }

    #[cfg(unix)]
    unsafe {
        let pgid = pid as libc::pid_t;
        if libc::kill(-pgid, libc::SIGTERM) == -1 {
            let err = std::io::Error::last_os_error();
            if err.raw_os_error() != Some(libc::ESRCH) {
                return Err(format!("停止项目进程组失败：{err}"));
            }
        }
    }

    #[cfg(not(any(target_os = "windows", unix)))]
    {
        child.kill().map_err(|e| format!("停止项目失败：{e}"))?;
    }

    child
        .wait()
        .map(|status| status.code().unwrap_or(-1))
        .map_err(|e| format!("等待项目退出失败：{e}"))
}

pub(super) fn pipe_launch_output(
    repo_id: String,
    stream: &'static str,
    reader: impl std::io::Read + Send + 'static,
) {
    std::thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines() {
            match line {
                Ok(line) => push_launch_log(&repo_id, stream, line),
                Err(err) => {
                    push_launch_log(&repo_id, "system", format!("读取 {stream} 失败：{err}"));
                    break;
                }
            }
        }
    });
}

#[tauri::command]
pub fn repo_get_launch_config(
    app: AppHandle,
    repo_id: String,
) -> Result<Option<ProjectLaunchConfig>, String> {
    launch_config_for_repo(&app, &repo_id)
}

#[tauri::command]
pub fn repo_list_launch_candidates(
    app: AppHandle,
    repo_id: String,
) -> Result<Vec<ProjectLaunchCandidate>, String> {
    launch_candidates_for_repo(&app, &repo_id)
}

#[tauri::command]
pub fn repo_save_launch_config(
    app: AppHandle,
    repo_id: String,
    command: String,
    cwd: Option<String>,
) -> Result<ProjectLaunchConfig, String> {
    repo_path_by_id(&app, &repo_id)?;
    let command = command.trim().to_string();
    if command.is_empty() {
        return Err("启动命令不能为空".to_string());
    }
    let cwd = cwd
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let config = ProjectLaunchConfig {
        command,
        cwd,
        source: "manual".to_string(),
        updated_at: Some(now_millis()),
    };
    let mut settings = load_settings(&app);
    settings
        .project_launch_configs
        .insert(repo_id, config.clone());
    save_settings(&app, &settings)?;
    Ok(config)
}

#[tauri::command]
pub fn repo_get_launch_status(repo_id: String) -> Result<ProjectLaunchStatus, String> {
    let mut runtime = launch_runtime().lock().unwrap_or_else(|e| e.into_inner());
    let Some(entry) = runtime.get_mut(&repo_id) else {
        return Ok(idle_launch_status(&repo_id));
    };
    refresh_launch_entry(&repo_id, entry);
    Ok(entry.status.clone())
}

#[tauri::command]
pub fn repo_get_launch_logs(
    repo_id: String,
    since: Option<u64>,
) -> Result<Vec<ProjectLaunchLog>, String> {
    let logs = launch_logs().lock().unwrap_or_else(|e| e.into_inner());
    let since = since.unwrap_or(0);
    Ok(logs
        .get(&repo_id)
        .map(|repo_logs| {
            repo_logs
                .iter()
                .filter(|entry| entry.index > since)
                .cloned()
                .collect()
        })
        .unwrap_or_default())
}

#[tauri::command]
pub fn repo_start_launch(app: AppHandle, repo_id: String) -> Result<ProjectLaunchStatus, String> {
    let repo_path = repo_path_by_id(&app, &repo_id)?;
    let Some(config) = launch_config_for_repo(&app, &repo_id)? else {
        return Err("未配置快速启动脚本".to_string());
    };
    let command = config.command.trim().to_string();
    if command.is_empty() {
        return Err("启动命令不能为空".to_string());
    }
    let cwd = resolve_launch_cwd(&repo_path, config.cwd.as_deref())?;

    let mut runtime = launch_runtime().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(entry) = runtime.get_mut(&repo_id) {
        refresh_launch_entry(&repo_id, entry);
        if entry.status.state == "running" {
            return Ok(entry.status.clone());
        }
    }

    clear_launch_logs(&repo_id);
    let mut child = spawn_launch_command(&command, &cwd)?;
    let pid = child.id();
    if let Some(stdout) = child.stdout.take() {
        pipe_launch_output(repo_id.clone(), "stdout", stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        pipe_launch_output(repo_id.clone(), "stderr", stderr);
    }

    let status = ProjectLaunchStatus {
        repo_id: repo_id.clone(),
        state: "running".to_string(),
        pid: Some(pid),
        command: Some(command.clone()),
        started_at: Some(now_millis()),
        exit_code: None,
        error: None,
    };
    runtime.insert(
        repo_id.clone(),
        LaunchEntry {
            child: Some(child),
            status: status.clone(),
        },
    );
    push_launch_log(&repo_id, "system", format!("启动命令：{command}"));
    push_launch_log(&repo_id, "system", format!("工作目录：{}", cwd.display()));
    Ok(status)
}

#[tauri::command]
pub fn repo_stop_launch(repo_id: String) -> Result<ProjectLaunchStatus, String> {
    let mut runtime = launch_runtime().lock().unwrap_or_else(|e| e.into_inner());
    let Some(entry) = runtime.get_mut(&repo_id) else {
        return Ok(idle_launch_status(&repo_id));
    };
    refresh_launch_entry(&repo_id, entry);
    if entry.status.state != "running" {
        return Ok(entry.status.clone());
    }
    if let Some(child) = entry.child.as_mut() {
        let exit_code = stop_launch_child(child)?;
        entry.status.state = "exited".to_string();
        entry.status.pid = None;
        entry.status.exit_code = Some(exit_code);
        entry.status.error = None;
        entry.child = None;
        push_launch_log(&repo_id, "system", "已停止快速启动进程");
    }
    Ok(entry.status.clone())
}

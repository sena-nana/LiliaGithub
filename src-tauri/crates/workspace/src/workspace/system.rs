use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::shared::configure_background_command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NEW_CONSOLE: u32 = 0x00000010;

#[cfg(target_os = "windows")]
const VSCODE_COMMANDS: &[&str] = &["code.cmd", "code"];
#[cfg(not(target_os = "windows"))]
const VSCODE_COMMANDS: &[&str] = &["code"];

#[cfg(target_os = "windows")]
const LILIACODE_COMMANDS: &[&str] = &["liliacode.cmd", "liliacode"];
#[cfg(not(target_os = "windows"))]
const LILIACODE_COMMANDS: &[&str] = &["liliacode"];

pub fn system_open_path(app: AppHandle, path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(format!("路径不存在：{path}"));
    }
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("打开路径失败：{e}"))
}

pub fn system_open_path_target(app: AppHandle, path: String, target: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("路径不存在：{path}"));
    }
    if !path_buf.is_dir() {
        return Err(format!("打开目标需要文件夹路径：{path}"));
    }

    match target.as_str() {
        "folder" => system_open_path(app, path),
        "terminal" => open_terminal_at_path(&path_buf),
        "vscode" => open_command_target(&path_buf, "VSCode", VSCODE_COMMANDS),
        "liliacode" => open_command_target(&path_buf, "LiliaCode", LILIACODE_COMMANDS),
        _ => Err(format!("未知打开目标：{target}")),
    }
}

pub fn system_open_url(app: AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("打开链接失败：{e}"))
}

fn open_command_target(path: &Path, label: &str, commands: &[&str]) -> Result<(), String> {
    let path = dunce::simplified(path);
    let candidates = commands.iter().map(|command_name| {
        let mut command = Command::new(command_name);
        command.arg(path);
        configure_background_command(&mut command);
        (*command_name, command)
    });
    spawn_first(label, candidates)
}

#[cfg(target_os = "windows")]
fn open_terminal_at_path(path: &Path) -> Result<(), String> {
    let path = dunce::simplified(path);
    let mut wt = Command::new("wt");
    wt.arg("-d").arg(path);

    let mut powershell = Command::new("powershell.exe");
    powershell
        .arg("-NoExit")
        .current_dir(path)
        .creation_flags(CREATE_NEW_CONSOLE);

    spawn_first("终端", [("wt", wt), ("powershell.exe", powershell)])
}

#[cfg(target_os = "macos")]
fn open_terminal_at_path(path: &Path) -> Result<(), String> {
    let path_text = path_to_str(path)?;
    let mut command = Command::new("open");
    command.args(["-a", "Terminal", path_text]);
    spawn_external(command).map_err(|err| format!("打开终端失败：open -a Terminal: {err}"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_terminal_at_path(path: &Path) -> Result<(), String> {
    let path_text = path_to_str(path)?;
    let mut candidates = Vec::new();

    for (command_name, args) in [
        (
            "x-terminal-emulator",
            vec!["--working-directory", path_text],
        ),
        ("gnome-terminal", vec!["--working-directory", path_text]),
        ("konsole", vec!["--workdir", path_text]),
        ("xfce4-terminal", vec!["--working-directory", path_text]),
    ] {
        let mut command = Command::new(command_name);
        command.args(args).current_dir(path);
        candidates.push((command_name, command));
    }

    let mut xterm = Command::new("xterm");
    xterm.current_dir(path);
    candidates.push(("xterm", xterm));
    spawn_first("终端", candidates)
}

fn spawn_first<'a, I>(label: &str, commands: I) -> Result<(), String>
where
    I: IntoIterator<Item = (&'a str, Command)>,
{
    let mut names = Vec::new();
    let mut failures = Vec::new();
    for (name, command) in commands {
        names.push(name);
        if let Err(err) = spawn_external(command) {
            failures.push(format!("{name}: {err}"));
        } else {
            return Ok(());
        }
    }
    Err(format!(
        "打开{label}失败：未找到或无法启动命令 `{}`。{}",
        names.join("` / `"),
        failures.join("；")
    ))
}

fn spawn_external(mut command: Command) -> Result<(), String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[cfg(not(target_os = "windows"))]
fn path_to_str(path: &Path) -> Result<&str, String> {
    path.to_str()
        .ok_or_else(|| format!("路径不是有效 UTF-8：{}", path.display()))
}

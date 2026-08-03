//! LiliaCode local task handoff over an authenticated loopback TCP endpoint.

use std::fs;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

use lilia_github_contracts::workspace::{LiliaCodeTaskHandoff, LiliaCodeTaskHandoffStatus};
use serde::{Deserialize, Serialize};

const LILIA_CODE_HANDOFF_PROTOCOL: &str = "lilia-code-task-handoff";
const LILIA_CODE_HANDOFF_VERSION: u32 = 1;
const LILIA_CODE_IPC_PROTOCOL: &str = "lilia-code-ipc";
const LILIA_CODE_IPC_VERSION: u32 = 1;
const ENDPOINT_FILE: &str = "lilia-code-v1.endpoint.json";
const MAX_FRAME_SIZE: usize = 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(1);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const READY_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EndpointDescriptor {
    protocol: String,
    version: u32,
    port: u16,
    instance_id: String,
    token: String,
    pid: u32,
    #[serde(alias = "startTime")]
    started_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IpcRequest<'a> {
    protocol: &'static str,
    version: u32,
    request_id: &'a str,
    token: &'a str,
    handoff: &'a LiliaCodeTaskHandoff,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IpcResponse {
    protocol: String,
    version: u32,
    request_id: String,
    status: String,
    task_id: Option<String>,
    project_id: Option<String>,
    result_route: Option<String>,
    error: Option<String>,
}

pub async fn deliver_task_handoff_via_app(
    handoff: &LiliaCodeTaskHandoff,
) -> Result<LiliaCodeTaskHandoffStatus, String> {
    let handoff = handoff.clone();
    tokio::task::spawn_blocking(move || deliver_task_handoff_blocking(&handoff))
        .await
        .map_err(|error| format!("LiliaCode IPC worker stopped: {error}"))?
}

fn deliver_task_handoff_blocking(
    handoff: &LiliaCodeTaskHandoff,
) -> Result<LiliaCodeTaskHandoffStatus, String> {
    let endpoint_path = endpoint_path()?;
    let executable = lilia_code_executable();
    let deadline = Instant::now() + READY_TIMEOUT;
    let mut launch_attempted = false;
    let mut last_error = "LiliaCode IPC endpoint not found".to_string();

    loop {
        if let Some(endpoint) = read_endpoint(&endpoint_path)? {
            match request_endpoint(&endpoint, handoff) {
                Ok(response) => return map_response(response, handoff),
                Err(error) => last_error = error,
            }
        }

        if !launch_attempted {
            launch_attempted = true;
            if let Some(executable) = executable.as_deref() {
                if let Err(error) = launch_lilia_code(executable) {
                    last_error = format!("启动 LiliaCode 失败：{error}");
                }
            } else {
                last_error = "未找到 LiliaCode 可执行文件".to_string();
            }
        }

        if Instant::now() >= deadline {
            return Err(format!(
                "LiliaCode IPC 投递失败：{last_error}。请更新 LiliaCode 以启用本地任务交接。"
            ));
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn request_endpoint(
    endpoint: &EndpointDescriptor,
    handoff: &LiliaCodeTaskHandoff,
) -> Result<IpcResponse, String> {
    if endpoint.protocol != LILIA_CODE_IPC_PROTOCOL || endpoint.version != LILIA_CODE_IPC_VERSION {
        return Err("LiliaCode IPC 协议版本不兼容".to_string());
    }
    if endpoint.port == 0
        || endpoint.token.is_empty()
        || endpoint.instance_id.is_empty()
        || endpoint.pid == 0
        || endpoint.started_at.is_empty()
    {
        return Err("LiliaCode IPC endpoint 无效".to_string());
    }

    let address = ("127.0.0.1", endpoint.port)
        .to_socket_addrs()
        .map_err(|error| format!("解析 LiliaCode IPC 地址失败：{error}"))?
        .next()
        .ok_or_else(|| "LiliaCode IPC 地址为空".to_string())?;
    let mut stream = TcpStream::connect_timeout(&address, CONNECT_TIMEOUT)
        .map_err(|error| format!("连接 LiliaCode IPC 失败：{error}"))?;
    stream
        .set_read_timeout(Some(REQUEST_TIMEOUT))
        .map_err(|error| format!("设置 LiliaCode IPC 读取超时失败：{error}"))?;
    stream
        .set_write_timeout(Some(REQUEST_TIMEOUT))
        .map_err(|error| format!("设置 LiliaCode IPC 写入超时失败：{error}"))?;

    let request = IpcRequest {
        protocol: LILIA_CODE_IPC_PROTOCOL,
        version: LILIA_CODE_IPC_VERSION,
        request_id: &handoff.id,
        token: &endpoint.token,
        handoff,
    };
    write_frame(&mut stream, &request)?;
    read_frame(&mut stream)
}

fn map_response(
    response: IpcResponse,
    handoff: &LiliaCodeTaskHandoff,
) -> Result<LiliaCodeTaskHandoffStatus, String> {
    if response.protocol != LILIA_CODE_IPC_PROTOCOL
        || response.version != LILIA_CODE_IPC_VERSION
        || response.request_id != handoff.id
    {
        return Err("LiliaCode IPC 回执与当前任务不匹配".to_string());
    }

    match response.status.as_str() {
        "accepted" | "duplicate" => {
            let task_id = response.task_id.unwrap_or_else(|| handoff.id.clone());
            let result_route = response
                .result_route
                .unwrap_or_else(|| format!("liliacode://tasks/{task_id}"));
            Ok(LiliaCodeTaskHandoffStatus {
                protocol: LILIA_CODE_HANDOFF_PROTOCOL.to_string(),
                version: LILIA_CODE_HANDOFF_VERSION,
                handoff_id: handoff.id.clone(),
                status: "accepted".to_string(),
                task_id: Some(task_id),
                project_id: Some(
                    response
                        .project_id
                        .unwrap_or_else(|| "lilia-code".to_string()),
                ),
                result_route: Some(result_route),
                error: None,
                updated_at: now_millis().to_string(),
            })
        }
        "rejected" | "incompatible" => Err(response
            .error
            .unwrap_or_else(|| "LiliaCode 拒绝了任务交接".to_string())),
        other => Err(format!("LiliaCode 返回了未知 IPC 状态：{other}")),
    }
}

fn write_frame<T: Serialize>(stream: &mut TcpStream, value: &T) -> Result<(), String> {
    let payload =
        serde_json::to_vec(value).map_err(|error| format!("编码 IPC 请求失败：{error}"))?;
    if payload.len() > MAX_FRAME_SIZE {
        return Err("LiliaCode IPC 请求超过 1 MiB 限制".to_string());
    }
    let length =
        u32::try_from(payload.len()).map_err(|_| "LiliaCode IPC 请求长度无效".to_string())?;
    stream
        .write_all(&length.to_be_bytes())
        .and_then(|_| stream.write_all(&payload))
        .and_then(|_| stream.flush())
        .map_err(|error| format!("写入 LiliaCode IPC 请求失败：{error}"))
}

fn read_frame<T: for<'de> Deserialize<'de>>(stream: &mut TcpStream) -> Result<T, String> {
    let mut length = [0_u8; 4];
    stream
        .read_exact(&mut length)
        .map_err(|error| format!("读取 LiliaCode IPC 回执长度失败：{error}"))?;
    let length = u32::from_be_bytes(length) as usize;
    if length == 0 || length > MAX_FRAME_SIZE {
        return Err("LiliaCode IPC 回执长度无效".to_string());
    }
    let mut payload = vec![0_u8; length];
    stream
        .read_exact(&mut payload)
        .map_err(|error| format!("读取 LiliaCode IPC 回执失败：{error}"))?;
    serde_json::from_slice(&payload)
        .map_err(|error| format!("解析 LiliaCode IPC 回执失败：{error}"))
}

fn read_endpoint(path: &PathBuf) -> Result<Option<EndpointDescriptor>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let payload = fs::read_to_string(path)
        .map_err(|error| format!("读取 LiliaCode IPC endpoint 失败：{error}"))?;
    serde_json::from_str(&payload)
        .map(Some)
        .map_err(|error| format!("解析 LiliaCode IPC endpoint 失败：{error}"))
}

fn endpoint_path() -> Result<PathBuf, String> {
    let dir = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from))
        .unwrap_or_else(std::env::temp_dir)
        .join("lilia-code-ipc");
    fs::create_dir_all(&dir).map_err(|error| format!("创建 LiliaCode IPC 目录失败：{error}"))?;
    Ok(dir.join(ENDPOINT_FILE))
}

fn launch_lilia_code(executable: &str) -> Result<(), String> {
    let mut command = Command::new(executable);
    if let Some(parent) = PathBuf::from(executable).parent() {
        command.current_dir(parent);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn lilia_code_executable() -> Option<String> {
    #[cfg(windows)]
    {
        which_command("liliacode.cmd").or_else(|| which_command("liliacode"))
    }
    #[cfg(not(windows))]
    {
        which_command("liliacode")
    }
}

fn which_command(name: &str) -> Option<String> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).find_map(|dir| {
            let candidate = dir.join(name);
            candidate
                .is_file()
                .then(|| candidate.to_string_lossy().into_owned())
        })
    })
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn endpoint_path_uses_the_lilia_code_ipc_namespace() {
        assert!(endpoint_path()
            .unwrap()
            .to_string_lossy()
            .contains("lilia-code-ipc"));
    }

    #[test]
    fn response_requires_matching_request_identity() {
        let handoff = LiliaCodeTaskHandoff {
            protocol: LILIA_CODE_HANDOFF_PROTOCOL.to_string(),
            version: LILIA_CODE_HANDOFF_VERSION,
            id: "handoff-1".to_string(),
            created_at: "1".to_string(),
            title: "title".to_string(),
            kind: "issue".to_string(),
            repository: lilia_github_contracts::workspace::LiliaCodeTaskHandoffRepository {
                full_name: "owner/repo".to_string(),
                worktree_path: ".".to_string(),
                branch: "main".to_string(),
                remote_url: None,
            },
            source: lilia_github_contracts::workspace::LiliaCodeTaskHandoffSource {
                application: "LiliaGithub".to_string(),
                route: "test".to_string(),
                object_url: None,
            },
            problem: "problem".to_string(),
            related_files: Vec::new(),
            log_summary: None,
            acceptance_criteria: Vec::new(),
            pull_request: None,
            workflow: None,
        };
        let response = IpcResponse {
            protocol: LILIA_CODE_IPC_PROTOCOL.to_string(),
            version: LILIA_CODE_IPC_VERSION,
            request_id: "handoff-2".to_string(),
            status: "accepted".to_string(),
            task_id: Some("task-1".to_string()),
            project_id: Some("project-1".to_string()),
            result_route: Some("liliacode://tasks/task-1".to_string()),
            error: None,
        };
        assert!(map_response(response, &handoff).is_err());
    }

    #[test]
    fn oversized_frame_is_rejected_before_write() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let mut client = TcpStream::connect(address).unwrap();
        let (_server, _) = listener.accept().unwrap();
        let error = write_frame(&mut client, &"x".repeat(MAX_FRAME_SIZE + 1)).unwrap_err();
        assert!(error.contains("超过 1 MiB"));
    }

    #[test]
    fn malformed_or_oversized_response_frame_is_rejected() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.write_all(&((MAX_FRAME_SIZE as u32) + 1).to_be_bytes())
        });
        let mut client = TcpStream::connect(address).unwrap();
        let error = read_frame::<serde_json::Value>(&mut client).unwrap_err();
        server.join().unwrap().unwrap();
        assert!(error.contains("长度无效"));
    }
}

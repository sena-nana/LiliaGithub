use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use lilia_github_contracts::workspace::{LiliaCodeTaskHandoff, LiliaCodeTaskHandoffStatus};

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::operations::OperationKind;
use crate::workspace::run_core_operation;
use crate::workspace::shared::configure_background_command;
use crate::workspace::system::{spawn_first, LILIACODE_COMMANDS};

const LILIA_CODE_HANDOFF_STORE: &str = "lilia-code-handoffs.json";
const LILIA_CODE_HANDOFF_PROTOCOL: &str = "lilia-code-task-handoff";
const LILIA_CODE_HANDOFF_VERSION: u32 = 1;
const LILIA_CODE_HANDOFF_RECEIPT_TIMEOUT_MS: i64 = 30_000;

pub async fn lilia_code_create_task_handoff(
    app: AppHandle,
    handoff: LiliaCodeTaskHandoff,
) -> Result<LiliaCodeTaskHandoffStatus, String> {
    validate_task_handoff(&handoff)?;
    // Always keep a recoverable draft first; never mark it delivered.
    let store = app.store(LILIA_CODE_HANDOFF_STORE)?;
    store.set(
        &format!("draft:{}", handoff.id),
        serde_json::to_value(&handoff).map_err(|error| error.to_string())?,
    );
    store.save()?;

    match crate::workspace::app_delivery_handoff::deliver_task_handoff_via_app(&handoff).await {
        Ok(status) => {
            persist_handoff_status(&app, &status)?;
            Ok(status)
        }
        Err(direct_error) => {
            let failed = LiliaCodeTaskHandoffStatus {
                protocol: LILIA_CODE_HANDOFF_PROTOCOL.to_string(),
                version: LILIA_CODE_HANDOFF_VERSION,
                handoff_id: handoff.id.clone(),
                status: "failed".to_string(),
                task_id: None,
                project_id: None,
                result_route: None,
                error: Some(direct_error.clone()),
                updated_at: now_millis().to_string(),
            };
            persist_handoff_status(&app, &failed)?;
            // File handoff remains recovery-only via open_task_handoff_result.
            Err(direct_error)
        }
    }
}

pub fn lilia_code_get_task_handoff_status(
    app: AppHandle,
    handoff_id: String,
) -> Result<LiliaCodeTaskHandoffStatus, String> {
    validate_handoff_id(&handoff_id)?;
    let path = task_handoff_path(&handoff_id)?;
    if let Some(status) = read_handoff_receipt(&path, &handoff_id)? {
        persist_handoff_status(&app, &status)?;
        return Ok(status);
    }
    let mut status =
        load_handoff_status(&app, &handoff_id)?.ok_or_else(|| "未找到任务交接记录".to_string())?;
    if status.status == "pending"
        && status.updated_at.parse::<i64>().is_ok_and(|started_at| {
            now_millis().saturating_sub(started_at) >= LILIA_CODE_HANDOFF_RECEIPT_TIMEOUT_MS
        })
    {
        status.status = "incompatible".to_string();
        status.error = Some(
            "LiliaCode 未返回 v1 任务回执；任务草稿已保留，请更新 LiliaCode 后重试。".to_string(),
        );
        status.updated_at = now_millis().to_string();
        persist_handoff_status(&app, &status)?;
    }
    Ok(status)
}

pub async fn lilia_code_open_task_handoff_result(
    app: AppHandle,
    handoff_id: String,
) -> Result<(), String> {
    run_core_operation(
        app.clone(),
        OperationKind::LaunchControl,
        "打开 LiliaCode 任务",
        move || open_task_handoff_result(&app, &handoff_id),
    )
    .await
}

fn open_task_handoff_result(app: &AppHandle, handoff_id: &str) -> Result<(), String> {
    validate_handoff_id(handoff_id)?;
    let status =
        load_handoff_status(app, handoff_id)?.ok_or_else(|| "未找到任务交接记录".to_string())?;
    if status.status != "accepted" || status.result_route.as_deref().is_none_or(str::is_empty) {
        return Err("LiliaCode 尚未接收该任务，暂时无法打开结果".to_string());
    }
    let handoff = load_handoff_draft(app, handoff_id)?;
    let path = task_handoff_path(handoff_id)?;
    write_task_handoff_payload(&path, &handoff)?;
    open_lilia_code_handoff(&path)
}

#[allow(dead_code)]
fn create_task_handoff(
    app: &AppHandle,
    handoff: LiliaCodeTaskHandoff,
) -> Result<LiliaCodeTaskHandoffStatus, String> {
    validate_task_handoff(&handoff)?;
    let path = task_handoff_path(&handoff.id)?;
    if let Some(receipt) = read_handoff_receipt(&path, &handoff.id)? {
        persist_handoff_status(app, &receipt)?;
        if receipt.status == "accepted" {
            return Ok(receipt);
        }
        fs::remove_file(task_handoff_receipt_path(&path))
            .map_err(|error| format!("清理旧任务交接回执失败：{error}"))?;
    }
    if let Some(existing) = load_handoff_status(app, &handoff.id)? {
        if existing.status == "pending" || existing.status == "accepted" {
            return Ok(existing);
        }
    }

    let store = app.store(LILIA_CODE_HANDOFF_STORE)?;
    store.set(
        &format!("draft:{}", handoff.id),
        serde_json::to_value(&handoff).map_err(|error| error.to_string())?,
    );
    store.save()?;

    write_task_handoff_payload(&path, &handoff)?;

    let pending = LiliaCodeTaskHandoffStatus {
        protocol: LILIA_CODE_HANDOFF_PROTOCOL.to_string(),
        version: LILIA_CODE_HANDOFF_VERSION,
        handoff_id: handoff.id.clone(),
        status: "pending".to_string(),
        task_id: None,
        project_id: None,
        result_route: None,
        error: None,
        updated_at: now_millis().to_string(),
    };
    persist_handoff_status(app, &pending)?;
    if let Err(error) = open_lilia_code_handoff(&path) {
        let failed = LiliaCodeTaskHandoffStatus {
            status: "failed".to_string(),
            error: Some(format!(
                "{error}。任务草稿已保留，请安装或更新 LiliaCode 后重试。"
            )),
            updated_at: now_millis().to_string(),
            ..pending
        };
        persist_handoff_status(app, &failed)?;
        return Err(failed
            .error
            .unwrap_or_else(|| "启动 LiliaCode 失败".to_string()));
    }
    Ok(pending)
}

fn validate_task_handoff(handoff: &LiliaCodeTaskHandoff) -> Result<(), String> {
    validate_handoff_id(&handoff.id)?;
    if handoff.protocol != LILIA_CODE_HANDOFF_PROTOCOL
        || handoff.version != LILIA_CODE_HANDOFF_VERSION
    {
        return Err(format!(
            "LiliaCode 任务交接协议不兼容：{} v{}",
            handoff.protocol, handoff.version
        ));
    }
    if handoff.title.trim().is_empty() || handoff.problem.trim().is_empty() {
        return Err("任务标题和问题描述不能为空".to_string());
    }
    if handoff.repository.full_name.trim().is_empty()
        || handoff.repository.branch.trim().is_empty()
        || handoff.source.application != "LiliaGithub"
        || handoff.source.route.trim().is_empty()
    {
        return Err("任务交接缺少仓库、分支或来源上下文".to_string());
    }
    if !matches!(
        handoff.kind.as_str(),
        "issue" | "pullRequestReview" | "workflowFailure" | "syncConflict" | "repository"
    ) {
        return Err(format!("不支持的 LiliaCode 任务类型：{}", handoff.kind));
    }
    if handoff.kind == "pullRequestReview"
        && handoff
            .pull_request
            .as_ref()
            .is_none_or(|pull| pull.review_requirements.is_empty())
    {
        return Err("PR review 任务缺少审查要求".to_string());
    }
    if handoff.kind == "workflowFailure"
        && (handoff.workflow.is_none()
            || handoff
                .log_summary
                .as_deref()
                .is_none_or(|value| value.trim().is_empty()))
    {
        return Err("Workflow 修复任务缺少运行信息或失败日志摘要".to_string());
    }
    let worktree = Path::new(handoff.repository.worktree_path.trim());
    if !worktree.is_dir() {
        return Err(format!("任务 worktree 不存在：{}", worktree.display()));
    }
    Ok(())
}

fn validate_handoff_id(handoff_id: &str) -> Result<(), String> {
    if handoff_id.is_empty()
        || !handoff_id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-' || value == '_')
    {
        return Err("任务交接 ID 不合法".to_string());
    }
    Ok(())
}

fn task_handoff_path(handoff_id: &str) -> Result<PathBuf, String> {
    validate_handoff_id(handoff_id)?;
    Ok(std::env::temp_dir()
        .join("lilia-code-task-handoffs")
        .join(format!("{handoff_id}.json")))
}

fn write_task_handoff_payload(path: &Path, handoff: &LiliaCodeTaskHandoff) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "无法确定任务交接目录".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("创建任务交接目录失败：{error}"))?;
    let pending_path = path.with_extension("json.pending");
    let payload = serde_json::to_vec_pretty(handoff)
        .map_err(|error| format!("序列化任务交接失败：{error}"))?;
    fs::write(&pending_path, payload).map_err(|error| format!("写入任务交接失败：{error}"))?;
    if path.is_file() {
        fs::remove_file(path).map_err(|error| format!("替换旧任务交接失败：{error}"))?;
    }
    fs::rename(&pending_path, path).map_err(|error| format!("发布任务交接失败：{error}"))
}

fn task_handoff_receipt_path(path: &Path) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(".receipt.json");
    PathBuf::from(value)
}

fn read_handoff_receipt(
    path: &Path,
    expected_handoff_id: &str,
) -> Result<Option<LiliaCodeTaskHandoffStatus>, String> {
    let receipt_path = task_handoff_receipt_path(path);
    if !receipt_path.is_file() {
        return Ok(None);
    }
    let payload = fs::read_to_string(&receipt_path)
        .map_err(|error| format!("读取 LiliaCode 任务回执失败：{error}"))?;
    let receipt: LiliaCodeTaskHandoffStatus = serde_json::from_str(&payload)
        .map_err(|error| format!("解析 LiliaCode 任务回执失败：{error}"))?;
    validate_handoff_receipt(&receipt, expected_handoff_id)?;
    Ok(Some(receipt))
}

fn validate_handoff_receipt(
    receipt: &LiliaCodeTaskHandoffStatus,
    expected_handoff_id: &str,
) -> Result<(), String> {
    if receipt.protocol != LILIA_CODE_HANDOFF_PROTOCOL
        || receipt.version != LILIA_CODE_HANDOFF_VERSION
    {
        return Err(format!(
            "LiliaCode 任务回执协议不兼容：{} v{}",
            receipt.protocol, receipt.version
        ));
    }
    if receipt.handoff_id != expected_handoff_id {
        return Err("LiliaCode 任务回执与当前交接不匹配".to_string());
    }
    match receipt.status.as_str() {
        "accepted"
            if receipt
                .task_id
                .as_deref()
                .is_some_and(|value| !value.is_empty())
                && receipt
                    .project_id
                    .as_deref()
                    .is_some_and(|value| !value.is_empty())
                && receipt
                    .result_route
                    .as_deref()
                    .is_some_and(|value| !value.is_empty()) => {}
        "incompatible" | "failed"
            if receipt
                .error
                .as_deref()
                .is_some_and(|value| !value.is_empty()) => {}
        "accepted" => return Err("LiliaCode 接收回执缺少任务结果".to_string()),
        "incompatible" | "failed" => return Err("LiliaCode 失败回执缺少恢复说明".to_string()),
        _ => {
            return Err(format!(
                "LiliaCode 返回了未知的任务交接状态：{}",
                receipt.status
            ))
        }
    }
    Ok(())
}

fn persist_handoff_status(
    app: &AppHandle,
    status: &LiliaCodeTaskHandoffStatus,
) -> Result<(), String> {
    let store = app.store(LILIA_CODE_HANDOFF_STORE)?;
    store.set(
        &format!("status:{}", status.handoff_id),
        serde_json::to_value(status).map_err(|error| error.to_string())?,
    );
    store.save()
}

fn load_handoff_status(
    app: &AppHandle,
    handoff_id: &str,
) -> Result<Option<LiliaCodeTaskHandoffStatus>, String> {
    app.store(LILIA_CODE_HANDOFF_STORE)?
        .get(&format!("status:{handoff_id}"))
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| format!("读取任务交接状态失败：{error}"))
}

fn load_handoff_draft(app: &AppHandle, handoff_id: &str) -> Result<LiliaCodeTaskHandoff, String> {
    let value = app
        .store(LILIA_CODE_HANDOFF_STORE)?
        .get(&format!("draft:{handoff_id}"))
        .ok_or_else(|| "任务交接草稿已丢失，无法恢复结果入口".to_string())?;
    let handoff =
        serde_json::from_value(value).map_err(|error| format!("读取任务交接草稿失败：{error}"))?;
    validate_task_handoff(&handoff)?;
    Ok(handoff)
}

fn open_lilia_code_handoff(path: &Path) -> Result<(), String> {
    let candidates = LILIACODE_COMMANDS.iter().map(|command_name| {
        let mut command = Command::new(command_name);
        command.arg("--task-handoff").arg(path);
        configure_background_command(&mut command);
        (*command_name, command)
    });
    spawn_first("LiliaCode", candidates)
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

    #[test]
    fn task_handoff_receipt_requires_matching_complete_result() {
        let receipt = LiliaCodeTaskHandoffStatus {
            protocol: LILIA_CODE_HANDOFF_PROTOCOL.to_string(),
            version: LILIA_CODE_HANDOFF_VERSION,
            handoff_id: "handoff-1".to_string(),
            status: "accepted".to_string(),
            task_id: Some("task-1".to_string()),
            project_id: Some("project-1".to_string()),
            result_route: Some("/projects/project-1/tasks/task-1".to_string()),
            error: None,
            updated_at: "1".to_string(),
        };

        assert!(validate_handoff_receipt(&receipt, "handoff-1").is_ok());
        assert!(validate_handoff_receipt(&receipt, "handoff-2").is_err());

        let missing_result = LiliaCodeTaskHandoffStatus {
            result_route: None,
            ..receipt
        };
        assert!(validate_handoff_receipt(&missing_result, "handoff-1").is_err());
    }
}

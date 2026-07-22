//! Prefer MutsukiTauriHost `request_app` delivery; keep file handoff as draft recovery only.

use std::path::PathBuf;
use std::time::Duration;

use lilia_github_contracts::workspace::{LiliaCodeTaskHandoff, LiliaCodeTaskHandoffStatus};
use mutsuki_tauri_host::{
    AppDeliveryOptions, AppDeliveryService, AppDescriptor, AppId, AppIdentity, CapabilityDescriptor,
    DeliveryDraftStore, DeliveryReceipt, LinkLocalAppTransport, ProcessAppActivator,
};

const LILIA_CODE_APP_ID: &str = "lilia.code";
const LILIA_CODE_CAPABILITY: &str = "lilia.code.task.accept";
const LILIA_CODE_HANDOFF_PROTOCOL: &str = "lilia-code-task-handoff";
const LILIA_CODE_HANDOFF_VERSION: u32 = 1;

pub async fn deliver_task_handoff_via_app(
    handoff: &LiliaCodeTaskHandoff,
) -> Result<LiliaCodeTaskHandoffStatus, String> {
    let target = AppId::new(LILIA_CODE_APP_ID).map_err(|error| error.to_string())?;
    let lease_dir = delivery_lease_dir()?;
    let drafts = DeliveryDraftStore::persistent(lease_dir.join("drafts"))
        .map_err(|error| format!("初始化投递草稿失败：{error}"))?;
    let transport =
        LinkLocalAppTransport::new(&lease_dir).with_request_timeout(Duration::from_secs(30));
    let activator = ProcessAppActivator::new();
    #[cfg(windows)]
    let executable = which_command("liliacode.cmd").or_else(|| which_command("liliacode"));
    #[cfg(not(windows))]
    let executable = which_command("liliacode");
    activator
        .register(AppDescriptor {
            app_id: target.clone(),
            display_name: "LiliaCode".into(),
            executable: executable.clone().map(PathBuf::from),
            launch_args: Vec::new(),
            bundle_id: None,
        })
        .await;

    let service = AppDeliveryService::new(
        AppIdentity {
            app_id: AppId::new("lilia.github").map_err(|error| error.to_string())?,
            instance_id: format!("github-{}", std::process::id()),
        },
        activator,
        transport,
        drafts,
    );
    let capability = CapabilityDescriptor::new(LILIA_CODE_CAPABILITY, 1, 1);
    let payload = serde_json::to_value(handoff).map_err(|error| error.to_string())?;
    let receipt = service
        .request_app(
            target,
            capability,
            payload,
            AppDeliveryOptions {
                request_id: Some(handoff.id.clone()),
                activate_if_offline: executable.is_some(),
                ready_timeout: Duration::from_secs(45),
                request_timeout: Duration::from_secs(30),
                persist_on_failure: true,
            },
        )
        .await
        .map_err(|error| {
            format!(
                "跨应用直连投递失败（{}）：{error}。任务草稿已保留，可稍后重试。",
                error.kind_name()
            )
        })?;
    map_receipt(receipt, handoff)
}

fn map_receipt(
    receipt: DeliveryReceipt,
    handoff: &LiliaCodeTaskHandoff,
) -> Result<LiliaCodeTaskHandoffStatus, String> {
    match receipt {
        DeliveryReceipt::Accepted {
            request_id,
            remote_task_id,
        } => Ok(accepted_status(
            &request_id,
            remote_task_id.unwrap_or_else(|| handoff.id.clone()),
        )),
        DeliveryReceipt::Duplicate { previous, .. } => map_receipt(*previous, handoff),
        DeliveryReceipt::Completed {
            request_id,
            remote_task_id,
            ..
        } => Ok(accepted_status(
            &request_id,
            remote_task_id.unwrap_or_else(|| handoff.id.clone()),
        )),
        other => Err(format!("LiliaCode 返回了非接受回执：{other:?}")),
    }
}

fn accepted_status(request_id: &str, task_id: String) -> LiliaCodeTaskHandoffStatus {
    LiliaCodeTaskHandoffStatus {
        protocol: LILIA_CODE_HANDOFF_PROTOCOL.to_string(),
        version: LILIA_CODE_HANDOFF_VERSION,
        handoff_id: request_id.to_string(),
        status: "accepted".to_string(),
        task_id: Some(task_id.clone()),
        project_id: Some("lilia-code".into()),
        result_route: Some(format!("liliacode://tasks/{task_id}")),
        error: None,
        updated_at: now_millis().to_string(),
    }
}

fn delivery_lease_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir()
        .join("mutsuki-app-delivery")
        .join("lilia-github");
    std::fs::create_dir_all(&dir).map_err(|error| format!("创建投递目录失败：{error}"))?;
    Ok(dir)
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

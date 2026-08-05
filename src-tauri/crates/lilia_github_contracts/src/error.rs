use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::fmt;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AppErrorCategory {
    Authentication,
    Authorization,
    Cancelled,
    Conflict,
    Network,
    NotFound,
    Persistence,
    RateLimit,
    Validation,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub category: AppErrorCategory,
    pub message: String,
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_after: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<JsonValue>,
}

impl AppError {
    pub fn new(
        code: impl Into<String>,
        category: AppErrorCategory,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            category,
            message: message.into(),
            retryable: matches!(
                category,
                AppErrorCategory::Network | AppErrorCategory::RateLimit
            ),
            http_status: None,
            retry_after: None,
            details: None,
        }
    }

    pub fn with_http_status(mut self, status: u16) -> Self {
        self.http_status = Some(status);
        self
    }

    pub fn with_retry_after(mut self, seconds: u64) -> Self {
        self.retry_after = Some(seconds);
        self
    }

    pub fn with_retryable(mut self, retryable: bool) -> Self {
        self.retryable = retryable;
        self
    }

    pub fn with_details(mut self, details: JsonValue) -> Self {
        self.details = Some(details);
        self
    }

    pub fn from_legacy(message: String) -> Self {
        let cancelled = is_cancelled_message(&message);
        let code = legacy_code(&message)
            .unwrap_or(if cancelled {
                "operation_cancelled"
            } else {
                "unknown"
            })
            .to_string();
        let http_status = legacy_http_status(&message);
        let category = match (code.as_str(), http_status) {
            ("github_authentication_required", _) | (_, Some(401)) => {
                AppErrorCategory::Authentication
            }
            ("github_forbidden", _)
            | ("github_org_sso_required", _)
            | ("github_notifications_scope_required", _)
            | (_, Some(403)) => AppErrorCategory::Authorization,
            ("github_repository_not_accessible", _) | (_, Some(404)) => AppErrorCategory::NotFound,
            ("github_rate_limited", _) | (_, Some(429)) => AppErrorCategory::RateLimit,
            ("workspace_store_missing", _) => AppErrorCategory::Persistence,
            ("workspace_store_corrupt", _) => AppErrorCategory::Validation,
            ("workspace_store_permission", _)
            | ("workspace_store_io", _)
            | ("workspace_store_write_failed", _) => AppErrorCategory::Persistence,
            (_, Some(409)) => AppErrorCategory::Conflict,
            _ if cancelled => AppErrorCategory::Cancelled,
            _ if is_network_message(&message) => AppErrorCategory::Network,
            _ => AppErrorCategory::Unknown,
        };
        let mut error = Self::new(code, category, message);
        error.http_status = http_status;
        error
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}

fn legacy_code(message: &str) -> Option<&str> {
    let end = message.find([':', '：'])?;
    let code = message[..end].trim();
    if !code.is_empty()
        && code
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        && matches!(
            code.split('_').next(),
            Some("github" | "workspace" | "repo" | "operation")
        )
    {
        Some(code)
    } else {
        None
    }
}

fn is_cancelled_message(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("cancelled")
        || lower.contains("canceled")
        || message.contains("已取消")
        || message.contains("取消选择")
}

fn legacy_http_status(message: &str) -> Option<u16> {
    let marker = message.find("HTTP ")? + "HTTP ".len();
    let digits = message[marker..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>();
    digits.parse().ok()
}

fn is_network_message(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    [
        "connection",
        "network",
        "timed out",
        "timeout",
        "dns",
        "proxy",
        "host not found",
    ]
    .iter()
    .any(|fragment| lower.contains(fragment))
        || ["连接失败", "网络", "代理", "证书"]
            .iter()
            .any(|fragment| message.contains(fragment))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_stable_frontend_contract() {
        let error = AppError::new(
            "github_rate_limited",
            AppErrorCategory::RateLimit,
            "GitHub 请求过于频繁。",
        )
        .with_http_status(429)
        .with_retry_after(30);

        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({
                "code": "github_rate_limited",
                "category": "rate-limit",
                "message": "GitHub 请求过于频繁。",
                "retryable": true,
                "httpStatus": 429,
                "retryAfter": 30
            }),
        );
    }

    #[test]
    fn legacy_errors_keep_message_and_gain_machine_readable_recovery_fields() {
        let error = AppError::from_legacy(
            "github_forbidden：读取仓库失败：HTTP 403：Resource not accessible".to_string(),
        );

        assert_eq!(error.code, "github_forbidden");
        assert_eq!(error.category, AppErrorCategory::Authorization);
        assert_eq!(error.http_status, Some(403));
        assert!(!error.retryable);
        assert_eq!(
            error.message,
            "github_forbidden：读取仓库失败：HTTP 403：Resource not accessible"
        );
    }

    #[test]
    fn legacy_cancellation_gets_a_stable_category_and_code() {
        let error = AppError::from_legacy("已取消选择仓库".to_string());

        assert_eq!(error.code, "operation_cancelled");
        assert_eq!(error.category, AppErrorCategory::Cancelled);
        assert!(!error.retryable);
        assert_eq!(error.message, "已取消选择仓库");
    }

    #[test]
    fn workspace_store_errors_have_stable_categories() {
        assert_eq!(
            AppError::from_legacy("workspace_store_corrupt：配置内容损坏".to_string()).category,
            AppErrorCategory::Validation
        );
        assert_eq!(
            AppError::from_legacy("workspace_store_permission：无权读取配置".to_string()).category,
            AppErrorCategory::Persistence
        );
        assert_eq!(
            AppError::from_legacy("workspace_store_io：读取配置失败".to_string()).category,
            AppErrorCategory::Persistence
        );
        assert_eq!(
            AppError::from_legacy("workspace_store_write_failed：保存配置失败".to_string())
                .category,
            AppErrorCategory::Persistence
        );
    }
}

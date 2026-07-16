pub(super) fn validate_number(number: u64) -> Result<u64, String> {
    if number == 0 {
        Err("Discussion 编号不合法".to_string())
    } else if number > i32::MAX as u64 {
        Err("Discussion 编号超出 GitHub GraphQL 支持范围".to_string())
    } else {
        Ok(number)
    }
}

pub(super) fn validate_first(first: Option<u32>) -> Result<u32, String> {
    let first = first.unwrap_or(30);
    if (1..=100).contains(&first) {
        Ok(first)
    } else {
        Err("Discussion 分页大小必须在 1 到 100 之间".to_string())
    }
}

pub(super) fn normalize_states(state: Option<String>) -> Result<Option<Vec<&'static str>>, String> {
    match normalize_optional(state)
        .as_deref()
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        None | Some("all") => Ok(None),
        Some("open") => Ok(Some(vec!["OPEN"])),
        Some("closed") => Ok(Some(vec!["CLOSED"])),
        _ => Err("Discussion 状态必须是 open、closed 或 all".to_string()),
    }
}

pub(super) fn normalize_sort(sort: Option<String>) -> Result<&'static str, String> {
    match normalize_optional(sort)
        .as_deref()
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        None | Some("updated") => Ok("UPDATED_AT"),
        Some("created") => Ok("CREATED_AT"),
        _ => Err("Discussion 排序必须是 created 或 updated".to_string()),
    }
}

pub(super) fn normalize_direction(direction: Option<String>) -> Result<&'static str, String> {
    match normalize_optional(direction)
        .as_deref()
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        None | Some("desc") => Ok("DESC"),
        Some("asc") => Ok("ASC"),
        _ => Err("Discussion 排序方向必须是 asc 或 desc".to_string()),
    }
}

pub(super) fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn require_text(value: String, error: &str) -> Result<String, String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        Err(error.to_string())
    } else {
        Ok(value)
    }
}

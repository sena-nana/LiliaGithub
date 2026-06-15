use super::*;

pub(super) fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
}

pub(super) fn default_true() -> bool {
    true
}

pub(super) fn current_utc_day_index() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|value| (value.as_secs() / 86_400) as i64)
        .unwrap_or_default()
}

pub(super) fn format_day_index(day_index: i64) -> String {
    let (year, month, day) = civil_from_days(day_index);
    format!("{year:04}-{month:02}-{day:02}")
}

pub(super) fn github_contribution_days(
    counts: &HashMap<String, usize>,
    end_day_index: i64,
) -> Vec<GitHubContributionDay> {
    let start = end_day_index - GITHUB_CONTRIBUTION_DAYS as i64 + 1;
    (0..GITHUB_CONTRIBUTION_DAYS)
        .map(|offset| {
            let date = format_day_index(start + offset as i64);
            GitHubContributionDay {
                count: counts.get(&date).copied().unwrap_or_default(),
                date,
            }
        })
        .collect()
}

pub(super) fn github_contribution_meta(
    repo_count: usize,
    requested_repo_count: usize,
    skipped_repo_count: usize,
) -> GitHubContributionMeta {
    GitHubContributionMeta {
        repo_count,
        requested_repo_count,
        repo_limit: GITHUB_CONTRIBUTIONS_REPO_LIMIT,
        truncated: requested_repo_count > repo_count,
        skipped_repo_count,
        refreshed_at: now_millis(),
    }
}

pub(super) fn collect_local_contribution_counts(
    path: &Path,
    start_day_index: i64,
    end_day_index: i64,
    counts: &mut HashMap<String, usize>,
) -> Result<(), String> {
    if end_day_index < start_day_index {
        return Ok(());
    }
    let since = format!("{}T00:00:00Z", format_day_index(start_day_index));
    let until = format!("{}T23:59:59Z", format_day_index(end_day_index));
    let output = git_command_lossy(
        path,
        &[
            "log",
            &format!("--since={since}"),
            &format!("--until={until}"),
            "--format=%ct",
        ],
    )
    .unwrap_or_default();
    for line in output.lines() {
        let ts = match line.trim().parse::<i64>() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let day_index = ts / 86_400;
        if day_index < start_day_index || day_index > end_day_index {
            continue;
        }
        *counts.entry(format_day_index(day_index)).or_default() += 1;
    }
    Ok(())
}

pub(super) fn normalize_local_contribution_repo_id(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.starts_with("github:") {
        return None;
    }
    let repo_id = trimmed.strip_prefix("local:").unwrap_or(trimmed).trim();
    if repo_id.is_empty() || repo_id.contains("://") || repo_id.contains('\\') {
        None
    } else {
        Some(repo_id.trim_matches('/').to_string())
    }
}

pub(super) fn cached_local_contribution_count(
    settings: &WorkspaceSettings,
    repo_id: &str,
    date: &str,
) -> Option<usize> {
    settings
        .local_contribution_cache
        .get(repo_id)
        .and_then(|repo| repo.get(date))
        .map(|entry| entry.count)
}

pub(super) fn write_local_contribution_cache(
    settings: &mut WorkspaceSettings,
    repo_id: &str,
    date: &str,
    count: usize,
) {
    settings
        .local_contribution_cache
        .entry(repo_id.to_string())
        .or_default()
        .insert(
            date.to_string(),
            LocalContributionDayCache {
                count,
                updated_at: now_millis(),
            },
        );
}

pub(super) fn remove_local_contribution_cache(settings: &mut WorkspaceSettings, repo_id: &str) {
    settings.local_contribution_cache.remove(repo_id);
}

#[cfg(test)]
pub(super) fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let year = year - if month <= 2 { 1 } else { 0 };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let month = month as i32;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day as i32 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146_097 + doe - 719_468) as i64
}

pub(super) fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let days = days + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let doe = days - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = year + if month <= 2 { 1 } else { 0 };
    (year as i32, month as u32, day as u32)
}

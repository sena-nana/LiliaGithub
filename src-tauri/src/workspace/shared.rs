use super::*;

#[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
pub(super) fn configure_background_command(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

pub(super) fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
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
                repositories: Vec::new(),
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
    identities: &[ContributionIdentity],
    counts: &mut HashMap<String, usize>,
) -> Result<(), String> {
    if end_day_index < start_day_index || identities.is_empty() {
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
            "--format=%an%x1f%ae%x1f%ct",
        ],
    )
    .unwrap_or_default();
    for line in output.lines() {
        let mut parts = line.split('\x1f');
        let author_name = parts.next().unwrap_or("");
        let author_email = parts.next().unwrap_or("");
        if !contribution_identity_matches(identities, author_name, author_email) {
            continue;
        }
        let ts = match parts.next().unwrap_or("").trim().parse::<i64>() {
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

pub(super) fn local_contribution_identities(
    path: &Path,
    settings: &WorkspaceSettings,
) -> Vec<ContributionIdentity> {
    let mut identities = Vec::new();
    let mut seen = Vec::new();
    for identity in repo_git_identity(path)
        .into_iter()
        .chain(settings.contribution_identities.iter().cloned())
    {
        let Some(key) = contribution_identity_key(&identity) else {
            continue;
        };
        if seen.iter().any(|seen_key| seen_key == &key) {
            continue;
        }
        seen.push(key);
        identities.push(identity);
    }
    identities
}

fn repo_git_identity(path: &Path) -> Option<ContributionIdentity> {
    let name = git_command_lossy(path, &["config", "user.name"])
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let email = git_command_lossy(path, &["config", "user.email"])
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());
    if name.is_none() && email.is_none() {
        None
    } else {
        Some(ContributionIdentity { name, email })
    }
}

fn contribution_identity_key(identity: &ContributionIdentity) -> Option<(String, String)> {
    let name = identity
        .name
        .as_deref()
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    let email = identity
        .email
        .as_deref()
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    if name.is_empty() && email.is_empty() {
        None
    } else {
        Some((name, email))
    }
}

pub(super) fn contribution_identity_matches(
    identities: &[ContributionIdentity],
    author_name: &str,
    author_email: &str,
) -> bool {
    let name = author_name.trim().to_ascii_lowercase();
    let email = author_email.trim().to_ascii_lowercase();
    identities.iter().any(|identity| {
        let name_matches = identity
            .name
            .as_deref()
            .map(|identity_name| {
                !name.is_empty() && name == identity_name.trim().to_ascii_lowercase()
            })
            .unwrap_or(false);
        let email_matches = identity
            .email
            .as_deref()
            .map(|identity_email| {
                !email.is_empty() && email == identity_email.trim().to_ascii_lowercase()
            })
            .unwrap_or(false);
        name_matches || email_matches
    })
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

#[cfg(test)]
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

#[cfg(test)]
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

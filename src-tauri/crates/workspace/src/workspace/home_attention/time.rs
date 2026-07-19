use crate::workspace::github::parse_github_datetime;

const RECENT_WINDOW_SECONDS: i64 = 30 * 24 * 60 * 60;

pub(super) fn is_within_recent_window(value: &str, now: i64) -> bool {
    parse_github_datetime(value)
        .is_some_and(|timestamp| timestamp >= now - RECENT_WINDOW_SECONDS && timestamp <= now)
}

pub(super) fn timestamp(value: &str) -> i64 {
    parse_github_datetime(value).unwrap_or(i64::MIN)
}

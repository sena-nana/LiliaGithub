use std::path::{Component, Path};
use std::process::{Command, Stdio};

use lilia_github_contracts::workspace::{RepoConflictChoice, RepoConflictHunk};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoStatusEntry {
    pub index: String,
    pub worktree: String,
    pub path: String,
    pub old_path: Option<String>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct RepoStatusSnapshot {
    pub current_branch: Option<String>,
    pub ahead: i32,
    pub behind: i32,
    pub entries: Vec<RepoStatusEntry>,
}

#[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
fn configure_background_command(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

pub fn git_command(
    repo_path: &Path,
    args: &[&str],
    auth_header: Option<&str>,
) -> Result<String, String> {
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(repo_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_background_command(&mut command);
    if let Some(header) = auth_header {
        command
            .env("GIT_CONFIG_COUNT", "1")
            .env("GIT_CONFIG_KEY_0", "http.https://github.com/.extraheader")
            .env("GIT_CONFIG_VALUE_0", header);
    }
    let output = command
        .output()
        .map_err(|e| format!("无法启动 git（请确认 git 在 PATH 中）：{e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(if detail.is_empty() {
            format!(
                "git {:?} 失败：exit {}",
                args,
                output.status.code().unwrap_or(-1)
            )
        } else {
            detail
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn git_command_lossy(repo_path: &Path, args: &[&str]) -> Option<String> {
    git_command(repo_path, args, None)
        .ok()
        .map(|s| s.trim().to_string())
}

pub fn origin_remote_url(path: &Path) -> Option<String> {
    git_command_lossy(path, &["remote", "get-url", "origin"]).filter(|value| !value.is_empty())
}

pub fn parse_github_remote(remote: &str) -> Option<String> {
    let trimmed = remote.trim().trim_end_matches(".git");
    let path = if let Some(rest) = trimmed.strip_prefix("https://github.com/") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("http://github.com/") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("git@github.com:") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("ssh://git@github.com/") {
        rest
    } else {
        return None;
    };
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() >= 2 && !parts[0].is_empty() && !parts[1].is_empty() {
        Some(format!("{}/{}", parts[0], parts[1]))
    } else {
        None
    }
}

pub fn normalize_git_remote_error(remote: &str, error: String) -> String {
    let Some(full_name) = parse_github_remote(remote) else {
        return error;
    };
    let lower = error.to_ascii_lowercase();
    if lower.contains("repository not found") || lower.contains("not found") {
        return format!(
            "无法访问 GitHub 仓库 {full_name}：仓库不存在、是私有仓库且当前 GitHub 绑定无权限，或仓库名输入有误。"
        );
    }
    if lower.contains("authentication failed")
        || lower.contains("could not read username")
        || lower.contains("terminal prompts disabled")
        || lower.contains("authentication required")
    {
        return format!("无法认证 GitHub 仓库 {full_name}，请重新绑定 GitHub 后再试。");
    }
    error
}

pub fn map_remote_git_error(path: &Path, error: String) -> String {
    current_upstream_remote(path)
        .and_then(|remote| remote_url(path, &remote))
        .or_else(|| origin_remote_url(path))
        .map(|remote| normalize_git_remote_error(&remote, error.clone()))
        .unwrap_or(error)
}

pub fn remote_url(path: &Path, remote: &str) -> Option<String> {
    git_command_lossy(path, &["remote", "get-url", remote]).filter(|value| !value.is_empty())
}

pub fn map_named_remote_git_error(path: &Path, remote: &str, error: String) -> String {
    remote_url(path, remote)
        .map(|url| normalize_git_remote_error(&url, error.clone()))
        .unwrap_or(error)
}

pub fn current_upstream_remote(path: &Path) -> Option<String> {
    let branch = git_command_lossy(path, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
    git_config_value(path, &format!("branch.{branch}.remote"))
}

pub fn run_pull(path: &Path, auth_header: Option<&str>) -> Result<(), String> {
    git_command(path, &["pull", "--ff-only"], auth_header)
        .map(|_| ())
        .map_err(|error| map_remote_git_error(path, error))
}

pub fn run_fetch(path: &Path, auth_header: Option<&str>) -> Result<(), String> {
    git_command(path, &["fetch"], auth_header)
        .map(|_| ())
        .map_err(|error| map_remote_git_error(path, error))
}

pub fn run_fetch_remote(
    path: &Path,
    remote: &str,
    auth_header: Option<&str>,
) -> Result<(), String> {
    git_command(path, &["fetch", "--", remote], auth_header)
        .map(|_| ())
        .map_err(|error| map_named_remote_git_error(path, remote, error))
}

pub fn run_push(path: &Path, auth_header: Option<&str>) -> Result<(), String> {
    if git_command_lossy(path, &["rev-parse", "--verify", "@{upstream}"]).is_some() {
        git_command(path, &["push"], auth_header)
    } else {
        let branch = git_command_lossy(path, &["symbolic-ref", "--quiet", "--short", "HEAD"])
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "当前 HEAD 未指向命名分支，无法发布".to_string())?;
        let branch_remote_key = format!("branch.{branch}.remote");
        let merge_key = format!("branch.{branch}.merge");
        let remote =
            git_config_value(path, &branch_remote_key).unwrap_or_else(|| "origin".to_string());
        let target_branch = git_config_value(path, &merge_key)
            .and_then(|value| value.strip_prefix("refs/heads/").map(str::to_string))
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| branch.clone());
        let refspec = format!("HEAD:refs/heads/{target_branch}");
        git_command(
            path,
            &["push", "--set-upstream", "--", &remote, &refspec],
            auth_header,
        )
    }
    .map(|_| ())
    .map_err(|error| map_remote_git_error(path, error))
}

pub fn run_push_remote(
    path: &Path,
    remote: &str,
    target_branch: &str,
    set_upstream: bool,
    auth_header: Option<&str>,
) -> Result<(), String> {
    let refspec = format!("HEAD:refs/heads/{target_branch}");
    let mut args = vec!["push"];
    if set_upstream {
        args.push("--set-upstream");
    }
    args.extend(["--", remote, refspec.as_str()]);
    git_command(path, &args, auth_header)
        .map(|_| ())
        .map_err(|error| map_named_remote_git_error(path, remote, error))
}

fn git_config_value(path: &Path, key: &str) -> Option<String> {
    git_command_lossy(path, &["config", "--get", key]).filter(|value| !value.is_empty())
}

pub fn infer_clone_directory_name(remote_url: &str) -> Result<String, String> {
    let trimmed = remote_url
        .trim()
        .trim_end_matches('/')
        .trim_end_matches(".git");
    let candidate = trimmed
        .rsplit(['/', ':'])
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "无法从远端地址推断目录名".to_string())?;
    validate_clone_directory_name(candidate)?;
    Ok(candidate.to_string())
}

pub fn normalize_clone_directory_name(
    remote_url: &str,
    directory_name: Option<String>,
) -> Result<String, String> {
    let name = directory_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| infer_clone_directory_name(remote_url).unwrap_or_default());
    validate_clone_directory_name(&name)?;
    Ok(name)
}

pub fn validate_clone_directory_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("目录名不能为空".to_string());
    }
    if trimmed != name || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("目录名只能是单层目录名".to_string());
    }
    let mut components = Path::new(trimmed).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(value)), None) if value.to_string_lossy() != ".." => Ok(()),
        _ => Err("目录名只能是单层目录名".to_string()),
    }
}

pub fn status_pair(line: &str) -> (String, String) {
    let mut chars = line.chars();
    (
        chars.next().unwrap_or(' ').to_string(),
        chars.next().unwrap_or(' ').to_string(),
    )
}

fn parse_status_branch(header: &str) -> Option<&str> {
    if header.starts_with("HEAD") {
        return None;
    }
    header
        .strip_prefix("No commits yet on ")
        .unwrap_or(header)
        .split("...")
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub fn parse_status_snapshot(status: &str) -> RepoStatusSnapshot {
    let mut snapshot = RepoStatusSnapshot::default();
    let mut parts = status.split('\0').filter(|value| !value.is_empty());
    while let Some(line) = parts.next() {
        if let Some(header) = line.strip_prefix("## ") {
            snapshot.current_branch = parse_status_branch(header).map(str::to_string);
            if let Some(info) = header
                .split('[')
                .nth(1)
                .and_then(|value| value.split(']').next())
            {
                for item in info.split(',') {
                    let item = item.trim();
                    if let Some(value) = item.strip_prefix("ahead ") {
                        snapshot.ahead = value.parse().unwrap_or_default();
                    } else if let Some(value) = item.strip_prefix("behind ") {
                        snapshot.behind = value.parse().unwrap_or_default();
                    }
                }
            }
            continue;
        }

        if line.len() < 3 {
            continue;
        }
        let (index, worktree) = status_pair(line);
        let mut path = line[3..].to_string();
        let mut old_path = None;
        if matches!(index.as_str(), "R" | "C") {
            old_path = parts.next().map(str::to_string);
        }
        if path.is_empty() {
            path = old_path.clone().unwrap_or_default();
        }
        snapshot.entries.push(RepoStatusEntry {
            index,
            worktree,
            path,
            old_path,
        });
    }
    snapshot
}

pub fn is_conflict_status(index: &str, worktree: &str) -> bool {
    matches!(
        (index, worktree),
        ("U", "U") | ("A", "A") | ("D", "D") | ("A", "U") | ("U", "A") | ("D", "U") | ("U", "D")
    )
}

pub fn parse_conflict_hunks(content: &str) -> Vec<RepoConflictHunk> {
    let lines: Vec<_> = content.lines().collect();
    let mut hunks = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let Some(ours_label) = lines[index].strip_prefix("<<<<<<<") else {
            index += 1;
            continue;
        };
        let start_line = index + 1;
        let ours_label = conflict_marker_label(ours_label, "HEAD");
        index += 1;
        let mut ours_lines = Vec::new();
        while index < lines.len() && lines[index] != "=======" {
            ours_lines.push(lines[index].to_string());
            index += 1;
        }
        if index >= lines.len() {
            break;
        }
        index += 1;
        let mut theirs_lines = Vec::new();
        while index < lines.len() && !lines[index].starts_with(">>>>>>>") {
            theirs_lines.push(lines[index].to_string());
            index += 1;
        }
        if index >= lines.len() {
            break;
        }
        let theirs_label = conflict_marker_label(
            lines[index].strip_prefix(">>>>>>>").unwrap_or_default(),
            "theirs",
        );
        let end_line = index + 1;
        hunks.push(RepoConflictHunk {
            id: format!("hunk-{}", hunks.len() + 1),
            start_line,
            end_line,
            ours_label,
            theirs_label,
            ours_lines,
            theirs_lines,
        });
        index += 1;
    }
    hunks
}

fn conflict_marker_label(raw: &str, fallback: &str) -> String {
    let value = raw.trim();
    if value.is_empty() {
        fallback.to_string()
    } else {
        value.to_string()
    }
}

pub fn resolve_conflict_content(
    content: &str,
    choices: &[RepoConflictChoice],
) -> Result<String, String> {
    let hunks = parse_conflict_hunks(content);
    let mut resolved = content.to_string();
    for hunk in hunks.iter().rev() {
        let choice = choices
            .iter()
            .find(|choice| choice.hunk_id == hunk.id)
            .ok_or_else(|| format!("缺少冲突块选择：{}", hunk.id))?;
        let replacement = match choice.side.as_str() {
            "ours" => hunk.ours_lines.join("\n"),
            "theirs" => hunk.theirs_lines.join("\n"),
            "both" => hunk
                .ours_lines
                .iter()
                .chain(hunk.theirs_lines.iter())
                .cloned()
                .collect::<Vec<_>>()
                .join("\n"),
            _ => return Err("冲突选择只能是 ours、theirs 或 both".to_string()),
        };
        let mut lines = resolved.lines().map(str::to_string).collect::<Vec<_>>();
        lines.splice(
            hunk.start_line - 1..hunk.end_line,
            replacement.lines().map(str::to_string),
        );
        resolved = format!("{}\n", lines.join("\n"));
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static NEXT_TEMP_DIRECTORY: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let sequence = NEXT_TEMP_DIRECTORY.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "lilia-github-git-{label}-{}-{nonce}-{sequence}",
                std::process::id()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn join(&self, path: &str) -> PathBuf {
            self.0.join(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn run_test_git(path: &Path, args: &[&str]) -> String {
        git_command(path, args, None).unwrap().trim().to_string()
    }

    fn init_bare_repo(path: &Path) {
        fs::create_dir_all(path).unwrap();
        run_test_git(path, &["init", "--bare"]);
    }

    fn init_work_repo(path: &Path, branch: &str) {
        fs::create_dir_all(path).unwrap();
        run_test_git(path, &["init"]);
        run_test_git(path, &["config", "user.name", "Lilia Test"]);
        run_test_git(path, &["config", "user.email", "lilia@example.com"]);
        fs::write(path.join("tracked.txt"), "initial\n").unwrap();
        run_test_git(path, &["add", "--", "tracked.txt"]);
        run_test_git(path, &["commit", "-m", "initial"]);
        run_test_git(path, &["branch", "-M", branch]);
    }

    fn commit_file(path: &Path, contents: &str, message: &str) -> String {
        fs::write(path.join("tracked.txt"), contents).unwrap();
        run_test_git(path, &["add", "--", "tracked.txt"]);
        run_test_git(path, &["commit", "-m", message]);
        run_test_git(path, &["rev-parse", "HEAD"])
    }

    #[test]
    fn parses_github_remote_variants() {
        assert_eq!(
            parse_github_remote("https://github.com/sena-nana/LiliaGithub.git").as_deref(),
            Some("sena-nana/LiliaGithub")
        );
        assert_eq!(
            parse_github_remote("git@github.com:sena-nana/Lilia.git").as_deref(),
            Some("sena-nana/Lilia")
        );
        assert_eq!(parse_github_remote("https://example.com/repo.git"), None);
    }

    #[test]
    fn normalizes_clone_directory_name_with_user_override() {
        assert_eq!(
            infer_clone_directory_name("https://github.com/sena-nana/source-name.git").unwrap(),
            "source-name"
        );
        assert_eq!(
            normalize_clone_directory_name(
                "https://github.com/sena-nana/source-name.git",
                Some("target-name".to_string()),
            )
            .unwrap(),
            "target-name"
        );
        assert!(normalize_clone_directory_name(
            "https://github.com/sena-nana/source-name.git",
            Some("../target".to_string()),
        )
        .is_err());
    }

    #[test]
    fn push_without_upstream_publishes_branch_and_sets_upstream() {
        let fixture = TestDirectory::new("publish");
        let repo = fixture.join("repo");
        let remote = fixture.join("origin.git");
        init_work_repo(&repo, "main");
        init_bare_repo(&remote);
        let remote_path = remote.to_string_lossy();
        run_test_git(&repo, &["remote", "add", "origin", remote_path.as_ref()]);

        run_push(&repo, None).unwrap();

        assert_eq!(
            run_test_git(&remote, &["rev-parse", "refs/heads/main"]),
            run_test_git(&repo, &["rev-parse", "HEAD"])
        );
        assert_eq!(
            run_test_git(
                &repo,
                &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]
            ),
            "origin/main"
        );

        let next_head = commit_file(&repo, "next\n", "next");
        run_push(&repo, None).unwrap();
        assert_eq!(
            run_test_git(&remote, &["rev-parse", "refs/heads/main"]),
            next_head
        );
    }

    #[test]
    fn push_republishes_deleted_configured_remote_branch() {
        let fixture = TestDirectory::new("republish");
        let repo = fixture.join("repo");
        let remote = fixture.join("fork.git");
        init_work_repo(&repo, "topic");
        init_bare_repo(&remote);
        let remote_path = remote.to_string_lossy();
        run_test_git(&repo, &["remote", "add", "fork", remote_path.as_ref()]);
        run_test_git(
            &repo,
            &["push", "--set-upstream", "fork", "HEAD:refs/heads/review"],
        );
        run_test_git(&remote, &["update-ref", "-d", "refs/heads/review"]);
        run_test_git(&repo, &["update-ref", "-d", "refs/remotes/fork/review"]);

        run_push(&repo, None).unwrap();

        assert_eq!(
            run_test_git(&remote, &["rev-parse", "refs/heads/review"]),
            run_test_git(&repo, &["rev-parse", "HEAD"])
        );
        assert_eq!(
            run_test_git(
                &repo,
                &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]
            ),
            "fork/review"
        );
    }

    #[test]
    fn publish_path_does_not_bypass_non_fast_forward_protection() {
        let fixture = TestDirectory::new("non-fast-forward");
        let repo = fixture.join("repo");
        let competing_repo = fixture.join("competing");
        let remote = fixture.join("origin.git");
        init_work_repo(&repo, "main");
        init_work_repo(&competing_repo, "main");
        init_bare_repo(&remote);
        let remote_path = remote.to_string_lossy();
        run_test_git(&repo, &["remote", "add", "origin", remote_path.as_ref()]);
        run_test_git(
            &competing_repo,
            &["remote", "add", "origin", remote_path.as_ref()],
        );
        let remote_head = commit_file(&competing_repo, "remote\n", "remote change");
        run_test_git(&competing_repo, &["push", "origin", "main"]);

        assert!(run_push(&repo, None).is_err());
        assert_eq!(
            run_test_git(&remote, &["rev-parse", "refs/heads/main"]),
            remote_head
        );
    }

    #[test]
    fn named_remote_push_sets_upstream_only_for_selected_remote() {
        let fixture = TestDirectory::new("multi-publish");
        let repo = fixture.join("repo");
        let primary = fixture.join("primary.git");
        let mirror = fixture.join("mirror.git");
        init_work_repo(&repo, "main");
        init_bare_repo(&primary);
        init_bare_repo(&mirror);
        run_test_git(
            &repo,
            &[
                "remote",
                "add",
                "primary",
                primary.to_string_lossy().as_ref(),
            ],
        );
        run_test_git(
            &repo,
            &["remote", "add", "mirror", mirror.to_string_lossy().as_ref()],
        );

        run_push_remote(&repo, "primary", "main", true, None).unwrap();
        run_push_remote(&repo, "mirror", "main", false, None).unwrap();

        assert_eq!(
            run_test_git(
                &repo,
                &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]
            ),
            "primary/main"
        );
        let head = run_test_git(&repo, &["rev-parse", "HEAD"]);
        assert_eq!(
            run_test_git(&primary, &["rev-parse", "refs/heads/main"]),
            head
        );
        assert_eq!(
            run_test_git(&mirror, &["rev-parse", "refs/heads/main"]),
            head
        );
    }

    #[test]
    fn named_remote_errors_use_that_remotes_url() {
        let fixture = TestDirectory::new("remote-error-url");
        let repo = fixture.join("repo");
        init_work_repo(&repo, "main");
        run_test_git(
            &repo,
            &[
                "remote",
                "add",
                "fork",
                "https://github.com/example/private-fork.git",
            ],
        );

        let message =
            map_named_remote_git_error(&repo, "fork", "remote: Repository not found".to_string());

        assert!(message.contains("example/private-fork"));
    }

    #[test]
    fn parses_status_snapshot_header_and_entries() {
        let snapshot = parse_status_snapshot(
            "## main...origin/main [ahead 2, behind 1]\0 M src/main.ts\0R  new.ts\0old.ts\0UU conflict.ts\0",
        );

        assert_eq!(snapshot.current_branch.as_deref(), Some("main"));
        assert_eq!(snapshot.ahead, 2);
        assert_eq!(snapshot.behind, 1);
        assert_eq!(snapshot.entries.len(), 3);
        assert_eq!(snapshot.entries[1].path, "new.ts");
        assert_eq!(snapshot.entries[1].old_path.as_deref(), Some("old.ts"));
        assert!(snapshot
            .entries
            .iter()
            .any(|entry| is_conflict_status(&entry.index, &entry.worktree)));
    }

    #[test]
    fn parses_unborn_and_detached_status_branches() {
        assert_eq!(
            parse_status_snapshot("## No commits yet on main\0")
                .current_branch
                .as_deref(),
            Some("main")
        );
        assert_eq!(
            parse_status_snapshot("## No commits yet on trunk...origin/trunk [gone]\0")
                .current_branch
                .as_deref(),
            Some("trunk")
        );
        assert_eq!(
            parse_status_snapshot("## HEAD (no branch)\0").current_branch,
            None
        );
        assert_eq!(
            parse_status_snapshot("## HEAD (detached at a1b2c3d)\0").current_branch,
            None
        );
    }

    #[test]
    fn resolves_conflict_content_from_hunk_choices() {
        let content = [
            "keep",
            &format!("{} HEAD", "<<<<<<<"),
            "ours one",
            "=======",
            "theirs one",
            &format!("{} origin/main", ">>>>>>>"),
            &format!("{} HEAD", "<<<<<<<"),
            "ours two",
            "=======",
            "theirs two",
            &format!("{} origin/main", ">>>>>>>"),
            "",
        ]
        .join("\n");

        let resolved = resolve_conflict_content(
            &content,
            &[
                RepoConflictChoice {
                    hunk_id: "hunk-1".to_string(),
                    side: "ours".to_string(),
                },
                RepoConflictChoice {
                    hunk_id: "hunk-2".to_string(),
                    side: "theirs".to_string(),
                },
            ],
        )
        .unwrap();

        assert_eq!(resolved, "keep\nours one\ntheirs two\n");
        assert!(!resolved.contains("<<<<<<<"));
        assert!(!resolved.contains("======="));
        assert!(!resolved.contains(">>>>>>>"));
    }
}

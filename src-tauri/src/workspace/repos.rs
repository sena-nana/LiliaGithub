use super::bulk::{merge_pull_block_reason_with_mode, repo_dirty_count};
use super::*;

pub(super) const MAX_REPO_REFRESH_CONCURRENCY: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RepoStatusEntry {
    pub(super) index: String,
    pub(super) worktree: String,
    pub(super) path: String,
    pub(super) old_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RepoFetchFailure {
    pub(super) repo_name: String,
    pub(super) error: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct GitWorktreeEntry {
    pub(super) path: PathBuf,
    pub(super) branch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ResolvedRepoWorktree {
    pub(super) summary: RepoWorktree,
    pub(super) main_worktree_path: Option<PathBuf>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct LanguageStatAccumulator {
    bytes: u64,
    lines: u64,
}

pub(super) fn git_command(
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

pub(super) fn git_command_lossy(repo_path: &Path, args: &[&str]) -> Option<String> {
    git_command(repo_path, args, None)
        .ok()
        .map(|s| s.trim().to_string())
}

pub(super) fn git_diff_command_lossy(repo_path: &Path, args: &[&str]) -> Option<String> {
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(repo_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = command.output().ok()?;
    if output.status.success() || output.status.code() == Some(1) {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

fn git_blob_line_counts(repo_path: &Path, object_ids: &[String]) -> Result<Vec<u64>, String> {
    if object_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut child = Command::new("git")
        .args(["cat-file", "--batch"])
        .current_dir(repo_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 git（请确认 git 在 PATH 中）：{e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write as _;
        for object_id in object_ids {
            writeln!(stdin, "{object_id}").map_err(|e| format!("写入 git cat-file 失败：{e}"))?;
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("读取 git cat-file 失败：{e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!(
                "git cat-file --batch 失败：exit {}",
                output.status.code().unwrap_or(-1)
            )
        } else {
            stderr
        });
    }

    let mut counts = Vec::with_capacity(object_ids.len());
    let mut cursor = 0;
    while cursor < output.stdout.len() && counts.len() < object_ids.len() {
        let Some(header_end) = output.stdout[cursor..].iter().position(|byte| *byte == b'\n')
        else {
            break;
        };
        let header_end = cursor + header_end;
        let header = String::from_utf8_lossy(&output.stdout[cursor..header_end]);
        let size = header
            .split_whitespace()
            .last()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        let content_start = header_end + 1;
        let content_end = content_start.saturating_add(size).min(output.stdout.len());
        counts.push(count_lines(&output.stdout[content_start..content_end]));
        cursor = content_end;
        if output.stdout.get(cursor) == Some(&b'\n') {
            cursor += 1;
        }
    }
    Ok(counts)
}

pub(super) fn should_skip_dir(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    matches!(
        name,
        "node_modules" | "target" | "dist" | ".cache" | ".yarn"
    )
}

pub(super) fn is_git_repo(path: &Path) -> bool {
    path.join(".git").exists()
}

pub(super) fn canonical_repo_path(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

pub(super) fn git_worktree_entries(path: &Path) -> Vec<GitWorktreeEntry> {
    let output = git_command_lossy(path, &["worktree", "list", "--porcelain"]).unwrap_or_default();
    let mut entries = Vec::new();
    let mut current_path: Option<PathBuf> = None;
    let mut current_branch: Option<String> = None;

    for line in output.lines() {
        if let Some(value) = line.strip_prefix("worktree ") {
            if let Some(path) = current_path.take() {
                entries.push(GitWorktreeEntry {
                    path,
                    branch: current_branch.take(),
                });
            }
            current_path = Some(canonical_repo_path(Path::new(value.trim())));
            current_branch = None;
            continue;
        }
        if let Some(value) = line.strip_prefix("branch refs/heads/") {
            current_branch = Some(value.trim().to_string());
            continue;
        }
        if line.is_empty() {
            if let Some(path) = current_path.take() {
                entries.push(GitWorktreeEntry {
                    path,
                    branch: current_branch.take(),
                });
            }
            current_branch = None;
        }
    }

    if let Some(path) = current_path {
        entries.push(GitWorktreeEntry {
            path,
            branch: current_branch,
        });
    }

    if entries.is_empty() {
        entries.push(GitWorktreeEntry {
            path: canonical_repo_path(path),
            branch: None,
        });
    }

    entries
}

pub(super) fn git_common_dir(path: &Path) -> Option<PathBuf> {
    let raw = git_command_lossy(path, &["rev-parse", "--git-common-dir"])?;
    if raw.is_empty() {
        return None;
    }
    let common_dir = PathBuf::from(raw.trim());
    let absolute = if common_dir.is_absolute() {
        common_dir
    } else {
        path.join(common_dir)
    };
    Some(canonical_repo_path(&absolute))
}

fn repo_id_within_root(root: &Path, path: &Path) -> Option<String> {
    let canonical_root = canonical_repo_path(root);
    let canonical_path = canonical_repo_path(path);
    if !canonical_path.starts_with(&canonical_root) || !is_git_repo(&canonical_path) {
        return None;
    }
    Some(repo_id(&canonical_root, &canonical_path))
}

pub(super) fn resolve_repo_worktree(root: &Path, path: &Path) -> ResolvedRepoWorktree {
    let current_path = canonical_repo_path(path);
    let shared_repo_key = normalize_worktree_display_path(
        &git_common_dir(path).unwrap_or_else(|| current_path.join(".git")),
    );
    let worktrees = git_worktree_entries(path);
    if worktrees.len() <= 1 {
        return ResolvedRepoWorktree {
            summary: RepoWorktree {
                role: "standalone".to_string(),
                shared_repo_key,
                main_repo_id: None,
            },
            main_worktree_path: None,
        };
    }

    let main_path = worktrees
        .first()
        .map(|entry| entry.path.clone())
        .unwrap_or_else(|| current_path.clone());
    let current_is_main = current_path == main_path;
    ResolvedRepoWorktree {
        summary: RepoWorktree {
            role: if current_is_main { "main" } else { "linked" }.to_string(),
            shared_repo_key,
            main_repo_id: repo_id_within_root(root, &main_path),
        },
        main_worktree_path: Some(main_path),
    }
}

pub(super) fn repo_id(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .ok()
        .and_then(|p| p.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| path.file_name().and_then(|v| v.to_str()).unwrap_or("repo"))
        .replace('\\', "/")
}

pub(super) fn normalize_repo_path(root: &Path, repo_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(repo_path.trim());
    let absolute = if path.is_absolute() {
        path
    } else {
        root.join(path)
    };
    if !absolute.exists() || !absolute.is_dir() {
        return Err(format!("仓库目录不存在：{}", absolute.display()));
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("读取工作区路径失败：{e}"))?;
    let canonical_path = absolute
        .canonicalize()
        .map_err(|e| format!("读取仓库路径失败：{e}"))?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err("仓库必须位于当前工作区内".to_string());
    }
    if !is_git_repo(&canonical_path) {
        return Err(format!("不是 Git 仓库：{}", canonical_path.display()));
    }
    Ok(canonical_path)
}

pub(super) fn infer_clone_directory_name(remote_url: &str) -> Result<String, String> {
    let trimmed = remote_url
        .trim()
        .trim_end_matches('/')
        .trim_end_matches(".git");
    if trimmed.is_empty() {
        return Err("远端 URL 不能为空".to_string());
    }
    if let Some(full_name) = parse_github_remote(trimmed) {
        if let Some(name) = full_name
            .rsplit('/')
            .next()
            .filter(|value| !value.is_empty())
        {
            return Ok(name.to_string());
        }
    }
    let source = trimmed
        .split_once(':')
        .filter(|(prefix, _)| prefix.contains('@') && !prefix.contains('/'))
        .map(|(_, path)| path)
        .unwrap_or(trimmed);
    source
        .split(['/', '\\'])
        .filter(|part| !part.is_empty())
        .last()
        .map(|value| value.to_string())
        .ok_or_else(|| "无法从远端 URL 推导目录名".to_string())
}

pub(super) fn normalize_clone_directory_name(
    remote_url: &str,
    directory_name: Option<String>,
) -> Result<String, String> {
    let name = directory_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .map(Ok)
        .unwrap_or_else(|| infer_clone_directory_name(remote_url))?;
    validate_clone_directory_name(&name)?;
    Ok(name)
}

pub(super) fn normalize_git_remote_error(remote: &str, error: String) -> String {
    let lower = error.to_ascii_lowercase();
    let github_full_name = parse_github_remote(remote);
    if lower.contains("repository not found") {
        return github_full_name
            .map(|full_name| {
                format!(
                    "无法访问 GitHub 仓库 {full_name}：仓库不存在、是私有仓库且当前 GitHub 绑定无权限，或仓库名输入有误。"
                )
            })
            .unwrap_or_else(|| "无法访问远端仓库：仓库不存在或当前账号无权限。".to_string());
    }
    if lower.contains("authentication failed") || lower.contains("could not read username") {
        return github_full_name
            .map(|full_name| {
                format!("无法认证 GitHub 仓库 {full_name}，请重新绑定 GitHub 后再试。")
            })
            .unwrap_or_else(|| "远端认证失败，请检查凭证或远端 URL。".to_string());
    }
    error
}

pub(super) fn should_retry_clone_with_system_git(remote: &str, error: &str) -> bool {
    parse_github_remote(remote).is_some()
        && (error.contains("当前 GitHub 绑定无权限") || error.contains("无法认证 GitHub 仓库"))
}

pub(super) fn origin_remote_url(path: &Path) -> Option<String> {
    git_command_lossy(path, &["remote", "get-url", "origin"]).filter(|value| !value.is_empty())
}

pub(super) fn map_remote_git_error(path: &Path, error: String) -> String {
    origin_remote_url(path)
        .map(|remote| normalize_git_remote_error(&remote, error.clone()))
        .unwrap_or(error)
}

pub(super) fn repo_uses_system_git(app: &AppHandle, path: &Path) -> bool {
    let Ok(root) = workspace_root(app) else {
        return false;
    };
    let id = repo_id(&root, path);
    load_settings(app)
        .system_git_repo_ids
        .iter()
        .any(|value| value == &id)
}

pub(super) fn remember_repo_uses_system_git(app: &AppHandle, path: &Path) -> Result<(), String> {
    let root = workspace_root(app)?;
    let id = repo_id(&root, path);
    let mut settings = load_settings(app);
    if !settings
        .system_git_repo_ids
        .iter()
        .any(|value| value == &id)
    {
        settings.system_git_repo_ids.push(id);
        sort_dedup(&mut settings.system_git_repo_ids);
        save_settings(app, &settings)?;
    }
    Ok(())
}

pub(super) fn git_auth_for_repo(app: &AppHandle, path: &Path) -> Result<Option<String>, String> {
    if repo_uses_system_git(app, path) {
        Ok(None)
    } else {
        token_for_binding(app).map(|token| token.map(|value| github_auth_header(&value)))
    }
}

pub(super) fn validate_clone_directory_name(name: &str) -> Result<(), String> {
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

pub(super) fn github_full_name_from_remote(remote: &str) -> Option<String> {
    parse_github_remote(remote)
}

pub(super) fn repo_head_language_stats(path: &Path) -> Vec<LanguageStat> {
    let output =
        git_command(path, &["ls-tree", "-r", "-z", "-l", "HEAD"], None).unwrap_or_default();
    let mut blobs: Vec<(String, u64)> = Vec::new();
    let mut object_ids = Vec::new();
    for entry in output.split('\0').filter(|value| !value.is_empty()) {
        let Some((metadata, raw_path)) = entry.split_once('\t') else {
            continue;
        };
        let mut metadata_parts = metadata.split_whitespace();
        let object_id = metadata_parts.nth(2).unwrap_or("").to_string();
        let Some(bytes) = metadata
            .split_whitespace()
            .last()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|bytes| *bytes > 0)
        else {
            continue;
        };
        if object_id.is_empty() {
            continue;
        }
        let relative = Path::new(raw_path);
        if should_skip_language_path(relative) {
            continue;
        }
        let Some(language) = language_for_path(relative) else {
            continue;
        };
        object_ids.push(object_id.clone());
        blobs.push((language.to_string(), bytes));
    }
    let line_counts = git_blob_line_counts(path, &object_ids).unwrap_or_default();
    let mut stats: HashMap<String, LanguageStatAccumulator> = HashMap::new();
    for (index, (language, bytes)) in blobs.into_iter().enumerate() {
        record_language_stats(
            &mut stats,
            &language,
            bytes,
            line_counts.get(index).copied().unwrap_or(0),
        );
    }
    language_stats_from_map(stats)
}

fn record_language_stats(
    stats: &mut HashMap<String, LanguageStatAccumulator>,
    language: &str,
    bytes: u64,
    lines: u64,
) {
    let stat = stats.entry(language.to_string()).or_default();
    stat.bytes += bytes;
    stat.lines += lines;
}

fn language_stats_from_map(stats: HashMap<String, LanguageStatAccumulator>) -> Vec<LanguageStat> {
    let mut items = stats
        .into_iter()
        .map(|(language, stat)| LanguageStat {
            language,
            bytes: stat.bytes,
            lines: stat.lines,
        })
        .collect::<Vec<_>>();
    items.sort_by(|a, b| {
        b.bytes
            .cmp(&a.bytes)
            .then_with(|| a.language.cmp(&b.language))
    });
    items
}

fn count_lines(bytes: &[u8]) -> u64 {
    if bytes.is_empty() {
        return 0;
    }
    let newline_count = bytes.iter().filter(|byte| **byte == b'\n').count() as u64;
    if bytes.last() == Some(&b'\n') {
        newline_count
    } else {
        newline_count + 1
    }
}

pub(super) fn should_skip_language_path(path: &Path) -> bool {
    if path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .map(|name| is_skipped_language_dir(&name.to_ascii_lowercase()))
            .unwrap_or(false)
    }) {
        return true;
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    is_skipped_language_file(&name)
}

pub(super) fn is_skipped_language_dir(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".cache"
            | ".next"
            | ".nuxt"
            | ".parcel-cache"
            | ".svelte-kit"
            | ".tauri"
            | ".yarn"
            | "build"
            | "coverage"
            | "dist"
            | "node_modules"
            | "out"
            | "target"
            | "vendor"
    )
}

pub(super) fn is_skipped_language_file(name: &str) -> bool {
    matches!(
        name,
        "bun.lock" | "cargo.lock" | "package-lock.json" | "pnpm-lock.yaml" | "yarn.lock"
    ) || name.ends_with(".lock")
        || matches!(
            Path::new(name)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or(""),
            "7z" | "avif"
                | "bmp"
                | "dll"
                | "dylib"
                | "exe"
                | "gif"
                | "ico"
                | "jar"
                | "jpeg"
                | "jpg"
                | "mp3"
                | "mp4"
                | "otf"
                | "pdf"
                | "png"
                | "so"
                | "ttf"
                | "webp"
                | "woff"
                | "woff2"
                | "zip"
        )
}

pub(super) fn language_for_path(path: &Path) -> Option<&'static str> {
    let file_name = path.file_name()?.to_str()?.to_ascii_lowercase();
    match file_name.as_str() {
        "dockerfile" => return Some("Dockerfile"),
        "makefile" => return Some("Makefile"),
        _ => {}
    }
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "c" => Some("C"),
        "cc" | "cpp" | "cxx" | "h" | "hpp" | "hxx" => Some("C++"),
        "cs" => Some("C#"),
        "css" | "scss" | "sass" | "less" => Some("CSS"),
        "go" => Some("Go"),
        "html" | "htm" => Some("HTML"),
        "java" => Some("Java"),
        "js" | "cjs" | "mjs" | "jsx" => Some("JavaScript"),
        "json" | "jsonc" => Some("JSON"),
        "kt" | "kts" => Some("Kotlin"),
        "md" | "mdx" => Some("Markdown"),
        "ps1" | "psm1" | "psd1" => Some("PowerShell"),
        "py" | "pyw" => Some("Python"),
        "rs" => Some("Rust"),
        "sh" | "bash" | "zsh" | "fish" => Some("Shell"),
        "swift" => Some("Swift"),
        "toml" => Some("TOML"),
        "ts" | "tsx" | "mts" | "cts" => Some("TypeScript"),
        "vue" => Some("Vue"),
        "yaml" | "yml" => Some("YAML"),
        _ => None,
    }
}

pub(super) fn summarize_repo(root: &Path, path: &Path) -> RepoSummary {
    let status = git_command_lossy(path, &["status", "--porcelain=v1", "-b", "--ahead-behind"])
        .unwrap_or_default();
    let entries = repo_status_entries(path);
    let worktree = resolve_repo_worktree(root, path).summary;
    let mut current_branch = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut staged_count = 0;
    let mut unstaged_count = 0;
    let mut untracked_count = 0;
    let mut conflict_count = 0;

    for line in status.lines() {
        if let Some(header) = line.strip_prefix("## ") {
            let branch_part = header.split("...").next().unwrap_or(header).trim();
            if branch_part != "HEAD (no branch)" {
                current_branch = Some(branch_part.to_string());
            }
            if let Some(start) = header.find("[") {
                if let Some(end) = header[start..].find("]") {
                    let counts = &header[start + 1..start + end];
                    for part in counts.split(',') {
                        let trimmed = part.trim();
                        if let Some(value) = trimmed.strip_prefix("ahead ") {
                            ahead = value.parse::<i32>().unwrap_or(0);
                        } else if let Some(value) = trimmed.strip_prefix("behind ") {
                            behind = value.parse::<i32>().unwrap_or(0);
                        }
                    }
                }
            }
            continue;
        }
    }

    for entry in entries {
        if is_conflict_status(&entry.index, &entry.worktree) {
            conflict_count += 1;
        } else if entry.index == "?" && entry.worktree == "?" {
            untracked_count += 1;
        } else {
            if entry.index != " " {
                staged_count += 1;
            }
            if entry.worktree != " " {
                unstaged_count += 1;
            }
        }
    }

    let remote_url = git_command_lossy(path, &["remote", "get-url", "origin"]);
    let last_commit_at = git_command_lossy(path, &["log", "-1", "--format=%ct"])
        .and_then(|value| value.parse::<i64>().ok());
    let last_commit_message =
        git_command_lossy(path, &["log", "-1", "--format=%s"]).filter(|value| !value.is_empty());
    let relative_path = repo_id(root, path);

    RepoSummary {
        id: relative_path.clone(),
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("repo")
            .to_string(),
        path: path.to_string_lossy().to_string(),
        relative_path,
        current_branch,
        github_full_name: remote_url.as_deref().and_then(github_full_name_from_remote),
        remote_url,
        ahead,
        behind,
        staged_count,
        unstaged_count,
        untracked_count,
        conflict_count,
        last_commit_at,
        last_commit_message,
        language_stats: Vec::new(),
        language_stats_updated_at: 0,
        worktree,
    }
}

pub(super) fn lightweight_repo_summary(root: &Path, path: &Path) -> RepoSummary {
    let relative_path = repo_id(root, path);
    let worktree = resolve_repo_worktree(root, path).summary;
    RepoSummary {
        id: relative_path.clone(),
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("repo")
            .to_string(),
        path: path.to_string_lossy().to_string(),
        relative_path,
        current_branch: None,
        remote_url: None,
        github_full_name: None,
        ahead: 0,
        behind: 0,
        staged_count: 0,
        unstaged_count: 0,
        untracked_count: 0,
        conflict_count: 0,
        last_commit_at: None,
        last_commit_message: None,
        language_stats: Vec::new(),
        language_stats_updated_at: 0,
        worktree,
    }
}

pub(super) fn summarize_repo_with_language_stats(root: &Path, path: &Path) -> RepoSummary {
    let mut summary = summarize_repo(root, path);
    summary.language_stats = repo_head_language_stats(path);
    summary.language_stats_updated_at = now_millis();
    summary
}

pub(super) fn status_pair(line: &str) -> (String, String) {
    let mut chars = line.chars();
    let first = chars.next().unwrap_or(' ');
    let second = chars.next().unwrap_or(' ');
    (first.to_string(), second.to_string())
}

pub(super) fn repo_status_entries(path: &Path) -> Vec<RepoStatusEntry> {
    let status = git_command(
        path,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        None,
    )
    .unwrap_or_default();
    parse_status_entries(&status)
}

pub(super) fn parse_status_entries(status: &str) -> Vec<RepoStatusEntry> {
    let mut entries = Vec::new();
    let mut records = status.split('\0').filter(|record| !record.is_empty());
    while let Some(record) = records.next() {
        if record.len() < 3 {
            continue;
        }
        let (index, worktree) = status_pair(record);
        let path = record.get(3..).unwrap_or("").to_string();
        let old_path = if matches!(index.as_str(), "R" | "C") {
            records
                .next()
                .map(str::to_string)
                .filter(|value| !value.is_empty())
        } else {
            None
        };
        entries.push(RepoStatusEntry {
            index,
            worktree,
            path,
            old_path,
        });
    }
    entries
}

pub(super) fn is_conflict_status(index: &str, worktree: &str) -> bool {
    matches!(
        (index, worktree),
        ("A", "A") | ("D", "D") | ("U", "U") | ("A", "U") | ("U", "A") | ("D", "U") | ("U", "D")
    )
}

pub(super) fn collect_repos(root: &Path) -> Vec<PathBuf> {
    fn visit(path: &Path, repos: &mut Vec<PathBuf>) {
        if should_skip_dir(path) {
            return;
        }
        if is_git_repo(path) {
            repos.push(path.to_path_buf());
            return;
        }
        let Ok(entries) = fs::read_dir(path) else {
            return;
        };
        for entry in entries.flatten() {
            let child = entry.path();
            if child.is_dir() {
                visit(&child, repos);
            }
        }
    }

    let mut repos = Vec::new();
    visit(root, &mut repos);
    repos
}

pub(super) fn summarize_repos(root: &Path, paths: Vec<PathBuf>) -> Vec<RepoSummary> {
    thread::scope(|scope| {
        let handles: Vec<_> = paths
            .into_iter()
            .map(|path| scope.spawn(move || summarize_repo(root, &path)))
            .collect();
        handles
            .into_iter()
            .map(|handle| handle.join().expect("repo summary worker panicked"))
            .collect()
    })
}

#[cfg(test)]
pub(super) fn lightweight_managed_repos(
    root: &Path,
    settings: &WorkspaceSettings,
) -> Vec<RepoSummary> {
    let mut repos: Vec<_> = managed_repo_paths(root, settings)
        .into_iter()
        .map(|path| lightweight_repo_summary(root, &path))
        .collect();
    sort_repos(&mut repos);
    repos
}

pub(super) fn cached_managed_repos(
    root: &Path,
    settings: &WorkspaceSettings,
    cache: &WorkspaceStartupCache,
) -> Vec<RepoSummary> {
    let mut repos: Vec<_> = managed_repo_paths(root, settings)
        .into_iter()
        .map(|path| cached_repo_summary(cache, lightweight_repo_summary(root, &path)))
        .collect();
    sort_repos(&mut repos);
    repos
}

pub(super) fn repo_refresh_success_message(repo_count: usize) -> String {
    format!("已刷新 {repo_count} 个仓库并同步远端状态")
}

pub(super) fn repo_refresh_partial_failure_message(
    repo_count: usize,
    failures: &[RepoFetchFailure],
) -> String {
    let repo_names = failures
        .iter()
        .take(3)
        .map(|failure| failure.repo_name.as_str())
        .collect::<Vec<_>>()
        .join("、");
    let repo_label = if failures.len() > 3 {
        format!("{repo_names} 等")
    } else {
        repo_names
    };
    format!(
        "已刷新 {repo_count} 个仓库，{} 个仓库 fetch 失败：{}（{}）",
        failures.len(),
        repo_label,
        failures[0].error
    )
}

pub(super) fn refresh_managed_repo_remotes(
    paths: &[PathBuf],
    fetch_repo: impl Fn(&Path) -> Result<(), String> + Sync,
) -> Vec<RepoFetchFailure> {
    let remote_repos = paths
        .iter()
        .enumerate()
        .filter_map(|(index, path)| {
            git_command_lossy(path, &["remote", "get-url", "origin"])?;
            Some((
                index,
                path.clone(),
                path.file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("repo")
                    .to_string(),
            ))
        })
        .collect::<Vec<_>>();
    if remote_repos.is_empty() {
        return Vec::new();
    }

    let next_index = AtomicUsize::new(0);
    let failures = Mutex::new(Vec::<(usize, RepoFetchFailure)>::new());
    let worker_count = repo_refresh_worker_count(remote_repos.len());
    thread::scope(|scope| {
        for _ in 0..worker_count {
            let remote_repos = &remote_repos;
            let next_index = &next_index;
            let failures = &failures;
            let fetch_repo = &fetch_repo;
            scope.spawn(move || loop {
                let item_index = next_index.fetch_add(1, Ordering::Relaxed);
                let Some((repo_index, path, repo_name)) = remote_repos.get(item_index) else {
                    break;
                };
                if let Err(error) = fetch_repo(path) {
                    failures.lock().unwrap().push((
                        *repo_index,
                        RepoFetchFailure {
                            repo_name: repo_name.clone(),
                            error,
                        },
                    ));
                }
            });
        }
    });

    let mut failures = failures.into_inner().unwrap();
    failures.sort_by_key(|(index, _)| *index);
    failures.into_iter().map(|(_, failure)| failure).collect()
}

pub(super) fn repo_refresh_worker_count(repo_count: usize) -> usize {
    let available = thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(1);
    repo_count.min(available.clamp(1, MAX_REPO_REFRESH_CONCURRENCY))
}

pub(super) fn managed_repo_paths(root: &Path, settings: &WorkspaceSettings) -> Vec<PathBuf> {
    settings
        .managed_repo_ids
        .iter()
        .filter(|id| !settings.hidden_repo_ids.iter().any(|hidden| hidden == *id))
        .map(|id| root.join(id.replace('/', std::path::MAIN_SEPARATOR_STR)))
        .filter(|path| path.exists() && is_git_repo(path))
        .collect()
}

pub(super) fn sort_repos(repos: &mut [RepoSummary]) {
    repos.sort_by(|a, b| {
        b.last_commit_at
            .cmp(&a.last_commit_at)
            .then_with(|| a.name.cmp(&b.name))
    });
}

pub(super) fn filter_hidden_repos(
    repos: Vec<RepoSummary>,
    hidden_repo_ids: &[String],
) -> Vec<RepoSummary> {
    if hidden_repo_ids.is_empty() {
        return repos;
    }
    let hidden: HashSet<&str> = hidden_repo_ids.iter().map(String::as_str).collect();
    repos
        .into_iter()
        .filter(|repo| !hidden.contains(repo.id.as_str()))
        .collect()
}

#[tauri::command]
pub async fn workspace_refresh_repos(app: AppHandle) -> Result<Vec<RepoSummary>, String> {
    run_blocking("刷新仓库", move || {
        let root = workspace_root(&app)?;
        let settings = load_settings(&app);
        let task = record_workspace_task(
            "repoStatus",
            "high",
            None,
            "running",
            Some("刷新已管理仓库并同步远端状态".to_string()),
        );
        let paths = managed_repo_paths(&root, &settings);
        let failures = refresh_managed_repo_remotes(&paths, |path| run_fetch(&app, path));
        let mut repos = summarize_repos(&root, paths);
        sort_repos(&mut repos);
        for summary in &repos {
            let _ = write_startup_repo_summary(&app, &settings, summary);
        }
        if failures.is_empty() {
            update_workspace_task(
                &task.id,
                "success",
                Some(repo_refresh_success_message(repos.len())),
            );
        } else {
            update_workspace_task(
                &task.id,
                "error",
                Some(repo_refresh_partial_failure_message(repos.len(), &failures)),
            );
        }
        Ok(repos)
    })
    .await
}

#[tauri::command]
pub async fn workspace_list_managed_repos(app: AppHandle) -> Result<Vec<RepoSummary>, String> {
    run_blocking("读取已管理仓库", move || {
        let root = workspace_root(&app)?;
        let settings = load_settings(&app);
        let cache = matching_startup_cache(&app, &settings);
        Ok(cached_managed_repos(&root, &settings, &cache))
    })
    .await
}

#[tauri::command]
pub async fn workspace_scan_repos(app: AppHandle) -> Result<Vec<RepoSummary>, String> {
    workspace_refresh_repos(app).await
}

#[tauri::command]
pub async fn workspace_discover_repos(app: AppHandle) -> Result<Vec<RepoSummary>, String> {
    run_blocking("发现仓库", move || {
        let root = workspace_root(&app)?;
        let task = record_workspace_task(
            "discoverRepos",
            "low",
            None,
            "running",
            Some("后台发现工作区仓库".to_string()),
        );
        let paths = collect_repos(&root);
        let mut settings = load_settings(&app);
        for path in &paths {
            add_managed_repo_id(&mut settings, repo_id(&root, path));
        }
        save_settings(&app, &settings)?;
        let mut repos =
            filter_hidden_repos(summarize_repos(&root, paths), &settings.hidden_repo_ids);
        sort_repos(&mut repos);
        update_workspace_task(
            &task.id,
            "success",
            Some(format!("发现 {} 个仓库", repos.len())),
        );
        Ok(repos)
    })
    .await
}

#[tauri::command]
pub async fn workspace_add_repo(app: AppHandle, repo_path: String) -> Result<RepoSummary, String> {
    run_blocking("添加仓库", move || {
        let root = workspace_root(&app)?;
        let path = normalize_repo_path(&root, &repo_path)?;
        let repo_id = repo_id(&root, &path);
        let task = record_workspace_task(
            "repoStatus",
            "high",
            Some(repo_id.clone()),
            "running",
            Some("添加本地仓库".to_string()),
        );
        let mut settings = load_settings(&app);
        add_managed_repo_id(&mut settings, repo_id.clone());
        settings.hidden_repo_ids.retain(|id| id != &repo_id);
        save_settings(&app, &settings)?;
        let summary = summarize_repo(&root, &path);
        let _ = write_startup_repo_summary(&app, &settings, &summary);
        update_workspace_task(&task.id, "success", Some("已添加仓库".to_string()));
        Ok(summary)
    })
    .await
}

fn normalize_local_repo_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn local_gitignore_template_content(template: &str) -> String {
    match template.trim().to_ascii_lowercase().as_str() {
        "node" | "nodejs" => "node_modules/\ndist/\n.env\n".to_string(),
        "rust" => "target/\nCargo.lock\n".to_string(),
        "tauri" => "node_modules/\ndist/\nsrc-tauri/target/\n.env\n".to_string(),
        value => format!("# {value}\n"),
    }
}

fn local_license_template_content(template: &str, repo_name: &str) -> String {
    match template.trim().to_ascii_lowercase().as_str() {
        "mit" => format!("MIT License\n\nCopyright (c) {repo_name}\n"),
        "apache-2.0" | "apache" => "Apache License\nVersion 2.0\n".to_string(),
        value => format!("{value}\n"),
    }
}

#[tauri::command]
pub async fn workspace_create_local_repo(
    app: AppHandle,
    request: WorkspaceCreateLocalRepoRequest,
) -> Result<RepoSummary, String> {
    run_blocking("创建本地仓库", move || {
        let root = workspace_root(&app)?;
        let name = request.name.trim().to_string();
        validate_clone_directory_name(&name)?;
        let target = root.join(&name);
        if target.exists() {
            return Err(format!("目标目录已存在：{}", target.display()));
        }
        if target.parent() != Some(root.as_path()) {
            return Err("目标目录必须位于工作区内".to_string());
        }

        let task = record_workspace_task(
            "repoStatus",
            "high",
            Some(name.clone()),
            "running",
            Some("创建本地仓库".to_string()),
        );
        fs::create_dir(&target).map_err(|e| format!("创建仓库目录失败：{e}"))?;
        if request.add_readme {
            let description = normalize_local_repo_optional_string(request.description);
            let body = description
                .as_ref()
                .map(|value| format!("# {name}\n\n{value}\n"))
                .unwrap_or_else(|| format!("# {name}\n"));
            fs::write(target.join("README.md"), body)
                .map_err(|e| format!("写入 README 失败：{e}"))?;
        }
        if let Some(template) = normalize_local_repo_optional_string(request.gitignore_template) {
            fs::write(target.join(".gitignore"), local_gitignore_template_content(&template))
                .map_err(|e| format!("写入 .gitignore 失败：{e}"))?;
        }
        if let Some(template) = normalize_local_repo_optional_string(request.license_template) {
            fs::write(
                target.join("LICENSE"),
                local_license_template_content(&template, &name),
            )
            .map_err(|e| format!("写入 LICENSE 失败：{e}"))?;
        }
        git_command(&target, &["init"], None)?;

        let repo_id = repo_id(&root, &target);
        let mut settings = load_settings(&app);
        add_managed_repo_id(&mut settings, repo_id.clone());
        settings.hidden_repo_ids.retain(|id| id != &repo_id);
        save_settings(&app, &settings)?;
        let summary = summarize_repo(&root, &target);
        let _ = write_startup_repo_summary(&app, &settings, &summary);
        update_workspace_task(&task.id, "success", Some("已创建本地仓库".to_string()));
        Ok(summary)
    })
    .await
}

#[tauri::command]
pub async fn workspace_clone_repo(
    app: AppHandle,
    remote_url: String,
    directory_name: Option<String>,
) -> Result<RepoSummary, String> {
    run_blocking("克隆仓库", move || {
        let root = workspace_root(&app)?;
        let input = remote_url.trim();
        if input.is_empty() {
            return Err("远端 URL 不能为空".to_string());
        }
        let normalized_github = normalize_github_repo_input(input).ok();
        let remote = normalized_github
            .as_ref()
            .map(|repo| repo.clone_url.as_str())
            .unwrap_or(input);
        let directory = normalize_clone_directory_name(remote, directory_name)?;
        let target = root.join(&directory);
        if target.exists() {
            return Err(format!("目标目录已存在：{}", target.display()));
        }
        if target.parent() != Some(root.as_path()) {
            return Err("目标目录必须位于工作区内".to_string());
        }
        let auth_header = if normalized_github.is_some() || parse_github_remote(remote).is_some() {
            token_for_binding(&app)?.map(|token| github_auth_header(&token))
        } else {
            None
        };
        let run_clone = |auth: Option<&str>| {
            git_command(
                &root,
                &["clone", remote, directory.as_str()],
                auth,
            )
            .map_err(|error| normalize_git_remote_error(remote, error))
        };
        if let Err(error) = run_clone(auth_header.as_deref()) {
            if !should_retry_clone_with_system_git(remote, &error) {
                return Err(error);
            }
            run_clone(None)?;
            remember_repo_uses_system_git(&app, &target)?;
        }
        let mut settings = load_settings(&app);
        add_managed_repo_id(&mut settings, repo_id(&root, &target));
        save_settings(&app, &settings)?;
        let summary = summarize_repo(&root, &target);
        let _ = write_startup_repo_summary(&app, &settings, &summary);
        Ok(summary)
    })
    .await
}

#[tauri::command]
pub async fn repo_get_summary(app: AppHandle, repo_id: String) -> Result<RepoSummary, String> {
    run_blocking("读取仓库摘要", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        Ok(summarize_repo(&root, &path))
    })
    .await
}

#[tauri::command]
pub async fn repo_refresh_summary(
    app: AppHandle,
    repo_id: String,
    options: Option<RepoRefreshSummaryOptions>,
) -> Result<RepoSummary, String> {
    run_blocking("刷新仓库摘要", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let task = record_workspace_task(
            "repoStatus",
            "normal",
            Some(repo_id),
            "running",
            Some("刷新仓库状态".to_string()),
        );
        let fetch_error = if options.map(|value| value.fetch_remote).unwrap_or(false) {
            summarize_repo(&root, &path)
                .remote_url
                .as_ref()
                .and_then(|_| run_fetch(&app, &path).err())
        } else {
            None
        };
        let summary = summarize_repo(&root, &path);
        let settings = load_settings(&app);
        let _ = write_startup_repo_summary(&app, &settings, &summary);
        if let Some(error) = fetch_error {
            update_workspace_task(
                &task.id,
                "error",
                Some(format!("仓库状态已刷新，远端同步失败：{error}")),
            );
        } else {
            update_workspace_task(&task.id, "success", Some("仓库状态已更新".to_string()));
        }
        Ok(summary)
    })
    .await
}

#[tauri::command]
pub async fn repo_refresh_language_stats(
    app: AppHandle,
    repo_id: String,
) -> Result<RepoSummary, String> {
    run_blocking("刷新语言统计", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let task = record_workspace_task(
            "languageStats",
            "low",
            Some(repo_id),
            "running",
            Some("刷新语言统计".to_string()),
        );
        let summary = summarize_repo_with_language_stats(&root, &path);
        let settings = load_settings(&app);
        let _ = write_startup_repo_summary(&app, &settings, &summary);
        update_workspace_task(&task.id, "success", Some("语言统计已更新".to_string()));
        Ok(summary)
    })
    .await
}

#[tauri::command]
pub async fn repo_get_changes(app: AppHandle, repo_id: String) -> Result<Vec<RepoChange>, String> {
    run_blocking("读取仓库改动", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        Ok(repo_changes(&path))
    })
    .await
}

#[tauri::command]
pub async fn repo_get_history(
    app: AppHandle,
    repo_id: String,
) -> Result<Vec<CommitSummary>, String> {
    run_blocking("读取提交历史", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        Ok(repo_history(&path))
    })
    .await
}

#[tauri::command]
pub async fn repo_get_commit_detail(
    app: AppHandle,
    repo_id: String,
    hash: String,
) -> Result<CommitDetail, String> {
    run_blocking("读取提交详情", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        repo_commit_detail(&path, &hash)
    })
    .await
}

#[tauri::command]
pub async fn repo_get_branches(
    app: AppHandle,
    repo_id: String,
) -> Result<Vec<BranchSummary>, String> {
    run_blocking("读取仓库分支", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        Ok(repo_branches(&path))
    })
    .await
}

#[tauri::command]
pub async fn repo_get_conflicts(
    app: AppHandle,
    repo_id: String,
) -> Result<RepoConflictState, String> {
    run_blocking("读取冲突状态", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        Ok(repo_conflicts(&path))
    })
    .await
}

#[tauri::command]
pub async fn repo_get_detail(app: AppHandle, repo_id: String) -> Result<RepoDetail, String> {
    run_blocking("读取仓库详情", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let (summary, changes, commits, branches, conflicts) = thread::scope(|scope| {
            let summary = scope.spawn(|| summarize_repo_with_language_stats(&root, &path));
            let changes = scope.spawn(|| repo_changes(&path));
            let commits = scope.spawn(|| repo_history(&path));
            let branches = scope.spawn(|| repo_branches(&path));
            let conflicts = scope.spawn(|| repo_conflicts(&path));
            (
                summary.join().expect("repo summary worker panicked"),
                changes.join().expect("repo changes worker panicked"),
                commits.join().expect("repo history worker panicked"),
                branches.join().expect("repo branches worker panicked"),
                conflicts.join().expect("repo conflicts worker panicked"),
            )
        });
        Ok(RepoDetail {
            summary,
            changes,
            commits,
            branches,
            conflicts,
        })
    })
    .await
}

#[tauri::command]
pub async fn repo_stage_files(
    app: AppHandle,
    repo_id: String,
    files: Vec<String>,
) -> Result<(), String> {
    run_blocking("暂存文件", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        for file in selected_repo_files(&path, files)? {
            git_command(&path, &["add", "--", &file], None)?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn repo_unstage_files(
    app: AppHandle,
    repo_id: String,
    files: Vec<String>,
) -> Result<(), String> {
    run_blocking("取消暂存文件", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        for file in selected_repo_files(&path, files)? {
            git_command(&path, &["restore", "--staged", "--", &file], None)?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn repo_discard_files(
    app: AppHandle,
    repo_id: String,
    files: Vec<String>,
) -> Result<RepoSummary, String> {
    run_blocking("放弃文件更改", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        discard_repo_files(&path, files)?;
        Ok(summarize_repo(&root, &path))
    })
    .await
}

#[tauri::command]
pub async fn repo_add_files_to_gitignore(
    app: AppHandle,
    repo_id: String,
    files: Vec<String>,
) -> Result<RepoSummary, String> {
    run_blocking("添加文件到 gitignore", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        add_repo_files_to_gitignore(&path, files)?;
        Ok(summarize_repo(&root, &path))
    })
    .await
}

#[tauri::command]
pub async fn repo_commit(
    app: AppHandle,
    repo_id: String,
    files: Vec<String>,
    message: String,
    push_after: bool,
) -> Result<RepoSummary, String> {
    run_blocking("提交仓库", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let trimmed = message.trim();
        if trimmed.is_empty() {
            return Err("提交说明不能为空".to_string());
        }
        let _selected = selected_repo_files(&path, files)?;
        git_command(&path, &["commit", "-m", trimmed], None)?;
        if push_after {
            run_push(&app, &path)?;
        }
        Ok(summarize_repo(&root, &path))
    })
    .await
}

#[tauri::command]
pub async fn repo_pull(
    app: AppHandle,
    repo_id: String,
    local_changes_mode: Option<RepoPullLocalChangesMode>,
) -> Result<RepoSummary, String> {
    run_blocking("拉取仓库", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let summary = summarize_repo(&root, &path);
        let local_changes =
            prepare_pull_local_changes(&path, &summary, local_changes_mode, "pull")?;
        if let Err(err) = run_pull(&app, &path) {
            return Err(restore_pull_local_changes_after_error(&path, local_changes, err));
        }
        if let Err(err) = restore_pull_local_changes(&path, local_changes) {
            let conflicts = repo_conflicts(&path);
            if conflicts.files.is_empty() {
                return Err(err);
            }
        }
        Ok(summarize_repo(&root, &path))
    })
    .await
}

#[tauri::command]
pub async fn repo_merge_pull(
    app: AppHandle,
    repo_id: String,
    local_changes_mode: Option<RepoPullLocalChangesMode>,
) -> Result<RepoMergePullResult, String> {
    run_blocking("合并拉取仓库", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let summary = summarize_repo(&root, &path);
        let mode = local_changes_mode.unwrap_or_default();
        if let Some(reason) = merge_pull_block_reason_with_mode(
            &summary,
            current_branch_upstream(&path).is_some(),
            mode,
        ) {
            return Err(reason);
        }
        let local_changes = prepare_pull_local_changes(&path, &summary, Some(mode), "合并拉取")?;

        if let Err(err) = run_fetch(&app, &path) {
            return Err(restore_pull_local_changes_after_error(&path, local_changes, err));
        }
        match git_command(&path, &["merge", "--no-edit", "@{u}"], None) {
            Ok(_) => {
                if let Some(result) = restore_pull_local_changes_for_merge_result(
                    &root,
                    &path,
                    local_changes,
                    "拉取完成，stash 还原产生冲突，请处理后提交",
                )? {
                    return Ok(result);
                }
                let summary = summarize_repo(&root, &path);
                Ok(RepoMergePullResult {
                    status: "success".to_string(),
                    message: "合并完成".to_string(),
                    conflicts: repo_conflicts(&path),
                    summary,
                })
            }
            Err(err) => {
                let conflicts = repo_conflicts(&path);
                let summary = summarize_repo(&root, &path);
                if conflicts.files.is_empty() {
                    Err(restore_pull_local_changes_after_error(&path, local_changes, err))
                } else {
                    Ok(RepoMergePullResult {
                        status: "conflicts".to_string(),
                        message: "合并产生冲突，请处理后提交".to_string(),
                        summary,
                        conflicts,
                    })
                }
            }
        }
    })
    .await
}

#[tauri::command]
pub async fn repo_fetch(app: AppHandle, repo_id: String) -> Result<RepoSummary, String> {
    run_blocking("抓取远端引用", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        run_fetch(&app, &path)?;
        Ok(summarize_repo(&root, &path))
    })
    .await
}

#[tauri::command]
pub async fn repo_start_rebase(
    app: AppHandle,
    repo_id: String,
    onto_ref: Option<String>,
    local_changes_mode: Option<RepoPullLocalChangesMode>,
) -> Result<RepoOperationResult, String> {
    run_blocking("执行 rebase", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        ensure_repo_has_no_conflicts(&root, &path, "rebase")?;
        let summary = summarize_repo(&root, &path);
        let local_changes =
            prepare_pull_local_changes(&path, &summary, local_changes_mode, "rebase")?;
        let target = normalize_rebase_target(&path, onto_ref)?;
        if target == "@{u}" || target.contains('/') {
            if let Err(err) = run_fetch(&app, &path) {
                return Err(restore_pull_local_changes_after_error(&path, local_changes, err));
            }
        }
        let result = run_repo_operation_with_conflicts(
            &root,
            &path,
            &["rebase", target.as_str()],
            None,
            "rebase 完成",
            "rebase 产生冲突，请处理后继续",
        )?;
        if result.status == "conflicts" {
            return Ok(result);
        }
        if let Some(result) = restore_pull_local_changes_for_operation_result(
            &root,
            &path,
            local_changes,
            "rebase 完成，stash 还原产生冲突，请处理后继续",
        )? {
            return Ok(result);
        }
        Ok(result)
    })
    .await
}

#[tauri::command]
pub async fn repo_push(app: AppHandle, repo_id: String) -> Result<RepoSummary, String> {
    run_blocking("推送仓库", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        run_push(&app, &path)?;
        Ok(summarize_repo(&root, &path))
    })
    .await
}

#[tauri::command]
pub async fn repo_push_new_branch(
    app: AppHandle,
    repo_id: String,
    remote_name: Option<String>,
    branch_name: Option<String>,
) -> Result<RepoSummary, String> {
    run_blocking("推送新分支", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let summary = summarize_repo(&root, &path);
        let branch = normalize_branch_ref(
            branch_name
                .as_deref()
                .or(summary.current_branch.as_deref())
                .unwrap_or(""),
            "分支名不能为空",
        )?;
        let remote = normalize_remote_name(remote_name.as_deref().unwrap_or("origin"))?;
        let auth = git_auth_for_repo(&app, &path)?;
        git_command(
            &path,
            &["push", "-u", remote.as_str(), branch.as_str()],
            auth.as_deref(),
        )
        .map_err(|error| map_remote_git_error(&path, error))?;
        Ok(summarize_repo(&root, &path))
    })
    .await
}

#[tauri::command]
pub async fn repo_push_with_system_git(
    app: AppHandle,
    repo_id: String,
) -> Result<RepoSummary, String> {
    run_blocking("使用系统 Git 推送仓库", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        run_system_git_push(&path)?;
        remember_repo_uses_system_git(&app, &path)?;
        Ok(summarize_repo(&root, &path))
    })
    .await
}

#[tauri::command]
pub async fn repo_checkout_branch(
    app: AppHandle,
    repo_id: String,
    branch: String,
) -> Result<RepoSummary, String> {
    run_blocking("切换分支", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        checkout_branch_at(&root, &path, &branch)
    })
    .await
}

#[tauri::command]
pub async fn repo_create_branch(
    app: AppHandle,
    repo_id: String,
    name: String,
    from_ref: String,
    checkout_after: bool,
) -> Result<RepoSummary, String> {
    run_blocking("创建分支", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        create_branch_at(&root, &path, &name, &from_ref, checkout_after)
    })
    .await
}

#[tauri::command]
pub async fn repo_rename_branch(
    app: AppHandle,
    repo_id: String,
    old_name: String,
    new_name: String,
) -> Result<RepoSummary, String> {
    run_blocking("重命名分支", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        rename_branch_at(&root, &path, &old_name, &new_name)
    })
    .await
}

#[tauri::command]
pub async fn repo_merge_branch(
    app: AppHandle,
    repo_id: String,
    branch: String,
) -> Result<RepoMergePullResult, String> {
    run_blocking("合并分支", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        merge_branch_at(&root, &path, &branch)
    })
    .await
}

#[tauri::command]
pub async fn repo_delete_branch(
    app: AppHandle,
    repo_id: String,
    branch: String,
) -> Result<RepoSummary, String> {
    run_blocking("删除分支", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        delete_branch_at(&root, &path, &branch)
    })
    .await
}

#[tauri::command]
pub async fn repo_set_upstream(
    app: AppHandle,
    repo_id: String,
    branch: String,
    upstream: String,
) -> Result<RepoSummary, String> {
    run_blocking("设置分支 upstream", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let branch = normalize_branch_ref(&branch, "分支名不能为空")?;
        let upstream = normalize_branch_ref(&upstream, "upstream 不能为空")?;
        git_command(
            &path,
            &["branch", "--set-upstream-to", upstream.as_str(), branch.as_str()],
            None,
        )?;
        Ok(summarize_repo(&root, &path))
    })
    .await
}

#[tauri::command]
pub async fn repo_list_stashes(
    app: AppHandle,
    repo_id: String,
) -> Result<Vec<RepoStashEntry>, String> {
    run_blocking("读取 stash 列表", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        repo_stashes(&path)
    })
    .await
}

#[tauri::command]
pub async fn repo_get_stash_detail(
    app: AppHandle,
    repo_id: String,
    stash_id: String,
) -> Result<RepoStashDetail, String> {
    run_blocking("读取 stash 详情", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        let stash = normalize_stash_id(&stash_id)?;
        let entry = repo_stashes(&path)?
            .into_iter()
            .find(|entry| entry.id == stash)
            .ok_or_else(|| "stash 不存在".to_string())?;
        Ok(RepoStashDetail {
            entry,
            files: repo_stash_file_changes(&path, &stash),
        })
    })
    .await
}

#[tauri::command]
pub async fn repo_stash_save(
    app: AppHandle,
    repo_id: String,
    message: Option<String>,
) -> Result<RepoSummary, String> {
    run_blocking("保存 stash", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let summary = summarize_repo(&root, &path);
        if repo_dirty_count(&summary) == 0 {
            return Err("当前没有可保存的改动".to_string());
        }
        let message = normalize_optional_string(message).unwrap_or_else(|| {
            summary
                .current_branch
                .as_deref()
                .map(|branch| format!("保存工作区：{branch}"))
                .unwrap_or_else(|| "保存工作区".to_string())
        });
        git_command(&path, &["stash", "push", "-u", "-m", message.as_str()], None)?;
        Ok(summarize_repo(&root, &path))
    })
    .await
}

#[tauri::command]
pub async fn repo_stash_apply(
    app: AppHandle,
    repo_id: String,
    stash_id: String,
) -> Result<RepoOperationResult, String> {
    run_blocking("应用 stash", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let stash = normalize_stash_id(&stash_id)?;
        run_repo_operation_with_conflicts(
            &root,
            &path,
            &["stash", "apply", stash.as_str()],
            None,
            "stash 已应用",
            "stash 应用产生冲突，请处理后继续",
        )
    })
    .await
}

#[tauri::command]
pub async fn repo_stash_pop(
    app: AppHandle,
    repo_id: String,
    stash_id: String,
) -> Result<RepoOperationResult, String> {
    run_blocking("弹出 stash", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let stash = normalize_stash_id(&stash_id)?;
        run_repo_operation_with_conflicts(
            &root,
            &path,
            &["stash", "pop", stash.as_str()],
            None,
            "stash 已弹出",
            "stash 弹出产生冲突，请处理后继续",
        )
    })
    .await
}

#[tauri::command]
pub async fn repo_stash_drop(
    app: AppHandle,
    repo_id: String,
    stash_id: String,
) -> Result<Vec<RepoStashEntry>, String> {
    run_blocking("删除 stash", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        let stash = normalize_stash_id(&stash_id)?;
        git_command(&path, &["stash", "drop", stash.as_str()], None)?;
        repo_stashes(&path)
    })
    .await
}

#[tauri::command]
pub async fn repo_list_remotes(
    app: AppHandle,
    repo_id: String,
) -> Result<Vec<RepoRemote>, String> {
    run_blocking("读取远端配置", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        repo_remotes(&path)
    })
    .await
}

#[tauri::command]
pub async fn repo_cherry_pick_commit(
    app: AppHandle,
    repo_id: String,
    hash: String,
) -> Result<RepoOperationResult, String> {
    run_blocking("执行 cherry-pick", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        ensure_repo_ready_for_rewrite(&root, &path, "cherry-pick")?;
        let hash = normalize_commit_hash(&hash)?;
        run_repo_operation_with_conflicts(
            &root,
            &path,
            &["cherry-pick", hash.as_str()],
            None,
            "cherry-pick 完成",
            "cherry-pick 产生冲突，请处理后继续",
        )
    })
    .await
}

#[tauri::command]
pub async fn repo_revert_commit(
    app: AppHandle,
    repo_id: String,
    hash: String,
) -> Result<RepoOperationResult, String> {
    run_blocking("回退提交", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        ensure_repo_ready_for_rewrite(&root, &path, "revert")?;
        let hash = normalize_commit_hash(&hash)?;
        run_repo_operation_with_conflicts(
            &root,
            &path,
            &["revert", "--no-edit", hash.as_str()],
            None,
            "revert 完成",
            "revert 产生冲突，请处理后继续",
        )
    })
    .await
}

#[tauri::command]
pub async fn repo_reset_to_commit(
    app: AppHandle,
    repo_id: String,
    hash: String,
    mode: Option<String>,
) -> Result<RepoSummary, String> {
    run_blocking("重置到提交", move || {
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, &repo_id)?;
        let summary = summarize_repo(&root, &path);
        if summary.conflict_count > 0 || !repo_conflicts(&path).files.is_empty() {
            return Err("当前仓库存在未处理冲突，已阻止 reset".to_string());
        }
        let hash = normalize_commit_hash(&hash)?;
        let mode = normalize_reset_mode(mode)?;
        git_command(&path, &["reset", mode.as_str(), hash.as_str()], None)?;
        Ok(summarize_repo(&root, &path))
    })
    .await
}

#[tauri::command]
pub async fn repo_accept_conflict_file(
    app: AppHandle,
    repo_id: String,
    path: String,
    side: String,
    stage: bool,
) -> Result<RepoSummary, String> {
    run_blocking("接受冲突文件", move || {
        let root = workspace_root(&app)?;
        let repo_path = repo_path_by_id(&app, &repo_id)?;
        let checkout_side = conflict_checkout_side(&side)?;
        git_command(&repo_path, &["checkout", checkout_side, "--", &path], None)?;
        if stage {
            git_command(&repo_path, &["add", "--", &path], None)?;
        }
        Ok(summarize_repo(&root, &repo_path))
    })
    .await
}

#[tauri::command]
pub async fn repo_resolve_conflict_file(
    app: AppHandle,
    repo_id: String,
    path: String,
    choices: Vec<RepoConflictChoice>,
    stage: bool,
) -> Result<RepoSummary, String> {
    run_blocking("解决冲突文件", move || {
        let root = workspace_root(&app)?;
        let repo_path = repo_path_by_id(&app, &repo_id)?;
        let file_path = safe_repo_file_path(&repo_path, &path)?;
        let content =
            fs::read_to_string(&file_path).map_err(|e| format!("读取冲突文件失败：{e}"))?;
        let resolved = resolve_conflict_content(&content, &choices)?;
        fs::write(&file_path, resolved).map_err(|e| format!("写入冲突文件失败：{e}"))?;
        if stage {
            git_command(&repo_path, &["add", "--", &path], None)?;
        }
        Ok(summarize_repo(&root, &repo_path))
    })
    .await
}

#[tauri::command]
pub async fn repo_mark_file_resolved(
    app: AppHandle,
    repo_id: String,
    path: String,
) -> Result<RepoSummary, String> {
    run_blocking("标记冲突文件已解决", move || {
        let root = workspace_root(&app)?;
        let repo_path = repo_path_by_id(&app, &repo_id)?;
        git_command(&repo_path, &["add", "--", &path], None)?;
        Ok(summarize_repo(&root, &repo_path))
    })
    .await
}

#[tauri::command]
pub async fn repo_abort_conflict_operation(
    app: AppHandle,
    repo_id: String,
) -> Result<RepoSummary, String> {
    run_blocking("终止冲突操作", move || {
        let root = workspace_root(&app)?;
        let repo_path = repo_path_by_id(&app, &repo_id)?;
        let operation = conflict_operation(&repo_path);
        let args = conflict_operation_args(&operation, "终止")?;
        git_command(&repo_path, args, None)?;
        Ok(summarize_repo(&root, &repo_path))
    })
    .await
}

#[tauri::command]
pub async fn repo_continue_conflict_operation(
    app: AppHandle,
    repo_id: String,
) -> Result<RepoSummary, String> {
    run_blocking("继续冲突操作", move || {
        let root = workspace_root(&app)?;
        let repo_path = repo_path_by_id(&app, &repo_id)?;
        let conflicts = repo_conflicts(&repo_path);
        if !conflicts.files.is_empty() {
            return Err("仍有冲突文件未解决".to_string());
        }
        let args = conflict_operation_args(&conflicts.operation, "继续")?;
        git_command(&repo_path, args, None)?;
        Ok(summarize_repo(&root, &repo_path))
    })
    .await
}

pub(super) fn repo_conflicts(path: &Path) -> RepoConflictState {
    let entries = conflict_status_entries(path);
    let files: Vec<_> = entries
        .into_iter()
        .map(|(status, file_path)| conflict_file_from_status(path, status, file_path))
        .collect();
    RepoConflictState {
        operation: conflict_operation(path),
        all_resolved: files.is_empty(),
        files,
    }
}

pub(super) fn build_repo_operation_result(
    root: &Path,
    path: &Path,
    status: &str,
    message: &str,
) -> RepoOperationResult {
    RepoOperationResult {
        status: status.to_string(),
        message: message.to_string(),
        summary: summarize_repo(root, path),
        conflicts: repo_conflicts(path),
    }
}

pub(super) fn run_repo_operation_with_conflicts(
    root: &Path,
    path: &Path,
    args: &[&str],
    auth_header: Option<&str>,
    success_message: &str,
    conflict_message: &str,
) -> Result<RepoOperationResult, String> {
    match git_command(path, args, auth_header) {
        Ok(_) => Ok(build_repo_operation_result(
            root,
            path,
            "success",
            success_message,
        )),
        Err(err) => {
            let conflicts = repo_conflicts(path);
            if conflicts.files.is_empty() {
                Err(err)
            } else {
                Ok(RepoOperationResult {
                    status: "conflicts".to_string(),
                    message: conflict_message.to_string(),
                    summary: summarize_repo(root, path),
                    conflicts,
                })
            }
        }
    }
}

#[derive(Debug, Clone)]
pub(super) struct PullLocalChanges {
    stash_ref: Option<String>,
}

pub(super) fn prepare_pull_local_changes(
    path: &Path,
    summary: &RepoSummary,
    mode: Option<RepoPullLocalChangesMode>,
    operation: &str,
) -> Result<PullLocalChanges, String> {
    let mode = mode.unwrap_or_default();
    if repo_dirty_count(summary) == 0 {
        return Ok(PullLocalChanges { stash_ref: None });
    }

    match mode {
        RepoPullLocalChangesMode::Reject => {
            Err(format!("存在未提交变更，已阻止 {operation}"))
        }
        RepoPullLocalChangesMode::Discard => {
            discard_all_repo_local_changes(path)?;
            Ok(PullLocalChanges { stash_ref: None })
        }
        RepoPullLocalChangesMode::Stash => {
            git_command(path, &["stash", "push", "-u", "-m", "拉取前保存本地修改"], None)?;
            Ok(PullLocalChanges {
                stash_ref: Some("stash@{0}".to_string()),
            })
        }
    }
}

pub(super) fn discard_all_repo_local_changes(path: &Path) -> Result<(), String> {
    git_command(path, &["reset", "--hard", "HEAD"], None)?;
    git_command(path, &["clean", "-fd"], None)?;
    Ok(())
}

pub(super) fn restore_pull_local_changes(
    path: &Path,
    local_changes: PullLocalChanges,
) -> Result<(), String> {
    let Some(stash_ref) = local_changes.stash_ref else {
        return Ok(());
    };
    git_command(path, &["stash", "pop", stash_ref.as_str()], None)
        .map(|_| ())
        .map_err(|err| format!("拉取完成，但还原本地修改失败：{err}"))
}

pub(super) fn restore_pull_local_changes_after_error(
    path: &Path,
    local_changes: PullLocalChanges,
    err: String,
) -> String {
    match restore_pull_local_changes(path, local_changes) {
        Ok(()) => err,
        Err(restore_err) => format!("{err}\n\n{restore_err}"),
    }
}

pub(super) fn restore_pull_local_changes_for_operation_result(
    root: &Path,
    path: &Path,
    local_changes: PullLocalChanges,
    conflict_message: &str,
) -> Result<Option<RepoOperationResult>, String> {
    match restore_pull_local_changes(path, local_changes) {
        Ok(()) => Ok(None),
        Err(err) => {
            let conflicts = repo_conflicts(path);
            if conflicts.files.is_empty() {
                Err(err)
            } else {
                Ok(Some(RepoOperationResult {
                    status: "conflicts".to_string(),
                    message: conflict_message.to_string(),
                    summary: summarize_repo(root, path),
                    conflicts,
                }))
            }
        }
    }
}

pub(super) fn restore_pull_local_changes_for_merge_result(
    root: &Path,
    path: &Path,
    local_changes: PullLocalChanges,
    conflict_message: &str,
) -> Result<Option<RepoMergePullResult>, String> {
    match restore_pull_local_changes(path, local_changes) {
        Ok(()) => Ok(None),
        Err(err) => {
            let conflicts = repo_conflicts(path);
            if conflicts.files.is_empty() {
                Err(err)
            } else {
                Ok(Some(RepoMergePullResult {
                    status: "conflicts".to_string(),
                    message: conflict_message.to_string(),
                    summary: summarize_repo(root, path),
                    conflicts,
                }))
            }
        }
    }
}

pub(super) fn conflict_status_entries(path: &Path) -> Vec<(String, String)> {
    repo_status_entries(path)
        .into_iter()
        .filter_map(|entry| {
            if !is_conflict_status(&entry.index, &entry.worktree) {
                return None;
            }
            Some((format!("{}{}", entry.index, entry.worktree), entry.path))
        })
        .collect()
}

pub(super) fn conflict_file_from_status(
    path: &Path,
    status: String,
    file_path: String,
) -> RepoConflictFile {
    let full_path = path.join(&file_path);
    match fs::read_to_string(&full_path) {
        Ok(content) => RepoConflictFile {
            path: file_path,
            status,
            resolved: false,
            binary: false,
            hunks: parse_conflict_hunks(&content),
        },
        Err(_) => RepoConflictFile {
            path: file_path,
            status,
            resolved: false,
            binary: true,
            hunks: Vec::new(),
        },
    }
}

pub(super) fn conflict_operation(path: &Path) -> String {
    if git_state_file_exists(path, "MERGE_HEAD") {
        "merge".to_string()
    } else if git_state_file_exists(path, "CHERRY_PICK_HEAD") {
        "cherry-pick".to_string()
    } else if git_state_file_exists(path, "REBASE_HEAD")
        || git_state_file_exists(path, "rebase-merge")
        || git_state_file_exists(path, "rebase-apply")
    {
        "rebase".to_string()
    } else {
        "none".to_string()
    }
}

pub(super) fn git_state_file_exists(path: &Path, name: &str) -> bool {
    git_command_lossy(path, &["rev-parse", "--git-path", name])
        .map(PathBuf::from)
        .map(|state_path| {
            if state_path.is_absolute() {
                state_path.exists()
            } else {
                path.join(state_path).exists()
            }
        })
        .unwrap_or(false)
}

pub(super) fn parse_conflict_hunks(content: &str) -> Vec<RepoConflictHunk> {
    let mut hunks = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut index = 0;
    while index < lines.len() {
        let line = lines[index];
        if !line.starts_with("<<<<<<<") {
            index += 1;
            continue;
        }

        let start_line = index + 1;
        let ours_label = conflict_marker_label(line, "<<<<<<<", "ours");
        index += 1;
        let mut ours_lines = Vec::new();
        while index < lines.len() && !lines[index].starts_with("=======") {
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
        let theirs_label = conflict_marker_label(lines[index], ">>>>>>>", "theirs");
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

pub(super) fn conflict_marker_label(line: &str, marker: &str, fallback: &str) -> String {
    let label = line.trim_start_matches(marker).trim();
    if label.is_empty() {
        fallback.to_string()
    } else {
        label.to_string()
    }
}

pub(super) fn resolve_conflict_content(
    content: &str,
    choices: &[RepoConflictChoice],
) -> Result<String, String> {
    let choice_map: HashMap<&str, &str> = choices
        .iter()
        .map(|choice| (choice.hunk_id.as_str(), choice.side.as_str()))
        .collect();
    let mut output = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut index = 0;
    let mut hunk_index = 1;
    while index < lines.len() {
        let line = lines[index];
        if !line.starts_with("<<<<<<<") {
            output.push(line.to_string());
            index += 1;
            continue;
        }

        let hunk_id = format!("hunk-{hunk_index}");
        hunk_index += 1;
        index += 1;
        let mut ours_lines = Vec::new();
        while index < lines.len() && !lines[index].starts_with("=======") {
            ours_lines.push(lines[index].to_string());
            index += 1;
        }
        if index >= lines.len() {
            return Err("冲突 marker 不完整".to_string());
        }
        index += 1;
        let mut theirs_lines = Vec::new();
        while index < lines.len() && !lines[index].starts_with(">>>>>>>") {
            theirs_lines.push(lines[index].to_string());
            index += 1;
        }
        if index >= lines.len() {
            return Err("冲突 marker 不完整".to_string());
        }
        index += 1;

        match choice_map.get(hunk_id.as_str()).copied() {
            Some("ours") => output.extend(ours_lines),
            Some("theirs") => output.extend(theirs_lines),
            Some(_) => return Err(format!("{hunk_id} 的选择无效")),
            None => return Err(format!("{hunk_id} 缺少解决选择")),
        }
    }

    let mut resolved = output.join("\n");
    if content.ends_with('\n') {
        resolved.push('\n');
    }
    Ok(resolved)
}

pub(super) fn conflict_checkout_side(side: &str) -> Result<&'static str, String> {
    match side {
        "ours" => Ok("--ours"),
        "theirs" => Ok("--theirs"),
        _ => Err("冲突侧只能是 ours 或 theirs".to_string()),
    }
}

pub(super) fn conflict_operation_args(
    operation: &str,
    action: &str,
) -> Result<&'static [&'static str], String> {
    match (operation, action) {
        ("merge", "终止") => Ok(&["merge", "--abort"]),
        ("rebase", "终止") => Ok(&["rebase", "--abort"]),
        ("cherry-pick", "终止") => Ok(&["cherry-pick", "--abort"]),
        ("merge", "继续") => Ok(&["commit", "--no-edit"]),
        ("rebase", "继续") => Ok(&["rebase", "--continue"]),
        ("cherry-pick", "继续") => Ok(&["cherry-pick", "--continue"]),
        ("none", _) => Err("当前没有进行中的冲突操作".to_string()),
        _ => Err(format!("不支持{action} {operation} 冲突")),
    }
}

pub(super) fn safe_repo_file_path(repo_path: &Path, file_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(file_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("文件路径必须位于仓库内".to_string());
    }
    Ok(repo_path.join(relative))
}

pub(super) fn selected_repo_files(path: &Path, files: Vec<String>) -> Result<Vec<String>, String> {
    let available: HashSet<_> = repo_status_entries(path)
        .into_iter()
        .map(|entry| entry.path)
        .collect();
    let mut seen = HashSet::new();
    let mut selected = Vec::new();
    for file in files {
        if file.is_empty() {
            continue;
        }
        safe_repo_file_path(path, &file)?;
        if !available.contains(&file) {
            return Err(format!("选择的文件不在当前变更中：{file}"));
        }
        if seen.insert(file.clone()) {
            selected.push(file);
        }
    }
    if selected.is_empty() {
        return Err("请选择要提交的文件".to_string());
    }
    Ok(selected)
}

pub(super) fn discard_repo_files(path: &Path, files: Vec<String>) -> Result<(), String> {
    for file in selected_repo_files(path, files)? {
        let entry = repo_status_entries(path)
            .into_iter()
            .find(|entry| entry.path == file)
            .ok_or_else(|| format!("选择的文件不在当前变更中：{file}"))?;
        if entry.index != " " && entry.index != "?" {
            return Err(format!("请先将文件移出暂存：{file}"));
        }
        if entry.index == "?" && entry.worktree == "?" {
            let file_path = safe_repo_file_path(path, &file)?;
            if file_path.is_dir() {
                fs::remove_dir_all(&file_path).map_err(|e| format!("删除未跟踪目录失败：{e}"))?;
            } else if file_path.exists() {
                fs::remove_file(&file_path).map_err(|e| format!("删除未跟踪文件失败：{e}"))?;
            }
        } else {
            git_command(path, &["restore", "--", &file], None)?;
        }
    }
    Ok(())
}

pub(super) fn add_repo_files_to_gitignore(path: &Path, files: Vec<String>) -> Result<(), String> {
    let entries = repo_status_entries(path);
    let mut selected = Vec::new();
    for file in selected_repo_files(path, files)? {
        let entry = entries
            .iter()
            .find(|entry| entry.path == file)
            .ok_or_else(|| format!("选择的文件不在当前变更中：{file}"))?;
        if entry.index != "?" || entry.worktree != "?" {
            return Err(format!("只能将未跟踪文件添加到 gitignore：{file}"));
        }
        selected.push(file);
    }

    let gitignore_path = path.join(".gitignore");
    let current = fs::read_to_string(&gitignore_path).unwrap_or_default();
    let mut lines: Vec<String> = current.lines().map(ToString::to_string).collect();
    let existing: HashSet<String> = lines
        .iter()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();
    let mut changed = false;
    for file in selected {
        let normalized = file.replace('\\', "/");
        if existing.contains(&normalized) {
            continue;
        }
        lines.push(normalized);
        changed = true;
    }
    if changed {
        let mut next = lines.join("\n");
        next.push('\n');
        fs::write(&gitignore_path, next).map_err(|e| format!("写入 .gitignore 失败：{e}"))?;
    }
    Ok(())
}

pub(super) fn repo_changes(path: &Path) -> Vec<RepoChange> {
    let entries = repo_status_entries(path);

    thread::scope(|scope| {
        let handles: Vec<_> = entries
            .into_iter()
            .map(|entry| {
                scope.spawn(move || {
                    let RepoStatusEntry {
                        index,
                        worktree,
                        path: file_path,
                        old_path,
                    } = entry;
                    let untracked = index == "?" && worktree == "?";
                    let conflicted = is_conflict_status(&index, &worktree);
                    let staged = !untracked && index != " ";
                    let unstaged = !untracked && worktree != " ";
                    let diff = if untracked {
                        git_diff_command_lossy(
                            path,
                            &["diff", "--no-index", "--", "/dev/null", &file_path],
                        )
                        .unwrap_or_default()
                    } else if staged {
                        git_command_lossy(path, &["diff", "--cached", "--", &file_path])
                            .unwrap_or_default()
                    } else {
                        git_command_lossy(path, &["diff", "--", &file_path]).unwrap_or_default()
                    };
                    RepoChange {
                        path: file_path,
                        old_path,
                        index_status: index,
                        worktree_status: worktree,
                        staged,
                        unstaged,
                        untracked,
                        conflicted,
                        diff,
                    }
                })
            })
            .collect();

        handles
            .into_iter()
            .map(|handle| handle.join().expect("repo diff worker panicked"))
            .collect()
    })
}

pub(super) fn repo_history(path: &Path) -> Vec<CommitSummary> {
    let output = git_command_lossy(
        path,
        &[
            "log",
            "--all",
            "--topo-order",
            "--max-count=160",
            "--decorate=short",
            "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%ct%x1f%P%x1f%D%x1f%s",
        ],
    )
    .unwrap_or_default();
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\x1f');
            let hash = parts.next()?.to_string();
            let short_hash = parts.next()?.to_string();
            let author = parts.next()?.to_string();
            let author_email = optional_text(parts.next().unwrap_or(""));
            let timestamp = parts.next()?.parse::<i64>().ok()?;
            let parents = split_words(parts.next().unwrap_or(""));
            let refs = split_refs(parts.next().unwrap_or(""));
            let subject = parts.next().unwrap_or("").to_string();
            Some(CommitSummary {
                hash,
                short_hash,
                author,
                author_email,
                timestamp,
                subject,
                parents,
                refs,
            })
        })
        .collect()
}

pub(super) fn repo_commit_detail(path: &Path, hash: &str) -> Result<CommitDetail, String> {
    let normalized = hash.trim();
    if normalized.is_empty() {
        return Err("提交 hash 不能为空".to_string());
    }
    let format = "%H%x1f%h%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%ct%x1f%P%x1f%D%x1f%s%x1f%b";
    let output = git_command(
        path,
        &[
            "show",
            "--no-patch",
            "--decorate=short",
            &format!("--format={format}"),
            normalized,
        ],
        None,
    )?;
    let mut parts = output.trim_end().splitn(11, '\x1f');
    let hash = parts.next().unwrap_or("").to_string();
    if hash.is_empty() {
        return Err("未找到提交".to_string());
    }
    let short_hash = parts.next().unwrap_or("").to_string();
    let author = parts.next().unwrap_or("").to_string();
    let author_email = optional_text(parts.next().unwrap_or(""));
    let committer = parts.next().unwrap_or("").to_string();
    let committer_email = optional_text(parts.next().unwrap_or(""));
    let timestamp = parts
        .next()
        .unwrap_or("")
        .parse::<i64>()
        .map_err(|_| "提交时间解析失败".to_string())?;
    let parents = split_words(parts.next().unwrap_or(""));
    let refs = split_refs(parts.next().unwrap_or(""));
    let subject = parts.next().unwrap_or("").to_string();
    let body = parts.next().unwrap_or("").trim().to_string();
    let files = repo_commit_file_changes(path, &hash, parents.first().map(String::as_str));
    Ok(CommitDetail {
        hash,
        short_hash,
        author,
        author_email,
        committer,
        committer_email,
        timestamp,
        subject,
        body,
        parents,
        refs,
        files,
    })
}

pub(super) fn repo_commit_file_changes(
    path: &Path,
    hash: &str,
    first_parent: Option<&str>,
) -> Vec<CommitFileChange> {
    let status_args = commit_diff_args("--name-status", hash, first_parent);
    let status_refs = status_args.iter().map(String::as_str).collect::<Vec<_>>();
    let status_output = git_command_lossy(path, &status_refs).unwrap_or_default();
    let numstat_args = commit_diff_args("--numstat", hash, first_parent);
    let numstat_refs = numstat_args.iter().map(String::as_str).collect::<Vec<_>>();
    let numstat_output = git_command_lossy(path, &numstat_refs).unwrap_or_default();
    let patch_args = commit_diff_args("--patch", hash, first_parent);
    let patch_refs = patch_args.iter().map(String::as_str).collect::<Vec<_>>();
    let patch_output = git_command_lossy(path, &patch_refs).unwrap_or_default();
    commit_file_changes_from_outputs(&status_output, &numstat_output, &patch_output)
}

pub(super) fn repo_stash_file_changes(path: &Path, stash: &str) -> Vec<CommitFileChange> {
    let status_output = git_command_lossy(
        path,
        &["stash", "show", "--name-status", "--find-renames", stash],
    )
    .unwrap_or_default();
    let numstat_output = git_command_lossy(
        path,
        &["stash", "show", "--numstat", "--find-renames", stash],
    )
    .unwrap_or_default();
    let patch_output = git_command_lossy(
        path,
        &["stash", "show", "--patch", "--find-renames", stash],
    )
    .unwrap_or_default();
    commit_file_changes_from_outputs(&status_output, &numstat_output, &patch_output)
}

pub(super) fn commit_file_changes_from_outputs(
    status_output: &str,
    numstat_output: &str,
    patch_output: &str,
) -> Vec<CommitFileChange> {
    let statuses = commit_file_statuses(status_output);
    let stats = commit_file_numstats(numstat_output);
    let mut files = statuses
        .into_iter()
        .map(|status| commit_file_change_from_status(status, &stats))
        .collect::<Vec<_>>();
    let patches = commit_file_patches(patch_output);
    for file in &mut files {
        if let Some(parsed) = patches.get(&file.path) {
            file.patch = parsed.patch.clone();
            file.hunks = parsed.hunks.clone();
        }
    }
    files
}

pub(super) fn commit_diff_args(
    format_arg: &str,
    hash: &str,
    first_parent: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "diff-tree".to_string(),
        "--no-commit-id".to_string(),
        format_arg.to_string(),
        "--find-renames".to_string(),
        "-r".to_string(),
    ];
    if let Some(parent) = first_parent {
        args.push(parent.to_string());
    } else {
        args.push("--root".to_string());
    }
    args.push(hash.to_string());
    args
}

#[derive(Debug, Clone)]
pub(super) struct CommitFileStatus {
    pub(super) path: String,
    pub(super) old_path: Option<String>,
    pub(super) status: String,
}

pub(super) fn commit_file_statuses(output: &str) -> Vec<CommitFileStatus> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let status_code = parts.next()?.trim();
            let first_path = parts.next()?.trim();
            let second_path = parts
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let path = second_path.unwrap_or(first_path).to_string();
            if path.is_empty() {
                return None;
            }
            Some(CommitFileStatus {
                path,
                old_path: second_path.map(|_| first_path.to_string()),
                status: status_text(status_code).to_string(),
            })
        })
        .collect()
}

pub(super) fn status_text(status_code: &str) -> &str {
    match status_code.chars().next().unwrap_or('M') {
        'A' => "added",
        'D' => "deleted",
        'R' => "renamed",
        'C' => "copied",
        _ => "modified",
    }
}

pub(super) fn commit_file_change_from_status(
    status: CommitFileStatus,
    stats: &HashMap<String, (i32, i32)>,
) -> CommitFileChange {
    let (additions, deletions) = stats.get(&status.path).copied().unwrap_or((0, 0));
    CommitFileChange {
        path: status.path,
        old_path: status.old_path,
        status: status.status,
        additions,
        deletions,
        patch: String::new(),
        hunks: Vec::new(),
    }
}

pub(super) fn commit_file_numstats(output: &str) -> HashMap<String, (i32, i32)> {
    output
        .lines()
        .filter_map(parse_commit_file_numstat)
        .map(|(path, additions, deletions)| (path, (additions, deletions)))
        .collect()
}

pub(super) fn parse_commit_file_numstat(line: &str) -> Option<(String, i32, i32)> {
    let mut parts = line.split('\t');
    let additions = parse_numstat_count(parts.next().unwrap_or(""));
    let deletions = parse_numstat_count(parts.next().unwrap_or(""));
    let path = parts.next()?.trim();
    if path.is_empty() {
        return None;
    }
    let extra = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let next_path = if let Some(next) = extra {
        next.to_string()
    } else {
        normalize_numstat_path(path)
    };
    Some((next_path, additions, deletions))
}

pub(super) fn normalize_numstat_path(path: &str) -> String {
    let Some(arrow_index) = path.find(" => ") else {
        return path.to_string();
    };
    let before_arrow = &path[..arrow_index];
    let after_arrow = &path[arrow_index + 4..];
    if let Some(open_index) = before_arrow.rfind('{') {
        if let Some(close_index) = after_arrow.find('}') {
            let prefix = &before_arrow[..open_index];
            let changed = &after_arrow[..close_index];
            let suffix = &after_arrow[close_index + 1..];
            return format!("{prefix}{changed}{suffix}");
        }
    }
    after_arrow.replace('}', "")
}

pub(super) fn parse_numstat_count(value: &str) -> i32 {
    value.parse::<i32>().unwrap_or(0)
}

#[derive(Debug, Clone)]
pub(super) struct ParsedCommitPatch {
    pub(super) path: String,
    pub(super) patch: String,
    pub(super) hunks: Vec<CommitDiffHunk>,
}

pub(super) fn commit_file_patches(output: &str) -> HashMap<String, ParsedCommitPatch> {
    split_commit_patch_blocks(output)
        .into_iter()
        .filter_map(|block| parse_commit_patch_block(&block))
        .map(|patch| (patch.path.clone(), patch))
        .collect()
}

pub(super) fn split_commit_patch_blocks(output: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut current = Vec::new();
    for line in output.lines() {
        if line.starts_with("diff --git ") && !current.is_empty() {
            blocks.push(current.join("\n"));
            current.clear();
        }
        if line.starts_with("diff --git ") || !current.is_empty() {
            current.push(line.to_string());
        }
    }
    if !current.is_empty() {
        blocks.push(current.join("\n"));
    }
    blocks
}

pub(super) fn parse_commit_patch_block(block: &str) -> Option<ParsedCommitPatch> {
    let path = patch_target_path(block)?;
    Some(ParsedCommitPatch {
        path,
        patch: block.to_string(),
        hunks: parse_commit_diff_hunks(block),
    })
}

pub(super) fn patch_target_path(block: &str) -> Option<String> {
    for line in block.lines() {
        if let Some(path) = line.strip_prefix("+++ b/") {
            return Some(path.to_string());
        }
    }
    for line in block.lines() {
        if let Some(path) = line.strip_prefix("--- a/") {
            return Some(path.to_string());
        }
    }
    block
        .lines()
        .find_map(|line| line.strip_prefix("diff --git "))
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|path| path.strip_prefix("b/").or_else(|| path.strip_prefix("a/")))
        .map(ToOwned::to_owned)
}

pub(super) fn parse_commit_diff_hunks(block: &str) -> Vec<CommitDiffHunk> {
    let mut hunks = Vec::new();
    let mut current: Option<CommitDiffHunk> = None;
    let mut old_line = 0;
    let mut new_line = 0;
    for line in block.lines() {
        if line.starts_with("@@ ") {
            if let Some(hunk) = current.take() {
                hunks.push(hunk);
            }
            let Some((old_start, old_lines, new_start, new_lines)) = parse_hunk_header(line) else {
                current = Some(CommitDiffHunk {
                    header: line.to_string(),
                    old_start: 0,
                    old_lines: 0,
                    new_start: 0,
                    new_lines: 0,
                    lines: Vec::new(),
                });
                continue;
            };
            old_line = old_start;
            new_line = new_start;
            current = Some(CommitDiffHunk {
                header: line.to_string(),
                old_start,
                old_lines,
                new_start,
                new_lines,
                lines: Vec::new(),
            });
            continue;
        }
        let Some(hunk) = current.as_mut() else {
            continue;
        };
        let (kind, content, old_number, new_number) = if let Some(content) = line.strip_prefix('+')
        {
            let number = new_line;
            new_line += 1;
            ("added", content.to_string(), None, Some(number))
        } else if let Some(content) = line.strip_prefix('-') {
            let number = old_line;
            old_line += 1;
            ("deleted", content.to_string(), Some(number), None)
        } else if let Some(content) = line.strip_prefix(' ') {
            let old_number = old_line;
            let new_number = new_line;
            old_line += 1;
            new_line += 1;
            (
                "context",
                content.to_string(),
                Some(old_number),
                Some(new_number),
            )
        } else {
            ("meta", line.to_string(), None, None)
        };
        hunk.lines.push(CommitDiffLine {
            kind: kind.to_string(),
            content,
            old_line: old_number,
            new_line: new_number,
        });
    }
    if let Some(hunk) = current {
        hunks.push(hunk);
    }
    hunks
}

pub(super) fn parse_hunk_header(header: &str) -> Option<(i32, i32, i32, i32)> {
    let body = header.strip_prefix("@@ ")?;
    let body = body.split(" @@").next()?;
    let mut parts = body.split_whitespace();
    let old = parse_hunk_range(parts.next()?, '-')?;
    let new = parse_hunk_range(parts.next()?, '+')?;
    Some((old.0, old.1, new.0, new.1))
}

pub(super) fn parse_hunk_range(value: &str, prefix: char) -> Option<(i32, i32)> {
    let value = value.strip_prefix(prefix)?;
    let mut parts = value.splitn(2, ',');
    let start = parts.next()?.parse::<i32>().ok()?;
    let lines = parts
        .next()
        .map(|part| part.parse::<i32>().ok())
        .unwrap_or(Some(1))?;
    Some((start, lines))
}

pub(super) fn optional_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub(super) fn split_words(value: &str) -> Vec<String> {
    value
        .split_whitespace()
        .filter(|part| !part.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

pub(super) fn split_refs(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

pub(super) fn worktree_branch_paths(path: &Path) -> HashMap<String, Vec<String>> {
    let mut branches = HashMap::<String, Vec<String>>::new();
    for entry in git_worktree_entries(path) {
        if let Some(branch) = entry.branch {
            branches
                .entry(branch)
                .or_default()
                .push(normalize_worktree_display_path(&entry.path));
        }
    }
    branches
}

fn normalize_worktree_display_path(path: &Path) -> String {
    let raw = path.to_string_lossy().to_string();
    #[cfg(windows)]
    {
        raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_string()
    }
    #[cfg(not(windows))]
    {
        raw
    }
}

pub(super) fn local_branch_short_name(remote_branch: &str) -> Option<String> {
    let (_, tail) = remote_branch.split_once('/')?;
    let trimmed = tail.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub(super) fn local_branch_exists(path: &Path, branch: &str) -> bool {
    git_command_lossy(
        path,
        &["show-ref", "--verify", "--quiet", &format!("refs/heads/{branch}")],
    )
    .is_some()
}

pub(super) fn remote_branch_exists(path: &Path, branch: &str) -> bool {
    git_command_lossy(
        path,
        &["show-ref", "--verify", "--quiet", &format!("refs/remotes/{branch}")],
    )
    .is_some()
}

pub(super) fn repo_branches(path: &Path) -> Vec<BranchSummary> {
    let output = git_command_lossy(
        path,
        &[
            "branch",
            "--all",
            "--format=%(HEAD)\x1f%(refname)\x1f%(refname:short)\x1f%(upstream:short)\x1f%(upstream:track)\x1f%(committerdate:unix)",
        ],
    )
    .unwrap_or_default();
    let mut seen = HashSet::new();
    let worktree_paths = worktree_branch_paths(path);
    output
        .lines()
        .filter_map(|line| {
            let parts = if line.contains('\x1f') {
                line.split('\x1f').collect::<Vec<_>>()
            } else {
                line.split("%x1f").collect::<Vec<_>>()
            };
            let current = parts.first().copied().unwrap_or("").trim() == "*";
            let full_ref = parts.get(1).copied().unwrap_or("").trim();
            let raw_short_ref = parts.get(2).copied().unwrap_or("").trim();
            let short_ref = raw_short_ref.strip_prefix("remotes/").unwrap_or(raw_short_ref);
            if short_ref.is_empty() {
                return None;
            }
            let remote = full_ref.starts_with("refs/remotes/");
            if short_ref.ends_with("/HEAD") || (remote && !short_ref.contains('/')) {
                return None;
            }
            let name = short_ref.to_string();
            if !seen.insert(format!("{remote}:{name}")) {
                return None;
            }
            let upstream = parts
                .get(3)
                .copied()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned);
            let track = parts.get(4).copied().unwrap_or("");
            let (ahead, behind) = parse_track(track);
            let tip_timestamp = parts
                .get(5)
                .copied()
                .and_then(|value| value.trim().parse::<i64>().ok())
                .filter(|value| *value > 0);
            let mut checked_out_worktree_paths = if remote {
                Vec::new()
            } else {
                worktree_paths.get(&name).cloned().unwrap_or_default()
            };
            if current && checked_out_worktree_paths.is_empty() {
                checked_out_worktree_paths.push(path.to_string_lossy().to_string());
            }
            Some(BranchSummary {
                name,
                remote,
                current,
                upstream,
                ahead,
                behind,
                protected: false,
                tip_timestamp,
                checked_out_worktree_paths,
            })
        })
        .collect()
}

pub(super) fn checkout_branch_at(root: &Path, path: &Path, branch: &str) -> Result<RepoSummary, String> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("分支名不能为空".to_string());
    }
    if local_branch_exists(path, branch) {
        git_command(path, &["checkout", branch], None)?;
        return Ok(summarize_repo(root, path));
    }
    if remote_branch_exists(path, branch) {
        if let Some(local_branch) = local_branch_short_name(branch) {
            if local_branch_exists(path, &local_branch) {
                git_command(path, &["checkout", &local_branch], None)?;
            } else {
                git_command(path, &["checkout", "-b", &local_branch, "--track", branch], None)?;
            }
            return Ok(summarize_repo(root, path));
        }
    }
    git_command(path, &["checkout", branch], None)?;
    Ok(summarize_repo(root, path))
}

pub(super) fn create_branch_at(
    root: &Path,
    path: &Path,
    name: &str,
    from_ref: &str,
    checkout_after: bool,
) -> Result<RepoSummary, String> {
    let name = name.trim();
    let from_ref = from_ref.trim();
    if name.is_empty() {
        return Err("分支名不能为空".to_string());
    }
    if from_ref.is_empty() {
        return Err("基准分支不能为空".to_string());
    }
    if checkout_after {
        git_command(path, &["checkout", "-b", name, from_ref], None)?;
    } else {
        git_command(path, &["branch", name, from_ref], None)?;
    }
    Ok(summarize_repo(root, path))
}

pub(super) fn rename_branch_at(
    root: &Path,
    path: &Path,
    old_name: &str,
    new_name: &str,
) -> Result<RepoSummary, String> {
    let old_name = old_name.trim();
    let new_name = new_name.trim();
    if old_name.is_empty() || new_name.is_empty() {
        return Err("分支名不能为空".to_string());
    }
    let summary = summarize_repo(root, path);
    if summary.current_branch.as_deref() == Some(old_name) {
        git_command(path, &["branch", "-m", new_name], None)?;
    } else {
        git_command(path, &["branch", "-m", old_name, new_name], None)?;
    }
    Ok(summarize_repo(root, path))
}

pub(super) fn merge_branch_at(
    root: &Path,
    path: &Path,
    branch: &str,
) -> Result<RepoMergePullResult, String> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("分支名不能为空".to_string());
    }
    let summary = summarize_repo(root, path);
    if summary.current_branch.as_deref() == Some(branch) {
        return Err("不能合并当前分支".to_string());
    }
    let existing_conflicts = repo_conflicts(path);
    if !existing_conflicts.files.is_empty() || summary.conflict_count > 0 {
        return Err("当前仓库存在未处理冲突，已阻止合并".to_string());
    }

    match git_command(path, &["merge", "--no-edit", branch], None) {
        Ok(_) => {
            let summary = summarize_repo(root, path);
            Ok(RepoMergePullResult {
                status: "success".to_string(),
                message: "合并完成".to_string(),
                conflicts: repo_conflicts(path),
                summary,
            })
        }
        Err(err) => {
            let conflicts = repo_conflicts(path);
            let summary = summarize_repo(root, path);
            if conflicts.files.is_empty() {
                Err(err)
            } else {
                Ok(RepoMergePullResult {
                    status: "conflicts".to_string(),
                    message: "合并产生冲突，请处理后提交".to_string(),
                    summary,
                    conflicts,
                })
            }
        }
    }
}

pub(super) fn delete_branch_at(root: &Path, path: &Path, branch: &str) -> Result<RepoSummary, String> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("分支名不能为空".to_string());
    }
    let summary = summarize_repo(root, path);
    if summary.current_branch.as_deref() == Some(branch) {
        return Err("不能删除当前分支".to_string());
    }
    git_command(path, &["branch", "-d", branch], None)?;
    Ok(summarize_repo(root, path))
}

pub(super) fn parse_track(track: &str) -> (i32, i32) {
    let mut ahead = 0;
    let mut behind = 0;
    for part in track.trim_matches(|c| c == '[' || c == ']').split(',') {
        let trimmed = part.trim();
        if let Some(value) = trimmed.strip_prefix("ahead ") {
            ahead = value.parse().unwrap_or(0);
        } else if let Some(value) = trimmed.strip_prefix("behind ") {
            behind = value.parse().unwrap_or(0);
        }
    }
    (ahead, behind)
}

pub(super) fn repo_stashes(path: &Path) -> Result<Vec<RepoStashEntry>, String> {
    let output = git_command_lossy(path, &["stash", "list", "--format=%gd\x1f%gs"]).unwrap_or_default();
    Ok(output
        .lines()
        .enumerate()
        .filter_map(|(index, line)| {
            let (id, message) = line.split_once('\x1f')?;
            let trimmed_id = id.trim();
            if trimmed_id.is_empty() {
                return None;
            }
            Some(RepoStashEntry {
                id: trimmed_id.to_string(),
                index,
                branch: stash_branch_from_message(message),
                message: message.trim().to_string(),
            })
        })
        .collect())
}

pub(super) fn repo_remotes(path: &Path) -> Result<Vec<RepoRemote>, String> {
    let output = git_command(path, &["remote", "-v"], None)?;
    let current_upstream = current_branch_upstream(path);
    let mut remotes = Vec::new();
    let mut order = Vec::new();
    let mut map = HashMap::<String, RepoRemote>::new();
    for line in output.lines() {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 3 {
            continue;
        }
        let name = parts[0].trim();
        let url = parts[1].trim();
        let kind = parts[2].trim();
        if name.is_empty() || url.is_empty() {
            continue;
        }
        let entry = map.entry(name.to_string()).or_insert_with(|| {
            order.push(name.to_string());
            RepoRemote {
                name: name.to_string(),
                fetch_url: String::new(),
                push_url: None,
                current: current_upstream
                    .as_deref()
                    .map(|value| value.starts_with(&format!("{name}/")))
                    .unwrap_or(false),
            }
        });
        if kind == "(fetch)" {
            entry.fetch_url = url.to_string();
        } else if kind == "(push)" {
            entry.push_url = Some(url.to_string());
        }
    }
    for name in order {
        if let Some(remote) = map.remove(&name) {
            remotes.push(remote);
        }
    }
    Ok(remotes)
}

pub(super) fn stash_branch_from_message(message: &str) -> Option<String> {
    let trimmed = message.trim();
    let branch = trimmed
        .strip_prefix("On ")
        .and_then(|value| value.split_once(':').map(|(head, _)| head.trim().to_string()))
        .or_else(|| {
            trimmed
                .strip_prefix("WIP on ")
                .and_then(|value| value.split_once(':').map(|(head, _)| head.trim().to_string()))
        })?;
    if branch.is_empty() {
        None
    } else {
        Some(branch)
    }
}

pub(super) fn normalize_commit_hash(hash: &str) -> Result<String, String> {
    let trimmed = hash.trim();
    if trimmed.is_empty() {
        return Err("提交 hash 不能为空".to_string());
    }
    Ok(trimmed.to_string())
}

pub(super) fn normalize_branch_ref(value: &str, error_message: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(error_message.to_string());
    }
    Ok(trimmed.to_string())
}

pub(super) fn normalize_remote_name(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("remote 名称不能为空".to_string());
    }
    Ok(trimmed.to_string())
}

pub(super) fn normalize_stash_id(stash_id: &str) -> Result<String, String> {
    let trimmed = stash_id.trim();
    if trimmed.is_empty() {
        return Err("stash 标识不能为空".to_string());
    }
    Ok(trimmed.to_string())
}

pub(super) fn normalize_reset_mode(mode: Option<String>) -> Result<String, String> {
    match mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("--mixed")
    {
        "soft" | "--soft" => Ok("--soft".to_string()),
        "mixed" | "--mixed" => Ok("--mixed".to_string()),
        "hard" | "--hard" => Ok("--hard".to_string()),
        _ => Err("reset 模式只能是 soft、mixed 或 hard".to_string()),
    }
}

pub(super) fn normalize_rebase_target(
    path: &Path,
    onto_ref: Option<String>,
) -> Result<String, String> {
    if let Some(target) = normalize_optional_string(onto_ref) {
        return Ok(target);
    }
    current_branch_upstream(path).ok_or_else(|| "当前分支没有 upstream".to_string())
}

pub(super) fn ensure_repo_ready_for_rewrite(
    root: &Path,
    path: &Path,
    operation: &str,
) -> Result<(), String> {
    ensure_repo_has_no_conflicts(root, path, operation)?;
    let summary = summarize_repo(root, path);
    if repo_dirty_count(&summary) > 0 {
        return Err(format!("存在未提交变更，已阻止 {operation}"));
    }
    Ok(())
}

pub(super) fn ensure_repo_has_no_conflicts(
    root: &Path,
    path: &Path,
    operation: &str,
) -> Result<(), String> {
    let summary = summarize_repo(root, path);
    if summary.conflict_count > 0 || !repo_conflicts(path).files.is_empty() {
        return Err(format!("当前仓库存在未处理冲突，已阻止 {operation}"));
    }
    Ok(())
}

pub(super) fn run_pull(app: &AppHandle, path: &Path) -> Result<(), String> {
    let auth = git_auth_for_repo(app, path)?;
    git_command(path, &["pull", "--ff-only"], auth.as_deref())
        .map(|_| ())
        .map_err(|error| map_remote_git_error(path, error))
}

pub(super) fn run_fetch(app: &AppHandle, path: &Path) -> Result<(), String> {
    let auth = git_auth_for_repo(app, path)?;
    git_command(path, &["fetch"], auth.as_deref())
        .map(|_| ())
        .map_err(|error| map_remote_git_error(path, error))
}

pub(super) fn run_push(app: &AppHandle, path: &Path) -> Result<(), String> {
    let auth = git_auth_for_repo(app, path)?;
    git_command(path, &["push"], auth.as_deref())
        .map(|_| ())
        .map_err(|error| map_remote_git_error(path, error))
}

pub(super) fn run_system_git_push(path: &Path) -> Result<(), String> {
    git_command(path, &["push"], None)
        .map(|_| ())
        .map_err(|error| map_remote_git_error(path, error))
}

pub(super) fn current_branch_upstream(path: &Path) -> Option<String> {
    git_command_lossy(
        path,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .filter(|value| !value.is_empty())
}

pub(crate) fn parse_github_remote(remote: &str) -> Option<String> {
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

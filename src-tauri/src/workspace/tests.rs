use super::bulk::*;
use super::launch::*;
use super::*;
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
use std::sync::{mpsc, Arc, Mutex as TestMutex};
use std::time::Duration as TestDuration;

fn temp_dir(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("lilia-github-{name}-{}", now_millis()));
    fs::create_dir_all(&path).unwrap();
    path
}

fn write_package(path: &Path, body: &str) {
    fs::write(path.join("package.json"), body).unwrap();
}

fn run_git(path: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

fn init_git_repo(path: &Path) {
    fs::create_dir_all(path).unwrap();
    run_git(path, &["init"]);
    run_git(path, &["config", "user.email", "test@example.com"]);
    run_git(path, &["config", "user.name", "Test User"]);
}

#[test]
fn repo_discards_tracked_worktree_changes() {
    let path = temp_dir("discard-tracked");
    init_git_repo(&path);
    fs::write(path.join("app.ts"), "before\n").unwrap();
    run_git(&path, &["add", "app.ts"]);
    run_git(&path, &["commit", "-m", "initial"]);
    fs::write(path.join("app.ts"), "after\n").unwrap();

    discard_repo_files(&path, vec!["app.ts".to_string()]).unwrap();

    assert_eq!(
        fs::read_to_string(path.join("app.ts")).unwrap().replace("\r\n", "\n"),
        "before\n"
    );
    assert!(repo_status_entries(&path).is_empty());
}

#[test]
fn repo_discards_untracked_files() {
    let path = temp_dir("discard-untracked");
    init_git_repo(&path);
    fs::write(path.join("tracked.ts"), "tracked\n").unwrap();
    run_git(&path, &["add", "tracked.ts"]);
    run_git(&path, &["commit", "-m", "initial"]);
    fs::write(path.join("scratch.ts"), "scratch\n").unwrap();

    discard_repo_files(&path, vec!["scratch.ts".to_string()]).unwrap();

    assert!(!path.join("scratch.ts").exists());
    assert!(repo_status_entries(&path).is_empty());
}

#[test]
fn repo_adds_untracked_files_to_gitignore_once() {
    let path = temp_dir("gitignore-untracked");
    init_git_repo(&path);
    fs::write(path.join("tracked.ts"), "tracked\n").unwrap();
    run_git(&path, &["add", "tracked.ts"]);
    run_git(&path, &["commit", "-m", "initial"]);
    fs::create_dir_all(path.join("logs")).unwrap();
    fs::write(path.join("logs").join("output.log"), "log\n").unwrap();

    add_repo_files_to_gitignore(
        &path,
        vec![
            "logs/output.log".to_string(),
            "logs/output.log".to_string(),
        ],
    )
    .unwrap();

    assert_eq!(
        fs::read_to_string(path.join(".gitignore")).unwrap(),
        "logs/output.log\n"
    );
}

fn test_repo_summary(overrides: impl FnOnce(&mut RepoSummary)) -> RepoSummary {
    let mut summary = RepoSummary {
        id: "repo".to_string(),
        name: "repo".to_string(),
        path: "C:/repo".to_string(),
        relative_path: "repo".to_string(),
        current_branch: Some("main".to_string()),
        remote_url: Some("https://github.com/a/repo.git".to_string()),
        github_full_name: Some("a/repo".to_string()),
        ahead: 0,
        behind: 0,
        staged_count: 0,
        unstaged_count: 0,
        untracked_count: 0,
        conflict_count: 0,
        last_commit_at: None,
        last_commit_message: None,
        language_stats: Vec::new(),
        working_tree_language_stats: Vec::new(),
        language_stats_updated_at: 0,
    };
    overrides(&mut summary);
    summary
}

#[test]
fn parses_github_remote_variants() {
    assert_eq!(
        parse_github_remote("https://github.com/sena-nana/Lilia.git"),
        Some("sena-nana/Lilia".to_string())
    );
    assert_eq!(
        parse_github_remote("git@github.com:sena-nana/Lilia.git"),
        Some("sena-nana/Lilia".to_string())
    );
    assert_eq!(parse_github_remote("https://example.com/a/b.git"), None);
}

#[test]
fn normalizes_local_contribution_repo_input_only() {
    assert_eq!(
        normalize_local_contribution_repo_id(" local:repo-id "),
        Some("repo-id".to_string())
    );
    assert_eq!(
        normalize_local_contribution_repo_id("repo-id"),
        Some("repo-id".to_string())
    );
    assert_eq!(
        normalize_local_contribution_repo_id("github:sena-nana/LiliaGithub"),
        None
    );
    assert_eq!(
        normalize_local_contribution_repo_id("https://github.com/a/b"),
        None
    );
    assert_eq!(normalize_local_contribution_repo_id(""), None);
}

fn test_remote_shortcut(full_name: &str) -> RemoteRepoShortcut {
    let repo = normalize_github_repo_input(full_name).unwrap();
    RemoteRepoShortcut {
        full_name: repo.full_name,
        name: repo.name,
        private: false,
        archived: false,
        default_branch: Some("main".to_string()),
        html_url: format!("https://github.com/{full_name}"),
        clone_url: format!("https://github.com/{full_name}.git"),
        opened_at: 1,
    }
}

#[test]
fn remote_repo_shortcuts_are_upserted_by_full_name() {
    let mut shortcuts = Vec::new();
    remember_remote_repo_shortcut(&mut shortcuts, test_remote_shortcut("sena-nana/Remote"))
        .unwrap();
    let first_opened_at = shortcuts[0].opened_at;
    let mut updated = test_remote_shortcut("https://github.com/sena-nana/Remote.git");
    updated.private = true;
    updated.clone_url = "https://github.com/sena-nana/Remote-updated.git".to_string();

    remember_remote_repo_shortcut(&mut shortcuts, updated).unwrap();

    assert_eq!(shortcuts.len(), 1);
    assert_eq!(shortcuts[0].full_name, "sena-nana/Remote");
    assert!(shortcuts[0].private);
    assert_eq!(
        shortcuts[0].clone_url,
        "https://github.com/sena-nana/Remote-updated.git"
    );
    assert!(shortcuts[0].opened_at >= first_opened_at);
}

#[test]
fn forget_remote_repo_shortcut_removes_only_matching_repo() {
    let mut shortcuts = vec![
        test_remote_shortcut("sena-nana/Keep"),
        test_remote_shortcut("sena-nana/Remove"),
    ];

    forget_remote_repo_shortcut(&mut shortcuts, "https://github.com/sena-nana/Remove").unwrap();

    assert_eq!(shortcuts.len(), 1);
    assert_eq!(shortcuts[0].full_name, "sena-nana/Keep");
}

#[test]
fn forget_remote_repo_shortcut_removes_matching_when_stored_as_remote_url() {
    let mut shortcuts = vec![
        {
            let mut item = test_remote_shortcut("sena-nana/Keep");
            item.full_name = "https://github.com/sena-nana/Keep.git".to_string();
            item
        },
        test_remote_shortcut("sena-nana/Remove"),
    ];

    forget_remote_repo_shortcut(&mut shortcuts, "sena-nana/Keep").unwrap();

    assert_eq!(shortcuts.len(), 1);
    assert_eq!(shortcuts[0].full_name, "sena-nana/Remove");
}

#[test]
fn readme_name_priority_supports_remote_readme_candidates() {
    let mut names = vec![
        "README.txt",
        "README.zh-CN.md",
        "README",
        "readme.markdown",
        "README.md",
        "docs.md",
    ];
    names.sort_by(|a, b| {
        let a_priority = readme_name_priority(a).unwrap_or(usize::MAX);
        let b_priority = readme_name_priority(b).unwrap_or(usize::MAX);
        a_priority.cmp(&b_priority).then_with(|| a.cmp(b))
    });

    assert_eq!(
        names,
        vec![
            "README.md",
            "readme.markdown",
            "README",
            "README.txt",
            "README.zh-CN.md",
            "docs.md"
        ],
    );
}

#[test]
fn detects_source_languages_by_path() {
    assert_eq!(
        language_for_path(Path::new("src/app.ts")),
        Some("TypeScript")
    );
    assert_eq!(language_for_path(Path::new("src/App.vue")), Some("Vue"));
    assert_eq!(language_for_path(Path::new("src/main.rs")), Some("Rust"));
    assert_eq!(
        language_for_path(Path::new("scripts/build.ps1")),
        Some("PowerShell")
    );
    assert_eq!(
        language_for_path(Path::new("Dockerfile")),
        Some("Dockerfile")
    );
    assert_eq!(language_for_path(Path::new("assets/icon.png")), None);
}

#[test]
fn skips_generated_lock_and_binary_language_paths() {
    assert!(should_skip_language_path(Path::new("dist/app.ts")));
    assert!(should_skip_language_path(Path::new(
        "node_modules/pkg/index.js"
    )));
    assert!(should_skip_language_path(Path::new("package-lock.json")));
    assert!(should_skip_language_path(Path::new("assets/icon.png")));
    assert!(!should_skip_language_path(Path::new("src/app.ts")));
}

#[test]
fn aggregates_language_stats_from_head_tree() {
    let path = temp_dir("language-stats");
    run_git(&path, &["init"]);
    run_git(&path, &["config", "user.email", "test@example.com"]);
    run_git(&path, &["config", "user.name", "Test User"]);
    fs::create_dir_all(path.join("src")).unwrap();
    fs::create_dir_all(path.join("dist")).unwrap();
    fs::write(
        path.join("src").join("app.ts"),
        "console.log('typescript');\n",
    )
    .unwrap();
    fs::write(
        path.join("src").join("view.vue"),
        "<template>Vue</template>\n",
    )
    .unwrap();
    fs::write(path.join("README.unknown"), "plain text\n").unwrap();
    fs::write(path.join("dist").join("generated.ts"), "ignored\n").unwrap();
    fs::write(path.join("binary.dat"), [0_u8, 159, 146, 150]).unwrap();
    run_git(
        &path,
        &[
            "add",
            "src/app.ts",
            "src/view.vue",
            "README.unknown",
            "dist/generated.ts",
            "binary.dat",
        ],
    );
    run_git(&path, &["commit", "-m", "initial"]);
    fs::write(path.join("src").join("app.ts"), "changed\n").unwrap();
    fs::remove_file(path.join("src").join("view.vue")).unwrap();

    let stats = repo_head_language_stats(&path);

    assert_eq!(
        stats,
        vec![
            LanguageStat {
                language: "TypeScript".to_string(),
                bytes: 27,
            },
            LanguageStat {
                language: "Vue".to_string(),
                bytes: 25,
            },
        ]
    );
    fs::remove_dir_all(path).unwrap();
}

#[test]
fn aggregates_language_stats_from_working_tree() {
    let path = temp_dir("language-stats-working-tree");
    run_git(&path, &["init"]);
    run_git(&path, &["config", "user.email", "test@example.com"]);
    run_git(&path, &["config", "user.name", "Test User"]);
    fs::create_dir_all(path.join("src")).unwrap();
    fs::write(
        path.join("src").join("app.ts"),
        "console.log('typescript');\n",
    )
    .unwrap();
    fs::write(
        path.join("src").join("view.vue"),
        "<template>Vue</template>\n",
    )
    .unwrap();
    run_git(&path, &["add", "src/app.ts", "src/view.vue"]);
    run_git(&path, &["commit", "-m", "initial"]);
    fs::write(path.join("src").join("app.ts"), "changed\n").unwrap();
    fs::remove_file(path.join("src").join("view.vue")).unwrap();
    fs::write(path.join("src").join("panel.rs"), "fn main() {}\n").unwrap();

    let head_stats = repo_head_language_stats(&path);
    let working_tree_stats = repo_working_tree_language_stats(&path);

    assert_eq!(
        head_stats,
        vec![
            LanguageStat {
                language: "TypeScript".to_string(),
                bytes: 27,
            },
            LanguageStat {
                language: "Vue".to_string(),
                bytes: 25,
            },
        ]
    );
    assert_eq!(
        working_tree_stats,
        vec![
            LanguageStat {
                language: "Rust".to_string(),
                bytes: 13,
            },
            LanguageStat {
                language: "TypeScript".to_string(),
                bytes: 8,
            },
        ]
    );
    fs::remove_dir_all(path).unwrap();
}

#[test]
fn collect_local_contribution_counts_counts_all_repo_commits() {
    let path = temp_dir("collect-local-contribution");
    init_git_repo(&path);
    fs::create_dir_all(path.join("src")).unwrap();
    fs::write(path.join("src").join("app.ts"), "console.log(1)\n").unwrap();
    run_git(&path, &["add", "src/app.ts"]);
    run_git(&path, &["commit", "-m", "first commit"]);

    let end_day_index = current_utc_day_index();
    let start_day_index = end_day_index - 2;

    let mut counts = HashMap::new();
    collect_local_contribution_counts(&path, start_day_index, end_day_index, &mut counts).unwrap();
    let total: usize = counts.values().sum();

    assert_eq!(total, 1);
    fs::remove_dir_all(path).unwrap();
}

#[test]
fn local_contribution_cache_reads_writes_and_removes_repo_days() {
    let mut settings = WorkspaceSettings::default();

    write_local_contribution_cache(&mut settings, "repo-id", "2026-06-11", 3);

    assert_eq!(
        cached_local_contribution_count(&settings, "repo-id", "2026-06-11"),
        Some(3)
    );
    assert_eq!(
        cached_local_contribution_count(&settings, "repo-id", "2026-06-12"),
        None
    );

    remove_local_contribution_cache(&mut settings, "repo-id");

    assert_eq!(
        cached_local_contribution_count(&settings, "repo-id", "2026-06-11"),
        None
    );
}

#[test]
fn converts_civil_dates_for_github_contributions() {
    let day = days_from_civil(2026, 6, 11);
    assert_eq!(format_day_index(day), "2026-06-11");
}

#[test]
fn infers_clone_directory_from_remote_url() {
    assert_eq!(
        infer_clone_directory_name("https://github.com/sena-nana/LiliaGithub.git").unwrap(),
        "LiliaGithub"
    );
    assert_eq!(
        infer_clone_directory_name("git@github.com:sena-nana/Lilia.git").unwrap(),
        "Lilia"
    );
    assert_eq!(
        infer_clone_directory_name("ssh://git@example.com/tools/example-repo.git").unwrap(),
        "example-repo"
    );
}

#[test]
fn validates_clone_directory_name_as_single_segment() {
    assert!(validate_clone_directory_name("new-repo").is_ok());
    assert!(validate_clone_directory_name("nested/repo").is_err());
    assert!(validate_clone_directory_name("nested\\repo").is_err());
    assert!(validate_clone_directory_name("../repo").is_err());
    assert!(validate_clone_directory_name("..").is_err());
    assert!(validate_clone_directory_name(" repo ").is_err());
    assert!(validate_clone_directory_name("").is_err());
}

#[test]
fn normalizes_clone_directory_name_with_user_override() {
    assert_eq!(
        normalize_clone_directory_name(
            "https://github.com/sena-nana/source-name.git",
            Some("target-name".to_string())
        )
        .unwrap(),
        "target-name"
    );
    assert!(normalize_clone_directory_name(
        "https://github.com/sena-nana/source-name.git",
        Some("../target".to_string())
    )
    .is_err());
}

#[test]
fn normalizes_github_clone_not_found_error() {
    let error = normalize_git_remote_error(
        "https://github.com/meijustory123/TapdClient.git",
        "remote: Repository not found.\nfatal: repository 'https://github.com/meijustory123/TapdClient.git/' not found"
            .to_string(),
    );

    assert_eq!(
        error,
        "无法访问 GitHub 仓库 meijustory123/TapdClient：仓库不存在、是私有仓库且当前 GitHub 绑定无权限，或仓库名输入有误。"
    );
}

#[test]
fn normalizes_github_clone_authentication_error() {
    let error = normalize_git_remote_error(
        "https://github.com/sena-nana/private.git",
        "fatal: Authentication failed for 'https://github.com/sena-nana/private.git/'".to_string(),
    );

    assert_eq!(
        error,
        "无法认证 GitHub 仓库 sena-nana/private，请重新绑定 GitHub 后再试。"
    );
}

#[test]
fn parses_status_pair_and_path() {
    assert_eq!(
        status_pair(" M src/main.ts"),
        (" ".to_string(), "M".to_string())
    );
    assert_eq!(
        parse_status_entries(" M src/main.ts\0R  new.ts\0old.ts\0"),
        vec![
            RepoStatusEntry {
                index: " ".to_string(),
                worktree: "M".to_string(),
                path: "src/main.ts".to_string(),
                old_path: None,
            },
            RepoStatusEntry {
                index: "R".to_string(),
                worktree: " ".to_string(),
                path: "new.ts".to_string(),
                old_path: Some("old.ts".to_string()),
            },
        ]
    );
}

#[test]
fn selects_repo_files_from_porcelain_z_status() {
    let path = temp_dir("selected-repo-files");
    run_git(&path, &["init"]);
    run_git(&path, &["config", "user.email", "test@example.com"]);
    run_git(&path, &["config", "user.name", "Test User"]);
    fs::create_dir_all(path.join("src").join("components").join("repo")).unwrap();
    fs::write(
        path.join("src")
            .join("components")
            .join("repo")
            .join("Repo Changes Panel.vue"),
        "<template />\n",
    )
    .unwrap();

    let selected = selected_repo_files(
        &path,
        vec![
            "src/components/repo/Repo Changes Panel.vue".to_string(),
            "src/components/repo/Repo Changes Panel.vue".to_string(),
        ],
    )
    .unwrap();

    assert_eq!(
        selected,
        vec!["src/components/repo/Repo Changes Panel.vue".to_string()]
    );
    assert!(selected_repo_files(
        &path,
        vec!["rc/components/repo/Repo Changes Panel.vue".to_string()]
    )
    .is_err());
    fs::remove_dir_all(path).unwrap();
}

#[test]
fn detects_unmerged_status_pairs() {
    for (index, worktree) in [
        ("U", "U"),
        ("A", "A"),
        ("D", "D"),
        ("A", "U"),
        ("U", "A"),
        ("D", "U"),
        ("U", "D"),
    ] {
        assert!(is_conflict_status(index, worktree));
    }
    assert!(!is_conflict_status("M", " "));
    assert!(!is_conflict_status("?", "?"));
}

#[test]
fn parses_conflict_marker_hunks() {
    let content = [
        "before",
        &format!("{} HEAD", "<<<<<<<"),
        "ours one",
        "=======",
        "theirs one",
        &format!("{} origin/main", ">>>>>>>"),
        "middle",
        &format!("{} feature", "<<<<<<<"),
        "ours two",
        "=======",
        "theirs two",
        &format!("{} main", ">>>>>>>"),
        "after",
        "",
    ]
    .join("\n");

    let hunks = parse_conflict_hunks(&content);

    assert_eq!(hunks.len(), 2);
    assert_eq!(hunks[0].id, "hunk-1");
    assert_eq!(hunks[0].start_line, 2);
    assert_eq!(hunks[0].end_line, 6);
    assert_eq!(hunks[0].ours_label, "HEAD");
    assert_eq!(hunks[0].theirs_label, "origin/main");
    assert_eq!(hunks[0].ours_lines, vec!["ours one".to_string()]);
    assert_eq!(hunks[0].theirs_lines, vec!["theirs one".to_string()]);
    assert_eq!(hunks[1].id, "hunk-2");
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

#[test]
fn maps_conflict_abort_and_continue_args() {
    assert_eq!(
        conflict_operation_args("merge", "终止").unwrap(),
        ["merge", "--abort"]
    );
    assert_eq!(
        conflict_operation_args("rebase", "终止").unwrap(),
        ["rebase", "--abort"]
    );
    assert_eq!(
        conflict_operation_args("cherry-pick", "终止").unwrap(),
        ["cherry-pick", "--abort"]
    );
    assert_eq!(
        conflict_operation_args("merge", "继续").unwrap(),
        ["commit", "--no-edit"]
    );
    assert_eq!(
        conflict_operation_args("rebase", "继续").unwrap(),
        ["rebase", "--continue"]
    );
    assert_eq!(
        conflict_operation_args("cherry-pick", "继续").unwrap(),
        ["cherry-pick", "--continue"]
    );
}

#[test]
fn rejects_missing_or_unknown_conflict_operations() {
    assert_eq!(
        conflict_operation_args("none", "终止").unwrap_err(),
        "当前没有进行中的冲突操作"
    );
    assert_eq!(
        conflict_operation_args("none", "继续").unwrap_err(),
        "当前没有进行中的冲突操作"
    );
    assert_eq!(
        conflict_operation_args("am", "终止").unwrap_err(),
        "不支持终止 am 冲突"
    );
    assert_eq!(
        conflict_operation_args("am", "继续").unwrap_err(),
        "不支持继续 am 冲突"
    );
}

#[test]
fn merge_pull_blocks_unsafe_states() {
    assert_eq!(
        merge_pull_block_reason(
            &test_repo_summary(|summary| summary.conflict_count = 1),
            true
        ),
        Some("已有冲突需要先处理".to_string())
    );
    assert_eq!(
        merge_pull_block_reason(
            &test_repo_summary(|summary| summary.unstaged_count = 1),
            true
        ),
        Some("存在未提交变更，已阻止合并拉取".to_string())
    );
    assert_eq!(
        merge_pull_block_reason(&test_repo_summary(|_| {}), false),
        Some("当前分支没有 upstream".to_string())
    );
    assert_eq!(
        merge_pull_block_reason(&test_repo_summary(|_| {}), true),
        None
    );
}

#[test]
fn repo_history_reads_all_branch_topology() {
    let path = temp_dir("history-all-branches");
    init_git_repo(&path);

    fs::write(path.join("file.txt"), "root").unwrap();
    run_git(&path, &["add", "file.txt"]);
    run_git(&path, &["commit", "-m", "root"]);
    run_git(&path, &["checkout", "-b", "feature"]);
    fs::write(path.join("feature.txt"), "feature").unwrap();
    run_git(&path, &["add", "feature.txt"]);
    run_git(&path, &["commit", "-m", "feature"]);
    run_git(&path, &["checkout", "-b", "main", "HEAD~1"]);
    fs::write(path.join("main.txt"), "main").unwrap();
    run_git(&path, &["add", "main.txt"]);
    run_git(&path, &["commit", "-m", "main"]);
    run_git(
        &path,
        &["merge", "--no-ff", "feature", "-m", "merge feature"],
    );

    let history = repo_history(&path);
    let subjects: Vec<_> = history
        .iter()
        .map(|commit| commit.subject.as_str())
        .collect();
    let merge = history
        .iter()
        .find(|commit| commit.subject == "merge feature")
        .expect("merge commit should be present");

    assert!(subjects.contains(&"main"));
    assert!(subjects.contains(&"feature"));
    assert_eq!(merge.parents.len(), 2);
    assert!(merge.refs.iter().any(|item| item.contains("main")));
}

#[test]
fn repo_branches_marks_local_branches_unprotected() {
    let path = temp_dir("branches-unprotected");
    init_git_repo(&path);

    fs::write(path.join("file.txt"), "root").unwrap();
    run_git(&path, &["add", "file.txt"]);
    run_git(&path, &["commit", "-m", "root"]);

    let branches = repo_branches(&path);

    assert!(!branches.is_empty());
    assert!(branches
        .iter()
        .all(|branch| !branch.remote && !branch.protected));
}

#[test]
fn repo_branches_hides_remote_namespace_refs() {
    let path = temp_dir("branches-hide-origin");
    init_git_repo(&path);

    fs::write(path.join("file.txt"), "root").unwrap();
    run_git(&path, &["add", "file.txt"]);
    run_git(&path, &["commit", "-m", "root"]);
    run_git(&path, &["update-ref", "refs/remotes/origin", "HEAD"]);

    let branches = repo_branches(&path);
    let names = branches
        .iter()
        .map(|branch| branch.name.as_str())
        .collect::<Vec<_>>();

    assert!(!names.contains(&"origin"));
}

#[test]
fn delete_branch_blocks_current_branch_and_safely_deletes_merged_branch() {
    let path = temp_dir("delete-local-branch");
    init_git_repo(&path);

    fs::write(path.join("file.txt"), "root").unwrap();
    run_git(&path, &["add", "file.txt"]);
    run_git(&path, &["commit", "-m", "root"]);
    run_git(&path, &["branch", "-M", "main"]);
    run_git(&path, &["checkout", "-b", "feature"]);
    fs::write(path.join("feature.txt"), "feature").unwrap();
    run_git(&path, &["add", "feature.txt"]);
    run_git(&path, &["commit", "-m", "feature"]);
    run_git(&path, &["checkout", "main"]);
    run_git(&path, &["merge", "--no-ff", "feature", "-m", "merge feature"]);

    assert_eq!(
        delete_branch_at(&path, &path, "main").unwrap_err(),
        "不能删除当前分支"
    );

    delete_branch_at(&path, &path, "feature").unwrap();
    let branches = repo_branches(&path);
    assert!(!branches
        .iter()
        .any(|branch| !branch.remote && branch.name == "feature"));
}

#[test]
fn merge_branch_merges_target_into_current_branch() {
    let path = temp_dir("merge-local-branch");
    init_git_repo(&path);

    fs::write(path.join("file.txt"), "root").unwrap();
    run_git(&path, &["add", "file.txt"]);
    run_git(&path, &["commit", "-m", "root"]);
    run_git(&path, &["branch", "-M", "main"]);
    run_git(&path, &["checkout", "-b", "feature"]);
    fs::write(path.join("feature.txt"), "feature").unwrap();
    run_git(&path, &["add", "feature.txt"]);
    run_git(&path, &["commit", "-m", "feature"]);
    run_git(&path, &["checkout", "main"]);

    let result = merge_branch_at(&path, &path, "feature").unwrap();

    assert_eq!(result.status, "success");
    assert_eq!(result.summary.current_branch.as_deref(), Some("main"));
    assert!(path.join("feature.txt").exists());
}

#[test]
fn merge_branch_returns_conflict_result() {
    let path = temp_dir("merge-local-branch-conflict");
    init_git_repo(&path);

    fs::write(path.join("file.txt"), "root\n").unwrap();
    run_git(&path, &["add", "file.txt"]);
    run_git(&path, &["commit", "-m", "root"]);
    run_git(&path, &["branch", "-M", "main"]);
    run_git(&path, &["checkout", "-b", "feature"]);
    fs::write(path.join("file.txt"), "feature\n").unwrap();
    run_git(&path, &["commit", "-am", "feature"]);
    run_git(&path, &["checkout", "main"]);
    fs::write(path.join("file.txt"), "main\n").unwrap();
    run_git(&path, &["commit", "-am", "main"]);

    let result = merge_branch_at(&path, &path, "feature").unwrap();

    assert_eq!(result.status, "conflicts");
    assert_eq!(result.conflicts.operation, "merge");
    assert!(!result.conflicts.files.is_empty());
}

#[test]
fn parses_commit_patch_hunks_and_line_numbers() {
    let patch = "\
diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import app from './app'
-console.log('old')
+console.log('new')
+console.log('ready')
 export default app";

    let patches = commit_file_patches(patch);
    let parsed = patches.get("src/app.ts").expect("patch should be parsed");

    assert_eq!(parsed.hunks.len(), 1);
    let hunk = &parsed.hunks[0];
    assert_eq!(hunk.header, "@@ -1,3 +1,4 @@");
    assert_eq!((hunk.old_start, hunk.old_lines), (1, 3));
    assert_eq!((hunk.new_start, hunk.new_lines), (1, 4));
    assert_eq!(hunk.lines[0].kind, "context");
    assert_eq!(
        (hunk.lines[0].old_line, hunk.lines[0].new_line),
        (Some(1), Some(1))
    );
    assert_eq!(hunk.lines[1].kind, "deleted");
    assert_eq!(
        (hunk.lines[1].old_line, hunk.lines[1].new_line),
        (Some(2), None)
    );
    assert_eq!(hunk.lines[2].kind, "added");
    assert_eq!(
        (hunk.lines[2].old_line, hunk.lines[2].new_line),
        (None, Some(2))
    );
    assert_eq!(hunk.lines[3].kind, "added");
    assert_eq!(
        (hunk.lines[3].old_line, hunk.lines[3].new_line),
        (None, Some(3))
    );
    assert_eq!(
        (hunk.lines[4].old_line, hunk.lines[4].new_line),
        (Some(3), Some(4))
    );
}

#[test]
fn binds_renamed_commit_patch_to_new_path() {
    let status = commit_file_statuses("R072\tsrc/old.ts\tsrc/new.ts")
        .into_iter()
        .next()
        .expect("rename status should parse");
    let stats = commit_file_numstats("1\t1\tsrc/{old => new}.ts");
    let mut file = commit_file_change_from_status(status, &stats);
    let patches = commit_file_patches(
        "\
diff --git a/src/old.ts b/src/new.ts
similarity index 72%
rename from src/old.ts
rename to src/new.ts
--- a/src/old.ts
+++ b/src/new.ts
@@ -1 +1 @@
-oldName()
+newName()",
    );

    if let Some(parsed) = patches.get(&file.path) {
        file.patch = parsed.patch.clone();
        file.hunks = parsed.hunks.clone();
    }

    assert_eq!(file.status, "renamed");
    assert_eq!(file.old_path.as_deref(), Some("src/old.ts"));
    assert_eq!(file.path, "src/new.ts");
    assert_eq!((file.additions, file.deletions), (1, 1));
    assert!(file.patch.contains("rename to src/new.ts"));
    assert_eq!(file.hunks.len(), 1);
    assert_eq!(file.hunks[0].lines[0].content, "oldName()");
    assert_eq!(file.hunks[0].lines[1].content, "newName()");
}

#[test]
fn binds_pure_rename_patch_without_hunks() {
    let status = commit_file_statuses("R100\tdocs/old.md\tdocs/new.md")
        .into_iter()
        .next()
        .expect("pure rename status should parse");
    let patches = commit_file_patches(
        "\
diff --git a/docs/old.md b/docs/new.md
similarity index 100%
rename from docs/old.md
rename to docs/new.md",
    );

    let parsed = patches
        .get(&status.path)
        .expect("pure rename patch should bind to new path");

    assert_eq!(status.status, "renamed");
    assert_eq!(status.old_path.as_deref(), Some("docs/old.md"));
    assert_eq!(status.path, "docs/new.md");
    assert!(parsed.patch.contains("rename to docs/new.md"));
    assert!(parsed.hunks.is_empty());
}

#[test]
fn bulk_preview_blocks_dirty_pull_and_allows_push() {
    let dirty_pull_repo = test_repo_summary(|summary| {
        summary.id = "app".to_string();
        summary.ahead = 1;
        summary.behind = 2;
        summary.unstaged_count = 1;
    });
    let pull = build_bulk_preview("pull".to_string(), vec![dirty_pull_repo]);
    assert_eq!(pull.blocked.len(), 1);

    let push_repo = test_repo_summary(|summary| {
        summary.id = "push".to_string();
        summary.ahead = 1;
        summary.unstaged_count = 1;
    });
    let push = build_bulk_push_preview_with_lookup(vec![push_repo], |_| true);
    assert_eq!(push.eligible.len(), 1);
    assert_eq!(push.warnings.len(), 1);
}

#[test]
fn push_preview_blocks_missing_remote_detached_and_behind() {
    let no_remote = test_repo_summary(|summary| {
        summary.id = "no-remote".to_string();
        summary.remote_url = None;
        summary.github_full_name = None;
        summary.ahead = 1;
    });
    let detached = test_repo_summary(|summary| {
        summary.id = "detached".to_string();
        summary.current_branch = None;
        summary.ahead = 1;
    });
    let behind = test_repo_summary(|summary| {
        summary.id = "behind".to_string();
        summary.ahead = 1;
        summary.behind = 2;
    });

    let preview = build_bulk_push_preview_with_lookup(vec![no_remote, detached, behind], |_| true);

    assert_eq!(preview.blocked.len(), 3);
    assert!(preview
        .blocked
        .iter()
        .any(|item| item.reason == "没有 origin remote"));
    assert!(preview
        .blocked
        .iter()
        .any(|item| item.reason == "当前不是命名分支"));
    assert!(preview
        .blocked
        .iter()
        .any(|item| item.reason == "当前分支落后于 upstream"));
}

#[test]
fn push_preview_warns_dirty_push_and_idle_repos() {
    let ready = test_repo_summary(|summary| {
        summary.id = "ready".to_string();
        summary.ahead = 1;
        summary.staged_count = 1;
    });
    let idle = test_repo_summary(|summary| {
        summary.id = "idle".to_string();
    });

    let preview = build_bulk_push_preview_with_lookup(vec![ready.clone(), idle.clone()], |_| true);

    assert_eq!(preview.eligible.len(), 1);
    assert_eq!(preview.eligible[0].repo.id, ready.id);
    assert!(preview
        .warnings
        .iter()
        .any(|item| item.repo.id == ready.id && item.reason == "存在未提交变更，但仍可执行 push"));
    assert!(preview
        .warnings
        .iter()
        .any(|item| item.repo.id == idle.id && item.reason == "没有需要推送的提交"));
}

#[test]
fn push_preview_blocks_repo_without_upstream() {
    let repo = test_repo_summary(|summary| {
        summary.id = "no-upstream".to_string();
        summary.ahead = 1;
    });

    let preview = build_bulk_push_preview_with_lookup(vec![repo], |_| false);

    assert_eq!(preview.blocked.len(), 1);
    assert_eq!(preview.blocked[0].reason, "当前分支没有 upstream");
}

#[test]
fn queue_push_fallback_only_matches_github_token_auth_failures() {
    assert!(should_retry_push_with_system_git(
        "无法认证 GitHub 仓库 a/repo，请重新绑定 GitHub 后再试。"
    ));
    assert!(should_retry_push_with_system_git(
        "无法访问 GitHub 仓库 a/repo：仓库不存在、是私有仓库且当前 GitHub 绑定无权限，或仓库名输入有误。"
    ));
    assert!(!should_retry_push_with_system_git("non-fast-forward"));
}

#[test]
fn removing_system_git_repo_id_restores_default_token_auth() {
    let mut settings = WorkspaceSettings {
        system_git_repo_ids: vec![
            "Lilia".to_string(),
            "LiliaGithub".to_string(),
            "Tools/Nested".to_string(),
        ],
        ..WorkspaceSettings::default()
    };

    remove_system_git_repo_id(&mut settings, " LiliaGithub ").unwrap();

    assert_eq!(
        settings.system_git_repo_ids,
        vec!["Lilia".to_string(), "Tools/Nested".to_string()]
    );
    assert_eq!(
        remove_system_git_repo_id(&mut settings, "   ").unwrap_err(),
        "仓库 ID 不能为空"
    );
}

#[test]
fn sync_preview_classifies_pull_push_merge_and_idle_repos() {
    let pull_only = test_repo_summary(|summary| {
        summary.id = "pull-only".to_string();
        summary.behind = 2;
    });
    let push_only = test_repo_summary(|summary| {
        summary.id = "push-only".to_string();
        summary.ahead = 1;
    });
    let diverged = test_repo_summary(|summary| {
        summary.id = "diverged".to_string();
        summary.ahead = 1;
        summary.behind = 1;
    });
    let idle = test_repo_summary(|summary| {
        summary.id = "idle".to_string();
    });

    let preview =
        build_bulk_sync_preview_with_lookup(vec![pull_only, push_only, diverged, idle], |_| true);

    assert_eq!(preview.operation, "sync");
    assert!(preview
        .eligible
        .iter()
        .any(|item| { item.repo.id == "pull-only" && item.reason == "可拉取远端更新" }));
    assert!(preview
        .eligible
        .iter()
        .any(|item| { item.repo.id == "push-only" && item.reason == "有本地提交待推送" }));
    assert!(preview.eligible.iter().any(|item| {
        item.repo.id == "diverged" && item.reason == "需先拉取合并后推送"
    }));
    assert!(preview
        .warnings
        .iter()
        .any(|item| { item.repo.id == "idle" && item.reason == "没有需要同步的更新" }));
}

#[test]
fn sync_preview_blocks_unsafe_merge_states() {
    let dirty = test_repo_summary(|summary| {
        summary.id = "dirty".to_string();
        summary.behind = 1;
        summary.unstaged_count = 1;
    });
    let conflicted = test_repo_summary(|summary| {
        summary.id = "conflicted".to_string();
        summary.behind = 1;
        summary.conflict_count = 1;
    });
    let no_upstream = test_repo_summary(|summary| {
        summary.id = "no-upstream".to_string();
        summary.behind = 1;
    });

    let preview =
        build_bulk_sync_preview_with_lookup(vec![dirty, conflicted, no_upstream], |repo| {
            repo.id != "no-upstream"
        });

    assert_eq!(preview.eligible.len(), 0);
    assert!(preview
        .blocked
        .iter()
        .any(|item| { item.repo.id == "dirty" && item.reason == "存在未提交变更" }));
    assert!(preview.blocked.iter().any(|item| {
        item.repo.id == "conflicted" && item.reason == "已有冲突需要先处理"
    }));
    assert!(preview.blocked.iter().any(|item| {
        item.repo.id == "no-upstream" && item.reason == "当前分支没有 upstream"
    }));
}

#[test]
fn bulk_sync_parallel_returns_all_results_after_repo_error() {
    let active = AtomicUsize::new(0);
    let peak = AtomicUsize::new(0);

    let results = run_bulk_sync_parallel(vec!["ok".to_string(), "failed".to_string()], |repo_id| {
        let current = active.fetch_add(1, AtomicOrdering::SeqCst) + 1;
        peak.fetch_max(current, AtomicOrdering::SeqCst);
        std::thread::sleep(TestDuration::from_millis(30));
        active.fetch_sub(1, AtomicOrdering::SeqCst);

        if repo_id == "failed" {
            return bulk_error_result(repo_id, "认证失败".to_string());
        }
        BulkSyncResult {
            repo_id,
            status: "success".to_string(),
            message: "完成".to_string(),
            summary: None,
        }
    });

    assert_eq!(results.len(), 2);
    assert!(peak.load(AtomicOrdering::SeqCst) > 1);
    assert!(results.iter().any(|result| result.status == "success"));
    assert!(results
        .iter()
        .any(|result| result.status == "error" && result.message == "认证失败"));
}

#[test]
fn filters_hidden_repositories_by_id() {
    let visible = test_repo_summary(|summary| {
        summary.id = "visible".to_string();
        summary.remote_url = None;
        summary.github_full_name = None;
    });
    let hidden = test_repo_summary(|summary| {
        summary.id = "hidden".to_string();
        summary.remote_url = None;
        summary.github_full_name = None;
    });

    let repos = filter_hidden_repos(vec![visible.clone(), hidden], &["hidden".to_string()]);

    assert_eq!(repos.len(), 1);
    assert_eq!(repos[0].id, visible.id);
}

#[test]
fn github_delete_repo_requires_delete_repo_scope() {
    let mut binding = GitHubBindingMetadata {
        login: "lilia-user".to_string(),
        avatar_url: None,
        bound_at: 1,
        scopes: vec![
            "repo".to_string(),
            "workflow".to_string(),
            "read:user".to_string(),
        ],
        client_id_source: "bundled".to_string(),
    };

    assert!(github_require_scope(&binding, GITHUB_DELETE_REPO_SCOPE).is_err());

    binding.scopes.push(GITHUB_DELETE_REPO_SCOPE.to_string());

    assert!(github_require_scope(&binding, GITHUB_DELETE_REPO_SCOPE).is_ok());
}

#[test]
fn workspace_task_priority_orders_high_before_low() {
    assert!(task_priority_rank("high") < task_priority_rank("normal"));
    assert!(task_priority_rank("normal") < task_priority_rank("low"));
}

#[test]
fn normalize_github_repo_input_accepts_owner_repo() {
    let repo = normalize_github_repo_input("sena-nana/LiliaGithub").unwrap();

    assert_eq!(repo.owner, "sena-nana");
    assert_eq!(repo.name, "LiliaGithub");
    assert_eq!(repo.full_name, "sena-nana/LiliaGithub");
    assert_eq!(
        repo.clone_url,
        "https://github.com/sena-nana/LiliaGithub.git"
    );
}

#[test]
fn normalize_github_repo_input_accepts_https_url() {
    let repo = normalize_github_repo_input("https://github.com/sena-nana/LiliaGithub.git").unwrap();

    assert_eq!(repo.full_name, "sena-nana/LiliaGithub");
    assert_eq!(
        repo.clone_url,
        "https://github.com/sena-nana/LiliaGithub.git"
    );
}

#[test]
fn normalize_github_repo_input_accepts_https_url_without_git_suffix() {
    let repo = normalize_github_repo_input("https://github.com/sena-nana/LiliaGithub").unwrap();

    assert_eq!(repo.full_name, "sena-nana/LiliaGithub");
    assert_eq!(
        repo.clone_url,
        "https://github.com/sena-nana/LiliaGithub.git"
    );
}

#[test]
fn normalize_github_repo_input_rejects_invalid_values() {
    assert!(normalize_github_repo_input("sena-nana").is_err());
    assert!(normalize_github_repo_input("https://example.com/foo/bar").is_err());
}

#[test]
fn parses_github_next_page_from_link_header() {
    let link = r#"<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=4>; rel="last""#;

    assert_eq!(parse_next_page(Some(link)), Some(2));
    assert_eq!(
        parse_next_page(Some(
            r#"<https://api.github.com/user/repos?page=4>; rel="last""#
        )),
        None
    );
    assert_eq!(parse_next_page(None), None);
}

#[test]
fn builds_github_repo_settings_patch_with_changed_fields_only() {
    let payload = github_update_repo_settings_payload(GitHubUpdateRepoSettingsRequest {
        description: Some("new desc".to_string()),
        homepage: None,
        private: Some(true),
        default_branch: Some(" main ".to_string()),
        has_issues: None,
        has_wiki: Some(false),
        has_projects: None,
        has_discussions: None,
        allow_merge_commit: None,
        allow_squash_merge: None,
        allow_rebase_merge: None,
        allow_auto_merge: None,
        delete_branch_on_merge: Some(true),
        allow_forking: None,
        web_commit_signoff_required: None,
    });

    assert_eq!(payload.len(), 5);
    assert_eq!(payload.get("description").unwrap(), "new desc");
    assert_eq!(payload.get("private").unwrap(), true);
    assert_eq!(payload.get("default_branch").unwrap(), "main");
    assert_eq!(payload.get("has_wiki").unwrap(), false);
    assert_eq!(payload.get("delete_branch_on_merge").unwrap(), true);
    assert!(payload.get("homepage").is_none());
}

#[test]
fn filters_pull_requests_from_github_issues() {
    let issue = GitHubIssueResponse {
        number: 1,
        title: "Issue".to_string(),
        state: "open".to_string(),
        body: None,
        html_url: "https://github.com/a/repo/issues/1".to_string(),
        updated_at: "2026-06-11T00:00:00Z".to_string(),
        created_at: "2026-06-11T00:00:00Z".to_string(),
        labels: vec![GitHubLabelResponse {
            name: "bug".to_string(),
        }],
        assignees: vec![GitHubAssigneeResponse {
            login: "octo".to_string(),
        }],
        pull_request: None,
    };
    let pr = GitHubIssueResponse {
        pull_request: Some(
            serde_json::json!({ "url": "https://api.github.com/repos/a/repo/pulls/2" }),
        ),
        number: 2,
        title: "PR".to_string(),
        state: "open".to_string(),
        body: None,
        html_url: "https://github.com/a/repo/pull/2".to_string(),
        updated_at: "2026-06-11T00:00:00Z".to_string(),
        created_at: "2026-06-11T00:00:00Z".to_string(),
        labels: Vec::new(),
        assignees: Vec::new(),
    };

    let mapped = github_issue_from_response(issue).unwrap();
    assert_eq!(mapped.labels, vec!["bug"]);
    assert_eq!(mapped.assignees, vec!["octo"]);
    assert!(github_issue_from_response(pr).is_none());
}

#[test]
fn maps_github_workflow_runs_with_defaults() {
    let mapped = github_workflow_run_from_response(GitHubWorkflowRunResponse {
        id: 42,
        name: Some("CI".to_string()),
        display_title: None,
        status: Some("completed".to_string()),
        conclusion: Some("success".to_string()),
        head_branch: Some("main".to_string()),
        event: Some("push".to_string()),
        html_url: "https://github.com/a/repo/actions/runs/42".to_string(),
        created_at: "2026-06-12T10:00:00Z".to_string(),
        updated_at: "2026-06-12T10:05:00Z".to_string(),
    });

    assert_eq!(mapped.id, 42);
    assert_eq!(mapped.name, "CI");
    assert_eq!(mapped.display_title, "CI");
    assert_eq!(mapped.status, "completed");
    assert_eq!(mapped.conclusion.as_deref(), Some("success"));
    assert_eq!(mapped.branch, "main");
    assert_eq!(mapped.event, "push");
}

#[test]
fn maps_github_branches_with_default_and_protection() {
    let main = github_branch_from_response(GitHubBranchResponse {
        name: "main".to_string(),
        protected: true,
    });
    let feature = github_branch_from_response(GitHubBranchResponse {
        name: "feature".to_string(),
        protected: false,
    });

    assert_eq!(main.name, "main");
    assert!(main.remote);
    assert!(!main.current);
    assert!(main.protected);
    assert_eq!(main.ahead, 0);
    assert_eq!(main.behind, 0);
    assert_eq!(feature.name, "feature");
    assert!(feature.remote);
    assert!(!feature.current);
    assert!(!feature.protected);
}

#[test]
fn reads_first_supported_repo_readme() {
    let repo = temp_dir("repo-readme");
    fs::write(repo.join("README.md"), "# Main\n").unwrap();
    fs::write(repo.join("README"), "# Plain\n").unwrap();

    let readme = read_repo_readme("repo", &repo).unwrap().unwrap();

    assert_eq!(readme.repo_id, "repo");
    assert_eq!(readme.path, "README.md");
    assert_eq!(readme.format, "md");
    assert_eq!(readme.content, "# Main\n");
}

#[test]
fn lists_supported_root_readmes_in_priority_order() {
    let repo = temp_dir("repo-readme-list");
    fs::create_dir_all(repo.join("docs")).unwrap();
    fs::write(repo.join("README.txt"), "Text\n").unwrap();
    fs::write(repo.join("README.unknown"), "Unknown\n").unwrap();
    fs::write(repo.join("readme.markdown"), "# Markdown\n").unwrap();
    fs::write(repo.join("README"), "Plain\n").unwrap();
    fs::write(repo.join("README.md"), "# Main\n").unwrap();
    fs::write(repo.join("README.zh-CN.md"), "# Chinese\n").unwrap();
    fs::write(repo.join("docs").join("README.md"), "# Nested\n").unwrap();

    let readmes = read_repo_readmes("repo", &repo).unwrap();
    let paths = readmes
        .iter()
        .map(|readme| readme.path.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        paths,
        vec![
            "README.md",
            "readme.markdown",
            "README",
            "README.txt",
            "README.zh-CN.md"
        ],
    );
    assert_eq!(readmes[0].content, "# Main\n");
    assert_eq!(readmes[1].format, "markdown");
    assert_eq!(readmes[2].format, "text");
}

#[test]
fn reads_repo_readme_image_data_urls() {
    let repo = temp_dir("repo-readme-images");
    fs::create_dir_all(repo.join(".github").join("assets")).unwrap();
    fs::write(
        repo.join(".github").join("assets").join("main-window.png"),
        [1_u8, 2, 3],
    )
    .unwrap();
    fs::write(
            repo.join("README.md"),
            "![window](./.github/assets/main-window.png)\n<img src='./.github/assets/main-window.png'>\n",
        )
        .unwrap();

    let readme = read_repo_readme("repo", &repo).unwrap().unwrap();

    assert_eq!(
        readme
            .images
            .get("./.github/assets/main-window.png")
            .map(String::as_str),
        Some("data:image/png;base64,AQID"),
    );
}

#[test]
fn managed_repo_ids_are_deduplicated_and_sorted() {
    let mut settings = WorkspaceSettings::default();

    add_managed_repo_id(&mut settings, "z-repo".to_string());
    add_managed_repo_id(&mut settings, "a-repo".to_string());
    add_managed_repo_id(&mut settings, "z-repo".to_string());

    assert_eq!(settings.managed_repo_ids, vec!["a-repo", "z-repo"]);
}

#[test]
fn managed_repo_paths_only_returns_visible_git_repos() {
    let root = temp_dir("managed-repos");
    let visible = root.join("visible");
    let hidden = root.join("hidden");
    let missing = root.join("missing");
    fs::create_dir_all(visible.join(".git")).unwrap();
    fs::create_dir_all(hidden.join(".git")).unwrap();
    let settings = WorkspaceSettings {
        workspace_root: Some(root.to_string_lossy().to_string()),
        hidden_repo_ids: vec!["hidden".to_string()],
        managed_repo_ids: vec![
            "visible".to_string(),
            "hidden".to_string(),
            "missing".to_string(),
        ],
        ..WorkspaceSettings::default()
    };

    let paths = managed_repo_paths(&root, &settings);

    assert_eq!(paths, vec![visible]);
    assert!(!missing.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn lightweight_managed_repos_returns_visible_repo_list_without_git_metadata() {
    let root = temp_dir("lightweight-managed-repos");
    let visible = root.join("visible");
    let hidden = root.join("hidden");
    fs::create_dir_all(visible.join(".git")).unwrap();
    fs::create_dir_all(hidden.join(".git")).unwrap();
    let settings = WorkspaceSettings {
        workspace_root: Some(root.to_string_lossy().to_string()),
        hidden_repo_ids: vec!["hidden".to_string()],
        managed_repo_ids: vec!["visible".to_string(), "hidden".to_string()],
        ..WorkspaceSettings::default()
    };

    let repos = lightweight_managed_repos(&root, &settings);

    assert_eq!(repos.len(), 1);
    assert_eq!(repos[0].id, "visible");
    assert_eq!(repos[0].name, "visible");
    assert_eq!(repos[0].current_branch, None);
    assert_eq!(repos[0].remote_url, None);
    assert_eq!(repos[0].github_full_name, None);
    assert_eq!(repos[0].ahead, 0);
    assert_eq!(repos[0].behind, 0);
    assert_eq!(repos[0].staged_count, 0);
    assert_eq!(repos[0].unstaged_count, 0);
    assert_eq!(repos[0].untracked_count, 0);
    assert_eq!(repos[0].conflict_count, 0);
    assert_eq!(repos[0].last_commit_at, None);
    assert_eq!(repos[0].last_commit_message, None);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn refresh_managed_repo_remotes_fetches_only_repos_with_origin() {
    let root = temp_dir("managed-fetch");
    let with_origin = root.join("with-origin");
    let local_only = root.join("local-only");
    init_git_repo(&with_origin);
    init_git_repo(&local_only);
    run_git(
        &with_origin,
        &["remote", "add", "origin", "https://github.com/a/repo.git"],
    );
    let paths = vec![with_origin.clone(), local_only];
    let fetched = TestMutex::new(Vec::new());

    let failures = refresh_managed_repo_remotes(&paths, |path| {
        fetched.lock().unwrap().push(repo_id(&root, path));
        Ok(())
    });

    let mut fetched = fetched.into_inner().unwrap();
    fetched.sort();
    assert!(failures.is_empty());
    assert_eq!(fetched, vec!["with-origin"]);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn refresh_managed_repo_remotes_keeps_going_after_fetch_failure() {
    let root = temp_dir("managed-fetch-failure");
    let failing = root.join("failing");
    let succeeding = root.join("succeeding");
    init_git_repo(&failing);
    init_git_repo(&succeeding);
    run_git(
        &failing,
        &[
            "remote",
            "add",
            "origin",
            "https://github.com/a/failing.git",
        ],
    );
    run_git(
        &succeeding,
        &[
            "remote",
            "add",
            "origin",
            "https://github.com/a/succeeding.git",
        ],
    );
    let paths = vec![failing.clone(), succeeding.clone()];
    let fetched = TestMutex::new(Vec::new());

    let failures = refresh_managed_repo_remotes(&paths, |path| {
        let id = repo_id(&root, path);
        fetched.lock().unwrap().push(id.clone());
        if id == "failing" {
            Err("network unavailable".to_string())
        } else {
            Ok(())
        }
    });

    let mut fetched = fetched.into_inner().unwrap();
    fetched.sort();
    assert_eq!(fetched, vec!["failing", "succeeding"]);
    assert_eq!(
        failures,
        vec![RepoFetchFailure {
            repo_name: "failing".to_string(),
            error: "network unavailable".to_string(),
        }]
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn refresh_managed_repo_remotes_starts_other_repos_while_one_fetch_is_blocked() {
    if repo_refresh_worker_count(2) < 2 {
        return;
    }

    let root = temp_dir("managed-fetch-parallel");
    let blocking = root.join("blocking");
    let other = root.join("other");
    init_git_repo(&blocking);
    init_git_repo(&other);
    run_git(
        &blocking,
        &[
            "remote",
            "add",
            "origin",
            "https://github.com/a/blocking.git",
        ],
    );
    run_git(
        &other,
        &["remote", "add", "origin", "https://github.com/a/other.git"],
    );
    let paths = vec![blocking, other];
    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let release_rx = Arc::new(TestMutex::new(release_rx));
    let root_for_fetch = root.clone();

    let handle = thread::spawn(move || {
        refresh_managed_repo_remotes(&paths, |path| {
            let id = repo_id(&root_for_fetch, path);
            started_tx.send(id.clone()).unwrap();
            if id == "blocking" {
                release_rx.lock().unwrap().recv().unwrap();
            }
            Ok(())
        })
    });

    let first = started_rx.recv_timeout(TestDuration::from_secs(1)).unwrap();
    let second = started_rx.recv_timeout(TestDuration::from_secs(1)).unwrap();
    let mut started = vec![first, second];
    started.sort();
    assert_eq!(started, vec!["blocking", "other"]);

    release_tx.send(()).unwrap();
    let failures = handle.join().unwrap();
    assert!(failures.is_empty());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn repo_refresh_task_messages_cover_success_and_partial_failure() {
    assert_eq!(
        repo_refresh_success_message(2),
        "已刷新 2 个仓库并同步远端状态"
    );

    let failures = vec![RepoFetchFailure {
        repo_name: "repo".to_string(),
        error: "network unavailable".to_string(),
    }];
    assert_eq!(
        repo_refresh_partial_failure_message(3, &failures),
        "已刷新 3 个仓库，1 个仓库 fetch 失败：repo（network unavailable）"
    );
}

#[test]
fn infers_tauri_dev_script_first() {
    let path = temp_dir("tauri-dev");
    fs::create_dir_all(path.join("src-tauri")).unwrap();
    write_package(
        &path,
        r#"{
              "packageManager": "yarn@4.14.1",
              "scripts": {
                "dev": "vite",
                "tauri:dev": "tauri dev"
              }
            }"#,
    );

    let config = infer_launch_config(&path).unwrap();
    assert_eq!(config.command, "yarn tauri:dev");
    assert_eq!(config.source, "inferred");
    fs::remove_dir_all(path).unwrap();
}

#[test]
fn infers_js_script_by_lockfile_and_priority() {
    let path = temp_dir("js-dev");
    fs::write(path.join("pnpm-lock.yaml"), "").unwrap();
    write_package(
        &path,
        r#"{
              "scripts": {
                "start": "vite --host",
                "serve": "vite preview"
              }
            }"#,
    );

    let config = infer_launch_config(&path).unwrap();
    assert_eq!(config.command, "pnpm start");
    fs::remove_dir_all(path).unwrap();
}

#[test]
fn infers_npm_dev_and_cargo_fallback() {
    let js_path = temp_dir("npm-dev");
    write_package(
        &js_path,
        r#"{
              "scripts": {
                "dev": "vite"
              }
            }"#,
    );
    assert_eq!(
        infer_launch_config(&js_path).unwrap().command,
        "npm run dev"
    );
    fs::remove_dir_all(js_path).unwrap();

    let cargo_path = temp_dir("cargo");
    fs::write(
        cargo_path.join("Cargo.toml"),
        "[package]\nname = \"demo\"\n",
    )
    .unwrap();
    assert_eq!(
        infer_launch_config(&cargo_path).unwrap().command,
        "cargo run"
    );
    fs::remove_dir_all(cargo_path).unwrap();
}

#[test]
fn returns_none_without_known_launch_entrypoint() {
    let path = temp_dir("no-entrypoint");
    assert!(infer_launch_config(&path).is_none());
    fs::remove_dir_all(path).unwrap();
}

#[test]
fn clears_launch_logs_for_one_repo() {
    let repo_id = format!("repo-{}", now_millis());
    let other_repo_id = format!("other-repo-{}", now_millis());
    push_launch_log(&repo_id, "stdout", "old output");
    push_launch_log(&other_repo_id, "stdout", "kept output");

    clear_launch_logs(&repo_id);

    let logs = launch_logs().lock().unwrap_or_else(|e| e.into_inner());
    assert!(logs.get(&repo_id).is_none());
    assert_eq!(logs.get(&other_repo_id).unwrap().len(), 1);
    drop(logs);
    clear_launch_logs(&other_repo_id);
}

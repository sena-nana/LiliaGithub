use super::bulk::*;
use super::github::*;
use super::launch::*;
use super::*;
use std::io::Write;
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
        fs::read_to_string(path.join("app.ts"))
            .unwrap()
            .replace("\r\n", "\n"),
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
fn pull_local_changes_stash_cleans_and_restores_worktree() {
    let path = temp_dir("pull-stash-local-changes");
    init_git_repo(&path);
    fs::write(path.join("tracked.ts"), "tracked\n").unwrap();
    run_git(&path, &["add", "tracked.ts"]);
    run_git(&path, &["commit", "-m", "initial"]);
    fs::write(path.join("tracked.ts"), "changed\n").unwrap();
    fs::write(path.join("scratch.ts"), "scratch\n").unwrap();

    let summary = summarize_repo(&path, &path);
    let local_changes = prepare_pull_local_changes(
        &path,
        &summary,
        Some(RepoPullLocalChangesMode::Stash),
        "pull",
    )
    .unwrap();

    assert!(repo_status_entries(&path).is_empty());
    restore_pull_local_changes(&path, local_changes).unwrap();
    let entries = repo_status_entries(&path);
    assert!(entries.iter().any(|entry| entry.path == "tracked.ts"));
    assert!(entries.iter().any(|entry| entry.path == "scratch.ts"));
    assert_eq!(
        fs::read_to_string(path.join("tracked.ts"))
            .unwrap()
            .replace("\r\n", "\n"),
        "changed\n"
    );
}

#[test]
fn pull_local_changes_discard_removes_tracked_staged_and_untracked_but_keeps_ignored() {
    let path = temp_dir("pull-discard-local-changes");
    init_git_repo(&path);
    fs::write(path.join(".gitignore"), "ignored.log\n").unwrap();
    fs::write(path.join("tracked.ts"), "tracked\n").unwrap();
    fs::write(path.join("staged.ts"), "staged\n").unwrap();
    run_git(&path, &["add", ".gitignore", "tracked.ts", "staged.ts"]);
    run_git(&path, &["commit", "-m", "initial"]);
    fs::write(path.join("tracked.ts"), "changed\n").unwrap();
    fs::write(path.join("staged.ts"), "changed staged\n").unwrap();
    run_git(&path, &["add", "staged.ts"]);
    fs::write(path.join("scratch.ts"), "scratch\n").unwrap();
    fs::write(path.join("ignored.log"), "ignored\n").unwrap();

    discard_all_repo_local_changes(&path).unwrap();

    assert_eq!(
        fs::read_to_string(path.join("tracked.ts"))
            .unwrap()
            .replace("\r\n", "\n"),
        "tracked\n"
    );
    assert_eq!(
        fs::read_to_string(path.join("staged.ts"))
            .unwrap()
            .replace("\r\n", "\n"),
        "staged\n"
    );
    assert!(!path.join("scratch.ts").exists());
    assert!(path.join("ignored.log").exists());
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
        vec!["logs/output.log".to_string(), "logs/output.log".to_string()],
    )
    .unwrap();

    assert_eq!(
        fs::read_to_string(path.join(".gitignore")).unwrap(),
        "logs/output.log\n"
    );
}

#[test]
fn repo_changes_include_untracked_file_diff() {
    let path = temp_dir("untracked-diff");
    init_git_repo(&path);
    fs::write(path.join("tracked.ts"), "tracked\n").unwrap();
    run_git(&path, &["add", "tracked.ts"]);
    run_git(&path, &["commit", "-m", "initial"]);
    fs::create_dir_all(path.join("src")).unwrap();
    fs::write(
        path.join("src").join("new.ts"),
        "export const added = true;\n",
    )
    .unwrap();

    let changes = repo_changes(&path);
    let change = changes
        .iter()
        .find(|change| change.path == "src/new.ts")
        .expect("untracked file should be listed");

    assert!(change.untracked);
    assert!(change.diff.contains("diff --git a/src/new.ts b/src/new.ts"));
    assert!(change.diff.contains("--- /dev/null"));
    assert!(change.diff.contains("+++ b/src/new.ts"));
    assert!(change.diff.contains("+export const added = true;"));
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
        language_stats_updated_at: 0,
        worktree: RepoWorktree {
            role: "standalone".to_string(),
            shared_repo_key: "repo:repo".to_string(),
            main_repo_id: None,
        },
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
fn github_repo_management_maps_license() {
    let management = github_repo_management_from_response(
        GitHubRepoResponse {
            id: 1,
            name: "repo".to_string(),
            full_name: "a/repo".to_string(),
            private: false,
            disabled: false,
            archived: false,
            description: Some("Repository".to_string()),
            default_branch: Some("main".to_string()),
            created_at: "2026-06-18T08:00:00Z".to_string(),
            updated_at: "2026-06-18T08:00:00Z".to_string(),
            clone_url: "https://github.com/a/repo.git".to_string(),
            html_url: "https://github.com/a/repo".to_string(),
            owner: GitHubRepoOwnerResponse {
                login: "a".to_string(),
            },
            homepage: None,
            has_issues: true,
            has_wiki: false,
            has_projects: true,
            has_discussions: false,
            allow_merge_commit: true,
            allow_squash_merge: true,
            allow_rebase_merge: true,
            allow_auto_merge: false,
            delete_branch_on_merge: false,
            allow_forking: true,
            web_commit_signoff_required: false,
            stargazers_count: 78,
            subscribers_count: 2,
            forks_count: 16,
            license: Some(GitHubRepoLicenseResponse {
                key: "bsd-3-clause".to_string(),
                name: "BSD 3-Clause \"New\" or \"Revised\" License".to_string(),
                spdx_id: Some("BSD-3-Clause".to_string()),
                url: Some("https://api.github.com/licenses/bsd-3-clause".to_string()),
            }),
        },
        vec!["tauri".to_string()],
    );

    assert_eq!(
        management.license.unwrap().spdx_id.as_deref(),
        Some("BSD-3-Clause")
    );
}

#[test]
fn maps_github_discussion_timeline_items() {
    let comment = github_timeline_item_from_response(GitHubIssueTimelineResponse {
        id: Some(serde_json::json!(42)),
        node_id: None,
        event: Some("commented".to_string()),
        actor: None,
        user: Some(GitHubAssigneeResponse {
            login: "mika".to_string(),
        }),
        body: Some("**Confirmed**".to_string()),
        html_url: Some("https://github.com/a/repo/issues/1#issuecomment-42".to_string()),
        created_at: Some("2026-06-18T08:01:00Z".to_string()),
        updated_at: Some("2026-06-18T08:02:00Z".to_string()),
        source: None,
        commit_id: None,
    });
    assert_eq!(comment.kind, "comment");
    assert_eq!(comment.id, "42");
    assert_eq!(comment.actor.as_deref(), Some("mika"));
    assert_eq!(comment.body.as_deref(), Some("**Confirmed**"));

    let event = github_timeline_item_from_response(GitHubIssueTimelineResponse {
        id: None,
        node_id: Some("E_closed".to_string()),
        event: Some("closed".to_string()),
        actor: Some(GitHubAssigneeResponse {
            login: "sena".to_string(),
        }),
        user: None,
        body: None,
        html_url: None,
        created_at: Some("2026-06-18T08:03:00Z".to_string()),
        updated_at: None,
        source: None,
        commit_id: None,
    });
    assert_eq!(event.kind, "event");
    assert_eq!(event.title.as_deref(), Some("关闭了讨论"));
    assert_eq!(event.event.as_deref(), Some("closed"));

    let unknown = github_timeline_item_from_response(GitHubIssueTimelineResponse {
        id: Some(serde_json::json!("custom-id")),
        node_id: None,
        event: Some("custom_event".to_string()),
        actor: None,
        user: None,
        body: None,
        html_url: None,
        created_at: Some("2026-06-18T08:04:00Z".to_string()),
        updated_at: None,
        source: None,
        commit_id: None,
    });
    assert_eq!(unknown.kind, "event");
    assert_eq!(unknown.title.as_deref(), Some("custom event"));

    let review = github_review_timeline_item_from_response(GitHubPullRequestReviewResponse {
        id: 7,
        user: Some(GitHubPullRequestUserResponse {
            login: "reviewer".to_string(),
        }),
        body: Some("LGTM".to_string()),
        state: "APPROVED".to_string(),
        html_url: Some("https://github.com/a/repo/pull/1#pullrequestreview-7".to_string()),
        submitted_at: Some("2026-06-18T08:05:00Z".to_string()),
        commit_id: Some("abc123".to_string()),
    });
    assert_eq!(review.kind, "review");
    assert_eq!(review.state.as_deref(), Some("APPROVED"));
    assert_eq!(review.commit_id.as_deref(), Some("abc123"));

    let review_comment =
        github_review_comment_timeline_item_from_response(GitHubPullRequestReviewCommentResponse {
            id: 8,
            user: Some(GitHubPullRequestUserResponse {
                login: "reviewer".to_string(),
            }),
            body: Some("Inline note".to_string()),
            html_url: Some("https://github.com/a/repo/pull/1#discussion_r8".to_string()),
            path: Some("src/lib.rs".to_string()),
            line: Some(12),
            original_line: Some(10),
            commit_id: Some("def456".to_string()),
            created_at: "2026-06-18T08:06:00Z".to_string(),
            updated_at: Some("2026-06-18T08:07:00Z".to_string()),
        });
    assert_eq!(review_comment.kind, "reviewComment");
    assert_eq!(review_comment.path.as_deref(), Some("src/lib.rs"));
    assert_eq!(review_comment.line, Some(12));
}

#[test]
fn maps_github_development_items_from_timeline() {
    let items = github_development_items_from_timeline(
        "sena-nana/remote-repo",
        &[
            GitHubIssueTimelineResponse {
                id: Some(serde_json::json!(1)),
                node_id: None,
                event: Some("cross-referenced".to_string()),
                actor: None,
                user: None,
                body: None,
                html_url: None,
                created_at: Some("2026-06-18T08:00:00Z".to_string()),
                updated_at: None,
                source: Some(GitHubIssueTimelineSourceResponse {
                    issue: Some(GitHubIssueTimelineSourceIssueResponse {
                        number: 12,
                        title: "关联问题".to_string(),
                        state: "open".to_string(),
                        html_url: "https://github.com/sena-nana/remote-repo/issues/12".to_string(),
                        pull_request: None,
                    }),
                }),
                commit_id: None,
            },
            GitHubIssueTimelineResponse {
                id: Some(serde_json::json!(2)),
                node_id: None,
                event: Some("referenced".to_string()),
                actor: None,
                user: None,
                body: None,
                html_url: None,
                created_at: Some("2026-06-18T08:01:00Z".to_string()),
                updated_at: None,
                source: None,
                commit_id: Some("abcdef1234567890".to_string()),
            },
        ],
    );

    assert_eq!(items.len(), 2);
    assert_eq!(items[0].kind, "issue");
    assert_eq!(items[0].label, "Issue #12 关联问题");
    assert_eq!(
        items[0].repository_full_name.as_deref(),
        Some("sena-nana/remote-repo")
    );
    assert_eq!(items[1].kind, "commit");
    assert_eq!(items[1].sha.as_deref(), Some("abcdef1234567890"));
}

#[test]
fn maps_github_pull_request_reviewers() {
    let mut reviewers =
        github_pull_request_reviewers_from_requested(GitHubRequestedReviewersResponse {
            users: vec![GitHubPullRequestUserResponse {
                login: "mika".to_string(),
            }],
            teams: vec![GitHubTeamResponse {
                slug: Some("core".to_string()),
                name: Some("Core".to_string()),
            }],
        });
    add_pull_request_reviewers_from_reviews(
        &mut reviewers,
        &[GitHubPullRequestReviewResponse {
            id: 42,
            user: Some(GitHubPullRequestUserResponse {
                login: "mika".to_string(),
            }),
            body: None,
            state: "APPROVED".to_string(),
            html_url: None,
            submitted_at: Some("2026-06-18T08:00:00Z".to_string()),
            commit_id: None,
        }],
    );

    assert_eq!(reviewers.len(), 2);
    assert_eq!(reviewers[0].login, "mika");
    assert_eq!(reviewers[0].state, "APPROVED");
    assert_eq!(reviewers[1].login, "core");
    assert_eq!(reviewers[1].kind, "team");
    assert_eq!(reviewers[1].state, "requested");
}

#[test]
fn sorts_github_discussion_timeline_by_time_then_id() {
    let mut items = vec![
        GitHubDiscussionTimelineItem {
            id: "b".to_string(),
            kind: "event".to_string(),
            actor: None,
            body: None,
            url: None,
            event: Some("closed".to_string()),
            state: None,
            title: None,
            path: None,
            line: None,
            original_line: None,
            commit_id: None,
            created_at: "2026-06-18T08:02:00Z".to_string(),
            updated_at: None,
        },
        GitHubDiscussionTimelineItem {
            id: "a".to_string(),
            kind: "comment".to_string(),
            actor: None,
            body: Some("same time".to_string()),
            url: None,
            event: None,
            state: None,
            title: None,
            path: None,
            line: None,
            original_line: None,
            commit_id: None,
            created_at: "2026-06-18T08:02:00Z".to_string(),
            updated_at: None,
        },
        GitHubDiscussionTimelineItem {
            id: "body".to_string(),
            kind: "body".to_string(),
            actor: None,
            body: Some("first".to_string()),
            url: None,
            event: None,
            state: None,
            title: None,
            path: None,
            line: None,
            original_line: None,
            commit_id: None,
            created_at: "2026-06-18T08:00:00Z".to_string(),
            updated_at: None,
        },
    ];

    sort_github_discussion_timeline(&mut items);

    assert_eq!(
        items.into_iter().map(|item| item.id).collect::<Vec<_>>(),
        vec!["body", "a", "b"]
    );
}

fn test_github_issue(number: u64, state: &str) -> GitHubIssue {
    GitHubIssue {
        number,
        title: format!("Issue {number}"),
        state: state.to_string(),
        body: None,
        labels: Vec::new(),
        assignees: Vec::new(),
        author: Some("sena".to_string()),
        milestone: None,
        comments: 0,
        project_items: Vec::new(),
        development_items: Vec::new(),
        html_url: format!("https://github.com/a/repo/issues/{number}"),
        updated_at: "2026-06-18T08:00:00Z".to_string(),
        created_at: "2026-06-18T08:00:00Z".to_string(),
    }
}

fn test_github_pull_request(number: u64, state: &str) -> GitHubPullRequest {
    GitHubPullRequest {
        number,
        title: format!("PR {number}"),
        state: state.to_string(),
        draft: false,
        body: None,
        html_url: format!("https://github.com/a/repo/pull/{number}"),
        updated_at: "2026-06-18T08:00:00Z".to_string(),
        created_at: "2026-06-18T08:00:00Z".to_string(),
        author: "sena".to_string(),
        labels: Vec::new(),
        assignees: Vec::new(),
        milestone: None,
        comments: 0,
        project_items: Vec::new(),
        reviewers: Vec::new(),
        development_items: Vec::new(),
        commit_count: None,
        base_branch: "main".to_string(),
        head_branch: "feature/cache".to_string(),
        merged: false,
        mergeable: Some(true),
        mergeable_state: Some("clean".to_string()),
    }
}

fn test_github_pull_request_cache_key(state: Option<&str>) -> String {
    github_pull_request_cache_key(
        state, None, None, None, None, None, None, None, None, None, None,
    )
}

fn test_github_release(id: u64, tag_name: &str) -> GitHubRelease {
    GitHubRelease {
        id,
        tag_name: tag_name.to_string(),
        target_commitish: "main".to_string(),
        name: Some(format!("Release {tag_name}")),
        body: Some("Release notes".to_string()),
        draft: false,
        prerelease: false,
        immutable: false,
        make_latest: Some("true".to_string()),
        html_url: format!("https://github.com/sena-nana/remote/releases/tag/{tag_name}"),
        upload_url: format!(
            "https://uploads.github.com/repos/sena-nana/remote/releases/{id}/assets{{?name,label}}"
        ),
        tarball_url: None,
        zipball_url: None,
        created_at: "2026-06-18T08:00:00Z".to_string(),
        published_at: Some("2026-06-18T08:05:00Z".to_string()),
        author: Some("sena".to_string()),
        assets: vec![GitHubReleaseAsset {
            id: id + 1000,
            name: "lilia-windows.zip".to_string(),
            label: Some("Windows".to_string()),
            content_type: "application/zip".to_string(),
            size: 2048,
            download_count: 3,
            state: "uploaded".to_string(),
            browser_download_url: format!(
                "https://github.com/sena-nana/remote/releases/download/{tag_name}/lilia-windows.zip"
            ),
            created_at: "2026-06-18T08:10:00Z".to_string(),
            updated_at: "2026-06-18T08:10:00Z".to_string(),
            uploader: Some("mika".to_string()),
        }],
    }
}

#[test]
fn github_project_cache_keys_are_normalized_and_parameterized() {
    assert_eq!(
        github_project_cache_repo_key("https://github.com/Sena-Nana/Remote.git").unwrap(),
        "sena-nana/remote"
    );
    let labels = vec!["bug".to_string(), "docs".to_string()];
    let key: serde_json::Value = serde_json::from_str(&github_issue_cache_key(
        Some("closed"),
        Some(200),
        Some("updated"),
        Some("asc"),
        Some(" 2026-01-01T00:00:00Z "),
        Some("sena"),
        Some("mika"),
        Some(&labels),
        Some("1"),
        Some("PVT_roadmap"),
        Some(" roadmap "),
    ))
    .unwrap();
    assert_eq!(
        key,
        serde_json::json!({
            "state": "closed",
            "perPage": 100,
            "sort": "updated",
            "direction": "asc",
            "since": "2026-01-01T00:00:00Z",
            "creator": "sena",
            "assignee": "mika",
            "labels": ["bug", "docs"],
            "milestone": "1",
            "project": "PVT_roadmap",
            "query": "roadmap",
        })
    );
    let fallback_key: serde_json::Value = serde_json::from_str(&github_issue_cache_key(
        None,
        None,
        Some("invalid"),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    ))
    .unwrap();
    assert_eq!(fallback_key["state"], "open");
    assert_eq!(fallback_key["sort"], "created");
    assert_eq!(fallback_key["direction"], "desc");
    let pull_key: serde_json::Value = serde_json::from_str(&github_pull_request_cache_key(
        Some("merged"),
        Some(250),
        Some("comments"),
        Some("asc"),
        Some("sena"),
        Some("none"),
        Some(&labels),
        Some("2"),
        Some("PVT_prs"),
        Some("approved"),
        Some(" docs "),
    ))
    .unwrap();
    assert_eq!(
        pull_key,
        serde_json::json!({
            "state": "merged",
            "perPage": 100,
            "sort": "comments",
            "direction": "asc",
            "creator": "sena",
            "assignee": "none",
            "labels": ["bug", "docs"],
            "milestone": "2",
            "project": "PVT_prs",
            "review": "approved",
            "query": "docs",
        })
    );
    let fallback_pull_key: serde_json::Value =
        serde_json::from_str(&github_pull_request_cache_key(
            Some("invalid"),
            None,
            Some("invalid"),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        ))
        .unwrap();
    assert_eq!(fallback_pull_key["state"], "open");
    assert_eq!(fallback_pull_key["sort"], "updated");
    assert_eq!(fallback_pull_key["direction"], "desc");
    assert_eq!(github_workflow_runs_cache_key(Some(0)), "1");
    assert_eq!(github_workflow_runs_cache_key(Some(200)), "100");
}

#[test]
fn github_release_response_maps_release_and_assets() {
    let release = github_release_from_response(GitHubReleaseResponse {
        id: 8001,
        tag_name: "v1.0.0".to_string(),
        target_commitish: Some(" main ".to_string()),
        name: Some(" Lilia v1.0.0 ".to_string()),
        body: Some(" Release notes ".to_string()),
        draft: false,
        prerelease: false,
        immutable: true,
        make_latest: Some("true".to_string()),
        html_url: "https://github.com/sena-nana/remote/releases/tag/v1.0.0".to_string(),
        upload_url:
            "https://uploads.github.com/repos/sena-nana/remote/releases/8001/assets{?name,label}"
                .to_string(),
        tarball_url: Some(" ".to_string()),
        zipball_url: Some(
            "https://api.github.com/repos/sena-nana/remote/zipball/v1.0.0".to_string(),
        ),
        created_at: "2026-06-18T08:00:00Z".to_string(),
        published_at: Some("2026-06-18T08:05:00Z".to_string()),
        author: Some(GitHubReleaseUserResponse {
            login: "sena".to_string(),
        }),
        assets: vec![GitHubReleaseAssetResponse {
            id: 9001,
            name: "lilia-windows.zip".to_string(),
            label: Some(" Windows ".to_string()),
            content_type: Some(" ".to_string()),
            size: 2048,
            download_count: 7,
            state: Some(" ".to_string()),
            browser_download_url:
                "https://github.com/sena-nana/remote/releases/download/v1.0.0/lilia-windows.zip"
                    .to_string(),
            created_at: "2026-06-18T08:10:00Z".to_string(),
            updated_at: "2026-06-18T08:11:00Z".to_string(),
            uploader: Some(GitHubReleaseUserResponse {
                login: "mika".to_string(),
            }),
        }],
    });

    assert_eq!(release.tag_name, "v1.0.0");
    assert_eq!(release.target_commitish, "main");
    assert_eq!(release.name.as_deref(), Some("Lilia v1.0.0"));
    assert_eq!(release.body.as_deref(), Some("Release notes"));
    assert!(release.immutable);
    assert_eq!(release.make_latest.as_deref(), Some("true"));
    assert_eq!(release.tarball_url, None);
    assert_eq!(release.author.as_deref(), Some("sena"));
    assert_eq!(release.assets[0].content_type, "application/octet-stream");
    assert_eq!(release.assets[0].state, "uploaded");
    assert_eq!(release.assets[0].uploader.as_deref(), Some("mika"));
}

#[test]
fn github_release_asset_upload_helpers_validate_paths_and_size() {
    assert_eq!(
        github_release_upload_base_url(
            "https://uploads.github.com/repos/sena-nana/remote/releases/8001/assets{?name,label}"
        )
        .unwrap(),
        "https://uploads.github.com/repos/sena-nana/remote/releases/8001/assets"
    );
    assert!(github_release_upload_base_url("  ").is_err());

    let asset_path = Path::new("release").join("lilia.zip");
    assert_eq!(
        github_release_asset_name(&asset_path.to_string_lossy()).unwrap(),
        "lilia.zip"
    );
    assert!(github_release_asset_name("").is_err());
    assert!(github_release_validate_asset_file_size(GITHUB_RELEASE_ASSET_MAX_BYTES).is_ok());
    assert!(github_release_validate_asset_file_size(GITHUB_RELEASE_ASSET_MAX_BYTES + 1).is_err());

    let dir = temp_dir("github-release-asset-bytes");
    assert!(github_release_asset_bytes(&dir.to_string_lossy()).is_err());
    let file = dir.join("asset.bin");
    fs::write(&file, b"asset").unwrap();
    assert_eq!(
        github_release_asset_bytes(&file.to_string_lossy()).unwrap(),
        b"asset"
    );
    assert!(github_release_asset_bytes(&dir.join("missing.bin").to_string_lossy()).is_err());
}

#[test]
fn github_artifact_release_asset_helpers_validate_zip_entry_and_release_target() {
    let dir = temp_dir("github-artifact-release-asset");
    let zip_path = dir.join("artifact.zip");
    let file = fs::File::create(&zip_path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("packages/Lilia_1.1.0_x64.msi", options)
        .unwrap();
    zip.write_all(b"installer").unwrap();
    zip.add_directory("packages/empty/", options).unwrap();
    zip.finish().unwrap();

    let (entry_path, bytes) =
        github_artifact_file_bytes_from_zip(&zip_path, "\\packages\\Lilia_1.1.0_x64.msi").unwrap();
    assert_eq!(entry_path, "packages/Lilia_1.1.0_x64.msi");
    assert_eq!(bytes.len(), 9);
    assert_eq!(bytes, b"installer");
    assert!(github_artifact_file_bytes_from_zip(&zip_path, "../secret.msi").is_err());
    assert!(github_artifact_file_bytes_from_zip(&zip_path, "packages/empty").is_err());
    assert!(github_artifact_file_bytes_from_zip(&zip_path, "missing.msi").is_err());

    let mut release = GitHubRelease {
        id: 8001,
        tag_name: "v1.1.0".to_string(),
        target_commitish: "main".to_string(),
        name: Some("Draft".to_string()),
        body: None,
        draft: true,
        prerelease: false,
        immutable: false,
        make_latest: None,
        html_url: "https://github.com/sena-nana/remote/releases/tag/v1.1.0".to_string(),
        upload_url:
            "https://uploads.github.com/repos/sena-nana/remote/releases/8001/assets{?name,label}"
                .to_string(),
        tarball_url: None,
        zipball_url: None,
        created_at: "2026-06-18T08:00:00Z".to_string(),
        published_at: None,
        author: Some("sena".to_string()),
        assets: vec![],
    };
    assert!(
        github_validate_release_for_artifact_asset(&release, "v1.1.0", "Lilia_1.1.0_x64.msi")
            .is_ok()
    );
    assert!(
        github_validate_release_for_artifact_asset(&release, "v1.2.0", "Lilia_1.1.0_x64.msi")
            .is_err()
    );
    release.draft = false;
    assert!(
        github_validate_release_for_artifact_asset(&release, "v1.1.0", "Lilia_1.1.0_x64.msi")
            .is_err()
    );
    release.draft = true;
    release.assets.push(GitHubReleaseAsset {
        id: 9001,
        name: "Lilia_1.1.0_x64.msi".to_string(),
        label: Some("Windows".to_string()),
        content_type: "application/octet-stream".to_string(),
        size: 9,
        download_count: 0,
        state: "uploaded".to_string(),
        browser_download_url:
            "https://github.com/sena-nana/remote/releases/download/v1.1.0/Lilia_1.1.0_x64.msi"
                .to_string(),
        created_at: "2026-06-18T08:00:00Z".to_string(),
        updated_at: "2026-06-18T08:00:00Z".to_string(),
        uploader: Some("sena".to_string()),
    });
    assert!(
        github_validate_release_for_artifact_asset(&release, "v1.1.0", "Lilia_1.1.0_x64.msi")
            .is_err()
    );
}

#[test]
fn github_pull_request_search_query_includes_pr_review_and_merge_qualifiers() {
    let labels = vec!["needs triage".to_string(), "bug".to_string()];
    let query = github_pull_request_search_query(
        "Sena-Nana/Remote",
        "merged",
        "dashboard",
        Some("sena"),
        Some("none"),
        Some(&labels),
        Some("v1"),
        Some("approved"),
    );

    assert!(query.contains("repo:Sena-Nana/Remote"));
    assert!(query.contains("is:pr"));
    assert!(query.contains("is:merged"));
    assert!(query.contains("dashboard"));
    assert!(query.contains("author:sena"));
    assert!(query.contains("no:assignee"));
    assert!(query.contains("label:\"needs triage\""));
    assert!(query.contains("label:bug"));
    assert!(query.contains("milestone:v1"));
    assert!(query.contains("review:approved"));

    let closed_query =
        github_pull_request_search_query("a/repo", "closed", "", None, None, None, None, None);
    assert!(closed_query.contains("state:closed"));
    assert!(closed_query.contains("-is:merged"));
}

#[test]
fn github_pull_request_search_required_only_for_advanced_filters() {
    assert!(!github_pull_request_search_required(
        "all", "updated", None, None, None, None, None, None, None
    ));
    assert!(!github_pull_request_search_required(
        "open",
        "created",
        Some("  "),
        None,
        Some(&[" ".to_string()]),
        None,
        None,
        None,
        None,
    ));
    assert!(github_pull_request_search_required(
        "merged", "updated", None, None, None, None, None, None, None
    ));
    assert!(github_pull_request_search_required(
        "closed", "updated", None, None, None, None, None, None, None
    ));
    assert!(github_pull_request_search_required(
        "open", "comments", None, None, None, None, None, None, None,
    ));
    assert!(github_pull_request_search_required(
        "open",
        "updated",
        None,
        None,
        Some(&["bug".to_string()]),
        None,
        None,
        None,
        None,
    ));
    assert!(github_pull_request_search_required(
        "open",
        "updated",
        None,
        None,
        None,
        None,
        None,
        Some("approved"),
        None,
    ));
}

#[test]
fn github_project_cache_serializes_distinct_query_buckets() {
    let mut cache = GitHubProjectCache::default();
    let repo_cache = cache
        .repos
        .entry("sena-nana/remote".to_string())
        .or_default();
    repo_cache.issues.insert(
        github_issue_cache_key(
            Some("open"),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        ),
        vec![test_github_issue(1, "open")],
    );
    repo_cache.issues.insert(
        github_issue_cache_key(
            Some("closed"),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        ),
        vec![test_github_issue(2, "closed")],
    );
    repo_cache.pull_requests.insert(
        test_github_pull_request_cache_key(Some("open")),
        vec![test_github_pull_request(3, "open")],
    );
    repo_cache.pull_requests.insert(
        test_github_pull_request_cache_key(Some("all")),
        vec![test_github_pull_request(4, "closed")],
    );
    repo_cache.releases = Some(vec![test_github_release(5, "v1.0.0")]);

    let value = serde_json::to_value(&cache).unwrap();
    let restored: GitHubProjectCache = serde_json::from_value(value).unwrap();
    let restored_repo = restored.repos.get("sena-nana/remote").unwrap();

    assert_eq!(
        restored_repo.issues[&github_issue_cache_key(
            Some("open"),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None
        )][0]
            .number,
        1
    );
    assert_eq!(
        restored_repo.issues[&github_issue_cache_key(
            Some("closed"),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None
        )][0]
            .number,
        2
    );
    assert_eq!(
        restored_repo.pull_requests[&test_github_pull_request_cache_key(Some("open"))][0].number,
        3
    );
    assert_eq!(
        restored_repo.pull_requests[&test_github_pull_request_cache_key(Some("all"))][0].number,
        4
    );
    assert_eq!(
        restored_repo.releases.as_ref().unwrap()[0].tag_name,
        "v1.0.0"
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
                lines: 1,
            },
            LanguageStat {
                language: "Vue".to_string(),
                bytes: 25,
                lines: 1,
            },
        ]
    );
    fs::remove_dir_all(path).unwrap();
}

fn commit_with_author(path: &Path, file: &str, body: &str, message: &str, name: &str, email: &str) {
    fs::write(path.join(file), body).unwrap();
    run_git(path, &["add", file]);
    run_git(
        path,
        &[
            "-c",
            &format!("user.name={name}"),
            "-c",
            &format!("user.email={email}"),
            "commit",
            "-m",
            message,
        ],
    );
}

#[test]
fn local_contribution_counts_use_configured_author_identities() {
    let path = temp_dir("local-contribution-identities");
    init_git_repo(&path);
    commit_with_author(
        &path,
        "mine.txt",
        "mine\n",
        "mine",
        "Lilia User",
        "lilia@example.com",
    );
    commit_with_author(
        &path,
        "other.txt",
        "other\n",
        "other",
        "Other User",
        "other@example.com",
    );

    let end_day_index = current_utc_day_index();
    let start_day_index = end_day_index - 2;
    let mut counts = HashMap::new();
    collect_local_contribution_counts(
        &path,
        start_day_index,
        end_day_index,
        &[
            ContributionIdentity {
                name: None,
                email: Some("lilia@example.com".to_string()),
            },
            ContributionIdentity {
                name: Some("Legacy Lilia".to_string()),
                email: None,
            },
        ],
        &mut counts,
    )
    .unwrap();

    assert_eq!(counts.values().sum::<usize>(), 1);
    fs::remove_dir_all(path).unwrap();
}

#[test]
fn local_contribution_identities_fall_back_to_repo_git_config() {
    let path = temp_dir("local-contribution-git-config");
    init_git_repo(&path);
    commit_with_author(
        &path,
        "mine.txt",
        "mine\n",
        "mine",
        "Test User",
        "test@example.com",
    );
    commit_with_author(
        &path,
        "other.txt",
        "other\n",
        "other",
        "Other User",
        "other@example.com",
    );

    let identities = local_contribution_identities(&path, &WorkspaceSettings::default());
    let end_day_index = current_utc_day_index();
    let start_day_index = end_day_index - 2;
    let mut counts = HashMap::new();
    collect_local_contribution_counts(
        &path,
        start_day_index,
        end_day_index,
        &identities,
        &mut counts,
    )
    .unwrap();

    assert_eq!(identities.len(), 1);
    assert_eq!(counts.values().sum::<usize>(), 1);
    fs::remove_dir_all(path).unwrap();
}

#[test]
fn local_contribution_identities_include_repo_git_config_with_configured_identities() {
    let path = temp_dir("local-contribution-git-config-and-settings");
    init_git_repo(&path);
    commit_with_author(
        &path,
        "mine.txt",
        "mine\n",
        "mine",
        "Test User",
        "test@example.com",
    );
    commit_with_author(
        &path,
        "legacy.txt",
        "legacy\n",
        "legacy",
        "Legacy Lilia",
        "legacy@example.com",
    );
    commit_with_author(
        &path,
        "other.txt",
        "other\n",
        "other",
        "Other User",
        "other@example.com",
    );
    let settings = WorkspaceSettings {
        contribution_identities: vec![ContributionIdentity {
            name: Some("Legacy Lilia".to_string()),
            email: None,
        }],
        ..WorkspaceSettings::default()
    };

    let identities = local_contribution_identities(&path, &settings);
    let end_day_index = current_utc_day_index();
    let start_day_index = end_day_index - 2;
    let mut counts = HashMap::new();
    collect_local_contribution_counts(
        &path,
        start_day_index,
        end_day_index,
        &identities,
        &mut counts,
    )
    .unwrap();

    assert_eq!(counts.values().sum::<usize>(), 2);
    fs::remove_dir_all(path).unwrap();
}

#[test]
fn contribution_identity_matching_accepts_name_or_email() {
    assert!(contribution_identity_matches(
        &[ContributionIdentity {
            name: Some("Same Name".to_string()),
            email: Some("lilia@example.com".to_string()),
        },],
        "Different Name",
        "lilia@example.com",
    ));
    assert!(contribution_identity_matches(
        &[ContributionIdentity {
            name: Some("Same Name".to_string()),
            email: Some("lilia@example.com".to_string()),
        },],
        "Same Name",
        "other@example.com",
    ));
}

#[test]
fn github_contribution_result_marks_repo_without_identity_as_skipped() {
    let end_day_index = parse_github_datetime("2026-06-11T12:00:00Z").unwrap() / 86_400;
    let result = github_contribution_result(&HashMap::new(), end_day_index, 0, 1, 1);

    assert_eq!(result.meta.repo_count, 0);
    assert_eq!(result.meta.requested_repo_count, 1);
    assert_eq!(result.meta.skipped_repo_count, 1);
    assert!(result.days.iter().all(|day| day.count == 0));
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
fn github_contribution_day_deserializes_without_repository_details() {
    let day: GitHubContributionDay =
        serde_json::from_str(r#"{"date":"2026-06-11","count":3}"#).unwrap();

    assert_eq!(day.date, "2026-06-11");
    assert_eq!(day.count, 3);
    assert!(day.repositories.is_empty());
}

#[test]
fn converts_civil_dates_for_github_contributions() {
    let day = shared::days_from_civil(2026, 6, 11);
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
        parse_status_snapshot(" M src/main.ts\0R  new.ts\0old.ts\0").entries,
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
fn parses_status_snapshot_header_and_entries() {
    let snapshot = parse_status_snapshot(
        "## main...origin/main [ahead 2, behind 1]\0 M src/main.ts\0R  new.ts\0old.ts\0C  copy.ts\0source.ts\0UU conflict.ts\0?? nested/new.ts\0",
    );

    assert_eq!(snapshot.current_branch.as_deref(), Some("main"));
    assert_eq!(snapshot.ahead, 2);
    assert_eq!(snapshot.behind, 1);
    assert_eq!(snapshot.entries.len(), 5);
    assert_eq!(snapshot.entries[1].path, "new.ts");
    assert_eq!(snapshot.entries[1].old_path.as_deref(), Some("old.ts"));
    assert_eq!(snapshot.entries[2].path, "copy.ts");
    assert_eq!(snapshot.entries[2].old_path.as_deref(), Some("source.ts"));
    assert!(snapshot
        .entries
        .iter()
        .any(|entry| is_conflict_status(&entry.index, &entry.worktree)));
    assert!(!snapshot
        .entries
        .iter()
        .any(|entry| entry.path.starts_with("## ")));

    let detached = parse_status_snapshot("## HEAD (no branch)\0");
    assert_eq!(detached.current_branch, None);
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
    assert!(branches.iter().all(|branch| branch.tip_timestamp.is_some()));
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
fn repo_branches_marks_origin_short_refs_as_remote() {
    let remote = temp_dir("branches-origin-short-remote");
    init_git_repo(&remote);
    fs::write(remote.join("file.txt"), "root").unwrap();
    run_git(&remote, &["add", "file.txt"]);
    run_git(&remote, &["commit", "-m", "root"]);
    run_git(&remote, &["branch", "-M", "main"]);
    run_git(&remote, &["checkout", "-b", "feature/notice-update"]);
    fs::write(remote.join("feature.txt"), "feature").unwrap();
    run_git(&remote, &["add", "feature.txt"]);
    run_git(&remote, &["commit", "-m", "feature"]);
    run_git(&remote, &["checkout", "main"]);

    let path = temp_dir("branches-origin-short-clone");
    run_git(
        &std::env::temp_dir(),
        &[
            "clone",
            remote.to_string_lossy().as_ref(),
            path.to_string_lossy().as_ref(),
        ],
    );
    run_git(&path, &["config", "user.email", "test@example.com"]);
    run_git(&path, &["config", "user.name", "Test User"]);

    let branches = repo_branches(&path);

    assert!(branches
        .iter()
        .any(|branch| branch.remote && branch.name == "origin/main"));
    assert!(branches
        .iter()
        .any(|branch| branch.remote && branch.name == "origin/feature/notice-update"));
    assert!(!branches
        .iter()
        .any(|branch| !branch.remote && branch.name == "origin/feature/notice-update"));
}

#[test]
fn repo_branches_reports_checked_out_worktrees() {
    let path = temp_dir("branches-worktrees");
    init_git_repo(&path);

    fs::write(path.join("file.txt"), "root").unwrap();
    run_git(&path, &["add", "file.txt"]);
    run_git(&path, &["commit", "-m", "root"]);
    run_git(&path, &["branch", "-M", "main"]);
    run_git(&path, &["checkout", "-b", "feature/worktree"]);
    fs::write(path.join("feature.txt"), "feature").unwrap();
    run_git(&path, &["add", "feature.txt"]);
    run_git(&path, &["commit", "-m", "feature"]);
    run_git(&path, &["checkout", "main"]);
    let linked = temp_dir("linked-worktree");
    run_git(
        &path,
        &[
            "worktree",
            "add",
            linked.to_string_lossy().as_ref(),
            "feature/worktree",
        ],
    );

    let branches = repo_branches(&path);
    let main = branches
        .iter()
        .find(|branch| branch.name == "main")
        .unwrap();
    let feature = branches
        .iter()
        .find(|branch| branch.name == "feature/worktree")
        .unwrap();
    let normalize_display_path = |value: String| {
        value
            .strip_prefix(r"\\?\")
            .unwrap_or(value.as_str())
            .to_string()
    };

    assert_eq!(
        main.checked_out_worktree_paths
            .iter()
            .cloned()
            .map(normalize_display_path)
            .collect::<Vec<_>>(),
        vec![normalize_display_path(
            canonical_repo_path(&path).to_string_lossy().to_string()
        )]
    );
    assert_eq!(
        feature
            .checked_out_worktree_paths
            .iter()
            .cloned()
            .map(normalize_display_path)
            .collect::<Vec<_>>(),
        vec![normalize_display_path(
            canonical_repo_path(&linked).to_string_lossy().to_string()
        )]
    );
}

#[test]
fn resolve_repo_worktree_reports_standalone_main_and_linked_roles() {
    let root = temp_dir("resolve-worktree-roles");
    let standalone = root.join("standalone");
    init_git_repo(&standalone);
    fs::write(standalone.join("file.txt"), "standalone").unwrap();
    run_git(&standalone, &["add", "file.txt"]);
    run_git(&standalone, &["commit", "-m", "standalone"]);

    let main = root.join("main-repo");
    init_git_repo(&main);
    fs::write(main.join("file.txt"), "main").unwrap();
    run_git(&main, &["add", "file.txt"]);
    run_git(&main, &["commit", "-m", "main"]);
    run_git(&main, &["branch", "-M", "main"]);
    run_git(&main, &["checkout", "-b", "feature/worktree"]);
    fs::write(main.join("feature.txt"), "feature").unwrap();
    run_git(&main, &["add", "feature.txt"]);
    run_git(&main, &["commit", "-m", "feature"]);
    run_git(&main, &["checkout", "main"]);

    let linked = root.join("linked-worktree");
    run_git(
        &main,
        &[
            "worktree",
            "add",
            linked.to_string_lossy().as_ref(),
            "feature/worktree",
        ],
    );

    let standalone_worktree = resolve_repo_worktree(&root, &standalone);
    let main_worktree = resolve_repo_worktree(&root, &main);
    let linked_worktree = resolve_repo_worktree(&root, &linked);

    assert_eq!(standalone_worktree.summary.role, "standalone");
    assert_eq!(standalone_worktree.summary.main_repo_id, None);
    assert!(!standalone_worktree.summary.shared_repo_key.is_empty());

    assert_eq!(main_worktree.summary.role, "main");
    assert_eq!(
        main_worktree.summary.main_repo_id.as_deref(),
        Some("main-repo")
    );

    assert_eq!(linked_worktree.summary.role, "linked");
    assert_eq!(
        linked_worktree.summary.main_repo_id.as_deref(),
        Some("main-repo")
    );
    assert_eq!(
        linked_worktree.summary.shared_repo_key,
        main_worktree.summary.shared_repo_key
    );
}

#[test]
fn repo_id_uses_canonical_root_and_repo_paths() {
    let root = temp_dir("repo-id-canonical");
    let repo = root.join("nested").join("repo");
    fs::create_dir_all(&repo).unwrap();

    let id = repo_id(
        &root.join("."),
        &root.join("nested").join("..").join("nested").join("repo"),
    );

    assert_eq!(id, "nested/repo");
}

#[test]
fn linked_worktree_detail_reads_own_history_and_changes() {
    let root = temp_dir("linked-worktree-detail");
    let main = root.join("main-repo");
    init_git_repo(&main);
    fs::write(main.join("file.txt"), "main\n").unwrap();
    run_git(&main, &["add", "file.txt"]);
    run_git(&main, &["commit", "-m", "main"]);
    run_git(&main, &["branch", "-M", "main"]);
    run_git(&main, &["checkout", "-b", "feature/worktree"]);
    fs::write(main.join("feature.txt"), "feature\n").unwrap();
    run_git(&main, &["add", "feature.txt"]);
    run_git(&main, &["commit", "-m", "feature worktree"]);
    run_git(&main, &["checkout", "main"]);

    let linked = root.join("linked-worktree");
    run_git(
        &main,
        &[
            "worktree",
            "add",
            linked.to_string_lossy().as_ref(),
            "feature/worktree",
        ],
    );
    fs::write(linked.join("feature.txt"), "feature changed\n").unwrap();

    let mut settings = WorkspaceSettings {
        managed_repo_ids: vec!["linked-worktree".to_string()],
        ..WorkspaceSettings::default()
    };
    let (paths, changed) = managed_repo_paths_and_prune_stale(&root, &mut settings);
    assert!(!changed);
    assert_eq!(paths, vec![canonical_repo_path(&linked)]);
    assert_eq!(settings.managed_repo_ids, vec!["linked-worktree"]);

    let linked_path = repo_path_from_id(&root, "linked-worktree").unwrap();
    let summary = summarize_repo(&root, &linked_path);
    assert_eq!(summary.id, "linked-worktree");
    assert_eq!(summary.worktree.role, "linked");

    let history = repo_history(&linked_path);
    assert!(history
        .iter()
        .any(|commit| commit.subject == "feature worktree"));

    let changes = repo_changes(&linked_path);
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].path, "feature.txt");
    assert!(changes[0].unstaged);
    assert!(changes[0].diff.contains("feature changed"));
}

#[test]
fn remove_managed_repo_path_removes_linked_worktree_directory() {
    let root = temp_dir("remove-linked-worktree");
    let main = root.join("main-repo");
    init_git_repo(&main);
    fs::write(main.join("file.txt"), "main").unwrap();
    run_git(&main, &["add", "file.txt"]);
    run_git(&main, &["commit", "-m", "main"]);
    run_git(&main, &["branch", "-M", "main"]);
    run_git(&main, &["checkout", "-b", "feature/worktree"]);
    fs::write(main.join("feature.txt"), "feature").unwrap();
    run_git(&main, &["add", "feature.txt"]);
    run_git(&main, &["commit", "-m", "feature"]);
    run_git(&main, &["checkout", "main"]);

    let linked = root.join("linked-worktree");
    run_git(
        &main,
        &[
            "worktree",
            "add",
            linked.to_string_lossy().as_ref(),
            "feature/worktree",
        ],
    );
    let worktree = resolve_repo_worktree(&root, &linked);

    remove_managed_repo_path(&root, &linked, &worktree).unwrap();

    assert!(!linked.exists());
    assert!(!git_worktree_entries(&main)
        .iter()
        .any(|entry| entry.path == canonical_repo_path(&linked)));
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
    run_git(
        &path,
        &["merge", "--no-ff", "feature", "-m", "merge feature"],
    );

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
fn checkout_remote_branch_creates_tracking_local_branch() {
    let remote = temp_dir("remote-branch-origin");
    init_git_repo(&remote);
    fs::write(remote.join("file.txt"), "root").unwrap();
    run_git(&remote, &["add", "file.txt"]);
    run_git(&remote, &["commit", "-m", "root"]);
    run_git(&remote, &["branch", "-M", "main"]);
    run_git(&remote, &["checkout", "-b", "feature/notice-update"]);
    fs::write(remote.join("feature.txt"), "feature").unwrap();
    run_git(&remote, &["add", "feature.txt"]);
    run_git(&remote, &["commit", "-m", "feature"]);
    run_git(&remote, &["checkout", "main"]);

    let path = temp_dir("checkout-remote-branch");
    run_git(
        &std::env::temp_dir(),
        &[
            "clone",
            remote.to_string_lossy().as_ref(),
            path.to_string_lossy().as_ref(),
        ],
    );
    run_git(&path, &["config", "user.email", "test@example.com"]);
    run_git(&path, &["config", "user.name", "Test User"]);

    let summary = checkout_branch_at(&path, &path, "origin/feature/notice-update").unwrap();

    assert_eq!(
        summary.current_branch.as_deref(),
        Some("feature/notice-update")
    );
    assert!(local_branch_exists(&path, "feature/notice-update"));
    assert_eq!(
        current_branch_upstream(&path).as_deref(),
        Some("origin/feature/notice-update")
    );
}

#[test]
fn create_branch_supports_checkout_and_plain_branch_modes() {
    let path = temp_dir("create-branch");
    init_git_repo(&path);
    fs::write(path.join("file.txt"), "root").unwrap();
    run_git(&path, &["add", "file.txt"]);
    run_git(&path, &["commit", "-m", "root"]);
    run_git(&path, &["branch", "-M", "main"]);

    let created = create_branch_at(&path, &path, "feature/one", "main", false).unwrap();
    assert_eq!(created.current_branch.as_deref(), Some("main"));
    assert!(local_branch_exists(&path, "feature/one"));

    let checked_out = create_branch_at(&path, &path, "feature/two", "main", true).unwrap();
    assert_eq!(checked_out.current_branch.as_deref(), Some("feature/two"));
    assert!(local_branch_exists(&path, "feature/two"));
}

#[test]
fn rename_branch_supports_current_and_non_current_local_branch() {
    let path = temp_dir("rename-branch");
    init_git_repo(&path);
    fs::write(path.join("file.txt"), "root").unwrap();
    run_git(&path, &["add", "file.txt"]);
    run_git(&path, &["commit", "-m", "root"]);
    run_git(&path, &["branch", "-M", "main"]);
    run_git(&path, &["branch", "feature/old"]);

    let renamed_non_current = rename_branch_at(&path, &path, "feature/old", "feature/new").unwrap();
    assert_eq!(renamed_non_current.current_branch.as_deref(), Some("main"));
    assert!(local_branch_exists(&path, "feature/new"));

    let renamed_current = rename_branch_at(&path, &path, "main", "trunk").unwrap();
    assert_eq!(renamed_current.current_branch.as_deref(), Some("trunk"));
    assert!(local_branch_exists(&path, "trunk"));
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
fn parses_stash_file_changes_from_diff_outputs() {
    let status = "\
M\tsrc/app.ts
A\tsrc/new.ts
D\tsrc/old.ts
R100\tsrc/name.ts\tsrc/renamed.ts";
    let numstat = "\
2\t1\tsrc/app.ts
3\t0\tsrc/new.ts
0\t2\tsrc/old.ts
1\t1\tsrc/{name => renamed}.ts";
    let patch = "\
diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1,2 @@
-old()
+new()
+ready()
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+created()
diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
--- a/src/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-removed()
diff --git a/src/name.ts b/src/renamed.ts
similarity index 100%
rename from src/name.ts
rename to src/renamed.ts";

    let files = commit_file_changes_from_outputs(status, numstat, patch);

    assert_eq!(files.len(), 4);
    assert_eq!(files[0].status, "modified");
    assert_eq!((files[0].additions, files[0].deletions), (2, 1));
    assert_eq!(files[0].hunks[0].lines[0].kind, "deleted");
    assert_eq!(files[1].status, "added");
    assert_eq!((files[1].additions, files[1].deletions), (3, 0));
    assert!(files[1].patch.contains("--- /dev/null"));
    assert_eq!(files[1].hunks[0].lines[0].kind, "added");
    assert_eq!(files[1].hunks[0].lines[0].content, "created()");
    assert_eq!(files[2].status, "deleted");
    assert_eq!((files[2].additions, files[2].deletions), (0, 2));
    assert!(files[2].patch.contains("+++ /dev/null"));
    assert_eq!(files[2].hunks[0].lines[0].kind, "deleted");
    assert_eq!(files[2].hunks[0].lines[0].content, "removed()");
    assert_eq!(files[3].status, "renamed");
    assert_eq!(files[3].old_path.as_deref(), Some("src/name.ts"));
    assert_eq!(files[3].path, "src/renamed.ts");
    assert!(files[3].patch.contains("rename to src/renamed.ts"));
}

#[test]
fn github_commit_file_changes_wrap_added_and_removed_patch_headers() {
    let files = vec![
        GitHubCommitFileResponse {
            filename: "src/new.ts".to_string(),
            status: "added".to_string(),
            previous_filename: None,
            additions: 1,
            deletions: 0,
            patch: Some("@@ -0,0 +1 @@\n+created()".to_string()),
        },
        GitHubCommitFileResponse {
            filename: "src/old.ts".to_string(),
            status: "removed".to_string(),
            previous_filename: None,
            additions: 0,
            deletions: 1,
            patch: Some("@@ -1 +0,0 @@\n-removed()".to_string()),
        },
    ];

    let changes = github_commit_file_changes(files);

    assert_eq!(changes[0].status, "added");
    assert!(changes[0].patch.contains("--- /dev/null"));
    assert!(changes[0].patch.contains("+++ b/src/new.ts"));
    assert_eq!(changes[0].hunks[0].lines[0].kind, "added");
    assert_eq!(changes[0].hunks[0].lines[0].content, "created()");
    assert_eq!(changes[1].status, "deleted");
    assert!(changes[1].patch.contains("--- a/src/old.ts"));
    assert!(changes[1].patch.contains("+++ /dev/null"));
    assert_eq!(changes[1].hunks[0].lines[0].kind, "deleted");
    assert_eq!(changes[1].hunks[0].lines[0].content, "removed()");
}

#[test]
fn rejects_empty_stash_id() {
    assert_eq!(
        normalize_stash_id(" \t ").expect_err("empty stash id should fail"),
        "stash 标识不能为空",
    );
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
fn clone_retry_predicate_only_matches_github_token_auth_failures() {
    assert!(should_retry_clone_with_system_git(
        "https://github.com/sena-nana/private.git",
        "无法访问 GitHub 仓库 sena-nana/private：仓库不存在、是私有仓库且当前 GitHub 绑定无权限，或仓库名输入有误。"
    ));
    assert!(should_retry_clone_with_system_git(
        "https://github.com/sena-nana/private.git",
        "无法认证 GitHub 仓库 sena-nana/private，请重新绑定 GitHub 后再试。"
    ));
    assert!(!should_retry_clone_with_system_git(
        "https://gitee.com/meijustory/private.git",
        "无法认证 GitHub 仓库 repo"
    ));
    assert!(!should_retry_clone_with_system_git(
        "https://github.com/sena-nana/private.git",
        "non-fast-forward"
    ));
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
fn sync_preview_allows_dirty_pull_when_local_changes_mode_is_stash() {
    let dirty = test_repo_summary(|summary| {
        summary.id = "dirty".to_string();
        summary.behind = 1;
        summary.unstaged_count = 1;
    });

    let preview = build_bulk_sync_preview_with_lookup_and_mode(
        vec![dirty],
        |_| true,
        RepoPullLocalChangesMode::Stash,
    );

    assert_eq!(preview.blocked.len(), 0);
    assert!(preview.eligible.iter().any(|item| {
        item.repo.id == "dirty" && item.reason == "需处理本地修改后拉取远端更新"
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
fn github_oauth_scope_requests_project_read_access() {
    let scopes = normalize_scope_list(Some(GITHUB_SCOPE));

    assert!(scopes
        .iter()
        .any(|scope| scope == GITHUB_READ_PROJECT_SCOPE));
}

#[test]
fn detects_github_read_project_scope_graphql_errors() {
    let project_scope_errors = vec![
        GitHubGraphQlError {
            message: "Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: ['read:project']".to_string(),
        },
        GitHubGraphQlError {
            message: "Your token has not been granted the required scopes to execute this query. The 'title' field requires one of the following scopes: ['read:project']".to_string(),
        },
    ];
    let mixed_errors = vec![
        GitHubGraphQlError {
            message: "Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: ['read:project']".to_string(),
        },
        GitHubGraphQlError {
            message: "Something else failed".to_string(),
        },
    ];

    assert!(github_graphql_errors_require_read_project(
        &project_scope_errors
    ));
    assert!(!github_graphql_errors_require_read_project(&mixed_errors));
    assert!(!github_graphql_errors_require_read_project(&[]));
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
    let request = GitHubUpdateRepoSettingsRequest {
        description: Some("new desc".to_string()),
        homepage: None,
        topics: Some(vec![
            "Vue".to_string(),
            "vue".to_string(),
            "#Tauri".to_string(),
        ]),
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
    };
    let payload = github_update_repo_settings_payload(&request);

    assert_eq!(payload.len(), 5);
    assert_eq!(payload.get("description").unwrap(), "new desc");
    assert_eq!(payload.get("private").unwrap(), true);
    assert_eq!(payload.get("default_branch").unwrap(), "main");
    assert_eq!(payload.get("has_wiki").unwrap(), false);
    assert_eq!(payload.get("delete_branch_on_merge").unwrap(), true);
    assert!(payload.get("homepage").is_none());
    assert!(payload.get("topics").is_none());
    assert_eq!(
        normalize_github_topics(request.topics.unwrap()),
        vec!["vue".to_string(), "tauri".to_string()]
    );
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
        user: Some(GitHubAssigneeResponse {
            login: "sena".to_string(),
        }),
        milestone: Some(GitHubIssueMilestoneResponse {
            number: 7,
            title: "v1".to_string(),
            state: Some("open".to_string()),
        }),
        comments: 4,
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
        user: None,
        milestone: None,
        comments: 0,
        labels: Vec::new(),
        assignees: Vec::new(),
    };

    let mapped = github_issue_from_response(issue).unwrap();
    assert_eq!(mapped.labels, vec!["bug"]);
    assert_eq!(mapped.assignees, vec!["octo"]);
    assert_eq!(mapped.author.as_deref(), Some("sena"));
    assert_eq!(
        mapped
            .milestone
            .as_ref()
            .map(|milestone| milestone.title.as_str()),
        Some("v1")
    );
    assert_eq!(mapped.comments, 4);
    assert!(github_issue_from_response(pr).is_none());
}

#[test]
fn maps_github_issue_project_items_from_graphql() {
    let data: GitHubIssueProjectsGraphQlData = serde_json::from_value(serde_json::json!({
        "repository": {
            "issues": {
                "nodes": [
                    {
                        "number": 12,
                        "projectItems": {
                            "nodes": [
                                {
                                    "id": "PVTI_item",
                                    "project": {
                                        "id": "PVT_roadmap",
                                        "title": "Roadmap"
                                    }
                                }
                            ]
                        }
                    }
                ]
            }
        }
    }))
    .unwrap();

    let mapped = github_issue_project_items_from_graphql(data);

    assert_eq!(mapped[&12][0].id, "PVT_roadmap");
    assert_eq!(mapped[&12][0].title, "Roadmap");
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
        actor: Some(GitHubWorkflowActorResponse {
            login: "sena".to_string(),
        }),
        head_sha: Some("abc123".to_string()),
        run_number: Some(7),
        run_attempt: Some(1),
        workflow_id: Some(99),
        run_started_at: Some("2026-06-12T10:01:00Z".to_string()),
    });

    assert_eq!(mapped.id, 42);
    assert_eq!(mapped.name, "CI");
    assert_eq!(mapped.display_title, "CI");
    assert_eq!(mapped.status, "completed");
    assert_eq!(mapped.conclusion.as_deref(), Some("success"));
    assert_eq!(mapped.branch, "main");
    assert_eq!(mapped.event, "push");
    assert_eq!(mapped.actor.as_deref(), Some("sena"));
    assert_eq!(mapped.head_sha.as_deref(), Some("abc123"));
    assert_eq!(mapped.run_number, Some(7));
    assert_eq!(mapped.run_attempt, Some(1));
    assert_eq!(mapped.workflow_id, Some(99));
    assert_eq!(
        mapped.run_started_at.as_deref(),
        Some("2026-06-12T10:01:00Z")
    );
}

#[test]
fn maps_github_workflow_jobs_and_artifacts_with_defaults() {
    let job = github_workflow_job_from_response(GitHubWorkflowJobResponse {
        id: 77,
        name: Some("build".to_string()),
        status: Some("completed".to_string()),
        conclusion: Some("success".to_string()),
        started_at: Some("2026-06-12T10:00:00Z".to_string()),
        completed_at: Some("2026-06-12T10:02:00Z".to_string()),
        html_url: Some("https://github.com/a/repo/actions/runs/42/job/77".to_string()),
        runner_name: Some("GitHub Actions".to_string()),
        steps: vec![
            GitHubWorkflowJobStepResponse {
                name: Some("Set up job".to_string()),
                status: Some("completed".to_string()),
                conclusion: Some("success".to_string()),
                number: Some(1),
                started_at: None,
                completed_at: None,
            },
            GitHubWorkflowJobStepResponse {
                name: None,
                status: None,
                conclusion: None,
                number: None,
                started_at: None,
                completed_at: None,
            },
        ],
    });
    let artifact = github_workflow_artifact_from_response(GitHubWorkflowArtifactResponse {
        id: 88,
        name: Some("dist".to_string()),
        size_in_bytes: Some(2048),
        expired: false,
        created_at: "2026-06-12T10:03:00Z".to_string(),
        expires_at: Some("2026-07-12T10:03:00Z".to_string()),
    });

    assert_eq!(job.name, "build");
    assert_eq!(job.steps[0].name, "Set up job");
    assert_eq!(job.steps[1].name, "Step 2");
    assert_eq!(job.steps[1].status, "unknown");
    assert_eq!(artifact.name, "dist");
    assert_eq!(artifact.size_in_bytes, 2048);
}

#[test]
fn maps_github_workflow_definition_from_content_file() {
    let definition = github_workflow_definition_from_file(
        GitHubWorkflowResponse {
            id: 99,
            path: Some(".github/workflows/ci.yml".to_string()),
        },
        "abc123".to_string(),
        GitHubContentFileResponse {
            name: "ci.yml".to_string(),
            path: ".github/workflows/ci.yml".to_string(),
            encoding: Some("base64".to_string()),
            content: Some("bmFtZTogQ0kK".to_string()),
            size: Some(9),
        },
    )
    .unwrap()
    .unwrap();

    assert_eq!(definition.id, 99);
    assert_eq!(definition.path, ".github/workflows/ci.yml");
    assert_eq!(definition.ref_name, "abc123");
    assert_eq!(definition.content, "name: CI\n");
}

#[test]
fn ignores_github_workflow_definition_without_path() {
    let definition = github_workflow_definition_from_file(
        GitHubWorkflowResponse { id: 99, path: None },
        "abc123".to_string(),
        GitHubContentFileResponse {
            name: "ci.yml".to_string(),
            path: ".github/workflows/ci.yml".to_string(),
            encoding: Some("base64".to_string()),
            content: Some("bmFtZTogQ0kK".to_string()),
            size: Some(9),
        },
    )
    .unwrap();

    assert!(definition.is_none());
}

#[test]
fn previews_github_artifact_files_by_kind() {
    let text =
        github_artifact_preview_from_bytes("logs/build.log".to_string(), 5, b"hello".to_vec());
    let markdown =
        github_artifact_preview_from_bytes("README.md".to_string(), 7, b"# title".to_vec());
    let image = github_artifact_preview_from_bytes("image.png".to_string(), 4, vec![1, 2, 3, 4]);
    let large = github_artifact_preview_from_bytes(
        "large.log".to_string(),
        super::file_browser::MAX_FILE_PREVIEW_BYTES + 1,
        Vec::new(),
    );

    assert_eq!(text.preview_kind, "text");
    assert_eq!(text.content.as_deref(), Some("hello"));
    assert_eq!(markdown.preview_kind, "markdown");
    assert_eq!(image.preview_kind, "image");
    assert_eq!(
        image.data_url.as_deref(),
        Some("data:image/png;base64,AQIDBA==")
    );
    assert_eq!(large.preview_kind, "tooLarge");
}

#[test]
fn rejects_empty_github_artifact_entry_paths() {
    assert!(github_artifact_entry_path(Path::new("")).is_err());
    assert_eq!(
        github_artifact_entry_path(Path::new("logs/build.log")).unwrap(),
        "logs/build.log"
    );
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
    assert_eq!(main.tip_timestamp, None);
    assert!(main.checked_out_worktree_paths.is_empty());
    assert_eq!(main.behind, 0);
    assert_eq!(feature.name, "feature");
    assert!(feature.remote);
    assert!(!feature.current);
    assert!(!feature.protected);
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
    let content =
        "![window](./.github/assets/main-window.png)\n<img src='./.github/assets/main-window.png'>\n";
    let images = readme_image_data_urls(content, &repo, &repo);

    assert_eq!(
        images
            .get("./.github/assets/main-window.png")
            .map(String::as_str),
        Some("data:image/png;base64,AQID"),
    );
}

#[test]
fn repo_file_entries_sort_dirs_first_and_skip_git() {
    let repo = temp_dir("repo-file-tree");
    fs::create_dir_all(repo.join(".git").join("objects")).unwrap();
    fs::create_dir_all(repo.join("src")).unwrap();
    fs::write(repo.join(".env"), "A=1\n").unwrap();
    fs::write(repo.join("README.md"), "# Title\n").unwrap();
    fs::write(repo.join("src").join("main.ts"), "export {};\n").unwrap();

    let entries = repo_file_entries(&repo, None).unwrap();
    let paths = entries
        .iter()
        .map(|entry| (entry.path.as_str(), entry.kind.as_str(), entry.has_children))
        .collect::<Vec<_>>();

    assert_eq!(
        paths,
        vec![
            ("src", "dir", true),
            (".env", "file", false),
            ("README.md", "file", false),
        ]
    );
}

#[test]
fn repo_file_browser_rejects_paths_outside_repo() {
    let repo = temp_dir("repo-file-path-guard");
    fs::write(repo.join("README.md"), "# Main\n").unwrap();

    assert_eq!(
        repo_file_entries(&repo, Some("../outside")).unwrap_err(),
        "文件路径必须位于仓库内"
    );
    assert_eq!(
        repo_file_preview(&repo, "../outside.txt").unwrap_err(),
        "文件路径必须位于仓库内"
    );
}

#[test]
fn repo_file_preview_returns_text_markdown_image_binary_and_too_large() {
    let repo = temp_dir("repo-file-preview-kinds");
    fs::create_dir_all(repo.join("docs")).unwrap();
    fs::create_dir_all(repo.join("assets")).unwrap();
    fs::write(repo.join("plain.txt"), "hello\nworld\n").unwrap();
    fs::write(repo.join("binary.bin"), [0_u8, 159, 146, 150]).unwrap();
    fs::write(repo.join("assets").join("icon.png"), [1_u8, 2, 3]).unwrap();
    fs::write(
        repo.join("docs").join("guide.md"),
        "![icon](../assets/icon.png)\n\n# Guide\n",
    )
    .unwrap();
    fs::write(repo.join("large.log"), vec![b'a'; (1024 * 1024) + 1]).unwrap();

    let text = repo_file_preview(&repo, "plain.txt").unwrap();
    assert_eq!(text.preview_kind, "text");
    assert_eq!(text.content.as_deref(), Some("hello\nworld\n"));
    assert_eq!(text.mime_type.as_deref(), Some("text/plain"));

    let markdown = repo_file_preview(&repo, "docs/guide.md").unwrap();
    assert_eq!(markdown.preview_kind, "markdown");
    assert_eq!(markdown.mime_type.as_deref(), Some("text/markdown"));
    assert_eq!(
        markdown
            .images
            .get("../assets/icon.png")
            .map(String::as_str),
        Some("data:image/png;base64,AQID")
    );

    let image = repo_file_preview(&repo, "assets/icon.png").unwrap();
    assert_eq!(image.preview_kind, "image");
    assert_eq!(image.mime_type.as_deref(), Some("image/png"));
    assert_eq!(
        image.data_url.as_deref(),
        Some("data:image/png;base64,AQID")
    );

    let binary = repo_file_preview(&repo, "binary.bin").unwrap();
    assert_eq!(binary.preview_kind, "binary");
    assert!(binary.content.is_none());

    let too_large = repo_file_preview(&repo, "large.log").unwrap();
    assert_eq!(too_large.preview_kind, "tooLarge");
    assert_eq!(too_large.size, (1024 * 1024) + 1);
}

#[test]
fn github_content_files_map_to_repo_tree_and_preview_kinds() {
    let entries = github_content_items_to_file_entries(vec![
        GitHubContentListItem {
            name: "README.md".to_string(),
            path: "README.md".to_string(),
            kind: "file".to_string(),
        },
        GitHubContentListItem {
            name: "src".to_string(),
            path: "src".to_string(),
            kind: "dir".to_string(),
        },
        GitHubContentListItem {
            name: "ignored".to_string(),
            path: "ignored".to_string(),
            kind: "submodule".to_string(),
        },
    ]);

    assert_eq!(
        entries
            .iter()
            .map(|entry| (entry.path.as_str(), entry.kind.as_str(), entry.has_children))
            .collect::<Vec<_>>(),
        vec![("src", "dir", true), ("README.md", "file", false)]
    );
    assert_eq!(
        normalize_github_content_path(Some("../README.md")).unwrap_err(),
        "GitHub 文件路径不能包含 . 或 .."
    );

    let markdown = github_file_preview_from_content(
        "读取 GitHub 文件预览失败",
        GitHubContentFileResponse {
            name: "README.md".to_string(),
            path: "README.md".to_string(),
            encoding: Some("base64".to_string()),
            content: Some(STANDARD.encode("# Title\n")),
            size: Some(8),
        },
    )
    .unwrap();
    assert_eq!(markdown.preview_kind, "markdown");
    assert_eq!(markdown.content.as_deref(), Some("# Title\n"));

    let image = github_file_preview_from_content(
        "读取 GitHub 文件预览失败",
        GitHubContentFileResponse {
            name: "icon.png".to_string(),
            path: "assets/icon.png".to_string(),
            encoding: Some("base64".to_string()),
            content: Some(STANDARD.encode([1_u8, 2, 3])),
            size: Some(3),
        },
    )
    .unwrap();
    assert_eq!(image.preview_kind, "image");
    assert_eq!(
        image.data_url.as_deref(),
        Some("data:image/png;base64,AQID")
    );

    let too_large = github_file_preview_from_content(
        "读取 GitHub 文件预览失败",
        GitHubContentFileResponse {
            name: "large.log".to_string(),
            path: "large.log".to_string(),
            encoding: Some("none".to_string()),
            content: None,
            size: Some((1024 * 1024) + 1),
        },
    )
    .unwrap();
    assert_eq!(too_large.preview_kind, "tooLarge");
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
fn repo_group_creation_trims_and_rejects_empty_or_duplicate_names() {
    let mut settings = WorkspaceSettings::default();

    let group = create_repo_group(&mut settings, " 前端 ").unwrap();

    assert_eq!(group.name, "前端");
    assert_eq!(settings.repo_groups.len(), 1);
    assert_eq!(settings.repo_groups[0].name, "前端");
    assert_eq!(
        create_repo_group(&mut settings, "   ").unwrap_err(),
        "分组名称不能为空"
    );
    assert_eq!(
        create_repo_group(&mut settings, "前端").unwrap_err(),
        "已存在同名仓库分组"
    );
}

#[test]
fn repo_group_rename_trims_and_rejects_empty_or_duplicate_names() {
    let mut settings = WorkspaceSettings::default();
    let frontend = create_repo_group(&mut settings, "前端").unwrap();
    create_repo_group(&mut settings, "后端").unwrap();

    rename_repo_group(&mut settings, &frontend.id, " 客户端 ").unwrap();

    assert_eq!(settings.repo_groups[0].name, "客户端");
    assert_eq!(
        rename_repo_group(&mut settings, &frontend.id, "   ").unwrap_err(),
        "分组名称不能为空"
    );
    assert_eq!(
        rename_repo_group(&mut settings, &frontend.id, "后端").unwrap_err(),
        "已存在同名仓库分组"
    );
}

#[test]
fn moving_repo_to_group_removes_it_from_previous_group() {
    let mut settings = WorkspaceSettings::default();
    let frontend = create_repo_group(&mut settings, "前端").unwrap();
    let backend = create_repo_group(&mut settings, "后端").unwrap();

    move_repo_to_group(&mut settings, "repo", Some(&frontend.id)).unwrap();
    move_repo_to_group(&mut settings, "repo", Some(&backend.id)).unwrap();

    assert!(settings.repo_groups[0].repo_ids.is_empty());
    assert_eq!(settings.repo_groups[1].repo_ids, vec!["repo".to_string()]);
    move_repo_to_group(&mut settings, "repo", None).unwrap();
    assert!(settings
        .repo_groups
        .iter()
        .all(|group| group.repo_ids.is_empty()));
}

#[test]
fn deleting_repo_group_keeps_repo_members_as_ungrouped() {
    let mut settings = WorkspaceSettings::default();
    let frontend = create_repo_group(&mut settings, "前端").unwrap();
    move_repo_to_group(&mut settings, "repo", Some(&frontend.id)).unwrap();

    delete_repo_group(&mut settings, &frontend.id).unwrap();

    assert!(settings.repo_groups.is_empty());
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
fn managed_repo_paths_prunes_stale_repo_ids_from_settings() {
    let root = temp_dir("managed-repo-prune-stale");
    let visible = root.join("visible");
    init_git_repo(&visible);
    let mut settings = WorkspaceSettings {
        managed_repo_ids: vec![
            "visible".to_string(),
            "missing".to_string(),
            "nested/missing".to_string(),
        ],
        hidden_repo_ids: vec!["missing".to_string()],
        system_git_repo_ids: vec!["nested/missing".to_string()],
        repo_groups: vec![WorkspaceRepoGroup {
            id: "repo-group".to_string(),
            name: "Group".to_string(),
            repo_ids: vec![
                "visible".to_string(),
                "missing".to_string(),
                "nested/missing".to_string(),
            ],
        }],
        ..WorkspaceSettings::default()
    };

    let (paths, changed) = managed_repo_paths_and_prune_stale(&root, &mut settings);

    assert!(changed);
    assert_eq!(paths, vec![visible]);
    assert_eq!(settings.managed_repo_ids, vec!["visible"]);
    assert!(settings.hidden_repo_ids.is_empty());
    assert!(settings.system_git_repo_ids.is_empty());
    assert_eq!(settings.repo_groups[0].repo_ids, vec!["visible"]);
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
    assert_eq!(repos[0].worktree.role, "standalone");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn cached_managed_repos_merges_cached_metadata_with_current_repo_identity() {
    let root = temp_dir("cached-managed-repos");
    let visible = root.join("visible");
    fs::create_dir_all(visible.join(".git")).unwrap();
    let settings = WorkspaceSettings {
        workspace_root: Some(root.to_string_lossy().to_string()),
        managed_repo_ids: vec!["visible".to_string()],
        ..WorkspaceSettings::default()
    };
    let mut cached = test_repo_summary(|summary| {
        summary.id = "visible".to_string();
        summary.name = "old-name".to_string();
        summary.path = "C:/old/path".to_string();
        summary.relative_path = "old/relative".to_string();
        summary.current_branch = Some("cached-main".to_string());
        summary.github_full_name = Some("cached/repo".to_string());
        summary.ahead = 2;
        summary.language_stats = vec![LanguageStat {
            language: "Rust".to_string(),
            bytes: 100,
            lines: 10,
        }];
    });
    cached.worktree = RepoWorktree {
        role: "old".to_string(),
        shared_repo_key: "old".to_string(),
        main_repo_id: Some("old-main".to_string()),
    };
    let cache = WorkspaceStartupCache {
        workspace_root: settings.workspace_root.clone(),
        repos_by_id: HashMap::from([(
            "visible".to_string(),
            CachedRepoSummary {
                summary: cached,
                cached_at: 1,
            },
        )]),
        ..WorkspaceStartupCache::default()
    };

    let repos = cached_managed_repos(&root, &settings, &cache);

    assert_eq!(repos.len(), 1);
    assert_eq!(repos[0].id, "visible");
    assert_eq!(repos[0].name, "visible");
    assert_eq!(repos[0].path, visible.to_string_lossy().to_string());
    assert_eq!(repos[0].relative_path, "visible");
    assert_eq!(repos[0].worktree.role, "standalone");
    assert_eq!(repos[0].current_branch.as_deref(), Some("cached-main"));
    assert_eq!(repos[0].github_full_name.as_deref(), Some("cached/repo"));
    assert_eq!(repos[0].ahead, 2);
    assert_eq!(repos[0].language_stats[0].language, "Rust");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn prune_deleted_repo_settings_clears_all_repo_scoped_state() {
    let mut settings = WorkspaceSettings {
        managed_repo_ids: vec!["repo".to_string(), "other".to_string()],
        hidden_repo_ids: vec!["repo".to_string()],
        system_git_repo_ids: vec!["repo".to_string()],
        repo_groups: vec![WorkspaceRepoGroup {
            id: "group".to_string(),
            name: "分组".to_string(),
            repo_ids: vec!["repo".to_string(), "other".to_string()],
        }],
        project_launch_configs: HashMap::from([(
            "repo".to_string(),
            ProjectLaunchConfig {
                command: "yarn dev".to_string(),
                cwd: None,
                source: "manual".to_string(),
                updated_at: None,
            },
        )]),
        local_contribution_cache: HashMap::from([(
            "repo".to_string(),
            HashMap::from([(
                "2026-06-18".to_string(),
                LocalContributionDayCache {
                    count: 1,
                    updated_at: 1,
                },
            )]),
        )]),
        ..WorkspaceSettings::default()
    };

    prune_deleted_repo_settings(&mut settings, "repo");

    assert_eq!(settings.managed_repo_ids, vec!["other"]);
    assert!(settings.hidden_repo_ids.is_empty());
    assert!(settings.system_git_repo_ids.is_empty());
    assert_eq!(settings.repo_groups[0].repo_ids, vec!["other".to_string()]);
    assert!(settings.project_launch_configs.is_empty());
    assert!(settings.local_contribution_cache.is_empty());
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
fn infers_all_root_package_scripts_in_priority_order() {
    let path = temp_dir("all-root-scripts");
    write_package(
        &path,
        r#"{
              "packageManager": "yarn@4.14.1",
              "scripts": {
                "verify": "yarn test && yarn build",
                "build": "vite build",
                "preview": "vite preview",
                "docs:dev": "vitepress dev docs",
                "tauri:dev": "node scripts/tauri-dev.mjs",
                "dev": "vite",
                "predev": "node scripts/check-package-manager.mjs"
              }
            }"#,
    );

    let candidates = infer_launch_candidates(&path);
    let commands = candidates
        .iter()
        .map(|candidate| candidate.command.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        commands,
        vec![
            "yarn tauri:dev",
            "yarn dev",
            "yarn preview",
            "yarn docs:dev",
            "yarn build",
            "yarn predev",
            "yarn verify"
        ]
    );
    assert!(candidates
        .iter()
        .any(|candidate| candidate.label == "verify"));
    assert!(candidates
        .iter()
        .all(|candidate| candidate.kind == "package"));
    fs::remove_dir_all(path).unwrap();
}

#[test]
fn infers_root_powershell_script_launch_candidate() {
    let path = temp_dir("root-powershell-script");
    fs::write(path.join("build.ps1"), "Write-Host build\n").unwrap();
    fs::create_dir_all(path.join("scripts")).unwrap();
    fs::write(path.join("scripts").join("dev.ps1"), "Write-Host dev\n").unwrap();

    let candidates = infer_launch_candidates(&path);
    let root_candidate = candidates
        .iter()
        .find(|candidate| candidate.label == "build.ps1")
        .unwrap();
    assert_eq!(
        root_candidate.command,
        "powershell -ExecutionPolicy Bypass -File build.ps1"
    );
    assert_eq!(root_candidate.kind, "script");
    assert_eq!(root_candidate.hint, None);
    assert_eq!(root_candidate.cwd, None);
    assert!(candidates.iter().any(|candidate| {
        candidate.command == "powershell -ExecutionPolicy Bypass -File scripts/dev.ps1"
            && candidate.label == "scripts/dev.ps1"
            && candidate.hint.as_deref() == Some("scripts")
            && candidate.kind == "script"
    }));
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

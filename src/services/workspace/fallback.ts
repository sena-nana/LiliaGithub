import type {
  BulkOperation,
  BulkSyncPreview,
  BulkSyncResult,
  CommitDetail,
  GitHubBindingStatus,
  GitHubContributionDay,
  GitHubDeviceFlowPollResult,
  GitHubDeviceFlowStart,
  HiddenRepo,
  ProjectLaunchConfig,
  ProjectLaunchLog,
  ProjectLaunchStatus,
  RepoConflictChoice,
  RepoConflictState,
  RepoDetail,
  RepoMergePullResult,
  RepoSummary,
  WorkspaceSettings,
} from "./types";

const fallbackRepos: RepoSummary[] = [
  {
    id: "LiliaGithub",
    name: "LiliaGithub",
    path: "C:\\Files\\workspace\\LiliaGithub",
    relativePath: "LiliaGithub",
    currentBranch: "main",
    remoteUrl: "https://github.com/sena-nana/LiliaGithub.git",
    githubFullName: "sena-nana/LiliaGithub",
    ahead: 1,
    behind: 0,
    stagedCount: 1,
    unstagedCount: 2,
    untrackedCount: 1,
    conflictCount: 0,
    lastCommitAt: 1_785_000_000,
    lastCommitMessage: "搭建 LiliaGithub MVP",
  },
  {
    id: "Lilia",
    name: "Lilia",
    path: "C:\\Files\\workspace\\Lilia",
    relativePath: "Lilia",
    currentBranch: "main",
    remoteUrl: "https://github.com/sena-nana/Lilia.git",
    githubFullName: "sena-nana/Lilia",
    ahead: 0,
    behind: 2,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictCount: 1,
    lastCommitAt: 1_784_990_000,
    lastCommitMessage: "完善 GitHub 授权",
  },
];

const fallbackBinding: GitHubBindingStatus = {
  state: "bound",
  clientIdConfigured: true,
  clientIdSource: "bundled",
  binding: {
    login: "lilia-user",
    avatarUrl: null,
    boundAt: Date.now(),
    scopes: ["repo", "read:user"],
    clientIdSource: "bundled",
  },
};

const CONTRIBUTION_DAYS = 371;

function createFallbackSettings(): WorkspaceSettings {
  return {
    workspaceRoot: "C:\\Files\\workspace",
    githubBinding: fallbackBinding.binding,
    projectLaunchConfigs: {},
    hiddenRepoIds: [],
  };
}

let fallbackSettings: WorkspaceSettings = createFallbackSettings();
let fallbackBulkExecuteOverride: ((operation: BulkOperation, repoIds: string[]) => BulkSyncResult[]) | null = null;
let fallbackConflictOverride: ((repoId: string) => RepoConflictState | null) | null = null;
let fallbackRepoContributionsOverride: ((repoFullNames: string[]) => GitHubContributionDay[]) | null = null;
let fallbackCloneIndex = 1;
let fallbackClonedRepos: RepoSummary[] = [];

const fallbackLaunchStatuses: Record<string, ProjectLaunchStatus> = {};
const fallbackLaunchLogs: Record<string, ProjectLaunchLog[]> = {};
let fallbackLaunchLogIndex = 1;

export function resetWorkspaceFallbacksForTests() {
  fallbackSettings = createFallbackSettings();
  fallbackBulkExecuteOverride = null;
  fallbackConflictOverride = null;
  fallbackRepoContributionsOverride = null;
  fallbackCloneIndex = 1;
  fallbackClonedRepos = [];
  for (const key of Object.keys(fallbackLaunchStatuses)) {
    delete fallbackLaunchStatuses[key];
  }
  for (const key of Object.keys(fallbackLaunchLogs)) {
    delete fallbackLaunchLogs[key];
  }
  fallbackLaunchLogIndex = 1;
}

export function setFallbackBulkExecuteOverrideForTests(
  override: ((operation: BulkOperation, repoIds: string[]) => BulkSyncResult[]) | null,
) {
  fallbackBulkExecuteOverride = override;
}

export function setFallbackConflictOverrideForTests(
  override: ((repoId: string) => RepoConflictState | null) | null,
) {
  fallbackConflictOverride = override;
}

export function setFallbackRepoContributionsOverrideForTests(
  override: ((repoFullNames: string[]) => GitHubContributionDay[]) | null,
) {
  fallbackRepoContributionsOverride = override;
}

async function call<T>(_command: string, _args?: Record<string, unknown>, fallback?: () => T): Promise<T> {
  if (fallback) return fallback();
  throw new Error("Workspace fallback is unavailable for this command");
}

export function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  return call("workspace_get_settings", undefined, () => ({ ...fallbackSettings }));
}

export function setWorkspaceRoot(workspaceRoot: string): Promise<WorkspaceSettings> {
  return call("workspace_set_root", { workspaceRoot }, () => {
    fallbackSettings = { ...fallbackSettings, workspaceRoot };
    return { ...fallbackSettings };
  });
}

export function pickWorkspaceRoot(): Promise<string | null> {
  return call("workspace_pick_root", undefined, () => fallbackSettings.workspaceRoot);
}

export function scanRepos(): Promise<RepoSummary[]> {
  return call("workspace_scan_repos", undefined, () => visibleFallbackRepos());
}

function inferRepoDirectoryName(remoteUrl: string) {
  const trimmed = remoteUrl.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  const [, scpPath] = trimmed.match(/^[\w.-]+@[^:]+:(.+)$/) ?? [];
  const source = scpPath ?? trimmed;
  const parts = source.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || `cloned-repo-${fallbackCloneIndex++}`;
}

export function cloneRepo(remoteUrl: string, directoryName?: string | null): Promise<RepoSummary> {
  return call("workspace_clone_repo", { remoteUrl, directoryName: directoryName ?? null }, () => {
    const name = directoryName?.trim() || inferRepoDirectoryName(remoteUrl);
    const repo: RepoSummary = {
      id: name,
      name,
      path: `C:\\Files\\workspace\\${name}`,
      relativePath: name,
      currentBranch: "main",
      remoteUrl,
      githubFullName: remoteUrl.includes("github.com") ? `sena-nana/${name}` : null,
      ahead: 0,
      behind: 0,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      conflictCount: 0,
      lastCommitAt: null,
      lastCommitMessage: null,
    };
    fallbackClonedRepos = [...fallbackClonedRepos.filter((item) => item.id !== repo.id), repo];
    return { ...repo };
  });
}

export function getRepoSummary(repoId: string): Promise<RepoSummary> {
  return call("repo_get_summary", { repoId }, () => ({ ...fallbackRepo(repoId) }));
}

function allFallbackRepos() {
  return [...fallbackRepos, ...fallbackClonedRepos];
}

function visibleFallbackRepos() {
  const hidden = new Set(fallbackSettings.hiddenRepoIds);
  return allFallbackRepos()
    .filter((repo) => !hidden.has(repo.id))
    .map((repo) => ({ ...repo }));
}

export function hideRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_hide_repo", { repoId }, () => {
    if (!allFallbackRepos().some((repo) => repo.id === repoId)) {
      throw new Error(`未找到 Git 仓库：${repoId}`);
    }
    if (!fallbackSettings.hiddenRepoIds.includes(repoId)) {
      fallbackSettings = {
        ...fallbackSettings,
        hiddenRepoIds: [...fallbackSettings.hiddenRepoIds, repoId].sort(),
      };
    }
    return { ...fallbackSettings };
  });
}

export function unhideRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_unhide_repo", { repoId }, () => {
    fallbackSettings = {
      ...fallbackSettings,
      hiddenRepoIds: fallbackSettings.hiddenRepoIds.filter((id) => id !== repoId),
    };
    return { ...fallbackSettings };
  });
}

export function listHiddenRepos(): Promise<HiddenRepo[]> {
  return call("workspace_list_hidden_repos", undefined, () =>
    fallbackSettings.hiddenRepoIds.map((id) => ({
      id,
      name: allFallbackRepos().find((repo) => repo.id === id)?.name ?? id,
    })),
  );
}

export function getGitHubBindingStatus(): Promise<GitHubBindingStatus> {
  return call("github_get_binding_status", undefined, () => fallbackBinding);
}

export function startGitHubDeviceFlow(): Promise<GitHubDeviceFlowStart> {
  return call("github_start_device_flow", undefined, () => ({
    deviceCode: "device-code",
    userCode: "ABCD-1234",
    verificationUri: "https://github.com/login/device",
    expiresAt: Date.now() + 600_000,
    intervalSeconds: 5,
  }));
}

export function pollGitHubDeviceFlow(
  deviceCode: string,
  intervalSeconds?: number | null,
): Promise<GitHubDeviceFlowPollResult> {
  return call("github_poll_device_flow", { deviceCode, intervalSeconds: intervalSeconds ?? null }, () => ({
    status: "authorized",
    intervalSeconds: 5,
    bindingStatus: fallbackBinding,
    error: null,
  }));
}

export function listRepoContributions(repoFullNames: string[]): Promise<GitHubContributionDay[]> {
  return call("github_list_repo_contributions", { repoFullNames }, () => {
    if (fallbackRepoContributionsOverride) {
      return fallbackRepoContributionsOverride(repoFullNames).map((item) => ({ ...item }));
    }
    const end = new Date("2026-06-11T00:00:00Z");
    const repoFactor = Math.max(1, repoFullNames.filter((name) => name.trim()).length);
    return Array.from({ length: CONTRIBUTION_DAYS }, (_, index) => {
      const date = new Date(end);
      date.setUTCDate(end.getUTCDate() - (CONTRIBUTION_DAYS - 1 - index));
      const dayIndex = Math.floor(date.getTime() / 86_400_000);
      const active = dayIndex % 5 === 0 || dayIndex % 17 === 0 || dayIndex > Math.floor(end.getTime() / 86_400_000) - 45;
      return {
        date: date.toISOString().slice(0, 10),
        count: active ? ((dayIndex % 4) + 1) * repoFactor : 0,
      };
    });
  });
}

function fallbackRepo(repoId: string): RepoSummary {
  return allFallbackRepos().find((repo) => repo.id === repoId) ?? fallbackRepos[0];
}

function emptyConflictState(): RepoConflictState {
  return {
    operation: "none",
    files: [],
    allResolved: true,
  };
}

function fallbackConflictState(repoId: string): RepoConflictState {
  const override = fallbackConflictOverride?.(repoId);
  if (override) return override;
  if (repoId !== "Lilia") return emptyConflictState();
  return {
    operation: "merge",
    allResolved: false,
    files: [
      {
        path: "src/pages/TaskDetail.vue",
        status: "UU",
        resolved: false,
        binary: false,
        hunks: [
          {
            id: "hunk-1",
            startLine: 42,
            endLine: 58,
            oursLabel: "HEAD",
            theirsLabel: "origin/main",
            oursLines: [
              "const mode = 'local';",
              "await sendLocalMessage(draft);",
            ],
            theirsLines: [
              "const mode = 'remote';",
              "await sendRemoteMessage(draft);",
            ],
          },
          {
            id: "hunk-2",
            startLine: 128,
            endLine: 141,
            oursLabel: "HEAD",
            theirsLabel: "origin/main",
            oursLines: ["return retryOriginalContext(event);"],
            theirsLines: ["return retryLatestDraft(event);"],
          },
        ],
      },
    ],
  };
}

function fallbackLaunchConfig(repoId: string): ProjectLaunchConfig | null {
  return fallbackSettings.projectLaunchConfigs[repoId] ?? {
    command: repoId === "LiliaGithub" ? "yarn tauri:dev" : "yarn dev",
    cwd: null,
    source: "inferred",
    updatedAt: null,
  };
}

function fallbackIdleStatus(repoId: string): ProjectLaunchStatus {
  return {
    repoId,
    state: "idle",
    pid: null,
    command: null,
    startedAt: null,
    exitCode: null,
    error: null,
  };
}

function pushFallbackLaunchLog(repoId: string, stream: ProjectLaunchLog["stream"], line: string) {
  fallbackLaunchLogs[repoId] = [
    ...(fallbackLaunchLogs[repoId] ?? []),
    {
      index: fallbackLaunchLogIndex++,
      repoId,
      stream,
      line,
      timestamp: Date.now(),
    },
  ].slice(-500);
}

export function getRepoDetail(repoId: string): Promise<RepoDetail> {
  return call("repo_get_detail", { repoId }, () => {
    const summary = fallbackRepo(repoId);
    const conflicts = fallbackConflictState(repoId);
    return {
      summary: { ...summary },
      changes: [
        ...conflicts.files.map((file) => ({
          path: file.path,
          oldPath: null,
          indexStatus: file.status.slice(0, 1),
          worktreeStatus: file.status.slice(1, 2),
          staged: true,
          unstaged: true,
          untracked: false,
          conflicted: true,
          diff: "",
        })),
        {
          path: "src/pages/Home.vue",
          oldPath: null,
          indexStatus: "M",
          worktreeStatus: " ",
          staged: true,
          unstaged: false,
          untracked: false,
          conflicted: false,
          diff: "@@ -1 +1 @@\n-Lilia\n+LiliaGithub",
        },
        {
          path: "src-tauri/src/workspace.rs",
          oldPath: null,
          indexStatus: "?",
          worktreeStatus: "?",
          staged: false,
          unstaged: false,
          untracked: true,
          conflicted: false,
          diff: "",
        },
      ],
      commits: [
        {
          hash: "1234567890abcdef",
          shortHash: "1234567",
          author: "Sena",
          authorEmail: "sena@example.com",
          timestamp: 1_785_000_000,
          subject: "搭建 LiliaGithub MVP",
          parents: ["abcdef1234567890"],
          refs: ["HEAD -> main", "origin/main"],
        },
        {
          hash: "abcdef1234567890",
          shortHash: "abcdef1",
          author: "Sena",
          authorEmail: "sena@example.com",
          timestamp: 1_784_990_000,
          subject: "初始化工作区扫描",
          parents: [],
          refs: [],
        },
      ],
      branches: [
        {
          name: "main",
          remote: false,
          current: true,
          upstream: "origin/main",
          ahead: summary.ahead,
          behind: summary.behind,
        },
        {
          name: "origin/main",
          remote: true,
          current: false,
          upstream: null,
          ahead: 0,
          behind: 0,
        },
      ],
      conflicts,
    };
  });
}

export function getRepoCommitDetail(repoId: string, hash: string): Promise<CommitDetail> {
  return call("repo_get_commit_detail", { repoId, hash }, () => {
    const detail = fallbackRepo(repoId);
    return {
      hash,
      shortHash: hash.slice(0, 7),
      author: "Sena",
      authorEmail: "sena@example.com",
      committer: "Sena",
      committerEmail: "sena@example.com",
      timestamp: detail.lastCommitAt ?? 1_785_000_000,
      subject: "搭建 LiliaGithub MVP",
      body: "搭建本地仓库管理的基础视图。",
      parents: ["abcdef1234567890"],
      refs: ["HEAD -> main", "origin/main"],
      files: [
        {
          path: "src/pages/Home.vue",
          oldPath: null,
          status: "modified",
          additions: 24,
          deletions: 8,
          patch: "diff --git a/src/pages/Home.vue b/src/pages/Home.vue\n@@ -1,3 +1,4 @@\n <template>\n-  <h1>Lilia</h1>\n+  <h1>LiliaGithub</h1>\n+  <p>本地仓库管理</p>\n </template>",
          hunks: [
            {
              header: "@@ -1,3 +1,4 @@",
              oldStart: 1,
              oldLines: 3,
              newStart: 1,
              newLines: 4,
              lines: [
                { kind: "context", content: "<template>", oldLine: 1, newLine: 1 },
                { kind: "deleted", content: "  <h1>Lilia</h1>", oldLine: 2, newLine: null },
                { kind: "added", content: "  <h1>LiliaGithub</h1>", oldLine: null, newLine: 2 },
                { kind: "added", content: "  <p>本地仓库管理</p>", oldLine: null, newLine: 3 },
                { kind: "context", content: "</template>", oldLine: 3, newLine: 4 },
              ],
            },
          ],
        },
        {
          path: "src-tauri/src/workspace.rs",
          oldPath: null,
          status: "modified",
          additions: 42,
          deletions: 3,
          patch: "diff --git a/src-tauri/src/workspace.rs b/src-tauri/src/workspace.rs\n@@ -10,4 +10,5 @@\n pub struct RepoSummary {\n   pub name: String,\n-  pub path: String,\n+  pub path: String,\n+  pub github_full_name: Option<String>,\n }",
          hunks: [
            {
              header: "@@ -10,4 +10,5 @@",
              oldStart: 10,
              oldLines: 4,
              newStart: 10,
              newLines: 5,
              lines: [
                { kind: "context", content: "pub struct RepoSummary {", oldLine: 10, newLine: 10 },
                { kind: "context", content: "  pub name: String,", oldLine: 11, newLine: 11 },
                { kind: "deleted", content: "  pub path: String,", oldLine: 12, newLine: null },
                { kind: "added", content: "  pub path: String,", oldLine: null, newLine: 12 },
                { kind: "added", content: "  pub github_full_name: Option<String>,", oldLine: null, newLine: 13 },
                { kind: "context", content: "}", oldLine: 13, newLine: 14 },
              ],
            },
          ],
        },
      ],
    };
  });
}

export function getRepoLaunchConfig(repoId: string): Promise<ProjectLaunchConfig | null> {
  return call("repo_get_launch_config", { repoId }, () => fallbackLaunchConfig(repoId));
}

export function saveRepoLaunchConfig(
  repoId: string,
  command: string,
  cwd?: string | null,
): Promise<ProjectLaunchConfig> {
  return call("repo_save_launch_config", { repoId, command, cwd: cwd ?? null }, () => {
    const config: ProjectLaunchConfig = {
      command: command.trim(),
      cwd: cwd?.trim() ? cwd.trim() : null,
      source: "manual",
      updatedAt: Date.now(),
    };
    fallbackSettings = {
      ...fallbackSettings,
      projectLaunchConfigs: {
        ...fallbackSettings.projectLaunchConfigs,
        [repoId]: config,
      },
    };
    return config;
  });
}

export function getRepoLaunchStatus(repoId: string): Promise<ProjectLaunchStatus> {
  return call("repo_get_launch_status", { repoId }, () => fallbackLaunchStatuses[repoId] ?? fallbackIdleStatus(repoId));
}

export function getRepoLaunchLogs(repoId: string, since?: number | null): Promise<ProjectLaunchLog[]> {
  return call("repo_get_launch_logs", { repoId, since: since ?? null }, () =>
    (fallbackLaunchLogs[repoId] ?? []).filter((entry) => entry.index > (since ?? 0)),
  );
}

export function startRepoLaunch(repoId: string): Promise<ProjectLaunchStatus> {
  return call("repo_start_launch", { repoId }, () => {
    const config = fallbackLaunchConfig(repoId);
    if (!config?.command.trim()) {
      throw new Error("未配置快速启动脚本");
    }
    const status: ProjectLaunchStatus = {
      repoId,
      state: "running",
      pid: 4321,
      command: config.command,
      startedAt: Date.now(),
      exitCode: null,
      error: null,
    };
    fallbackLaunchStatuses[repoId] = status;
    pushFallbackLaunchLog(repoId, "system", `启动命令：${config.command}`);
    pushFallbackLaunchLog(repoId, "stdout", "开发服务已启动");
    return status;
  });
}

export function stopRepoLaunch(repoId: string): Promise<ProjectLaunchStatus> {
  return call("repo_stop_launch", { repoId }, () => {
    const current = fallbackLaunchStatuses[repoId] ?? fallbackIdleStatus(repoId);
    const status: ProjectLaunchStatus = {
      ...current,
      state: current.state === "idle" ? "idle" : "exited",
      pid: null,
      exitCode: current.state === "idle" ? null : 0,
    };
    fallbackLaunchStatuses[repoId] = status;
    if (status.state === "exited") {
      pushFallbackLaunchLog(repoId, "system", "已停止快速启动进程");
    }
    return status;
  });
}

export function stageFiles(repoId: string, files: string[]): Promise<void> {
  return call("repo_stage_files", { repoId, files }, () => undefined);
}

export function unstageFiles(repoId: string, files: string[]): Promise<void> {
  return call("repo_unstage_files", { repoId, files }, () => undefined);
}

export function commitRepo(
  repoId: string,
  files: string[],
  message: string,
  pushAfter: boolean,
): Promise<RepoSummary> {
  return call("repo_commit", { repoId, files, message, pushAfter }, () => {
    const repo = fallbackRepo(repoId);
    return { ...repo, stagedCount: 0, unstagedCount: 0, untrackedCount: 0, ahead: pushAfter ? 0 : repo.ahead + 1 };
  });
}

export function pullRepo(repoId: string): Promise<RepoSummary> {
  return call("repo_pull", { repoId }, () => {
    const repo = fallbackRepo(repoId);
    return { ...repo, behind: 0 };
  });
}

export function mergePullRepo(repoId: string): Promise<RepoMergePullResult> {
  return call("repo_merge_pull", { repoId }, () => {
    const repo = fallbackRepo(repoId);
    const conflicts = fallbackConflictState(repoId);
    return {
      status: conflicts.files.length ? "conflicts" : "success",
      message: conflicts.files.length ? "合并产生冲突，请处理后提交" : "合并完成",
      summary: { ...repo, behind: conflicts.files.length ? repo.behind : 0 },
      conflicts,
    };
  });
}

export function pushRepo(repoId: string): Promise<RepoSummary> {
  return call("repo_push", { repoId }, () => {
    const repo = fallbackRepo(repoId);
    return { ...repo, ahead: 0 };
  });
}

export function checkoutBranch(repoId: string, branch: string): Promise<RepoSummary> {
  return call("repo_checkout_branch", { repoId, branch }, () => {
    const repo = fallbackRepo(repoId);
    return { ...repo, currentBranch: branch };
  });
}

export function getRepoConflicts(repoId: string): Promise<RepoConflictState> {
  return call("repo_get_conflicts", { repoId }, () => fallbackConflictState(repoId));
}

function resolvedFallbackRepo(repoId: string): RepoSummary {
  const repo = fallbackRepo(repoId);
  return { ...repo, conflictCount: 0, stagedCount: repo.stagedCount + 1 };
}

export function acceptConflictFile(
  repoId: string,
  path: string,
  side: "ours" | "theirs",
  stage = true,
): Promise<RepoSummary> {
  return call("repo_accept_conflict_file", { repoId, path, side, stage }, () => resolvedFallbackRepo(repoId));
}

export function resolveConflictFile(
  repoId: string,
  path: string,
  choices: RepoConflictChoice[],
  stage = true,
): Promise<RepoSummary> {
  return call("repo_resolve_conflict_file", { repoId, path, choices, stage }, () => resolvedFallbackRepo(repoId));
}

export function markFileResolved(repoId: string, path: string): Promise<RepoSummary> {
  return call("repo_mark_file_resolved", { repoId, path }, () => resolvedFallbackRepo(repoId));
}

export function abortConflictOperation(repoId: string): Promise<RepoSummary> {
  return call("repo_abort_conflict_operation", { repoId }, () => {
    const repo = fallbackRepo(repoId);
    return { ...repo, conflictCount: 0 };
  });
}

export function continueConflictOperation(repoId: string): Promise<RepoSummary> {
  return call("repo_continue_conflict_operation", { repoId }, () => {
    const repo = fallbackRepo(repoId);
    return { ...repo, conflictCount: 0 };
  });
}

export function bulkSyncPreview(operation: BulkOperation, repos: RepoSummary[]): Promise<BulkSyncPreview> {
  const reposToUse = repos.length ? repos : visibleFallbackRepos();
  return call("bulk_sync_preview", { operation }, () => {
    if (operation === "sync") {
      return {
        operation,
        eligible: reposToUse
          .filter((repo) => repo.remoteUrl && repo.currentBranch && repo.conflictCount <= 0)
          .filter((repo) => {
            const dirty = repo.stagedCount + repo.unstagedCount + repo.untrackedCount;
            return (repo.behind > 0 && dirty === 0) || (repo.ahead > 0 && repo.behind === 0);
          })
          .map((repo) => ({
            repo: { ...repo },
            reason: repo.ahead > 0 && repo.behind > 0
              ? "需先拉取合并后推送"
              : repo.behind > 0
                ? "可拉取远端更新"
                : "有本地提交待推送",
          })),
        blocked: reposToUse
          .flatMap((repo) => {
            const dirty = repo.stagedCount + repo.unstagedCount + repo.untrackedCount;
            if (!repo.remoteUrl) return [{ repo: { ...repo }, reason: "没有 origin remote" }];
            if (!repo.currentBranch) return [{ repo: { ...repo }, reason: "当前不是命名分支" }];
            if (repo.behind > 0 && repo.conflictCount > 0) return [{ repo: { ...repo }, reason: "已有冲突需要先处理" }];
            if (repo.behind > 0 && dirty > 0) return [{ repo: { ...repo }, reason: "存在未提交变更" }];
            return [];
          }),
        warnings: reposToUse
          .flatMap((repo) => {
            const dirty = repo.stagedCount + repo.unstagedCount + repo.untrackedCount;
            if (repo.ahead > 0 && repo.behind === 0 && repo.currentBranch && repo.remoteUrl && dirty > 0) {
              return [{ repo: { ...repo }, reason: "存在未提交变更，但仍可执行 push" }];
            }
            if (repo.ahead <= 0 && repo.behind <= 0 && repo.currentBranch && repo.remoteUrl) {
              return [{ repo: { ...repo }, reason: "没有需要同步的更新" }];
            }
            return [];
          }),
      };
    }
    if (operation === "push") {
      return {
        operation,
        eligible: reposToUse
          .filter((repo) => repo.ahead > 0 && repo.behind === 0 && repo.currentBranch && repo.remoteUrl)
          .map((repo) => ({ repo: { ...repo }, reason: "有本地提交待推送" })),
        blocked: reposToUse
          .flatMap((repo) => {
            if (!repo.remoteUrl) return [{ repo: { ...repo }, reason: "没有 origin remote" }];
            if (!repo.currentBranch) return [{ repo: { ...repo }, reason: "当前不是命名分支" }];
            if (repo.behind > 0) return [{ repo: { ...repo }, reason: "当前分支落后于 upstream" }];
            return [];
          }),
        warnings: reposToUse
          .flatMap((repo) => {
            const dirty = repo.stagedCount + repo.unstagedCount + repo.untrackedCount;
            if (repo.ahead > 0 && repo.behind === 0 && repo.currentBranch && repo.remoteUrl && dirty > 0) {
              return [{ repo: { ...repo }, reason: "存在未提交变更，但仍可执行 push" }];
            }
            if (repo.ahead <= 0 && repo.currentBranch && repo.remoteUrl) {
              return [{ repo: { ...repo }, reason: "没有需要推送的提交" }];
            }
            return [];
          }),
      };
    }
    return {
      operation,
      eligible: reposToUse
        .filter((repo) => repo.behind > 0)
        .map((repo) => ({ repo: { ...repo }, reason: "可拉取远端更新" })),
      blocked: reposToUse
        .filter((repo) => repo.stagedCount + repo.unstagedCount + repo.untrackedCount > 0)
        .map((repo) => ({ repo: { ...repo }, reason: "存在未提交变更" })),
      warnings: reposToUse
        .filter((repo) => repo.behind <= 0)
        .map((repo) => ({ repo: { ...repo }, reason: "没有需要拉取的更新" })),
    };
  });
}

export function bulkSyncExecute(operation: BulkOperation, repoIds: string[]): Promise<BulkSyncResult[]> {
  return call("bulk_sync_execute", { operation, repoIds }, () =>
    fallbackBulkExecuteOverride?.(operation, repoIds) ?? repoIds.map((repoId) => {
      const repo = fallbackRepo(repoId);
      return {
        summary: {
          ...repo,
          ahead: operation === "push" || operation === "sync" ? 0 : repo.ahead,
          behind: operation === "pull" || operation === "sync" ? 0 : repo.behind,
        },
        repoId,
        status: "success",
        message: "完成",
      };
    }),
  );
}

export function openPath(path: string): Promise<void> {
  return call("system_open_path", { path }, () => undefined);
}

export function openUrl(url: string): Promise<void> {
  return call("system_open_url", { url }, () => undefined);
}


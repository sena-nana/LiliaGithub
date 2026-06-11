import { invoke } from "@tauri-apps/api/core";

export interface WorkspaceSettings {
  workspaceRoot: string | null;
  githubBinding: GitHubBindingMetadata | null;
  projectLaunchConfigs: Record<string, ProjectLaunchConfig>;
  hiddenRepoIds: string[];
}

export interface ProjectLaunchConfig {
  command: string;
  cwd: string | null;
  source: "inferred" | "manual";
  updatedAt: number | null;
}

export type ProjectLaunchState = "idle" | "running" | "exited" | "error";

export interface ProjectLaunchStatus {
  repoId: string;
  state: ProjectLaunchState;
  pid: number | null;
  command: string | null;
  startedAt: number | null;
  exitCode: number | null;
  error: string | null;
}

export interface ProjectLaunchLog {
  index: number;
  repoId: string;
  stream: "stdout" | "stderr" | "system";
  line: string;
  timestamp: number;
}

export interface GitHubBindingMetadata {
  login: string;
  avatarUrl: string | null;
  boundAt: number;
  scopes: string[];
  clientIdSource: "bundled" | "custom" | string;
}

export interface GitHubBindingStatus {
  state: "bound" | "unbound";
  clientIdConfigured: boolean;
  clientIdSource: "bundled" | "none" | string;
  binding: GitHubBindingMetadata | null;
}

export interface GitHubDeviceFlowStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalSeconds: number;
}

export interface GitHubDeviceFlowPollResult {
  status: "pending" | "authorized" | "expired";
  intervalSeconds: number;
  bindingStatus: GitHubBindingStatus | null;
  error: string | null;
}

export interface RepoSummary {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  currentBranch: string | null;
  remoteUrl: string | null;
  githubFullName: string | null;
  ahead: number;
  behind: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  lastCommitAt: number | null;
  lastCommitMessage: string | null;
}

export interface RepoChange {
  path: string;
  oldPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  diff: string;
}

export interface CommitSummary {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail?: string | null;
  timestamp: number;
  subject: string;
  parents: string[];
  refs: string[];
}

export interface CommitFileChange {
  path: string;
  oldPath: string | null;
  status: string;
  additions: number;
  deletions: number;
}

export interface CommitDetail {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail?: string | null;
  committer: string;
  committerEmail?: string | null;
  timestamp: number;
  subject: string;
  body: string;
  parents: string[];
  refs: string[];
  files: CommitFileChange[];
}

export interface BranchSummary {
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface RepoDetail {
  summary: RepoSummary;
  changes: RepoChange[];
  commits: CommitSummary[];
  branches: BranchSummary[];
}

export type BulkOperation = "pull" | "push";

export interface BulkSyncRepo {
  repo: RepoSummary;
  reason: string;
}

export interface BulkSyncPreview {
  operation: BulkOperation;
  eligible: BulkSyncRepo[];
  blocked: BulkSyncRepo[];
  warnings: BulkSyncRepo[];
}

export interface BulkSyncResult {
  repoId: string;
  status: "success" | "error";
  message: string;
  summary: RepoSummary | null;
}

export interface HiddenRepo {
  id: string;
  name: string;
}

const isTest = typeof import.meta !== "undefined" && import.meta.env?.MODE === "test";

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

const fallbackLaunchStatuses: Record<string, ProjectLaunchStatus> = {};
const fallbackLaunchLogs: Record<string, ProjectLaunchLog[]> = {};
let fallbackLaunchLogIndex = 1;

export function resetWorkspaceFallbacksForTests() {
  fallbackSettings = createFallbackSettings();
  fallbackBulkExecuteOverride = null;
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

function canInvoke() {
  return !isTest && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function call<T>(command: string, args?: Record<string, unknown>, fallback?: () => T): Promise<T> {
  if (canInvoke()) {
    return invoke<T>(command, args);
  }
  if (fallback) return fallback();
  throw new Error(`Tauri command is unavailable: ${command}`);
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

export function getRepoSummary(repoId: string): Promise<RepoSummary> {
  return call("repo_get_summary", { repoId }, () => ({ ...fallbackRepo(repoId) }));
}

function visibleFallbackRepos() {
  const hidden = new Set(fallbackSettings.hiddenRepoIds);
  return fallbackRepos
    .filter((repo) => !hidden.has(repo.id))
    .map((repo) => ({ ...repo }));
}

export function hideRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_hide_repo", { repoId }, () => {
    if (!fallbackRepos.some((repo) => repo.id === repoId)) {
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
      name: fallbackRepos.find((repo) => repo.id === id)?.name ?? id,
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

function fallbackRepo(repoId: string): RepoSummary {
  return fallbackRepos.find((repo) => repo.id === repoId) ?? fallbackRepos[0];
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
    return {
      summary: { ...summary },
      changes: [
        {
          path: "src/pages/Home.vue",
          oldPath: null,
          indexStatus: "M",
          worktreeStatus: " ",
          staged: true,
          unstaged: false,
          untracked: false,
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
        },
        {
          path: "src-tauri/src/workspace.rs",
          oldPath: null,
          status: "modified",
          additions: 42,
          deletions: 3,
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

export function bulkSyncPreview(operation: BulkOperation): Promise<BulkSyncPreview> {
  const repos = visibleFallbackRepos();
  return call("bulk_sync_preview", { operation }, () => {
    if (operation === "push") {
      return {
        operation,
        eligible: repos
          .filter((repo) => repo.ahead > 0 && repo.behind === 0 && repo.currentBranch && repo.remoteUrl)
          .map((repo) => ({ repo: { ...repo }, reason: "有本地提交待推送" })),
        blocked: repos
          .flatMap((repo) => {
            if (!repo.remoteUrl) return [{ repo: { ...repo }, reason: "没有 origin remote" }];
            if (!repo.currentBranch) return [{ repo: { ...repo }, reason: "当前不是命名分支" }];
            if (repo.behind > 0) return [{ repo: { ...repo }, reason: "当前分支落后于 upstream" }];
            return [];
          }),
        warnings: repos
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
      eligible: repos
        .filter((repo) => repo.behind > 0)
        .map((repo) => ({ repo: { ...repo }, reason: "可拉取远端更新" })),
      blocked: repos
        .filter((repo) => repo.stagedCount + repo.unstagedCount + repo.untrackedCount > 0)
        .map((repo) => ({ repo: { ...repo }, reason: "存在未提交变更" })),
      warnings: repos
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
          ahead: operation === "push" ? 0 : repo.ahead,
          behind: operation === "pull" ? 0 : repo.behind,
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

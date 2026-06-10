import { invoke } from "@tauri-apps/api/core";

export interface WorkspaceSettings {
  workspaceRoot: string | null;
  githubBinding: GitHubBindingMetadata | null;
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
  timestamp: number;
  subject: string;
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

let fallbackSettings: WorkspaceSettings = {
  workspaceRoot: "C:\\Files\\workspace",
  githubBinding: fallbackBinding.binding,
};

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
  return call("workspace_scan_repos", undefined, () => fallbackRepos.map((repo) => ({ ...repo })));
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
          timestamp: 1_785_000_000,
          subject: "搭建 LiliaGithub MVP",
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
  return call("bulk_sync_preview", { operation }, () => ({
    operation,
    eligible: fallbackRepos
      .filter((repo) => operation === "pull" ? repo.behind > 0 : repo.ahead > 0)
      .map((repo) => ({ repo: { ...repo }, reason: operation === "pull" ? "可拉取远端更新" : "有本地提交待推送" })),
    blocked: fallbackRepos
      .filter((repo) => operation === "pull" && repo.stagedCount + repo.unstagedCount + repo.untrackedCount > 0)
      .map((repo) => ({ repo: { ...repo }, reason: "存在未提交变更" })),
    warnings: [],
  }));
}

export function bulkSyncExecute(operation: BulkOperation, repoIds: string[]): Promise<BulkSyncResult[]> {
  return call("bulk_sync_execute", { operation, repoIds }, () =>
    repoIds.map((repoId) => ({
      repoId,
      status: "success",
      message: "完成",
    })),
  );
}

export function openPath(path: string): Promise<void> {
  return call("system_open_path", { path }, () => undefined);
}

export function openUrl(url: string): Promise<void> {
  return call("system_open_url", { url }, () => undefined);
}

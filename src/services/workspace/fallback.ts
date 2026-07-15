import packageJson from "../../../package.json";
import { normalizeWorkspaceTasks } from "./taskRetention";
import {
  cloneRepoRemoteSyncPolicy,
  withRepoAutoSyncPreference,
  withRepoRemoteSyncPolicy,
  withRepoSettingPreference,
} from "../../config/repoSettingsManifest";
import type {
  AccountPreferences,
  BulkOperation,
  BulkSyncPreview,
  BulkSyncResult,
  BranchSummary,
  CommitDetail,
  CommitFileChange,
  CommitSummary,
  ContributionIdentityRecommendationResult,
  GitHubActionNotification,
  GitHubAccountIssueItem,
  GitHubAccountProfile,
  GitHubAuthPurpose,
  GitHubAttachWorkflowArtifactAssetRequest,
  GitHubBindingStatus,
  GitHubBranchProtection,
  GitHubCommitListOptions,
  GitHubContributionDay,
  GitHubContributionMeta,
  GitHubContributionResult,
  GitHubCreateIssueRequest,
  GitHubCreateRepoRequest,
  GitHubCreateReleaseRequest,
  GitHubDeviceFlowPollResult,
  GitHubDeviceFlowStart,
  GitHubDiscussionTimelineItem,
  GitHubIssue,
  GitHubIssueDiscussion,
  GitHubIssueFilterMetadata,
  GitHubIssueMilestone,
  GitHubIssueListOptions,
  GitHubMergePullRequestRequest,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubPullRequestDiscussion,
  GitHubPullRequestListOptions,
  GitHubRelease,
  GitHubReleaseAsset,
  GitHubRepoActionsPermissionsRequest,
  GitHubRepoManagement,
  GitHubRepoOwner,
  GitHubRepoPage,
  GitHubRepositoryScope,
  GitHubRepoTemplate,
  GitHubRepoSettingsSection,
  GitHubRepoSettingsSectionKey,
  GitHubRepoSummary,
  GitHubRuleset,
  GitHubRulesetSummary,
  GitHubWorkflowArtifactEntry,
  GitHubWorkflowJobLog,
  GitHubWorkflowRun,
  GitHubWorkflowRunDetail,
  GitHubCreatePullRequestRequest,
  GitHubUpdatePullRequestRequest,
  GitHubUpdateAccountProfileRequest,
  GitHubUpdateReleaseRequest,
  GitHubUpdateIssueRequest,
  GitHubUpdateRepoSettingsRequest,
  GitHubRepoWorkflowPermissionsRequest,
  HiddenRepo,
  ProjectLaunchConfig,
  ProjectLaunchCandidate,
  ProjectLaunchHistoryEntry,
  ProjectLaunchLog,
  ProjectLaunchStatus,
  RepoConflictChoice,
  RepoConflictState,
  RepoCommitResult,
  RepoDetail,
  RepoDetailPatch,
  RepoDetailPatchRequest,
  RepoFilePreview,
  RepoFileTreeEntry,
  RepoMergePullResult,
  RepoOperationResult,
  RepoPullLocalChangesMode,
  RepoRemote,
  RepoRemoteOperationStep,
  RepoRemoteSyncConfig,
  RepoRemoteSyncPolicy,
  RepoRefreshSummaryOptions,
  RepoResetMode,
  RepoSummary,
  RepoSyncOperationResult,
  RepoSyncPreference,
  RepoStashEntry,
  RepoStashDetail,
  RepoStorageStats,
  RemoteRepoShortcut,
  SystemOpenTarget,
  WorkspaceTask,
  WorkspaceRepoRefreshRequest,
  WorkspaceRepoRefreshedEvent,
  WorkspaceSettings,
  WorkspaceRepoGroup,
  WorkspaceStartupCache,
  WorkspaceStartupContributions,
  WorkspaceCloneRepoRequest,
  WorkspaceCreateLocalRepoRequest,
} from "./types";

const ROOT_SCRIPT_PRIORITY = ["tauri:dev", "dev", "start", "serve", "preview", "docs:dev"] as const;
const FALLBACK_LILIA_GITHUB_README = [
  "# LiliaGithub",
  "",
  "一个面向本地多仓库管理的 Tauri 2 + Vue 3 + TypeScript 桌面应用。",
  "",
  "## 当前能力",
  "",
  "- 工作区 Git 仓库扫描",
  "- GitHub 仓库管理",
  "- 快速启动配置",
].join("\n");
const FALLBACK_SHOWCASE_LILIA_GITHUB_README = [
  "# LiliaGithub",
  "",
  "一个面向本地 GitHub 工作区和多仓库管理的 Tauri 2 + Vue 3 + TypeScript 桌面应用。",
  "",
  "## 当前工作重点",
  "",
  "- 工作区 Git 仓库扫描和状态聚合",
  "- 单仓库变更、历史、分支和 README 视图",
  "- GitHub Issues、Pull Requests、Actions 和 Settings 管理入口",
  "- 快速启动命令配置、运行状态轮询和最近输出日志",
  "- pull / push 批量预检和队列执行",
  "",
  "## 截图场景",
  "",
  "README 展示截图使用开发态 mock 数据生成，用于呈现多个仓库、多种同步状态和 GitHub 时间线。",
].join("\n");
const FALLBACK_LILIA_README = "# Lilia\n\nDesktop agent workbench.";
const useReadmeShowcaseFallback = typeof import.meta !== "undefined"
  && import.meta.env?.DEV === true
  && import.meta.env?.VITE_README_SHOWCASE === "1";
const useAgentDebugMockWorkspace = typeof import.meta !== "undefined"
  && import.meta.env?.DEV === true
  && import.meta.env?.VITE_LILIA_GITHUB_AGENT_DEBUG_MOCK_WORKSPACE === "1";
const useDefaultFallback = !useReadmeShowcaseFallback;

type FallbackRepoInput = Omit<RepoSummary, "remoteBranchStates" | "remotesNeedingPull" | "remotesNeedingPush">;

function withFallbackRemoteState(repos: FallbackRepoInput[]): RepoSummary[] {
  return repos.map((repo) => ({
    ...repo,
    remoteBranchStates: repo.currentBranch && repo.remoteUrl
      ? [{
          remote: "origin",
          remoteBranch: repo.currentBranch,
          exists: true,
          ahead: repo.ahead,
          behind: repo.behind,
          needsPull: repo.behind > 0,
          needsPush: repo.ahead > 0,
          upstream: true,
        }]
      : [],
    remotesNeedingPull: repo.behind > 0 ? 1 : 0,
    remotesNeedingPush: repo.ahead > 0 ? 1 : 0,
  }));
}

let fallbackRepos: RepoSummary[] = withFallbackRemoteState([
  {
    id: "LiliaGithub",
    name: "LiliaGithub",
    path: "D:\\PROJECT\\workspace\\LiliaGithub",
    relativePath: "LiliaGithub",
    currentBranch: "codex/readme-gallery",
    remoteUrl: "https://github.com/sena-nana/LiliaGithub.git",
    githubFullName: "sena-nana/LiliaGithub",
    ahead: 2,
    behind: 1,
    stagedCount: 2,
    unstagedCount: 3,
    untrackedCount: 1,
    conflictCount: 0,
    lastCommitAt: 1_781_990_000,
    lastCommitMessage: "更新 README 展示截图",
    languageStats: [
      { language: "TypeScript", bytes: 118_000, lines: 3120 },
      { language: "Vue", bytes: 86_000, lines: 1910 },
      { language: "Rust", bytes: 54_000, lines: 1280 },
      { language: "CSS", bytes: 18_000, lines: 640 },
    ],
    languageStatsUpdatedAt: Date.now(),
    worktree: {
      role: "standalone",
      sharedRepoKey: "repo:LiliaGithub",
      mainRepoId: null,
    },
  },
  {
    id: "Lilia",
    name: "LiliaCode",
    path: "D:\\PROJECT\\workspace\\Lilia",
    relativePath: "Lilia",
    currentBranch: "main",
    remoteUrl: "https://github.com/sena-nana/LiliaCode.git",
    githubFullName: "sena-nana/LiliaCode",
    ahead: 0,
    behind: 2,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictCount: 0,
    lastCommitAt: 1_781_930_000,
    lastCommitMessage: "整理 Codex 运行时边界",
    languageStats: [
      { language: "TypeScript", bytes: 184_000, lines: 5200 },
      { language: "Vue", bytes: 132_000, lines: 2900 },
      { language: "Rust", bytes: 88_000, lines: 2140 },
      { language: "CSS", bytes: 32_000, lines: 980 },
    ],
    languageStatsUpdatedAt: Date.now(),
    worktree: {
      role: "standalone",
      sharedRepoKey: "repo:Lilia",
      mainRepoId: null,
    },
  },
  {
    id: "LiliaDocs",
    name: "LiliaDocs",
    path: "D:\\PROJECT\\workspace\\LiliaDocs",
    relativePath: "LiliaDocs",
    currentBranch: "main",
    remoteUrl: "https://github.com/sena-nana/LiliaDocs.git",
    githubFullName: "sena-nana/LiliaDocs",
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 4,
    untrackedCount: 0,
    conflictCount: 0,
    lastCommitAt: 1_781_820_000,
    lastCommitMessage: "补充发布说明",
    languageStats: [
      { language: "Markdown", bytes: 72_000, lines: 1650 },
      { language: "Vue", bytes: 22_000, lines: 480 },
      { language: "CSS", bytes: 8_000, lines: 210 },
    ],
    languageStatsUpdatedAt: Date.now(),
    worktree: {
      role: "standalone",
      sharedRepoKey: "repo:LiliaDocs",
      mainRepoId: null,
    },
  },
  {
    id: "Mutsuki",
    name: "Mutsuki",
    path: "D:\\PROJECT\\workspace\\Mutsuki",
    relativePath: "Mutsuki",
    currentBranch: "runtime-compat",
    remoteUrl: "https://github.com/sena-nana/Mutsuki.git",
    githubFullName: "sena-nana/Mutsuki",
    ahead: 4,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 1,
    untrackedCount: 0,
    conflictCount: 0,
    lastCommitAt: 1_781_700_000,
    lastCommitMessage: "恢复兼容 API",
    languageStats: [
      { language: "Rust", bytes: 148_000, lines: 4100 },
      { language: "TypeScript", bytes: 24_000, lines: 620 },
      { language: "TOML", bytes: 4_000, lines: 120 },
    ],
    languageStatsUpdatedAt: Date.now(),
    worktree: {
      role: "standalone",
      sharedRepoKey: "repo:Mutsuki",
      mainRepoId: null,
    },
  },
  {
    id: "LiliaTodo",
    name: "LiliaTodo",
    path: "D:\\PROJECT\\workspace\\LiliaTodo",
    relativePath: "LiliaTodo",
    currentBranch: "main",
    remoteUrl: "https://github.com/sena-nana/LiliaTodo.git",
    githubFullName: "sena-nana/LiliaTodo",
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictCount: 0,
    lastCommitAt: 1_781_560_000,
    lastCommitMessage: "拆分日历和 WebDAV 清理提交",
    languageStats: [
      { language: "TypeScript", bytes: 98_000, lines: 2600 },
      { language: "Vue", bytes: 54_000, lines: 1180 },
      { language: "CSS", bytes: 12_000, lines: 340 },
    ],
    languageStatsUpdatedAt: Date.now(),
    worktree: {
      role: "standalone",
      sharedRepoKey: "repo:LiliaTodo",
      mainRepoId: null,
    },
  },
]);
if (useDefaultFallback) {
  fallbackRepos = createDefaultFallbackRepos();
}
const baseFallbackRepos = fallbackRepos.map(cloneRepoSummary);

function createDefaultFallbackRepos(): RepoSummary[] {
  const repos: FallbackRepoInput[] = [
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
      languageStats: [
        { language: "TypeScript", bytes: 66_000, lines: 1800 },
        { language: "Vue", bytes: 42_000, lines: 920 },
        { language: "Rust", bytes: 32_000, lines: 760 },
        { language: "CSS", bytes: 10_000, lines: 360 },
      ],
      languageStatsUpdatedAt: Date.now(),
      worktree: {
        role: "standalone",
        sharedRepoKey: "repo:LiliaGithub",
        mainRepoId: null,
      },
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
      languageStats: [
        { language: "TypeScript", bytes: 52_000, lines: 1420 },
        { language: "Vue", bytes: 28_000, lines: 610 },
        { language: "CSS", bytes: 8_000, lines: 250 },
      ],
      languageStatsUpdatedAt: Date.now(),
      worktree: {
        role: "standalone",
        sharedRepoKey: "repo:Lilia",
        mainRepoId: null,
      },
    },
  ];
  if (useAgentDebugMockWorkspace) {
    repos.push({
      id: "LiliaGithub-linked-worktree",
      name: "LiliaGithub-linked-worktree",
      path: "C:\\Files\\workspace\\LiliaGithub-linked-worktree",
      relativePath: "LiliaGithub-linked-worktree",
      currentBranch: "feature/agent-debug-linked-worktree",
      remoteUrl: "https://github.com/sena-nana/LiliaGithub.git",
      githubFullName: "sena-nana/LiliaGithub",
      ahead: 0,
      behind: 0,
      stagedCount: 0,
      unstagedCount: 1,
      untrackedCount: 0,
      conflictCount: 0,
      lastCommitAt: 1_785_010_000,
      lastCommitMessage: "验证 linked worktree 侧栏路径",
      languageStats: [
        { language: "TypeScript", bytes: 16_000, lines: 420 },
        { language: "Vue", bytes: 8_000, lines: 190 },
      ],
      languageStatsUpdatedAt: Date.now(),
      worktree: {
        role: "linked",
        sharedRepoKey: "repo:LiliaGithub",
        mainRepoId: "LiliaGithub",
      },
    });
  }
  return withFallbackRemoteState(repos);
}

const defaultFallbackBinding: GitHubBindingStatus = {
  state: "bound",
  clientIdConfigured: true,
  clientIdSource: "bundled",
  binding: {
    login: "lilia-user",
    avatarUrl: null,
    boundAt: Date.now(),
    scopes: ["repo", "workflow", "read:user", "read:org", "delete_repo", "notifications"],
    clientIdSource: "bundled",
  },
};

const CONTRIBUTION_DAYS = 371;
const CONTRIBUTION_REPO_LIMIT = 30;
function createFallbackGitHubRepos(): GitHubRepoSummary[] {
  if (useDefaultFallback) {
    return [
      {
        id: 1,
        name: "LiliaGithub",
        fullName: "sena-nana/LiliaGithub",
        ownerLogin: "sena-nana",
        private: false,
        disabled: false,
        archived: false,
        description: "Local GitHub workspace manager",
        defaultBranch: "main",
        createdAt: "2026-06-08T09:00:00Z",
        updatedAt: "2026-06-11T00:00:00Z",
        cloneUrl: "https://github.com/sena-nana/LiliaGithub.git",
        htmlUrl: "https://github.com/sena-nana/LiliaGithub",
      },
      {
        id: 2,
        name: "Lilia",
        fullName: "sena-nana/Lilia",
        ownerLogin: "sena-nana",
        private: true,
        disabled: false,
        archived: false,
        description: "Desktop agent workbench",
        defaultBranch: "main",
        createdAt: "2026-06-07T09:00:00Z",
        updatedAt: "2026-06-10T00:00:00Z",
        cloneUrl: "https://github.com/sena-nana/Lilia.git",
        htmlUrl: "https://github.com/sena-nana/Lilia",
      },
    ];
  }
  return [
    {
      id: 1,
      name: "LiliaGithub",
      fullName: "sena-nana/LiliaGithub",
      ownerLogin: "sena-nana",
      private: false,
      disabled: false,
      archived: false,
      description: "Local GitHub workspace and repository manager",
      defaultBranch: "main",
      createdAt: "2026-06-08T09:00:00Z",
      updatedAt: "2026-06-21T09:20:00Z",
      cloneUrl: "https://github.com/sena-nana/LiliaGithub.git",
      htmlUrl: "https://github.com/sena-nana/LiliaGithub",
    },
    {
      id: 2,
      name: "LiliaCode",
      fullName: "sena-nana/LiliaCode",
      ownerLogin: "sena-nana",
      private: true,
      disabled: false,
      archived: false,
      description: "Desktop agent workbench",
      defaultBranch: "main",
      createdAt: "2026-05-12T09:00:00Z",
      updatedAt: "2026-06-21T08:40:00Z",
      cloneUrl: "https://github.com/sena-nana/LiliaCode.git",
      htmlUrl: "https://github.com/sena-nana/LiliaCode",
    },
    {
      id: 3,
      name: "LiliaDocs",
      fullName: "sena-nana/LiliaDocs",
      ownerLogin: "sena-nana",
      private: false,
      disabled: false,
      archived: false,
      description: "Documentation and release notes for the Lilia family",
      defaultBranch: "main",
      createdAt: "2026-06-01T09:00:00Z",
      updatedAt: "2026-06-20T15:30:00Z",
      cloneUrl: "https://github.com/sena-nana/LiliaDocs.git",
      htmlUrl: "https://github.com/sena-nana/LiliaDocs",
    },
    {
      id: 4,
      name: "Mutsuki",
      fullName: "sena-nana/Mutsuki",
      ownerLogin: "sena-nana",
      private: true,
      disabled: false,
      archived: false,
      description: "Runtime compatibility layer for Lilia desktop apps",
      defaultBranch: "main",
      createdAt: "2026-04-18T09:00:00Z",
      updatedAt: "2026-06-20T11:10:00Z",
      cloneUrl: "https://github.com/sena-nana/Mutsuki.git",
      htmlUrl: "https://github.com/sena-nana/Mutsuki",
    },
    {
      id: 5,
      name: "LiliaTodo",
      fullName: "sena-nana/LiliaTodo",
      ownerLogin: "sena-nana",
      private: false,
      disabled: false,
      archived: false,
      description: "Focused todo and calendar workspace",
      defaultBranch: "main",
      createdAt: "2026-03-04T09:00:00Z",
      updatedAt: "2026-06-19T18:00:00Z",
      cloneUrl: "https://github.com/sena-nana/LiliaTodo.git",
      htmlUrl: "https://github.com/sena-nana/LiliaTodo",
    },
  ];
}

let fallbackGitHubRepos: GitHubRepoSummary[] = createFallbackGitHubRepos();

function cloneGitHubRepoSummary(repo: GitHubRepoSummary): GitHubRepoSummary {
  return {
    ...repo,
    owner: repo.owner ? { ...repo.owner } : {
      login: repo.ownerLogin,
      kind: repo.ownerLogin === "lilia-user" ? "user" : "organization",
      avatarUrl: null,
    },
    permissions: repo.permissions ? { ...repo.permissions } : {
      pull: true,
      push: true,
      admin: true,
    },
  };
}

function renamedGitHubRepoSummary(repo: GitHubRepoSummary, fullName: string, name: string): GitHubRepoSummary {
  const ownerLogin = fullName.split("/")[0] || repo.ownerLogin;
  return {
    ...repo,
    name,
    fullName,
    ownerLogin,
    owner: repo.owner ? { ...repo.owner, login: ownerLogin } : repo.owner,
    cloneUrl: `https://github.com/${fullName}.git`,
    htmlUrl: `https://github.com/${fullName}`,
  };
}

function cloneGitHubRepoManagement(repo: GitHubRepoManagement): GitHubRepoManagement {
  return {
    ...repo,
    viewerCanAdminister: repo.viewerCanAdminister ?? true,
    topics: [...repo.topics],
  };
}

function cloneFallbackData<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneRepoSummary(repo: RepoSummary): RepoSummary {
  return {
    ...repo,
    remoteBranchStates: (repo.remoteBranchStates ?? []).map((state) => ({ ...state })),
    remotesNeedingPull: repo.remotesNeedingPull ?? (repo.behind > 0 ? 1 : 0),
    remotesNeedingPush: repo.remotesNeedingPush ?? (repo.ahead > 0 ? 1 : 0),
    languageStats: repo.languageStats.map((stat) => ({ ...stat })),
    worktree: { ...repo.worktree },
  };
}

function cloneContributionDay(day: GitHubContributionDay): GitHubContributionDay {
  return {
    ...day,
    repositories: day.repositories?.map((repo) => ({ ...repo })),
  };
}

function cloneStartupCache(cache: WorkspaceStartupCache): WorkspaceStartupCache {
  return {
    workspaceRoot: cache.workspaceRoot,
    bindingLogin: cache.bindingLogin,
    reposById: Object.fromEntries(
      Object.entries(cache.reposById).map(([repoId, entry]) => [
        repoId,
        {
          summary: cloneRepoSummary(entry.summary),
          cachedAt: entry.cachedAt,
          remoteCheckedAt: entry.remoteCheckedAt ?? null,
        },
      ]),
    ),
    contributions: cache.contributions
      ? {
          days: cache.contributions.days.map(cloneContributionDay),
          meta: { ...cache.contributions.meta },
          cachedAt: cache.contributions.cachedAt,
        }
      : null,
  };
}

function cloneBranchSummary(branch: BranchSummary): BranchSummary {
  return {
    ...branch,
    checkedOutWorktreePaths: [...branch.checkedOutWorktreePaths],
  };
}

function clonePullRequest(pullRequest: GitHubPullRequest): GitHubPullRequest {
  return {
    ...pullRequest,
    labels: [...(pullRequest.labels ?? [])],
    assignees: [...(pullRequest.assignees ?? [])],
    milestone: pullRequest.milestone ? { ...pullRequest.milestone } : null,
    projectItems: pullRequest.projectItems?.map((project) => ({ ...project })) ?? [],
    reviewers: pullRequest.reviewers?.map((reviewer) => ({ ...reviewer })) ?? [],
    developmentItems: pullRequest.developmentItems?.map((item) => ({ ...item })) ?? [],
  };
}

function cloneIssue(issue: GitHubIssue): GitHubIssue {
  return {
    ...issue,
    labels: [...issue.labels],
    assignees: [...issue.assignees],
    milestone: issue.milestone ? { ...issue.milestone } : null,
    projectItems: issue.projectItems?.map((project) => ({ ...project })) ?? [],
    developmentItems: issue.developmentItems?.map((item) => ({ ...item })) ?? [],
  };
}

function fallbackPullRequestAccountIssueItem(
  repoFullName: string,
  pullRequest: GitHubPullRequest,
): GitHubAccountIssueItem {
  return {
    repoFullName,
    pullRequest: true,
    issue: {
      number: pullRequest.number,
      title: pullRequest.title,
      state: pullRequest.state,
      body: pullRequest.body,
      labels: [...pullRequest.labels],
      assignees: [...pullRequest.assignees],
      author: pullRequest.author,
      milestone: pullRequest.milestone ? { ...pullRequest.milestone } : null,
      comments: pullRequest.comments ?? 0,
      projectItems: pullRequest.projectItems?.map((project) => ({ ...project })) ?? [],
      developmentItems: pullRequest.developmentItems?.map((item) => ({ ...item })) ?? [],
      htmlUrl: pullRequest.htmlUrl,
      updatedAt: pullRequest.updatedAt,
      createdAt: pullRequest.createdAt,
    },
  };
}

function cloneDiscussionTimelineItem(item: GitHubDiscussionTimelineItem): GitHubDiscussionTimelineItem {
  return { ...item };
}

function cloneIssueDiscussion(discussion: GitHubIssueDiscussion): GitHubIssueDiscussion {
  return {
    issue: cloneIssue(discussion.issue),
    timeline: discussion.timeline.map(cloneDiscussionTimelineItem),
  };
}

function clonePullRequestDiscussion(discussion: GitHubPullRequestDiscussion): GitHubPullRequestDiscussion {
  return {
    pullRequest: clonePullRequest(discussion.pullRequest),
    timeline: discussion.timeline.map(cloneDiscussionTimelineItem),
  };
}

function clonePullRequestCheck(check: GitHubPullRequestCheck): GitHubPullRequestCheck {
  return { ...check };
}

function cloneRepoStashEntry(entry: RepoStashEntry): RepoStashEntry {
  return { ...entry };
}

function cloneCommitFileChange(file: CommitFileChange): CommitFileChange {
  return {
    ...file,
    hunks: file.hunks.map((hunk) => ({
      ...hunk,
      lines: hunk.lines.map((line) => ({ ...line })),
    })),
  };
}

function cloneCommitSummary(commit: CommitSummary): CommitSummary {
  return {
    ...commit,
    parents: [...commit.parents],
    refs: [...commit.refs],
  };
}

function cloneCommitDetail(detail: CommitDetail): CommitDetail {
  return {
    ...detail,
    parents: [...detail.parents],
    refs: [...detail.refs],
    files: detail.files.map(cloneCommitFileChange),
  };
}

function cloneRepoRemote(remote: RepoRemote): RepoRemote {
  return { ...remote };
}

function createFallbackGitHubRepoOwners(): GitHubRepoOwner[] {
  return [
    {
      login: "lilia-user",
      kind: "user",
      avatarUrl: null,
      membershipVisible: true,
      membershipComplete: true,
      repositoryAccessVisible: true,
      source: "authenticated_user",
    },
    {
      login: "sena-nana",
      kind: "organization",
      avatarUrl: null,
      membershipVisible: true,
      membershipComplete: true,
      repositoryAccessVisible: true,
      source: "both",
    },
  ];
}

function createFallbackGitHubRepoTemplates(): GitHubRepoTemplate[] {
  return [
    {
      id: 9101,
      name: "LiliaTemplate",
      fullName: "sena-nana/LiliaTemplate",
      ownerLogin: "sena-nana",
      private: false,
      description: "Lilia desktop application template",
    },
  ];
}

function createFallbackGitHubRepoManagement(): Record<string, GitHubRepoManagement> {
  if (useDefaultFallback) {
    return {
      "sena-nana/LiliaGithub": {
        fullName: "sena-nana/LiliaGithub",
        name: "LiliaGithub",
        description: "Local GitHub workspace manager",
        homepage: "",
        topics: ["tauri", "vue", "github"],
        private: false,
        defaultBranch: "main",
        hasIssues: true,
        hasWiki: false,
        hasProjects: true,
        hasDiscussions: false,
        allowMergeCommit: true,
        allowSquashMerge: true,
        allowRebaseMerge: true,
        allowAutoMerge: false,
        deleteBranchOnMerge: true,
        allowForking: true,
        webCommitSignoffRequired: false,
        stargazersCount: 128,
        watchersCount: 9,
        forksCount: 14,
        htmlUrl: "https://github.com/sena-nana/LiliaGithub",
        license: null,
      },
      "sena-nana/Lilia": {
        fullName: "sena-nana/Lilia",
        name: "Lilia",
        description: "Desktop agent workbench",
        homepage: "",
        topics: ["desktop", "agent"],
        private: true,
        defaultBranch: "main",
        hasIssues: true,
        hasWiki: true,
        hasProjects: false,
        hasDiscussions: false,
        allowMergeCommit: true,
        allowSquashMerge: true,
        allowRebaseMerge: false,
        allowAutoMerge: false,
        deleteBranchOnMerge: false,
        allowForking: false,
        webCommitSignoffRequired: false,
        stargazersCount: 86,
        watchersCount: 7,
        forksCount: 6,
        htmlUrl: "https://github.com/sena-nana/Lilia",
        license: null,
      },
    };
  }
  return {
    "sena-nana/LiliaGithub": {
      fullName: "sena-nana/LiliaGithub",
      name: "LiliaGithub",
      description: "Local GitHub workspace and repository manager",
      homepage: "https://sena-nana.github.io/LiliaGithub/",
      topics: ["tauri", "vue", "github", "desktop", "workspace"],
      private: false,
      defaultBranch: "main",
      hasIssues: true,
      hasWiki: false,
      hasProjects: true,
      hasDiscussions: false,
      allowMergeCommit: true,
      allowSquashMerge: true,
      allowRebaseMerge: true,
      allowAutoMerge: false,
      deleteBranchOnMerge: true,
      allowForking: true,
      webCommitSignoffRequired: false,
      stargazersCount: 128,
      watchersCount: 9,
      forksCount: 14,
      htmlUrl: "https://github.com/sena-nana/LiliaGithub",
      license: null,
    },
    "sena-nana/LiliaCode": {
      fullName: "sena-nana/LiliaCode",
      name: "LiliaCode",
      description: "Desktop agent workbench",
      homepage: "https://sena-nana.github.io/LiliaCode/",
      topics: ["desktop", "agent", "codex", "claude"],
      private: true,
      defaultBranch: "main",
      hasIssues: true,
      hasWiki: true,
      hasProjects: false,
      hasDiscussions: false,
      allowMergeCommit: true,
      allowSquashMerge: true,
      allowRebaseMerge: false,
      allowAutoMerge: false,
      deleteBranchOnMerge: false,
      allowForking: false,
      webCommitSignoffRequired: false,
      stargazersCount: 86,
      watchersCount: 7,
      forksCount: 6,
      htmlUrl: "https://github.com/sena-nana/LiliaCode",
      license: null,
    },
    "sena-nana/LiliaDocs": {
      fullName: "sena-nana/LiliaDocs",
      name: "LiliaDocs",
      description: "Documentation and release notes for the Lilia family",
      homepage: "https://sena-nana.github.io/LiliaDocs/",
      topics: ["docs", "vitepress", "release-notes"],
      private: false,
      defaultBranch: "main",
      hasIssues: true,
      hasWiki: false,
      hasProjects: true,
      hasDiscussions: true,
      allowMergeCommit: true,
      allowSquashMerge: true,
      allowRebaseMerge: true,
      allowAutoMerge: true,
      deleteBranchOnMerge: true,
      allowForking: true,
      webCommitSignoffRequired: false,
      stargazersCount: 42,
      watchersCount: 5,
      forksCount: 8,
      htmlUrl: "https://github.com/sena-nana/LiliaDocs",
      license: null,
    },
    "sena-nana/Mutsuki": {
      fullName: "sena-nana/Mutsuki",
      name: "Mutsuki",
      description: "Runtime compatibility layer for Lilia desktop apps",
      homepage: "",
      topics: ["runtime", "rust", "mcp"],
      private: true,
      defaultBranch: "main",
      hasIssues: true,
      hasWiki: false,
      hasProjects: false,
      hasDiscussions: false,
      allowMergeCommit: true,
      allowSquashMerge: true,
      allowRebaseMerge: false,
      allowAutoMerge: false,
      deleteBranchOnMerge: false,
      allowForking: false,
      webCommitSignoffRequired: true,
      stargazersCount: 31,
      watchersCount: 4,
      forksCount: 3,
      htmlUrl: "https://github.com/sena-nana/Mutsuki",
      license: null,
    },
    "sena-nana/LiliaTodo": {
      fullName: "sena-nana/LiliaTodo",
      name: "LiliaTodo",
      description: "Focused todo and calendar workspace",
      homepage: "",
      topics: ["todo", "calendar", "webdav"],
      private: false,
      defaultBranch: "main",
      hasIssues: true,
      hasWiki: false,
      hasProjects: true,
      hasDiscussions: false,
      allowMergeCommit: true,
      allowSquashMerge: true,
      allowRebaseMerge: true,
      allowAutoMerge: false,
      deleteBranchOnMerge: true,
      allowForking: true,
      webCommitSignoffRequired: false,
      stargazersCount: 54,
      watchersCount: 6,
      forksCount: 10,
      htmlUrl: "https://github.com/sena-nana/LiliaTodo",
      license: null,
    },
  };
}

function createFallbackGitHubIssues(): Record<string, GitHubIssue[]> {
  if (useDefaultFallback) {
    return {
      "sena-nana/LiliaGithub": [
        {
          number: 12,
          title: "补齐仓库管理入口",
          state: "open",
          body: "需要在桌面端管理仓库设置和 issue。",
          labels: ["enhancement"],
          assignees: ["lilia-user"],
          developmentItems: [{
            id: "pull:sena-nana/liliagithub:7",
            kind: "pullRequest",
            label: "PR #7 补齐 Git 仓库批量操作",
            url: "https://github.com/sena-nana/LiliaGithub/pull/7",
            number: 7,
            state: "open",
            repositoryFullName: "sena-nana/LiliaGithub",
          }],
          htmlUrl: "https://github.com/sena-nana/LiliaGithub/issues/12",
          updatedAt: "2026-06-17T12:00:00Z",
          createdAt: "2026-06-16T12:00:00Z",
        },
      ],
    };
  }
  return {
    "sena-nana/LiliaGithub": [
      {
        number: 28,
        title: "README 展示图需要覆盖首页和项目详情",
        state: "open",
        body: "为公开 README 准备稳定的演示数据和截图资产。",
          labels: ["docs", "design"],
          assignees: ["lilia-user"],
          developmentItems: [{
            id: "pull:sena-nana/liliagithub:32",
            kind: "pullRequest",
            label: "PR #32 更新 README 展示截图",
            url: "https://github.com/sena-nana/LiliaGithub/pull/32",
            number: 32,
            state: "open",
            repositoryFullName: "sena-nana/LiliaGithub",
          }],
          htmlUrl: "https://github.com/sena-nana/LiliaGithub/issues/28",
          updatedAt: "2026-06-21T09:12:00Z",
          createdAt: "2026-06-21T08:40:00Z",
      },
      {
        number: 21,
        title: "批量同步预检需要展示阻塞原因",
        state: "open",
        body: "pull / push 队列应在执行前解释 eligible、blocked 和 warnings。",
        labels: ["workflow"],
        assignees: ["sena-nana"],
        htmlUrl: "https://github.com/sena-nana/LiliaGithub/issues/21",
        updatedAt: "2026-06-20T13:30:00Z",
        createdAt: "2026-06-18T11:00:00Z",
      },
      {
        number: 16,
        title: "仓库详情页补充 Actions 入口",
        state: "closed",
        body: "在 project tab 中展示 workflow runs。",
        labels: ["github"],
        assignees: [],
        htmlUrl: "https://github.com/sena-nana/LiliaGithub/issues/16",
        updatedAt: "2026-06-19T18:00:00Z",
        createdAt: "2026-06-16T12:00:00Z",
      },
    ],
    "sena-nana/LiliaCode": [
      {
        number: 84,
        title: "统一 runtime command 和 workflow intent 边界",
        state: "open",
        body: "保持用户可见工作流与后端运行时命令分离。",
        labels: ["architecture"],
        assignees: ["lilia-user"],
        htmlUrl: "https://github.com/sena-nana/LiliaCode/issues/84",
        updatedAt: "2026-06-21T08:05:00Z",
        createdAt: "2026-06-19T09:15:00Z",
      },
    ],
    "sena-nana/LiliaDocs": [
      {
        number: 9,
        title: "整理 first alpha 发布说明",
        state: "open",
        body: "文档站需要记录安装包、验证方式和已知限制。",
        labels: ["release"],
        assignees: ["sena-nana"],
        htmlUrl: "https://github.com/sena-nana/LiliaDocs/issues/9",
        updatedAt: "2026-06-20T15:30:00Z",
        createdAt: "2026-06-20T09:30:00Z",
      },
    ],
    "sena-nana/Mutsuki": [
      {
        number: 17,
        title: "恢复 OperationBackend 兼容 API",
        state: "closed",
        body: "主应用仍依赖旧调用面，运行时先提供兼容层。",
        labels: ["runtime", "compat"],
        assignees: ["lilia-user"],
        htmlUrl: "https://github.com/sena-nana/Mutsuki/issues/17",
        updatedAt: "2026-06-20T11:10:00Z",
        createdAt: "2026-06-18T17:00:00Z",
      },
    ],
  };
}

function createFallbackGitHubPullRequests(): Record<string, GitHubPullRequest[]> {
  if (useDefaultFallback) {
    return {
      "sena-nana/LiliaGithub": [
        {
          number: 7,
          title: "补齐 Git 仓库批量操作",
          state: "open",
          draft: false,
          body: "补齐 pull / push / sync / fetch all 基础能力。",
          labels: ["git", "workflow"],
          assignees: ["lilia-user"],
          milestone: { number: 1, title: "v1", state: "open" },
          comments: 2,
          projectItems: [{ id: "PVT_LiliaGithub", title: "Roadmap" }],
          reviewers: [{ login: "sena-nana", kind: "user", state: "requested" }],
          developmentItems: [{
            id: "issue:sena-nana/liliagithub:12",
            kind: "issue",
            label: "Issue #12 补齐仓库管理入口",
            url: "https://github.com/sena-nana/LiliaGithub/issues/12",
            number: 12,
            state: "open",
            repositoryFullName: "sena-nana/LiliaGithub",
          }, {
            id: "commit:sena-nana/liliagithub:abcdef1234567890",
            kind: "commit",
            label: "abcdef1 接入详情侧栏数据",
            url: "https://github.com/sena-nana/LiliaGithub/commit/abcdef1234567890",
            sha: "abcdef1234567890",
            repositoryFullName: "sena-nana/LiliaGithub",
          }],
          commitCount: 2,
          htmlUrl: "https://github.com/sena-nana/LiliaGithub/pull/7",
          updatedAt: "2026-06-17T12:20:00Z",
          createdAt: "2026-06-16T09:00:00Z",
          author: "lilia-user",
          baseBranch: "main",
          headBranch: "codex/project-view",
          merged: false,
          mergeable: true,
          mergeableState: "clean",
        },
      ],
    };
  }
  return {
    "sena-nana/LiliaGithub": [
      {
        number: 32,
        title: "更新 README 展示截图",
        state: "open",
        draft: false,
        body: "加入 mock 数据、截图资产和 README 展示区。",
        labels: ["documentation", "ui"],
        assignees: ["lilia-user"],
        milestone: { number: 1, title: "v1", state: "open" },
          comments: 3,
          projectItems: [{ id: "PVT_LiliaGithub", title: "Roadmap" }],
          reviewers: [{ login: "sena-nana", kind: "user", state: "requested" }],
          developmentItems: [{
            id: "issue:sena-nana/liliagithub:28",
            kind: "issue",
            label: "Issue #28 README 展示图需要覆盖首页和项目详情",
            url: "https://github.com/sena-nana/LiliaGithub/issues/28",
            number: 28,
            state: "open",
            repositoryFullName: "sena-nana/LiliaGithub",
          }, {
            id: "commit:sena-nana/liliagithub:abcdef1234567890",
            kind: "commit",
            label: "abcdef1 更新 README 展示截图",
            url: "https://github.com/sena-nana/LiliaGithub/commit/abcdef1234567890",
            sha: "abcdef1234567890",
            repositoryFullName: "sena-nana/LiliaGithub",
          }],
          commitCount: 2,
          htmlUrl: "https://github.com/sena-nana/LiliaGithub/pull/32",
          updatedAt: "2026-06-21T09:24:00Z",
          createdAt: "2026-06-21T08:50:00Z",
        author: "lilia-user",
        baseBranch: "main",
        headBranch: "codex/readme-gallery",
        merged: false,
        mergeable: true,
        mergeableState: "clean",
      },
      {
        number: 27,
        title: "仓库快速启动主视图",
        state: "closed",
        draft: false,
        body: "把命令候选和运行日志移到主内容区。",
        labels: ["ui", "workflow"],
        assignees: [],
        milestone: { number: 1, title: "v1", state: "open" },
        comments: 5,
        projectItems: [{ id: "PVT_LiliaGithub", title: "Roadmap" }],
        htmlUrl: "https://github.com/sena-nana/LiliaGithub/pull/27",
        updatedAt: "2026-06-20T10:12:00Z",
        createdAt: "2026-06-19T13:00:00Z",
        author: "sena-nana",
        baseBranch: "main",
        headBranch: "codex/quick-launch",
        merged: true,
        mergeable: false,
        mergeableState: "merged",
      },
    ],
    "sena-nana/LiliaCode": [
      {
        number: 118,
        title: "拆分 workflow 与 runtime options",
        state: "open",
        draft: false,
        body: "同步前端协议、后端持久化和 provider adapter。",
        labels: ["runtime", "protocol"],
        assignees: ["sena-nana"],
        milestone: null,
        comments: 4,
        projectItems: [],
        htmlUrl: "https://github.com/sena-nana/LiliaCode/pull/118",
        updatedAt: "2026-06-21T08:42:00Z",
        createdAt: "2026-06-20T22:00:00Z",
        author: "sena-nana",
        baseBranch: "main",
        headBranch: "codex/runtime-boundary",
        merged: false,
        mergeable: true,
        mergeableState: "unstable",
      },
    ],
  };
}

function createFallbackGitHubPullRequestChecks(): Record<string, Record<number, GitHubPullRequestCheck[]>> {
  if (useDefaultFallback) {
    return {
      "sena-nana/LiliaGithub": {
        7: [
          {
            id: 9001,
            name: "verify",
            status: "completed",
            conclusion: "success",
            detailsUrl: "https://github.com/sena-nana/LiliaGithub/actions/runs/1201",
            htmlUrl: "https://github.com/sena-nana/LiliaGithub/actions/runs/1201",
            startedAt: "2026-06-17T12:00:00Z",
            completedAt: "2026-06-17T12:08:00Z",
          },
        ],
      },
    };
  }
  return {
    "sena-nana/LiliaGithub": {
      32: [
        {
          id: 9301,
          name: "verify",
          status: "completed",
          conclusion: "success",
          detailsUrl: "https://github.com/sena-nana/LiliaGithub/actions/runs/1301",
          htmlUrl: "https://github.com/sena-nana/LiliaGithub/actions/runs/1301",
          startedAt: "2026-06-21T09:10:00Z",
          completedAt: "2026-06-21T09:18:00Z",
        },
        {
          id: 9302,
          name: "pages",
          status: "completed",
          conclusion: "success",
          detailsUrl: "https://github.com/sena-nana/LiliaGithub/actions/runs/1302",
          htmlUrl: "https://github.com/sena-nana/LiliaGithub/actions/runs/1302",
          startedAt: "2026-06-21T09:18:00Z",
          completedAt: "2026-06-21T09:21:00Z",
        },
      ],
    },
    "sena-nana/LiliaCode": {
      118: [
        {
          id: 9401,
          name: "desktop verify",
          status: "completed",
          conclusion: "failure",
          detailsUrl: "https://github.com/sena-nana/LiliaCode/actions/runs/4102",
          htmlUrl: "https://github.com/sena-nana/LiliaCode/actions/runs/4102",
          startedAt: "2026-06-21T08:22:00Z",
          completedAt: "2026-06-21T08:36:00Z",
        },
      ],
    },
  };
}

function releaseAsset(
  id: number,
  repoFullName: string,
  tagName: string,
  name: string,
  size: number,
  overrides: Partial<GitHubReleaseAsset> = {},
): GitHubReleaseAsset {
  return {
    id,
    name,
    label: null,
    contentType: "application/octet-stream",
    size,
    downloadCount: 0,
    state: "uploaded",
    browserDownloadUrl: `https://github.com/${repoFullName}/releases/download/${encodeURIComponent(tagName)}/${encodeURIComponent(name)}`,
    createdAt: "2026-06-21T09:20:00Z",
    updatedAt: "2026-06-21T09:20:00Z",
    uploader: "sena-nana",
    ...overrides,
  };
}

function createFallbackGitHubReleases(): Record<string, GitHubRelease[]> {
  const repoFullName = "sena-nana/LiliaGithub";
  return {
    [repoFullName]: [
      {
        id: 501,
        tagName: "v1.0.0-beta",
        targetCommitish: "main",
        name: "LiliaGithub v1.0.0-beta",
        body: "版本更新到 v1.0.0-beta，并同步本地构建与发布配置。",
        draft: false,
        prerelease: true,
        immutable: false,
        makeLatest: "legacy",
        htmlUrl: `https://github.com/${repoFullName}/releases/tag/v1.0.0-beta`,
        uploadUrl: `https://uploads.github.com/repos/${repoFullName}/releases/501/assets{?name,label}`,
        tarballUrl: `https://api.github.com/repos/${repoFullName}/tarball/v1.0.0-beta`,
        zipballUrl: `https://api.github.com/repos/${repoFullName}/zipball/v1.0.0-beta`,
        createdAt: "2026-06-21T09:12:00Z",
        publishedAt: "2026-06-21T09:24:00Z",
        author: "sena-nana",
        assets: [
          releaseAsset(8001, repoFullName, "v1.0.0-beta", "LiliaGithub_1.0.0-beta_x64-setup.exe", 42_820_000, {
            contentType: "application/vnd.microsoft.portable-executable",
            downloadCount: 28,
          }),
          releaseAsset(8002, repoFullName, "v1.0.0-beta", "LiliaGithub_1.0.0-beta_x64.dmg", 45_360_000, {
            contentType: "application/x-apple-diskimage",
            downloadCount: 9,
          }),
        ],
      },
      {
        id: 500,
        tagName: "v0.1.0-alpha.1",
        targetCommitish: "main",
        name: "LiliaGithub first alpha",
        body: "首个 alpha，包含仓库扫描、Issues、Pull Requests 和 Actions 视图。",
        draft: false,
        prerelease: true,
        immutable: false,
        makeLatest: "legacy",
        htmlUrl: `https://github.com/${repoFullName}/releases/tag/v0.1.0-alpha.1`,
        uploadUrl: `https://uploads.github.com/repos/${repoFullName}/releases/500/assets{?name,label}`,
        tarballUrl: `https://api.github.com/repos/${repoFullName}/tarball/v0.1.0-alpha.1`,
        zipballUrl: `https://api.github.com/repos/${repoFullName}/zipball/v0.1.0-alpha.1`,
        createdAt: "2026-06-18T12:00:00Z",
        publishedAt: "2026-06-18T12:30:00Z",
        author: "lilia-user",
        assets: [],
      },
    ],
    "sena-nana/LiliaDocs": [
      {
        id: 601,
        tagName: "docs-v1",
        targetCommitish: "main",
        name: "Documentation v1",
        body: "发布文档站第一版。",
        draft: false,
        prerelease: false,
        immutable: false,
        makeLatest: "true",
        htmlUrl: "https://github.com/sena-nana/LiliaDocs/releases/tag/docs-v1",
        uploadUrl: "https://uploads.github.com/repos/sena-nana/LiliaDocs/releases/601/assets{?name,label}",
        tarballUrl: null,
        zipballUrl: null,
        createdAt: "2026-06-20T15:31:00Z",
        publishedAt: "2026-06-20T15:35:00Z",
        author: "sena-nana",
        assets: [],
      },
    ],
  };
}

function createFallbackGitHubWorkflowRuns(): Record<string, GitHubWorkflowRun[]> {
  if (useDefaultFallback) {
    return {
      "sena-nana/LiliaGithub": [
        {
          id: 1201,
          name: "CI",
          displayTitle: "验证仓库详情页",
          status: "completed",
          conclusion: "success",
          branch: "main",
          event: "push",
          htmlUrl: "https://github.com/sena-nana/LiliaGithub/actions/runs/1201",
          createdAt: "2026-06-12T10:00:00Z",
          updatedAt: "2026-06-12T10:08:00Z",
        },
        {
          id: 1200,
          name: "Release",
          displayTitle: "打包桌面应用",
          status: "in_progress",
          conclusion: null,
          branch: "codex/project-view",
          event: "workflow_dispatch",
          htmlUrl: "https://github.com/sena-nana/LiliaGithub/actions/runs/1200",
          createdAt: "2026-06-12T09:00:00Z",
          updatedAt: "2026-06-12T09:02:00Z",
        },
      ],
    };
  }
  return {
    "sena-nana/LiliaGithub": [
      {
        id: 1301,
        name: "CI",
        displayTitle: "README screenshot gallery",
        status: "completed",
        conclusion: "success",
        branch: "codex/readme-gallery",
        event: "push",
        htmlUrl: "https://github.com/sena-nana/LiliaGithub/actions/runs/1301",
        createdAt: "2026-06-21T09:10:00Z",
        updatedAt: "2026-06-21T09:18:00Z",
      },
      {
        id: 1300,
        name: "Release",
        displayTitle: "alpha package smoke test",
        status: "in_progress",
        conclusion: null,
        branch: "main",
        event: "workflow_dispatch",
        htmlUrl: "https://github.com/sena-nana/LiliaGithub/actions/runs/1300",
        createdAt: "2026-06-21T08:55:00Z",
        updatedAt: "2026-06-21T09:02:00Z",
      },
    ],
    "sena-nana/LiliaCode": [
      {
        id: 4102,
        name: "Verify desktop",
        displayTitle: "runtime command split",
        status: "completed",
        conclusion: "failure",
        branch: "codex/runtime-boundary",
        event: "pull_request",
        htmlUrl: "https://github.com/sena-nana/LiliaCode/actions/runs/4102",
        createdAt: "2026-06-21T08:22:00Z",
        updatedAt: "2026-06-21T08:36:00Z",
      },
    ],
    "sena-nana/LiliaDocs": [
      {
        id: 2204,
        name: "Pages",
        displayTitle: "publish documentation",
        status: "completed",
        conclusion: "success",
        branch: "main",
        event: "push",
        htmlUrl: "https://github.com/sena-nana/LiliaDocs/actions/runs/2204",
        createdAt: "2026-06-20T15:31:00Z",
        updatedAt: "2026-06-20T15:35:00Z",
      },
    ],
    "sena-nana/Mutsuki": [
      {
        id: 771,
        name: "Cargo check",
        displayTitle: "compatibility shims",
        status: "completed",
        conclusion: "success",
        branch: "runtime-compat",
        event: "push",
        htmlUrl: "https://github.com/sena-nana/Mutsuki/actions/runs/771",
        createdAt: "2026-06-20T10:50:00Z",
        updatedAt: "2026-06-20T11:05:00Z",
      },
    ],
  };
}

function createFallbackGitHubActionNotifications(): GitHubActionNotification[] {
  return Object.entries(createFallbackGitHubWorkflowRuns())
    .flatMap(([repoFullName, runs]) =>
      runs
        .filter((run) => run.status !== "completed" || run.conclusion !== "success")
        .map((run) => ({
          id: `workflow:${repoFullName}:${run.id}`,
          repoFullName,
          title: run.displayTitle,
          reason: "ci_activity",
          subjectType: "WorkflowRun",
          subjectUrl: run.htmlUrl,
          latestCommentUrl: null,
          updatedAt: run.updatedAt,
          unread: true,
        })),
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function createFallbackGitHubWorkflowRunDetails(
  runsByRepo = fallbackGitHubWorkflowRuns,
): Record<string, Record<number, GitHubWorkflowRunDetail>> {
  return Object.fromEntries(
    Object.entries(runsByRepo).map(([repoFullName, runs]) => [
      repoFullName,
      Object.fromEntries(runs.map((run) => [run.id, fallbackWorkflowRunDetail(run)])),
    ]),
  );
}

function fallbackWorkflowRunDetail(run: GitHubWorkflowRun): GitHubWorkflowRunDetail {
  const completed = run.status === "completed";
  const success = completed && run.conclusion === "success";
  const jobStatus = completed ? "completed" : run.status;
  const jobConclusion = completed ? run.conclusion : null;
  const job = (offset: number, name: string, stepName: string, startedAt = run.createdAt) => ({
    id: run.id * 10 + offset,
    name,
    status: jobStatus,
    conclusion: jobConclusion,
    startedAt,
    completedAt: completed ? run.updatedAt : null,
    htmlUrl: run.htmlUrl,
    runnerName: "GitHub Actions",
    steps: [{
      name: stepName,
      status: jobStatus,
      conclusion: jobConclusion,
      number: 1,
      startedAt,
      completedAt: completed ? run.updatedAt : null,
    }],
  });
  return {
    run: { ...run },
    jobs: [
      {
        ...job(1, "lint", "Run lint"),
        name: "lint",
        completedAt: completed ? run.createdAt : null,
        steps: [
          {
            name: "Set up job",
            status: "completed",
            conclusion: "success",
            number: 1,
            startedAt: run.createdAt,
            completedAt: run.createdAt,
          },
          {
            name: "Run lint",
            status: jobStatus,
            conclusion: jobConclusion,
            number: 2,
            startedAt: run.createdAt,
            completedAt: completed ? run.updatedAt : null,
          },
          {
            name: "Complete job",
            status: completed ? "completed" : "queued",
            conclusion: success ? "success" : run.conclusion,
            number: 3,
            startedAt: completed ? run.updatedAt : null,
            completedAt: completed ? run.updatedAt : null,
          },
        ],
      },
      job(2, "build", "Build"),
      job(3, "test", "Run tests", completed ? run.updatedAt : run.createdAt),
      job(4, "package", "Package", completed ? run.updatedAt : run.createdAt),
    ],
    artifacts: success
      ? [{
        id: run.id * 100 + 1,
        name: "dist",
        sizeInBytes: 1840,
        expired: false,
        createdAt: run.updatedAt,
        expiresAt: "2026-07-12T10:08:00Z",
      }]
      : [],
    workflow: {
      id: run.workflowId ?? run.id,
      path: ".github/workflows/ci.yml",
      refName: run.headSha ?? run.branch,
      content: [
        "name: CI",
        "jobs:",
        "  lint:",
        "    name: lint",
        "    runs-on: ubuntu-latest",
        "    steps: []",
        "  build:",
        "    name: build",
        "    runs-on: ubuntu-latest",
        "    steps: []",
        "  test:",
        "    name: test",
        "    needs: [lint, build]",
        "    runs-on: ubuntu-latest",
        "    steps: []",
        "  package:",
        "    name: package",
        "    needs: test",
        "    runs-on: ubuntu-latest",
        "    steps: []",
      ].join("\n"),
    },
  };
}

function createFallbackGitHubWorkflowJobLogs(
  detailsByRepo = fallbackGitHubWorkflowRunDetails,
): Record<string, Record<number, GitHubWorkflowJobLog>> {
  const logs: Record<string, Record<number, GitHubWorkflowJobLog>> = {};
  for (const [repoFullName, detailsByRun] of Object.entries(detailsByRepo)) {
    logs[repoFullName] = {};
    for (const detail of Object.values(detailsByRun)) {
      for (const job of detail.jobs) {
        logs[repoFullName][job.id] = {
          jobId: job.id,
          content: job.steps.map((step) => [
            `##[group]${step.name}`,
            `${step.name} log line`,
            "##[endgroup]",
          ].join("\n")).join("\n"),
        };
      }
    }
  }
  return logs;
}

function createFallbackGitHubWorkflowArtifactEntries(
  detailsByRepo = fallbackGitHubWorkflowRunDetails,
): Record<string, Record<number, GitHubWorkflowArtifactEntry[]>> {
  const entries: Record<string, Record<number, GitHubWorkflowArtifactEntry[]>> = {};
  for (const [repoFullName, detailsByRun] of Object.entries(detailsByRepo)) {
    entries[repoFullName] = {};
    for (const detail of Object.values(detailsByRun)) {
      for (const artifact of detail.artifacts) {
        entries[repoFullName][artifact.id] = [
          { path: "README.md", name: "README.md", kind: "file", size: 58 },
          { path: "logs/build.log", name: "build.log", kind: "file", size: 36 },
        ];
      }
    }
  }
  return entries;
}

function createFallbackGitHubWorkflowArtifactPreviews(
  entriesByRepo = fallbackGitHubWorkflowArtifactEntries,
): Record<string, Record<number, Record<string, RepoFilePreview>>> {
  const previews: Record<string, Record<number, Record<string, RepoFilePreview>>> = {};
  for (const [repoFullName, entriesByArtifact] of Object.entries(entriesByRepo)) {
    previews[repoFullName] = {};
    for (const [artifactId, entries] of Object.entries(entriesByArtifact)) {
      previews[repoFullName][Number(artifactId)] = Object.fromEntries(entries.map((entry) => [
        entry.path,
        {
          path: entry.path,
          name: entry.name,
          previewKind: entry.path.endsWith(".md") ? "markdown" : "text",
          content: entry.path.endsWith(".md") ? "# Artifact\n\nFallback artifact preview." : "Fallback artifact log preview.",
          dataUrl: null,
          images: {},
          size: entry.size,
          mimeType: entry.path.endsWith(".md") ? "text/markdown" : "text/plain",
          truncated: false,
        } satisfies RepoFilePreview,
      ]));
    }
  }
  return previews;
}

function createFallbackGitHubCommits(): Record<string, CommitSummary[]> {
  if (useDefaultFallback) {
    return {
      "sena-nana/LiliaGithub": [
        {
          hash: "1234567890abcdef",
          shortHash: "1234567",
          author: "Sena",
          authorEmail: "sena@example.com",
          timestamp: 1_785_000_000,
          subject: "搭建 LiliaGithub MVP",
          parents: ["abcdef1234567890"],
          refs: ["main"],
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
    };
  }
  return {
    "sena-nana/LiliaGithub": [
      {
        hash: "d1e2f3a4b5c6d7e8",
        shortHash: "d1e2f3a",
        author: "Sena",
        authorEmail: "sena@example.com",
        timestamp: 1_781_990_000,
        subject: "更新 README 展示截图",
        parents: ["c0ffee1234567890"],
        refs: ["codex/readme-gallery"],
      },
      {
        hash: "c0ffee1234567890",
        shortHash: "c0ffee1",
        author: "Sena",
        authorEmail: "sena@example.com",
        timestamp: 1_781_920_000,
        subject: "加入仓库详情页项目视图",
        parents: [],
        refs: [],
      },
    ],
  };
}

function createFallbackGitHubCommitDetails(): Record<string, Record<string, CommitDetail>> {
  if (useDefaultFallback) {
    return {
      "sena-nana/LiliaGithub": {
        "1234567890abcdef": {
          hash: "1234567890abcdef",
          shortHash: "1234567",
          author: "Sena",
          authorEmail: "sena@example.com",
          committer: "Sena",
          committerEmail: "sena@example.com",
          timestamp: 1_785_000_000,
          subject: "搭建 LiliaGithub MVP",
          body: "搭建远程仓库项目视图。",
          parents: ["abcdef1234567890"],
          refs: ["main"],
          files: [
            {
              path: "src/pages/Home.vue",
              oldPath: null,
              status: "modified",
              additions: 24,
              deletions: 8,
              patch: "diff --git a/src/pages/Home.vue b/src/pages/Home.vue\n@@ -1,3 +1,4 @@\n <template>\n-  <h1>Lilia</h1>\n+  <h1>LiliaGithub</h1>\n+  <p>远程仓库管理</p>\n </template>",
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
                    { kind: "added", content: "  <p>远程仓库管理</p>", oldLine: null, newLine: 3 },
                    { kind: "context", content: "</template>", oldLine: 3, newLine: 4 },
                  ],
                },
              ],
            },
          ],
        },
        "abcdef1234567890": {
          hash: "abcdef1234567890",
          shortHash: "abcdef1",
          author: "Sena",
          authorEmail: "sena@example.com",
          committer: "Sena",
          committerEmail: "sena@example.com",
          timestamp: 1_784_990_000,
          subject: "初始化工作区扫描",
          body: "",
          parents: [],
          refs: [],
          files: [],
        },
      },
    };
  }
  return {
    "sena-nana/LiliaGithub": {
      "d1e2f3a4b5c6d7e8": {
        hash: "d1e2f3a4b5c6d7e8",
        shortHash: "d1e2f3a",
        author: "Sena",
        authorEmail: "sena@example.com",
        committer: "Sena",
        committerEmail: "sena@example.com",
        timestamp: 1_781_990_000,
        subject: "更新 README 展示截图",
        body: "准备演示数据和 README 图片展示区。",
        parents: ["c0ffee1234567890"],
        refs: ["codex/readme-gallery"],
        files: [
          {
            path: "src/pages/Home.vue",
            oldPath: null,
            status: "modified",
            additions: 24,
            deletions: 8,
            patch: "diff --git a/src/pages/Home.vue b/src/pages/Home.vue\n@@ -1,3 +1,4 @@\n <template>\n-  <h1>Lilia</h1>\n+  <h1>LiliaGithub</h1>\n+  <p>远程仓库管理</p>\n </template>",
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
                  { kind: "added", content: "  <p>远程仓库管理</p>", oldLine: null, newLine: 3 },
                  { kind: "context", content: "</template>", oldLine: 3, newLine: 4 },
                ],
              },
            ],
          },
        ],
      },
      "c0ffee1234567890": {
        hash: "c0ffee1234567890",
        shortHash: "c0ffee1",
        author: "Sena",
        authorEmail: "sena@example.com",
        committer: "Sena",
        committerEmail: "sena@example.com",
        timestamp: 1_781_920_000,
        subject: "加入仓库详情页项目视图",
        body: "",
        parents: [],
        refs: [],
        files: [],
      },
    },
  };
}

function createFallbackGitHubBranches(): Record<string, BranchSummary[]> {
  if (useDefaultFallback) {
    return {
      "sena-nana/LiliaGithub": [
        buildBranchSummary({ name: "main", remote: true, protected: true, tipTimestamp: 1_785_000_000 }),
        buildBranchSummary({ name: "codex/project-view", remote: true, tipTimestamp: 1_784_995_000 }),
      ],
      "sena-nana/Lilia": [
        buildBranchSummary({ name: "main", remote: true, protected: true, tipTimestamp: 1_784_990_000 }),
      ],
    };
  }
  return {
    "sena-nana/LiliaGithub": [
      buildBranchSummary({ name: "main", remote: true, protected: true, tipTimestamp: 1_781_980_000 }),
      buildBranchSummary({ name: "codex/readme-gallery", remote: true, tipTimestamp: 1_781_990_000 }),
    ],
    "sena-nana/LiliaCode": [
      buildBranchSummary({ name: "main", remote: true, protected: true, tipTimestamp: 1_781_930_000 }),
    ],
    "sena-nana/LiliaDocs": [
      buildBranchSummary({ name: "main", remote: true, protected: true, tipTimestamp: 1_781_820_000 }),
    ],
    "sena-nana/Mutsuki": [
      buildBranchSummary({ name: "main", remote: true, protected: true, tipTimestamp: 1_781_650_000 }),
      buildBranchSummary({ name: "runtime-compat", remote: true, tipTimestamp: 1_781_700_000 }),
    ],
    "sena-nana/LiliaTodo": [
      buildBranchSummary({ name: "main", remote: true, protected: true, tipTimestamp: 1_781_560_000 }),
    ],
  };
}

function createFallbackGitHubBranchProtections(): Record<string, Record<string, GitHubBranchProtection>> {
  return {
    "sena-nana/LiliaGithub": {
      main: {
        required_status_checks: { strict: true, contexts: ["build"] },
        enforce_admins: { enabled: false },
        required_pull_request_reviews: {
          dismiss_stale_reviews: true,
          require_code_owner_reviews: false,
          required_approving_review_count: 1,
          require_last_push_approval: false,
        },
        restrictions: null,
        required_linear_history: { enabled: false },
        allow_force_pushes: { enabled: false },
        allow_deletions: { enabled: false },
        required_conversation_resolution: { enabled: true },
        lock_branch: { enabled: false },
        allow_fork_syncing: { enabled: false },
      },
    },
  };
}

function createFallbackGitHubRulesets(): Record<string, Record<number, GitHubRuleset>> {
  return {
    "sena-nana/LiliaGithub": {
      42: {
        id: 42,
        name: "Protect main",
        target: "branch",
        enforcement: "active",
        source_type: "Repository",
        source: "sena-nana/LiliaGithub",
        conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
        rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
      },
      73: {
        id: 73,
        name: "Organization policy",
        target: "branch",
        enforcement: "active",
        source_type: "Organization",
        source: "sena-nana",
        conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
        rules: [{ type: "required_linear_history" }],
      },
    },
  };
}

function buildBranchSummary(overrides: Partial<BranchSummary> & Pick<BranchSummary, "name">): BranchSummary {
  return {
    name: overrides.name,
    remote: overrides.remote ?? false,
    current: overrides.current ?? false,
    upstream: overrides.upstream ?? null,
    ahead: overrides.ahead ?? 0,
    behind: overrides.behind ?? 0,
    protected: overrides.protected ?? false,
    tipTimestamp: overrides.tipTimestamp ?? null,
    checkedOutWorktreePaths: [...(overrides.checkedOutWorktreePaths ?? [])],
  };
}

function createFallbackRepoBranches(): Record<string, BranchSummary[]> {
  if (useDefaultFallback) {
    return {
      LiliaGithub: [
        buildBranchSummary({
          name: "main",
          current: true,
          upstream: "origin/main",
          ahead: 1,
          behind: 0,
          tipTimestamp: 1_785_000_000,
          checkedOutWorktreePaths: ["C:\\Files\\workspace\\LiliaGithub"],
        }),
        buildBranchSummary({
          name: "dev",
          upstream: "origin/dev",
          tipTimestamp: 1_784_998_000,
        }),
        buildBranchSummary({
          name: "inventory",
          upstream: "origin/inventory",
          tipTimestamp: 1_784_700_000,
        }),
        buildBranchSummary({
          name: "origin/main",
          remote: true,
          tipTimestamp: 1_785_000_000,
        }),
        buildBranchSummary({
          name: "origin/dev",
          remote: true,
          tipTimestamp: 1_784_998_000,
        }),
        buildBranchSummary({
          name: "origin/feature/notice-update",
          remote: true,
          tipTimestamp: 1_784_200_000,
        }),
      ],
      Lilia: [
        buildBranchSummary({
          name: "main",
          current: true,
          upstream: "origin/main",
          ahead: 0,
          behind: 2,
          tipTimestamp: 1_784_990_000,
          checkedOutWorktreePaths: ["C:\\Files\\workspace\\Lilia"],
        }),
        buildBranchSummary({
          name: "origin/main",
          remote: true,
          tipTimestamp: 1_784_990_000,
        }),
      ],
    };
  }
  return {
    LiliaGithub: [
      buildBranchSummary({
        name: "main",
        upstream: "origin/main",
        tipTimestamp: 1_781_980_000,
      }),
      buildBranchSummary({
        name: "codex/readme-gallery",
        upstream: "origin/codex/readme-gallery",
        current: true,
        ahead: 2,
        behind: 1,
        tipTimestamp: 1_781_990_000,
        checkedOutWorktreePaths: ["D:\\PROJECT\\workspace\\LiliaGithub"],
      }),
      buildBranchSummary({
        name: "release/alpha",
        upstream: "origin/release/alpha",
        tipTimestamp: 1_781_400_000,
      }),
      buildBranchSummary({
        name: "origin/main",
        remote: true,
        tipTimestamp: 1_781_980_000,
      }),
      buildBranchSummary({
        name: "origin/codex/readme-gallery",
        remote: true,
        tipTimestamp: 1_781_980_000,
      }),
      buildBranchSummary({
        name: "origin/release/alpha",
        remote: true,
        tipTimestamp: 1_781_400_000,
      }),
    ],
    Lilia: [
      buildBranchSummary({
        name: "main",
        current: true,
        upstream: "origin/main",
        ahead: 0,
        behind: 2,
        tipTimestamp: 1_781_930_000,
        checkedOutWorktreePaths: ["D:\\PROJECT\\workspace\\Lilia"],
      }),
      buildBranchSummary({
        name: "origin/main",
        remote: true,
        tipTimestamp: 1_781_930_000,
      }),
    ],
  };
}

function createFallbackRepoStashes(): Record<string, RepoStashEntry[]> {
  return {
    LiliaGithub: [
      { id: "stash@{0}", index: 0, branch: "main", message: "On main: WIP toolbar" },
    ],
  };
}

function createFallbackRepoRemotes(): Record<string, RepoRemote[]> {
  if (useDefaultFallback) {
    return {
      LiliaGithub: [
        {
          name: "origin",
          fetchUrl: "https://github.com/sena-nana/LiliaGithub.git",
          pushUrl: "https://github.com/sena-nana/LiliaGithub.git",
          current: true,
        },
      ],
      Lilia: [
        {
          name: "origin",
          fetchUrl: "https://github.com/sena-nana/Lilia.git",
          pushUrl: "https://github.com/sena-nana/Lilia.git",
          current: true,
        },
      ],
    };
  }
  return {
    LiliaGithub: [
      {
        name: "origin",
        fetchUrl: "https://github.com/sena-nana/LiliaGithub.git",
        pushUrl: "https://github.com/sena-nana/LiliaGithub.git",
        current: true,
      },
    ],
    Lilia: [
      {
        name: "origin",
        fetchUrl: "https://github.com/sena-nana/LiliaCode.git",
        pushUrl: "https://github.com/sena-nana/LiliaCode.git",
        current: true,
      },
    ],
  };
}

function createFallbackRepoFiles(): Record<string, Record<string, RepoFileTreeEntry[]>> {
  return {
    LiliaGithub: {
      "": [
        { path: "public", name: "public", kind: "dir", hasChildren: true },
        { path: "src", name: "src", kind: "dir", hasChildren: true },
        { path: ".gitignore", name: ".gitignore", kind: "file", hasChildren: false },
        { path: "README.md", name: "README.md", kind: "file", hasChildren: false },
        { path: "package.json", name: "package.json", kind: "file", hasChildren: false },
      ],
      public: [
        { path: "public/favicon.ico", name: "favicon.ico", kind: "file", hasChildren: false },
      ],
      src: [
        { path: "src/App.vue", name: "App.vue", kind: "file", hasChildren: false },
        { path: "src/pages", name: "pages", kind: "dir", hasChildren: true },
        { path: "src/router.ts", name: "router.ts", kind: "file", hasChildren: false },
      ],
      "src/pages": [
        { path: "src/pages/Home.vue", name: "Home.vue", kind: "file", hasChildren: false },
        { path: "src/pages/RepoDetail.vue", name: "RepoDetail.vue", kind: "file", hasChildren: false },
      ],
    },
    Lilia: {
      "": [
        { path: "src", name: "src", kind: "dir", hasChildren: false },
        { path: "README.md", name: "README.md", kind: "file", hasChildren: false },
      ],
      src: [],
    },
  };
}

function createFallbackGitHubRepoFiles(): Record<string, Record<string, RepoFileTreeEntry[]>> {
  return Object.fromEntries(
    Object.entries(createFallbackRepoFiles()).map(([repoId, files]) => {
      const repo = fallbackRepos.find((item) => item.id === repoId);
      return [repo?.githubFullName ?? repoId, files];
    }),
  );
}

function createFallbackRepoFilePreviews(): Record<string, Record<string, RepoFilePreview>> {
  return {
    LiliaGithub: {
      "README.md": {
        path: "README.md",
        name: "README.md",
        previewKind: "markdown",
        content: useDefaultFallback ? FALLBACK_LILIA_GITHUB_README : FALLBACK_SHOWCASE_LILIA_GITHUB_README,
        images: {},
        size: 168,
        mimeType: "text/markdown",
        truncated: false,
      },
      ".gitignore": {
        path: ".gitignore",
        name: ".gitignore",
        previewKind: "text",
        content: "dist\nnode_modules\nsrc-tauri/target\n",
        size: 34,
        mimeType: "text/plain",
        truncated: false,
      },
      "package.json": {
        path: "package.json",
        name: "package.json",
        previewKind: "text",
        content: JSON.stringify({ name: "lilia-github", private: true, version: "0.1.0-alpha.1" }, null, 2),
        size: 76,
        mimeType: "application/json",
        truncated: false,
      },
      "src/App.vue": {
        path: "src/App.vue",
        name: "App.vue",
        previewKind: "text",
        content: "<template>\n  <RouterView />\n</template>\n",
        size: 41,
        mimeType: "text/plain",
        truncated: false,
      },
      "src/router.ts": {
        path: "src/router.ts",
        name: "router.ts",
        previewKind: "text",
        content: "export const router = createLiliaGithubRouter();\n",
        size: 49,
        mimeType: "text/plain",
        truncated: false,
      },
      "src/pages/Home.vue": {
        path: "src/pages/Home.vue",
        name: "Home.vue",
        previewKind: "text",
        content: "<template>\n  <section>Home</section>\n</template>\n",
        size: 47,
        mimeType: "text/plain",
        truncated: false,
      },
      "src/pages/RepoDetail.vue": {
        path: "src/pages/RepoDetail.vue",
        name: "RepoDetail.vue",
        previewKind: "text",
        content: "<template>\n  <section class=\"repo-workbench\" />\n</template>\n",
        size: 63,
        mimeType: "text/plain",
        truncated: false,
      },
      "public/favicon.ico": {
        path: "public/favicon.ico",
        name: "favicon.ico",
        previewKind: "binary",
        size: 1024,
        mimeType: "image/x-icon",
        truncated: false,
      },
    },
    Lilia: {
      "README.md": {
        path: "README.md",
        name: "README.md",
        previewKind: "markdown",
        content: FALLBACK_LILIA_README,
        images: {},
        size: 32,
        mimeType: "text/markdown",
        truncated: false,
      },
    },
  };
}

function createFallbackGitHubRepoFilePreviews(): Record<string, Record<string, RepoFilePreview>> {
  return Object.fromEntries(
    Object.entries(createFallbackRepoFilePreviews()).map(([repoId, previews]) => {
      const repo = fallbackRepos.find((item) => item.id === repoId);
      return [repo?.githubFullName ?? repoId, previews];
    }),
  );
}

function discussionBodyItem(
  id: string,
  actor: string | null | undefined,
  body: string | null | undefined,
  url: string,
  createdAt: string,
  updatedAt: string,
): GitHubDiscussionTimelineItem {
  return {
    id,
    kind: "body",
    actor,
    body: body ?? "",
    url,
    createdAt,
    updatedAt,
  };
}

function sortDiscussionTimeline(items: GitHubDiscussionTimelineItem[]) {
  return items.sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
  });
}

function fallbackIssueDiscussion(issue: GitHubIssue): GitHubIssueDiscussion {
  return {
    issue: cloneIssue(issue),
    timeline: sortDiscussionTimeline([
      discussionBodyItem(
        `issue-${issue.number}-body`,
        issue.author ?? "lilia-user",
        issue.body,
        issue.htmlUrl,
        issue.createdAt,
        issue.updatedAt,
      ),
      {
        id: `issue-${issue.number}-comment-1`,
        kind: "comment",
        actor: "sena-nana",
        body: "已确认，需要展示 **Markdown** 评论和状态事件。",
        url: `${issue.htmlUrl}#issuecomment-1`,
        createdAt: issue.updatedAt,
        updatedAt: issue.updatedAt,
      },
      {
        id: `issue-${issue.number}-event-1`,
        kind: "event",
        actor: issue.author ?? "lilia-user",
        event: issue.state === "closed" ? "closed" : "labeled",
        title: issue.state === "closed" ? "关闭了 Issue" : "添加了标签",
        createdAt: issue.updatedAt,
      },
    ]),
  };
}

function fallbackPullRequestDiscussion(pullRequest: GitHubPullRequest): GitHubPullRequestDiscussion {
  return {
    pullRequest: clonePullRequest(pullRequest),
    timeline: sortDiscussionTimeline([
      discussionBodyItem(
        `pull-${pullRequest.number}-body`,
        pullRequest.author,
        pullRequest.body,
        pullRequest.htmlUrl,
        pullRequest.createdAt,
        pullRequest.updatedAt,
      ),
      {
        id: `pull-${pullRequest.number}-review-1`,
        kind: "review",
        actor: "sena-nana",
        state: pullRequest.merged ? "APPROVED" : "COMMENTED",
        body: "整体方向可以，注意保留现有列表筛选行为。",
        url: `${pullRequest.htmlUrl}#pullrequestreview-1`,
        createdAt: pullRequest.updatedAt,
        updatedAt: pullRequest.updatedAt,
      },
      {
        id: `pull-${pullRequest.number}-review-comment-1`,
        kind: "reviewComment",
        actor: "sena-nana",
        body: "这里需要用共享 timeline 组件渲染。",
        url: `${pullRequest.htmlUrl}#discussion_r1`,
        path: "src/components/repo/RepoProjectPanel.vue",
        line: 128,
        originalLine: 128,
        commitId: "abcdef1234567890",
        createdAt: pullRequest.updatedAt,
        updatedAt: pullRequest.updatedAt,
      },
      {
        id: `pull-${pullRequest.number}-event-1`,
        kind: "event",
        actor: pullRequest.author,
        event: pullRequest.merged ? "merged" : "ready_for_review",
        title: pullRequest.merged ? "合并了 Pull Request" : "标记为 ready for review",
        createdAt: pullRequest.updatedAt,
      },
    ]),
  };
}

let fallbackGitHubRepoOwners = createFallbackGitHubRepoOwners();
let fallbackGitHubRepoTemplates = createFallbackGitHubRepoTemplates();
let fallbackGitHubRepoManagement = createFallbackGitHubRepoManagement();
let fallbackGitHubIssues = createFallbackGitHubIssues();
let fallbackGitHubPullRequests = createFallbackGitHubPullRequests();
let fallbackGitHubActionNotifications = createFallbackGitHubActionNotifications();
let fallbackGitHubIssueDiscussions: Record<string, Record<number, GitHubIssueDiscussion>> = {};
let fallbackGitHubPullRequestDiscussions: Record<string, Record<number, GitHubPullRequestDiscussion>> = {};
let fallbackGitHubPullRequestChecks = createFallbackGitHubPullRequestChecks();
let fallbackGitHubReleases = createFallbackGitHubReleases();
let fallbackGitHubWorkflowRuns = createFallbackGitHubWorkflowRuns();
let fallbackGitHubWorkflowRunDetails = createFallbackGitHubWorkflowRunDetails();
let fallbackGitHubWorkflowJobLogs = createFallbackGitHubWorkflowJobLogs();
let fallbackGitHubWorkflowArtifactEntries = createFallbackGitHubWorkflowArtifactEntries();
let fallbackGitHubWorkflowArtifactPreviews = createFallbackGitHubWorkflowArtifactPreviews();
let fallbackGitHubCommits = createFallbackGitHubCommits();
let fallbackGitHubCommitDetails = createFallbackGitHubCommitDetails();
let fallbackGitHubBranches = createFallbackGitHubBranches();
let fallbackGitHubBranchProtections = createFallbackGitHubBranchProtections();
let fallbackGitHubRulesets = createFallbackGitHubRulesets();
let fallbackRepoStashes = createFallbackRepoStashes();
let fallbackRepoRemotes = createFallbackRepoRemotes();
let fallbackRepoBranches = createFallbackRepoBranches();
let fallbackRepoFiles = createFallbackRepoFiles();
let fallbackGitHubRepoFiles = createFallbackGitHubRepoFiles();
let fallbackRepoFilePreviews = createFallbackRepoFilePreviews();
let fallbackGitHubRepoFilePreviews = createFallbackGitHubRepoFilePreviews();
type FallbackRepoFilesOverride = (
  repoId: string,
  parentPath: string | null,
  repoRef: string | null,
) => Promise<RepoFileTreeEntry[]> | RepoFileTreeEntry[];
let fallbackRepoFilesOverride: FallbackRepoFilesOverride | null = null;

type FallbackGitHubIssueListCall = {
  repoFullName: string;
  state: string | null;
  perPage: number | null;
  sort: string | null;
  direction: string | null;
  since: string | null;
  creator: string | null;
  assignee: string | null;
  labels: string[] | null;
  milestone: string | number | null;
  project: string | null;
  query: string | null;
};

type FallbackGitHubPullRequestListCall = {
  repoFullName: string;
  state: string | null;
  perPage: number | null;
  sort: string | null;
  direction: string | null;
  creator: string | null;
  assignee: string | null;
  labels: string[] | null;
  milestone: string | number | null;
  project: string | null;
  review: string | null;
  query: string | null;
};

type FallbackGitHubPullRequestCheckListCall = {
  repoFullName: string;
  pullNumber: number;
};

type FallbackGitHubRepoFileListCall = {
  repoFullName: string;
  parentPath: string | null;
  refName: string | null;
};

type FallbackGitHubRepoFilePreviewCall = {
  repoFullName: string;
  path: string;
  refName: string | null;
};

function createDefaultAccountPreferences(workspaceRoot: string | null): AccountPreferences {
  return {
    defaultWorkspaceRoot: workspaceRoot,
    repositoryScope: { kind: "all" },
    repositorySort: { key: "updated", direction: "desc" },
    issues: { state: "open", sort: "created", direction: "desc" },
    pullRequests: { state: "open", sort: "updated", direction: "desc" },
    actions: { state: "all", sort: "updated", direction: "desc" },
  };
}

function createFallbackSettings(
  githubBinding: WorkspaceSettings["githubBinding"] = defaultFallbackBinding.binding,
  inheritDefaultWorkspace = true,
): WorkspaceSettings {
  const workspaceRoot = inheritDefaultWorkspace
    ? (useDefaultFallback ? "C:\\Files\\workspace" : "D:\\PROJECT\\workspace")
    : null;
  if (useDefaultFallback) {
    return {
      workspaceRoot,
      githubBinding,
      accountPreferences: createDefaultAccountPreferences(workspaceRoot),
      projectLaunchConfigs: {},
      repoSyncPreferences: {},
      repoRemoteSyncPolicies: {},
      hiddenRepoIds: [],
      managedRepoIds: fallbackRepos.map((repo) => repo.id),
      systemGitRepoIds: [],
      repoBindings: {},
      repoGroups: [],
      remoteRepoShortcuts: [],
      localContributionCache: {},
      contributionIdentities: [],
    };
  }
  return {
    workspaceRoot,
    githubBinding,
    accountPreferences: createDefaultAccountPreferences(workspaceRoot),
    projectLaunchConfigs: {
      LiliaGithub: {
        command: "yarn tauri:dev",
        cwd: null,
        source: "manual",
        updatedAt: Date.now(),
      },
      LiliaDocs: {
        command: "yarn docs:dev",
        cwd: null,
        source: "manual",
        updatedAt: Date.now(),
      },
    },
    repoSyncPreferences: {
      LiliaGithub: { autoSync: true },
      LiliaDocs: { autoSync: true },
      Mutsuki: { autoSync: false },
    },
    repoRemoteSyncPolicies: {},
    hiddenRepoIds: [],
    managedRepoIds: fallbackRepos.map((repo) => repo.id),
    systemGitRepoIds: [],
    repoBindings: {},
    repoGroups: [
      { id: "group-lilia-apps", name: "Lilia Apps", repoIds: ["LiliaGithub", "Lilia", "LiliaTodo"] },
      { id: "group-runtime-docs", name: "Runtime & Docs", repoIds: ["Mutsuki", "LiliaDocs"] },
    ],
    remoteRepoShortcuts: [],
    localContributionCache: {},
    contributionIdentities: [],
  };
}

let fallbackSettings: WorkspaceSettings = createFallbackSettings();
const FALLBACK_ANONYMOUS_ACCOUNT_KEY = "__anonymous__";
let fallbackSettingsByAccount = new Map<string, WorkspaceSettings>();
let fallbackAccountProfiles = new Map<string, GitHubAccountProfile>();
let fallbackPendingAuthPurpose: GitHubAuthPurpose = "binding";
let fallbackBulkExecuteOverride:
  | ((
      operation: BulkOperation,
      repoIds: string[],
      localChangesMode: RepoPullLocalChangesMode,
    ) => BulkSyncResult[] | Promise<BulkSyncResult[]>)
  | null = null;
let fallbackConflictOverride: ((repoId: string) => RepoConflictState | null) | null = null;
const fallbackConflictStates = new Map<string, RepoConflictState>();
let fallbackRepoContributionOverride: ((repoFullName: string) => GitHubContributionResult) | null = null;
let fallbackGitHubWorkflowRunsOverride:
  ((repoFullName: string, perPage: number | null) => GitHubWorkflowRun[] | Promise<GitHubWorkflowRun[]>) | null = null;
let fallbackRepoRemoteSyncOverride: ((repo: RepoSummary) => string | null) | null = null;
let fallbackRemoteOperationErrorOverride:
  | ((repoId: string, remote: string, operation: RepoRemoteOperationStep["operation"]) => string | null)
  | null = null;
let fallbackRepoDetailOverride: ((repoId: string) => RepoDetail | Promise<RepoDetail> | null) | null = null;
type FallbackGitHubAccountIssuesOverride = (
  options: Pick<GitHubIssueListOptions, "state" | "perPage" | "sort" | "direction">,
) => Promise<GitHubAccountIssueItem[]> | GitHubAccountIssueItem[];
type FallbackGitHubActionNotificationsOverride = (
  perPage: number | null,
) => Promise<GitHubActionNotification[]> | GitHubActionNotification[];
let fallbackBinding = defaultFallbackBinding;
let fallbackGitHubReposError: string | null = null;
let fallbackGitHubRepoPagesOverride: GitHubRepoPage[] | null = null;
let fallbackGitHubAccountIssuesOverride: FallbackGitHubAccountIssuesOverride | null = null;
let fallbackGitHubActionNotificationsOverride: FallbackGitHubActionNotificationsOverride | null = null;
let fallbackGitHubIssueListCalls: FallbackGitHubIssueListCall[] = [];
let fallbackGitHubAccountIssueListCalls: Array<{
  state: string | null;
  perPage: number | null;
  sort: string | null;
  direction: string | null;
}> = [];
let fallbackGitHubActionNotificationListCalls: Array<{ perPage: number | null }> = [];
let fallbackGitHubPullRequestListCalls: FallbackGitHubPullRequestListCall[] = [];
let fallbackGitHubPullRequestCheckListCalls: FallbackGitHubPullRequestCheckListCall[] = [];
let fallbackGitHubReleaseListCalls: Array<{ repoFullName: string }> = [];
let fallbackPickFilesResult: string[] = [];
let fallbackGitHubWorkflowRunListCalls: Array<{ repoFullName: string; perPage: number | null }> = [];
let fallbackGitHubWorkflowRunDetailCalls: Array<{ repoFullName: string; runId: number }> = [];
let fallbackGitHubWorkflowJobLogCalls: Array<{ repoFullName: string; jobId: number }> = [];
let fallbackGitHubWorkflowArtifactListCalls: Array<{ repoFullName: string; artifactId: number }> = [];
let fallbackGitHubWorkflowArtifactPreviewCalls: Array<{ repoFullName: string; artifactId: number; path: string }> = [];
let fallbackGitHubCommitListCalls: Array<{ repoFullName: string; perPage: number | null; sha: string | null }> = [];
let fallbackGitHubCommitDetailCalls: Array<{ repoFullName: string; hash: string }> = [];
let fallbackGitHubRepoFileListCalls: FallbackGitHubRepoFileListCall[] = [];
let fallbackGitHubRepoFilePreviewCalls: FallbackGitHubRepoFilePreviewCall[] = [];
let fallbackOpenPathCalls: string[] = [];
let fallbackOpenPathTargetCalls: Array<{ path: string; target: SystemOpenTarget }> = [];
let fallbackCloneIndex = 1;
let fallbackClonedRepos: RepoSummary[] = [];
let fallbackRepoOverrides: Record<string, RepoSummary> = {};
let fallbackTaskIndex = 1;
let fallbackTasks: WorkspaceTask[] = [];
type FallbackOperationEntry = {
  taskId: string;
  descriptor: FallbackOperationDescriptor;
  state: "pending" | "running";
  generation: number;
  sequence: number;
  readyAt: number;
  execute: () => unknown | Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};
const fallbackOperationEntries = new Map<string, FallbackOperationEntry>();
let fallbackOperationGeneration = 0;
let fallbackOperationSequence = 0;
let fallbackOperationPumpTimer: ReturnType<typeof setTimeout> | null = null;
const fallbackOperationRunningByKind: Record<FallbackOperationKind, number> = {
  localRead: 0,
  localWrite: 0,
  githubRead: 0,
  githubWrite: 0,
  githubTransfer: 0,
  workspaceAnalysis: 0,
  bulk: 0,
  launchControl: 0,
};
const fallbackOperationResources = new Map<string, { readers: number; writer: boolean }>();
let fallbackActiveRepoId: string | null = null;
const fallbackBaselineRepoKeys = new Set<string>();
let fallbackRefreshPaused = false;
type FallbackRefreshEntry = {
  taskId: string;
  request: WorkspaceRepoRefreshRequest;
  state: "pending" | "running";
  rerun: WorkspaceRepoRefreshRequest | null;
  sequence: number;
  generation: number;
};
const fallbackRepoRefreshEntries = new Map<string, FallbackRefreshEntry>();
let fallbackRefreshSequence = 0;
let fallbackRefreshGeneration = 0;
let fallbackLocalRefreshesRunning = 0;
let fallbackRemoteRefreshesRunning = 0;
let fallbackRefreshPumpScheduled = false;
const fallbackRemoteFailureCounts = new Map<string, number>();
const fallbackRemoteRetryAt = new Map<string, number>();
let fallbackStartupCache: WorkspaceStartupCache | null = null;
let fallbackContributionIdentityRecommendations: ContributionIdentityRecommendationResult | null = null;

const fallbackLaunchStatuses: Record<string, ProjectLaunchStatus> = {};
const fallbackLaunchLogs: Record<string, ProjectLaunchLog[]> = {};
const fallbackLaunchHistory: Record<string, ProjectLaunchHistoryEntry[]> = {};
let fallbackLaunchLogIndex = 1;
let fallbackLaunchCandidatesOverride: Record<string, ProjectLaunchCandidate[]> | null = null;
let fallbackStopLaunchOverride: ((repoId: string) => Promise<ProjectLaunchStatus> | ProjectLaunchStatus) | null = null;

export function resetWorkspaceFallbacksForTests() {
  fallbackRefreshGeneration += 1;
  fallbackOperationGeneration += 1;
  if (fallbackOperationPumpTimer) clearTimeout(fallbackOperationPumpTimer);
  fallbackOperationPumpTimer = null;
  for (const entry of fallbackOperationEntries.values()) {
    if (entry.state === "pending") entry.reject(new Error("任务已取消"));
  }
  fallbackOperationEntries.clear();
  fallbackOperationSequence = 0;
  for (const kind of Object.keys(fallbackOperationRunningByKind) as FallbackOperationKind[]) {
    fallbackOperationRunningByKind[kind] = 0;
  }
  fallbackOperationResources.clear();
  fallbackSettings = createFallbackSettings();
  fallbackSettingsByAccount = new Map();
  fallbackAccountProfiles = new Map();
  fallbackPendingAuthPurpose = "binding";
  fallbackBulkExecuteOverride = null;
  fallbackConflictOverride = null;
  fallbackConflictStates.clear();
  fallbackRepoContributionOverride = null;
  fallbackGitHubWorkflowRunsOverride = null;
  fallbackRepoRemoteSyncOverride = null;
  fallbackRemoteOperationErrorOverride = null;
  fallbackRepoDetailOverride = null;
  fallbackBinding = defaultFallbackBinding;
  fallbackGitHubReposError = null;
  fallbackGitHubRepoPagesOverride = null;
  fallbackGitHubAccountIssuesOverride = null;
  fallbackGitHubActionNotificationsOverride = null;
  fallbackRepos = baseFallbackRepos.map(cloneRepoSummary);
  fallbackGitHubRepos = createFallbackGitHubRepos();
  fallbackGitHubRepoOwners = createFallbackGitHubRepoOwners();
  fallbackGitHubRepoTemplates = createFallbackGitHubRepoTemplates();
  fallbackGitHubRepoManagement = createFallbackGitHubRepoManagement();
  fallbackGitHubIssues = createFallbackGitHubIssues();
  fallbackGitHubPullRequests = createFallbackGitHubPullRequests();
  fallbackGitHubActionNotifications = createFallbackGitHubActionNotifications();
  fallbackGitHubIssueDiscussions = {};
  fallbackGitHubPullRequestDiscussions = {};
  fallbackGitHubPullRequestChecks = createFallbackGitHubPullRequestChecks();
  fallbackGitHubReleases = createFallbackGitHubReleases();
  fallbackGitHubWorkflowRuns = createFallbackGitHubWorkflowRuns();
  fallbackGitHubWorkflowRunDetails = createFallbackGitHubWorkflowRunDetails();
  fallbackGitHubWorkflowJobLogs = createFallbackGitHubWorkflowJobLogs();
  fallbackGitHubWorkflowArtifactEntries = createFallbackGitHubWorkflowArtifactEntries();
  fallbackGitHubWorkflowArtifactPreviews = createFallbackGitHubWorkflowArtifactPreviews();
  fallbackGitHubCommits = createFallbackGitHubCommits();
  fallbackGitHubCommitDetails = createFallbackGitHubCommitDetails();
  fallbackGitHubBranches = createFallbackGitHubBranches();
  fallbackGitHubBranchProtections = createFallbackGitHubBranchProtections();
  fallbackGitHubRulesets = createFallbackGitHubRulesets();
  fallbackGitHubRepoSettingsSections = {};
  fallbackRepoStashes = createFallbackRepoStashes();
  fallbackRepoRemotes = createFallbackRepoRemotes();
  fallbackRepoBranches = createFallbackRepoBranches();
  fallbackRepoFiles = createFallbackRepoFiles();
  fallbackRepoFilesOverride = null;
  fallbackGitHubRepoFiles = createFallbackGitHubRepoFiles();
  fallbackRepoFilePreviews = createFallbackRepoFilePreviews();
  fallbackGitHubRepoFilePreviews = createFallbackGitHubRepoFilePreviews();
  fallbackGitHubIssueListCalls = [];
  fallbackGitHubAccountIssueListCalls = [];
  fallbackGitHubActionNotificationListCalls = [];
  fallbackGitHubPullRequestListCalls = [];
  fallbackGitHubPullRequestCheckListCalls = [];
  fallbackGitHubReleaseListCalls = [];
  fallbackPickFilesResult = [];
  fallbackGitHubWorkflowRunListCalls = [];
  fallbackGitHubWorkflowRunDetailCalls = [];
  fallbackGitHubWorkflowJobLogCalls = [];
  fallbackGitHubWorkflowArtifactListCalls = [];
  fallbackGitHubWorkflowArtifactPreviewCalls = [];
  fallbackGitHubCommitListCalls = [];
  fallbackGitHubCommitDetailCalls = [];
  fallbackGitHubRepoFileListCalls = [];
  fallbackGitHubRepoFilePreviewCalls = [];
  fallbackOpenPathCalls = [];
  fallbackOpenPathTargetCalls = [];
  fallbackCloneIndex = 1;
  fallbackClonedRepos = [];
  fallbackRepoOverrides = {};
  fallbackTaskIndex = 1;
  fallbackTasks = [];
  fallbackActiveRepoId = null;
  fallbackBaselineRepoKeys.clear();
  fallbackRefreshPaused = false;
  fallbackRepoRefreshEntries.clear();
  fallbackRefreshSequence = 0;
  fallbackLocalRefreshesRunning = 0;
  fallbackRemoteRefreshesRunning = 0;
  fallbackRefreshPumpScheduled = false;
  fallbackRemoteFailureCounts.clear();
  fallbackRemoteRetryAt.clear();
  fallbackStartupCache = null;
  fallbackContributionIdentityRecommendations = null;
  for (const key of Object.keys(fallbackLaunchStatuses)) {
    delete fallbackLaunchStatuses[key];
  }
  for (const key of Object.keys(fallbackLaunchLogs)) {
    delete fallbackLaunchLogs[key];
  }
  for (const key of Object.keys(fallbackLaunchHistory)) {
    delete fallbackLaunchHistory[key];
  }
  fallbackLaunchLogIndex = 1;
  fallbackLaunchCandidatesOverride = null;
  fallbackStopLaunchOverride = null;
}

export function setFallbackBulkExecuteOverrideForTests(
  override:
    | ((
        operation: BulkOperation,
        repoIds: string[],
        localChangesMode: RepoPullLocalChangesMode,
      ) => BulkSyncResult[] | Promise<BulkSyncResult[]>)
    | null,
) {
  fallbackBulkExecuteOverride = override;
}

export function setFallbackConflictOverrideForTests(
  override: ((repoId: string) => RepoConflictState | null) | null,
) {
  fallbackConflictOverride = override;
  fallbackConflictStates.clear();
}

export function setFallbackRepoContributionOverrideForTests(
  override: ((repoFullName: string) => GitHubContributionResult) | null,
) {
  fallbackRepoContributionOverride = override;
}

export function setFallbackContributionIdentityRecommendationsForTests(
  result: ContributionIdentityRecommendationResult | null,
) {
  fallbackContributionIdentityRecommendations = result ? cloneContributionIdentityRecommendationResult(result) : null;
}

export function setFallbackGitHubWorkflowRunsOverrideForTests(
  override: ((repoFullName: string, perPage: number | null) => GitHubWorkflowRun[] | Promise<GitHubWorkflowRun[]>) | null,
) {
  fallbackGitHubWorkflowRunsOverride = override;
}

export function setFallbackRepoRemoteSyncOverrideForTests(
  override: ((repo: RepoSummary) => string | null) | null,
) {
  fallbackRepoRemoteSyncOverride = override;
}

export function setFallbackRemoteOperationErrorOverrideForTests(
  override: ((repoId: string, remote: string, operation: RepoRemoteOperationStep["operation"]) => string | null) | null,
) {
  fallbackRemoteOperationErrorOverride = override;
}

export function setFallbackRepoRemotesForTests(repoId: string, remotes: RepoRemote[]) {
  fallbackRepoRemotes = {
    ...fallbackRepoRemotes,
    [repoId]: remotes.map(cloneRepoRemote),
  };
}

export function setFallbackRepoDetailOverrideForTests(
  override: ((repoId: string) => RepoDetail | Promise<RepoDetail> | null) | null,
) {
  fallbackRepoDetailOverride = override;
}

export function setFallbackRepoOverridesForTests(overrides: Record<string, RepoSummary>) {
  fallbackRepoOverrides = Object.fromEntries(
    Object.entries(overrides).map(([repoId, summary]) => [repoId, { ...summary }]),
  );
}

export function setFallbackLaunchCandidatesForTests(
  candidatesByRepo: Record<string, ProjectLaunchCandidate[]> | null,
) {
  fallbackLaunchCandidatesOverride = candidatesByRepo
    ? Object.fromEntries(
        Object.entries(candidatesByRepo).map(([repoId, candidates]) => [
          repoId,
          candidates.map((candidate) => ({ ...candidate })),
        ]),
      )
    : null;
}

export function setFallbackStopLaunchOverrideForTests(
  override: ((repoId: string) => Promise<ProjectLaunchStatus> | ProjectLaunchStatus) | null,
) {
  fallbackStopLaunchOverride = override;
}

export function setFallbackGitHubBindingStatusForTests(binding: GitHubBindingStatus) {
  switchFallbackAccount(binding);
}

export function setFallbackStartupCacheForTests(cache: WorkspaceStartupCache | null) {
  fallbackStartupCache = cache ? cloneStartupCache(cache) : null;
}

export function setFallbackGitHubReposErrorForTests(error: string | null) {
  fallbackGitHubReposError = error;
}

export function setFallbackGitHubRepoPagesForTests(pages: GitHubRepoPage[] | null) {
  fallbackGitHubRepoPagesOverride = pages?.map((page) => ({
    items: page.items.map(cloneGitHubRepoSummary),
    nextPage: page.nextPage,
  })) ?? null;
}

export function setFallbackGitHubAccountIssuesOverrideForTests(
  override: FallbackGitHubAccountIssuesOverride | null,
) {
  fallbackGitHubAccountIssuesOverride = override;
}

export function setFallbackGitHubActionNotificationsOverrideForTests(
  override: FallbackGitHubActionNotificationsOverride | null,
) {
  fallbackGitHubActionNotificationsOverride = override;
}

export function setFallbackGitHubBranchesForTests(branchesByRepo: Record<string, BranchSummary[]>) {
  fallbackGitHubBranches = Object.fromEntries(
    Object.entries(branchesByRepo).map(([repoFullName, branches]) => [
      repoFullName,
      branches.map(cloneBranchSummary),
    ]),
  );
  for (const repoFullName of Object.keys(branchesByRepo)) {
    clearFallbackGitHubRepoSettingsSection(repoFullName, "branches");
  }
}

export function setFallbackGitHubBranchProtectionsForTests(
  protectionsByRepo: Record<string, Record<string, GitHubBranchProtection>>,
) {
  fallbackGitHubBranchProtections = cloneFallbackData(protectionsByRepo);
}

export function setFallbackGitHubRulesetsForTests(
  rulesetsByRepo: Record<string, Record<number, GitHubRuleset>>,
) {
  fallbackGitHubRulesets = cloneFallbackData(rulesetsByRepo);
}

export function getFallbackGitHubIssueListCallsForTests(): FallbackGitHubIssueListCall[] {
  return fallbackGitHubIssueListCalls.map((call) => ({ ...call }));
}

export function getFallbackGitHubAccountIssueListCallsForTests() {
  return fallbackGitHubAccountIssueListCalls.map((call) => ({ ...call }));
}

export function getFallbackGitHubActionNotificationListCallsForTests() {
  return fallbackGitHubActionNotificationListCalls.map((call) => ({ ...call }));
}

export function getFallbackGitHubPullRequestListCallsForTests(): FallbackGitHubPullRequestListCall[] {
  return fallbackGitHubPullRequestListCalls.map((call) => ({
    ...call,
    labels: call.labels ? [...call.labels] : null,
  }));
}

export function getFallbackGitHubPullRequestCheckListCallsForTests(): FallbackGitHubPullRequestCheckListCall[] {
  return fallbackGitHubPullRequestCheckListCalls.map((call) => ({ ...call }));
}

export function getFallbackGitHubReleaseListCallsForTests() {
  return fallbackGitHubReleaseListCalls.map((call) => ({ ...call }));
}

export function getFallbackGitHubWorkflowRunListCallsForTests() {
  return fallbackGitHubWorkflowRunListCalls.map((call) => ({ ...call }));
}

export function getFallbackGitHubCommitListCallsForTests() {
  return fallbackGitHubCommitListCalls.map((call) => ({ ...call }));
}

export function getFallbackGitHubCommitDetailCallsForTests() {
  return fallbackGitHubCommitDetailCalls.map((call) => ({ ...call }));
}

export function getFallbackGitHubRepoFileListCallsForTests() {
  return fallbackGitHubRepoFileListCalls.map((call) => ({ ...call }));
}

export function getFallbackGitHubRepoFilePreviewCallsForTests() {
  return fallbackGitHubRepoFilePreviewCalls.map((call) => ({ ...call }));
}

export function getFallbackOpenPathCallsForTests(): string[] {
  return [...fallbackOpenPathCalls];
}

export function getFallbackOpenPathTargetCallsForTests(): Array<{ path: string; target: SystemOpenTarget }> {
  return fallbackOpenPathTargetCalls.map((call) => ({ ...call }));
}

export function setFallbackGitHubIssuesForTests(issuesByRepo: Record<string, GitHubIssue[]>) {
  fallbackGitHubIssues = Object.fromEntries(
    Object.entries(issuesByRepo).map(([repoFullName, issues]) => [
      repoFullName,
      issues.map(cloneIssue),
    ]),
  );
}

export function setFallbackGitHubPullRequestsForTests(pullRequestsByRepo: Record<string, GitHubPullRequest[]>) {
  fallbackGitHubPullRequests = Object.fromEntries(
    Object.entries(pullRequestsByRepo).map(([repoFullName, pullRequests]) => [
      repoFullName,
      pullRequests.map(clonePullRequest),
    ]),
  );
}

export function setFallbackGitHubActionNotificationsForTests(notifications: GitHubActionNotification[]) {
  fallbackGitHubActionNotifications = notifications.map((notification) => ({ ...notification }));
}

export function setFallbackGitHubReleasesForTests(releasesByRepo: Record<string, GitHubRelease[]>) {
  fallbackGitHubReleases = Object.fromEntries(
    Object.entries(releasesByRepo).map(([repoFullName, releases]) => [
      repoFullName,
      releases.map(cloneRelease),
    ]),
  );
}

export function setFallbackPickFilesResultForTests(paths: string[]) {
  fallbackPickFilesResult = [...paths];
}

export function setFallbackGitHubIssueDiscussionsForTests(
  discussionsByRepo: Record<string, Record<number, GitHubIssueDiscussion>>,
) {
  fallbackGitHubIssueDiscussions = Object.fromEntries(
    Object.entries(discussionsByRepo).map(([repoFullName, discussions]) => [
      repoFullName,
      Object.fromEntries(
        Object.entries(discussions).map(([issueNumber, discussion]) => [
          Number(issueNumber),
          cloneIssueDiscussion(discussion),
        ]),
      ),
    ]),
  );
}

export function setFallbackGitHubPullRequestDiscussionsForTests(
  discussionsByRepo: Record<string, Record<number, GitHubPullRequestDiscussion>>,
) {
  fallbackGitHubPullRequestDiscussions = Object.fromEntries(
    Object.entries(discussionsByRepo).map(([repoFullName, discussions]) => [
      repoFullName,
      Object.fromEntries(
        Object.entries(discussions).map(([pullNumber, discussion]) => [
          Number(pullNumber),
          clonePullRequestDiscussion(discussion),
        ]),
      ),
    ]),
  );
}

export function setFallbackGitHubPullRequestChecksForTests(
  checksByRepo: Record<string, Record<number, GitHubPullRequestCheck[]>>,
) {
  fallbackGitHubPullRequestChecks = Object.fromEntries(
    Object.entries(checksByRepo).map(([repoFullName, checksByPull]) => [
      repoFullName,
      Object.fromEntries(
        Object.entries(checksByPull).map(([pullNumber, checks]) => [
          pullNumber,
          checks.map(clonePullRequestCheck),
        ]),
      ),
    ]),
  );
}

export function setFallbackGitHubWorkflowRunsForTests(runsByRepo: Record<string, GitHubWorkflowRun[]>) {
  fallbackGitHubWorkflowRuns = Object.fromEntries(
    Object.entries(runsByRepo).map(([repoFullName, runs]) => [
      repoFullName,
      runs.map((run) => ({ ...run })),
    ]),
  );
  fallbackGitHubWorkflowRunDetails = createFallbackGitHubWorkflowRunDetails(fallbackGitHubWorkflowRuns);
  fallbackGitHubWorkflowJobLogs = createFallbackGitHubWorkflowJobLogs(fallbackGitHubWorkflowRunDetails);
  fallbackGitHubWorkflowArtifactEntries = createFallbackGitHubWorkflowArtifactEntries(fallbackGitHubWorkflowRunDetails);
  fallbackGitHubWorkflowArtifactPreviews = createFallbackGitHubWorkflowArtifactPreviews(fallbackGitHubWorkflowArtifactEntries);
}

export function setFallbackGitHubWorkflowRunDetailsForTests(
  detailsByRepo: Record<string, Record<number, GitHubWorkflowRunDetail>>,
) {
  fallbackGitHubWorkflowRunDetails = Object.fromEntries(
    Object.entries(detailsByRepo).map(([repoFullName, details]) => [
      repoFullName,
      Object.fromEntries(
        Object.entries(details).map(([runId, detail]) => [Number(runId), cloneWorkflowRunDetail(detail)]),
      ),
    ]),
  );
  fallbackGitHubWorkflowJobLogs = createFallbackGitHubWorkflowJobLogs(fallbackGitHubWorkflowRunDetails);
  fallbackGitHubWorkflowArtifactEntries = createFallbackGitHubWorkflowArtifactEntries(fallbackGitHubWorkflowRunDetails);
  fallbackGitHubWorkflowArtifactPreviews = createFallbackGitHubWorkflowArtifactPreviews(fallbackGitHubWorkflowArtifactEntries);
}

export function setFallbackGitHubWorkflowJobLogsForTests(
  logsByRepo: Record<string, Record<number, GitHubWorkflowJobLog>>,
) {
  fallbackGitHubWorkflowJobLogs = Object.fromEntries(
    Object.entries(logsByRepo).map(([repoFullName, logs]) => [
      repoFullName,
      Object.fromEntries(Object.entries(logs).map(([jobId, log]) => [Number(jobId), { ...log }])),
    ]),
  );
}

export function setFallbackGitHubWorkflowArtifactEntriesForTests(
  entriesByRepo: Record<string, Record<number, GitHubWorkflowArtifactEntry[]>>,
) {
  fallbackGitHubWorkflowArtifactEntries = Object.fromEntries(
    Object.entries(entriesByRepo).map(([repoFullName, entries]) => [
      repoFullName,
      Object.fromEntries(
        Object.entries(entries).map(([artifactId, artifactEntries]) => [
          Number(artifactId),
          artifactEntries.map((entry) => ({ ...entry })),
        ]),
      ),
    ]),
  );
}

export function setFallbackGitHubWorkflowArtifactPreviewsForTests(
  previewsByRepo: Record<string, Record<number, Record<string, RepoFilePreview>>>,
) {
  fallbackGitHubWorkflowArtifactPreviews = Object.fromEntries(
    Object.entries(previewsByRepo).map(([repoFullName, previewsByArtifact]) => [
      repoFullName,
      Object.fromEntries(
        Object.entries(previewsByArtifact).map(([artifactId, previews]) => [
          Number(artifactId),
          Object.fromEntries(
            Object.entries(previews).map(([path, preview]) => [path, cloneRepoFilePreview(preview)]),
          ),
        ]),
      ),
    ]),
  );
}

export function setFallbackGitHubCommitsForTests(commitsByRepo: Record<string, CommitSummary[]>) {
  fallbackGitHubCommits = Object.fromEntries(
    Object.entries(commitsByRepo).map(([repoFullName, commits]) => [
      repoFullName,
      commits.map(cloneCommitSummary),
    ]),
  );
}

export function setFallbackGitHubCommitDetailsForTests(detailsByRepo: Record<string, Record<string, CommitDetail>>) {
  fallbackGitHubCommitDetails = Object.fromEntries(
    Object.entries(detailsByRepo).map(([repoFullName, details]) => [
      repoFullName,
      Object.fromEntries(
        Object.entries(details).map(([hash, detail]) => [
          hash,
          cloneCommitDetail(detail),
        ]),
      ),
    ]),
  );
}

function cloneRepoFileTreeEntry(entry: RepoFileTreeEntry): RepoFileTreeEntry {
  return { ...entry };
}

function cloneRepoFilePreview(preview: RepoFilePreview): RepoFilePreview {
  return {
    ...preview,
    dataUrl: preview.dataUrl ?? null,
    images: preview.images ? { ...preview.images } : {},
  };
}

function cloneWorkflowRunDetail(detail: GitHubWorkflowRunDetail): GitHubWorkflowRunDetail {
  return {
    run: { ...detail.run },
    jobs: detail.jobs.map((job) => ({
      ...job,
      steps: job.steps.map((step) => ({ ...step })),
    })),
    artifacts: detail.artifacts.map((artifact) => ({ ...artifact })),
    workflow: detail.workflow ? { ...detail.workflow } : null,
  };
}

function cloneReleaseAsset(asset: GitHubReleaseAsset): GitHubReleaseAsset {
  return { ...asset };
}

function cloneRelease(release: GitHubRelease): GitHubRelease {
  return {
    ...release,
    assets: release.assets.map(cloneReleaseAsset),
  };
}

function cloneRemoteRepoShortcut(shortcut: RemoteRepoShortcut): RemoteRepoShortcut {
  return { ...shortcut };
}

function cloneWorkspaceRepoGroup(group: WorkspaceRepoGroup): WorkspaceRepoGroup {
  return {
    ...group,
    repoIds: [...group.repoIds],
  };
}

function normalizeRemoteRepoId(fullName: string): string | null {
  const trimmed = fullName.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return null;

  const direct = trimmed
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/^ssh:\/\/git@github\.com\//i, "")
    .replace(/\.git$/i, "")
    .trim();

  const parts = direct.split("/").filter((part) => part.length > 0);
  if (parts.length !== 2) return null;

  return parts.join("/");
}

function normalizeRemoteRepoIdKey(fullName: string): string | null {
  const normalized = normalizeRemoteRepoId(fullName);
  return normalized ? normalized.toLowerCase() : null;
}

function cloneWorkspaceSettings(settings: WorkspaceSettings): WorkspaceSettings {
  return {
    ...settings,
    githubBinding: settings.githubBinding
      ? { ...settings.githubBinding, scopes: [...settings.githubBinding.scopes] }
      : null,
    accountPreferences: cloneAccountPreferences(settings.accountPreferences),
    projectLaunchConfigs: { ...settings.projectLaunchConfigs },
    repoSyncPreferences: Object.fromEntries(
      Object.entries(settings.repoSyncPreferences ?? {}).map(([repoId, preference]) => [
        repoId,
        { ...preference },
      ]),
    ),
    repoRemoteSyncPolicies: Object.fromEntries(
      Object.entries(settings.repoRemoteSyncPolicies ?? {}).map(([repoId, policy]) => [
        repoId,
        cloneRepoRemoteSyncPolicy(policy),
      ]),
    ),
    hiddenRepoIds: [...settings.hiddenRepoIds],
    managedRepoIds: [...settings.managedRepoIds],
    systemGitRepoIds: [...settings.systemGitRepoIds],
    repoBindings: Object.fromEntries(
      Object.entries(settings.repoBindings ?? {}).map(([repoId, binding]) => [repoId, { ...binding }]),
    ),
    repoGroups: settings.repoGroups.map(cloneWorkspaceRepoGroup),
    remoteRepoShortcuts: settings.remoteRepoShortcuts.map(cloneRemoteRepoShortcut),
    contributionIdentities: (settings.contributionIdentities ?? []).map((identity) => ({ ...identity })),
    localContributionCache: Object.fromEntries(
      Object.entries(settings.localContributionCache).map(([repoId, days]) => [
        repoId,
        Object.fromEntries(
          Object.entries(days).map(([date, entry]) => [date, { ...entry }]),
        ),
      ]),
    ),
  };
}

function cloneAccountPreferences(preferences: AccountPreferences): AccountPreferences {
  return {
    ...preferences,
    repositoryScope: { ...preferences.repositoryScope },
    repositorySort: { ...preferences.repositorySort },
    issues: { ...preferences.issues },
    pullRequests: { ...preferences.pullRequests },
    actions: { ...preferences.actions },
  };
}

function fallbackAccountKey(login: string | null | undefined): string {
  return login?.trim().toLocaleLowerCase() || FALLBACK_ANONYMOUS_ACCOUNT_KEY;
}

function switchFallbackAccount(binding: GitHubBindingStatus): void {
  const previousKey = fallbackAccountKey(fallbackSettings.githubBinding?.login);
  fallbackSettingsByAccount.set(previousKey, cloneWorkspaceSettings(fallbackSettings));

  fallbackBinding = {
    ...binding,
    binding: binding.binding
      ? { ...binding.binding, scopes: [...binding.binding.scopes] }
      : null,
  };
  const nextKey = fallbackAccountKey(fallbackBinding.binding?.login);
  const nextSettings = fallbackSettingsByAccount.get(nextKey)
    ?? createFallbackSettings(fallbackBinding.binding, false);
  fallbackSettings = {
    ...cloneWorkspaceSettings(nextSettings),
    githubBinding: fallbackBinding.binding,
  };
  fallbackStartupCache = null;
  fallbackActiveRepoId = null;
  fallbackRemoteFailureCounts.clear();
  fallbackRemoteRetryAt.clear();
  fallbackBaselineRepoKeys.clear();
}

function currentFallbackGitHubAccountLogin(): string | null {
  return fallbackSettings.githubBinding?.login.trim() || null;
}

function migrateFallbackRemoteRepoShortcuts(): void {
  const accountLogin = currentFallbackGitHubAccountLogin();
  if (!accountLogin) return;
  fallbackSettings = {
    ...fallbackSettings,
    remoteRepoShortcuts: fallbackSettings.remoteRepoShortcuts.map((shortcut) => {
      const fullName = normalizeRemoteRepoId(shortcut.fullName);
      return {
        ...shortcut,
        accountLogin: shortcut.accountLogin?.trim() || accountLogin,
        canonicalRemoteUrl: fullName ? `https://github.com/${fullName}.git` : shortcut.canonicalRemoteUrl,
      };
    }),
  };
}

function visibleFallbackSettings(): WorkspaceSettings {
  migrateFallbackRemoteRepoShortcuts();
  const settings = cloneWorkspaceSettings(fallbackSettings);
  const accountLogin = currentFallbackGitHubAccountLogin();
  settings.remoteRepoShortcuts = accountLogin
    ? settings.remoteRepoShortcuts.filter(
      (shortcut) => shortcut.accountLogin?.toLowerCase() === accountLogin.toLowerCase(),
    )
    : [];
  return settings;
}

function cloneContributionIdentityRecommendationResult(
  result: ContributionIdentityRecommendationResult,
): ContributionIdentityRecommendationResult {
  return {
    scannedRepoCount: result.scannedRepoCount,
    skippedRepoCount: result.skippedRepoCount,
    recommendations: result.recommendations.map((recommendation) => ({
      identity: { ...recommendation.identity },
      confidence: recommendation.confidence,
      missedCommitCount: recommendation.missedCommitCount,
      repoCount: recommendation.repoCount,
      latestCommitAt: recommendation.latestCommitAt,
      repos: recommendation.repos.map((repo) => ({ ...repo })),
    })),
  };
}

export function setFallbackRepoFilesForTests(filesByRepo: Record<string, Record<string, RepoFileTreeEntry[]>>) {
  fallbackRepoFiles = Object.fromEntries(
    Object.entries(filesByRepo).map(([repoId, directories]) => [
      repoId,
      Object.fromEntries(
        Object.entries(directories).map(([parentPath, entries]) => [
          parentPath,
          entries.map(cloneRepoFileTreeEntry),
        ]),
      ),
    ]),
  );
}

export function setFallbackRepoFilesOverrideForTests(
  override: FallbackRepoFilesOverride | null,
) {
  fallbackRepoFilesOverride = override;
}

export function setFallbackGitHubRepoFilesForTests(filesByRepo: Record<string, Record<string, RepoFileTreeEntry[]>>) {
  fallbackGitHubRepoFiles = Object.fromEntries(
    Object.entries(filesByRepo).map(([repoFullName, directories]) => [
      repoFullName,
      Object.fromEntries(
        Object.entries(directories).map(([parentPath, entries]) => [
          parentPath,
          entries.map(cloneRepoFileTreeEntry),
        ]),
      ),
    ]),
  );
}

export function setFallbackRepoFilePreviewsForTests(previewsByRepo: Record<string, Record<string, RepoFilePreview>>) {
  fallbackRepoFilePreviews = Object.fromEntries(
    Object.entries(previewsByRepo).map(([repoId, previews]) => [
      repoId,
      Object.fromEntries(
        Object.entries(previews).map(([path, preview]) => [path, cloneRepoFilePreview(preview)]),
      ),
    ]),
  );
}

export function setFallbackGitHubRepoFilePreviewsForTests(previewsByRepo: Record<string, Record<string, RepoFilePreview>>) {
  fallbackGitHubRepoFilePreviews = Object.fromEntries(
    Object.entries(previewsByRepo).map(([repoFullName, previews]) => [
      repoFullName,
      Object.fromEntries(
        Object.entries(previews).map(([path, preview]) => [path, cloneRepoFilePreview(preview)]),
      ),
    ]),
  );
}

async function call<T>(
  command: string,
  args?: Record<string, unknown>,
  fallback?: () => T | FallbackOperationError<T> | Promise<T | FallbackOperationError<T>>,
): Promise<T> {
  if (fallback) {
    const descriptor = fallbackOperationDescriptor(command, args);
    if (descriptor) return enqueueFallbackOperation<T>(descriptor, fallback);
    const result = await fallback();
    return isFallbackOperationError(result) ? result.value as T : result;
  }
  throw new Error("Workspace fallback is unavailable for this command");
}

type FallbackOperationDescriptor = {
  kind: WorkspaceTask["kind"];
  title: string;
  priority: WorkspaceTask["priority"];
  repoId: string | null;
  operationKind: FallbackOperationKind;
  lane: FallbackOperationLane;
  corePriority: number;
  resources: FallbackOperationResource[];
};

type FallbackOperationKind =
  | "localRead"
  | "localWrite"
  | "githubRead"
  | "githubWrite"
  | "githubTransfer"
  | "workspaceAnalysis"
  | "bulk"
  | "launchControl";

type FallbackOperationLane = "interactive" | "background" | "bulk";
type FallbackOperationResource = { key: string; access: "read" | "write" };

const fallbackOperationLimits: Record<FallbackOperationKind, number> = {
  localRead: 4,
  localWrite: 2,
  githubRead: 4,
  githubWrite: 2,
  githubTransfer: 2,
  workspaceAnalysis: 2,
  bulk: 4,
  launchControl: 2,
};

function fallbackOperationDescriptor(
  command: string,
  args?: Record<string, unknown>,
): FallbackOperationDescriptor | null {
  const repoId = typeof args?.repoId === "string" ? args.repoId : null;
  if (command === "bulk_sync_execute") {
    const trigger = args?.trigger;
    const repoIds = Array.isArray(args?.repoIds)
      ? args.repoIds.filter((value): value is string => typeof value === "string")
      : [];
    return {
      kind: "sync",
      title: trigger === "autoSync" ? "自动同步仓库" : trigger === "syncAll" ? "同步全部仓库" : "批量同步仓库",
      priority: trigger === "autoSync" ? "normal" : "high",
      repoId,
      operationKind: "bulk",
      lane: trigger === "autoSync" ? "background" : "bulk",
      corePriority: trigger === "autoSync" ? -50 : trigger === "syncAll" ? 50 : 100,
      resources: fallbackRepoResources(repoIds, "write"),
    };
  }
  if (command === "workspace_discover_repos") {
    return {
      kind: "discoverRepos",
      title: "发现工作区仓库",
      priority: "low",
      repoId: null,
      operationKind: "workspaceAnalysis",
      lane: "background",
      corePriority: -25,
      resources: fallbackRepoResources(allFallbackRepos().map((repo) => repo.id), "read"),
    };
  }
  if (command === "workspace_refresh_repos" || command === "repo_refresh_summary") {
    const fetchRemote = command === "repo_refresh_summary" &&
      typeof args?.options === "object" && args.options !== null &&
      "fetchRemote" in args.options && Boolean((args.options as { fetchRemote?: unknown }).fetchRemote);
    return {
      kind: "repoStatus",
      title: "刷新仓库状态",
      priority: command === "workspace_refresh_repos" ? "high" : "normal",
      repoId,
      operationKind: command === "workspace_refresh_repos" ? "workspaceAnalysis" : fetchRemote ? "localWrite" : "localRead",
      lane: "interactive",
      corePriority: command === "workspace_refresh_repos" ? 50 : 0,
      resources: command === "workspace_refresh_repos"
        ? fallbackRepoResources(allFallbackRepos().map((repo) => repo.id), "read")
        : fallbackRepoResources(repoId ? [repoId] : [], fetchRemote ? "write" : "read"),
    };
  }
  if (command === "repo_refresh_language_stats") {
    return {
      kind: "languageStats",
      title: "更新代码统计",
      priority: "low",
      repoId,
      operationKind: "workspaceAnalysis",
      lane: "background",
      corePriority: -25,
      resources: fallbackRepoResources(repoId ? [repoId] : [], "read"),
    };
  }
  if (command === "workspace_scan_contribution_identities" || command === "github_list_repo_contribution") {
    return {
      kind: "contributions",
      title: "更新贡献统计",
      priority: "low",
      repoId,
      operationKind: "workspaceAnalysis",
      lane: "background",
      corePriority: -25,
      resources: repoId
        ? fallbackRepoResources([repoId], "read")
        : fallbackRepoResources(allFallbackRepos().map((repo) => repo.id), "read"),
    };
  }
  if (command === "repo_start_launch" || command === "repo_stop_launch") {
    return {
      kind: "launch",
      title: command === "repo_start_launch" ? "启动项目" : "停止项目",
      priority: "high",
      repoId,
      operationKind: "launchControl",
      lane: "interactive",
      corePriority: 50,
      resources: fallbackRepoResources(repoId ? [repoId] : [], "write"),
    };
  }
  if (
    command === "github_list_workflow_artifact_files" ||
    command === "github_get_workflow_artifact_file_preview" ||
    command === "github_attach_workflow_artifact_asset" ||
    command === "github_upload_release_asset"
  ) {
    return {
      kind: "github",
      title: "传输 GitHub 文件",
      priority: "normal",
      repoId,
      operationKind: "githubTransfer",
      lane: "interactive",
      corePriority: 0,
      resources: fallbackGitHubResources(args),
    };
  }
  if (
    command === "workspace_add_repo" ||
    command === "workspace_create_local_repo" ||
    command === "workspace_clone_repo" ||
    command === "workspace_delete_local_repo"
  ) {
    const titles: Record<string, string> = {
      workspace_add_repo: "添加仓库",
      workspace_create_local_repo: "创建本地仓库",
      workspace_clone_repo: "克隆仓库",
      workspace_delete_local_repo: "删除本地仓库",
    };
    return {
      kind: "workspace",
      title: titles[command]!,
      priority: "high",
      repoId,
      operationKind: "localWrite",
      lane: "interactive",
      corePriority: 50,
      resources: [
        { key: "workspace", access: "write" },
        ...fallbackRepoResources(repoId ? [repoId] : [], "write"),
      ],
    };
  }
  if (command.startsWith("repo_") && isFallbackRepoWrite(command)) {
    return {
      kind: "git",
      title: "更新本地仓库",
      priority: "high",
      repoId,
      operationKind: "localWrite",
      lane: "interactive",
      corePriority: 50,
      resources: fallbackRepoResources(repoId ? [repoId] : [], "write"),
    };
  }
  if (command.startsWith("github_") && isFallbackGitHubWrite(command)) {
    return {
      kind: "github",
      title: "更新 GitHub 仓库",
      priority: "normal",
      repoId,
      operationKind: "githubWrite",
      lane: "interactive",
      corePriority: 0,
      resources: fallbackGitHubResources(args),
    };
  }
  return null;
}

function fallbackRepoResources(repoIds: string[], access: FallbackOperationResource["access"]) {
  return Array.from(new Set(repoIds.map(fallbackRepoResourceKey)))
    .sort()
    .map((key) => ({ key: `repo:${key}`, access }));
}

function fallbackRepoResourceKey(repoId: string) {
  return allFallbackRepos().find((repo) => repo.id === repoId)?.worktree.sharedRepoKey || repoId;
}

function fallbackGitHubResources(args?: Record<string, unknown>): FallbackOperationResource[] {
  const repoFullName = typeof args?.repoFullName === "string" ? args.repoFullName : null;
  if (!repoFullName) return [];
  const artifactId = typeof args?.artifactId === "number" ? args.artifactId : null;
  return [{
    key: artifactId == null ? `github:${repoFullName}` : `github:${repoFullName}:artifact:${artifactId}`,
    access: "write",
  }];
}

function isFallbackRepoWrite(command: string) {
  return command !== "repo_set_preference" &&
    command !== "repo_set_auto_sync" &&
    command !== "repo_save_launch_config" &&
    command !== "repo_use_default_token_auth" &&
    !command.startsWith("repo_get_") &&
    !command.startsWith("repo_list_") &&
    !command.startsWith("repo_refresh_");
}

function isFallbackGitHubWrite(command: string) {
  return command.startsWith("github_create_") ||
    command.startsWith("github_update_") ||
    command.startsWith("github_delete_") ||
    command.startsWith("github_merge_") ||
    command.startsWith("github_rerun_");
}

function enqueueFallbackOperation<T>(
  descriptor: FallbackOperationDescriptor,
  execute: () => T | FallbackOperationError<T> | Promise<T | FallbackOperationError<T>>,
): Promise<T> {
  const task = recordFallbackTask(
    descriptor.kind,
    descriptor.priority,
    descriptor.repoId,
    "pending",
    null,
    true,
    descriptor.title,
  );
  emitFallbackWorkspaceEvent("workspace://task-changed", task);
  return new Promise<T>((resolve, reject) => {
    const dispatchDelay = import.meta.env.VITE_LILIA_GITHUB_AGENT_DEBUG === "1" ? 750 : 0;
    fallbackOperationEntries.set(task.id, {
      taskId: task.id,
      descriptor,
      state: "pending",
      generation: fallbackOperationGeneration,
      sequence: fallbackOperationSequence++,
      readyAt: Date.now() + dispatchDelay,
      execute,
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    scheduleFallbackOperationPump();
  });
}

const fallbackOperationErrorMarker = Symbol("fallback-operation-error");
type FallbackOperationError<T> = {
  [fallbackOperationErrorMarker]: true;
  value: T;
  message: string;
};

function fallbackOperationError<T>(
  value: T,
  message: string,
): FallbackOperationError<T> {
  return { [fallbackOperationErrorMarker]: true, value, message };
}

function isFallbackOperationError(value: unknown): value is FallbackOperationError<unknown> {
  return typeof value === "object" && value !== null && fallbackOperationErrorMarker in value;
}

function scheduleFallbackOperationPump() {
  if (fallbackOperationPumpTimer) return;
  const now = Date.now();
  const pending = Array.from(fallbackOperationEntries.values())
    .filter((entry) => entry.state === "pending");
  const hasReadyOperation = pending.some((entry) => entry.readyAt <= now && fallbackOperationCanStart(entry));
  const nextReadyAt = Math.min(
    ...pending
      .filter((entry) => entry.readyAt > now)
      .map((entry) => entry.readyAt),
  );
  if (!hasReadyOperation && !Number.isFinite(nextReadyAt)) return;
  fallbackOperationPumpTimer = setTimeout(() => {
    fallbackOperationPumpTimer = null;
    pumpFallbackOperations();
  }, hasReadyOperation ? 0 : Math.max(0, nextReadyAt - now));
}

function pumpFallbackOperations() {
  let started = false;
  do {
    started = false;
    const entry = nextFallbackOperation();
    if (entry) {
      startFallbackOperation(entry);
      started = true;
    }
  } while (started);
  scheduleFallbackOperationPump();
}

function nextFallbackOperation() {
  const now = Date.now();
  const laneRank: Record<FallbackOperationLane, number> = { interactive: 2, bulk: 1, background: 0 };
  return Array.from(fallbackOperationEntries.values())
    .filter((entry) => entry.state === "pending" && entry.readyAt <= now && fallbackOperationCanStart(entry))
    .sort((left, right) =>
      right.descriptor.corePriority - left.descriptor.corePriority ||
      laneRank[right.descriptor.lane] - laneRank[left.descriptor.lane] ||
      left.sequence - right.sequence
    )[0];
}

function fallbackOperationCanStart(entry: FallbackOperationEntry) {
  if (fallbackOperationRunningByKind[entry.descriptor.operationKind] >=
    fallbackOperationLimits[entry.descriptor.operationKind]) return false;
  return fallbackResourcesCanAcquire(entry.descriptor.resources);
}

function fallbackResourcesCanAcquire(requirements: readonly FallbackOperationResource[]) {
  return requirements.every((requirement) => {
    const resource = fallbackOperationResources.get(requirement.key);
    if (!resource) return true;
    return requirement.access === "read" ? !resource.writer : !resource.writer && resource.readers === 0;
  });
}

function acquireFallbackResources(requirements: readonly FallbackOperationResource[]) {
  for (const requirement of requirements) {
    const resource = fallbackOperationResources.get(requirement.key) ?? { readers: 0, writer: false };
    if (requirement.access === "read") resource.readers += 1;
    else resource.writer = true;
    fallbackOperationResources.set(requirement.key, resource);
  }
}

function releaseFallbackResources(requirements: readonly FallbackOperationResource[]) {
  for (const requirement of requirements) {
    const resource = fallbackOperationResources.get(requirement.key);
    if (!resource) continue;
    if (requirement.access === "read") resource.readers -= 1;
    else resource.writer = false;
    if (!resource.writer && resource.readers === 0) fallbackOperationResources.delete(requirement.key);
  }
}

function startFallbackOperation(entry: FallbackOperationEntry) {
  entry.state = "running";
  fallbackOperationRunningByKind[entry.descriptor.operationKind] += 1;
  acquireFallbackResources(entry.descriptor.resources);
  updateFallbackTask(entry.taskId, "running", null, false);
  void Promise.resolve()
    .then(entry.execute)
    .then((result) => {
      if (isFallbackOperationError(result)) {
        if (entry.generation === fallbackOperationGeneration) {
          updateFallbackTask(entry.taskId, "error", result.message, false);
        }
        entry.resolve(result.value);
      } else {
        if (entry.generation === fallbackOperationGeneration) {
          updateFallbackTask(entry.taskId, "success", "已完成", false);
        }
        entry.resolve(result);
      }
    })
    .catch((error) => {
      if (entry.generation === fallbackOperationGeneration) {
        updateFallbackTask(entry.taskId, "error", String(error), false);
      }
      entry.reject(error);
    })
    .finally(() => {
      if (entry.generation !== fallbackOperationGeneration || fallbackOperationEntries.get(entry.taskId) !== entry) {
        return;
      }
      fallbackOperationEntries.delete(entry.taskId);
      fallbackOperationRunningByKind[entry.descriptor.operationKind] -= 1;
      releaseFallbackResources(entry.descriptor.resources);
      pumpFallbackOperations();
      scheduleFallbackRefreshPump();
    });
}

function recordFallbackTask(
  kind: WorkspaceTask["kind"],
  priority: WorkspaceTask["priority"],
  repoId: string | null,
  status: WorkspaceTask["status"],
  message: string | null,
  cancellable: boolean,
  title: string,
) {
  const createdAt = Date.now();
  const task: WorkspaceTask = {
    id: `fallback-task-${fallbackTaskIndex++}`,
    kind,
    title,
    priority,
    repoId,
    status,
    message,
    createdAt,
    updatedAt: createdAt,
    cancellable,
  };
  fallbackTasks = normalizeWorkspaceTasks([task, ...fallbackTasks]);
  return task;
}

export function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  return call("workspace_get_settings", undefined, visibleFallbackSettings);
}

function startupCacheMatchesSettings(cache: WorkspaceStartupCache | null) {
  return Boolean(cache) &&
    cache?.workspaceRoot === fallbackSettings.workspaceRoot &&
    cache?.bindingLogin === (fallbackSettings.githubBinding?.login ?? null);
}

function currentStartupCache(): WorkspaceStartupCache {
  if (startupCacheMatchesSettings(fallbackStartupCache)) {
    return cloneStartupCache(fallbackStartupCache!);
  }
  return {
    workspaceRoot: fallbackSettings.workspaceRoot,
    bindingLogin: fallbackSettings.githubBinding?.login ?? null,
    reposById: {},
    contributions: null,
  };
}

function writeFallbackStartupRepoSummary(summary: RepoSummary, remoteCheckedAt?: number | null) {
  const cache = currentStartupCache();
  const current = cache.reposById[summary.id];
  cache.reposById[summary.id] = {
    summary: cloneRepoSummary(summary),
    cachedAt: Date.now(),
    remoteCheckedAt: remoteCheckedAt === undefined
      ? current?.remoteCheckedAt ?? null
      : remoteCheckedAt,
  };
  fallbackStartupCache = cache;
}

export function readStartupCache(): Promise<WorkspaceStartupCache | null> {
  return call("workspace_read_startup_cache", undefined, () =>
    startupCacheMatchesSettings(fallbackStartupCache) ? cloneStartupCache(fallbackStartupCache!) : null,
  );
}

export function clearStartupCache(): Promise<void> {
  return call("workspace_clear_startup_cache", undefined, () => {
    fallbackStartupCache = null;
  });
}

export function clearRepoLocalCache(repoId: string, repoFullName?: string | null): Promise<void> {
  return call("repo_clear_local_cache", { repoId, repoFullName: repoFullName ?? null }, () => {
    if (!startupCacheMatchesSettings(fallbackStartupCache)) return;
    const cache = cloneStartupCache(fallbackStartupCache!);
    delete cache.reposById[repoId];
    fallbackStartupCache = cache;
  });
}

export function writeStartupContributions(
  contributions: WorkspaceStartupContributions,
): Promise<WorkspaceStartupCache> {
  return call("workspace_write_startup_contributions", { contributions }, () => {
    const cache = currentStartupCache();
    cache.contributions = {
      days: contributions.days.map(cloneContributionDay),
      meta: { ...contributions.meta },
      cachedAt: Date.now(),
    };
    fallbackStartupCache = cache;
    return cloneStartupCache(cache);
  });
}

export function setWorkspaceRoot(workspaceRoot: string): Promise<WorkspaceSettings> {
  return call("workspace_set_root", { workspaceRoot }, () => {
    const normalizedRoot = workspaceRoot.trim();
    if (!normalizedRoot) throw new Error("工作区路径不能为空");
    const pendingTaskIds = fallbackTasks
      .filter((task) => task.status === "pending" && task.cancellable)
      .map((task) => task.id);
    for (const taskId of pendingTaskIds) cancelPendingFallbackTask(taskId, "工作区已切换");
    fallbackActiveRepoId = null;
    fallbackRemoteFailureCounts.clear();
    fallbackRemoteRetryAt.clear();
    fallbackBaselineRepoKeys.clear();
    fallbackSettings = {
      ...fallbackSettings,
      workspaceRoot: normalizedRoot,
      accountPreferences: {
        ...fallbackSettings.accountPreferences,
        defaultWorkspaceRoot: normalizedRoot,
      },
    };
    fallbackStartupCache = null;
    return visibleFallbackSettings();
  });
}

function normalizeAccountPreferences(preferences: AccountPreferences): AccountPreferences {
  const oneOf = <T extends string>(value: T, allowed: readonly T[]) => {
    if (!allowed.includes(value)) throw new Error("账号偏好值无效");
    return value;
  };
  const direction = (value: AccountPreferences["repositorySort"]["direction"]) =>
    oneOf(value, ["asc", "desc"] as const);
  const scope = preferences.repositoryScope;
  if (!scope || !["all", "personal", "organization"].includes(scope.kind)) {
    throw new Error("仓库范围无效");
  }
  const repositoryScope = scope.kind === "all"
    ? { kind: "all" } as const
    : { kind: scope.kind, login: scope.login.trim() };
  if (repositoryScope.kind !== "all" && !repositoryScope.login) {
    throw new Error("仓库范围账号不能为空");
  }
  return {
    defaultWorkspaceRoot: preferences.defaultWorkspaceRoot?.trim() || null,
    repositoryScope,
    repositorySort: {
      key: oneOf(preferences.repositorySort.key, ["name", "created", "updated"] as const),
      direction: direction(preferences.repositorySort.direction),
    },
    issues: {
      state: oneOf(preferences.issues.state, ["open", "closed", "all"] as const),
      sort: oneOf(preferences.issues.sort, ["created", "updated", "comments"] as const),
      direction: direction(preferences.issues.direction),
    },
    pullRequests: {
      state: oneOf(preferences.pullRequests.state, ["open", "closed", "merged"] as const),
      sort: oneOf(preferences.pullRequests.sort, ["created", "updated", "comments"] as const),
      direction: direction(preferences.pullRequests.direction),
    },
    actions: {
      state: oneOf(preferences.actions.state, ["all", "active", "completed"] as const),
      sort: oneOf(preferences.actions.sort, ["updated", "created", "run-number"] as const),
      direction: direction(preferences.actions.direction),
    },
  };
}

export function updateAccountPreferences(preferences: AccountPreferences): Promise<WorkspaceSettings> {
  return call("workspace_update_account_preferences", { preferences }, () => {
    const normalized = normalizeAccountPreferences(preferences);
    const rootChanged = normalized.defaultWorkspaceRoot !== fallbackSettings.workspaceRoot;
    fallbackSettings = {
      ...fallbackSettings,
      workspaceRoot: normalized.defaultWorkspaceRoot,
      accountPreferences: normalized,
    };
    if (rootChanged) {
      for (const task of fallbackTasks.filter((item) => item.status === "pending" && item.cancellable)) {
        cancelPendingFallbackTask(task.id, "工作区已切换");
      }
      fallbackActiveRepoId = null;
      fallbackRemoteFailureCounts.clear();
      fallbackRemoteRetryAt.clear();
      fallbackBaselineRepoKeys.clear();
      fallbackStartupCache = null;
    }
    return visibleFallbackSettings();
  });
}

export function setContributionIdentities(
  identities: import("./types").ContributionIdentity[],
): Promise<WorkspaceSettings> {
  return call("workspace_set_contribution_identities", { identities }, () => {
    const seen = new Set<string>();
    const contributionIdentities = identities.flatMap((identity) => {
      const name = identity.name?.trim() || null;
      const email = identity.email?.trim().toLowerCase() || null;
      if (!name && !email) return [];
      const key = `${name?.toLowerCase() ?? ""}\u001f${email ?? ""}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ name, email }];
    });
    fallbackSettings = { ...fallbackSettings, contributionIdentities };
    fallbackStartupCache = null;
    return visibleFallbackSettings();
  });
}

export function scanContributionIdentities(): Promise<ContributionIdentityRecommendationResult> {
  return call("workspace_scan_contribution_identities", undefined, () =>
    cloneContributionIdentityRecommendationResult(
      fallbackContributionIdentityRecommendations ?? {
        scannedRepoCount: visibleManagedFallbackRepos().length,
        skippedRepoCount: 0,
        recommendations: [],
      },
    ),
  );
}

export function setRepoSetting(
  repoId: string,
  key: keyof RepoSyncPreference,
  value: boolean,
): Promise<WorkspaceSettings> {
  return call("repo_set_preference", { repoId, key, value }, () => {
    const normalized = repoId.trim();
    if (!normalized) throw new Error("仓库 ID 不能为空");
    fallbackSettings = {
      ...fallbackSettings,
      repoSyncPreferences: withRepoSettingPreference(
        fallbackSettings.repoSyncPreferences,
        normalized,
        key,
        value,
      ),
    };
    return visibleFallbackSettings();
  });
}

export function setRepoAutoSync(repoId: string, autoSync: boolean): Promise<WorkspaceSettings> {
  return call("repo_set_auto_sync", { repoId, autoSync }, () => {
    const normalized = repoId.trim();
    if (!normalized) throw new Error("仓库 ID 不能为空");
    fallbackSettings = {
      ...fallbackSettings,
      repoSyncPreferences: withRepoAutoSyncPreference(
        fallbackSettings.repoSyncPreferences,
        normalized,
        autoSync,
      ),
    };
    return visibleFallbackSettings();
  });
}

export function pickWorkspaceRoot(): Promise<string | null> {
  return call("workspace_pick_root", undefined, () => fallbackSettings.workspaceRoot);
}

export function pickRepo(): Promise<string | null> {
  return call("workspace_pick_repo", undefined, () => allFallbackRepos()[0]?.path ?? null);
}

export function pickFiles(): Promise<string[]> {
  return call("workspace_pick_files", undefined, () => [...fallbackPickFilesResult]);
}

export function refreshRepos(): Promise<RepoSummary[]> {
  return call("workspace_refresh_repos", undefined, () => {
    const repos = visibleFallbackRepos();
    return repos;
  });
}

export function listManagedRepos(): Promise<RepoSummary[]> {
  return call("workspace_list_managed_repos", undefined, () => {
    const cache = startupCacheMatchesSettings(fallbackStartupCache) ? fallbackStartupCache : null;
    const repos = visibleManagedFallbackRepos().map((repo) => {
      const lightweight = lightweightRepoSummary(repo);
      const cached = cache?.reposById[repo.id]?.summary;
      return cached ? {
        ...cloneRepoSummary(cached),
        id: lightweight.id,
        name: lightweight.name,
        path: lightweight.path,
        relativePath: lightweight.relativePath,
        worktree: { ...lightweight.worktree },
      } : lightweight;
    });
    const workspaceRoot = fallbackSettings.workspaceRoot;
    const baselineRepos = workspaceRoot
      ? repos.filter((repo) => {
          const key = `${workspaceRoot}\0${repo.id}`;
          if (fallbackBaselineRepoKeys.has(key)) return false;
          fallbackBaselineRepoKeys.add(key);
          return true;
        })
      : [];
    if (baselineRepos.length) {
      setTimeout(() => {
        for (const repo of baselineRepos) {
          void enqueueRepoRefresh({
            repoId: repo.id,
            mode: "local",
            priority: "low",
            force: false,
            detailScope: "summary",
            trigger: "startup",
          });
        }
      }, 0);
    }
    return repos;
  });
}

export function discoverRepos(): Promise<RepoSummary[]> {
  return call("workspace_discover_repos", undefined, () => {
    const discovered = visibleFallbackRepos();
    fallbackSettings = {
      ...fallbackSettings,
      managedRepoIds: Array.from(new Set([...fallbackSettings.managedRepoIds, ...discovered.map((repo) => repo.id)])).sort(),
    };
    return discovered;
  });
}

export function addRepo(repoPath: string): Promise<RepoSummary> {
  return call("workspace_add_repo", { repoPath }, () => {
    const repo = allFallbackRepos().find((item) => item.path === repoPath || item.id === repoPath) ?? fallbackRepos[0];
    fallbackSettings = {
      ...fallbackSettings,
      hiddenRepoIds: fallbackSettings.hiddenRepoIds.filter((id) => id !== repo.id),
      managedRepoIds: Array.from(new Set([...fallbackSettings.managedRepoIds, repo.id])).sort(),
    };
    return { ...repo };
  });
}

export function createLocalRepo(request: WorkspaceCreateLocalRepoRequest): Promise<RepoSummary> {
  return call("workspace_create_local_repo", { request }, () => {
    const name = request.name.trim();
    if (!name) throw new Error("仓库名不能为空");
    if (name.includes("/") || name.includes("\\") || name === "..") {
      throw new Error("仓库名只能是单层目录名");
    }
    if (allFallbackRepos().some((repo) => repo.id === name || repo.name === name)) {
      throw new Error(`目标目录已存在：C:\\Files\\workspace\\${name}`);
    }
    const now = Date.now();
    const repo: RepoSummary = {
      id: name,
      name,
      path: `C:\\Files\\workspace\\${name}`,
      relativePath: name,
      currentBranch: "main",
      remoteUrl: null,
      githubFullName: null,
      ahead: 0,
      behind: 0,
      remoteBranchStates: [],
      remotesNeedingPull: 0,
      remotesNeedingPush: 0,
      stagedCount: 0,
      unstagedCount: request.addReadme || request.gitignoreTemplate || request.licenseTemplate ? 1 : 0,
      untrackedCount: 0,
      conflictCount: 0,
      lastCommitAt: null,
      lastCommitMessage: null,
      languageStats: [],
      languageStatsUpdatedAt: now,
      worktree: {
        role: "standalone",
        sharedRepoKey: `repo:${name}`,
        mainRepoId: null,
      },
    };
    fallbackClonedRepos = [...fallbackClonedRepos.filter((item) => item.id !== repo.id), repo];
    fallbackSettings = {
      ...fallbackSettings,
      hiddenRepoIds: fallbackSettings.hiddenRepoIds.filter((id) => id !== repo.id),
      managedRepoIds: Array.from(new Set([...fallbackSettings.managedRepoIds, repo.id])).sort(),
    };
    writeFallbackStartupRepoSummary(repo);
    return cloneRepoSummary(repo);
  });
}

function inferRepoDirectoryName(remoteUrl: string) {
  const trimmed = remoteUrl.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  const [, scpPath] = trimmed.match(/^[\w.-]+@[^:]+:(.+)$/) ?? [];
  const source = scpPath ?? trimmed;
  const parts = source.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || `cloned-repo-${fallbackCloneIndex++}`;
}

export function cloneRepo(request: WorkspaceCloneRepoRequest): Promise<RepoSummary> {
  return call("workspace_clone_repo", { request }, () => {
    const remoteUrl = request.repository?.cloneUrl || request.remoteUrl;
    const inferredName = inferRepoDirectoryName(remoteUrl);
    const fullName = request.repository?.fullName
      ?? remoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i)?.slice(1, 3).join("/")
      ?? null;
    const defaultRelativePath = fullName ?? inferredName;
    const targetPath = request.target.kind === "custom"
      ? request.target.path.trim()
      : `C:\\Files\\workspace\\${defaultRelativePath.split("/").join("\\")}`;
    const name = inferRepoDirectoryName(targetPath || inferredName);
    const relativePath = request.target.kind === "default" ? defaultRelativePath : name;
    const repo: RepoSummary = {
      id: relativePath,
      name,
      path: targetPath,
      relativePath,
      currentBranch: "main",
      remoteUrl,
      githubFullName: fullName,
      githubRepositoryId: request.repository?.id ?? null,
      canonicalRemoteUrl: fullName ? `https://github.com/${fullName}.git` : null,
      ahead: 0,
      behind: 0,
      remoteBranchStates: [{
        remote: "origin",
        remoteBranch: "main",
        exists: true,
        ahead: 0,
        behind: 0,
        needsPull: false,
        needsPush: false,
        upstream: true,
      }],
      remotesNeedingPull: 0,
      remotesNeedingPush: 0,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      conflictCount: 0,
      lastCommitAt: null,
      lastCommitMessage: null,
      languageStats: [],
      languageStatsUpdatedAt: Date.now(),
      worktree: {
        role: "standalone",
        sharedRepoKey: `repo:${relativePath}`,
        mainRepoId: null,
      },
    };
    fallbackClonedRepos = [...fallbackClonedRepos.filter((item) => item.id !== repo.id), repo];
    fallbackSettings = {
      ...fallbackSettings,
      managedRepoIds: Array.from(new Set([...fallbackSettings.managedRepoIds, repo.id])).sort(),
      repoBindings: fullName ? {
        ...fallbackSettings.repoBindings,
        [repo.id]: {
          repositoryId: request.repository?.id ?? null,
          remoteFullName: fullName,
          canonicalRemoteUrl: `https://github.com/${fullName}.git`,
          localPath: targetPath,
        },
      } : fallbackSettings.repoBindings,
    };
    return { ...repo };
  });
}

export function getRepoSummary(repoId: string): Promise<RepoSummary> {
  return call("repo_get_summary", { repoId }, () => ({ ...fallbackRepo(repoId) }));
}

export function getRepoStorageStats(repoId: string): Promise<RepoStorageStats> {
  return call("repo_get_storage_stats", { repoId }, () => ({
    logicalBytes: null,
  }));
}

export function refreshRepoSummary(
  repoId: string,
  options: RepoRefreshSummaryOptions = {},
): Promise<RepoSummary> {
  return call("repo_refresh_summary", { repoId, options }, () => {
    const repo = fallbackRepo(repoId);
    const error = options.fetchRemote && repo.remoteUrl ? fallbackRepoRemoteSyncOverride?.(repo) : null;
    writeFallbackStartupRepoSummary(repo);
    const summary = cloneRepoSummary(repo);
    return error
      ? fallbackOperationError(summary, `仓库状态已刷新，远端同步失败：${error}`)
      : summary;
  });
}

function allFallbackRepos() {
  return [...fallbackRepos, ...fallbackClonedRepos].map((repo) => fallbackRepoOverrides[repo.id] ?? repo);
}

function visibleManagedFallbackRepos() {
  const managed = new Set(fallbackSettings.managedRepoIds);
  const hidden = new Set(fallbackSettings.hiddenRepoIds);
  return allFallbackRepos()
    .filter((repo) => managed.has(repo.id) && !hidden.has(repo.id))
    .map((repo) => ({ ...repo }));
}

function visibleFallbackRepos() {
  const hidden = new Set(fallbackSettings.hiddenRepoIds);
  return allFallbackRepos()
    .filter((repo) => !hidden.has(repo.id))
    .map((repo) => ({ ...repo }));
}

function lightweightRepoSummary(repo: RepoSummary): RepoSummary {
  return {
    id: repo.id,
    name: repo.name,
    path: repo.path,
    relativePath: repo.relativePath,
    currentBranch: null,
    remoteUrl: null,
    githubFullName: null,
    ahead: 0,
    behind: 0,
    remoteBranchStates: [],
    remotesNeedingPull: 0,
    remotesNeedingPush: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictCount: 0,
    lastCommitAt: null,
    lastCommitMessage: null,
    languageStats: [],
    languageStatsUpdatedAt: 0,
    worktree: { ...repo.worktree },
  };
}

export function hideRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_hide_repo", { repoId }, () => {
    if (!allFallbackRepos().some((repo) => repo.id === repoId)) {
      throw new Error(`未找到 Git 仓库：${repoId}`);
    }
    if (!fallbackSettings.hiddenRepoIds.includes(repoId)) {
      const localContributionCache = { ...fallbackSettings.localContributionCache };
      delete localContributionCache[repoId];
      const startupCache = startupCacheMatchesSettings(fallbackStartupCache)
        ? cloneStartupCache(fallbackStartupCache!)
        : null;
      if (startupCache) {
        delete startupCache.reposById[repoId];
        fallbackStartupCache = startupCache;
      }
      fallbackSettings = {
        ...fallbackSettings,
        hiddenRepoIds: [...fallbackSettings.hiddenRepoIds, repoId].sort(),
        localContributionCache,
      };
    }
    return visibleFallbackSettings();
  });
}

function normalizeRepoGroupNameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function nextRepoGroupId(): string {
  let seed = Date.now();
  while (fallbackSettings.repoGroups.some((group) => group.id === `repo-group-${seed}`)) {
    seed += 1;
  }
  return `repo-group-${seed}`;
}

export function createRepoGroup(name: string): Promise<WorkspaceSettings> {
  return call("workspace_create_repo_group", { name }, () => {
    const normalized = name.trim();
    if (!normalized) throw new Error("分组名称不能为空");
    const nameKey = normalizeRepoGroupNameKey(normalized);
    if (fallbackSettings.repoGroups.some((group) => normalizeRepoGroupNameKey(group.name) === nameKey)) {
      throw new Error("已存在同名仓库分组");
    }
    fallbackSettings = {
      ...fallbackSettings,
      repoGroups: [
        ...fallbackSettings.repoGroups,
        {
          id: nextRepoGroupId(),
          name: normalized,
          repoIds: [],
        },
      ],
    };
    return visibleFallbackSettings();
  });
}

export function renameRepoGroup(groupId: string, name: string): Promise<WorkspaceSettings> {
  return call("workspace_rename_repo_group", { groupId, name }, () => {
    const normalizedGroupId = groupId.trim();
    const normalizedName = name.trim();
    if (!normalizedGroupId) throw new Error("分组 ID 不能为空");
    if (!normalizedName) throw new Error("分组名称不能为空");
    const targetGroup = fallbackSettings.repoGroups.find((group) => group.id === normalizedGroupId);
    if (!targetGroup) throw new Error("未找到仓库分组");
    const nameKey = normalizeRepoGroupNameKey(normalizedName);
    if (
      fallbackSettings.repoGroups.some((group) =>
        group.id !== normalizedGroupId && normalizeRepoGroupNameKey(group.name) === nameKey
      )
    ) {
      throw new Error("已存在同名仓库分组");
    }
    fallbackSettings = {
      ...fallbackSettings,
      repoGroups: fallbackSettings.repoGroups.map((group) =>
        group.id === normalizedGroupId ? { ...group, name: normalizedName } : group
      ),
    };
    return visibleFallbackSettings();
  });
}

export function deleteRepoGroup(groupId: string): Promise<WorkspaceSettings> {
  return call("workspace_delete_repo_group", { groupId }, () => {
    const normalized = groupId.trim();
    if (!normalized) throw new Error("分组 ID 不能为空");
    const nextGroups = fallbackSettings.repoGroups.filter((group) => group.id !== normalized);
    if (nextGroups.length === fallbackSettings.repoGroups.length) {
      throw new Error("未找到仓库分组");
    }
    fallbackSettings = {
      ...fallbackSettings,
      repoGroups: nextGroups,
    };
    return visibleFallbackSettings();
  });
}

export function moveRepoToGroup(repoId: string, groupId: string | null): Promise<WorkspaceSettings> {
  return call("workspace_move_repo_to_group", { repoId, groupId }, () => {
    const normalizedRepoId = repoId.trim();
    if (!normalizedRepoId) throw new Error("仓库 ID 不能为空");
    if (!allFallbackRepos().some((repo) => repo.id === normalizedRepoId)) {
      throw new Error(`未找到 Git 仓库：${normalizedRepoId}`);
    }
    const normalizedGroupId = groupId?.trim() || null;
    if (normalizedGroupId && !fallbackSettings.repoGroups.some((group) => group.id === normalizedGroupId)) {
      throw new Error("未找到仓库分组");
    }
    fallbackSettings = {
      ...fallbackSettings,
      repoGroups: fallbackSettings.repoGroups.map((group) => ({
        ...group,
        repoIds: [
          ...group.repoIds.filter((id) => id !== normalizedRepoId),
          ...(group.id === normalizedGroupId ? [normalizedRepoId] : []),
        ].sort(),
      })),
    };
    return visibleFallbackSettings();
  });
}

export function deleteLocalRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_delete_local_repo", { repoId }, () => {
    if (!allFallbackRepos().some((repo) => repo.id === repoId)) {
      throw new Error(`未找到 Git 仓库：${repoId}`);
    }
    const localContributionCache = { ...fallbackSettings.localContributionCache };
    delete localContributionCache[repoId];
    const projectLaunchConfigs = { ...fallbackSettings.projectLaunchConfigs };
    delete projectLaunchConfigs[repoId];
    const repoSyncPreferences = { ...fallbackSettings.repoSyncPreferences };
    delete repoSyncPreferences[repoId];
    const repoBindings = { ...fallbackSettings.repoBindings };
    delete repoBindings[repoId];
    fallbackSettings = {
      ...fallbackSettings,
      projectLaunchConfigs,
      repoSyncPreferences,
      repoBindings,
      managedRepoIds: fallbackSettings.managedRepoIds.filter((id) => id !== repoId),
      hiddenRepoIds: fallbackSettings.hiddenRepoIds.filter((id) => id !== repoId),
      systemGitRepoIds: fallbackSettings.systemGitRepoIds.filter((id) => id !== repoId),
      repoGroups: fallbackSettings.repoGroups.map((group) => ({
        ...group,
        repoIds: group.repoIds.filter((id) => id !== repoId),
      })),
      localContributionCache,
    };
    fallbackRepos = fallbackRepos.filter((item) => item.id !== repoId);
    delete fallbackRepoOverrides[repoId];
    delete fallbackLaunchStatuses[repoId];
    delete fallbackLaunchLogs[repoId];
    if (startupCacheMatchesSettings(fallbackStartupCache)) {
      const cache = cloneStartupCache(fallbackStartupCache!);
      delete cache.reposById[repoId];
      fallbackStartupCache = cache;
    }
    return visibleFallbackSettings();
  });
}

function normalizeRemoteRepoShortcut(repo: RemoteRepoShortcut): RemoteRepoShortcut {
  const fullName = repo.fullName.trim().replace(/^\/+|\/+$/g, "");
  const parts = fullName.split("/").filter(Boolean);
  const name = repo.name.trim() || parts[parts.length - 1] || fullName;
  return {
    accountLogin: currentFallbackGitHubAccountLogin(),
    repositoryId: repo.repositoryId ?? null,
    fullName,
    name,
    private: repo.private,
    archived: repo.archived,
    defaultBranch: repo.defaultBranch?.trim() || null,
    htmlUrl: repo.htmlUrl.trim() || `https://github.com/${fullName}`,
    cloneUrl: repo.cloneUrl.trim() || `https://github.com/${fullName}.git`,
    canonicalRemoteUrl: `https://github.com/${fullName}.git`,
    openedAt: Date.now(),
  };
}

export function rememberRemoteRepo(repo: RemoteRepoShortcut): Promise<WorkspaceSettings> {
  return call("workspace_remember_remote_repo", { repo }, () => {
    migrateFallbackRemoteRepoShortcuts();
    const accountLogin = currentFallbackGitHubAccountLogin();
    if (!accountLogin) throw new Error("请先绑定 GitHub 账号");
    const shortcut = normalizeRemoteRepoShortcut(repo);
    const shortcutKey = normalizeRemoteRepoIdKey(shortcut.fullName);
    fallbackSettings = {
      ...fallbackSettings,
      remoteRepoShortcuts: [
        shortcut,
        ...fallbackSettings.remoteRepoShortcuts.filter((item) => {
          const key = normalizeRemoteRepoIdKey(item.fullName);
          const sameAccount = item.accountLogin?.toLowerCase() === accountLogin.toLowerCase();
          return !sameAccount || key === null || key !== shortcutKey;
        }),
      ].sort((a, b) => b.openedAt - a.openedAt || a.fullName.localeCompare(b.fullName)),
    };
    return visibleFallbackSettings();
  });
}

export function forgetRemoteRepo(fullName: string): Promise<WorkspaceSettings> {
  return call("workspace_forget_remote_repo", { fullName }, () => {
    migrateFallbackRemoteRepoShortcuts();
    const accountLogin = currentFallbackGitHubAccountLogin();
    if (!accountLogin) throw new Error("请先绑定 GitHub 账号");
    const target = normalizeRemoteRepoIdKey(fullName);
    if (!target) return visibleFallbackSettings();
    fallbackSettings = {
      ...fallbackSettings,
      remoteRepoShortcuts: fallbackSettings.remoteRepoShortcuts.filter((repo) => {
        const key = normalizeRemoteRepoIdKey(repo.fullName);
        const sameAccount = repo.accountLogin?.toLowerCase() === accountLogin.toLowerCase();
        return !sameAccount || key === null || key !== target;
      }),
    };
    return visibleFallbackSettings();
  });
}

export function unhideRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_unhide_repo", { repoId }, () => {
    fallbackSettings = {
      ...fallbackSettings,
      hiddenRepoIds: fallbackSettings.hiddenRepoIds.filter((id) => id !== repoId),
    };
    return visibleFallbackSettings();
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

export function listWorkspaceTasks(): Promise<WorkspaceTask[]> {
  return call("workspace_list_tasks", undefined, () => fallbackTasks.map((task) => ({ ...task })));
}

export function cancelWorkspaceTask(taskId: string): Promise<void> {
  return call("workspace_cancel_task", { taskId }, () => {
    if (!cancelPendingFallbackTask(taskId, "已取消", "任务已取消")) {
      throw new Error("任务当前不可取消");
    }
  });
}

function cancelPendingFallbackTask(taskId: string, message: string, rejectionMessage = message) {
  const task = fallbackTasks.find((item) => item.id === taskId);
  if (!task || task.status !== "pending" || !task.cancellable) return false;

  const refresh = Array.from(fallbackRepoRefreshEntries.values())
    .find((entry) => entry.taskId === taskId);
  if (refresh) fallbackRepoRefreshEntries.delete(fallbackRefreshKey(refresh.request));

  const operation = fallbackOperationEntries.get(taskId);
  if (operation) {
    if (operation.state !== "pending") return false;
    fallbackOperationEntries.delete(taskId);
    operation.reject(new Error(rejectionMessage));
  }
  updateFallbackTask(taskId, "cancelled", message, false);
  return true;
}

export function setActiveWorkspaceRepo(repoId: string | null): Promise<void> {
  return call("workspace_set_active_repo", { repoId }, () => {
    fallbackActiveRepoId = repoId;
    for (const entry of fallbackRepoRefreshEntries.values()) {
      if (entry.request.mode !== "remote" || entry.state !== "pending") continue;
      if (entry.request.repoId === repoId || entry.request.trigger === "autoSync") continue;
      cancelPendingFallbackTask(entry.taskId, "已取消");
    }
    scheduleFallbackRefreshPump();
  });
}

export function setWorkspaceRefreshPaused(paused: boolean): Promise<void> {
  return call("workspace_set_refresh_paused", { paused }, () => {
    fallbackRefreshPaused = paused;
    if (!paused) scheduleFallbackRefreshPump();
  });
}

export function enqueueRepoRefresh(request: WorkspaceRepoRefreshRequest): Promise<string> {
  return call("workspace_enqueue_repo_refresh", { request }, () => {
    const key = fallbackRefreshKey(request);
    const existing = fallbackRepoRefreshEntries.get(key);
    if (existing) {
      if (existing.state === "running") {
        existing.rerun = mergeFallbackRefreshRequest(existing.rerun ?? request, request);
      } else {
        existing.request = mergeFallbackRefreshRequest(existing.request, request);
        updateFallbackPendingTask(existing);
      }
      return existing.taskId;
    }
    const task = recordFallbackTask(
      request.mode === "remote" ? "repoRemote" : "repoStatus",
      request.priority,
      request.repoId,
      "pending",
      null,
      true,
      request.mode === "remote" ? "检查远端更新" : "刷新仓库状态",
    );
    emitFallbackWorkspaceEvent("workspace://task-changed", task);
    fallbackRepoRefreshEntries.set(key, {
      taskId: task.id,
      request: { ...request },
      state: "pending",
      rerun: null,
      sequence: fallbackRefreshSequence++,
      generation: fallbackRefreshGeneration,
    });
    scheduleFallbackRefreshPump();
    return task.id;
  });
}

function fallbackRefreshKey(request: WorkspaceRepoRefreshRequest) {
  return `${request.mode}:${request.repoId}`;
}

function mergeFallbackRefreshRequest(
  current: WorkspaceRepoRefreshRequest,
  incoming: WorkspaceRepoRefreshRequest,
): WorkspaceRepoRefreshRequest {
  const priority = { low: 0, normal: 1, high: 2 } as const;
  const detailScopeRank = { summary: 0, auto: 1, detail: 2 } as const;
  const detailScope = detailScopeRank[incoming.detailScope ?? "summary"] > detailScopeRank[current.detailScope ?? "summary"]
    ? incoming.detailScope
    : current.detailScope;
  return {
    ...current,
    priority: priority[incoming.priority] > priority[current.priority] ? incoming.priority : current.priority,
    force: current.force || incoming.force,
    detailScope,
    includeCommits: Boolean(current.includeCommits || incoming.includeCommits),
    includeBranches: Boolean(current.includeBranches || incoming.includeBranches),
    trigger: incoming.force || incoming.trigger === "manual" ? incoming.trigger : current.trigger,
  };
}

function updateFallbackPendingTask(entry: FallbackRefreshEntry) {
  const task = fallbackTasks.find((candidate) => candidate.id === entry.taskId);
  if (!task || task.priority === entry.request.priority) return;
  Object.assign(task, { priority: entry.request.priority, updatedAt: Date.now() });
  fallbackTasks = normalizeWorkspaceTasks(fallbackTasks);
  emitFallbackWorkspaceEvent("workspace://task-changed", { ...task });
}

function scheduleFallbackRefreshPump() {
  if (fallbackRefreshPumpScheduled) return;
  fallbackRefreshPumpScheduled = true;
  setTimeout(() => {
    fallbackRefreshPumpScheduled = false;
    pumpFallbackRefreshes();
  }, 0);
}

function pumpFallbackRefreshes() {
  while (!fallbackRefreshPaused && fallbackLocalRefreshesRunning < 4) {
    const entry = nextFallbackRefresh("local");
    if (!entry) break;
    startFallbackRepoRefresh(entry);
  }
  while (fallbackRemoteRefreshesRunning < 1) {
    const entry = nextFallbackRefresh("remote");
    if (!entry) break;
    startFallbackRepoRefresh(entry);
  }
}

function nextFallbackRefresh(mode: WorkspaceRepoRefreshRequest["mode"]) {
  const priority = { low: 0, normal: 1, high: 2 } as const;
  return Array.from(fallbackRepoRefreshEntries.values())
    .filter((entry) =>
      entry.state === "pending" &&
      entry.request.mode === mode &&
      fallbackResourcesCanAcquire(fallbackRefreshResources(entry.request))
    )
    .sort((left, right) =>
      priority[right.request.priority] - priority[left.request.priority] || left.sequence - right.sequence
    )[0];
}

function fallbackRefreshResources(request: WorkspaceRepoRefreshRequest) {
  return fallbackRepoResources([request.repoId], request.mode === "remote" ? "write" : "read");
}

function startFallbackRepoRefresh(entry: FallbackRefreshEntry) {
  entry.state = "running";
  if (entry.request.mode === "local") fallbackLocalRefreshesRunning += 1;
  else fallbackRemoteRefreshesRunning += 1;
  acquireFallbackResources(fallbackRefreshResources(entry.request));
  void runFallbackRepoRefresh(entry);
}

async function runFallbackRepoRefresh(entry: FallbackRefreshEntry) {
  const generation = entry.generation;
  const request = entry.request;
  let outcome!: { status: "success" | "error" | "cancelled"; message: string };
  if (request.mode === "remote" && request.trigger !== "autoSync" && fallbackActiveRepoId !== request.repoId) {
    outcome = { status: "cancelled", message: "已取消" };
  } else {
    updateFallbackTask(entry.taskId, "running", null, false);
    try {
      let remoteIsFresh = false;
      if (request.mode === "remote" && !request.force) {
        const now = Date.now();
        const cached = currentStartupCache().reposById[request.repoId];
        const remoteCheckedAt = cached?.remoteCheckedAt ?? null;
        const retryAt = fallbackRemoteRetryAt.get(request.repoId) ?? 0;
        remoteIsFresh = (remoteCheckedAt != null && now - remoteCheckedAt < 10 * 60_000) || retryAt > now;
        if (remoteIsFresh) {
          outcome = { status: "success", message: "远端状态仍然有效" };
        }
      }
      if (!remoteIsFresh) {
        const summary = request.mode === "remote"
          ? refreshFallbackRemoteRepo(request.repoId)
          : cloneRepoSummary(fallbackRepo(request.repoId));
        const remoteCheckedAt = request.mode === "remote" ? Date.now() : undefined;
        const detailPatch = request.detailScope === "detail"
          ? await refreshRepoDetailPatch(request.repoId, {
              includeCommits: request.includeCommits,
              includeBranches: request.includeBranches,
            })
          : null;
        if (generation !== fallbackRefreshGeneration) return;
        if (request.mode === "remote") {
          fallbackRemoteFailureCounts.delete(request.repoId);
          fallbackRemoteRetryAt.delete(request.repoId);
        }
        writeFallbackStartupRepoSummary(summary, remoteCheckedAt);
        const event: WorkspaceRepoRefreshedEvent = {
          repoId: request.repoId,
          mode: request.mode,
          summary,
          detailPatch,
          remoteCheckedAt,
        };
        emitFallbackWorkspaceEvent("workspace://repo-refreshed", event);
        outcome = { status: "success", message: "仓库状态已更新" };
      }
    } catch (err) {
      if (generation !== fallbackRefreshGeneration) return;
      if (request.mode === "remote") {
        const failures = Math.min((fallbackRemoteFailureCounts.get(request.repoId) ?? 0) + 1, 3);
        const delays = [60_000, 5 * 60_000, 15 * 60_000];
        fallbackRemoteFailureCounts.set(request.repoId, failures);
        fallbackRemoteRetryAt.set(request.repoId, Date.now() + delays[failures - 1]);
      }
      outcome = { status: "error", message: String(err) };
    }
  }
  if (generation !== fallbackRefreshGeneration) return;
  if (request.mode === "local") fallbackLocalRefreshesRunning -= 1;
  else fallbackRemoteRefreshesRunning -= 1;
  releaseFallbackResources(fallbackRefreshResources(request));
  if (fallbackRepoRefreshEntries.get(fallbackRefreshKey(request)) !== entry) {
    pumpFallbackOperations();
    scheduleFallbackRefreshPump();
    return;
  }
  if (entry.rerun) {
    entry.request = entry.rerun;
    entry.rerun = null;
    entry.state = "pending";
    entry.sequence = fallbackRefreshSequence++;
  } else {
    fallbackRepoRefreshEntries.delete(fallbackRefreshKey(request));
    updateFallbackTask(entry.taskId, outcome.status, outcome.message, false);
  }
  pumpFallbackOperations();
  scheduleFallbackRefreshPump();
}

function refreshFallbackRemoteRepo(repoId: string) {
  const repo = fallbackRepo(repoId);
  if (!repo.remoteUrl) throw new Error("没有可抓取的远端");
  const error = repo.remoteUrl ? fallbackRepoRemoteSyncOverride?.(repo) : null;
  if (error) throw new Error(error);
  return cloneRepoSummary(repo);
}

function updateFallbackTask(
  taskId: string,
  status: WorkspaceTask["status"],
  message: string | null,
  cancellable: boolean,
) {
  let updated: WorkspaceTask | null = null;
  fallbackTasks = fallbackTasks.map((task) => {
    if (task.id !== taskId) return task;
    updated = { ...task, status, message, cancellable, updatedAt: Date.now() };
    return updated;
  });
  fallbackTasks = normalizeWorkspaceTasks(fallbackTasks);
  if (updated) emitFallbackWorkspaceEvent("workspace://task-changed", updated);
}

function emitFallbackWorkspaceEvent(name: string, payload: unknown) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail: payload }));
}

export function getGitHubBindingStatus(): Promise<GitHubBindingStatus> {
  return call("github_get_binding_status", undefined, () => ({
    ...fallbackBinding,
    binding: fallbackBinding.binding
      ? { ...fallbackBinding.binding, scopes: [...fallbackBinding.binding.scopes] }
      : null,
  }));
}

export function startGitHubDeviceFlow(purpose: GitHubAuthPurpose = "binding"): Promise<GitHubDeviceFlowStart> {
  return call("github_start_device_flow", { purpose }, () => {
    fallbackPendingAuthPurpose = purpose;
    return {
      deviceCode: `device-code-${purpose}`,
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      expiresAt: Date.now() + 600_000,
      intervalSeconds: 5,
    };
  });
}

export function pollGitHubDeviceFlow(
  deviceCode: string,
  intervalSeconds?: number | null,
): Promise<GitHubDeviceFlowPollResult> {
  return call("github_poll_device_flow", { deviceCode, intervalSeconds: intervalSeconds ?? null }, () => {
    const currentBinding = fallbackBinding.state === "bound" && fallbackBinding.binding
      ? fallbackBinding.binding
      : defaultFallbackBinding.binding!;
    const scopes = new Set(currentBinding.scopes);
    if (fallbackPendingAuthPurpose === "profileWrite") scopes.add("user");
    switchFallbackAccount({
      state: "bound",
      clientIdConfigured: true,
      clientIdSource: fallbackBinding.clientIdSource,
      binding: { ...currentBinding, scopes: [...scopes] },
    });
    fallbackPendingAuthPurpose = "binding";
    return {
      status: "authorized",
      intervalSeconds: intervalSeconds ?? 5,
      bindingStatus: {
        ...fallbackBinding,
        binding: fallbackBinding.binding
          ? { ...fallbackBinding.binding, scopes: [...fallbackBinding.binding.scopes] }
          : null,
      },
      error: null,
    };
  });
}

export function unbindGitHub(): Promise<void> {
  return call("github_unbind", undefined, () => {
    switchFallbackAccount({
      state: "unbound",
      clientIdConfigured: true,
      clientIdSource: defaultFallbackBinding.clientIdSource,
      binding: null,
    });
  });
}

function fallbackGitHubAccountProfile(): GitHubAccountProfile {
  const binding = fallbackBinding.binding;
  if (fallbackBinding.state !== "bound" || !binding) throw new Error("GitHub 账号未绑定");
  const key = fallbackAccountKey(binding.login);
  const existing = fallbackAccountProfiles.get(key);
  if (existing) return { ...existing };
  const profile: GitHubAccountProfile = {
    login: binding.login,
    avatarUrl: binding.avatarUrl,
    name: null,
    email: null,
    bio: null,
    company: null,
    location: null,
    blog: null,
    twitterUsername: null,
    hireable: null,
  };
  fallbackAccountProfiles.set(key, profile);
  return { ...profile };
}

export function getGitHubAccountProfile(): Promise<GitHubAccountProfile> {
  return call("github_get_account_profile", undefined, fallbackGitHubAccountProfile);
}

function normalizedProfileValue(value: string | null): string | null {
  return value?.trim() || null;
}

export function updateGitHubAccountProfile(
  request: GitHubUpdateAccountProfileRequest,
): Promise<GitHubAccountProfile> {
  return call("github_update_account_profile", { request }, () => {
    const binding = fallbackBinding.binding;
    if (fallbackBinding.state !== "bound" || !binding) throw new Error("GitHub 账号未绑定");
    if (!binding.scopes.some((scope) => scope.trim().toLocaleLowerCase() === "user")) {
      throw new Error("GitHub 资料编辑权限不足");
    }
    const current = fallbackGitHubAccountProfile();
    const profile: GitHubAccountProfile = {
      ...current,
      name: normalizedProfileValue(request.name),
      email: normalizedProfileValue(request.email),
      bio: normalizedProfileValue(request.bio),
      company: normalizedProfileValue(request.company),
      location: normalizedProfileValue(request.location),
      blog: normalizedProfileValue(request.blog),
      twitterUsername: normalizedProfileValue(request.twitterUsername),
      hireable: request.hireable,
    };
    fallbackAccountProfiles.set(fallbackAccountKey(binding.login), profile);
    return { ...profile };
  });
}

export function listGitHubRepos(page?: number | null): Promise<GitHubRepoPage>;
export function listGitHubRepos(scope: GitHubRepositoryScope, page?: number | null): Promise<GitHubRepoPage>;
export function listGitHubRepos(
  scopeOrPage: GitHubRepositoryScope | number | null = { kind: "all" },
  requestedPage?: number | null,
): Promise<GitHubRepoPage> {
  const scope = typeof scopeOrPage === "object" && scopeOrPage !== null
    ? scopeOrPage
    : { kind: "all" } satisfies GitHubRepositoryScope;
  const page = typeof scopeOrPage === "number" ? scopeOrPage : requestedPage ?? 1;
  return call("github_list_repos", { scope, page }, () => {
    if (fallbackGitHubReposError) throw new Error(fallbackGitHubReposError);
    if (scope.kind === "all" && fallbackGitHubRepoPagesOverride) {
      const pageIndex = Math.max(0, page - 1);
      const fallbackPage = fallbackGitHubRepoPagesOverride[pageIndex] ?? { items: [], nextPage: null };
      return {
        items: fallbackPage.items.map(cloneGitHubRepoSummary),
        nextPage: fallbackPage.nextPage,
        scope,
      };
    }
    const login = scope.kind === "all" ? null : scope.login.trim().toLocaleLowerCase();
    const matching = allFallbackGitHubRepos().filter((repo) =>
      login === null || (repo.owner?.login ?? repo.ownerLogin).toLocaleLowerCase() === login
    );
    const start = Math.max(0, page - 1) * 100;
    const items = matching.slice(start, start + 100);
    return {
      items: items.map(cloneGitHubRepoSummary),
      nextPage: start + items.length < matching.length ? page + 1 : null,
      scope,
    };
  });
}

function fallbackRepoManagement(repoFullName: string): GitHubRepoManagement {
  const existing = fallbackGitHubRepoManagement[repoFullName];
  if (existing) return cloneGitHubRepoManagement(existing);
  const repo = allFallbackGitHubRepos().find((item) => item.fullName === repoFullName);
  if (!repo) throw new Error(`未找到 GitHub 仓库：${repoFullName}`);
  const management: GitHubRepoManagement = {
    fullName: repo.fullName,
    name: repo.name,
    description: repo.description,
    homepage: "",
    topics: [],
    private: repo.private,
    defaultBranch: repo.defaultBranch ?? "main",
    hasIssues: true,
    hasWiki: false,
    hasProjects: true,
    hasDiscussions: false,
    allowMergeCommit: true,
    allowSquashMerge: true,
    allowRebaseMerge: true,
    allowAutoMerge: false,
    deleteBranchOnMerge: true,
    allowForking: !repo.private,
    webCommitSignoffRequired: false,
    stargazersCount: 0,
    watchersCount: 0,
    forksCount: 0,
    htmlUrl: repo.htmlUrl,
    license: null,
  };
  fallbackGitHubRepoManagement[repoFullName] = management;
  return cloneGitHubRepoManagement(management);
}

function allFallbackGitHubRepos() {
  const fromPages = fallbackGitHubRepoPagesOverride?.flatMap((page) => page.items) ?? [];
  const repos = new Map<string, GitHubRepoSummary>();
  for (const repo of [...fallbackGitHubRepos, ...fromPages]) {
    repos.set(repo.fullName, repo);
  }
  return [...repos.values()].map(cloneGitHubRepoSummary);
}

function moveFallbackGitHubRepoBucket(bucket: Record<string, unknown>, fromFullName: string, toFullName: string) {
  if (fromFullName === toFullName || !(fromFullName in bucket)) return;
  bucket[toFullName] = bucket[fromFullName];
  delete bucket[fromFullName];
}

function updateFallbackGitHubRepoSummary(repoFullName: string, update: Partial<GitHubRepoSummary>) {
  const apply = (repo: GitHubRepoSummary) =>
    repo.fullName === repoFullName ? { ...repo, ...update } : repo;
  fallbackGitHubRepos = fallbackGitHubRepos.map(apply);
  fallbackGitHubRepoPagesOverride = fallbackGitHubRepoPagesOverride?.map((page) => ({
    ...page,
    items: page.items.map(apply),
  })) ?? null;
}

function renameFallbackGitHubRepoReferences(fromFullName: string, toFullName: string, toName: string) {
  if (fromFullName === toFullName) return;
  fallbackGitHubRepos = fallbackGitHubRepos.map((repo) =>
    repo.fullName === fromFullName ? renamedGitHubRepoSummary(repo, toFullName, toName) : repo
  );
  fallbackGitHubRepoPagesOverride = fallbackGitHubRepoPagesOverride?.map((page) => ({
    ...page,
    items: page.items.map((repo) =>
      repo.fullName === fromFullName ? renamedGitHubRepoSummary(repo, toFullName, toName) : repo
    ),
  })) ?? null;
  const buckets: Array<Record<string, unknown>> = [
    fallbackGitHubIssues,
    fallbackGitHubPullRequests,
    fallbackGitHubIssueDiscussions,
    fallbackGitHubPullRequestDiscussions,
    fallbackGitHubPullRequestChecks,
    fallbackGitHubReleases,
    fallbackGitHubWorkflowRuns,
    fallbackGitHubWorkflowRunDetails,
    fallbackGitHubWorkflowJobLogs,
    fallbackGitHubWorkflowArtifactEntries,
    fallbackGitHubWorkflowArtifactPreviews,
    fallbackGitHubCommits,
    fallbackGitHubCommitDetails,
    fallbackGitHubBranches,
    fallbackGitHubBranchProtections,
    fallbackGitHubRulesets,
    fallbackGitHubRepoFiles,
    fallbackGitHubRepoFilePreviews,
    fallbackGitHubRepoSettingsSections,
  ];
  buckets.forEach((bucket) => moveFallbackGitHubRepoBucket(bucket, fromFullName, toFullName));
}

export function listGitHubRepoOwners(): Promise<GitHubRepoOwner[]> {
  return call("github_list_repo_owners", undefined, () => fallbackGitHubRepoOwners.map((owner) => ({ ...owner })));
}

export function listGitHubRepoTemplates(): Promise<GitHubRepoTemplate[]> {
  return call("github_list_repo_templates", undefined, () => fallbackGitHubRepoTemplates.map((template) => ({ ...template })));
}

export function createGitHubRepo(request: GitHubCreateRepoRequest): Promise<GitHubRepoSummary> {
  return call("github_create_repo", { request }, () => {
    const owner = request.owner.trim();
    const name = request.name.trim();
    if (!owner || !name) throw new Error("owner 和仓库名不能为空");
    const templateFullName = request.templateFullName?.trim() || null;
    if (templateFullName && templateFullName.split("/").filter(Boolean).length !== 2) {
      throw new Error("模板仓库请输入 owner/repo");
    }
    const fullName = `${owner}/${name}`;
    const now = new Date().toISOString();
    const repo: GitHubRepoSummary = {
      id: 1000 + fallbackGitHubRepos.length,
      name,
      fullName,
      ownerLogin: owner,
      private: request.private,
      disabled: false,
      archived: false,
      description: request.description?.trim() || null,
      defaultBranch: request.autoInit || templateFullName ? "main" : null,
      createdAt: now,
      updatedAt: now,
      cloneUrl: `https://github.com/${fullName}.git`,
      htmlUrl: `https://github.com/${fullName}`,
      owner: {
        login: owner,
        kind: request.ownerKind === "organization" || request.ownerKind === "org"
          ? "organization"
          : "user",
        avatarUrl: null,
      },
      permissions: { pull: true, push: true, admin: true },
    };
    fallbackGitHubRepos.push(repo);
    fallbackGitHubRepoManagement[fullName] = {
      fullName,
      name,
      description: repo.description,
      homepage: "",
      topics: [],
      private: repo.private,
      defaultBranch: repo.defaultBranch ?? "main",
      hasIssues: request.hasIssues,
      hasWiki: request.hasWiki,
      hasProjects: true,
      hasDiscussions: false,
      allowMergeCommit: true,
      allowSquashMerge: true,
      allowRebaseMerge: true,
      allowAutoMerge: false,
      deleteBranchOnMerge: true,
      allowForking: !repo.private,
      webCommitSignoffRequired: false,
      stargazersCount: 0,
      watchersCount: 0,
      forksCount: 0,
      htmlUrl: repo.htmlUrl,
      license: null,
    };
    fallbackGitHubIssues[fullName] = [];
    fallbackGitHubPullRequests[fullName] = [];
    fallbackGitHubPullRequestChecks[fullName] = {};
    fallbackGitHubBranches[fullName] = repo.defaultBranch
      ? [buildBranchSummary({ name: repo.defaultBranch, remote: true })]
      : [];
    return { ...repo };
  });
}

export function getGitHubRepoManagement(repoFullName: string): Promise<GitHubRepoManagement> {
  return call("github_get_repo_management", { repoFullName }, () => fallbackRepoManagement(repoFullName));
}

export function updateGitHubRepoSettings(
  repoFullName: string,
  request: GitHubUpdateRepoSettingsRequest,
): Promise<GitHubRepoManagement> {
  return call("github_update_repo_settings", { repoFullName, request }, () => {
    const current = fallbackRepoManagement(repoFullName);
    const owner = current.fullName.split("/")[0] || repoFullName.split("/")[0] || "sena-nana";
    const nextName = request.name?.trim() || current.name;
    const nextFullName = `${owner}/${nextName}`;
    const updated = {
      ...current,
      ...request,
      fullName: nextFullName,
      name: nextName,
      description: request.description ?? current.description,
      homepage: request.homepage ?? current.homepage,
      topics: request.topics ? [...request.topics] : [...current.topics],
      htmlUrl: nextFullName === current.fullName ? current.htmlUrl : `https://github.com/${nextFullName}`,
    };
    if (nextFullName !== repoFullName) {
      delete fallbackGitHubRepoManagement[repoFullName];
      renameFallbackGitHubRepoReferences(repoFullName, nextFullName, nextName);
    }
    fallbackGitHubRepoManagement[nextFullName] = updated;
    updateFallbackGitHubRepoSummary(nextFullName, {
      name: nextName,
      fullName: nextFullName,
      ownerLogin: owner,
      private: updated.private,
      archived: updated.archived ?? false,
      description: updated.description,
      defaultBranch: updated.defaultBranch,
      cloneUrl: `https://github.com/${nextFullName}.git`,
      htmlUrl: updated.htmlUrl,
    });
    if ("securityAndAnalysis" in request || "archived" in request) {
      clearFallbackGitHubRepoSettingsSection(nextFullName, "security");
    }
    if ("defaultBranch" in request) {
      clearFallbackGitHubRepoSettingsSection(nextFullName, "branches");
    }
    return cloneGitHubRepoManagement(updated);
  });
}

function createFallbackSettingsSection(
  repoFullName: string,
  section: GitHubRepoSettingsSectionKey,
): GitHubRepoSettingsSection {
  const repo = fallbackRepoManagement(repoFullName);
  const baseItem = (
    key: string,
    label: string,
    path: string,
    value: unknown,
    mutable = true,
    dangerous = false,
  ) => ({
    key,
    label,
    method: "GET",
    path,
    value,
    error: null,
    mutable,
    dangerous,
  });
  const sections: Record<GitHubRepoSettingsSectionKey, GitHubRepoSettingsSection> = {
    collaborators: {
      key: "collaborators",
      title: "协作者",
      fetchedAt: Date.now(),
      items: [
        baseItem("collaborators", "协作者", "collaborators?per_page=100", [], true, true),
        baseItem("teams", "仓库团队", "teams?per_page=100", [], false),
      ],
    },
    moderation: {
      key: "moderation",
      title: "互动限制",
      fetchedAt: Date.now(),
      items: [baseItem("interactionLimits", "互动限制", "interaction-limits", null)],
    },
    security: {
      key: "security",
      title: "高级安全",
      fetchedAt: Date.now(),
      items: [
        baseItem("repository", "仓库安全与分析", "", {
          security_and_analysis: repo.securityAndAnalysis ?? {},
        }),
        baseItem("vulnerabilityAlerts", "漏洞警报", "vulnerability-alerts", { status: "enabled" }),
        baseItem("dependabotSecurityUpdates", "Dependabot 安全更新", "automated-security-fixes", { status: "enabled" }),
        baseItem("privateVulnerabilityReporting", "私有漏洞报告", "private-vulnerability-reporting", null),
        baseItem("immutableReleases", "不可变 Release", "immutable-releases", null),
      ],
    },
    branches: {
      key: "branches",
      title: "分支",
      fetchedAt: Date.now(),
      items: [
        baseItem(
          "branches",
          "分支",
          "branches?per_page=100",
          (
            fallbackGitHubBranches[repoFullName] ??
            [buildBranchSummary({ name: repo.defaultBranch, protected: true })]
          ).map((branch) => ({ name: branch.name, protected: branch.protected })),
          false,
        ),
      ],
    },
    tags: {
      key: "tags",
      title: "标签",
      fetchedAt: Date.now(),
      items: [baseItem("tags", "标签", "tags?per_page=100", [], false)],
    },
    rules: {
      key: "rules",
      title: "规则",
      fetchedAt: Date.now(),
      items: [baseItem("rulesets", "仓库规则集", "rulesets", [], true, true)],
    },
    actions: {
      key: "actions",
      title: "Actions",
      fetchedAt: Date.now(),
      items: [
        baseItem("permissions", "Actions permissions", "actions/permissions", { enabled: true, allowed_actions: "all" }),
        baseItem("workflowPermissions", "工作流默认权限", "actions/permissions/workflow", {
          default_workflow_permissions: "read",
          can_approve_pull_request_reviews: false,
        }),
        baseItem("workflows", "工作流", "actions/workflows?per_page=100", { total_count: 0, workflows: [] }),
      ],
    },
    copilot: {
      key: "copilot",
      title: "Copilot",
      fetchedAt: Date.now(),
      items: [{
        key: "copilot",
        label: "Copilot repository settings",
        method: "GET",
        path: "unavailable:GitHub REST API does not expose a general repository-owned Copilot settings endpoint for this app.",
        value: null,
        error: "GitHub REST API does not expose a general repository-owned Copilot settings endpoint for this app.",
        mutable: false,
        dangerous: false,
      }],
    },
    environments: {
      key: "environments",
      title: "环境",
      fetchedAt: Date.now(),
      items: [baseItem("environments", "环境", "environments", { total_count: 0, environments: [] }, true, true)],
    },
    codespaces: {
      key: "codespaces",
      title: "Codespaces",
      fetchedAt: Date.now(),
      items: [
        baseItem("codespaces", "仓库 Codespaces", "codespaces?per_page=100", { total_count: 0, codespaces: [] }, false),
        baseItem("codespacesSecrets", "Codespaces 仓库密钥", "codespaces/secrets", { total_count: 0, secrets: [] }, true, true),
      ],
    },
    pages: {
      key: "pages",
      title: "Pages",
      fetchedAt: Date.now(),
      items: [
        baseItem("pages", "GitHub Pages 站点", "pages", null),
        baseItem("pagesBuilds", "GitHub Pages 构建", "pages/builds?per_page=20", { builds: [] }),
      ],
    },
    webhooks: {
      key: "webhooks",
      title: "Webhooks",
      fetchedAt: Date.now(),
      items: [baseItem("webhooks", "Webhooks", "hooks", [], true, true)],
    },
    deployKeys: {
      key: "deployKeys",
      title: "部署密钥",
      fetchedAt: Date.now(),
      items: [baseItem("deployKeys", "部署密钥", "keys?per_page=100", [], true, true)],
    },
    secretsVariables: {
      key: "secretsVariables",
      title: "密钥与变量",
      fetchedAt: Date.now(),
      items: [
        baseItem("actionsVariables", "Actions 仓库变量", "actions/variables", { total_count: 0, variables: [] }),
        baseItem("actionsSecrets", "Actions 仓库密钥", "actions/secrets", { total_count: 0, secrets: [] }, true, true),
      ],
    },
    githubApps: {
      key: "githubApps",
      title: "GitHub Apps",
      fetchedAt: Date.now(),
      items: [baseItem("installations", "仓库 GitHub App 安装", "installations", [], false)],
    },
    emailNotifications: {
      key: "emailNotifications",
      title: "邮件通知",
      fetchedAt: Date.now(),
      items: [baseItem("subscription", "仓库通知订阅", "subscription", null)],
    },
  };
  return sections[section];
}

let fallbackGitHubRepoSettingsSections: Record<string, Partial<Record<GitHubRepoSettingsSectionKey, GitHubRepoSettingsSection>>> = {};

function clearFallbackGitHubRepoSettingsSection(
  repoFullName: string,
  section: GitHubRepoSettingsSectionKey,
) {
  delete fallbackGitHubRepoSettingsSections[repoFullName]?.[section];
}

export function getGitHubRepoSettingsSection(
  repoFullName: string,
  section: GitHubRepoSettingsSectionKey,
): Promise<GitHubRepoSettingsSection> {
  return call("github_get_repo_settings_section", { repoFullName, section }, () => {
    const repoSections = (fallbackGitHubRepoSettingsSections[repoFullName] ??= {});
    repoSections[section] ??= createFallbackSettingsSection(repoFullName, section);
    return cloneFallbackData(repoSections[section]);
  });
}

function fallbackRepoSettingsSection(repoFullName: string, section: GitHubRepoSettingsSectionKey) {
  const repoSections = (fallbackGitHubRepoSettingsSections[repoFullName] ??= {});
  repoSections[section] ??= createFallbackSettingsSection(repoFullName, section);
  return repoSections[section];
}

function updateFallbackRepoSettingsItem(
  repoFullName: string,
  section: GitHubRepoSettingsSectionKey,
  itemKey: string,
  value: unknown,
) {
  const settingsSection = fallbackRepoSettingsSection(repoFullName, section);
  const item = settingsSection.items.find((entry) => entry.key === itemKey);
  if (item) {
    item.value = cloneFallbackData(value);
    item.error = null;
  }
  settingsSection.fetchedAt = Date.now();
}

export function updateGitHubRepoActionsPermissions(
  repoFullName: string,
  request: GitHubRepoActionsPermissionsRequest,
): Promise<void> {
  return call("github_update_repo_actions_permissions", { repoFullName, request }, () => {
    fallbackRepoManagement(repoFullName);
    const current = fallbackRepoSettingsSection(repoFullName, "actions")
      .items.find((entry) => entry.key === "permissions")?.value;
    updateFallbackRepoSettingsItem(repoFullName, "actions", "permissions", {
      ...(isPlainObject(current) ? current : {}),
      enabled: request.enabled,
      allowed_actions: request.allowedActions ?? "all",
      ...(request.shaPinningRequired == null ? {} : { sha_pinning_required: request.shaPinningRequired }),
    });
  });
}

export function updateGitHubRepoWorkflowPermissions(
  repoFullName: string,
  request: GitHubRepoWorkflowPermissionsRequest,
): Promise<void> {
  return call("github_update_repo_workflow_permissions", { repoFullName, request }, () => {
    fallbackRepoManagement(repoFullName);
    const current = fallbackRepoSettingsSection(repoFullName, "actions")
      .items.find((entry) => entry.key === "workflowPermissions")?.value;
    updateFallbackRepoSettingsItem(repoFullName, "actions", "workflowPermissions", {
      ...(isPlainObject(current) ? current : {}),
      default_workflow_permissions: request.defaultWorkflowPermissions,
      can_approve_pull_request_reviews: request.canApprovePullRequestReviews ?? false,
    });
  });
}

export function deleteGitHubRepo(repoFullName: string): Promise<void> {
  return call("github_delete_repo", { repoFullName }, () => {
    const normalized = repoFullName.trim().replace(/^\/+|\/+$/g, "");
    const exists = fallbackGitHubRepos.some((repo) => repo.fullName === normalized) ||
      fallbackGitHubRepoPagesOverride?.some((page) => page.items.some((repo) => repo.fullName === normalized)) ||
      Boolean(fallbackGitHubRepoManagement[normalized]);
    if (!exists) throw new Error(`未找到 GitHub 仓库：${normalized}`);
    fallbackGitHubRepos = fallbackGitHubRepos.filter((repo) => repo.fullName !== normalized);
    fallbackGitHubRepoPagesOverride = fallbackGitHubRepoPagesOverride?.map((page) => ({
      ...page,
      items: page.items.filter((repo) => repo.fullName !== normalized),
    })) ?? null;
    delete fallbackGitHubRepoManagement[normalized];
    delete fallbackGitHubIssues[normalized];
    delete fallbackGitHubPullRequests[normalized];
    delete fallbackGitHubIssueDiscussions[normalized];
    delete fallbackGitHubPullRequestDiscussions[normalized];
    delete fallbackGitHubPullRequestChecks[normalized];
    delete fallbackGitHubWorkflowRuns[normalized];
    delete fallbackGitHubBranches[normalized];
    delete fallbackGitHubBranchProtections[normalized];
    delete fallbackGitHubRulesets[normalized];
  });
}

export function listGitHubBranches(repoFullName: string): Promise<BranchSummary[]> {
  return call("github_list_branches", { repoFullName }, () => {
    const management = fallbackRepoManagement(repoFullName);
    const branches = fallbackGitHubBranches[repoFullName] ?? [
      buildBranchSummary({ name: management.defaultBranch || "main", remote: true }),
    ];
    return branches.map(cloneBranchSummary);
  });
}

export function getGitHubBranchProtection(
  repoFullName: string,
  branchName: string,
): Promise<GitHubBranchProtection | null> {
  return call("github_get_branch_protection", { repoFullName, branchName }, () => {
    fallbackRepoManagement(repoFullName);
    const branch = branchName.trim();
    if (!branch) throw new Error("分支名不能为空");
    const protection = fallbackGitHubBranchProtections[repoFullName]?.[branch];
    return protection ? cloneFallbackData(protection) : null;
  });
}

export function updateGitHubBranchProtection(
  repoFullName: string,
  branchName: string,
  request: GitHubBranchProtection,
): Promise<GitHubBranchProtection> {
  return call("github_update_branch_protection", { repoFullName, branchName, request }, () => {
    const management = fallbackRepoManagement(repoFullName);
    if (management.viewerCanAdminister === false) throw new Error("更新 GitHub 分支保护失败：权限不足");
    const branch = branchName.trim();
    if (!branch) throw new Error("分支名不能为空");
    const branches = fallbackGitHubBranches[repoFullName] ?? [];
    if (!branches.some((item) => item.name === branch)) throw new Error(`未找到 GitHub 分支：${branch}`);
    const protection = cloneFallbackData(request);
    fallbackGitHubBranchProtections[repoFullName] ??= {};
    fallbackGitHubBranchProtections[repoFullName][branch] = protection;
    fallbackGitHubBranches[repoFullName] = branches.map((item) =>
      item.name === branch ? { ...item, protected: true } : item
    );
    clearFallbackGitHubRepoSettingsSection(repoFullName, "branches");
    return cloneFallbackData(protection);
  });
}

function fallbackRulesetSummary(repoFullName: string, ruleset: GitHubRuleset): GitHubRulesetSummary {
  const sourceType = String(ruleset.source_type ?? ruleset.sourceType ?? "");
  const source = String(ruleset.source ?? "");
  return {
    id: Number(ruleset.id),
    name: String(ruleset.name ?? ""),
    target: String(ruleset.target ?? "branch"),
    enforcement: String(ruleset.enforcement ?? "disabled"),
    sourceType,
    source,
    repositoryOwned: sourceType.toLowerCase() === "repository" && source.toLowerCase() === repoFullName.toLowerCase(),
    createdAt: typeof ruleset.created_at === "string" ? ruleset.created_at : null,
    updatedAt: typeof ruleset.updated_at === "string" ? ruleset.updated_at : null,
  };
}

export function listGitHubRepoRulesets(repoFullName: string): Promise<GitHubRulesetSummary[]> {
  return call("github_list_repo_rulesets", { repoFullName }, () => {
    fallbackRepoManagement(repoFullName);
    return Object.values(fallbackGitHubRulesets[repoFullName] ?? {})
      .map((ruleset) => fallbackRulesetSummary(repoFullName, ruleset))
      .sort((left, right) => left.id - right.id);
  });
}

export function getGitHubRepoRuleset(repoFullName: string, rulesetId: number): Promise<GitHubRuleset> {
  return call("github_get_repo_ruleset", { repoFullName, rulesetId }, () => {
    fallbackRepoManagement(repoFullName);
    const ruleset = fallbackGitHubRulesets[repoFullName]?.[rulesetId];
    if (!ruleset) throw new Error(`未找到 GitHub 规则集：${rulesetId}`);
    return cloneFallbackData(ruleset);
  });
}

export function updateGitHubRepoRuleset(
  repoFullName: string,
  rulesetId: number,
  request: GitHubRuleset,
): Promise<GitHubRuleset> {
  return call("github_update_repo_ruleset", { repoFullName, rulesetId, request }, () => {
    const management = fallbackRepoManagement(repoFullName);
    if (management.viewerCanAdminister === false) throw new Error("更新 GitHub 规则集失败：权限不足");
    const current = fallbackGitHubRulesets[repoFullName]?.[rulesetId];
    if (!current) throw new Error(`未找到 GitHub 规则集：${rulesetId}`);
    const summary = fallbackRulesetSummary(repoFullName, current);
    if (!summary.repositoryOwned) throw new Error("继承的组织或企业规则集只能查看，不能在仓库中编辑");
    const updated = {
      ...cloneFallbackData(current),
      ...cloneFallbackData(request),
      id: rulesetId,
      source_type: current.source_type,
      source: current.source,
    };
    fallbackGitHubRulesets[repoFullName][rulesetId] = updated;
    clearFallbackGitHubRepoSettingsSection(repoFullName, "rules");
    return cloneFallbackData(updated);
  });
}

export function deleteGitHubBranch(repoFullName: string, branchName: string): Promise<void> {
  return call("github_delete_branch", { repoFullName, branchName }, () => {
    const branch = branchName.trim();
    if (!branch) throw new Error("分支名不能为空");
    const management = fallbackRepoManagement(repoFullName);
    if (branch === management.defaultBranch) throw new Error("不能删除默认分支");
    const branches = fallbackGitHubBranches[repoFullName] ?? [];
    const target = branches.find((item) => item.name === branch);
    if (!target) throw new Error(`未找到 GitHub 分支：${branch}`);
    if (target.protected) throw new Error("受保护分支不能删除");
    fallbackGitHubBranches[repoFullName] = branches.filter((item) => item.name !== branch);
    if (fallbackGitHubBranchProtections[repoFullName]) {
      delete fallbackGitHubBranchProtections[repoFullName][branch];
    }
    clearFallbackGitHubRepoSettingsSection(repoFullName, "branches");
  });
}

export function listGitHubAccountIssues(
  options: Pick<GitHubIssueListOptions, "state" | "perPage" | "sort" | "direction"> = {},
): Promise<GitHubAccountIssueItem[]> {
  const state = options.state ?? "open";
  const sort = options.sort ?? "updated";
  const direction = options.direction ?? "desc";
  const perPage = Number.isFinite(options.perPage) ? Math.max(1, Math.trunc(options.perPage ?? 0)) : null;
  fallbackGitHubAccountIssueListCalls.push({ state, perPage, sort, direction });
  return call("github_list_account_issues", { state, perPage, sort, direction }, async () => {
    if (fallbackGitHubAccountIssuesOverride) {
      const items = await fallbackGitHubAccountIssuesOverride({ state, perPage, sort, direction });
      return items.map((item) => ({
        repoFullName: item.repoFullName,
        issue: cloneIssue(item.issue),
        pullRequest: item.pullRequest,
      }));
    }
    const issueItems = Object.entries(fallbackGitHubIssues).flatMap(([repoFullName, issues]) =>
      issues
        .filter((issue) => !state || state === "all" || issue.state === state)
        .map((issue) => ({ repoFullName, issue: cloneIssue(issue), pullRequest: false })),
    );
    const pullItems = Object.entries(fallbackGitHubPullRequests).flatMap(([repoFullName, pullRequests]) =>
      pullRequests
        .filter((pullRequest) => !state || state === "all" || pullRequest.state === state)
        .map((pullRequest) => fallbackPullRequestAccountIssueItem(repoFullName, pullRequest)),
    );
    const sorted = [...issueItems, ...pullItems].sort((left, right) => {
      const leftValue = sort === "created" ? left.issue.createdAt : left.issue.updatedAt;
      const rightValue = sort === "created" ? right.issue.createdAt : right.issue.updatedAt;
      const delta = Date.parse(rightValue) - Date.parse(leftValue) || right.issue.number - left.issue.number;
      return direction === "asc" ? -delta : delta;
    });
    return sorted.slice(0, perPage ?? sorted.length);
  });
}

export function listGitHubActionNotifications(perPage?: number | null): Promise<GitHubActionNotification[]> {
  fallbackGitHubActionNotificationListCalls.push({ perPage: perPage ?? null });
  return call("github_list_action_notifications", { perPage: perPage ?? null }, async () => {
    if (fallbackGitHubActionNotificationsOverride) {
      const notifications = await fallbackGitHubActionNotificationsOverride(perPage ?? null);
      return notifications.map((notification) => ({ ...notification }));
    }
    return fallbackGitHubActionNotifications
      .slice(0, perPage ?? undefined)
      .map((notification) => ({ ...notification }));
  });
}

export function listGitHubPullRequests(
  repoFullName: string,
  stateOrOptions?: string | null | GitHubPullRequestListOptions,
): Promise<GitHubPullRequest[]> {
  const options = typeof stateOrOptions === "object" && stateOrOptions != null
    ? stateOrOptions
    : { state: stateOrOptions ?? null };
  const state = options.state ?? null;
  const sort = options.sort ?? "updated";
  const direction = options.direction ?? "desc";
  const creator = options.creator ?? null;
  const assignee = options.assignee ?? null;
  const labels = options.labels ?? null;
  const milestone = options.milestone ?? null;
  const project = options.project ?? null;
  const review = options.review ?? null;
  const query = options.query?.trim() || null;
  const perPage = Number.isFinite(options.perPage) ? Math.max(1, Math.trunc(options.perPage ?? 0)) : null;
  fallbackGitHubPullRequestListCalls.push({
    repoFullName,
    state,
    perPage,
    sort,
    direction,
    creator,
    assignee,
    labels: labels ? [...labels] : null,
    milestone,
    project,
    review,
    query,
  });
  return call("github_list_pull_requests", {
    repoFullName,
    state,
    perPage,
    sort,
    direction,
    creator,
    assignee,
    labels,
    milestone,
    project,
    review,
    query,
  }, () => {
    const sorted = [...(fallbackGitHubPullRequests[repoFullName] ?? [])]
      .filter((pullRequest) => isFallbackGitHubPullRequestState(pullRequest, state))
      .filter((pullRequest) => isFallbackGitHubPullRequestQuery(pullRequest, query))
      .filter((pullRequest) => isFallbackGitHubPullRequestCreator(pullRequest, creator))
      .filter((pullRequest) => isFallbackGitHubPullRequestAssignee(pullRequest, assignee))
      .filter((pullRequest) => isFallbackGitHubPullRequestLabels(pullRequest, labels))
      .filter((pullRequest) => isFallbackGitHubPullRequestMilestone(pullRequest, milestone))
      .filter((pullRequest) => isFallbackGitHubPullRequestProject(pullRequest, project))
      .filter((pullRequest) => isFallbackGitHubPullRequestReview(pullRequest, review))
      .sort((a, b) => compareFallbackGitHubPullRequests(a, b, sort, direction));
    return sorted
      .slice(0, perPage ?? sorted.length)
      .map(clonePullRequest);
  });
}

function isFallbackGitHubPullRequestState(pullRequest: GitHubPullRequest, state: string | null) {
  if (!state || state === "open") return pullRequest.state === "open";
  if (state === "merged") return pullRequest.merged;
  if (state === "closed") return pullRequest.state === "closed" && !pullRequest.merged;
  if (state === "all") return true;
  return pullRequest.state === state;
}

function isFallbackGitHubPullRequestCreator(pullRequest: GitHubPullRequest, creator: string | null) {
  if (!creator) return true;
  return pullRequest.author.toLowerCase() === creator.toLowerCase();
}

function isFallbackGitHubPullRequestAssignee(pullRequest: GitHubPullRequest, assignee: string | null) {
  if (!assignee) return true;
  const assignees = pullRequest.assignees ?? [];
  if (assignee === "none") return assignees.length === 0;
  return assignees.some((value) => value.toLowerCase() === assignee.toLowerCase());
}

function isFallbackGitHubPullRequestLabels(pullRequest: GitHubPullRequest, labels: readonly string[] | null) {
  const normalized = (labels ?? []).map((label) => label.toLowerCase()).filter(Boolean);
  if (!normalized.length) return true;
  const pullLabels = (pullRequest.labels ?? []).map((label) => label.toLowerCase());
  return normalized.every((label) => pullLabels.includes(label));
}

function isFallbackGitHubPullRequestMilestone(pullRequest: GitHubPullRequest, milestone: string | number | null) {
  if (milestone == null || milestone === "") return true;
  if (milestone === "none") return !pullRequest.milestone;
  return String(pullRequest.milestone?.number ?? "") === String(milestone);
}

function isFallbackGitHubPullRequestProject(pullRequest: GitHubPullRequest, project: string | null) {
  if (!project) return true;
  return (pullRequest.projectItems ?? []).some((item) => item.id === project || item.title === project);
}

function isFallbackGitHubPullRequestReview(pullRequest: GitHubPullRequest, review: string | null) {
  if (!review) return true;
  if (review === "approved") return pullRequest.mergeableState === "clean";
  if (review === "changes_requested") return pullRequest.mergeableState === "blocked";
  if (review === "required") return pullRequest.mergeableState === "unstable" || pullRequest.mergeableState === "blocked";
  if (review === "none") return !pullRequest.mergeableState || pullRequest.mergeableState === "unknown";
  return true;
}

function isFallbackGitHubPullRequestQuery(pullRequest: GitHubPullRequest, query: string | null) {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return true;
  return [
    pullRequest.number,
    pullRequest.title,
    pullRequest.body ?? "",
    pullRequest.author,
    pullRequest.headBranch,
    pullRequest.baseBranch,
    (pullRequest.labels ?? []).join(" "),
    (pullRequest.assignees ?? []).join(" "),
    pullRequest.milestone?.title ?? "",
    pullRequest.projectItems?.map((project) => project.title).join(" ") ?? "",
  ].join(" ").toLowerCase().includes(normalized);
}

function compareFallbackGitHubPullRequests(
  a: GitHubPullRequest,
  b: GitHubPullRequest,
  sort: string | null,
  direction: string | null,
) {
  if (sort === "comments") {
    const comparedComments = (a.comments ?? 0) - (b.comments ?? 0);
    return direction === "asc" ? comparedComments : -comparedComments;
  }
  const sortKey = sort === "created" ? "createdAt" : "updatedAt";
  const left = Date.parse(a[sortKey]);
  const right = Date.parse(b[sortKey]);
  const compared = (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0);
  return direction === "asc" ? compared : -compared;
}

export function getGitHubPullRequest(repoFullName: string, pullNumber: number): Promise<GitHubPullRequest> {
  return call("github_get_pull_request", { repoFullName, pullNumber }, () => {
    const current = (fallbackGitHubPullRequests[repoFullName] ?? []).find((pullRequest) => pullRequest.number === pullNumber);
    if (!current) throw new Error(`未找到 Pull Request #${pullNumber}`);
    return clonePullRequest(current);
  });
}

export function getGitHubPullRequestDiscussion(
  repoFullName: string,
  pullNumber: number,
): Promise<GitHubPullRequestDiscussion> {
  return call("github_get_pull_request_discussion", { repoFullName, pullNumber }, () => {
    const current = fallbackGitHubPullRequestDiscussions[repoFullName]?.[pullNumber];
    if (current) return clonePullRequestDiscussion(current);
    const pullRequest = (fallbackGitHubPullRequests[repoFullName] ?? [])
      .find((item) => item.number === pullNumber);
    if (!pullRequest) throw new Error(`未找到 Pull Request #${pullNumber}`);
    return fallbackPullRequestDiscussion(pullRequest);
  });
}

export function createGitHubPullRequest(
  repoFullName: string,
  request: GitHubCreatePullRequestRequest,
): Promise<GitHubPullRequest> {
  return call("github_create_pull_request", { repoFullName, request }, () => {
    const title = request.title.trim();
    const head = request.head.trim();
    const base = request.base.trim();
    if (!title || !head || !base) throw new Error("Pull Request 标题、head 和 base 不能为空");
    const pullRequests = fallbackGitHubPullRequests[repoFullName] ?? [];
    const pullRequest: GitHubPullRequest = {
      number: Math.max(0, ...pullRequests.map((item) => item.number)) + 1,
      title,
      state: "open",
      draft: request.draft === true,
      body: request.body?.trim() || null,
      labels: [],
      assignees: [],
      milestone: null,
      comments: 0,
      projectItems: [],
      htmlUrl: `https://github.com/${repoFullName}/pull/${pullRequests.length + 1}`,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      author: fallbackBinding.binding?.login ?? "lilia-user",
      baseBranch: base,
      headBranch: head,
      merged: false,
      mergeable: true,
      mergeableState: "clean",
    };
    fallbackGitHubPullRequests[repoFullName] = [pullRequest, ...pullRequests];
    fallbackGitHubPullRequestChecks[repoFullName] = {
      ...(fallbackGitHubPullRequestChecks[repoFullName] ?? {}),
      [pullRequest.number]: [],
    };
    return clonePullRequest(pullRequest);
  });
}

export function updateGitHubPullRequest(
  repoFullName: string,
  pullNumber: number,
  request: GitHubUpdatePullRequestRequest,
): Promise<GitHubPullRequest> {
  return call("github_update_pull_request", { repoFullName, pullNumber, request }, () => {
    const pullRequests = fallbackGitHubPullRequests[repoFullName] ?? [];
    const current = pullRequests.find((pullRequest) => pullRequest.number === pullNumber);
    if (!current) throw new Error(`未找到 Pull Request #${pullNumber}`);
    const updated: GitHubPullRequest = {
      ...current,
      title: request.title?.trim() || current.title,
      body: request.body ?? current.body,
      state: request.state?.trim() || current.state,
      baseBranch: request.base?.trim() || current.baseBranch,
      updatedAt: new Date().toISOString(),
    };
    fallbackGitHubPullRequests[repoFullName] = pullRequests.map((pullRequest) =>
      pullRequest.number === pullNumber ? updated : pullRequest
    );
    return clonePullRequest(updated);
  });
}

export function mergeGitHubPullRequest(
  repoFullName: string,
  pullNumber: number,
  _request: GitHubMergePullRequestRequest = {},
): Promise<GitHubPullRequest> {
  return call("github_merge_pull_request", { repoFullName, pullNumber, request: _request }, () => {
    const pullRequests = fallbackGitHubPullRequests[repoFullName] ?? [];
    const current = pullRequests.find((pullRequest) => pullRequest.number === pullNumber);
    if (!current) throw new Error(`未找到 Pull Request #${pullNumber}`);
    const updated: GitHubPullRequest = {
      ...current,
      state: "closed",
      merged: true,
      mergeable: false,
      mergeableState: "merged",
      updatedAt: new Date().toISOString(),
    };
    fallbackGitHubPullRequests[repoFullName] = pullRequests.map((pullRequest) =>
      pullRequest.number === pullNumber ? updated : pullRequest
    );
    return clonePullRequest(updated);
  });
}

export function listGitHubPullRequestChecks(
  repoFullName: string,
  pullNumber: number,
): Promise<GitHubPullRequestCheck[]> {
  return call("github_list_pull_request_checks", { repoFullName, pullNumber }, () => {
    fallbackGitHubPullRequestCheckListCalls.push({ repoFullName, pullNumber });
    return [...(fallbackGitHubPullRequestChecks[repoFullName]?.[pullNumber] ?? [])].map(clonePullRequestCheck);
  });
}

export function listGitHubIssues(
  repoFullName: string,
  stateOrOptions?: string | null | GitHubIssueListOptions,
): Promise<GitHubIssue[]> {
  const options = typeof stateOrOptions === "object" && stateOrOptions != null
    ? stateOrOptions
    : { state: stateOrOptions ?? null };
  const state = options.state ?? null;
  const sort = options.sort ?? null;
  const direction = options.direction ?? null;
  const since = options.since ?? null;
  const creator = options.creator ?? null;
  const assignee = options.assignee ?? null;
  const labels = options.labels ?? null;
  const milestone = options.milestone ?? null;
  const project = options.project ?? null;
  const query = options.query?.trim() || null;
  const perPage = Number.isFinite(options.perPage) ? Math.max(1, Math.trunc(options.perPage ?? 0)) : null;
  fallbackGitHubIssueListCalls.push({
    repoFullName,
    state,
    perPage,
    sort,
    direction,
    since,
    creator,
    assignee,
    labels: labels ? [...labels] : null,
    milestone,
    project,
    query,
  });
  return call("github_list_issues", {
    repoFullName,
    state,
    perPage,
    sort,
    direction,
    since,
    creator,
    assignee,
    labels,
    milestone,
    project,
    query,
  }, () => {
    const sorted = [...(fallbackGitHubIssues[repoFullName] ?? [])]
      .filter((issue) => !state || state === "all" || issue.state === state)
      .filter((issue) => isFallbackGitHubIssueQuery(issue, query))
      .filter((issue) => isFallbackGitHubIssueSince(issue, since))
      .filter((issue) => isFallbackGitHubIssueCreator(issue, creator))
      .filter((issue) => isFallbackGitHubIssueAssignee(issue, assignee))
      .filter((issue) => isFallbackGitHubIssueLabels(issue, labels))
      .filter((issue) => isFallbackGitHubIssueMilestone(issue, milestone))
      .filter((issue) => isFallbackGitHubIssueProject(issue, project))
      .sort((a, b) => compareFallbackGitHubIssues(a, b, sort, direction));
    return sorted
      .slice(0, perPage ?? sorted.length)
      .map(cloneIssue);
  });
}

export function getGitHubIssueDiscussion(
  repoFullName: string,
  issueNumber: number,
): Promise<GitHubIssueDiscussion> {
  return call("github_get_issue_discussion", { repoFullName, issueNumber }, () => {
    const current = fallbackGitHubIssueDiscussions[repoFullName]?.[issueNumber];
    if (current) return cloneIssueDiscussion(current);
    const issue = (fallbackGitHubIssues[repoFullName] ?? []).find((item) => item.number === issueNumber);
    if (!issue) throw new Error(`未找到 Issue #${issueNumber}`);
    return fallbackIssueDiscussion(issue);
  });
}

function fallbackIssueValues(repoFullName: string, key: "labels" | "assignees") {
  return [...new Set((fallbackGitHubIssues[repoFullName] ?? [])
    .flatMap((issue) => issue[key])
    .map((value) => value.trim())
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function uniqueMilestones(issues: readonly GitHubIssue[]): GitHubIssueMilestone[] {
  const byNumber = new Map<number, GitHubIssueMilestone>();
  for (const issue of issues) {
    if (!issue.milestone) continue;
    byNumber.set(issue.milestone.number, { ...issue.milestone });
  }
  return [...byNumber.values()].sort((left, right) => left.title.localeCompare(right.title));
}

function uniqueIssueProjects(issues: readonly GitHubIssue[]) {
  const byId = new Map<string, { id: string; title: string }>();
  for (const issue of issues) {
    for (const project of issue.projectItems ?? []) {
      byId.set(project.id, { ...project });
    }
  }
  return [...byId.values()].sort((left, right) => left.title.localeCompare(right.title));
}

export function listGitHubIssueLabels(repoFullName: string): Promise<string[]> {
  return call("github_list_issue_labels", { repoFullName }, () =>
    fallbackIssueValues(repoFullName, "labels"),
  );
}

export function listGitHubIssueAssignees(repoFullName: string): Promise<string[]> {
  return call("github_list_issue_assignees", { repoFullName }, () =>
    fallbackIssueValues(repoFullName, "assignees"),
  );
}

export function getGitHubIssueFilterMetadata(repoFullName: string): Promise<GitHubIssueFilterMetadata> {
  return call("github_get_issue_filter_metadata", { repoFullName }, () => {
    const issues = fallbackGitHubIssues[repoFullName] ?? [];
    const authors = uniqueSorted(issues.map((issue) => issue.author ?? "").filter(Boolean));
    const labels = fallbackIssueValues(repoFullName, "labels");
    const assignees = fallbackIssueValues(repoFullName, "assignees");
    const milestones = uniqueMilestones(issues);
    const projects = uniqueIssueProjects(issues);
    return Promise.resolve({ authors, labels, assignees, milestones, projects });
  });
}

function isFallbackGitHubIssueSince(issue: GitHubIssue, since: string | null) {
  if (!since) return true;
  const issueUpdatedAt = Date.parse(issue.updatedAt);
  const sinceTimestamp = Date.parse(since);
  if (!Number.isFinite(issueUpdatedAt) || !Number.isFinite(sinceTimestamp)) return true;
  return issueUpdatedAt >= sinceTimestamp;
}

function isFallbackGitHubIssueCreator(issue: GitHubIssue, creator: string | null) {
  if (!creator) return true;
  return (issue.author ?? "").toLowerCase() === creator.toLowerCase();
}

function isFallbackGitHubIssueAssignee(issue: GitHubIssue, assignee: string | null) {
  if (!assignee) return true;
  if (assignee === "none") return issue.assignees.length === 0;
  return issue.assignees.some((value) => value.toLowerCase() === assignee.toLowerCase());
}

function isFallbackGitHubIssueLabels(issue: GitHubIssue, labels: readonly string[] | null) {
  const normalized = (labels ?? []).map((label) => label.toLowerCase()).filter(Boolean);
  if (!normalized.length) return true;
  const issueLabels = issue.labels.map((label) => label.toLowerCase());
  return normalized.every((label) => issueLabels.includes(label));
}

function isFallbackGitHubIssueMilestone(issue: GitHubIssue, milestone: string | number | null) {
  if (milestone == null || milestone === "") return true;
  if (milestone === "none") return !issue.milestone;
  return String(issue.milestone?.number ?? "") === String(milestone);
}

function isFallbackGitHubIssueProject(issue: GitHubIssue, project: string | null) {
  if (!project) return true;
  return (issue.projectItems ?? []).some((item) => item.id === project || item.title === project);
}

function isFallbackGitHubIssueQuery(issue: GitHubIssue, query: string | null) {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return true;
  return [
    issue.number,
    issue.title,
    issue.body ?? "",
    issue.author ?? "",
    issue.labels.join(" "),
    issue.assignees.join(" "),
    issue.milestone?.title ?? "",
    issue.projectItems?.map((project) => project.title).join(" ") ?? "",
  ].join(" ").toLowerCase().includes(normalized);
}

function compareFallbackGitHubIssues(
  a: GitHubIssue,
  b: GitHubIssue,
  sort: string | null,
  direction: string | null,
) {
  if (sort === "comments") {
    const comparedComments = (a.comments ?? 0) - (b.comments ?? 0);
    return direction === "asc" ? comparedComments : -comparedComments;
  }
  const sortKey = sort === "created" ? "createdAt" : "updatedAt";
  const left = Date.parse(a[sortKey]);
  const right = Date.parse(b[sortKey]);
  const compared = (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0);
  return direction === "asc" ? compared : -compared;
}

export function createGitHubIssue(
  repoFullName: string,
  request: GitHubCreateIssueRequest,
): Promise<GitHubIssue> {
  return call("github_create_issue", { repoFullName, request }, () => {
    const title = request.title.trim();
    if (!title) throw new Error("Issue 标题不能为空");
    const issues = fallbackGitHubIssues[repoFullName] ?? [];
    const issue: GitHubIssue = {
      number: Math.max(0, ...issues.map((item) => item.number)) + 1,
      title,
      state: "open",
      body: request.body?.trim() || null,
      labels: [...request.labels],
      assignees: [...request.assignees],
      author: fallbackBinding.binding?.login ?? "lilia-user",
      milestone: null,
      comments: 0,
      projectItems: [],
      htmlUrl: `https://github.com/${repoFullName}/issues/${issues.length + 1}`,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    fallbackGitHubIssues[repoFullName] = [issue, ...issues];
    return cloneIssue(issue);
  });
}

export function updateGitHubIssue(
  repoFullName: string,
  issueNumber: number,
  request: GitHubUpdateIssueRequest,
): Promise<GitHubIssue> {
  return call("github_update_issue", { repoFullName, issueNumber, request }, () => {
    const issues = fallbackGitHubIssues[repoFullName] ?? [];
    const current = issues.find((issue) => issue.number === issueNumber);
    if (!current) throw new Error(`未找到 Issue #${issueNumber}`);
    const { stateReason: _stateReason, ...issueRequest } = request;
    const updated: GitHubIssue = {
      ...current,
      ...issueRequest,
      title: request.title ?? current.title,
      body: request.body ?? current.body,
      labels: request.labels ? [...request.labels] : [...current.labels],
      assignees: request.assignees ? [...request.assignees] : [...current.assignees],
      updatedAt: new Date().toISOString(),
    };
    fallbackGitHubIssues[repoFullName] = issues.map((issue) => issue.number === issueNumber ? updated : issue);
    return cloneIssue(updated);
  });
}

function fallbackRelease(repoFullName: string, releaseId: number) {
  const release = (fallbackGitHubReleases[repoFullName] ?? []).find((item) => item.id === releaseId);
  if (!release) throw new Error(`未找到 Release #${releaseId}`);
  return release;
}

function replaceFallbackRelease(repoFullName: string, release: GitHubRelease) {
  fallbackGitHubReleases[repoFullName] = (fallbackGitHubReleases[repoFullName] ?? [])
    .map((item) => item.id === release.id ? release : item);
}

export function listGitHubReleases(repoFullName: string): Promise<GitHubRelease[]> {
  fallbackGitHubReleaseListCalls.push({ repoFullName });
  return call("github_list_releases", { repoFullName }, () =>
    [...(fallbackGitHubReleases[repoFullName] ?? [])]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .map(cloneRelease),
  );
}

export function createGitHubRelease(
  repoFullName: string,
  request: GitHubCreateReleaseRequest,
): Promise<GitHubRelease> {
  return call("github_create_release", { repoFullName, request }, () => {
    const tagName = request.tagName.trim();
    if (!tagName) throw new Error("Release tag 不能为空");
    const releases = fallbackGitHubReleases[repoFullName] ?? [];
    const releaseId = Math.max(0, ...releases.map((item) => item.id)) + 1;
    const now = new Date().toISOString();
    const release: GitHubRelease = {
      id: releaseId,
      tagName,
      targetCommitish: request.targetCommitish?.trim() || "main",
      name: request.name?.trim() || null,
      body: request.body?.trim() || null,
      draft: request.draft ?? false,
      prerelease: request.prerelease ?? false,
      immutable: false,
      makeLatest: request.makeLatest ?? null,
      htmlUrl: `https://github.com/${repoFullName}/releases/tag/${encodeURIComponent(tagName)}`,
      uploadUrl: `https://uploads.github.com/repos/${repoFullName}/releases/${releaseId}/assets{?name,label}`,
      tarballUrl: `https://api.github.com/repos/${repoFullName}/tarball/${encodeURIComponent(tagName)}`,
      zipballUrl: `https://api.github.com/repos/${repoFullName}/zipball/${encodeURIComponent(tagName)}`,
      createdAt: now,
      publishedAt: request.draft ? null : now,
      author: fallbackBinding.binding?.login ?? "lilia-user",
      assets: [],
    };
    fallbackGitHubReleases[repoFullName] = [release, ...releases];
    return cloneRelease(release);
  });
}

export function updateGitHubRelease(
  repoFullName: string,
  releaseId: number,
  request: GitHubUpdateReleaseRequest,
): Promise<GitHubRelease> {
  return call("github_update_release", { repoFullName, releaseId, request }, () => {
    const current = fallbackRelease(repoFullName, releaseId);
    const now = new Date().toISOString();
    const updated: GitHubRelease = {
      ...current,
      tagName: request.tagName?.trim() || current.tagName,
      targetCommitish: request.targetCommitish?.trim() || current.targetCommitish,
      name: request.name === undefined ? current.name : request.name?.trim() || null,
      body: request.body === undefined ? current.body : request.body?.trim() || null,
      draft: request.draft ?? current.draft,
      prerelease: request.prerelease ?? current.prerelease,
      makeLatest: request.makeLatest === undefined ? current.makeLatest : request.makeLatest,
      publishedAt: request.draft === false && !current.publishedAt ? now : current.publishedAt,
    };
    replaceFallbackRelease(repoFullName, updated);
    return cloneRelease(updated);
  });
}

export function deleteGitHubRelease(repoFullName: string, releaseId: number): Promise<void> {
  return call("github_delete_release", { repoFullName, releaseId }, () => {
    fallbackRelease(repoFullName, releaseId);
    fallbackGitHubReleases[repoFullName] = (fallbackGitHubReleases[repoFullName] ?? [])
      .filter((release) => release.id !== releaseId);
  });
}

export function uploadGitHubReleaseAsset(
  repoFullName: string,
  releaseId: number,
  filePath: string,
  label?: string | null,
): Promise<GitHubReleaseAsset> {
  return call("github_upload_release_asset", { repoFullName, releaseId, filePath, label: label ?? null }, () => {
    const current = fallbackRelease(repoFullName, releaseId);
    const name = filePath.split(/[\\/]/).pop()?.trim();
    if (!name) throw new Error("Release asset 文件名不能为空");
    if (current.assets.some((asset) => asset.name === name)) {
      throw new Error("Release asset 已存在，请先删除旧文件后再上传");
    }
    const now = new Date().toISOString();
    const asset = releaseAsset(Math.max(0, ...current.assets.map((item) => item.id)) + 1, repoFullName, current.tagName, name, 1024, {
      label: label?.trim() || null,
      createdAt: now,
      updatedAt: now,
      uploader: fallbackBinding.binding?.login ?? "lilia-user",
    });
    const updated = { ...current, assets: [asset, ...current.assets] };
    replaceFallbackRelease(repoFullName, updated);
    return cloneReleaseAsset(asset);
  });
}

export function attachGitHubWorkflowArtifactAsset(
  repoFullName: string,
  request: GitHubAttachWorkflowArtifactAssetRequest,
): Promise<GitHubReleaseAsset> {
  return call("github_attach_workflow_artifact_asset", { repoFullName, request }, () => {
    const current = fallbackRelease(repoFullName, request.releaseId);
    const expectedTag = request.expectedTagName.trim();
    if (!expectedTag) throw new Error("Release tag 不能为空");
    if (current.tagName !== expectedTag) {
      throw new Error(`Release tag 不匹配：artifact 期望 ${expectedTag}，当前 draft release 是 ${current.tagName}`);
    }
    if (!current.draft) throw new Error("只能把 Actions artifact 附加到 draft release");
    const artifact = fallbackGitHubWorkflowRunDetails[repoFullName]?.[request.runId]?.artifacts
      .find((item) => item.id === request.artifactId);
    if (!artifact) throw new Error("artifact 不属于当前 Actions run");
    if (artifact.expired) throw new Error("artifact 已过期，不能附加到 Release");
    if (request.artifactName?.trim() && artifact.name !== request.artifactName.trim()) {
      throw new Error(`artifact 名称不匹配：期望 ${request.artifactName.trim()}，当前是 ${artifact.name}`);
    }
    const normalizedPath = request.artifactPath.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!normalizedPath || normalizedPath.split("/").includes("..")) throw new Error("artifact 文件路径无效");
    const entry = fallbackGitHubWorkflowArtifactEntries[repoFullName]?.[request.artifactId]
      ?.find((item) => item.path === normalizedPath && item.kind === "file");
    if (!entry) throw new Error("artifact 文件不存在");
    const name = entry.path.split("/").pop()?.trim();
    if (!name) throw new Error("Release asset 文件名不能为空");
    if (current.assets.some((asset) => asset.name === name)) {
      throw new Error("Release asset 已存在，请先删除旧文件后再上传");
    }
    const now = new Date().toISOString();
    const asset = releaseAsset(Math.max(0, ...current.assets.map((item) => item.id)) + 1, repoFullName, current.tagName, name, entry.size, {
      label: request.label?.trim() || null,
      createdAt: now,
      updatedAt: now,
      uploader: fallbackBinding.binding?.login ?? "lilia-user",
    });
    const updated = { ...current, assets: [asset, ...current.assets] };
    replaceFallbackRelease(repoFullName, updated);
    return cloneReleaseAsset(asset);
  });
}

export function deleteGitHubReleaseAsset(repoFullName: string, releaseId: number, assetId: number): Promise<void> {
  return call("github_delete_release_asset", { repoFullName, releaseId, assetId }, () => {
    const current = fallbackRelease(repoFullName, releaseId);
    const nextAssets = current.assets.filter((asset) => asset.id !== assetId);
    if (nextAssets.length === current.assets.length) throw new Error(`未找到 Release asset #${assetId}`);
    const updated = { ...current, assets: nextAssets };
    replaceFallbackRelease(repoFullName, updated);
  });
}

export function listGitHubWorkflowRuns(repoFullName: string, perPage?: number | null): Promise<GitHubWorkflowRun[]> {
  fallbackGitHubWorkflowRunListCalls.push({ repoFullName, perPage: perPage ?? null });
  return call("github_list_workflow_runs", { repoFullName, perPage: perPage ?? null }, async () => {
    const source = fallbackGitHubWorkflowRunsOverride
      ? await fallbackGitHubWorkflowRunsOverride(repoFullName, perPage ?? null)
      : fallbackGitHubWorkflowRuns[repoFullName] ?? [];
    return [...source]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, perPage ?? undefined)
      .map((run) => ({ ...run }));
  });
}

export function getGitHubWorkflowRunDetail(repoFullName: string, runId: number): Promise<GitHubWorkflowRunDetail> {
  fallbackGitHubWorkflowRunDetailCalls.push({ repoFullName, runId });
  return call("github_get_workflow_run_detail", { repoFullName, runId }, async () => {
    const detail = fallbackGitHubWorkflowRunDetails[repoFullName]?.[runId];
    if (detail) return cloneWorkflowRunDetail(detail);
    const run = fallbackGitHubWorkflowRuns[repoFullName]?.find((item) => item.id === runId);
    if (!run) throw new Error("GitHub Actions run 不存在");
    return fallbackWorkflowRunDetail(run);
  });
}

export function getGitHubWorkflowJobLog(repoFullName: string, jobId: number): Promise<GitHubWorkflowJobLog> {
  fallbackGitHubWorkflowJobLogCalls.push({ repoFullName, jobId });
  return call("github_get_workflow_job_log", { repoFullName, jobId }, async () => {
    const log = fallbackGitHubWorkflowJobLogs[repoFullName]?.[jobId];
    if (!log) throw new Error("GitHub Actions job 日志不存在");
    return { ...log };
  });
}

function markFallbackWorkflowRerun(repoFullName: string, detail: GitHubWorkflowRunDetail) {
  const rerun = {
    ...detail.run,
    status: "queued",
    conclusion: null,
    runAttempt: (detail.run.runAttempt ?? 1) + 1,
    updatedAt: new Date().toISOString(),
  };
  detail.run = rerun;
  const runs = fallbackGitHubWorkflowRuns[repoFullName] ?? [];
  fallbackGitHubWorkflowRuns[repoFullName] = runs.map((run) => run.id === rerun.id ? { ...rerun } : run);
}

export function rerunFailedGitHubWorkflowRun(repoFullName: string, runId: number): Promise<void> {
  return call("github_rerun_failed_workflow_run", { repoFullName, runId }, () => {
    const detail = fallbackGitHubWorkflowRunDetails[repoFullName]?.[runId];
    if (!detail) throw new Error("GitHub Actions run 不存在");
    markFallbackWorkflowRerun(repoFullName, detail);
  });
}

export function rerunGitHubWorkflowJob(repoFullName: string, jobId: number): Promise<void> {
  return call("github_rerun_workflow_job", { repoFullName, jobId }, () => {
    const details = Object.values(fallbackGitHubWorkflowRunDetails[repoFullName] ?? {});
    const detail = details.find((item) => item.jobs.some((job) => job.id === jobId));
    if (!detail) throw new Error("GitHub Actions job 不存在");
    markFallbackWorkflowRerun(repoFullName, detail);
  });
}

export function listGitHubWorkflowArtifactFiles(
  repoFullName: string,
  artifactId: number,
): Promise<GitHubWorkflowArtifactEntry[]> {
  fallbackGitHubWorkflowArtifactListCalls.push({ repoFullName, artifactId });
  return call("github_list_workflow_artifact_files", { repoFullName, artifactId }, async () => (
    fallbackGitHubWorkflowArtifactEntries[repoFullName]?.[artifactId] ?? []
  ).map((entry) => ({ ...entry })));
}

export function getGitHubWorkflowArtifactFilePreview(
  repoFullName: string,
  artifactId: number,
  path: string,
): Promise<RepoFilePreview> {
  fallbackGitHubWorkflowArtifactPreviewCalls.push({ repoFullName, artifactId, path });
  return call("github_get_workflow_artifact_file_preview", { repoFullName, artifactId, path }, async () => {
    const preview = fallbackGitHubWorkflowArtifactPreviews[repoFullName]?.[artifactId]?.[path];
    if (!preview) throw new Error("artifact 文件不存在");
    return cloneRepoFilePreview(preview);
  });
}

export function listGitHubRepoCommits(
  repoFullName: string,
  options: GitHubCommitListOptions = {},
): Promise<CommitSummary[]> {
  fallbackGitHubCommitListCalls.push({
    repoFullName,
    perPage: options.perPage ?? null,
    sha: options.sha ?? null,
  });
  return call("github_list_repo_commits", {
    repoFullName,
    perPage: options.perPage ?? null,
    sha: options.sha ?? null,
  }, () =>
    (fallbackGitHubCommits[repoFullName] ?? [])
      .map(cloneCommitSummary)
      .slice(0, options.perPage ?? undefined),
  );
}

export function getGitHubRepoCommitDetail(repoFullName: string, hash: string): Promise<CommitDetail> {
  fallbackGitHubCommitDetailCalls.push({ repoFullName, hash });
  return call("github_get_repo_commit_detail", { repoFullName, hash }, () => {
    const details = fallbackGitHubCommitDetails[repoFullName] ?? {};
    const detail = details[hash] ??
      Object.values(details).find((item) => item.hash === hash || item.shortHash === hash);
    if (detail) return cloneCommitDetail(detail);
    const commit = (fallbackGitHubCommits[repoFullName] ?? [])
      .find((item) => item.hash === hash || item.shortHash === hash);
    if (!commit) throw new Error(`未找到远程提交：${hash}`);
    return {
      ...cloneCommitSummary(commit),
      committer: commit.author,
      committerEmail: commit.authorEmail ?? null,
      body: "",
      files: [],
    };
  });
}

function fallbackContributionMeta(repoScope: string): GitHubContributionMeta {
  const normalized = repoScope.trim().replace(/^local:/, "").replace(/^\/+|\/+$/g, "");
  const repoCount = normalized ? 1 : 0;
  return {
    repoCount,
    requestedRepoCount: repoCount,
    repoLimit: CONTRIBUTION_REPO_LIMIT,
    truncated: false,
    skippedRepoCount: 0,
    refreshedAt: Date.now(),
  };
}

function fallbackContributionRepository(repoScope: string) {
  const repoId = repoScope.trim().replace(/^local:/, "").replace(/^\/+|\/+$/g, "");
  if (!repoId) return null;
  const repo = fallbackRepo(repoId);
  return {
    repoId,
    repoName: repo?.name?.trim() || repoId,
    repoFullName: repo?.githubFullName?.trim() || null,
  };
}

export function listRepoContribution(repoScope: string): Promise<GitHubContributionResult> {
  return call("github_list_repo_contribution", { repoFullName: repoScope }, () => {
    if (fallbackRepoContributionOverride) {
      const result = fallbackRepoContributionOverride(repoScope);
      return {
        days: result.days.map(cloneContributionDay),
        meta: { ...result.meta },
      };
    }
    const end = new Date("2026-06-11T00:00:00Z");
    const repo = fallbackContributionRepository(repoScope);
    const days = Array.from({ length: CONTRIBUTION_DAYS }, (_, index) => {
      const date = new Date(end);
      date.setUTCDate(end.getUTCDate() - (CONTRIBUTION_DAYS - 1 - index));
      const dayIndex = Math.floor(date.getTime() / 86_400_000);
      const active = dayIndex % 5 === 0 || dayIndex % 17 === 0 || dayIndex > Math.floor(end.getTime() / 86_400_000) - 45;
      const count = active ? ((dayIndex % 4) + 1) : 0;
      return {
        date: date.toISOString().slice(0, 10),
        count,
        repositories: repo && count > 0 ? [{ ...repo, count }] : undefined,
      };
    });
    return {
      days,
      meta: fallbackContributionMeta(repoScope),
    };
  });
}

function fallbackRepo(repoId: string): RepoSummary {
  return allFallbackRepos().find((repo) => repo.id === repoId) ?? fallbackRepos[0];
}

function updateFallbackRepo(summary: RepoSummary) {
  fallbackRepoOverrides = {
    ...fallbackRepoOverrides,
    [summary.id]: cloneRepoSummary(summary),
  };
  writeFallbackStartupRepoSummary(summary);
  return cloneRepoSummary(summary);
}

function fallbackLocalBranchName(remoteBranchName: string) {
  return remoteBranchName.split("/").slice(1).join("/") || remoteBranchName;
}

function syncFallbackRepoBranchState(repoId: string) {
  const repo = fallbackRepo(repoId);
  const currentBranch = repo.currentBranch?.trim() || null;
  const branches = fallbackRepoBranches[repoId] ?? [];
  const next = branches.map((branch) => {
    if (branch.remote) return cloneBranchSummary(branch);
    const isCurrent = branch.name === currentBranch;
    return {
      ...cloneBranchSummary(branch),
      current: isCurrent,
      ahead: isCurrent ? repo.ahead : branch.ahead,
      behind: isCurrent ? repo.behind : branch.behind,
      checkedOutWorktreePaths: isCurrent && repo.path ? [repo.path] : [],
    };
  });
  if (currentBranch && !next.some((branch) => !branch.remote && branch.name === currentBranch)) {
    next.unshift(buildBranchSummary({
      name: currentBranch,
      current: true,
      ahead: repo.ahead,
      behind: repo.behind,
      tipTimestamp: repo.lastCommitAt,
      checkedOutWorktreePaths: repo.path ? [repo.path] : [],
    }));
  }
  fallbackRepoBranches[repoId] = next;
  return next;
}

function fallbackRepoNeedsPublish(repo: RepoSummary) {
  const currentBranch = repo.currentBranch?.trim();
  if (!currentBranch) return false;
  const branches = syncFallbackRepoBranchState(repo.id);
  const localBranch = branches.find((branch) => !branch.remote && branch.name === currentBranch);
  const upstream = localBranch?.upstream?.trim();
  return !upstream || !branches.some((branch) => branch.remote && branch.name === upstream);
}

export function listGitHubRepoFiles(
  repoFullName: string,
  parentPath?: string | null,
  refName?: string | null,
): Promise<RepoFileTreeEntry[]> {
  const normalizedParentPath = parentPath ?? "";
  fallbackGitHubRepoFileListCalls.push({
    repoFullName,
    parentPath: parentPath ?? null,
    refName: refName ?? null,
  });
  return call("github_list_repo_files", { repoFullName, parentPath: parentPath ?? null, refName: refName ?? null }, () =>
    (fallbackGitHubRepoFiles[repoFullName]?.[normalizedParentPath] ?? []).map(cloneRepoFileTreeEntry),
  );
}

export function getGitHubRepoFilePreview(
  repoFullName: string,
  path: string,
  refName?: string | null,
): Promise<RepoFilePreview> {
  fallbackGitHubRepoFilePreviewCalls.push({
    repoFullName,
    path,
    refName: refName ?? null,
  });
  return call("github_get_repo_file_preview", { repoFullName, path, refName: refName ?? null }, () => {
    const preview = fallbackGitHubRepoFilePreviews[repoFullName]?.[path];
    if (!preview) {
      throw new Error(`未找到远程文件预览：${repoFullName} ${path}`);
    }
    return cloneRepoFilePreview(preview);
  });
}

export function listRepoFiles(repoId: string, parentPath?: string | null, repoRef?: string | null): Promise<RepoFileTreeEntry[]> {
  return call("repo_list_files", { repoId, parentPath: parentPath ?? null }, () =>
    fallbackRepoFilesOverride?.(repoId, parentPath ?? null, repoRef ?? null) ??
    (fallbackRepoFiles[repoId]?.[parentPath ?? ""] ?? []).map(cloneRepoFileTreeEntry),
  );
}

export function getRepoFilePreview(repoId: string, path: string, _repoRef?: string | null): Promise<RepoFilePreview> {
  return call("repo_get_file_preview", { repoId, path }, () => {
    const preview = fallbackRepoFilePreviews[repoId]?.[path];
    if (!preview) {
      throw new Error(`未找到文件预览：${repoId} ${path}`);
    }
    return cloneRepoFilePreview(preview);
  });
}

export function deleteRepoFile(repoId: string, path: string): Promise<RepoSummary> {
  return call("repo_delete_file", { repoId, path }, () => {
    const summary = fallbackRepo(repoId);
    const parentPath = path.split("/").slice(0, -1).join("/");
    const parentKey = parentPath || "";
    const entries = fallbackRepoFiles[repoId]?.[parentKey];
    if (entries) {
      fallbackRepoFiles[repoId][parentKey] = entries.filter((entry) => entry.path !== path);
    }
    delete fallbackRepoFilePreviews[repoId]?.[path];
    return cloneRepoSummary(summary);
  });
}

function emptyConflictState(): RepoConflictState {
  return {
    operation: "none",
    files: [],
    allResolved: true,
  };
}

function initialFallbackConflictState(repoId: string): RepoConflictState {
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

function setFallbackConflictState(repoId: string, state: RepoConflictState) {
  const next = cloneFallbackData(state);
  next.allResolved = next.files.length === 0;
  fallbackConflictStates.set(repoId, next);
}

function fallbackConflictState(repoId: string): RepoConflictState {
  const existing = fallbackConflictStates.get(repoId);
  if (existing) return cloneFallbackData(existing);
  const initial = fallbackConflictOverride?.(repoId) ?? initialFallbackConflictState(repoId);
  setFallbackConflictState(repoId, initial);
  return cloneFallbackData(fallbackConflictStates.get(repoId)!);
}

function fallbackLaunchConfig(repoId: string): ProjectLaunchConfig | null {
  return fallbackSettings.projectLaunchConfigs[repoId] ?? {
    command: repoId === "LiliaGithub" ? "yarn tauri:dev" : "yarn dev",
    cwd: null,
    source: "inferred",
    updatedAt: null,
  };
}

function fallbackPackageManagerName(field: unknown): "yarn" | "pnpm" | "npm" {
  if (typeof field === "string") {
    const name = field.split("@")[0]?.trim();
    if (name === "yarn" || name === "pnpm" || name === "npm") {
      return name;
    }
  }
  return "npm";
}

function fallbackPackageScriptCommand(packageManager: "yarn" | "pnpm" | "npm", script: string) {
  return packageManager === "npm" ? `npm run ${script}` : `${packageManager} ${script}`;
}

function fallbackRootScriptRank(script: string) {
  const index = ROOT_SCRIPT_PRIORITY.indexOf(script as typeof ROOT_SCRIPT_PRIORITY[number]);
  return index === -1 ? ROOT_SCRIPT_PRIORITY.length : index;
}

function createLiliaGithubLaunchCandidates(): ProjectLaunchCandidate[] {
  const scripts = packageJson.scripts;
  if (!scripts || typeof scripts !== "object") {
    return [];
  }
  const packageManager = fallbackPackageManagerName(packageJson.packageManager);
  return Object.keys(scripts)
    .sort((left, right) => fallbackRootScriptRank(left) - fallbackRootScriptRank(right) || left.localeCompare(right))
    .map((script) => ({
      command: fallbackPackageScriptCommand(packageManager, script),
      label: script,
      hint: "package.json script",
      kind: "package",
      cwd: null,
    }));
}

function fallbackLaunchCandidates(repoId: string): ProjectLaunchCandidate[] {
  const config = fallbackLaunchConfig(repoId);
  const command = config?.command.trim();
  const base = repoId === "LiliaGithub"
    ? createLiliaGithubLaunchCandidates()
    : [
        { command: "yarn dev", label: "dev", hint: "package.json script", kind: "package", cwd: null },
        { command: "cargo run", label: "cargo run", hint: "Cargo.toml", kind: "cargo", cwd: null },
      ];
  if (!command || base.some((candidate) => candidate.command === command && candidate.cwd === (config?.cwd ?? null))) {
    return base;
  }
  return [{
    command,
    label: "当前指令",
    hint: config?.cwd ? config.cwd : null,
    kind: "current",
    cwd: config?.cwd ?? null,
  }, ...base];
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

function pushFallbackLaunchLog(
  repoId: string,
  stream: ProjectLaunchLog["stream"],
  line: string,
  writeMode: ProjectLaunchLog["writeMode"] = "append",
) {
  fallbackLaunchLogs[repoId] = [
    ...(fallbackLaunchLogs[repoId] ?? []),
    {
      index: fallbackLaunchLogIndex++,
      repoId,
      stream,
      line,
      writeMode,
      timestamp: Date.now(),
    },
  ].slice(-500);
}

function rememberFallbackLaunchStart(repoId: string, config: ProjectLaunchConfig) {
  const entry: ProjectLaunchHistoryEntry = {
    id: `${repoId}:${Date.now()}:${fallbackLaunchLogIndex}`,
    repoId,
    command: config.command,
    cwd: config.cwd,
    startedAt: Date.now(),
    finishedAt: null,
    state: "running",
    exitCode: null,
    error: null,
    lastOutput: null,
  };
  fallbackLaunchHistory[repoId] = [entry, ...(fallbackLaunchHistory[repoId] ?? [])].slice(0, 20);
  return entry;
}

function finishFallbackLaunchHistory(repoId: string, status: ProjectLaunchStatus) {
  const current = fallbackLaunchHistory[repoId]?.[0];
  if (!current || current.state !== "running") return;
  const logs = fallbackLaunchLogs[repoId] ?? [];
  const lastOutput = logs.length ? logs[logs.length - 1].line : null;
  fallbackLaunchHistory[repoId] = [
    {
      ...current,
      state: status.state,
      finishedAt: Date.now(),
      exitCode: status.exitCode,
      error: status.error,
      lastOutput,
    },
    ...(fallbackLaunchHistory[repoId] ?? []).slice(1),
  ];
}

export function getRepoDetail(repoId: string): Promise<RepoDetail> {
  return call("repo_get_detail", { repoId }, () => {
    const override = fallbackRepoDetailOverride?.(repoId);
    if (override) return override;
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
      commits: useDefaultFallback
        ? [
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
          ]
        : [
            {
              hash: "d1e2f3a4b5c6d7e8",
              shortHash: "d1e2f3a",
              author: "Sena",
              authorEmail: "sena@example.com",
              timestamp: 1_781_990_000,
              subject: "更新 README 展示截图",
              parents: ["c0ffee1234567890"],
              refs: ["HEAD -> codex/readme-gallery", "origin/codex/readme-gallery"],
            },
            {
              hash: "c0ffee1234567890",
              shortHash: "c0ffee1",
              author: "Sena",
              authorEmail: "sena@example.com",
              timestamp: 1_781_920_000,
              subject: "加入仓库详情页项目视图",
              parents: [],
              refs: [],
            },
          ],
      branches: [
        ...syncFallbackRepoBranchState(repoId).map(cloneBranchSummary),
      ],
      conflicts,
    };
  });
}

export async function refreshRepoDetailPatch(
  repoId: string,
  request: RepoDetailPatchRequest = {},
): Promise<RepoDetailPatch> {
  return call("repo_refresh_detail_patch", { repoId, request }, async () => {
    const detail = await getRepoDetail(repoId);
    return {
      summary: detail.summary,
      changes: detail.changes,
      conflicts: detail.conflicts,
      commits: request.includeCommits ? detail.commits : null,
      branches: request.includeBranches ? detail.branches : null,
    };
  });
}

export function refreshRepoLanguageStats(repoId: string): Promise<RepoSummary> {
  return call("repo_refresh_language_stats", { repoId }, () => {
    const repo = fallbackRepo(repoId);
    return updateFallbackRepo({
      ...repo,
      languageStats: repo.languageStats.length ? repo.languageStats : [{ language: "TypeScript", bytes: 1000, lines: 40 }],
      languageStatsUpdatedAt: Date.now(),
    });
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
      timestamp: detail.lastCommitAt ?? 1_781_990_000,
      subject: "更新 README 展示截图",
      body: "准备演示数据和 README 图片展示区。",
      parents: ["c0ffee1234567890"],
      refs: ["HEAD -> codex/readme-gallery", "origin/codex/readme-gallery"],
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

export function listRepoLaunchCandidates(repoId: string): Promise<ProjectLaunchCandidate[]> {
  return call("repo_list_launch_candidates", { repoId }, () =>
    fallbackLaunchCandidatesOverride?.[repoId]?.map((candidate) => ({ ...candidate })) ?? fallbackLaunchCandidates(repoId),
  );
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

export function listRepoLaunchHistory(repoId: string): Promise<ProjectLaunchHistoryEntry[]> {
  return call("repo_list_launch_history", { repoId }, () =>
    (fallbackLaunchHistory[repoId] ?? []).map((entry) => ({ ...entry })),
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
    rememberFallbackLaunchStart(repoId, config);
    pushFallbackLaunchLog(repoId, "system", `启动命令：${config.command}`);
    pushFallbackLaunchLog(repoId, "stdout", "开发服务已启动");
    return status;
  });
}

export function stopRepoLaunch(repoId: string): Promise<ProjectLaunchStatus> {
  return call("repo_stop_launch", { repoId }, () => {
    if (fallbackStopLaunchOverride) {
      return fallbackStopLaunchOverride(repoId);
    }
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
      finishFallbackLaunchHistory(repoId, status);
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

export function discardFiles(repoId: string, files: string[]): Promise<RepoSummary> {
  return call("repo_discard_files", { repoId, files }, () => fallbackRepo(repoId));
}

export function addFilesToGitignore(repoId: string, files: string[]): Promise<RepoSummary> {
  return call("repo_add_files_to_gitignore", { repoId, files }, () => fallbackRepo(repoId));
}

export function commitRepo(
  repoId: string,
  files: string[],
  message: string,
  pushAfter: boolean,
): Promise<RepoCommitResult> {
  return call("repo_commit", { repoId, files, message, pushAfter }, () => {
    const repo = fallbackRepo(repoId);
    const committed = updateFallbackRepo({
      ...repo,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      ahead: repo.ahead + 1,
      remotesNeedingPush: Math.max(1, repo.remotesNeedingPush),
    });
    const pushResult = pushAfter ? fallbackPushOperationResult(repoId) : null;
    return {
      summary: pushResult?.summary ?? committed,
      pushResult,
    };
  });
}

function fallbackOperationStatus(steps: RepoRemoteOperationStep[], conflicts: RepoConflictState) {
  if (conflicts.files.length || steps.some((step) => step.status === "conflicts")) return "conflicts" as const;
  const failures = steps.filter((step) => step.status === "error").length;
  if (!failures) return "success" as const;
  return failures < steps.length ? "partial" as const : "error" as const;
}

function fallbackSyncOperationResult(
  summary: RepoSummary,
  steps: RepoRemoteOperationStep[],
  conflicts: RepoConflictState = { operation: "none", files: [], allResolved: true },
): RepoSyncOperationResult {
  const status = fallbackOperationStatus(steps, conflicts);
  const message = status === "success"
    ? "完成"
    : status === "partial"
      ? "部分远端操作失败"
      : status === "conflicts"
        ? "合并产生冲突，请处理后继续"
        : "远端操作失败";
  return { status, message, summary: cloneRepoSummary(summary), conflicts, steps };
}

function fallbackSyncErrorResult(summary: RepoSummary, message: string): RepoSyncOperationResult {
  return {
    status: "error",
    message,
    summary: cloneRepoSummary(summary),
    conflicts: { operation: "none", files: [], allResolved: true },
    steps: [],
  };
}

function primaryFirstRemotes(primary: string, remotes: readonly string[]) {
  const unique = [...new Set(remotes)];
  return [
    ...(unique.includes(primary) ? [primary] : []),
    ...unique.filter((remote) => remote !== primary).sort(),
  ];
}

function fallbackRemoteState(repo: RepoSummary, remote: string) {
  return repo.remoteBranchStates.find((state) => state.remote === remote) ?? null;
}

function fallbackPullOperationResult(
  repoId: string,
  localChangesMode: RepoPullLocalChangesMode,
): RepoSyncOperationResult {
  const repo = fallbackRepo(repoId);
  const config = fallbackRemoteSyncConfig(repoId);
  if (config.validationErrors.length) {
    return fallbackSyncErrorResult(repo, config.validationErrors.join("；"));
  }
  const orderedRemotes = primaryFirstRemotes(
    config.resolvedPolicy.primaryRemote,
    config.resolvedPolicy.pullRemotes,
  );
  const fetchSteps = orderedRemotes.map<RepoRemoteOperationStep>((remote) => {
    const error = fallbackRemoteOperationErrorOverride?.(repoId, remote, "fetch") ?? null;
    return {
      remote,
      operation: "fetch",
      status: error ? "error" : "success",
      message: error ?? "获取完成",
      targetBranch: repo.currentBranch,
    };
  });
  if (fetchSteps.some((step) => step.status === "error")) {
    return fallbackSyncOperationResult(repo, fetchSteps);
  }

  const steps = [...fetchSteps];
  let conflicts: RepoConflictState = { operation: "none", files: [], allResolved: true };
  for (const remote of orderedRemotes) {
    const remoteState = fallbackRemoteState(repo, remote);
    if (remoteState && !remoteState.exists) {
      steps.push({
        remote,
        operation: "merge",
        status: "skipped",
        message: "远端不存在当前同名分支",
        targetBranch: repo.currentBranch,
      });
      continue;
    }
    const error = fallbackRemoteOperationErrorOverride?.(repoId, remote, "merge") ?? null;
    if (error) {
      steps.push({ remote, operation: "merge", status: "error", message: error, targetBranch: repo.currentBranch });
      break;
    }
    const nextConflicts = fallbackConflictState(repoId);
    if (nextConflicts.files.length) {
      conflicts = nextConflicts;
      steps.push({
        remote,
        operation: "merge",
        status: "conflicts",
        message: "合并产生冲突",
        targetBranch: repo.currentBranch,
      });
      break;
    }
    steps.push({ remote, operation: "merge", status: "success", message: "合并完成", targetBranch: repo.currentBranch });
  }
  const completed = !conflicts.files.length && !steps.some((step) => step.status === "error");
  const summary = completed
    ? updateFallbackRepo({
        ...repo,
        behind: 0,
        remoteBranchStates: repo.remoteBranchStates.map((state) => ({ ...state, behind: 0, needsPull: false })),
        remotesNeedingPull: 0,
        stagedCount: localChangesMode === "discard" ? 0 : repo.stagedCount,
        unstagedCount: localChangesMode === "discard" ? 0 : repo.unstagedCount,
        untrackedCount: localChangesMode === "discard" ? 0 : repo.untrackedCount,
      })
    : repo;
  return fallbackSyncOperationResult(summary, steps, conflicts);
}

export function pullRepo(
  repoId: string,
  localChangesMode: RepoPullLocalChangesMode = "reject",
): Promise<RepoSyncOperationResult> {
  return call("repo_pull", { repoId, localChangesMode }, () => fallbackPullOperationResult(repoId, localChangesMode));
}

export function mergePullRepo(
  repoId: string,
  localChangesMode: RepoPullLocalChangesMode = "reject",
): Promise<RepoSyncOperationResult> {
  return call("repo_merge_pull", { repoId, localChangesMode }, () => fallbackPullOperationResult(repoId, localChangesMode));
}

export function mergeBranch(repoId: string, branch: string): Promise<RepoMergePullResult> {
  return call("repo_merge_branch", { repoId, branch }, () => {
    const repo = fallbackRepo(repoId);
    const target = branch.trim();
    if (!target) throw new Error("分支名不能为空");
    if (target === repo.currentBranch) throw new Error("不能合并当前分支");
    const conflicts = fallbackConflictState(repoId);
    return {
      status: conflicts.files.length ? "conflicts" : "success",
      message: conflicts.files.length ? "合并产生冲突，请处理后提交" : "合并完成",
      summary: { ...repo },
      conflicts,
    };
  });
}

function fallbackOperationResult(
  repoId: string,
  message: string,
  summaryOverride?: Partial<RepoSummary>,
): RepoOperationResult {
  const repo = fallbackRepo(repoId);
  const conflicts = fallbackConflictState(repoId);
  return {
    status: conflicts.files.length ? "conflicts" : "success",
    message: conflicts.files.length ? `${message}，请处理后继续` : message,
    summary: { ...repo, ...summaryOverride },
    conflicts,
  };
}

export function fetchRepo(repoId: string): Promise<RepoSyncOperationResult> {
  return call("repo_fetch", { repoId }, () => {
    const repo = fallbackRepo(repoId);
    const config = fallbackRemoteSyncConfig(repoId);
    const steps = config.resolvedPolicy.pullRemotes.map<RepoRemoteOperationStep>((remote) => {
      const error = fallbackRemoteOperationErrorOverride?.(repoId, remote, "fetch") ?? null;
      return { remote, operation: "fetch", status: error ? "error" : "success", message: error ?? "获取完成" };
    });
    return fallbackSyncOperationResult(repo, steps);
  });
}

export function startRebaseRepo(
  repoId: string,
  ontoRef?: string | null,
  localChangesMode: RepoPullLocalChangesMode = "reject",
): Promise<RepoOperationResult> {
  return call("repo_start_rebase", { repoId, ontoRef: ontoRef ?? null, localChangesMode }, () =>
    fallbackOperationResult(
      repoId,
      "rebase 完成",
      localChangesMode === "discard" ? { stagedCount: 0, unstagedCount: 0, untrackedCount: 0 } : undefined,
    ),
  );
}

function fallbackPushOperationResult(
  repoId: string,
  remoteNames?: string[] | null,
  branchName?: string | null,
): RepoSyncOperationResult {
  const repo = fallbackRepo(repoId);
  const config = fallbackRemoteSyncConfig(repoId);
  if (config.validationErrors.length) {
    return fallbackSyncErrorResult(repo, config.validationErrors.join("；"));
  }
  const knownRemotes = new Set(config.remotes.map((remote) => remote.name));
  const selected = remoteNames == null ? config.resolvedPolicy.pushRemotes : Array.from(new Set(remoteNames));
  const unknown = selected.find((remote) => !knownRemotes.has(remote));
  if (unknown) throw new Error(`远端不存在：${unknown}`);
  if (!selected.length) {
    return fallbackSyncErrorResult(repo, "未配置推送目标");
  }
  const ordered = primaryFirstRemotes(config.resolvedPolicy.primaryRemote, selected);
  const successfulRemotes = new Set<string>();
  const steps = ordered.map<RepoRemoteOperationStep>((remote) => {
    const error = fallbackRemoteOperationErrorOverride?.(repoId, remote, "push") ?? null;
    if (!error) successfulRemotes.add(remote);
    return {
      remote,
      operation: "push",
      status: error ? "error" : "success",
      message: error ?? "推送完成",
      targetBranch: branchName?.trim() || repo.currentBranch,
    };
  });
  if (successfulRemotes.size) {
    const localBranchName = branchName?.trim() || repo.currentBranch?.trim();
    if (localBranchName) {
      const branches = syncFallbackRepoBranchState(repoId);
      const localBranch = branches.find((branch) => !branch.remote && branch.name === localBranchName);
      const upstreamRemote = ordered.find((remote) => successfulRemotes.has(remote));
      if (localBranch && upstreamRemote && !localBranch.upstream) {
        localBranch.upstream = `${upstreamRemote}/${localBranchName}`;
      }
      for (const remote of successfulRemotes) {
        const remoteBranch = `${remote}/${localBranchName}`;
        if (!branches.some((branch) => branch.remote && branch.name === remoteBranch)) {
          branches.push(buildBranchSummary({ name: remoteBranch, remote: true, tipTimestamp: repo.lastCommitAt }));
        }
      }
      fallbackRepoBranches[repoId] = branches;
    }
  }
  const remoteBranchStates = repo.remoteBranchStates.map((state) =>
    successfulRemotes.has(state.remote) ? { ...state, ahead: 0, needsPush: false } : { ...state }
  );
  const summary = successfulRemotes.size
    ? updateFallbackRepo({
        ...repo,
        ahead: successfulRemotes.has(config.resolvedPolicy.primaryRemote) ? 0 : repo.ahead,
        remoteBranchStates,
        remotesNeedingPush: remoteBranchStates.filter((state) => state.needsPush).length,
      })
    : repo;
  return fallbackSyncOperationResult(summary, steps);
}

export function pushRepo(repoId: string, remoteNames?: string[] | null): Promise<RepoSyncOperationResult> {
  return call("repo_push", { repoId, remoteNames: remoteNames ?? null }, () =>
    fallbackPushOperationResult(repoId, remoteNames)
  );
}

export function pushNewBranchRepo(
  repoId: string,
  remoteNames?: string[] | null,
  branchName?: string | null,
): Promise<RepoSyncOperationResult> {
  return call("repo_push_new_branch", { repoId, remoteNames: remoteNames ?? null, branchName: branchName ?? null }, () =>
    fallbackPushOperationResult(repoId, remoteNames, branchName)
  );
}

export function pushRepoWithSystemGit(
  repoId: string,
  remoteNames?: string[] | null,
): Promise<RepoSyncOperationResult> {
  return call("repo_push_with_system_git", { repoId, remoteNames: remoteNames ?? null }, () => {
    if (!fallbackSettings.systemGitRepoIds.includes(repoId)) {
      fallbackSettings.systemGitRepoIds = [...fallbackSettings.systemGitRepoIds, repoId].sort();
    }
    return fallbackPushOperationResult(repoId, remoteNames);
  });
}

export function useDefaultTokenAuthForRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("repo_use_default_token_auth", { repoId }, () => {
    fallbackSettings.systemGitRepoIds = fallbackSettings.systemGitRepoIds.filter((id) => id !== repoId);
    return visibleFallbackSettings();
  });
}

export function checkoutBranch(repoId: string, branch: string): Promise<RepoSummary> {
  return call("repo_checkout_branch", { repoId, branch }, () => {
    const repo = fallbackRepo(repoId);
    const target = branch.trim();
    if (!target) throw new Error("分支名不能为空");
    const branches = syncFallbackRepoBranchState(repoId);
    const remoteBranch = branches.find((item) => item.remote && item.name === target);
    const localTarget = remoteBranch ? fallbackLocalBranchName(target) : target;
    if (remoteBranch && !branches.some((item) => !item.remote && item.name === localTarget)) {
      branches.push(buildBranchSummary({
        name: localTarget,
        upstream: target,
        tipTimestamp: remoteBranch.tipTimestamp,
      }));
      fallbackRepoBranches[repoId] = branches.map(cloneBranchSummary);
    }
    return updateFallbackRepo({ ...repo, currentBranch: localTarget });
  });
}

export function createBranch(
  repoId: string,
  name: string,
  fromRef: string,
  checkoutAfter: boolean,
): Promise<RepoSummary> {
  return call("repo_create_branch", { repoId, name, fromRef, checkoutAfter }, () => {
    const repo = fallbackRepo(repoId);
    const branchName = name.trim();
    const sourceRef = fromRef.trim();
    if (!branchName) throw new Error("分支名不能为空");
    if (!sourceRef) throw new Error("基准分支不能为空");
    const branches = syncFallbackRepoBranchState(repoId);
    if (branches.some((branch) => !branch.remote && branch.name === branchName)) {
      throw new Error(`本地分支已存在：${branchName}`);
    }
    const source = branches.find((branch) => branch.name === sourceRef);
    branches.push(buildBranchSummary({
      name: branchName,
      upstream: source?.remote ? source.name : null,
      tipTimestamp: source?.tipTimestamp ?? repo.lastCommitAt,
    }));
    fallbackRepoBranches[repoId] = branches.map(cloneBranchSummary);
    return updateFallbackRepo({
      ...repo,
      currentBranch: checkoutAfter ? branchName : repo.currentBranch,
    });
  });
}

export function renameBranch(repoId: string, oldName: string, newName: string): Promise<RepoSummary> {
  return call("repo_rename_branch", { repoId, oldName, newName }, () => {
    const repo = fallbackRepo(repoId);
    const from = oldName.trim();
    const to = newName.trim();
    if (!from || !to) throw new Error("分支名不能为空");
    const branches = syncFallbackRepoBranchState(repoId);
    const target = branches.find((branch) => !branch.remote && branch.name === from);
    if (!target) throw new Error(`未找到本地分支：${from}`);
    if (branches.some((branch) => !branch.remote && branch.name === to)) {
      throw new Error(`本地分支已存在：${to}`);
    }
    target.name = to;
    fallbackRepoBranches[repoId] = branches.map(cloneBranchSummary);
    return updateFallbackRepo({
      ...repo,
      currentBranch: repo.currentBranch === from ? to : repo.currentBranch,
    });
  });
}

export function deleteBranch(repoId: string, branch: string): Promise<RepoSummary> {
  return call("repo_delete_branch", { repoId, branch }, () => {
    const repo = fallbackRepo(repoId);
    const target = branch.trim();
    if (!target) throw new Error("分支名不能为空");
    if (target === repo.currentBranch) throw new Error("不能删除当前分支");
    const branches = syncFallbackRepoBranchState(repoId);
    fallbackRepoBranches[repoId] = branches.filter((item) => item.remote || item.name !== target).map(cloneBranchSummary);
    return { ...repo };
  });
}

export function setBranchUpstream(repoId: string, branch: string, upstream: string): Promise<RepoSummary> {
  return call("repo_set_upstream", { repoId, branch, upstream }, () => {
    const branchName = branch.trim();
    const upstreamName = upstream.trim();
    if (!branchName || !upstreamName) throw new Error("分支名和 upstream 不能为空");
    fallbackRepoBranches[repoId] = syncFallbackRepoBranchState(repoId).map((item) =>
      !item.remote && item.name === branchName ? { ...item, upstream: upstreamName } : item
    );
    return fallbackRepo(repoId);
  });
}

export function listRepoStashes(repoId: string): Promise<RepoStashEntry[]> {
  return call("repo_list_stashes", { repoId }, () => [...(fallbackRepoStashes[repoId] ?? [])].map(cloneRepoStashEntry));
}

export function getRepoStashDetail(repoId: string, stashId: string): Promise<RepoStashDetail> {
  return call("repo_get_stash_detail", { repoId, stashId }, () => {
    const entry = (fallbackRepoStashes[repoId] ?? []).find((item) => item.id === stashId);
    if (!entry) throw new Error("stash 不存在");
    return {
      entry: cloneRepoStashEntry(entry),
      files: fallbackRepoStashFiles(entry).map(cloneCommitFileChange),
    };
  });
}

export function saveRepoStash(repoId: string, message?: string | null): Promise<RepoSummary> {
  return call("repo_stash_save", { repoId, message: message ?? null }, () => {
    const repo = fallbackRepo(repoId);
    const existing = (fallbackRepoStashes[repoId] ?? []).map((entry, index) => ({
      ...entry,
      index: index + 1,
      id: `stash@{${index + 1}}`,
    }));
    fallbackRepoStashes[repoId] = [{
      id: "stash@{0}",
      index: 0,
      branch: repo.currentBranch,
      message: message?.trim() || `On ${repo.currentBranch ?? "detached"}: 工作区暂存`,
    }, ...existing];
    return { ...repo, stagedCount: 0, unstagedCount: 0, untrackedCount: 0 };
  });
}

function fallbackRepoStashFiles(entry: RepoStashEntry): CommitFileChange[] {
  const escapedMessage = entry.message.replace(/"/g, "\\\"");
  const patch = `diff --git a/src/pages/RepoDetail.vue b/src/pages/RepoDetail.vue
index 1111111..2222222 100644
--- a/src/pages/RepoDetail.vue
+++ b/src/pages/RepoDetail.vue
@@ -1,3 +1,4 @@
 <script setup lang="ts">
-import { History } from "@lucide/vue";
+import { History, Archive } from "@lucide/vue";
+const stashMessage = "${escapedMessage}";
 </script>`;
  return [{
    path: "src/pages/RepoDetail.vue",
    oldPath: null,
    status: "modified",
    additions: 2,
    deletions: 1,
    patch,
    hunks: [{
      header: "@@ -1,3 +1,4 @@",
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4,
      lines: [
        { kind: "context", content: "<script setup lang=\"ts\">", oldLine: 1, newLine: 1 },
        { kind: "deleted", content: "import { History } from \"@lucide/vue\";", oldLine: 2, newLine: null },
        { kind: "added", content: "import { History, Archive } from \"@lucide/vue\";", oldLine: null, newLine: 2 },
        { kind: "added", content: `const stashMessage = "${escapedMessage}";`, oldLine: null, newLine: 3 },
        { kind: "context", content: "</script>", oldLine: 3, newLine: 4 },
      ],
    }],
  }];
}

export function applyRepoStash(repoId: string, stashId: string): Promise<RepoOperationResult> {
  return call("repo_stash_apply", { repoId, stashId }, () => fallbackOperationResult(repoId, "stash 已应用"));
}

export function popRepoStash(repoId: string, stashId: string): Promise<RepoOperationResult> {
  return call("repo_stash_pop", { repoId, stashId }, () => {
    fallbackRepoStashes[repoId] = (fallbackRepoStashes[repoId] ?? [])
      .filter((entry) => entry.id !== stashId)
      .map((entry, index) => ({ ...entry, index, id: `stash@{${index}}` }));
    return fallbackOperationResult(repoId, "stash 已弹出");
  });
}

export function dropRepoStash(repoId: string, stashId: string): Promise<RepoStashEntry[]> {
  return call("repo_stash_drop", { repoId, stashId }, () => {
    fallbackRepoStashes[repoId] = (fallbackRepoStashes[repoId] ?? [])
      .filter((entry) => entry.id !== stashId)
      .map((entry, index) => ({ ...entry, index, id: `stash@{${index}}` }));
    return [...(fallbackRepoStashes[repoId] ?? [])].map(cloneRepoStashEntry);
  });
}

export function listRepoRemotes(repoId: string): Promise<RepoRemote[]> {
  return call("repo_list_remotes", { repoId }, () => [...(fallbackRepoRemotes[repoId] ?? [])].map(cloneRepoRemote));
}

function fallbackResolvedRemoteSyncPolicy(repoId: string): RepoRemoteSyncPolicy {
  const configured = fallbackSettings.repoRemoteSyncPolicies[repoId];
  if (configured) return cloneRepoRemoteSyncPolicy(configured);
  const remotes = fallbackRepoRemotes[repoId] ?? [];
  const primary = remotes.find((remote) => remote.current)?.name
    ?? remotes.find((remote) => remote.name === "origin")?.name
    ?? (remotes.length === 1 ? remotes[0]?.name : null)
    ?? "";
  return {
    primaryRemote: primary,
    pullRemotes: primary ? [primary] : [],
    pushRemotes: primary ? [primary] : [],
  };
}

function fallbackRemotePolicyValidationErrors(repoId: string, policy: RepoRemoteSyncPolicy) {
  const remoteNames = new Set((fallbackRepoRemotes[repoId] ?? []).map((remote) => remote.name));
  const errors: string[] = [];
  if (!remoteNames.has(policy.primaryRemote)) errors.push(`主远端不存在：${policy.primaryRemote || "未选择"}`);
  if (!policy.pullRemotes.includes(policy.primaryRemote)) errors.push("主远端必须属于拉取源");
  for (const remote of [...policy.pullRemotes, ...policy.pushRemotes]) {
    if (!remoteNames.has(remote)) errors.push(`远端不存在：${remote}`);
  }
  return Array.from(new Set(errors));
}

function fallbackRemoteSyncConfig(repoId: string): RepoRemoteSyncConfig {
  const configured = fallbackSettings.repoRemoteSyncPolicies[repoId] ?? null;
  const resolvedPolicy = fallbackResolvedRemoteSyncPolicy(repoId);
  return {
    remotes: (fallbackRepoRemotes[repoId] ?? []).map(cloneRepoRemote),
    policy: configured ? cloneRepoRemoteSyncPolicy(configured) : null,
    resolvedPolicy,
    validationErrors: fallbackRemotePolicyValidationErrors(repoId, resolvedPolicy),
  };
}

export function getRepoRemoteSyncConfig(repoId: string): Promise<RepoRemoteSyncConfig> {
  return call("repo_get_remote_sync_config", { repoId }, () => fallbackRemoteSyncConfig(repoId));
}

export function setRepoRemoteSyncPolicy(
  repoId: string,
  policy: RepoRemoteSyncPolicy,
): Promise<RepoRemoteSyncConfig> {
  return call("repo_set_remote_sync_policy", { repoId, policy }, () => {
    const normalized: RepoRemoteSyncPolicy = {
      primaryRemote: policy.primaryRemote.trim(),
      pullRemotes: Array.from(new Set(policy.pullRemotes.map((remote) => remote.trim()).filter(Boolean))),
      pushRemotes: Array.from(new Set(policy.pushRemotes.map((remote) => remote.trim()).filter(Boolean))),
    };
    const errors = fallbackRemotePolicyValidationErrors(repoId, normalized);
    if (errors.length) throw new Error(errors.join("；"));
    fallbackSettings = {
      ...fallbackSettings,
      repoRemoteSyncPolicies: withRepoRemoteSyncPolicy(
        fallbackSettings.repoRemoteSyncPolicies,
        repoId,
        normalized,
      ),
    };
    return fallbackRemoteSyncConfig(repoId);
  });
}

export function cherryPickRepoCommit(repoId: string, hash: string): Promise<RepoOperationResult> {
  return call("repo_cherry_pick_commit", { repoId, hash }, () => fallbackOperationResult(repoId, "cherry-pick 完成"));
}

export function revertRepoCommit(repoId: string, hash: string): Promise<RepoOperationResult> {
  return call("repo_revert_commit", { repoId, hash }, () => fallbackOperationResult(repoId, "revert 完成"));
}

export function resetRepoToCommit(
  repoId: string,
  hash: string,
  mode: RepoResetMode = "mixed",
): Promise<RepoSummary> {
  return call("repo_reset_to_commit", { repoId, hash, mode }, () => {
    const repo = fallbackRepo(repoId);
    return { ...repo, stagedCount: 0, unstagedCount: 0, untrackedCount: mode === "soft" ? repo.untrackedCount : 0 };
  });
}

export function getRepoConflicts(repoId: string): Promise<RepoConflictState> {
  return call("repo_get_conflicts", { repoId }, () => fallbackConflictState(repoId));
}

function resolveFallbackConflictFile(repoId: string, path: string, stage: boolean): RepoSummary {
  const conflicts = fallbackConflictState(repoId);
  const files = conflicts.files.filter((file) => file.path !== path);
  if (files.length === conflicts.files.length) {
    throw new Error(`未找到冲突文件：${path}`);
  }
  setFallbackConflictState(repoId, { ...conflicts, files });
  const repo = fallbackRepo(repoId);
  return updateFallbackRepo({
    ...repo,
    conflictCount: files.length,
    stagedCount: repo.stagedCount + (stage ? 1 : 0),
  });
}

function assertFallbackConflictOperation(operation: string, action: "继续" | "终止") {
  if (operation === "none") throw new Error("当前没有进行中的冲突操作");
  if (!["merge", "rebase", "cherry-pick"].includes(operation)) {
    throw new Error(`不支持${action} ${operation} 冲突`);
  }
}

function finishFallbackConflictOperation(repoId: string): RepoSummary {
  setFallbackConflictState(repoId, emptyConflictState());
  const repo = fallbackRepo(repoId);
  return updateFallbackRepo({ ...repo, conflictCount: 0 });
}

export function acceptConflictFile(
  repoId: string,
  path: string,
  side: "ours" | "theirs",
  stage = true,
): Promise<RepoSummary> {
  return call("repo_accept_conflict_file", { repoId, path, side, stage }, () =>
    resolveFallbackConflictFile(repoId, path, stage),
  );
}

export function resolveConflictFile(
  repoId: string,
  path: string,
  choices: RepoConflictChoice[],
  stage = true,
): Promise<RepoSummary> {
  return call("repo_resolve_conflict_file", { repoId, path, choices, stage }, () =>
    resolveFallbackConflictFile(repoId, path, stage),
  );
}

export function markFileResolved(repoId: string, path: string): Promise<RepoSummary> {
  return call("repo_mark_file_resolved", { repoId, path }, () => resolveFallbackConflictFile(repoId, path, true));
}

export function abortConflictOperation(repoId: string): Promise<RepoSummary> {
  return call("repo_abort_conflict_operation", { repoId }, () => {
    const conflicts = fallbackConflictState(repoId);
    assertFallbackConflictOperation(conflicts.operation, "终止");
    return finishFallbackConflictOperation(repoId);
  });
}

export function continueConflictOperation(repoId: string): Promise<RepoSummary> {
  return call("repo_continue_conflict_operation", { repoId }, () => {
    const conflicts = fallbackConflictState(repoId);
    if (conflicts.files.length) throw new Error("仍有冲突文件未解决");
    assertFallbackConflictOperation(conflicts.operation, "继续");
    return finishFallbackConflictOperation(repoId);
  });
}

export function bulkSyncPreview(
  operation: BulkOperation,
  repoIds: string[],
  localChangesMode: RepoPullLocalChangesMode = "reject",
): Promise<BulkSyncPreview> {
  const reposToUse = repoIds.length ? repoIds.map(fallbackRepo) : visibleFallbackRepos();
  const needsPull = (repo: RepoSummary) => repo.remotesNeedingPull > 0 || repo.behind > 0;
  const needsPush = (repo: RepoSummary) => repo.remotesNeedingPush > 0 || repo.ahead > 0;
  const hasPushTarget = (repo: RepoSummary) => fallbackRemoteSyncConfig(repo.id).resolvedPolicy.pushRemotes.length > 0;
  return call("bulk_sync_preview", { operation, repoIds, localChangesMode }, () => {
    if (operation === "sync") {
      const needsPublish = new Set(reposToUse.filter(fallbackRepoNeedsPublish).map((repo) => repo.id));
      return {
        operation,
        eligible: reposToUse
          .filter((repo) => repo.currentBranch && repo.conflictCount <= 0 && hasPushTarget(repo))
          .filter((repo) => {
            if (needsPublish.has(repo.id)) return false;
            const dirty = repo.stagedCount + repo.unstagedCount + repo.untrackedCount;
            return (needsPull(repo) && (dirty === 0 || localChangesMode !== "reject")) ||
              (needsPush(repo) && !needsPull(repo));
          })
          .map((repo) => ({
            repo: { ...repo },
            reason: repo.ahead > 0 && repo.behind > 0
              ? repo.stagedCount + repo.unstagedCount + repo.untrackedCount > 0
                ? "需处理本地修改，拉取合并后推送"
                : "需先拉取合并后推送"
              : repo.behind > 0
                ? repo.stagedCount + repo.unstagedCount + repo.untrackedCount > 0
                  ? "需处理本地修改后拉取远端更新"
                  : "可拉取远端更新"
                : "有本地提交待推送",
          })),
        blocked: reposToUse
          .flatMap((repo) => {
            const dirty = repo.stagedCount + repo.unstagedCount + repo.untrackedCount;
            if (!repo.remoteUrl) return [{ repo: { ...repo }, reason: "没有 origin remote" }];
            if (!repo.currentBranch) return [{ repo: { ...repo }, reason: "当前不是命名分支" }];
            if (needsPublish.has(repo.id)) {
              return [{ repo: { ...repo }, reason: "当前分支没有可用的 upstream" }];
            }
            if (repo.behind > 0 && repo.conflictCount > 0) return [{ repo: { ...repo }, reason: "已有冲突需要先处理" }];
            if (repo.behind > 0 && dirty > 0 && localChangesMode === "reject") {
              return [{ repo: { ...repo }, reason: "存在未提交变更" }];
            }
            return [];
          }),
        warnings: reposToUse
          .flatMap((repo) => {
            if (needsPublish.has(repo.id)) return [];
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
      const needsPublish = new Set(reposToUse.filter(fallbackRepoNeedsPublish).map((repo) => repo.id));
      return {
        operation,
        eligible: reposToUse
          .filter((repo) =>
            (needsPush(repo) || needsPublish.has(repo.id)) &&
            !needsPull(repo) &&
            repo.currentBranch &&
            hasPushTarget(repo)
          )
          .map((repo) => ({
            repo: { ...repo },
            reason: needsPublish.has(repo.id) ? "需要发布远端分支" : "有本地提交待推送",
          })),
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
              return [{
                repo: { ...repo },
                reason: needsPublish.has(repo.id)
                  ? "存在未提交变更，但仍可发布远端分支"
                  : "存在未提交变更，但仍可执行 push",
              }];
            }
            if (repo.ahead <= 0 && repo.currentBranch && repo.remoteUrl && !needsPublish.has(repo.id)) {
              return [{ repo: { ...repo }, reason: "没有需要推送的提交" }];
            }
            return [];
          }),
      };
    }
    return {
      operation,
      eligible: reposToUse
        .filter((repo) =>
          needsPull(repo) &&
          (localChangesMode !== "reject" || repo.stagedCount + repo.unstagedCount + repo.untrackedCount <= 0)
        )
        .map((repo) => ({
          repo: { ...repo },
          reason: repo.stagedCount + repo.unstagedCount + repo.untrackedCount > 0
            ? "需处理本地修改后拉取远端更新"
            : "可拉取远端更新",
        })),
      blocked: reposToUse
        .filter((repo) =>
          localChangesMode === "reject" &&
          repo.stagedCount + repo.unstagedCount + repo.untrackedCount > 0
        )
        .map((repo) => ({ repo: { ...repo }, reason: "存在未提交变更" })),
      warnings: reposToUse
        .filter((repo) => !needsPull(repo))
        .map((repo) => ({ repo: { ...repo }, reason: "没有需要拉取的更新" })),
    };
  });
}

export function bulkSyncExecute(
  operation: BulkOperation,
  repoIds: string[],
  localChangesMode: RepoPullLocalChangesMode = "reject",
  trigger: "manual" | "syncAll" | "autoSync" = "manual",
): Promise<BulkSyncResult[]> {
  return call("bulk_sync_execute", { operation, repoIds, localChangesMode, trigger }, async () => {
    const results = await (fallbackBulkExecuteOverride?.(operation, repoIds, localChangesMode) ?? repoIds.map((repoId) => {
      const repo = fallbackRepo(repoId);
      const pullResult = operation === "pull" || operation === "sync"
        ? fallbackPullOperationResult(repoId, localChangesMode)
        : null;
      const pushResult = operation === "push" || (operation === "sync" && pullResult?.status === "success")
        ? fallbackPushOperationResult(repoId)
        : null;
      const operationResult = pushResult ?? pullResult;
      return {
        summary: operationResult?.summary ?? repo,
        repoId,
        status: operationResult?.status ?? "success",
        message: operationResult?.message ?? "完成",
        steps: operationResult?.steps ?? [],
      };
    }));
    return results.map((result) => ({
      ...result,
      summary: result.summary ? updateFallbackRepo(result.summary) : null,
      steps: result.steps ?? [],
    }));
  });
}

export function openPath(path: string): Promise<void> {
  return call("system_open_path", { path }, () => {
    fallbackOpenPathCalls.push(path);
    return undefined;
  });
}

export function openPathTarget(path: string, target: SystemOpenTarget): Promise<void> {
  return call("system_open_path_target", { path, target }, () => {
    fallbackOpenPathTargetCalls.push({ path, target });
    return undefined;
  });
}

export function openUrl(url: string): Promise<void> {
  return call("system_open_url", { url }, () => undefined);
}

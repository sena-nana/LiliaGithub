import packageJson from "../../../package.json";
import type {
  BulkOperation,
  BulkSyncPreview,
  BulkSyncResult,
  BranchSummary,
  CommitDetail,
  CommitFileChange,
  GitHubBindingStatus,
  GitHubContributionMeta,
  GitHubContributionResult,
  GitHubCreateIssueRequest,
  GitHubCreateRepoRequest,
  GitHubDeviceFlowPollResult,
  GitHubDeviceFlowStart,
  GitHubIssue,
  GitHubIssueListOptions,
  GitHubMergePullRequestRequest,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubRepoManagement,
  GitHubRepoOwner,
  GitHubRepoPage,
  GitHubRepoSummary,
  GitHubWorkflowRun,
  GitHubCreatePullRequestRequest,
  GitHubUpdatePullRequestRequest,
  GitHubUpdateIssueRequest,
  GitHubUpdateRepoSettingsRequest,
  HiddenRepo,
  ProjectLaunchConfig,
  ProjectLaunchCandidate,
  ProjectLaunchLog,
  ProjectLaunchStatus,
  RepoConflictChoice,
  RepoConflictState,
  RepoDetail,
  RepoFilePreview,
  RepoFileTreeEntry,
  RepoMergePullResult,
  RepoOperationResult,
  RepoRemote,
  RepoRefreshSummaryOptions,
  RepoReadme,
  RepoResetMode,
  RepoSummary,
  RepoStashEntry,
  RepoStashDetail,
  RemoteRepoShortcut,
  WorkspaceTask,
  WorkspaceSettings,
} from "./types";

const ROOT_SCRIPT_PRIORITY = ["tauri:dev", "dev", "start", "serve", "preview", "docs:dev"] as const;

let fallbackRepos: RepoSummary[] = [
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
      { language: "TypeScript", bytes: 66_000 },
      { language: "Vue", bytes: 42_000 },
      { language: "Rust", bytes: 32_000 },
      { language: "CSS", bytes: 10_000 },
    ],
    workingTreeLanguageStats: [
      { language: "TypeScript", bytes: 68_000 },
      { language: "Vue", bytes: 42_000 },
      { language: "Rust", bytes: 35_000 },
      { language: "CSS", bytes: 10_000 },
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
      { language: "TypeScript", bytes: 52_000 },
      { language: "Vue", bytes: 28_000 },
      { language: "CSS", bytes: 8_000 },
    ],
    workingTreeLanguageStats: [
      { language: "TypeScript", bytes: 52_000 },
      { language: "Vue", bytes: 28_000 },
      { language: "CSS", bytes: 8_000 },
    ],
    languageStatsUpdatedAt: Date.now(),
    worktree: {
      role: "standalone",
      sharedRepoKey: "repo:Lilia",
      mainRepoId: null,
    },
  },
];
const baseFallbackRepos = fallbackRepos.map(cloneRepoSummary);

const defaultFallbackBinding: GitHubBindingStatus = {
  state: "bound",
  clientIdConfigured: true,
  clientIdSource: "bundled",
  binding: {
    login: "lilia-user",
    avatarUrl: null,
    boundAt: Date.now(),
    scopes: ["repo", "workflow", "read:user", "delete_repo"],
    clientIdSource: "bundled",
  },
};

const CONTRIBUTION_DAYS = 371;
const CONTRIBUTION_REPO_LIMIT = 30;
function createFallbackGitHubRepos(): GitHubRepoSummary[] {
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

let fallbackGitHubRepos: GitHubRepoSummary[] = createFallbackGitHubRepos();

function cloneGitHubRepoSummary(repo: GitHubRepoSummary): GitHubRepoSummary {
  return { ...repo };
}

function cloneRepoSummary(repo: RepoSummary): RepoSummary {
  return {
    ...repo,
    languageStats: repo.languageStats.map((stat) => ({ ...stat })),
    workingTreeLanguageStats: repo.workingTreeLanguageStats.map((stat) => ({ ...stat })),
    worktree: { ...repo.worktree },
  };
}

function cloneBranchSummary(branch: BranchSummary): BranchSummary {
  return {
    ...branch,
    checkedOutWorktreePaths: [...branch.checkedOutWorktreePaths],
  };
}

function clonePullRequest(pullRequest: GitHubPullRequest): GitHubPullRequest {
  return { ...pullRequest };
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

function cloneRepoRemote(remote: RepoRemote): RepoRemote {
  return { ...remote };
}

function createFallbackGitHubRepoOwners(): GitHubRepoOwner[] {
  return [
    { login: "lilia-user", kind: "user" },
    { login: "sena-nana", kind: "org" },
  ];
}

function createFallbackGitHubRepoManagement(): Record<string, GitHubRepoManagement> {
  return {
    "sena-nana/LiliaGithub": {
      fullName: "sena-nana/LiliaGithub",
      name: "LiliaGithub",
      description: "Local GitHub workspace manager",
      homepage: "",
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
      htmlUrl: "https://github.com/sena-nana/LiliaGithub",
    },
    "sena-nana/Lilia": {
      fullName: "sena-nana/Lilia",
      name: "Lilia",
      description: "Desktop agent workbench",
      homepage: "",
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
      htmlUrl: "https://github.com/sena-nana/Lilia",
    },
  };
}

function createFallbackGitHubIssues(): Record<string, GitHubIssue[]> {
  return {
    "sena-nana/LiliaGithub": [
      {
        number: 12,
        title: "补齐仓库管理入口",
        state: "open",
        body: "需要在桌面端管理仓库设置和 issue。",
        labels: ["enhancement"],
        assignees: ["lilia-user"],
        htmlUrl: "https://github.com/sena-nana/LiliaGithub/issues/12",
        updatedAt: "2026-06-17T12:00:00Z",
        createdAt: "2026-06-16T12:00:00Z",
      },
    ],
  };
}

function createFallbackGitHubPullRequests(): Record<string, GitHubPullRequest[]> {
  return {
    "sena-nana/LiliaGithub": [
      {
        number: 7,
        title: "补齐 Git 仓库批量操作",
        state: "open",
        draft: false,
        body: "补齐 pull / push / sync / fetch all 基础能力。",
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

function createFallbackGitHubPullRequestChecks(): Record<string, Record<number, GitHubPullRequestCheck[]>> {
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

function createFallbackGitHubWorkflowRuns(): Record<string, GitHubWorkflowRun[]> {
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

function createFallbackGitHubBranches(): Record<string, BranchSummary[]> {
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

function createFallbackRepoStashes(): Record<string, RepoStashEntry[]> {
  return {
    LiliaGithub: [
      { id: "stash@{0}", index: 0, branch: "main", message: "On main: WIP toolbar" },
    ],
  };
}

function createFallbackRepoRemotes(): Record<string, RepoRemote[]> {
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

function createFallbackRepoReadmes(): Record<string, RepoReadme[]> {
  return {
    LiliaGithub: [
      {
        repoId: "LiliaGithub",
        path: "README.md",
        images: {},
        format: "md",
        updatedAt: Date.now(),
        content: [
          "# LiliaGithub",
          "",
          "一个面向本地多仓库管理的 Tauri 2 + Vue 3 + TypeScript 桌面应用。",
          "",
          "## 当前能力",
          "",
          "- 工作区 Git 仓库扫描",
          "- GitHub 仓库管理",
          "- 快速启动配置",
        ].join("\n"),
      },
    ],
    Lilia: [
      {
        repoId: "Lilia",
        path: "README.md",
        images: {},
        format: "md",
        updatedAt: Date.now(),
        content: "# Lilia\n\nDesktop agent workbench.",
      },
    ],
  };
}

function createFallbackGitHubRepoReadmes(): Record<string, RepoReadme[]> {
  return Object.fromEntries(
    Object.entries(createFallbackRepoReadmes()).map(([repoId, readmes]) => {
      const repo = fallbackRepos.find((item) => item.id === repoId);
      return [
        repo?.githubFullName ?? repoId,
        readmes.map((readme) => ({
          ...readme,
          repoId: repo?.githubFullName ? `github:${repo.githubFullName}` : readme.repoId,
          images: { ...readme.images },
        })),
      ];
    }),
  );
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

function createFallbackRepoFilePreviews(): Record<string, Record<string, RepoFilePreview>> {
  return {
    LiliaGithub: {
      "README.md": {
        path: "README.md",
        name: "README.md",
        previewKind: "markdown",
        content: createFallbackRepoReadmes().LiliaGithub[0]?.content ?? "# LiliaGithub",
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
        content: createFallbackRepoReadmes().Lilia[0]?.content ?? "# Lilia",
        images: {},
        size: 32,
        mimeType: "text/markdown",
        truncated: false,
      },
    },
  };
}

let fallbackGitHubRepoOwners = createFallbackGitHubRepoOwners();
let fallbackGitHubRepoManagement = createFallbackGitHubRepoManagement();
let fallbackGitHubIssues = createFallbackGitHubIssues();
let fallbackGitHubPullRequests = createFallbackGitHubPullRequests();
let fallbackGitHubPullRequestChecks = createFallbackGitHubPullRequestChecks();
let fallbackGitHubWorkflowRuns = createFallbackGitHubWorkflowRuns();
let fallbackGitHubBranches = createFallbackGitHubBranches();
let fallbackRepoStashes = createFallbackRepoStashes();
let fallbackRepoRemotes = createFallbackRepoRemotes();
let fallbackRepoBranches = createFallbackRepoBranches();
let fallbackRepoReadmes = createFallbackRepoReadmes();
let fallbackGitHubRepoReadmes = createFallbackGitHubRepoReadmes();
let fallbackRepoFiles = createFallbackRepoFiles();
let fallbackRepoFilePreviews = createFallbackRepoFilePreviews();

type FallbackGitHubIssueListCall = {
  repoFullName: string;
  state: string | null;
  perPage: number | null;
  sort: string | null;
  direction: string | null;
  since: string | null;
};

function createFallbackSettings(): WorkspaceSettings {
  return {
    workspaceRoot: "C:\\Files\\workspace",
    githubBinding: defaultFallbackBinding.binding,
    projectLaunchConfigs: {},
    hiddenRepoIds: [],
    managedRepoIds: fallbackRepos.map((repo) => repo.id),
    systemGitRepoIds: [],
    remoteRepoShortcuts: [],
    localContributionCache: {},
  };
}

let fallbackSettings: WorkspaceSettings = createFallbackSettings();
let fallbackBulkExecuteOverride: ((operation: BulkOperation, repoIds: string[]) => BulkSyncResult[]) | null = null;
let fallbackConflictOverride: ((repoId: string) => RepoConflictState | null) | null = null;
let fallbackRepoContributionOverride: ((repoFullName: string) => GitHubContributionResult) | null = null;
let fallbackGitHubWorkflowRunsOverride:
  ((repoFullName: string, perPage: number | null) => GitHubWorkflowRun[] | Promise<GitHubWorkflowRun[]>) | null = null;
let fallbackRepoRemoteSyncOverride: ((repo: RepoSummary) => string | null) | null = null;
let fallbackRepoDetailOverride: ((repoId: string) => RepoDetail | null) | null = null;
let fallbackBinding = defaultFallbackBinding;
let fallbackGitHubReposError: string | null = null;
let fallbackGitHubRepoPagesOverride: GitHubRepoPage[] | null = null;
let fallbackGitHubIssueListCalls: FallbackGitHubIssueListCall[] = [];
let fallbackGitHubWorkflowRunListCalls: Array<{ repoFullName: string; perPage: number | null }> = [];
let fallbackOpenPathCalls: string[] = [];
let fallbackCloneIndex = 1;
let fallbackClonedRepos: RepoSummary[] = [];
let fallbackRepoOverrides: Record<string, RepoSummary> = {};
let fallbackTaskIndex = 1;
let fallbackTasks: WorkspaceTask[] = [];

const fallbackLaunchStatuses: Record<string, ProjectLaunchStatus> = {};
const fallbackLaunchLogs: Record<string, ProjectLaunchLog[]> = {};
let fallbackLaunchLogIndex = 1;
let fallbackLaunchCandidatesOverride: Record<string, ProjectLaunchCandidate[]> | null = null;
let fallbackStopLaunchOverride: ((repoId: string) => Promise<ProjectLaunchStatus> | ProjectLaunchStatus) | null = null;

export function resetWorkspaceFallbacksForTests() {
  fallbackSettings = createFallbackSettings();
  fallbackBulkExecuteOverride = null;
  fallbackConflictOverride = null;
  fallbackRepoContributionOverride = null;
  fallbackGitHubWorkflowRunsOverride = null;
  fallbackRepoRemoteSyncOverride = null;
  fallbackRepoDetailOverride = null;
  fallbackBinding = defaultFallbackBinding;
  fallbackGitHubReposError = null;
  fallbackGitHubRepoPagesOverride = null;
  fallbackRepos = baseFallbackRepos.map(cloneRepoSummary);
  fallbackGitHubRepos = createFallbackGitHubRepos();
  fallbackGitHubRepoOwners = createFallbackGitHubRepoOwners();
  fallbackGitHubRepoManagement = createFallbackGitHubRepoManagement();
  fallbackGitHubIssues = createFallbackGitHubIssues();
  fallbackGitHubPullRequests = createFallbackGitHubPullRequests();
  fallbackGitHubPullRequestChecks = createFallbackGitHubPullRequestChecks();
  fallbackGitHubWorkflowRuns = createFallbackGitHubWorkflowRuns();
  fallbackGitHubBranches = createFallbackGitHubBranches();
  fallbackRepoStashes = createFallbackRepoStashes();
  fallbackRepoRemotes = createFallbackRepoRemotes();
  fallbackRepoBranches = createFallbackRepoBranches();
  fallbackRepoReadmes = createFallbackRepoReadmes();
  fallbackGitHubRepoReadmes = createFallbackGitHubRepoReadmes();
  fallbackRepoFiles = createFallbackRepoFiles();
  fallbackRepoFilePreviews = createFallbackRepoFilePreviews();
  fallbackGitHubIssueListCalls = [];
  fallbackGitHubWorkflowRunListCalls = [];
  fallbackOpenPathCalls = [];
  fallbackCloneIndex = 1;
  fallbackClonedRepos = [];
  fallbackRepoOverrides = {};
  fallbackTaskIndex = 1;
  fallbackTasks = [];
  for (const key of Object.keys(fallbackLaunchStatuses)) {
    delete fallbackLaunchStatuses[key];
  }
  for (const key of Object.keys(fallbackLaunchLogs)) {
    delete fallbackLaunchLogs[key];
  }
  fallbackLaunchLogIndex = 1;
  fallbackLaunchCandidatesOverride = null;
  fallbackStopLaunchOverride = null;
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

export function setFallbackRepoContributionOverrideForTests(
  override: ((repoFullName: string) => GitHubContributionResult) | null,
) {
  fallbackRepoContributionOverride = override;
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

export function setFallbackRepoDetailOverrideForTests(override: ((repoId: string) => RepoDetail | null) | null) {
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
  fallbackBinding = binding;
  fallbackSettings = {
    ...fallbackSettings,
    githubBinding: binding.binding,
  };
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

export function setFallbackGitHubBranchesForTests(branchesByRepo: Record<string, BranchSummary[]>) {
  fallbackGitHubBranches = Object.fromEntries(
    Object.entries(branchesByRepo).map(([repoFullName, branches]) => [
      repoFullName,
      branches.map(cloneBranchSummary),
    ]),
  );
}

export function getFallbackGitHubIssueListCallsForTests(): FallbackGitHubIssueListCall[] {
  return fallbackGitHubIssueListCalls.map((call) => ({ ...call }));
}

export function getFallbackGitHubWorkflowRunListCallsForTests() {
  return fallbackGitHubWorkflowRunListCalls.map((call) => ({ ...call }));
}

export function getFallbackOpenPathCallsForTests(): string[] {
  return [...fallbackOpenPathCalls];
}

export function setFallbackGitHubIssuesForTests(issuesByRepo: Record<string, GitHubIssue[]>) {
  fallbackGitHubIssues = Object.fromEntries(
    Object.entries(issuesByRepo).map(([repoFullName, issues]) => [
      repoFullName,
      issues.map((issue) => ({ ...issue, labels: [...issue.labels], assignees: [...issue.assignees] })),
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
}

function cloneRepoFileTreeEntry(entry: RepoFileTreeEntry): RepoFileTreeEntry {
  return { ...entry };
}

function cloneRepoReadme(readme: RepoReadme): RepoReadme {
  return {
    ...readme,
    images: { ...readme.images },
  };
}

function cloneRepoFilePreview(preview: RepoFilePreview): RepoFilePreview {
  return {
    ...preview,
    dataUrl: preview.dataUrl ?? null,
    images: preview.images ? { ...preview.images } : {},
  };
}

function cloneRemoteRepoShortcut(shortcut: RemoteRepoShortcut): RemoteRepoShortcut {
  return { ...shortcut };
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
    projectLaunchConfigs: { ...settings.projectLaunchConfigs },
    hiddenRepoIds: [...settings.hiddenRepoIds],
    managedRepoIds: [...settings.managedRepoIds],
    systemGitRepoIds: [...settings.systemGitRepoIds],
    remoteRepoShortcuts: settings.remoteRepoShortcuts.map(cloneRemoteRepoShortcut),
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

export function setFallbackRepoReadmesForTests(readmesByRepo: Record<string, RepoReadme | RepoReadme[] | null>) {
  fallbackRepoReadmes = Object.fromEntries(
    Object.entries(readmesByRepo).map(([repoId, readmes]) => {
      const list = Array.isArray(readmes) ? readmes : readmes ? [readmes] : [];
      return [repoId, list.map(cloneRepoReadme)];
    }),
  );
}

export function setFallbackGitHubRepoReadmesForTests(readmesByRepo: Record<string, RepoReadme | RepoReadme[] | null>) {
  fallbackGitHubRepoReadmes = Object.fromEntries(
    Object.entries(readmesByRepo).map(([repoFullName, readmes]) => {
      const list = Array.isArray(readmes) ? readmes : readmes ? [readmes] : [];
      return [repoFullName, list.map(cloneRepoReadme)];
    }),
  );
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

async function call<T>(_command: string, _args?: Record<string, unknown>, fallback?: () => T | Promise<T>): Promise<T> {
  if (fallback) return fallback();
  throw new Error("Workspace fallback is unavailable for this command");
}

function recordFallbackTask(
  kind: WorkspaceTask["kind"],
  priority: WorkspaceTask["priority"],
  repoId: string | null,
  status: WorkspaceTask["status"],
  message: string | null,
) {
  const task: WorkspaceTask = {
    id: `fallback-task-${fallbackTaskIndex++}`,
    kind,
    priority,
    repoId,
    status,
    message,
    updatedAt: Date.now(),
  };
  fallbackTasks = [task, ...fallbackTasks].slice(0, 200);
  return task;
}

function repoRefreshSuccessMessage(repoCount: number) {
  return `已刷新 ${repoCount} 个仓库并同步远端状态`;
}

function repoRefreshPartialFailureMessage(
  repoCount: number,
  failures: Array<{ repoName: string; error: string }>,
) {
  const repoNames = failures.slice(0, 3).map((failure) => failure.repoName).join("、");
  const repoLabel = failures.length > 3 ? `${repoNames} 等` : repoNames;
  return `已刷新 ${repoCount} 个仓库，${failures.length} 个仓库 fetch 失败：${repoLabel}（${failures[0].error}）`;
}

export function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  return call("workspace_get_settings", undefined, () => cloneWorkspaceSettings(fallbackSettings));
}

export function setWorkspaceRoot(workspaceRoot: string): Promise<WorkspaceSettings> {
  return call("workspace_set_root", { workspaceRoot }, () => {
    fallbackSettings = { ...fallbackSettings, workspaceRoot };
    return cloneWorkspaceSettings(fallbackSettings);
  });
}

export function pickWorkspaceRoot(): Promise<string | null> {
  return call("workspace_pick_root", undefined, () => fallbackSettings.workspaceRoot);
}

export function pickRepo(): Promise<string | null> {
  return call("workspace_pick_repo", undefined, () => allFallbackRepos()[0]?.path ?? null);
}

export function refreshRepos(): Promise<RepoSummary[]> {
  return call("workspace_refresh_repos", undefined, () => {
    const repos = visibleFallbackRepos();
    const failures = repos
      .filter((repo) => repo.remoteUrl)
      .flatMap((repo) => {
        const error = fallbackRepoRemoteSyncOverride?.(repo);
        return error ? [{ repoName: repo.name, error }] : [];
      });
    recordFallbackTask(
      "repoStatus",
      "high",
      null,
      failures.length ? "error" : "success",
      failures.length
        ? repoRefreshPartialFailureMessage(repos.length, failures)
        : repoRefreshSuccessMessage(repos.length),
    );
    return repos;
  });
}

export function listManagedRepos(): Promise<RepoSummary[]> {
  return call("workspace_list_managed_repos", undefined, () =>
    visibleManagedFallbackRepos().map(lightweightRepoSummary),
  );
}

export function discoverRepos(): Promise<RepoSummary[]> {
  return call("workspace_discover_repos", undefined, () => {
    const discovered = visibleFallbackRepos();
    fallbackSettings = {
      ...fallbackSettings,
      managedRepoIds: Array.from(new Set([...fallbackSettings.managedRepoIds, ...discovered.map((repo) => repo.id)])).sort(),
    };
    recordFallbackTask("discoverRepos", "low", null, "success", `发现 ${discovered.length} 个仓库`);
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
    recordFallbackTask("repoStatus", "high", repo.id, "success", "已添加仓库");
    return { ...repo };
  });
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
      languageStats: [],
      workingTreeLanguageStats: [],
      languageStatsUpdatedAt: Date.now(),
      worktree: {
        role: "standalone",
        sharedRepoKey: `repo:${name}`,
        mainRepoId: null,
      },
    };
    fallbackClonedRepos = [...fallbackClonedRepos.filter((item) => item.id !== repo.id), repo];
    fallbackSettings = {
      ...fallbackSettings,
      managedRepoIds: Array.from(new Set([...fallbackSettings.managedRepoIds, repo.id])).sort(),
    };
    return { ...repo };
  });
}

export function getRepoSummary(repoId: string): Promise<RepoSummary> {
  return call("repo_get_summary", { repoId }, () => ({ ...fallbackRepo(repoId) }));
}

export function refreshRepoSummary(
  repoId: string,
  options: RepoRefreshSummaryOptions = {},
): Promise<RepoSummary> {
  return call("repo_refresh_summary", { repoId, options }, () => {
    const repo = fallbackRepo(repoId);
    const error = options.fetchRemote && repo.remoteUrl ? fallbackRepoRemoteSyncOverride?.(repo) : null;
    recordFallbackTask(
      "repoStatus",
      "normal",
      repo.id,
      error ? "error" : "success",
      error ? `仓库状态已刷新，远端同步失败：${error}` : "仓库状态已更新",
    );
    return { ...repo };
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
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictCount: 0,
    lastCommitAt: null,
    lastCommitMessage: null,
    languageStats: [],
    workingTreeLanguageStats: [],
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
      fallbackSettings = {
        ...fallbackSettings,
        hiddenRepoIds: [...fallbackSettings.hiddenRepoIds, repoId].sort(),
        localContributionCache,
      };
    }
    return cloneWorkspaceSettings(fallbackSettings);
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
    fallbackSettings = {
      ...fallbackSettings,
      projectLaunchConfigs,
      managedRepoIds: fallbackSettings.managedRepoIds.filter((id) => id !== repoId),
      hiddenRepoIds: fallbackSettings.hiddenRepoIds.filter((id) => id !== repoId),
      systemGitRepoIds: fallbackSettings.systemGitRepoIds.filter((id) => id !== repoId),
      localContributionCache,
    };
    fallbackRepos = fallbackRepos.filter((item) => item.id !== repoId);
    delete fallbackRepoOverrides[repoId];
    delete fallbackRepoReadmes[repoId];
    delete fallbackLaunchStatuses[repoId];
    delete fallbackLaunchLogs[repoId];
    return cloneWorkspaceSettings(fallbackSettings);
  });
}

function normalizeRemoteRepoShortcut(repo: RemoteRepoShortcut): RemoteRepoShortcut {
  const fullName = repo.fullName.trim().replace(/^\/+|\/+$/g, "");
  const parts = fullName.split("/").filter(Boolean);
  const name = repo.name.trim() || parts[parts.length - 1] || fullName;
  return {
    fullName,
    name,
    private: repo.private,
    archived: repo.archived,
    defaultBranch: repo.defaultBranch?.trim() || null,
    htmlUrl: repo.htmlUrl.trim() || `https://github.com/${fullName}`,
    cloneUrl: repo.cloneUrl.trim() || `https://github.com/${fullName}.git`,
    openedAt: Date.now(),
  };
}

export function rememberRemoteRepo(repo: RemoteRepoShortcut): Promise<WorkspaceSettings> {
  return call("workspace_remember_remote_repo", { repo }, () => {
    const shortcut = normalizeRemoteRepoShortcut(repo);
    const shortcutKey = normalizeRemoteRepoIdKey(shortcut.fullName);
    fallbackSettings = {
      ...fallbackSettings,
      remoteRepoShortcuts: [
        shortcut,
        ...fallbackSettings.remoteRepoShortcuts.filter((item) => {
          const key = normalizeRemoteRepoIdKey(item.fullName);
          return key === null || key !== shortcutKey;
        }),
      ].sort((a, b) => b.openedAt - a.openedAt || a.fullName.localeCompare(b.fullName)),
    };
    return cloneWorkspaceSettings(fallbackSettings);
  });
}

export function forgetRemoteRepo(fullName: string): Promise<WorkspaceSettings> {
  return call("workspace_forget_remote_repo", { fullName }, () => {
    const target = normalizeRemoteRepoIdKey(fullName);
    if (!target) return cloneWorkspaceSettings(fallbackSettings);
    fallbackSettings = {
      ...fallbackSettings,
      remoteRepoShortcuts: fallbackSettings.remoteRepoShortcuts.filter((repo) => {
        const key = normalizeRemoteRepoIdKey(repo.fullName);
        return key === null || key !== target;
      }),
    };
    return cloneWorkspaceSettings(fallbackSettings);
  });
}

export function unhideRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_unhide_repo", { repoId }, () => {
    fallbackSettings = {
      ...fallbackSettings,
      hiddenRepoIds: fallbackSettings.hiddenRepoIds.filter((id) => id !== repoId),
    };
    return cloneWorkspaceSettings(fallbackSettings);
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
    fallbackTasks = fallbackTasks.map((task) =>
      task.id === taskId ? { ...task, status: "cancelled", message: "已取消", updatedAt: Date.now() } : task,
    );
  });
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

export function listGitHubRepos(page?: number | null): Promise<GitHubRepoPage> {
  return call("github_list_repos", { page: page ?? null }, () => {
    if (fallbackGitHubReposError) throw new Error(fallbackGitHubReposError);
    if (fallbackGitHubRepoPagesOverride) {
      const pageIndex = Math.max(0, (page ?? 1) - 1);
      const fallbackPage = fallbackGitHubRepoPagesOverride[pageIndex] ?? { items: [], nextPage: null };
      return {
        items: fallbackPage.items.map(cloneGitHubRepoSummary),
        nextPage: fallbackPage.nextPage,
      };
    }
    return {
      items: fallbackGitHubRepos.map(cloneGitHubRepoSummary),
      nextPage: null,
    };
  });
}

function fallbackRepoManagement(repoFullName: string): GitHubRepoManagement {
  const existing = fallbackGitHubRepoManagement[repoFullName];
  if (existing) return { ...existing };
  const repo = allFallbackGitHubRepos().find((item) => item.fullName === repoFullName);
  if (!repo) throw new Error(`未找到 GitHub 仓库：${repoFullName}`);
  const management: GitHubRepoManagement = {
    fullName: repo.fullName,
    name: repo.name,
    description: repo.description,
    homepage: "",
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
    htmlUrl: repo.htmlUrl,
  };
  fallbackGitHubRepoManagement[repoFullName] = management;
  return { ...management };
}

function allFallbackGitHubRepos() {
  const fromPages = fallbackGitHubRepoPagesOverride?.flatMap((page) => page.items) ?? [];
  const repos = new Map<string, GitHubRepoSummary>();
  for (const repo of [...fallbackGitHubRepos, ...fromPages]) {
    repos.set(repo.fullName, repo);
  }
  return [...repos.values()].map(cloneGitHubRepoSummary);
}

export function listGitHubRepoOwners(): Promise<GitHubRepoOwner[]> {
  return call("github_list_repo_owners", undefined, () => fallbackGitHubRepoOwners.map((owner) => ({ ...owner })));
}

export function createGitHubRepo(request: GitHubCreateRepoRequest): Promise<GitHubRepoSummary> {
  return call("github_create_repo", { request }, () => {
    const owner = request.owner.trim();
    const name = request.name.trim();
    if (!owner || !name) throw new Error("owner 和仓库名不能为空");
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
      defaultBranch: request.autoInit ? "main" : null,
      createdAt: now,
      updatedAt: now,
      cloneUrl: `https://github.com/${fullName}.git`,
      htmlUrl: `https://github.com/${fullName}`,
    };
    fallbackGitHubRepos.push(repo);
    fallbackGitHubRepoManagement[fullName] = {
      fullName,
      name,
      description: repo.description,
      homepage: "",
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
      htmlUrl: repo.htmlUrl,
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
    const updated = {
      ...current,
      ...request,
      description: request.description ?? current.description,
      homepage: request.homepage ?? current.homepage,
    };
    fallbackGitHubRepoManagement[repoFullName] = updated;
    return { ...updated };
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
    delete fallbackGitHubPullRequestChecks[normalized];
    delete fallbackGitHubWorkflowRuns[normalized];
    delete fallbackGitHubBranches[normalized];
    delete fallbackGitHubRepoReadmes[normalized];
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
  });
}

export function listGitHubPullRequests(
  repoFullName: string,
  state: "open" | "closed" | "all" | null = "open",
): Promise<GitHubPullRequest[]> {
  return call("github_list_pull_requests", { repoFullName, state: state ?? null }, () =>
    [...(fallbackGitHubPullRequests[repoFullName] ?? [])]
      .filter((pullRequest) => !state || state === "all" || pullRequest.state === state)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .map(clonePullRequest),
  );
}

export function getGitHubPullRequest(repoFullName: string, pullNumber: number): Promise<GitHubPullRequest> {
  return call("github_get_pull_request", { repoFullName, pullNumber }, () => {
    const current = (fallbackGitHubPullRequests[repoFullName] ?? []).find((pullRequest) => pullRequest.number === pullNumber);
    if (!current) throw new Error(`未找到 Pull Request #${pullNumber}`);
    return clonePullRequest(current);
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
  return call("github_list_pull_request_checks", { repoFullName, pullNumber }, () =>
    [...(fallbackGitHubPullRequestChecks[repoFullName]?.[pullNumber] ?? [])].map(clonePullRequestCheck),
  );
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
  const perPage = Number.isFinite(options.perPage) ? Math.max(1, Math.trunc(options.perPage ?? 0)) : null;
  fallbackGitHubIssueListCalls.push({ repoFullName, state, perPage, sort, direction, since });
  return call("github_list_issues", {
    repoFullName,
    state,
    perPage,
    sort,
    direction,
    since,
  }, () => {
    const sorted = [...(fallbackGitHubIssues[repoFullName] ?? [])]
      .filter((issue) => !state || state === "all" || issue.state === state)
      .filter((issue) => isFallbackGitHubIssueSince(issue, since))
      .sort((a, b) => compareFallbackGitHubIssues(a, b, sort, direction));
    return sorted
      .slice(0, perPage ?? sorted.length)
      .map((issue) => ({ ...issue, labels: [...issue.labels], assignees: [...issue.assignees] }));
  });
}

function isFallbackGitHubIssueSince(issue: GitHubIssue, since: string | null) {
  if (!since) return true;
  const issueUpdatedAt = Date.parse(issue.updatedAt);
  const sinceTimestamp = Date.parse(since);
  if (!Number.isFinite(issueUpdatedAt) || !Number.isFinite(sinceTimestamp)) return true;
  return issueUpdatedAt >= sinceTimestamp;
}

function compareFallbackGitHubIssues(
  a: GitHubIssue,
  b: GitHubIssue,
  sort: string | null,
  direction: string | null,
) {
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
      htmlUrl: `https://github.com/${repoFullName}/issues/${issues.length + 1}`,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    fallbackGitHubIssues[repoFullName] = [issue, ...issues];
    return { ...issue, labels: [...issue.labels], assignees: [...issue.assignees] };
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
    const updated: GitHubIssue = {
      ...current,
      ...request,
      title: request.title ?? current.title,
      body: request.body ?? current.body,
      labels: request.labels ? [...request.labels] : [...current.labels],
      assignees: request.assignees ? [...request.assignees] : [...current.assignees],
      updatedAt: new Date().toISOString(),
    };
    fallbackGitHubIssues[repoFullName] = issues.map((issue) => issue.number === issueNumber ? updated : issue);
    return { ...updated, labels: [...updated.labels], assignees: [...updated.assignees] };
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

export function listRepoContribution(repoScope: string): Promise<GitHubContributionResult> {
  return call("github_list_repo_contribution", { repoFullName: repoScope }, () => {
    if (fallbackRepoContributionOverride) {
      const result = fallbackRepoContributionOverride(repoScope);
      return {
        days: result.days.map((item) => ({ ...item })),
        meta: { ...result.meta },
      };
    }
    const end = new Date("2026-06-11T00:00:00Z");
    const days = Array.from({ length: CONTRIBUTION_DAYS }, (_, index) => {
      const date = new Date(end);
      date.setUTCDate(end.getUTCDate() - (CONTRIBUTION_DAYS - 1 - index));
      const dayIndex = Math.floor(date.getTime() / 86_400_000);
      const active = dayIndex % 5 === 0 || dayIndex % 17 === 0 || dayIndex > Math.floor(end.getTime() / 86_400_000) - 45;
      return {
        date: date.toISOString().slice(0, 10),
        count: active ? ((dayIndex % 4) + 1) : 0,
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
    [summary.id]: { ...summary },
  };
  return { ...summary };
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

export function getRepoReadme(repoId: string): Promise<RepoReadme | null> {
  return call("repo_get_readme", { repoId }, () => {
    const readme = fallbackRepoReadmes[repoId]?.[0] ?? null;
    return readme ? cloneRepoReadme(readme) : null;
  });
}

export function listRepoReadmes(repoId: string): Promise<RepoReadme[]> {
  return call("repo_list_readmes", { repoId }, () =>
    (fallbackRepoReadmes[repoId] ?? []).map(cloneRepoReadme),
  );
}

export function listGitHubRepoReadmes(repoFullName: string): Promise<RepoReadme[]> {
  return call("github_list_repo_readmes", { repoFullName }, () =>
    (fallbackGitHubRepoReadmes[repoFullName] ?? []).map(cloneRepoReadme),
  );
}

export function listRepoFiles(repoId: string, parentPath?: string | null): Promise<RepoFileTreeEntry[]> {
  return call("repo_list_files", { repoId, parentPath: parentPath ?? null }, () =>
    (fallbackRepoFiles[repoId]?.[parentPath ?? ""] ?? []).map(cloneRepoFileTreeEntry),
  );
}

export function getRepoFilePreview(repoId: string, path: string): Promise<RepoFilePreview> {
  return call("repo_get_file_preview", { repoId, path }, () => {
    const preview = fallbackRepoFilePreviews[repoId]?.[path];
    if (!preview) {
      throw new Error(`未找到文件预览：${repoId} ${path}`);
    }
    return cloneRepoFilePreview(preview);
  });
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
        ...syncFallbackRepoBranchState(repoId).map(cloneBranchSummary),
      ],
      conflicts,
    };
  });
}

export function refreshRepoLanguageStats(repoId: string): Promise<RepoSummary> {
  return call("repo_refresh_language_stats", { repoId }, () => {
    const repo = fallbackRepo(repoId);
    recordFallbackTask("languageStats", "low", repo.id, "success", "语言统计已更新");
    return updateFallbackRepo({
      ...repo,
      languageStats: repo.languageStats.length ? repo.languageStats : [{ language: "TypeScript", bytes: 1000 }],
      workingTreeLanguageStats: repo.workingTreeLanguageStats.length
        ? repo.workingTreeLanguageStats
        : [{ language: "TypeScript", bytes: 1200 }],
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

export function fetchRepo(repoId: string): Promise<RepoSummary> {
  return call("repo_fetch", { repoId }, () => fallbackRepo(repoId));
}

export function startRebaseRepo(repoId: string, ontoRef?: string | null): Promise<RepoOperationResult> {
  return call("repo_start_rebase", { repoId, ontoRef: ontoRef ?? null }, () =>
    fallbackOperationResult(repoId, "rebase 完成"),
  );
}

export function pushRepo(repoId: string): Promise<RepoSummary> {
  return call("repo_push", { repoId }, () => {
    const repo = fallbackRepo(repoId);
    return { ...repo, ahead: 0 };
  });
}

export function pushNewBranchRepo(
  repoId: string,
  remoteName?: string | null,
  branchName?: string | null,
): Promise<RepoSummary> {
  return call("repo_push_new_branch", { repoId, remoteName: remoteName ?? null, branchName: branchName ?? null }, () => {
    const repo = fallbackRepo(repoId);
    const currentBranch = branchName?.trim() || repo.currentBranch;
    if (!currentBranch) throw new Error("分支名不能为空");
    const upstream = `${remoteName?.trim() || "origin"}/${currentBranch}`;
    fallbackRepoBranches[repoId] = syncFallbackRepoBranchState(repoId).map((branch) =>
      !branch.remote && branch.name === currentBranch ? { ...branch, upstream } : branch
    );
    return { ...repo, ahead: 0 };
  });
}

export function pushRepoWithSystemGit(repoId: string): Promise<RepoSummary> {
  return call("repo_push_with_system_git", { repoId }, () => {
    if (!fallbackSettings.systemGitRepoIds.includes(repoId)) {
      fallbackSettings.systemGitRepoIds = [...fallbackSettings.systemGitRepoIds, repoId].sort();
    }
    const repo = fallbackRepo(repoId);
    return { ...repo, ahead: 0 };
  });
}

export function useDefaultTokenAuthForRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("repo_use_default_token_auth", { repoId }, () => {
    fallbackSettings.systemGitRepoIds = fallbackSettings.systemGitRepoIds.filter((id) => id !== repoId);
    return cloneWorkspaceSettings(fallbackSettings);
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
    (fallbackBulkExecuteOverride?.(operation, repoIds) ?? repoIds.map((repoId) => {
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
    })).map((result) => ({
      ...result,
      summary: result.summary ? updateFallbackRepo(result.summary) : null,
    })),
  );
}

export function openPath(path: string): Promise<void> {
  return call("system_open_path", { path }, () => {
    fallbackOpenPathCalls.push(path);
    return undefined;
  });
}

export function openUrl(url: string): Promise<void> {
  return call("system_open_url", { url }, () => undefined);
}

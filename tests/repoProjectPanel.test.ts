import { fireEvent, render, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepoProjectPanel from "../src/components/repo/RepoProjectPanel.vue";
import { closeContextMenu, installContextMenu } from "../src/composables/useContextMenu";
import { startAuthFlow } from "../src/composables/workspace/auth";
import { state } from "../src/composables/workspace/state";
import { vContextMenu } from "../src/directives/contextMenu";
import {
  createGitHubPullRequest,
  createGitHubIssue,
  deleteGitHubRepo,
  getGitHubIssueDiscussion,
  getGitHubIssueFilterMetadata,
  getGitHubRepoFilePreview,
  getGitHubPullRequestDiscussion,
  getGitHubRepoManagement,
  getRepoFilePreview,
  getGitHubWorkflowArtifactFilePreview,
  getGitHubWorkflowJobLog,
  getGitHubWorkflowRunDetail,
  listGitHubWorkflowArtifactFiles,
  listGitHubPullRequestChecks,
  listGitHubPullRequests,
  listGitHubIssues,
  listGitHubIssueAssignees,
  listGitHubIssueLabels,
  listGitHubRepoFiles,
  listGitHubWorkflowRuns,
  listRepoFiles,
  mergeGitHubPullRequest,
  updateGitHubRepoSettings,
} from "../src/services/workspace/client";
import type {
  CommitDetail,
  CommitSummary,
  GitHubIssue,
  GitHubIssueDiscussion,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubPullRequestDiscussion,
  GitHubRepoManagement,
  GitHubWorkflowRun,
  GitHubWorkflowRunDetail,
  ProjectLaunchConfig,
  ProjectLaunchLog,
  RepoFilePreview,
  RepoFileTreeEntry,
} from "../src/services/workspace/types";
import { resolveRepoContext } from "../src/utils/repoContext";
import { repoSummary } from "./fixtures/workspace";

const githubSettings: GitHubRepoManagement = {
  fullName: "sena-nana/remote-repo",
  name: "remote-repo",
  description: "Remote repository tools",
  homepage: "https://example.com/remote",
  topics: ["vue", "tauri"],
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
  deleteBranchOnMerge: false,
  allowForking: true,
  webCommitSignoffRequired: false,
  stargazersCount: 128,
  watchersCount: 9,
  forksCount: 14,
  htmlUrl: "https://github.com/sena-nana/remote-repo",
  license: {
    key: "bsd-3-clause",
    name: "BSD 3-Clause License",
    spdxId: "BSD-3-Clause",
    url: "https://api.github.com/licenses/bsd-3-clause",
  },
};

const localRootFiles: RepoFileTreeEntry[] = [repoFile("README.md")];
const localReadmePreview = filePreview("README.md", "# Project README");

const githubIssues: GitHubIssue[] = [{
  number: 12,
  title: "修复懒加载",
  state: "open",
  body: null,
  labels: ["bug"],
  assignees: ["sena"],
  author: "sena",
  milestone: { number: 1, title: "v1" },
  comments: 3,
  projectItems: [{ id: "PVT_kwDOIssue", title: "Roadmap" }],
  htmlUrl: "https://github.com/sena-nana/remote-repo/issues/12",
  updatedAt: "2026-06-18T08:00:00Z",
  createdAt: "2026-06-18T08:00:00Z",
}];

const closedGitHubIssues: GitHubIssue[] = [{
  ...githubIssues[0],
  number: 34,
  title: "已关闭问题",
  state: "closed",
  htmlUrl: "https://github.com/sena-nana/remote-repo/issues/34",
}];

const githubWorkflowRuns: GitHubWorkflowRun[] = [{
  id: 1310,
  name: "CI",
  displayTitle: "release pipeline",
  status: "completed",
  conclusion: "success",
  branch: "main",
  event: "workflow_dispatch",
  htmlUrl: "https://github.com/sena-nana/remote-repo/actions/runs/1310",
  createdAt: "2026-06-18T08:00:00Z",
  updatedAt: "2026-06-18T08:00:00Z",
  headSha: "abc123",
  workflowId: 99,
}];

const githubWorkflowRunDetail: GitHubWorkflowRunDetail = {
  run: {
    ...githubWorkflowRuns[0],
    actor: "sena",
    runNumber: 23,
    runAttempt: 1,
    runStartedAt: "2026-06-18T08:00:00Z",
  },
  jobs: [
    {
      id: 13101,
      name: "lint",
      status: "completed",
      conclusion: "success",
      startedAt: "2026-06-18T08:00:00Z",
      completedAt: "2026-06-18T08:01:00Z",
      htmlUrl: "https://github.com/sena-nana/remote-repo/actions/runs/1310/job/13101",
      runnerName: "GitHub Actions",
      steps: [{
        name: "Run lint",
        status: "completed",
        conclusion: "success",
        number: 1,
        startedAt: "2026-06-18T08:00:00Z",
        completedAt: "2026-06-18T08:01:00Z",
      }],
    },
    {
      id: 13102,
      name: "build",
      status: "completed",
      conclusion: "success",
      startedAt: "2026-06-18T08:00:00Z",
      completedAt: "2026-06-18T08:02:00Z",
      htmlUrl: "https://github.com/sena-nana/remote-repo/actions/runs/1310/job/13102",
      runnerName: "GitHub Actions",
      steps: [{
        name: "Build app",
        status: "completed",
        conclusion: "success",
        number: 1,
        startedAt: "2026-06-18T08:00:00Z",
        completedAt: "2026-06-18T08:02:00Z",
      }],
    },
    {
      id: 13103,
      name: "test",
      status: "completed",
      conclusion: "success",
      startedAt: "2026-06-18T08:02:00Z",
      completedAt: "2026-06-18T08:04:00Z",
      htmlUrl: "https://github.com/sena-nana/remote-repo/actions/runs/1310/job/13103",
      runnerName: "GitHub Actions",
      steps: [
        {
          name: "Set up job",
          status: "completed",
          conclusion: "success",
          number: 1,
          startedAt: "2026-06-18T08:02:00Z",
          completedAt: "2026-06-18T08:02:10Z",
        },
        {
          name: "Run tests",
          status: "completed",
          conclusion: "success",
          number: 2,
          startedAt: "2026-06-18T08:02:10Z",
          completedAt: "2026-06-18T08:04:00Z",
        },
      ],
    },
    {
      id: 13104,
      name: "package",
      status: "completed",
      conclusion: "success",
      startedAt: "2026-06-18T08:04:00Z",
      completedAt: "2026-06-18T08:05:00Z",
      htmlUrl: "https://github.com/sena-nana/remote-repo/actions/runs/1310/job/13104",
      runnerName: "GitHub Actions",
      steps: [{
        name: "Package dist",
        status: "completed",
        conclusion: "success",
        number: 1,
        startedAt: "2026-06-18T08:04:00Z",
        completedAt: "2026-06-18T08:05:00Z",
      }],
    },
  ],
  artifacts: [{
    id: 131001,
    name: "dist",
    sizeInBytes: 1280,
    expired: false,
    createdAt: "2026-06-18T08:02:00Z",
    expiresAt: "2026-07-18T08:02:00Z",
  }],
  workflow: {
    id: 99,
    path: ".github/workflows/ci.yml",
    refName: "abc123",
    content: [
      "name: CI",
      "jobs:",
      "  lint:",
      "    name: lint",
      "    runs-on: ubuntu-latest",
      "  build:",
      "    name: build",
      "    runs-on: ubuntu-latest",
      "  test:",
      "    name: test",
      "    needs: [lint, build]",
      "    runs-on: ubuntu-latest",
      "  package:",
      "    name: package",
      "    needs: test",
      "    runs-on: ubuntu-latest",
    ].join("\n"),
  },
};

const githubPullRequests: GitHubPullRequest[] = [{
  number: 52,
  title: "接入 Pull Request 工作流",
  state: "open",
  draft: false,
  body: "## Summary\n\n接入 PR 工作流。",
  labels: ["bug"],
  assignees: ["sena"],
  milestone: { number: 1, title: "v1", state: "open" },
  comments: 2,
  projectItems: [{ id: "PVT_kwDOIssue", title: "Roadmap" }],
  htmlUrl: "https://github.com/sena-nana/remote-repo/pull/52",
  updatedAt: "2026-06-18T08:00:00Z",
  createdAt: "2026-06-18T08:00:00Z",
  author: "sena",
  baseBranch: "main",
  headBranch: "feature/pr-flow",
  merged: false,
  mergeable: true,
  mergeableState: "clean",
}];

const githubPullRequestChecks: GitHubPullRequestCheck[] = [{
  id: 1,
  name: "ci / build",
  status: "completed",
  conclusion: "success",
  detailsUrl: null,
  htmlUrl: null,
  startedAt: "2026-06-18T08:00:00Z",
  completedAt: "2026-06-18T08:05:00Z",
}];

function issueDiscussion(issue: GitHubIssue): GitHubIssueDiscussion {
  return {
    issue,
    timeline: [{
      id: `issue-${issue.number}-body`,
      kind: "body",
      actor: issue.author,
      body: issue.body,
      url: issue.htmlUrl,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    }],
  };
}

function pullRequestDiscussion(pullRequest: GitHubPullRequest): GitHubPullRequestDiscussion {
  return {
    pullRequest,
    timeline: [{
      id: `pull-${pullRequest.number}-body`,
      kind: "body",
      actor: pullRequest.author,
      body: pullRequest.body,
      url: pullRequest.htmlUrl,
      createdAt: pullRequest.createdAt,
      updatedAt: pullRequest.updatedAt,
    }],
  };
}

const remoteCommit: CommitSummary = {
  hash: "fedcba9876543210",
  shortHash: "fedcba9",
  author: "Sena",
  authorEmail: "sena@example.com",
  timestamp: 1_785_010_000,
  subject: "远程历史提交",
  parents: ["1234567890abcdef"],
  refs: ["main"],
};

const remoteCommitDetail: CommitDetail = {
  ...remoteCommit,
  committer: "Sena",
  committerEmail: "sena@example.com",
  body: "远程提交详情。",
  files: [{
    path: "src/remote.ts",
    oldPath: null,
    status: "modified",
    additions: 1,
    deletions: 0,
    patch: "diff --git a/src/remote.ts b/src/remote.ts\n@@ -1 +1,2 @@\n export const remote = true;\n+export const history = true;",
    hunks: [{
      header: "@@ -1 +1,2 @@",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 2,
      lines: [
        { kind: "context", content: "export const remote = true;", oldLine: 1, newLine: 1 },
        { kind: "added", content: "export const history = true;", oldLine: null, newLine: 2 },
      ],
    }],
  }],
};

function repoFile(path: string): RepoFileTreeEntry {
  return {
    path,
    name: path.split("/").pop() ?? path,
    kind: "file",
    hasChildren: false,
  };
}

function filePreview(path: string, content: string, overrides: Partial<RepoFilePreview> = {}): RepoFilePreview {
  return {
    path,
    name: path.split("/").pop() ?? path,
    previewKind: path.endsWith(".md") ? "markdown" : "text",
    content,
    images: {},
    size: content.length,
    mimeType: "text/plain",
    truncated: false,
    ...overrides,
  };
}

vi.mock("../src/services/workspace/client", () => ({
  createGitHubPullRequest: vi.fn(),
  createGitHubIssue: vi.fn(),
  deleteGitHubRepo: vi.fn(),
  getGitHubIssueDiscussion: vi.fn(),
  getGitHubRepoFilePreview: vi.fn(),
  getGitHubIssueFilterMetadata: vi.fn(),
  getGitHubPullRequestDiscussion: vi.fn(),
  getRepoCommitDetail: vi.fn(),
  getGitHubRepoManagement: vi.fn(),
  getRepoFilePreview: vi.fn(),
  listGitHubPullRequestChecks: vi.fn(),
  listGitHubPullRequests: vi.fn(),
  listGitHubIssues: vi.fn(),
  listGitHubIssueAssignees: vi.fn(),
  listGitHubIssueLabels: vi.fn(),
  listGitHubRepoFiles: vi.fn(),
  listGitHubWorkflowRuns: vi.fn(),
  getGitHubWorkflowRunDetail: vi.fn(),
  getGitHubWorkflowJobLog: vi.fn(),
  listGitHubWorkflowArtifactFiles: vi.fn(),
  getGitHubWorkflowArtifactFilePreview: vi.fn(),
  isGitHubBindingExpiredError: (err: unknown) => {
    const message = String(err);
    return message.includes("GitHub 绑定已失效") ||
      message.includes("HTTP 401") ||
      message.includes("HTTP 403") ||
      message.toLowerCase().includes("bad credentials");
  },
  mergeGitHubPullRequest: vi.fn(),
  listRepoFiles: vi.fn(async () => []),
  openPath: vi.fn(),
  openUrl: vi.fn(),
  updateGitHubIssue: vi.fn(),
  updateGitHubRepoSettings: vi.fn(async (_repoFullName: string, request: Partial<GitHubRepoManagement>) => ({
    ...githubSettings,
    ...request,
    description: request.description ?? githubSettings.description,
    homepage: request.homepage ?? githubSettings.homepage,
    topics: request.topics ? [...request.topics] : [...githubSettings.topics],
  })),
}));

vi.mock("../src/composables/workspace/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/composables/workspace/auth")>();
  return {
    ...actual,
    startAuthFlow: vi.fn(),
  };
});

const launchConfig: ProjectLaunchConfig = {
  command: "yarn dev",
  cwd: null,
  source: "inferred",
  updatedAt: null,
};

async function workspaceFallbackForTests() {
  const client = await vi.importActual<typeof import("../src/services/workspace/client")>(
    "../src/services/workspace/client",
  );
  return client.workspaceFallbackForTests();
}

type RepoProjectPanelProps = InstanceType<typeof RepoProjectPanel>["$props"];
type RenderProjectPanelProps = Omit<RepoProjectPanelProps, "repoContext"> & {
  repoContext?: RepoProjectPanelProps["repoContext"];
};

async function renderProjectPanel(
  props: Partial<RepoProjectPanelProps> = {},
  routePath = "/repos/local-repo",
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/repos/:repoId(.*)", component: { template: "<div />" } }],
  });
  await router.push(routePath);
  await router.isReady();

  const panelProps = {
    repoId: "local-repo",
    repoFullName: null,
    repoPath: "C:\\Files\\workspace\\local-repo",
    repoSummary: null,
    launchConfig,
    launchLogs: [],
    launchTerminalVisible: false,
    actionRunning: false,
    launchRunning: false,
    activeGitTab: "repo",
    canLoadFiles: true,
    changes: [],
    previewChange: null,
    commitMessage: "",
    hasConflicts: false,
    canCommit: false,
    statusCommits: [],
    conflictOperationText: "",
    conflictSummaryText: "",
    conflictContinueText: "",
    conflictAbortText: "",
    conflictFiles: [],
    conflictOperationActive: false,
    conflicts: { operation: "none", files: [], allResolved: false },
    focusedConflict: null,
    conflictChoices: {},
    conflictSelectedCount: 0,
    conflictAcceptConfirm: null,
    canContinueConflictOperation: false,
    canResolveSelectedConflict: false,
    supportedConflictOperation: true,
    commitMetaTitle: () => "",
    projectTab: "readme",
    projectIssueNumber: null,
    projectPullRequestNumber: null,
    projectRunId: null,
    projectJobId: null,
    projectRefreshToken: 0,
    ...props,
  } satisfies RenderProjectPanelProps;
  const repoSummary = panelProps.repoSummary ?? state.repos.find((repo) => repo.id === panelProps.repoId) ?? null;
  const repoContext = panelProps.repoContext ?? resolveRepoContext({
    repoId: panelProps.repoId,
    repoSummary,
    githubFullName: panelProps.repoFullName ?? null,
    localPath: panelProps.repoPath ?? null,
    settings: state.settings,
    githubAuthorized: true,
  });

  const view = render(RepoProjectPanel, {
    props: {
      ...panelProps,
      repoContext,
    },
    global: {
      plugins: [router],
      directives: {
        contextMenu: vContextMenu,
      },
    },
  });
  return { ...view, router };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

describe("RepoProjectPanel", () => {
  beforeEach(async () => {
    closeContextMenu();
    installContextMenu();
    vi.clearAllMocks();
    vi.mocked(createGitHubPullRequest).mockReset();
    vi.mocked(createGitHubIssue).mockReset();
    vi.mocked(deleteGitHubRepo).mockReset();
    vi.mocked(getGitHubIssueDiscussion).mockReset();
    vi.mocked(getGitHubPullRequestDiscussion).mockReset();
    vi.mocked(getGitHubRepoFilePreview).mockReset();
    vi.mocked(getRepoFilePreview).mockReset();
    vi.mocked(getGitHubIssueFilterMetadata).mockReset();
    vi.mocked(getGitHubRepoManagement).mockReset();
    vi.mocked(listGitHubIssueAssignees).mockReset();
    vi.mocked(listGitHubIssueLabels).mockReset();
    vi.mocked(listGitHubRepoFiles).mockReset();
    vi.mocked(listRepoFiles).mockReset();
    vi.mocked(updateGitHubRepoSettings).mockReset();
    vi.mocked(createGitHubIssue).mockImplementation(async (_repoFullName, request) => ({
      number: 99,
      title: request.title,
      state: "open",
      body: request.body ?? null,
      labels: [...request.labels],
      assignees: [...request.assignees],
      author: "sena",
      milestone: null,
      comments: 0,
      projectItems: [],
      htmlUrl: "https://github.com/sena-nana/remote-repo/issues/99",
      updatedAt: "2026-06-18T09:00:00Z",
      createdAt: "2026-06-18T09:00:00Z",
    }));
    vi.mocked(createGitHubPullRequest).mockImplementation(async (_repoFullName, request) => ({
      number: 101,
      title: request.title,
      state: "open",
      draft: request.draft ?? false,
      body: request.body ?? null,
      labels: [],
      assignees: [],
      milestone: null,
      comments: 0,
      projectItems: [],
      htmlUrl: "https://github.com/sena-nana/remote-repo/pull/101",
      updatedAt: "2026-06-18T09:00:00Z",
      createdAt: "2026-06-18T09:00:00Z",
      author: "sena",
      baseBranch: request.base,
      headBranch: request.head,
      merged: false,
      mergeable: null,
      mergeableState: null,
    }));
    vi.mocked(listGitHubRepoFiles).mockResolvedValue([]);
    vi.mocked(listRepoFiles).mockResolvedValue(localRootFiles);
    vi.mocked(getRepoFilePreview).mockResolvedValue(localReadmePreview);
    vi.mocked(listGitHubIssueLabels).mockResolvedValue(["bug", "needs triage", "documentation"]);
    vi.mocked(listGitHubIssueAssignees).mockResolvedValue(["mika", "sena"]);
    vi.mocked(getGitHubIssueFilterMetadata).mockResolvedValue({
      authors: ["sena"],
      labels: ["bug", "needs triage", "documentation"],
      assignees: ["mika", "sena"],
      milestones: [{ number: 1, title: "v1" }],
      projects: [{ id: "PVT_kwDOIssue", title: "Roadmap" }],
    });
    vi.mocked(getGitHubRepoFilePreview).mockRejectedValue(new Error("not found"));
    vi.mocked(getGitHubRepoManagement).mockResolvedValue(githubSettings);
    vi.mocked(updateGitHubRepoSettings).mockImplementation(async (_repoFullName, request) => ({
      ...githubSettings,
      ...request,
      description: request.description ?? githubSettings.description,
      homepage: request.homepage ?? githubSettings.homepage,
      topics: request.topics ? [...request.topics] : [...githubSettings.topics],
    }));
    vi.mocked(listGitHubPullRequests).mockResolvedValue([]);
    vi.mocked(getGitHubPullRequestDiscussion).mockImplementation(async (_repoFullName, pullNumber) => {
      const pullRequest = githubPullRequests.find((item) => item.number === pullNumber);
      if (!pullRequest) throw new Error(`missing pull ${pullNumber}`);
      return pullRequestDiscussion(pullRequest);
    });
    vi.mocked(listGitHubPullRequestChecks).mockResolvedValue([]);
    vi.mocked(mergeGitHubPullRequest).mockImplementation(async () => ({ ...githubPullRequests[0], merged: true, state: "closed" }));
    vi.mocked(listGitHubIssues).mockResolvedValue([]);
    vi.mocked(getGitHubIssueDiscussion).mockImplementation(async (_repoFullName, issueNumber) => {
      const issue = githubIssues.find((item) => item.number === issueNumber) ?? closedGitHubIssues.find((item) => item.number === issueNumber);
      if (!issue) throw new Error(`missing issue ${issueNumber}`);
      return issueDiscussion(issue);
    });
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue([]);
    vi.mocked(getGitHubWorkflowRunDetail).mockResolvedValue(githubWorkflowRunDetail);
    vi.mocked(getGitHubWorkflowJobLog).mockResolvedValue({
      jobId: 13101,
      content: "##[group]Run tests\nyarn test\npassed\n##[endgroup]",
    });
    vi.mocked(listGitHubWorkflowArtifactFiles).mockResolvedValue([
      { path: "README.md", name: "README.md", kind: "file", size: 42 },
    ]);
    vi.mocked(getGitHubWorkflowArtifactFilePreview).mockResolvedValue(filePreview("README.md", "# Artifact\n\nPreview."));
    const workspaceFallback = await workspaceFallbackForTests();
    workspaceFallback.setFallbackGitHubCommitDetailsForTests({
      "sena-nana/remote-repo": {
        [remoteCommit.hash]: remoteCommitDetail,
      },
    });
    vi.mocked(startAuthFlow).mockResolvedValue(undefined);
    state.repos = [];
  });

  it("本地仓库在命令运行页无日志时只显示空输出状态", async () => {
    const view = await renderProjectPanel({ activeGitTab: "run" });

    const terminalCard = view.container.querySelector(".project-terminal-card");
    expect(terminalCard).toBeInstanceOf(HTMLElement);
    const terminal = view.getByLabelText("启动终端");
    expect(within(terminal).getByText("暂无输出。")).toBeInTheDocument();
    expect(within(terminal).queryByText("请选择一个启动指令并运行。")).toBeNull();
    expect(within(terminal).queryByText("当前指令：yarn dev")).toBeNull();
    expect(within(terminalCard as HTMLElement).queryByRole("button", { name: "yarn dev" })).toBeNull();
    expect(within(terminalCard as HTMLElement).queryByRole("button", { name: "隐藏" })).toBeNull();
    expect(within(terminalCard as HTMLElement).queryByRole("button", { name: "运行" })).toBeNull();
  });

  it("侧边栏显示本地仓库语言占比和代码行数", async () => {
    const summary = repoSummary("local-repo", {
      languageStats: [
        { language: "TypeScript", bytes: 3000, lines: 120 },
        { language: "Vue", bytes: 1000, lines: 80 },
        { language: "Rust", bytes: 500, lines: 20 },
        { language: "CSS", bytes: 300, lines: 12 },
        { language: "Markdown", bytes: 200, lines: 8 },
      ],
    });
    const view = await renderProjectPanel({
      repoSummary: summary,
      repoFullName: "sena-nana/local-repo",
    });

    const card = await view.findByRole("region", { name: "代码统计" }, { timeout: 5000 });
    expect(within(card).getByText("TypeScript")).toBeInTheDocument();
    expect(within(card).getByText("120 ·")).toBeInTheDocument();
    expect(within(card).getByText("60%")).toBeInTheDocument();
    expect(within(card).getByText("Vue")).toBeInTheDocument();
    expect(within(card).getByText("80 ·")).toBeInTheDocument();
    expect(within(card).getByText("20%")).toBeInTheDocument();
    expect(within(card).getByText("CSS")).toBeInTheDocument();
    expect(within(card).getByText("Other")).toBeInTheDocument();
    expect(within(card).queryByText("Markdown")).toBeNull();
    expect(within(card).getByText("总代码行数")).toBeInTheDocument();
    expect(within(card).getByText("240")).toBeInTheDocument();
    const barSegments = card.querySelectorAll(".repo-language-card__bar-segment");
    expect(barSegments).toHaveLength(5);
    expect((barSegments[0] as HTMLElement).style.flex).toBe("60 1 0%");
    expect((barSegments[0] as HTMLElement).style.backgroundColor).toBe("rgb(97, 168, 250)");
    expect((barSegments[1] as HTMLElement).style.backgroundColor).toBe("rgb(72, 190, 136)");
    expect((barSegments[2] as HTMLElement).style.flex).toBe("10 1 0%");
    expect((barSegments[0] as HTMLElement).style.transform).toBe("");
  });

  it("远程仓库侧边栏语言统计不显示本地行数", async () => {
    const summary = repoSummary("github:sena-nana/remote-repo", {
      path: "",
      githubFullName: "sena-nana/remote-repo",
      languageStats: [{ language: "TypeScript", bytes: 1000, lines: 40 }],
    });
    const view = await renderProjectPanel({
      repoId: "github:sena-nana/remote-repo",
      repoSummary: summary,
      repoFullName: "sena-nana/remote-repo",
      repoPath: "",
    });

    const card = await view.findByRole("region", { name: "代码统计" }, { timeout: 5000 });
    expect(within(card).getByText("TypeScript")).toBeInTheDocument();
    expect(within(card).getByText("100%")).toBeInTheDocument();
    expect(within(card).queryByText("40 ·")).toBeNull();
    expect(within(card).queryByText("总代码行数")).toBeNull();
  });

  it("启动终端按终端输出渲染 ANSI 颜色和多行日志", async () => {
    const launchLogs: ProjectLaunchLog[] = [
      { index: 1, repoId: "local-repo", stream: "system", line: "启动命令：yarn dev", timestamp: 1 },
      { index: 2, repoId: "local-repo", stream: "stdout", line: "line 1\nline 2", timestamp: 2 },
      { index: 3, repoId: "local-repo", stream: "stdout", line: "\u001b[32mready\u001b[0m <tag>", timestamp: 3 },
      { index: 4, repoId: "local-repo", stream: "stderr", line: "plain error", timestamp: 4 },
    ];

    const view = await renderProjectPanel({
      activeGitTab: "run",
      launchRunning: false,
      launchLogs,
    });

    const terminal = view.getByLabelText("启动终端");
    expect(terminal).toHaveTextContent("启动命令：yarn dev");
    expect(terminal.textContent).toContain("line 1\nline 2\nready <tag>\nplain error");
    expect(terminal).not.toHaveTextContent("[stdout]");
    expect(terminal).not.toHaveTextContent("[stderr]");
    expect(terminal.querySelector('span[style*="rgb(0,187,0)"]')).toBeInstanceOf(HTMLElement);
    expect(terminal.innerHTML).toContain("&lt;tag&gt;");
    expect(terminal.querySelector(".launch-log--stderr")).toHaveTextContent("plain error");
  });

  it("远程仓库只显示项目 tabs，不进入启动工作流", async () => {
    const view = await renderProjectPanel({
      repoId: "github:sena-nana/remote-repo",
      repoFullName: "sena-nana/remote-repo",
      repoPath: "",
      launchTerminalVisible: true,
      projectTab: "settings",
    });

    expect(view.queryByRole("region", { name: "快速启动" })).toBeNull();
    expect(view.queryByLabelText("启动终端")).toBeNull();
    expect(view.queryByRole("button", { name: "yarn dev" })).toBeNull();
    expect(view.getByRole("tab", { name: "Issues" })).toBeInTheDocument();
    expect(view.getByRole("tab", { name: "Actions" })).toBeInTheDocument();
    expect(view.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
    expect(view.queryByRole("tab", { name: "分支" })).toBeNull();

    await waitFor(() => {
      expect(view.getByText("删除 GitHub 远端仓库")).toBeInTheDocument();
    });
    expect(view.queryByText("删除本地仓库")).toBeNull();
  });

  it("远程仓库历史可打开只读提交详情", async () => {
    const view = await renderProjectPanel({
      repoId: "github:sena-nana/remote-repo",
      repoFullName: "sena-nana/remote-repo",
      repoPath: "",
      activeGitTab: "history",
      statusCommits: [remoteCommit],
    });

    await fireEvent.click(view.getByRole("button", { name: /远程历史提交/ }));
    await view.rerender({ selectedCommitHash: remoteCommit.hash });

    expect(await view.findByLabelText("提交详情卡片")).toBeInTheDocument();
    expect(await view.findByLabelText("提交元数据")).toHaveTextContent("远程历史提交");
    expect(await view.findByLabelText("改动文件列表")).toHaveTextContent("src/remote.ts");
  });

  it("默认 readme 首屏加载仓库描述卡片，但不预取 issues 和 workflow runs", async () => {
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await waitFor(() => {
      expect(listRepoFiles).toHaveBeenCalledWith("local-repo", null);
    });
    expect(getRepoFilePreview).toHaveBeenCalledWith("local-repo", "README.md");
    expect(await view.findByText("Remote repository tools")).toBeInTheDocument();
    expect(await view.findByText("Project README")).toBeInTheDocument();
    expect(view.getByRole("tab", { name: "Repo" })).toHaveClass("is-active");
    expect(view.getByRole("tab", { name: "文件树" })).toBeInTheDocument();
    expect(view.getByRole("tab", { name: "Pull Requests" })).toBeInTheDocument();
    expect(view.getByText("https://example.com/remote")).toBeInTheDocument();
    const topics = view.getByLabelText("Topics");
    expect(within(topics).getByText("vue")).toBeInTheDocument();
    const tauriTopic = within(topics).getByText("tauri");
    const licenseRow = view.getByLabelText("BSD-3-Clause license");
    const starsStat = view.getByLabelText("128 stars");
    expect(tauriTopic).toBeInTheDocument();
    expect(licenseRow).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Readme" })).toBeNull();
    expect(view.queryByRole("tab", { name: /README\.md/ })).toBeNull();
    expect(view.container.querySelector(".project-sidebar__card")).toBeNull();
    expect(starsStat).toBeInTheDocument();
    expect(view.getByLabelText("9 watching")).toBeInTheDocument();
    expect(view.getByLabelText("14 forks")).toBeInTheDocument();
    expect(tauriTopic.compareDocumentPosition(starsStat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(licenseRow.compareDocumentPosition(starsStat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getGitHubRepoManagement).toHaveBeenCalledTimes(1);
    expect(listGitHubIssues).not.toHaveBeenCalled();
    expect(listGitHubWorkflowRuns).not.toHaveBeenCalled();

    await fireEvent.click(view.getByRole("tab", { name: "文件树" }));
    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/repos/local-repo/files");
    });
    expect(await view.findByLabelText("仓库文件树")).toBeInTheDocument();
    expect(view.getByRole("tab", { name: "文件树" })).toHaveClass("is-active");
  });

  it("仓库设置读取失败时只显示右侧错误卡并隐藏描述卡片", async () => {
    const message = "读取 GitHub 仓库设置失败：HTTP 404 Not Found";
    vi.mocked(getGitHubRepoManagement).mockRejectedValue(message);

    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    const errorCard = await view.findByRole("region", { name: "仓库错误" });
    expect(errorCard).toHaveTextContent("GitHub 请求失败");
    expect(errorCard).toHaveTextContent(message);
    expect(view.queryByRole("region", { name: "仓库描述" })).toBeNull();
    expect(view.container.querySelector(".project-main .error-line")).toBeNull();
  });

  it("README 读取失败时只在右侧错误区显示", async () => {
    const message = "读取 README 失败：HTTP 404 Not Found";
    vi.mocked(listRepoFiles).mockRejectedValue(message);

    const view = await renderProjectPanel();

    const errorCard = await view.findByRole("region", { name: "仓库错误" });
    expect(errorCard).toHaveTextContent("README 读取失败");
    expect(errorCard).toHaveTextContent(message);
    expect(view.container.querySelector(".project-main .error-line")).toBeNull();
  });

  it("仓库操作错误和同步错误固定显示在右侧错误区", async () => {
    const view = await renderProjectPanel({
      activeGitTab: "changes",
      actionError: "操作失败：无法提交",
      repoActionError: "仓库错误：自动同步失败",
      recentSyncError: { message: "认证失败", retrying: false },
    });

    const errorCard = view.getByRole("region", { name: "仓库错误" });
    expect(errorCard).toHaveTextContent("最近同步失败");
    expect(errorCard).toHaveTextContent("认证失败");
    expect(errorCard).toHaveTextContent("操作失败");
    expect(errorCard).toHaveTextContent("操作失败：无法提交");
    expect(errorCard).toHaveTextContent("仓库错误：自动同步失败");
    expect(within(errorCard).getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("仓库描述标签超过两行时显示展开和收起按钮", async () => {
    vi.mocked(getGitHubRepoManagement).mockResolvedValue({
      ...githubSettings,
      topics: ["vue", "tauri", "codex", "openai-compatible", "project-management"],
    });
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await view.findByText("Remote repository tools");
    const topicList = view.container.querySelector(".project-topic-list:not(.project-topic-list--measure)");
    const measureList = view.container.querySelector(".project-topic-list--measure");
    expect(topicList).toBeInstanceOf(HTMLElement);
    expect(measureList).toBeInstanceOf(HTMLElement);
    const topics = Array.from(measureList?.querySelectorAll(".project-topic-pill") ?? []);
    [0, 0, 26, 26, 52].forEach((top, index) => {
      Object.defineProperty(topics[index], "offsetTop", { configurable: true, value: top });
    });
    await fireEvent(window, new Event("resize"));

    const expandButton = await view.findByRole("button", { name: "展开" });
    expect(topicList).toHaveClass("is-collapsed");
    expect(topicList).toContainElement(expandButton);
    expect(within(topicList as HTMLElement).queryByText("project-management")).toBeNull();
    expect(expandButton).toHaveAttribute("aria-expanded", "false");

    await fireEvent.click(expandButton);
    expect(topicList).not.toHaveClass("is-collapsed");
    expect(within(topicList as HTMLElement).getByText("project-management")).toBeInTheDocument();
    const collapseButton = view.getByRole("button", { name: "收起" });
    expect(collapseButton).toHaveAttribute("aria-expanded", "true");

    await fireEvent.click(collapseButton);
    expect(topicList).toHaveClass("is-collapsed");
  });

  it("首次进入远端项目页会预热 GitHub 项目元数据，列表仍按分区请求", async () => {
    vi.mocked(getGitHubRepoManagement).mockResolvedValue(githubSettings);
    vi.mocked(listGitHubIssues).mockResolvedValue(githubIssues);
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue(githubWorkflowRuns);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await waitFor(() => {
      expect(getGitHubIssueFilterMetadata).toHaveBeenCalledWith("sena-nana/remote-repo", { forceRefresh: false });
      expect(listGitHubIssueLabels).toHaveBeenCalledWith("sena-nana/remote-repo", { forceRefresh: false });
      expect(listGitHubIssueAssignees).toHaveBeenCalledWith("sena-nana/remote-repo", { forceRefresh: false });
    });
    expect(listGitHubRepoFiles).toHaveBeenCalledWith("sena-nana/remote-repo", ".github/ISSUE_TEMPLATE");
    expect(listGitHubRepoFiles).toHaveBeenCalledWith("sena-nana/remote-repo", null);
    expect(listGitHubIssues).not.toHaveBeenCalled();
    expect(listGitHubPullRequests).not.toHaveBeenCalled();
    expect(listGitHubWorkflowRuns).not.toHaveBeenCalled();

    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));
    expect(await view.findByRole("heading", { level: 4, name: "基础设置" })).toBeInTheDocument();
    expect(view.getByLabelText("Settings 摘要")).toHaveTextContent("sena-nana/remote-repo");
    expect(view.getByLabelText("Settings 摘要")).toHaveTextContent("main");
    expect(getGitHubRepoManagement).toHaveBeenCalledTimes(1);
    expect(listGitHubIssues).not.toHaveBeenCalled();
    expect(listGitHubWorkflowRuns).not.toHaveBeenCalled();

    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));
    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();
    expect(view.getByLabelText("Issues 摘要")).toHaveTextContent("open");
    expect(view.getByLabelText("Issues 摘要")).toHaveTextContent("1");
    const issueDate = new Date(githubIssues[0].updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const issueRow = view.container.querySelector(".project-row--issue[data-issue-number=\"12\"]");
    expect(issueRow).toHaveClass("repo-list-row", "repo-list-row--with-actions");
    expect(issueRow?.querySelector(".repo-list-row__title")).toHaveTextContent("#12 修复懒加载");
    expect(issueRow?.querySelector(".issues-list__meta")).toHaveClass("repo-list-row__meta");
    expect(issueRow?.querySelector(".issues-list__meta")).toHaveTextContent(`sena · bug · sena · Roadmap · v1 · ${issueDate}`);
    expect(listGitHubIssues).toHaveBeenCalledTimes(1);
    expect(getGitHubIssueFilterMetadata).toHaveBeenCalledTimes(1);
    expect(listGitHubWorkflowRuns).not.toHaveBeenCalled();

    await fireEvent.click(view.getByRole("tab", { name: "Actions" }));
    expect(await view.findByRole("button", { name: /release pipeline/ }, { timeout: 5000 })).toBeInTheDocument();
    expect(view.getByLabelText("Actions 摘要")).toHaveTextContent("1");
    expect(view.getByLabelText("Actions 摘要")).toHaveTextContent("已同步");
    expect(listGitHubWorkflowRuns).toHaveBeenCalledTimes(1);
    expect(getGitHubWorkflowRunDetail).not.toHaveBeenCalled();
  });

  it("点击 Issue 行进入详情并渲染 Markdown 正文、评论和事件", async () => {
    const issueWithBody: GitHubIssue = {
      ...githubIssues[0],
      body: "## 复现步骤\n\n- 打开 <script>alert(1)</script> [文档](docs/guide.md)",
    };
    vi.mocked(listGitHubIssues).mockResolvedValue([issueWithBody]);
    vi.mocked(getGitHubIssueDiscussion).mockResolvedValue({
      issue: issueWithBody,
      timeline: [
        {
          id: "issue-12-body",
          kind: "body",
          actor: "sena",
          body: issueWithBody.body,
          url: issueWithBody.htmlUrl,
          createdAt: "2026-06-18T08:00:00Z",
          updatedAt: "2026-06-18T08:00:00Z",
        },
        {
          id: "comment-1",
          kind: "comment",
          actor: "mika",
          body: "**确认** 已复现",
          url: "https://github.com/sena-nana/remote-repo/issues/12#issuecomment-1",
          createdAt: "2026-06-18T08:01:00Z",
          updatedAt: "2026-06-18T08:01:00Z",
        },
        {
          id: "event-closed",
          kind: "event",
          actor: "sena",
          event: "closed",
          title: "关闭了讨论",
          createdAt: "2026-06-18T08:02:00Z",
        },
      ],
    });
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));
    await fireEvent.click(await view.findByText("#12 修复懒加载"));

    expect(await view.findByRole("heading", { level: 3, name: "#12 修复懒加载" })).toBeInTheDocument();
    expect(getGitHubIssueDiscussion).toHaveBeenCalledWith("sena-nana/remote-repo", 12);
    expect(view.getByRole("heading", { level: 2, name: "复现步骤" })).toBeInTheDocument();
    expect(view.getByText("确认")).toBeInTheDocument();
    expect(view.getByText("已复现")).toBeInTheDocument();
    expect(view.getAllByText("关闭了讨论")).toHaveLength(2);
    expect(view.container.querySelector(".issue-detail__summary")).toBeNull();
    const issueSidebar = view.getByLabelText("Issue 详情侧栏");
    const issueSidebarChips = Array.from(issueSidebar.querySelectorAll(".project-sidebar-detail-card__chip"))
      .map((chip) => chip.textContent ?? "");
    expect(issueSidebar).toHaveTextContent("Issue #12");
    expect(issueSidebar).toHaveTextContent("打开");
    expect(issueSidebar).toHaveTextContent("sena");
    expect(issueSidebar).toHaveTextContent("bug");
    expect(issueSidebar).toHaveTextContent("Roadmap");
    expect(issueSidebar).toHaveTextContent("v1");
    expect(issueSidebarChips).toEqual(expect.arrayContaining(["打开", "sena", "bug", "Roadmap", "v1"]));
    expect(view.container.querySelector("script")).toBeNull();
    await waitFor(() => {
      expect(view.router.currentRoute.value.query).toMatchObject({ projectTab: "issues", issue: "12" });
    });
  });

  it("Actions 列表同一行显示标题与右侧信息，并省略同名来源", async () => {
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue([
      githubWorkflowRuns[0],
      {
        ...githubWorkflowRuns[0],
        id: 1311,
        name: "same action",
        displayTitle: "same action",
        branch: "feature/same",
      },
    ]);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "actions",
    });

    await view.findByRole("button", { name: /release pipeline/ }, { timeout: 5000 });
    const runButtons = Array.from(view.container.querySelectorAll(".actions-run"));
    expect(runButtons).toHaveLength(2);

    const [workflowRun, sameNameRun] = runButtons;
    expect(workflowRun.querySelector(".actions-run__meta")).toHaveTextContent(/^CI · main · /);
    expect(sameNameRun.querySelector(".actions-run__meta")).toHaveTextContent(/^feature\/same · /);
    expect(sameNameRun.querySelector(".actions-run__meta")).not.toHaveTextContent("same action");
  });

  it("Actions 详情先显示流程，点击 job 后显示步骤并预览 artifact", async () => {
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue(githubWorkflowRuns);
    vi.mocked(getGitHubWorkflowRunDetail).mockResolvedValue(githubWorkflowRunDetail);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "actions",
      projectRunId: 1310,
    });

    expect(await view.findByRole("heading", { level: 3, name: "release pipeline" })).toBeInTheDocument();
    expect(await view.findByRole("button", { name: /build/ })).toBeInTheDocument();
    expect(view.container.querySelectorAll(".actions-job-node")).toHaveLength(4);
    expect(view.container.querySelectorAll(".actions-job-graph__edge")).toHaveLength(3);
    expect(view.container.querySelector(".actions-job-node--ok")).toBeInstanceOf(HTMLElement);
    expect(view.queryByText("Run tests")).toBeNull();
    expect(getGitHubWorkflowRunDetail).toHaveBeenCalledWith("sena-nana/remote-repo", 1310, { forceRefresh: false });

    await fireEvent.click(view.getByRole("button", { name: /test/ }));
    expect(await view.findByText("Run tests")).toBeInTheDocument();
    expect(getGitHubWorkflowJobLog).not.toHaveBeenCalled();

    await fireEvent.click(view.getByText("dist"));
    const artifactFile = await view.findByRole("button", { name: /README\.md/ });
    await fireEvent.click(artifactFile);
    expect(await view.findByText("Artifact")).toBeInTheDocument();
    expect(getGitHubWorkflowArtifactFilePreview).toHaveBeenCalledWith("sena-nana/remote-repo", 131001, "README.md");
  });

  it.each([
    {
      tabName: "Issues",
      fail: () => vi.mocked(listGitHubIssues).mockRejectedValueOnce(new Error("GitHub 绑定已失效，请重新绑定")),
      title: "Issues 暂不可用",
      reason: "GitHub 绑定已失效或凭据不可用，请重新绑定 GitHub 后继续使用。",
      hiddenText: "新建 Issue",
    },
    {
      tabName: "Pull Requests",
      fail: () => vi.mocked(listGitHubPullRequests).mockRejectedValueOnce(new Error("Bad credentials")),
      title: "Pull Requests 暂不可用",
      reason: "GitHub 绑定已失效或凭据不可用，请重新绑定 GitHub 后继续使用。",
      hiddenText: "新建 PR",
    },
    {
      tabName: "Actions",
      fail: () => vi.mocked(listGitHubWorkflowRuns).mockRejectedValueOnce(new Error("HTTP 403 Forbidden")),
      title: "Actions 暂不可用",
      reason: "当前 GitHub 授权权限不足，无法访问该仓库的 Actions。请重新绑定 GitHub 并授予所需权限。",
      hiddenText: "没有 GitHub Actions 运行记录。",
    },
    {
      tabName: "Settings",
      fail: () => vi.mocked(getGitHubRepoManagement)
        .mockRejectedValueOnce(new Error("HTTP 403 Resource not accessible by integration"))
        .mockRejectedValueOnce(new Error("HTTP 403 Resource not accessible by integration")),
      title: "Settings 暂不可用",
      reason: "当前 GitHub 授权权限不足，无法访问该仓库的 Settings。请重新绑定 GitHub 并授予所需权限。",
      hiddenText: "基础设置",
    },
  ])("$tabName 因 GitHub 授权不可用时提供重新绑定入口", async ({ tabName, fail, title, reason, hiddenText }) => {
    fail();
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: tabName }));

    expect(await view.findByText(title)).toBeInTheDocument();
    expect(view.getByText(reason)).toBeInTheDocument();
    expect(view.queryByText(hiddenText)).toBeNull();

    await fireEvent.click(view.getByRole("button", { name: "重新绑定 GitHub" }));
    expect(startAuthFlow).toHaveBeenCalledTimes(1);
  });

  it("Pull Requests 分区按需加载列表，点击后进入详情并支持合并", async () => {
    vi.mocked(listGitHubPullRequests).mockResolvedValue(githubPullRequests);
    vi.mocked(listGitHubPullRequestChecks).mockResolvedValue(githubPullRequestChecks);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Pull Requests" }));
    expect(await view.findByText("#52 接入 Pull Request 工作流")).toBeInTheDocument();
    const pullDate = new Date(githubPullRequests[0].updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const pullRow = view.container.querySelector(".project-row--pull[data-pull-number=\"52\"]");
    expect(pullRow).toHaveClass("repo-list-row", "repo-list-row--with-actions");
    expect(pullRow?.querySelector(".repo-list-row__title")).toHaveTextContent("#52 接入 Pull Request 工作流");
    const pullByline = pullRow?.querySelector(".pulls-list__byline") as HTMLElement;
    expect(within(pullByline).getByText("sena")).toBeInTheDocument();
    expect(within(pullByline).getByText("feature/pr-flow -> main")).toBeInTheDocument();
    const pullSide = pullRow?.querySelector(".pulls-list__side") as HTMLElement;
    expect(pullSide).toHaveClass("repo-list-row__meta");
    expect(within(pullSide).getByText(`更新于 ${pullDate}`)).toBeInTheDocument();
    expect(within(pullSide).getByText("bug")).toBeInTheDocument();
    expect(within(pullSide).getByText("Roadmap")).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "合并" })).toBeNull();
    expect(view.queryByRole("button", { name: "关闭" })).toBeNull();
    expect(listGitHubPullRequests).toHaveBeenCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({ state: "open", sort: "updated", direction: "desc" }),
    );
    expect(listGitHubPullRequestChecks).not.toHaveBeenCalled();

    await fireEvent.click(view.getByText("#52 接入 Pull Request 工作流"));
    expect(await view.findByRole("heading", { level: 3, name: "#52 接入 Pull Request 工作流" })).toBeInTheDocument();
    expect(await view.findByText("1 个 checks")).toBeInTheDocument();
    expect(view.getByText("ci / build")).toBeInTheDocument();
    expect(view.getByText("接入 PR 工作流。")).toBeInTheDocument();
    expect(view.container.querySelector(".pull-detail__summary")).toBeNull();
    const pullSidebar = view.getByLabelText("Pull Requests 详情侧栏");
    const pullSidebarChips = Array.from(pullSidebar.querySelectorAll(".project-sidebar-detail-card__chip"))
      .map((chip) => chip.textContent ?? "");
    expect(pullSidebar).toHaveTextContent("PR #52");
    expect(pullSidebar).toHaveTextContent("打开");
    expect(pullSidebar).toHaveTextContent("暂无审阅人");
    expect(pullSidebar).toHaveTextContent("sena");
    expect(pullSidebar).toHaveTextContent("bug");
    expect(pullSidebar).toHaveTextContent("Roadmap");
    expect(pullSidebar).toHaveTextContent("v1");
    expect(pullSidebar).toHaveTextContent("feature/pr-flow -> main");
    expect(pullSidebar).toHaveTextContent("可合并");
    expect(pullSidebarChips).toEqual(expect.arrayContaining([
      "打开",
      "sena",
      "bug",
      "Roadmap",
      "v1",
      "feature/pr-flow -> main",
      "可合并",
    ]));
    expect(getGitHubPullRequestDiscussion).toHaveBeenCalledWith("sena-nana/remote-repo", 52);
    expect(listGitHubPullRequestChecks).toHaveBeenCalledWith("sena-nana/remote-repo", 52);
    await waitFor(() => {
      expect(view.router.currentRoute.value.query).toMatchObject({ projectTab: "pulls", pr: "52" });
    });
    await fireEvent.click(view.getByRole("button", { name: "合并" }));
    await waitFor(() => {
      expect(mergeGitHubPullRequest).toHaveBeenCalledWith("sena-nana/remote-repo", 52, { method: "merge" });
    });
    await fireEvent.click(view.getByRole("button", { name: "Pull Requests" }));
    await waitFor(() => {
      expect(view.router.currentRoute.value.query.pr).toBeUndefined();
    });
    expect(await view.findByText("#52 接入 Pull Request 工作流")).toBeInTheDocument();
  });

  it("Pull Requests 空元信息行使用共享列表布局并显示空态", async () => {
    vi.mocked(listGitHubPullRequests).mockResolvedValue([{
      ...githubPullRequests[0],
      number: 55,
      title: "无元数据 PR",
      labels: [],
      assignees: [],
      milestone: null,
      projectItems: [],
      htmlUrl: "https://github.com/sena-nana/remote-repo/pull/55",
    }]);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Pull Requests" }));
    expect(await view.findByText("#55 无元数据 PR")).toBeInTheDocument();
    const pullRow = view.container.querySelector(".project-row--pull[data-pull-number=\"55\"]");
    expect(pullRow).toHaveClass("repo-list-row", "repo-list-row--with-actions");
    const pullSide = pullRow?.querySelector(".pulls-list__side") as HTMLElement;
    expect(within(pullSide).getByText("无标签 · 未分配 · 无项目")).toBeInTheDocument();
  });

  it("Pull Requests 状态切换按 Open、Closed、Merged 刷新", async () => {
    const closedPull: GitHubPullRequest = {
      ...githubPullRequests[0],
      number: 53,
      title: "关闭未合并 PR",
      state: "closed",
      merged: false,
      htmlUrl: "https://github.com/sena-nana/remote-repo/pull/53",
    };
    const mergedPull: GitHubPullRequest = {
      ...githubPullRequests[0],
      number: 54,
      title: "已合并 PR",
      state: "closed",
      merged: true,
      htmlUrl: "https://github.com/sena-nana/remote-repo/pull/54",
    };
    vi.mocked(listGitHubPullRequests)
      .mockResolvedValueOnce(githubPullRequests)
      .mockResolvedValueOnce([closedPull])
      .mockResolvedValueOnce([mergedPull]);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Pull Requests" }));
    expect(await view.findByText("#52 接入 Pull Request 工作流")).toBeInTheDocument();
    expect(listGitHubPullRequests).toHaveBeenCalledTimes(1);

    await fireEvent.click(within(view.getByRole("group", { name: "Pull Request 状态" })).getByRole("button", { name: /Closed/ }));
    expect(await view.findByText("#53 关闭未合并 PR")).toBeInTheDocument();
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ state: "closed", sort: "updated", direction: "desc" }),
      );
    });

    await fireEvent.click(within(view.getByRole("group", { name: "Pull Request 状态" })).getByRole("button", { name: /Merged/ }));
    expect(await view.findByText("#54 已合并 PR")).toBeInTheDocument();
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ state: "merged", sort: "updated", direction: "desc" }),
      );
    });
    expect(listGitHubPullRequests).toHaveBeenCalledTimes(3);
  });

  it("Pull Requests 搜索、筛选和排序选择后立即传递请求参数", async () => {
    vi.mocked(listGitHubPullRequests).mockResolvedValue(githubPullRequests);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Pull Requests" }));
    expect(await view.findByText("#52 接入 Pull Request 工作流")).toBeInTheDocument();

    await fireEvent.update(view.getByLabelText("搜索 Pull Requests"), "workflow");
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ query: "workflow" }),
      );
    });
    await waitFor(() => {
      expect(view.router.currentRoute.value.query).toMatchObject({
        projectTab: "pulls",
        pullQ: "workflow",
      });
    });

    await fireEvent.click(view.getByRole("button", { name: "筛选" }));
    const filters = view.getByLabelText("Pull Request 筛选项");

    await fireEvent.click(within(filters).getByRole("button", { name: "任意作者" }));
    await fireEvent.click(await within(filters).findByRole("option", { name: "sena" }));
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ creator: "sena" }),
      );
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意标签" }));
    await fireEvent.click(await within(filters).findByRole("option", { name: "bug" }));
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ labels: ["bug"] }),
      );
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意项目" }));
    await fireEvent.click(await within(filters).findByRole("option", { name: "Roadmap" }));
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ project: "PVT_kwDOIssue" }),
      );
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意里程碑" }));
    await fireEvent.click(await within(filters).findByRole("option", { name: "v1" }));
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ milestone: "1" }),
      );
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意 Review" }));
    await fireEvent.click(await within(filters).findByRole("option", { name: "已批准" }));
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ review: "approved" }),
      );
    });
    await waitFor(() => {
      expect(view.router.currentRoute.value.query).toMatchObject({
        pullReview: "approved",
      });
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意负责人" }));
    await fireEvent.click(await within(filters).findByRole("option", { name: "sena" }));
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ assignee: "sena" }),
      );
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "最近更新" }));
    await fireEvent.click(await within(filters).findByRole("option", { name: "评论最多" }));
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ sort: "comments", direction: "desc" }),
      );
    });
  });

  it("Pull Requests 筛选条件可从 URL 恢复", async () => {
    vi.mocked(listGitHubPullRequests).mockResolvedValue(githubPullRequests);
    const view = await renderProjectPanel(
      {
        repoFullName: "sena-nana/remote-repo",
        projectTab: "pulls",
      },
      [
        "/repos/local-repo?projectTab=pulls",
        "pullState=merged",
        "pullQ=workflow",
        "pullCreator=sena",
        "pullLabels=bug",
        "pullReview=approved",
        "pullSort=created",
        "pullDirection=asc",
      ].join("&"),
    );

    expect(await view.findByText("#52 接入 Pull Request 工作流")).toBeInTheDocument();
    expect(view.getByLabelText("搜索 Pull Requests")).toHaveValue("workflow");
    expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({
        state: "merged",
        query: "workflow",
        creator: "sena",
        labels: ["bug"],
        review: "approved",
        sort: "created",
        direction: "asc",
      }),
    );
  });

  it("Issues 分区通过模板创建视图提交 Issue Form", async () => {
    vi.mocked(listGitHubIssues).mockResolvedValue(githubIssues);
    vi.mocked(listGitHubRepoFiles).mockImplementation(async (_repoFullName, parentPath) => (
      parentPath === ".github/ISSUE_TEMPLATE"
        ? [repoFile(".github/ISSUE_TEMPLATE/bug_report.yml")]
        : []
    ));
    vi.mocked(getGitHubRepoFilePreview).mockResolvedValue(filePreview(
      ".github/ISSUE_TEMPLATE/bug_report.yml",
      [
        "name: Bug report",
        "description: Report a bug",
        "title: \"[BUG] \"",
        "labels:",
        "  - bug",
        "  - needs triage",
        "body:",
        "  - type: input",
        "    id: summary",
        "    attributes:",
        "      label: Summary",
        "      placeholder: Broken behavior",
        "    validations:",
        "      required: true",
        "  - type: textarea",
        "    id: details",
        "    attributes:",
        "      label: Details",
        "  - type: dropdown",
        "    id: area",
        "    attributes:",
        "      label: Area",
        "      options:",
        "        - UI",
        "        - Backend",
      ].join("\n"),
    ));
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));
    await view.findByText("#12 修复懒加载");
    await fireEvent.click(view.getByRole("button", { name: "新建 Issue" }));

    const form = await view.findByRole("form", { name: "新建 Issue" });
    expect(view.queryByRole("heading", { level: 3, name: "Issues" })).toBeNull();
    await waitFor(() => {
      expect(getGitHubRepoFilePreview).toHaveBeenCalledWith("sena-nana/remote-repo", ".github/ISSUE_TEMPLATE/bug_report.yml");
    });
    await waitFor(() => {
      expect(listGitHubIssueLabels).toHaveBeenCalledWith("sena-nana/remote-repo", { forceRefresh: false });
      expect(listGitHubIssueAssignees).toHaveBeenCalledWith("sena-nana/remote-repo", { forceRefresh: false });
    });
    await fireEvent.click(within(form).getByRole("button", { name: "空白 Issue" }));
    await fireEvent.click(await within(form).findByRole("option", { name: /Bug report/ }));
    await fireEvent.click(within(form).getByRole("button", { name: "未分配" }));
    await fireEvent.click(await within(form).findByRole("option", { name: /^sena$/ }));
    await fireEvent.update(within(form).getByLabelText("标题"), "[BUG] 模板创建");
    await fireEvent.update(within(form).getByLabelText("Summary*"), "点击按钮后没有进入创建页");
    await fireEvent.update(within(form).getByLabelText("Details"), "需要展示完整模板表单。");
    await fireEvent.click(within(form).getByRole("button", { name: "Area" }));
    await fireEvent.click(await within(form).findByRole("option", { name: /^UI$/ }));
    await fireEvent.click(within(form).getByRole("button", { name: "创建 Issue" }));

    await waitFor(() => {
      expect(createGitHubIssue).toHaveBeenCalledWith("sena-nana/remote-repo", {
        title: "[BUG] 模板创建",
        body: expect.stringContaining("### Summary\n\n点击按钮后没有进入创建页"),
        labels: ["bug", "needs triage"],
        assignees: ["sena"],
      });
    });
    expect(createGitHubIssue).toHaveBeenCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({
        body: expect.stringContaining("### Area\n\nUI"),
      }),
    );
    await waitFor(() => {
      expect(view.queryByRole("form", { name: "新建 Issue" })).toBeNull();
    });
  });

  it("Pull Requests 分区通过模板创建视图提交默认分支表单", async () => {
    state.repos = [repoSummary("local-repo", { currentBranch: "feature/template-create" })];
    vi.mocked(listGitHubPullRequests).mockResolvedValue(githubPullRequests);
    vi.mocked(listGitHubRepoFiles).mockImplementation(async (_repoFullName, parentPath) => (
      parentPath === ".github"
        ? [repoFile(".github/PULL_REQUEST_TEMPLATE.md")]
        : []
    ));
    vi.mocked(getGitHubRepoFilePreview).mockResolvedValue(filePreview(
      ".github/PULL_REQUEST_TEMPLATE.md",
      "## Summary\n\n- \n",
    ));
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Pull Requests" }));
    await view.findByText("#52 接入 Pull Request 工作流");
    await fireEvent.click(view.getByRole("button", { name: "新建 PR" }));

    const form = await view.findByRole("form", { name: "新建 PR" });
    expect(view.queryByRole("heading", { level: 3, name: "Pull Requests" })).toBeNull();
    await waitFor(() => {
      expect(getGitHubRepoFilePreview).toHaveBeenCalledWith("sena-nana/remote-repo", ".github/PULL_REQUEST_TEMPLATE.md");
    });
    await fireEvent.click(within(form).getByRole("button", { name: "空白 PR" }));
    await fireEvent.click(await within(form).findByRole("option", { name: /PULL REQUEST TEMPLATE/ }));
    expect(within(form).getByLabelText("来源分支")).toHaveValue("feature/template-create");
    expect(within(form).getByLabelText("目标分支")).toHaveValue("main");

    await fireEvent.update(within(form).getByLabelText("标题"), "接入模板创建页");
    expect(within(form).getByLabelText("描述")).toHaveValue("## Summary\n\n- \n");
    await fireEvent.click(within(form).getByRole("button", { name: "创建 PR" }));

    await waitFor(() => {
      expect(createGitHubPullRequest).toHaveBeenCalledWith("sena-nana/remote-repo", {
        title: "接入模板创建页",
        body: "## Summary\n\n- \n",
        head: "feature/template-create",
        base: "main",
        draft: false,
      });
    });
    await waitFor(() => {
      expect(view.queryByRole("form", { name: "新建 PR" })).toBeNull();
    });
  });

  it("issues 过滤切换只触发一次刷新请求", async () => {
    vi.mocked(listGitHubIssues)
      .mockResolvedValueOnce(githubIssues)
      .mockResolvedValueOnce(closedGitHubIssues);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));
    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();
    expect(listGitHubIssues).toHaveBeenCalledTimes(1);

    await fireEvent.click(within(view.getByRole("group", { name: "Issue 状态" })).getByRole("button", { name: /Closed/ }));
    expect(await view.findByText("#34 已关闭问题")).toBeInTheDocument();
    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenCalledTimes(2);
    });
    expect(listGitHubIssues).toHaveBeenLastCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({ state: "closed", sort: "created", direction: "desc" }),
    );
  });

  it("Issues 搜索通过远程接口刷新列表", async () => {
    const docsIssue: GitHubIssue = {
      ...githubIssues[0],
      number: 44,
      title: "整理文档",
      labels: ["documentation"],
      projectItems: [],
      htmlUrl: "https://github.com/sena-nana/remote-repo/issues/44",
    };
    vi.mocked(listGitHubIssues)
      .mockResolvedValueOnce([githubIssues[0], docsIssue])
      .mockResolvedValueOnce([githubIssues[0]]);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));
    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();
    expect(view.getByText("#44 整理文档")).toBeInTheDocument();
    expect(listGitHubIssues).toHaveBeenCalledTimes(1);

    await fireEvent.update(view.getByLabelText("搜索 Issues"), "Roadmap");

    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ query: "Roadmap" }),
      );
    });
    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();
    expect(view.queryByText("#44 整理文档")).toBeNull();
    expect(listGitHubIssues).toHaveBeenCalledTimes(2);
  });

  it("Issues 筛选和排序选择后立即传递请求参数", async () => {
    vi.mocked(listGitHubIssues).mockResolvedValue(githubIssues);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));
    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();
    await fireEvent.click(view.getByRole("button", { name: "筛选" }));
    const filters = view.getByLabelText("Issue 筛选项");

    await fireEvent.click(within(filters).getByRole("button", { name: "任意作者" }));
    await fireEvent.click(await within(filters).findByRole("option", { name: "sena" }));
    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ creator: "sena" }),
      );
    });
    await waitFor(() => {
      expect(view.router.currentRoute.value.query).toMatchObject({
        projectTab: "issues",
        issueCreator: "sena",
      });
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意标签" }));
    await fireEvent.click(await within(filters).findByRole("option", { name: "bug" }));
    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ labels: ["bug"] }),
      );
    });
    await waitFor(() => {
      expect(view.router.currentRoute.value.query.issueLabels).toEqual(["bug"]);
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意项目" }));
    await fireEvent.click(await within(filters).findByRole("option", { name: "Roadmap" }));
    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ project: "PVT_kwDOIssue" }),
      );
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意里程碑" }));
    await fireEvent.click(await within(filters).findByRole("option", { name: "v1" }));
    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ milestone: "1" }),
      );
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意负责人" }));
    await fireEvent.click(await within(filters).findByRole("option", { name: "sena" }));
    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ assignee: "sena" }),
      );
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "最新创建" }));
    await fireEvent.click(await within(filters).findByRole("option", { name: "评论最多" }));
    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ sort: "comments", direction: "desc" }),
      );
    });
  });

  it("Issues 筛选条件可从 URL 恢复", async () => {
    vi.mocked(listGitHubIssues).mockResolvedValue(githubIssues);
    const view = await renderProjectPanel(
      {
        repoFullName: "sena-nana/remote-repo",
        projectTab: "issues",
      },
      [
        "/repos/local-repo?projectTab=issues",
        "issueState=closed",
        "issueQ=Roadmap",
        "issueCreator=sena",
        "issueLabels=bug",
        "issueLabels=documentation",
        "issueSort=updated",
        "issueDirection=asc",
      ].join("&"),
    );

    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();
    expect(view.getByLabelText("搜索 Issues")).toHaveValue("Roadmap");
    expect(listGitHubIssues).toHaveBeenLastCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({
        state: "closed",
        query: "Roadmap",
        creator: "sena",
        labels: ["bug", "documentation"],
        sort: "updated",
        direction: "asc",
      }),
    );
  });

  it("项目刷新 token 变化后对当前已加载分区强制刷新", async () => {
    vi.mocked(listGitHubIssues)
      .mockResolvedValueOnce(githubIssues)
      .mockResolvedValueOnce([{ ...githubIssues[0], title: "刷新后的 Issue" }]);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectRefreshToken: 1,
    });

    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));
    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();
    expect(listGitHubIssues).toHaveBeenCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({ state: "open", sort: "created", direction: "desc" }),
    );

    await view.rerender({ projectRefreshToken: 2 });

    expect(await view.findByText("#12 刷新后的 Issue")).toBeInTheDocument();
    expect(listGitHubIssues).toHaveBeenLastCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({ state: "open", sort: "created", direction: "desc" }),
      { forceRefresh: true },
    );
  });

  it("创建 Issue 请求返回后不会插入已切换仓库的 Issues 列表", async () => {
    const createResult = deferred<GitHubIssue>();
    const nextRepoIssues: GitHubIssue[] = [{
      ...githubIssues[0],
      number: 77,
      title: "next repo issue",
      htmlUrl: "https://github.com/sena-nana/next-repo/issues/77",
    }];
    vi.mocked(listGitHubIssues).mockImplementation(async (repoFullName) => (
      repoFullName === "sena-nana/next-repo" ? nextRepoIssues : githubIssues
    ));
    vi.mocked(createGitHubIssue).mockReturnValue(createResult.promise);

    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "issues",
    });
    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));
    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();

    await fireEvent.click(view.getByRole("button", { name: "新建 Issue" }));
    const form = await view.findByRole("form", { name: "新建 Issue" });
    await fireEvent.update(within(form).getByLabelText("标题"), "old repo created issue");
    await fireEvent.click(within(form).getByRole("button", { name: "创建 Issue" }));
    expect(createGitHubIssue).toHaveBeenCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({ title: "old repo created issue" }),
    );

    await view.rerender({
      repoFullName: "sena-nana/next-repo",
      projectTab: "issues",
    });
    expect(await view.findByText("#77 next repo issue")).toBeInTheDocument();

    createResult.resolve({
      ...githubIssues[0],
      number: 88,
      title: "old repo created issue",
      htmlUrl: "https://github.com/sena-nana/remote-repo/issues/88",
    });

    await waitFor(() => {
      expect(view.getByText("#77 next repo issue")).toBeInTheDocument();
    });
    expect(view.queryByText("#88 old repo created issue")).toBeNull();
  });

  it("linked worktree 在设置区显示删除工作树文案", async () => {
    state.repos = [
      repoSummary("local-repo", {
        worktree: {
          role: "linked",
          sharedRepoKey: "shared:repo",
          mainRepoId: "main-repo",
        },
      }),
    ];
    const view = await renderProjectPanel({ projectTab: "settings" });

    await waitFor(() => {
      expect(view.getByRole("button", { name: "删除工作树" })).toBeInTheDocument();
    });
    await fireEvent.click(view.getByRole("button", { name: "删除工作树" }));
    expect(await view.findByRole("dialog", { name: "删除工作树" })).toBeInTheDocument();
    expect(view.getByText(/从当前共享仓库移除工作树/)).toBeInTheDocument();
  });

  it("仓库设置分区展示并统一保存功能开关", async () => {
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });
    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));

    expect(await view.findByRole("heading", { level: 4, name: "基础设置" })).toBeInTheDocument();
    expect(view.getByRole("heading", { level: 4, name: "功能开关" })).toBeInTheDocument();
    expect(view.getByRole("heading", { level: 4, name: "Pull Request / Merge" })).toBeInTheDocument();
    expect(view.getByLabelText("本地危险操作")).toBeInTheDocument();
    expect(view.getByLabelText("远端危险操作")).toBeInTheDocument();
    expect(view.queryByText("默认分支")).toBeNull();

    const wikiSwitch = view.getByRole("checkbox", { name: /Wiki/ });
    await fireEvent.click(wikiSwitch);
    await fireEvent.click(view.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(updateGitHubRepoSettings).toHaveBeenCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ hasWiki: true }),
      );
    });
    expect(vi.mocked(updateGitHubRepoSettings).mock.calls[0][1]).not.toHaveProperty("defaultBranch");
  });

  it("保存设置请求返回后不会覆盖已切换仓库的设置状态", async () => {
    const saveResult = deferred<GitHubRepoManagement>();
    const nextSettings = {
      ...githubSettings,
      fullName: "sena-nana/next-repo",
      name: "next-repo",
      description: "Next repository tools",
      htmlUrl: "https://github.com/sena-nana/next-repo",
    };
    vi.mocked(getGitHubRepoManagement).mockImplementation(async (repoFullName) => (
      repoFullName === "sena-nana/next-repo" ? nextSettings : githubSettings
    ));
    vi.mocked(updateGitHubRepoSettings).mockReturnValue(saveResult.promise);

    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "settings",
    });
    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));
    expect(await view.findByLabelText("Settings 摘要")).toHaveTextContent("sena-nana/remote-repo");

    await fireEvent.click(view.getByRole("checkbox", { name: /Wiki/ }));
    await fireEvent.click(view.getByRole("button", { name: "保存" }));
    expect(updateGitHubRepoSettings).toHaveBeenCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({ hasWiki: true }),
    );

    await view.rerender({
      repoFullName: "sena-nana/next-repo",
      projectTab: "settings",
    });
    expect(await view.findByLabelText("Settings 摘要")).toHaveTextContent("sena-nana/next-repo");

    saveResult.resolve({
      ...githubSettings,
      description: "Old saved description",
      hasWiki: true,
    });

    await waitFor(() => {
      expect(view.getByLabelText("Settings 摘要")).toHaveTextContent("sena-nana/next-repo");
    });
    expect(view.queryByText("Old saved description")).toBeNull();
  });

  it("删除远端仓库请求返回后不会标记已切换仓库为删除状态", async () => {
    const deleteResult = deferred<void>();
    const nextSettings = {
      ...githubSettings,
      fullName: "sena-nana/next-repo",
      name: "next-repo",
      description: "Next repository tools",
      htmlUrl: "https://github.com/sena-nana/next-repo",
    };
    vi.mocked(getGitHubRepoManagement).mockImplementation(async (repoFullName) => (
      repoFullName === "sena-nana/next-repo" ? nextSettings : githubSettings
    ));
    vi.mocked(deleteGitHubRepo).mockReturnValue(deleteResult.promise);

    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "settings",
    });
    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));
    expect(await view.findByLabelText("Settings 摘要")).toHaveTextContent("sena-nana/remote-repo");

    await fireEvent.click(view.getByRole("button", { name: "删除仓库" }));
    const dialog = await view.findByRole("dialog", { name: "删除 GitHub 仓库" });
    await fireEvent.update(within(dialog).getByPlaceholderText("sena-nana/remote-repo"), "sena-nana/remote-repo");
    await fireEvent.click(within(dialog).getByRole("button", { name: "确认删除" }));
    expect(deleteGitHubRepo).toHaveBeenCalledWith("sena-nana/remote-repo");

    await view.rerender({
      repoFullName: "sena-nana/next-repo",
      projectTab: "settings",
    });
    expect(await view.findByLabelText("Settings 摘要")).toHaveTextContent("sena-nana/next-repo");

    deleteResult.resolve();

    await waitFor(() => {
      expect(view.getByLabelText("Settings 摘要")).toHaveTextContent("sena-nana/next-repo");
    });
    expect(view.queryByText("GitHub 远端仓库已删除，本地目录仍保留。")).toBeNull();
  });

  it("描述卡片支持编辑描述、homepage 和 topics", async () => {
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    expect(await view.findByText("Remote repository tools")).toBeInTheDocument();
    await fireEvent.click(view.getByRole("button", { name: "编辑仓库描述" }));
    await fireEvent.update(view.getByPlaceholderText("Description"), "Updated description");
    await fireEvent.update(view.getByPlaceholderText("Homepage"), "https://example.com/new");
    const topicInput = view.getByPlaceholderText("Add topics");
    await fireEvent.update(topicInput, "Vue, codex");
    await fireEvent.keyDown(topicInput, { key: "Enter" });
    await fireEvent.click(view.getByRole("button", { name: "移除 tauri" }));
    await fireEvent.click(view.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(updateGitHubRepoSettings).toHaveBeenCalledWith("sena-nana/remote-repo", {
        description: "Updated description",
        homepage: "https://example.com/new",
        topics: ["vue", "codex"],
      });
    });
  });

  it("topics 编辑支持逗号拆分、退格删除和取消恢复", async () => {
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await view.findByText("Remote repository tools");
    await fireEvent.click(view.getByRole("button", { name: "编辑仓库描述" }));
    const topicInput = view.getByPlaceholderText("Add topics");
    await fireEvent.update(topicInput, "Docs, docs api");
    await fireEvent.keyDown(topicInput, { key: "," });
    expect(view.getByRole("button", { name: "移除 docs" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "移除 api" })).toBeInTheDocument();
    await fireEvent.keyDown(topicInput, { key: "Backspace" });
    expect(view.queryByRole("button", { name: "移除 api" })).toBeNull();
    await fireEvent.click(view.getByRole("button", { name: "取消" }));

    expect(view.queryByRole("button", { name: "移除 docs" })).toBeNull();
    expect(within(view.getByLabelText("Topics")).getByText("tauri")).toBeInTheDocument();
  });
});

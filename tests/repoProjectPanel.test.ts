import { fireEvent, render, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepoProjectPanel from "../src/components/repo/RepoProjectPanel.vue";
import { closeContextMenu, installContextMenu } from "../src/composables/useContextMenu";
import { startAuthFlow } from "../src/composables/workspace/auth";
import { state } from "../src/composables/workspace/state";
import { vContextMenu } from "../src/directives/contextMenu";
import {
  createGitHubIssue,
  deleteGitHubRepo,
  getGitHubRepoManagement,
  listGitHubPullRequestChecks,
  listGitHubPullRequests,
  listGitHubIssues,
  listGitHubWorkflowRuns,
  listRepoReadmes,
  mergeGitHubPullRequest,
  updateGitHubRepoSettings,
} from "../src/services/workspace/client";
import { setFallbackGitHubCommitDetailsForTests } from "../src/services/workspace/fallback";
import type {
  CommitDetail,
  CommitSummary,
  GitHubIssue,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubRepoManagement,
  GitHubWorkflowRun,
  ProjectLaunchConfig,
  ProjectLaunchLog,
} from "../src/services/workspace/types";
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
};

const githubIssues: GitHubIssue[] = [{
  number: 12,
  title: "修复懒加载",
  state: "open",
  body: null,
  labels: ["bug"],
  assignees: ["sena"],
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
}];

const githubPullRequests: GitHubPullRequest[] = [{
  number: 52,
  title: "接入 Pull Request 工作流",
  state: "open",
  draft: false,
  body: null,
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

vi.mock("../src/services/workspace/client", () => ({
  createGitHubPullRequest: vi.fn(),
  createGitHubIssue: vi.fn(),
  deleteGitHubRepo: vi.fn(),
  getRepoCommitDetail: vi.fn(),
  getGitHubRepoManagement: vi.fn(),
  listGitHubPullRequestChecks: vi.fn(),
  listGitHubPullRequests: vi.fn(),
  listGitHubIssues: vi.fn(),
  listGitHubRepoReadmes: vi.fn(async () => []),
  listGitHubWorkflowRuns: vi.fn(),
  isGitHubBindingExpiredError: (err: unknown) => {
    const message = String(err);
    return message.includes("GitHub 绑定已失效") ||
      message.includes("HTTP 401") ||
      message.includes("HTTP 403") ||
      message.toLowerCase().includes("bad credentials");
  },
  mergeGitHubPullRequest: vi.fn(),
  listRepoReadmes: vi.fn(async () => []),
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

async function renderProjectPanel(props: Partial<InstanceType<typeof RepoProjectPanel>["$props"]> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/repos/:repoId(.*)", component: { template: "<div />" } }],
  });
  await router.push("/repos/local-repo");
  await router.isReady();

  return render(RepoProjectPanel, {
    props: {
      repoId: "local-repo",
      repoFullName: null,
      repoPath: "C:\\Files\\workspace\\local-repo",
      repoSummary: null,
      launchConfig,
      launchLogs: [],
      launchTerminalVisible: false,
      actionRunning: false,
      launchRunning: false,
      remoteOnly: false,
      activeGitTab: "repo",
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
      projectRefreshToken: 0,
      ...props,
    },
    global: {
      plugins: [router],
      directives: {
        contextMenu: vContextMenu,
      },
    },
  });
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
  beforeEach(() => {
    closeContextMenu();
    installContextMenu();
    vi.clearAllMocks();
    vi.mocked(createGitHubIssue).mockReset();
    vi.mocked(deleteGitHubRepo).mockReset();
    vi.mocked(getGitHubRepoManagement).mockReset();
    vi.mocked(updateGitHubRepoSettings).mockReset();
    vi.mocked(getGitHubRepoManagement).mockResolvedValue(githubSettings);
    vi.mocked(updateGitHubRepoSettings).mockImplementation(async (_repoFullName, request) => ({
      ...githubSettings,
      ...request,
      description: request.description ?? githubSettings.description,
      homepage: request.homepage ?? githubSettings.homepage,
      topics: request.topics ? [...request.topics] : [...githubSettings.topics],
    }));
    vi.mocked(listGitHubPullRequests).mockResolvedValue([]);
    vi.mocked(listGitHubPullRequestChecks).mockResolvedValue([]);
    vi.mocked(mergeGitHubPullRequest).mockImplementation(async () => ({ ...githubPullRequests[0], merged: true, state: "closed" }));
    vi.mocked(listGitHubIssues).mockResolvedValue([]);
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue([]);
    vi.mocked(listRepoReadmes).mockResolvedValue([]);
    setFallbackGitHubCommitDetailsForTests({
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
      remoteOnly: true,
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
      remoteOnly: true,
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
      remoteOnly: true,
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
      expect(listRepoReadmes).toHaveBeenCalledWith("local-repo");
    });
    expect(await view.findByText("Remote repository tools")).toBeInTheDocument();
    expect(view.getByText("https://example.com/remote")).toBeInTheDocument();
    expect(view.getByText("vue")).toBeInTheDocument();
    const tauriTopic = view.getByText("tauri");
    const starsStat = view.getByLabelText("128 stars");
    expect(tauriTopic).toBeInTheDocument();
    expect(starsStat).toBeInTheDocument();
    expect(view.getByLabelText("9 watching")).toBeInTheDocument();
    expect(view.getByLabelText("14 forks")).toBeInTheDocument();
    expect(tauriTopic.compareDocumentPosition(starsStat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getGitHubRepoManagement).toHaveBeenCalledTimes(1);
    expect(listGitHubIssues).not.toHaveBeenCalled();
    expect(listGitHubWorkflowRuns).not.toHaveBeenCalled();
  });

  it("切换到对应分区时才按需请求 settings、issues 和 actions", async () => {
    vi.mocked(getGitHubRepoManagement).mockResolvedValue(githubSettings);
    vi.mocked(listGitHubIssues).mockResolvedValue(githubIssues);
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue(githubWorkflowRuns);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));
    expect(await view.findByRole("heading", { level: 4, name: "基础设置" })).toBeInTheDocument();
    expect(getGitHubRepoManagement).toHaveBeenCalledTimes(1);
    expect(listGitHubIssues).not.toHaveBeenCalled();
    expect(listGitHubWorkflowRuns).not.toHaveBeenCalled();

    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));
    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();
    expect(listGitHubIssues).toHaveBeenCalledTimes(1);
    expect(listGitHubWorkflowRuns).not.toHaveBeenCalled();

    await fireEvent.click(view.getByRole("tab", { name: "Actions" }));
    expect(await view.findByText("release pipeline")).toBeInTheDocument();
    expect(listGitHubWorkflowRuns).toHaveBeenCalledTimes(1);
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

  it("Pull Requests 分区按需加载列表、checks，并支持合并", async () => {
    vi.mocked(listGitHubPullRequests).mockResolvedValue(githubPullRequests);
    vi.mocked(listGitHubPullRequestChecks).mockResolvedValue(githubPullRequestChecks);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Pull Requests" }));
    expect(await view.findByText("#52 接入 Pull Request 工作流")).toBeInTheDocument();
    expect(await view.findByText("1 个 checks")).toBeInTheDocument();
    expect(view.getByText("ci / build")).toBeInTheDocument();
    expect(listGitHubPullRequests).toHaveBeenCalledWith("sena-nana/remote-repo", "open");
    expect(listGitHubPullRequestChecks).toHaveBeenCalledWith("sena-nana/remote-repo", 52);

    await fireEvent.click(view.getByRole("button", { name: "合并" }));
    await waitFor(() => {
      expect(mergeGitHubPullRequest).toHaveBeenCalledWith("sena-nana/remote-repo", 52, { method: "merge" });
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

    await fireEvent.click(within(view.getByRole("group", { name: "Issue 状态" })).getByRole("button", { name: "Closed" }));
    expect(await view.findByText("#34 已关闭问题")).toBeInTheDocument();
    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenCalledTimes(2);
    });
    expect(listGitHubIssues).toHaveBeenLastCalledWith("sena-nana/remote-repo", "closed");
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
    expect(listGitHubIssues).toHaveBeenCalledWith("sena-nana/remote-repo", "open");

    await view.rerender({ projectRefreshToken: 2 });

    expect(await view.findByText("#12 刷新后的 Issue")).toBeInTheDocument();
    expect(listGitHubIssues).toHaveBeenLastCalledWith(
      "sena-nana/remote-repo",
      "open",
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

    await fireEvent.update(view.getByPlaceholderText("Issue 标题"), "old repo created issue");
    await fireEvent.click(view.getByRole("button", { name: "新建 Issue" }));
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
    expect(await view.findByText("Remote repository tools")).toBeInTheDocument();

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
    expect(await view.findByText("Next repository tools")).toBeInTheDocument();

    saveResult.resolve({
      ...githubSettings,
      description: "Old saved description",
      hasWiki: true,
    });

    await waitFor(() => {
      expect(view.getByText("Next repository tools")).toBeInTheDocument();
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
    expect(await view.findByText("Remote repository tools")).toBeInTheDocument();

    await fireEvent.click(view.getByRole("button", { name: "删除仓库" }));
    const dialog = await view.findByRole("dialog", { name: "删除 GitHub 仓库" });
    await fireEvent.update(within(dialog).getByPlaceholderText("sena-nana/remote-repo"), "sena-nana/remote-repo");
    await fireEvent.click(within(dialog).getByRole("button", { name: "确认删除" }));
    expect(deleteGitHubRepo).toHaveBeenCalledWith("sena-nana/remote-repo");

    await view.rerender({
      repoFullName: "sena-nana/next-repo",
      projectTab: "settings",
    });
    expect(await view.findByText("Next repository tools")).toBeInTheDocument();

    deleteResult.resolve();

    await waitFor(() => {
      expect(view.getByText("Next repository tools")).toBeInTheDocument();
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
    expect(view.getByText("tauri")).toBeInTheDocument();
  });
});

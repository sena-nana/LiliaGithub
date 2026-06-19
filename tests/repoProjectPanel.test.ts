import { fireEvent, render, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepoProjectPanel from "../src/components/repo/RepoProjectPanel.vue";
import { closeContextMenu, installContextMenu } from "../src/composables/useContextMenu";
import { startAuthFlow } from "../src/composables/workspace/auth";
import { state } from "../src/composables/workspace/state";
import {
  getGitHubRepoManagement,
  listGitHubPullRequestChecks,
  listGitHubPullRequests,
  listGitHubIssues,
  listGitHubWorkflowRuns,
  listRepoReadmes,
  mergeGitHubPullRequest,
  updateGitHubRepoSettings,
} from "../src/services/workspace/client";
import type {
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
  description: null,
  homepage: null,
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
  updateGitHubRepoSettings: vi.fn(async () => githubSettings),
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
      ...props,
    },
    global: {
      plugins: [router],
    },
  });
}

describe("RepoProjectPanel", () => {
  beforeEach(() => {
    closeContextMenu();
    installContextMenu();
    vi.clearAllMocks();
    vi.mocked(getGitHubRepoManagement).mockResolvedValue(githubSettings);
    vi.mocked(listGitHubPullRequests).mockResolvedValue([]);
    vi.mocked(listGitHubPullRequestChecks).mockResolvedValue([]);
    vi.mocked(mergeGitHubPullRequest).mockImplementation(async () => ({ ...githubPullRequests[0], merged: true, state: "closed" }));
    vi.mocked(listGitHubIssues).mockResolvedValue([]);
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue([]);
    vi.mocked(listRepoReadmes).mockResolvedValue([]);
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

  it("默认 readme 首屏不预取 GitHub settings、issues 和 workflow runs", async () => {
    await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await waitFor(() => {
      expect(listRepoReadmes).toHaveBeenCalledWith("local-repo");
    });
    expect(getGitHubRepoManagement).not.toHaveBeenCalled();
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
      fail: () => vi.mocked(getGitHubRepoManagement).mockRejectedValueOnce(new Error("HTTP 403 Resource not accessible by integration")),
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
});

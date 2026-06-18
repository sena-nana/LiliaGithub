import { fireEvent, render, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepoProjectPanel from "../src/components/repo/RepoProjectPanel.vue";
import { closeContextMenu, installContextMenu } from "../src/composables/useContextMenu";
import { state } from "../src/composables/workspace/state";
import { updateGitHubRepoSettings } from "../src/services/workspace/client";
import type {
  GitHubRepoManagement,
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

vi.mock("../src/services/workspace/client", () => ({
  createGitHubIssue: vi.fn(),
  deleteGitHubRepo: vi.fn(),
  getRepoCommitDetail: vi.fn(),
  getGitHubRepoManagement: vi.fn(async () => githubSettings),
  listGitHubIssues: vi.fn(async () => []),
  listGitHubRepoReadmes: vi.fn(async () => []),
  listGitHubWorkflowRuns: vi.fn(async () => []),
  listRepoReadmes: vi.fn(async () => []),
  openPath: vi.fn(),
  openUrl: vi.fn(),
  updateGitHubIssue: vi.fn(),
  updateGitHubRepoSettings: vi.fn(async () => githubSettings),
}));

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

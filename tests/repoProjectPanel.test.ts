import { fireEvent, render, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ContextMenuHost from "../src/components/ContextMenuHost.vue";
import RepoProjectPanel from "../src/components/repo/RepoProjectPanel.vue";
import { closeContextMenu, installContextMenu } from "../src/composables/useContextMenu";
import { deleteGitHubBranch, listGitHubBranches, updateGitHubRepoSettings } from "../src/services/workspace/client";
import type {
  BranchSummary,
  GitHubRepoManagement,
  ProjectLaunchCandidate,
  ProjectLaunchConfig,
} from "../src/services/workspace/types";

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

const remoteBranches: BranchSummary[] = [
  {
    name: "main",
    remote: true,
    current: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    protected: true,
  },
  {
    name: "release",
    remote: true,
    current: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    protected: false,
  },
];

vi.mock("../src/services/workspace/client", () => ({
  createGitHubIssue: vi.fn(),
  deleteGitHubBranch: vi.fn(async () => undefined),
  deleteGitHubRepo: vi.fn(),
  getRepoCommitDetail: vi.fn(),
  getGitHubRepoManagement: vi.fn(async () => githubSettings),
  listGitHubBranches: vi.fn(async () => remoteBranches),
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

const launchCandidates: ProjectLaunchCandidate[] = [
  {
    command: "yarn dev",
    label: "Vite dev",
    hint: "package.json",
    kind: "package",
    cwd: null,
  },
];

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
      loading: false,
      launchConfig,
      launchStatus: null,
      launchCandidates,
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
      branches: [],
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
  });

  it("本地仓库在命令运行页显示启动终端", async () => {
    const view = await renderProjectPanel({ activeGitTab: "run" });

    const terminalCard = view.container.querySelector(".project-terminal-card");
    expect(terminalCard).toBeInstanceOf(HTMLElement);
    const terminal = view.getByLabelText("启动终端");
    expect(within(terminal).getByText("当前指令：yarn dev")).toBeInTheDocument();
    expect(within(terminalCard as HTMLElement).getByRole("button", { name: "yarn dev" })).toBeInTheDocument();
    await fireEvent.click(within(terminalCard as HTMLElement).getByRole("button", { name: "运行" }));
    expect(view.emitted("start")).toHaveLength(1);
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

  it("本地仓库分支栏单击只选中，双击才切换分支", async () => {
    const view = await renderProjectPanel({
      activeGitTab: "branches",
      branches: [
        {
          name: "main",
          remote: false,
          current: true,
          upstream: "origin/main",
          ahead: 1,
          behind: 0,
          protected: false,
        },
        {
          name: "feature/local",
          remote: false,
          current: false,
          upstream: null,
          ahead: 0,
          behind: 0,
          protected: false,
        },
      ],
    });

    expect(view.getByText("feature/local")).toBeInTheDocument();
    const featureRow = view.getByRole("button", { name: /feature\/local/ });
    await fireEvent.click(featureRow);
    expect(view.emitted("checkout")).toBeUndefined();

    await fireEvent.dblClick(featureRow);
    expect(view.emitted("checkout")).toEqual([["feature/local"]]);
  });

  it("本地仓库分支右键提供更新、合并和二次确认删除", async () => {
    const view = await renderProjectPanel({
      activeGitTab: "branches",
      branches: [
        {
          name: "main",
          remote: false,
          current: true,
          upstream: "origin/main",
          ahead: 1,
          behind: 0,
          protected: false,
        },
        {
          name: "feature/local",
          remote: false,
          current: false,
          upstream: null,
          ahead: 0,
          behind: 0,
          protected: false,
        },
      ],
    });
    render(ContextMenuHost);

    await fireEvent.contextMenu(view.getByRole("button", { name: /main/ }));
    expect(await view.findByRole("menuitem", { name: "更新" })).toBeInTheDocument();
    expect(view.queryByRole("menuitem", { name: "合并到当前分支" })).toBeNull();
    await fireEvent.click(view.getByRole("menuitem", { name: "更新" }));
    expect(view.emitted("updateCurrentBranch")).toHaveLength(1);

    await fireEvent.contextMenu(view.getByRole("button", { name: /feature\/local/ }));
    await fireEvent.click(await view.findByRole("menuitem", { name: "合并到当前分支" }));
    expect(view.emitted("mergeBranch")).toEqual([["feature/local"]]);

    await fireEvent.contextMenu(view.getByRole("button", { name: /feature\/local/ }));
    await fireEvent.click(await view.findByRole("menuitem", { name: "删除" }));
    expect(view.emitted("deleteBranch")).toBeUndefined();
    await fireEvent.click(view.getByRole("menuitem", { name: "确认删除" }));
    expect(view.emitted("deleteBranch")).toEqual([["feature/local"]]);
  });

  it("远程仓库分支栏加载 GitHub 分支并可设默认分支", async () => {
    const view = await renderProjectPanel({
      repoId: "github:sena-nana/remote-repo",
      repoFullName: "sena-nana/remote-repo",
      repoPath: "",
      remoteOnly: true,
      activeGitTab: "branches",
    });

    await waitFor(() => {
      expect(listGitHubBranches).toHaveBeenCalledWith("sena-nana/remote-repo");
    });
    expect(await view.findByText("release")).toBeInTheDocument();

    await fireEvent.click(view.getAllByRole("button", { name: "设为默认" })[1]);

    await waitFor(() => {
      expect(updateGitHubRepoSettings).toHaveBeenCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ defaultBranch: "release" }),
      );
    });
  });

  it("远程仓库删除分支需要输入完整分支名", async () => {
    const view = await renderProjectPanel({
      repoId: "github:sena-nana/remote-repo",
      repoFullName: "sena-nana/remote-repo",
      repoPath: "",
      remoteOnly: true,
      activeGitTab: "branches",
    });

    expect(await view.findByText("release")).toBeInTheDocument();

    const deleteButtons = view.getAllByRole("button", { name: "删除" });
    expect(deleteButtons[0]).toBeDisabled();
    await fireEvent.click(deleteButtons[1]);

    const dialog = await view.findByRole("dialog", { name: "删除远程分支" });
    const confirm = within(dialog).getByRole("button", { name: "确认删除" });
    expect(confirm).toBeDisabled();

    await fireEvent.update(within(dialog).getByPlaceholderText("release"), "release");
    expect(confirm).not.toBeDisabled();
    await fireEvent.click(confirm);

    await waitFor(() => {
      expect(deleteGitHubBranch).toHaveBeenCalledWith("sena-nana/remote-repo", "release");
    });
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

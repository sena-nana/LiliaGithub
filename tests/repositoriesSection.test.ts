import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepositoriesSection from "../src/pages/settings/RepositoriesSection.vue";
import { createGitHubRepo, listGitHubRepoOwners, type GitHubRepoSummary } from "../src/services/workspace";
import { repoSummary, workspaceSettings } from "./fixtures/workspace";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

const workspace = vi.hoisted(() => ({
  state: {
    settings: {
      workspaceRoot: "C:\\Files\\workspace",
      githubBinding: null,
      projectLaunchConfigs: {},
      repoSyncPreferences: {},
      hiddenRepoIds: [],
      managedRepoIds: [],
      systemGitRepoIds: ["LiliaGithub"],
      repoGroups: [],
      remoteRepoShortcuts: [],
      localContributionCache: {},
    },
    repos: [
      {
        id: "LiliaGithub",
        name: "LiliaGithub",
        path: "C:\\Files\\workspace\\LiliaGithub",
        relativePath: "LiliaGithub",
        currentBranch: "main",
        remoteUrl: "https://github.com/sena-nana/LiliaGithub.git",
        githubFullName: "sena-nana/LiliaGithub",
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
        worktree: {
          role: "standalone",
          sharedRepoKey: "repo:LiliaGithub",
          mainRepoId: null,
        },
      },
    ],
    authLoading: false,
    authNotice: null,
    tasks: [],
  },
  githubBinding: { value: null },
  authBindingStatusText: { value: "尚未绑定 GitHub" },
  deviceFlow: { value: null },
  authRemainingText: { value: null },
  startAuthFlow: vi.fn(),
  listHiddenRepos: vi.fn(async () => []),
  unhideRepo: vi.fn(),
  addLocalRepo: vi.fn(),
  discoverRepos: vi.fn(),
  cloneRepo: vi.fn(),
  refreshRepos: vi.fn(),
  cancelWorkspaceTask: vi.fn(),
  useDefaultTokenAuthForRepo: vi.fn(async (repoId: string) => {
    workspace.state.settings.systemGitRepoIds = workspace.state.settings.systemGitRepoIds.filter((id) => id !== repoId);
  }),
}));

vi.mock("../src/composables/useWorkspace", () => ({
  useWorkspace: () => workspace,
}));

vi.mock("../src/services/workspace", async () => {
  const actual = await vi.importActual<typeof import("../src/services/workspace")>("../src/services/workspace");
  return {
    ...actual,
    createGitHubRepo: vi.fn(),
    listGitHubRepoOwners: vi.fn(async () => []),
  };
});

describe("RepositoriesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspace.state.settings = {
      ...workspaceSettings(),
      systemGitRepoIds: ["LiliaGithub"],
    };
    workspace.state.repos = [repoSummary("LiliaGithub")];
    workspace.state.tasks = [];
    workspace.state.authLoading = false;
    workspace.state.authNotice = null;
    workspace.githubBinding.value = null;
    workspace.deviceFlow.value = null;
    workspace.listHiddenRepos.mockResolvedValue([]);
    vi.mocked(listGitHubRepoOwners).mockResolvedValue([]);
    vi.mocked(createGitHubRepo).mockReset();
  });

  it("展示已切到系统 git 凭证的仓库并提供恢复默认 token 入口", async () => {
    render(RepositoriesSection);

    const panel = screen.getByRole("region", { name: "系统 git 凭证" });
    expect(within(panel).getByText("LiliaGithub", { selector: ".system-git-list__name" })).toBeInTheDocument();
    expect(within(panel).getByText("LiliaGithub", { selector: ".system-git-list__id" })).toBeInTheDocument();

    await fireEvent.click(within(panel).getByRole("button", { name: "恢复默认 token" }));

    await waitFor(() => {
      expect(workspace.useDefaultTokenAuthForRepo).toHaveBeenCalledWith("LiliaGithub");
    });
  });

  it("后台任务区展示状态并为执行中任务提供取消入口", async () => {
    workspace.state.tasks = [
      {
        id: "task-running",
        kind: "repoStatus",
        priority: "high",
        repoId: null,
        status: "running",
        message: "同步远端状态",
        updatedAt: 1,
      },
      {
        id: "task-error",
        kind: "discoverRepos",
        priority: "normal",
        repoId: null,
        status: "error",
        message: "扫描失败",
        updatedAt: 2,
      },
      {
        id: "task-cancelled",
        kind: "languageStats",
        priority: "low",
        repoId: "LiliaGithub",
        status: "cancelled",
        message: "已取消",
        updatedAt: 3,
      },
    ];

    let resolveCancel: (() => void) | null = null;
    workspace.cancelWorkspaceTask.mockImplementation(async (taskId: string) => {
      await new Promise<void>((resolve) => {
        resolveCancel = () => {
          workspace.state.tasks = workspace.state.tasks.map((task) => (
            task.id === taskId ? { ...task, status: "cancelled", message: "已取消" } : task
          ));
          resolve();
        };
      });
    });

    render(RepositoriesSection);

    const taskPanel = screen.getByText("后台任务").closest(".workspace-task-list");
    if (!(taskPanel instanceof HTMLElement)) throw new Error("未找到后台任务区");
    expect(within(taskPanel).getByText("执行中")).toBeInTheDocument();
    expect(within(taskPanel).getByText("失败")).toBeInTheDocument();
    expect(within(taskPanel).getAllByText("已取消").length).toBeGreaterThan(0);
    expect(within(taskPanel).getAllByRole("button", { name: "取消" })).toHaveLength(1);

    const cancelButton = within(taskPanel).getByRole("button", { name: "取消" });
    await fireEvent.click(cancelButton);

    expect(workspace.cancelWorkspaceTask).toHaveBeenCalledWith("task-running");
    expect(within(taskPanel).getByRole("button", { name: "取消中" })).toBeDisabled();

    resolveCancel?.();

    await waitFor(() => {
      expect(within(taskPanel).queryByRole("button", { name: "取消中" })).not.toBeInTheDocument();
    });
    expect(within(taskPanel).queryAllByRole("button", { name: "取消" })).toHaveLength(0);
  });

  it("后台任务取消失败时仅在任务行内显示错误", async () => {
    workspace.state.tasks = [{
      id: "task-running",
      kind: "repoStatus",
      priority: "high",
      repoId: null,
      status: "running",
      message: "同步远端状态",
      updatedAt: 1,
    }];
    workspace.cancelWorkspaceTask.mockRejectedValue(new Error("取消失败：任务已结束"));

    render(RepositoriesSection);

    const taskPanel = screen.getByText("后台任务").closest(".workspace-task-list");
    if (!(taskPanel instanceof HTMLElement)) throw new Error("未找到后台任务区");

    await fireEvent.click(within(taskPanel).getByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(within(taskPanel).getByText("Error: 取消失败：任务已结束")).toBeInTheDocument();
    });
    expect(screen.getByText("没有隐藏仓库。")).toBeInTheDocument();
    expect(screen.queryByText("Error: 取消失败：任务已结束", { selector: ".repo-settings__error" })).toBeNull();
    expect(within(taskPanel).getByRole("button", { name: "取消" })).toBeEnabled();
  });

  it("创建仓库请求返回前关闭弹窗时忽略旧结果", async () => {
    const createRequest = deferred<GitHubRepoSummary>();
    vi.mocked(listGitHubRepoOwners).mockResolvedValue([{ login: "sena-nana", kind: "user" }]);
    vi.mocked(createGitHubRepo).mockReturnValue(createRequest.promise);

    render(RepositoriesSection);

    await fireEvent.click(screen.getByRole("button", { name: "新建 GitHub 仓库" }));
    const dialog = await screen.findByRole("dialog", { name: "新建 GitHub 仓库" });
    await screen.findByRole("option", { name: "sena-nana · user" });
    await fireEvent.update(within(dialog).getByLabelText("仓库名"), "new-repo");
    await fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    expect(vi.mocked(createGitHubRepo)).toHaveBeenCalledWith(expect.objectContaining({
      owner: "sena-nana",
      name: "new-repo",
    }));

    await fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "新建 GitHub 仓库" })).not.toBeInTheDocument();

    createRequest.resolve({
      id: 1,
      name: "new-repo",
      fullName: "sena-nana/new-repo",
      ownerLogin: "sena-nana",
      private: false,
      disabled: false,
      archived: false,
      description: null,
      defaultBranch: "main",
      createdAt: "2026-06-20T00:00:00Z",
      updatedAt: "2026-06-20T00:00:00Z",
      cloneUrl: "https://github.com/sena-nana/new-repo.git",
      htmlUrl: "https://github.com/sena-nana/new-repo",
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "新建 GitHub 仓库" })).not.toBeInTheDocument();
    });
    expect(screen.queryByText("sena-nana/new-repo")).not.toBeInTheDocument();
    expect(workspace.cloneRepo).not.toHaveBeenCalled();
    expect(workspace.refreshRepos).not.toHaveBeenCalled();
  });
});

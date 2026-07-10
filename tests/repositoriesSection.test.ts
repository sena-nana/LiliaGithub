import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RepositoriesSection from "../src/pages/settings/RepositoriesSection.vue";
import { useBackgroundTasks } from "../src/composables/useBackgroundTasks";
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
      contributionIdentities: [],
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
  workspaceRoot: { value: "C:\\\\Files\\\\workspace" },
  isAuthorized: { value: true },
  githubBinding: { value: null },
  authBindingStatusText: { value: "尚未绑定 GitHub" },
  deviceFlow: { value: null },
  authRemainingText: { value: null },
  startAuthFlow: vi.fn(),
  unbindGitHub: vi.fn(async () => {
    workspace.githubBinding.value = null;
    workspace.state.settings.githubBinding = null;
  }),
  chooseWorkspaceRoot: vi.fn(async () => "D:\\NewWorkspace"),
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
  setContributionIdentities: vi.fn(async (identities) => {
    workspace.state.settings.contributionIdentities = identities;
    return workspace.state.settings;
  }),
  scanContributionIdentities: vi.fn(async () => ({
    scannedRepoCount: 1,
    skippedRepoCount: 0,
    recommendations: [],
  })),
  refreshRepoContributions: vi.fn(),
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
  afterEach(() => {
    vi.useRealTimers();
  });

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
    workspace.authBindingStatusText.value = "尚未绑定 GitHub";
    workspace.workspaceRoot.value = "C:\\\\Files\\\\workspace";
    workspace.unbindGitHub.mockClear();
    workspace.chooseWorkspaceRoot.mockClear();
    workspace.setContributionIdentities.mockClear();
    workspace.scanContributionIdentities.mockResolvedValue({
      scannedRepoCount: 1,
      skippedRepoCount: 0,
      recommendations: [],
    });
    workspace.refreshRepoContributions.mockClear();
    workspace.listHiddenRepos.mockResolvedValue([]);
    vi.mocked(listGitHubRepoOwners).mockResolvedValue([]);
    vi.mocked(createGitHubRepo).mockReset();
  });

  it("展示当前工作区并提供更换入口", async () => {
    render(RepositoriesSection);

    expect(screen.getByText("C:\\\\Files\\\\workspace")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "更换工作区" }));

    await waitFor(() => {
      expect(workspace.chooseWorkspaceRoot).toHaveBeenCalledTimes(1);
    });
  });

  it("更换工作区期间登记侧边栏后台任务并在完成后移除", async () => {
    vi.useFakeTimers();
    const changeWorkspace = deferred<string>();
    workspace.chooseWorkspaceRoot.mockReturnValue(changeWorkspace.promise);
    const backgroundTasks = useBackgroundTasks();

    render(RepositoriesSection);

    await fireEvent.click(screen.getByRole("button", { name: "更换工作区" }));

    await waitFor(() => {
      expect(backgroundTasks.tasks.value).toEqual([
        expect.objectContaining({
          kind: "workspace",
          status: "running",
        }),
      ]);
    });

    changeWorkspace.resolve("D:\\NewWorkspace");

    await waitFor(() => {
      expect(backgroundTasks.tasks.value).toEqual([
        expect.objectContaining({
          kind: "workspace",
          status: "success",
        }),
      ]);
    });

    await vi.advanceTimersByTimeAsync(1600);

    await waitFor(() => {
      expect(backgroundTasks.runningTaskCount.value).toBe(0);
    });
    vi.useRealTimers();
  });

  it("已绑定 GitHub 时通过二次确认解绑", async () => {
    workspace.githubBinding.value = {
      login: "lilia-user",
      avatarUrl: null,
      boundAt: 1,
      scopes: ["repo"],
      clientIdSource: "bundled",
    };
    workspace.state.settings.githubBinding = workspace.githubBinding.value;
    workspace.authBindingStatusText.value = "GitHub 已授权";

    render(RepositoriesSection);

    await fireEvent.click(screen.getByRole("button", { name: "解绑 GitHub" }));
    expect(screen.getByRole("button", { name: "确认解绑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "确认解绑" }));

    await waitFor(() => {
      expect(workspace.unbindGitHub).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "确认解绑" })).not.toBeInTheDocument();
    });
  });

  it("未绑定 GitHub 时不显示解绑入口", () => {
    render(RepositoriesSection);

    expect(screen.getByRole("button", { name: "绑定 GitHub" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "解绑 GitHub" })).not.toBeInTheDocument();
  });

  it("保存贡献身份映射", async () => {
    render(RepositoriesSection);

    const panel = screen.getByRole("region", { name: "贡献身份" });
    await fireEvent.click(within(panel).getByRole("button", { name: "添加身份" }));
    await fireEvent.update(within(panel).getByLabelText("名称"), "Lilia User");
    await fireEvent.update(within(panel).getByLabelText("邮箱"), "LILIA@EXAMPLE.COM");
    await fireEvent.click(within(panel).getByRole("button", { name: "保存贡献身份" }));

    await waitFor(() => {
      expect(workspace.setContributionIdentities).toHaveBeenCalledWith([
        { name: "Lilia User", email: "lilia@example.com" },
      ]);
    });
    expect(within(panel).getByText("已保存")).toBeInTheDocument();
  });

  it("扫描贡献身份推荐并采纳到现有列表", async () => {
    workspace.state.settings.contributionIdentities = [
      { name: "Lilia User", email: "lilia@example.com" },
    ];
    workspace.scanContributionIdentities.mockResolvedValue({
      scannedRepoCount: 2,
      skippedRepoCount: 0,
      recommendations: [
        {
          identity: { name: "Legacy Lilia", email: "LEGACY@EXAMPLE.COM" },
          confidence: "relatedAuthor",
          missedCommitCount: 3,
          repoCount: 1,
          latestCommitAt: 1_780_000_000,
          repos: [
            {
              repoId: "LiliaGithub",
              repoName: "LiliaGithub",
              source: "recentAuthor",
              commitCount: 3,
              latestCommitAt: 1_780_000_000,
            },
          ],
        },
      ],
    });
    render(RepositoriesSection);

    const panel = screen.getByRole("region", { name: "贡献身份" });
    await fireEvent.click(within(panel).getByRole("button", { name: "扫描推荐" }));

    expect(await within(panel).findByText("Legacy Lilia <LEGACY@EXAMPLE.COM>")).toBeInTheDocument();
    await fireEvent.click(within(panel).getByRole("button", { name: "采纳" }));

    await waitFor(() => {
      expect(workspace.setContributionIdentities).toHaveBeenCalledWith([
        { name: "Lilia User", email: "lilia@example.com" },
        { name: "Legacy Lilia", email: "legacy@example.com" },
      ]);
    });
    expect(workspace.refreshRepoContributions).toHaveBeenCalledTimes(1);
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

  it("后台任务区只为真实可取消的 pending 任务提供取消入口", async () => {
    workspace.state.tasks = [
      {
        id: "task-pending",
        kind: "repoStatus",
        priority: "high",
        repoId: null,
        status: "pending",
        message: "等待检查远端状态",
        updatedAt: 1,
        cancellable: true,
      },
      {
        id: "task-error",
        kind: "discoverRepos",
        priority: "normal",
        repoId: null,
        status: "error",
        message: "扫描失败",
        updatedAt: 2,
        cancellable: false,
      },
      {
        id: "task-cancelled",
        kind: "languageStats",
        priority: "low",
        repoId: "LiliaGithub",
        status: "cancelled",
        message: "已取消",
        updatedAt: 3,
        cancellable: false,
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
    expect(within(taskPanel).getByText("等待中")).toBeInTheDocument();
    expect(within(taskPanel).getByText("失败")).toBeInTheDocument();
    expect(within(taskPanel).getAllByText("已取消").length).toBeGreaterThan(0);
    expect(within(taskPanel).getAllByRole("button", { name: "取消" })).toHaveLength(1);

    const cancelButton = within(taskPanel).getByRole("button", { name: "取消" });
    await fireEvent.click(cancelButton);

    expect(workspace.cancelWorkspaceTask).toHaveBeenCalledWith("task-pending");
    expect(within(taskPanel).getByRole("button", { name: "取消中" })).toBeDisabled();

    resolveCancel?.();

    await waitFor(() => {
      expect(within(taskPanel).queryByRole("button", { name: "取消中" })).not.toBeInTheDocument();
    });
    expect(within(taskPanel).queryAllByRole("button", { name: "取消" })).toHaveLength(0);
  });

  it("后台任务取消失败时仅在任务行内显示错误", async () => {
    workspace.state.tasks = [{
      id: "task-pending",
      kind: "repoStatus",
      priority: "high",
      repoId: null,
      status: "pending",
      message: "等待检查远端状态",
      updatedAt: 1,
      cancellable: true,
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
    await within(dialog).findByRole("button", { name: "sena-nana · user" });
    await fireEvent.update(within(dialog).getByLabelText("仓库名"), "new-repo");
    expect(within(dialog).queryByRole("button", { name: "取消" })).toBeNull();
    await fireEvent.click(within(dialog).getByRole("button", { name: "创建并克隆" }));

    expect(vi.mocked(createGitHubRepo)).toHaveBeenCalledWith(expect.objectContaining({
      owner: "sena-nana",
      name: "new-repo",
    }));

    await fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
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

  it("创建 GitHub 仓库时默认选择 user owner 并将 user 排在最上方", async () => {
    vi.mocked(listGitHubRepoOwners).mockResolvedValue([
      { login: "sena-nana", kind: "org" },
      { login: "team-lilia", kind: "org" },
      { login: "lilia-user", kind: "user" },
    ]);

    render(RepositoriesSection);

    await fireEvent.click(screen.getByRole("button", { name: "新建 GitHub 仓库" }));
    const dialog = await screen.findByRole("dialog", { name: "新建 GitHub 仓库" });
    const ownerTrigger = await within(dialog).findByRole("button", { name: "lilia-user · user" });
    await fireEvent.click(ownerTrigger);

    const ownerOptions = await screen.findAllByRole("option");
    expect(ownerOptions.map((option) => option.textContent?.trim())).toEqual([
      "lilia-user · user",
      "sena-nana · org",
      "team-lilia · org",
    ]);
  });

  it("可只创建远程 GitHub 仓库并关闭弹窗", async () => {
    vi.mocked(listGitHubRepoOwners).mockResolvedValue([{ login: "sena-nana", kind: "user" }]);
    vi.mocked(createGitHubRepo).mockResolvedValue({
      id: 3,
      name: "remote-only",
      fullName: "sena-nana/remote-only",
      ownerLogin: "sena-nana",
      private: false,
      disabled: false,
      archived: false,
      description: null,
      defaultBranch: "main",
      createdAt: "2026-06-20T00:00:00Z",
      updatedAt: "2026-06-20T00:00:00Z",
      cloneUrl: "https://github.com/sena-nana/remote-only.git",
      htmlUrl: "https://github.com/sena-nana/remote-only",
    });

    render(RepositoriesSection);

    await fireEvent.click(screen.getByRole("button", { name: "新建 GitHub 仓库" }));
    const dialog = await screen.findByRole("dialog", { name: "新建 GitHub 仓库" });
    expect(within(dialog).queryByText("仓库分组")).toBeNull();
    await within(dialog).findByRole("button", { name: "sena-nana · user" });
    await fireEvent.update(within(dialog).getByLabelText("仓库名"), "remote-only");
    await fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(createGitHubRepo).toHaveBeenCalledWith(expect.objectContaining({
        owner: "sena-nana",
        name: "remote-only",
      }));
      expect(screen.queryByRole("dialog", { name: "新建 GitHub 仓库" })).not.toBeInTheDocument();
    });
    expect(workspace.cloneRepo).not.toHaveBeenCalled();
    expect(workspace.refreshRepos).not.toHaveBeenCalled();
  });

  it("创建 GitHub 仓库时传递模板仓库字段并自动克隆", async () => {
    vi.mocked(listGitHubRepoOwners).mockResolvedValue([{ login: "sena-nana", kind: "user" }]);
    vi.mocked(createGitHubRepo).mockResolvedValue({
      id: 2,
      name: "from-template",
      fullName: "sena-nana/from-template",
      ownerLogin: "sena-nana",
      private: true,
      disabled: false,
      archived: false,
      description: "template repo",
      defaultBranch: "main",
      createdAt: "2026-06-20T00:00:00Z",
      updatedAt: "2026-06-20T00:00:00Z",
      cloneUrl: "https://github.com/sena-nana/from-template.git",
      htmlUrl: "https://github.com/sena-nana/from-template",
    });
    workspace.cloneRepo.mockResolvedValue(repoSummary("from-template"));

    render(RepositoriesSection);

    await fireEvent.click(screen.getByRole("button", { name: "新建 GitHub 仓库" }));
    const dialog = await screen.findByRole("dialog", { name: "新建 GitHub 仓库" });
    await within(dialog).findByRole("button", { name: "sena-nana · user" });
    await fireEvent.update(within(dialog).getByLabelText("仓库名"), "from-template");
    await fireEvent.update(within(dialog).getByLabelText("描述"), "template repo");
    await fireEvent.click(within(dialog).getByLabelText("Private"));
    await fireEvent.click(within(dialog).getByLabelText("使用模板"));
    await fireEvent.update(within(dialog).getByLabelText("模板仓库"), "sena-nana/template");
    await fireEvent.click(within(dialog).getByLabelText("包含所有分支"));
    await fireEvent.click(within(dialog).getByRole("button", { name: "创建并克隆" }));

    await waitFor(() => {
      expect(createGitHubRepo).toHaveBeenCalledWith(expect.objectContaining({
        owner: "sena-nana",
        ownerKind: "user",
        name: "from-template",
        description: "template repo",
        private: true,
        autoInit: false,
        templateFullName: "sena-nana/template",
        includeAllBranches: true,
      }));
      expect(workspace.cloneRepo).toHaveBeenCalledWith("https://github.com/sena-nana/from-template.git", "from-template");
      expect(workspace.refreshRepos).toHaveBeenCalled();
    });
  });
});

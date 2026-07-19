import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepositoriesSection from "../src/pages/settings/RepositoriesSection.vue";
import { repoSummary, workspaceSettings } from "./fixtures/workspace";

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
      repoBindings: {},
      favoriteRepoIds: [],
      repoGroups: [],
      organizationGroupingResolvedRepoIds: [],
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
  activeWorkspace: { value: null },
  workspaceCatalog: { value: [] },
  switchingWorkspace: { value: false },
  githubBinding: { value: null },
  authBindingStatusText: { value: "尚未绑定 GitHub" },
  deviceFlow: { value: null },
  authRemainingText: { value: null },
  startAuthFlow: vi.fn(),
  unbindGitHub: vi.fn(async () => {
    workspace.githubBinding.value = null;
    workspace.state.settings.githubBinding = null;
  }),
  pickWorkspaceRoot: vi.fn(async () => "D:\\NewWorkspace"),
  createWorkspace: vi.fn(),
  renameWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  switchWorkspace: vi.fn(),
  addWorkspaceRoot: vi.fn(),
  removeWorkspaceRoot: vi.fn(),
  setPrimaryWorkspaceRoot: vi.fn(),
  listHiddenRepos: vi.fn(async () => []),
  unhideRepo: vi.fn(),
  addLocalRepo: vi.fn(),
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

vi.mock("../src/composables/useWorkspace", async () => {
  const { reactive, ref } = await vi.importActual<typeof import("vue")>("vue");
  workspace.state = reactive(workspace.state);
  workspace.activeWorkspace = ref(null);
  workspace.workspaceCatalog = ref([]);
  workspace.switchingWorkspace = ref(false);
  return {
    useWorkspace: () => workspace,
  };
});

describe("RepositoriesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspace.state.settings = {
      ...workspaceSettings(),
      systemGitRepoIds: ["LiliaGithub"],
    };
    workspace.activeWorkspace.value = workspace.state.settings.activeWorkspace;
    workspace.workspaceCatalog.value = workspace.state.settings.workspaceCatalog;
    workspace.state.repos = [repoSummary("LiliaGithub")];
    workspace.state.tasks = [];
    workspace.state.authLoading = false;
    workspace.state.authNotice = null;
    workspace.githubBinding.value = null;
    workspace.deviceFlow.value = null;
    workspace.authBindingStatusText.value = "尚未绑定 GitHub";
    workspace.workspaceRoot.value = "C:\\\\Files\\\\workspace";
    workspace.unbindGitHub.mockClear();
    workspace.pickWorkspaceRoot.mockReset();
    workspace.pickWorkspaceRoot.mockResolvedValue("D:\\NewWorkspace");
    workspace.setContributionIdentities.mockClear();
    workspace.scanContributionIdentities.mockResolvedValue({
      scannedRepoCount: 1,
      skippedRepoCount: 0,
      recommendations: [],
    });
    workspace.refreshRepoContributions.mockClear();
    workspace.listHiddenRepos.mockResolvedValue([]);
  });

  it("按功能展示设置卡片并移除首页已有操作", () => {
    render(RepositoriesSection);

    expect(screen.getByRole("region", { name: "工作区与仓库" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "GitHub 授权" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "贡献身份" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "系统 git 凭证" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "后台任务" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "后台发现仓库" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建 GitHub 仓库" })).not.toBeInTheDocument();
  });

  it("保留添加已有本地仓库入口", async () => {
    render(RepositoriesSection);

    const panel = screen.getByRole("region", { name: "工作区与仓库" });
    await fireEvent.click(within(panel).getByRole("button", { name: "添加本地仓库" }));

    await waitFor(() => {
      expect(workspace.addLocalRepo).toHaveBeenCalledTimes(1);
    });
  });

  it("隐藏仓库名称与 ID 相同时只显示一次并可恢复", async () => {
    workspace.listHiddenRepos
      .mockResolvedValueOnce([{ id: "HiddenRepo", name: "HiddenRepo" }])
      .mockResolvedValueOnce([]);

    render(RepositoriesSection);

    const panel = screen.getByRole("region", { name: "工作区与仓库" });
    expect(await within(panel).findByText("HiddenRepo")).toBeInTheDocument();
    expect(within(panel).getAllByText("HiddenRepo")).toHaveLength(1);

    await fireEvent.click(within(panel).getByRole("button", { name: "恢复管理" }));

    await waitFor(() => {
      expect(workspace.unhideRepo).toHaveBeenCalledWith("HiddenRepo");
      expect(within(panel).queryByText("HiddenRepo")).not.toBeInTheDocument();
    });
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
    expect(within(panel).getAllByText("LiliaGithub")).toHaveLength(1);

    await fireEvent.click(within(panel).getByRole("button", { name: "恢复默认 token" }));

    await waitFor(() => {
      expect(workspace.useDefaultTokenAuthForRepo).toHaveBeenCalledWith("LiliaGithub");
      expect(screen.queryByRole("region", { name: "系统 git 凭证" })).not.toBeInTheDocument();
    });
  });

  it("后台任务区只为真实可取消的 pending 任务提供取消入口", async () => {
    workspace.state.tasks = [
      {
        id: "task-pending",
        title: "检查远端状态",
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
        title: "发现仓库",
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
        title: "统计语言",
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

    const taskPanel = screen.getByRole("region", { name: "后台任务" });
    expect(within(taskPanel).getByText("等待检查远端状态")).toBeInTheDocument();
    expect(within(taskPanel).queryByText("扫描失败")).not.toBeInTheDocument();
    expect(within(taskPanel).queryByText("已取消")).not.toBeInTheDocument();
    expect(within(taskPanel).getAllByRole("button", { name: "取消" })).toHaveLength(1);

    const cancelButton = within(taskPanel).getByRole("button", { name: "取消" });
    await fireEvent.click(cancelButton);

    expect(workspace.cancelWorkspaceTask).toHaveBeenCalledWith("task-pending");
    expect(within(taskPanel).getByRole("button", { name: "取消中" })).toBeDisabled();

    resolveCancel?.();

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "后台任务" })).not.toBeInTheDocument();
    });
  });

  it("后台任务取消失败时仅在任务行内显示错误", async () => {
    workspace.state.tasks = [{
      id: "task-pending",
      title: "检查远端状态",
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

    const taskPanel = screen.getByRole("region", { name: "后台任务" });

    await fireEvent.click(within(taskPanel).getByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(within(taskPanel).getByText("Error: 取消失败：任务已结束")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Error: 取消失败：任务已结束")).toHaveLength(1);
    expect(within(taskPanel).getByRole("button", { name: "取消" })).toBeEnabled();
  });

});

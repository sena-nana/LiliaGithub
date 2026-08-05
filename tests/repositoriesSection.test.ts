import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepositoriesSection from "../src/pages/settings/RepositoriesSection.vue";
import type { WorkspaceStore } from "../src/composables/workspace/store";
import { repoSummary, workspaceSettings } from "./fixtures/workspace";
import { createWorkspaceStoreFixture, provideWorkspaceStoreFixture } from "./fixtures/createWorkspaceStoreFixture";

const client = {
  pickRepo: vi.fn(async () => "C:\\Files\\workspace\\Added"),
  addRepo: vi.fn(async () => repoSummary("Added")),
  listManagedRepos: vi.fn(async () => [repoSummary("LiliaGithub")]),
  listHiddenRepos: vi.fn(async () => []),
  unhideRepo: vi.fn(),
  getRepoSummary: vi.fn(async (repoId: string) => repoSummary(repoId)),
  cancelWorkspaceTask: vi.fn(),
  useDefaultTokenAuthForRepo: vi.fn(),
  setContributionIdentities: vi.fn(),
  scanContributionIdentities: vi.fn(),
};
let workspace: WorkspaceStore;
const refreshRepoContributions = vi.fn();

vi.mock("../src/composables/useWorkspaceRecentContext", () => ({
  useWorkspaceRecentContext: () => ({
    switchWorkspace: (...args: Parameters<WorkspaceStore["switchWorkspace"]>) => workspace.switchWorkspace(...args),
    createWorkspace: (...args: Parameters<WorkspaceStore["createWorkspace"]>) => workspace.createWorkspace(...args),
    deleteWorkspace: (...args: Parameters<WorkspaceStore["deleteWorkspace"]>) => workspace.deleteWorkspace(...args),
  }),
}));

function renderSection() {
  return render(RepositoriesSection, { global: { provide: provideWorkspaceStoreFixture(workspace) } });
}

describe("RepositoriesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspace = createWorkspaceStoreFixture(client);
    Object.assign(workspace, { refreshRepoContributions });
    workspace.stateFeature.state.settings = {
      ...workspaceSettings(),
      systemGitRepoIds: ["LiliaGithub"],
    };
    workspace.stateFeature.state.repos = [repoSummary("LiliaGithub")];
    workspace.stateFeature.state.tasks = [];
    client.setContributionIdentities.mockImplementation(async (identities) => ({
      ...workspace.stateFeature.state.settings!,
      contributionIdentities: identities,
    }));
    client.useDefaultTokenAuthForRepo.mockImplementation(async (repoId: string) => ({
      ...workspace.stateFeature.state.settings!,
      systemGitRepoIds: workspace.stateFeature.state.settings!.systemGitRepoIds.filter((id) => id !== repoId),
    }));
    client.unhideRepo.mockImplementation(async () => workspace.stateFeature.state.settings!);
    client.scanContributionIdentities.mockResolvedValue({
      scannedRepoCount: 1,
      skippedRepoCount: 0,
      recommendations: [],
    });
    client.listHiddenRepos.mockResolvedValue([]);
  });

  it("按功能展示设置卡片并移除首页已有操作", () => {
    renderSection();

    expect(screen.getByRole("region", { name: "工作区与仓库" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "GitHub 授权" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "贡献身份" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "系统 git 凭证" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "后台任务" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "后台发现仓库" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建 GitHub 仓库" })).not.toBeInTheDocument();
  });

  it("保留添加已有本地仓库入口", async () => {
    renderSection();

    const panel = screen.getByRole("region", { name: "工作区与仓库" });
    await fireEvent.click(within(panel).getByRole("button", { name: "添加本地仓库" }));

    await waitFor(() => {
      expect(client.pickRepo).toHaveBeenCalledTimes(1);
    });
  });

  it("隐藏仓库名称与 ID 相同时只显示一次并可恢复", async () => {
    client.listHiddenRepos
      .mockResolvedValueOnce([{ id: "HiddenRepo", name: "HiddenRepo" }])
      .mockResolvedValueOnce([]);

    renderSection();

    const panel = screen.getByRole("region", { name: "工作区与仓库" });
    expect(await within(panel).findByText("HiddenRepo")).toBeInTheDocument();
    expect(within(panel).getAllByText("HiddenRepo")).toHaveLength(1);

    await fireEvent.click(within(panel).getByRole("button", { name: "恢复管理" }));

    await waitFor(() => {
      expect(client.unhideRepo).toHaveBeenCalledWith("HiddenRepo");
      expect(within(panel).queryByText("HiddenRepo")).not.toBeInTheDocument();
    });
  });

  it("保存贡献身份映射", async () => {
    renderSection();

    const panel = screen.getByRole("region", { name: "贡献身份" });
    await fireEvent.click(within(panel).getByRole("button", { name: "添加身份" }));
    await fireEvent.update(within(panel).getByLabelText("名称"), "Lilia User");
    await fireEvent.update(within(panel).getByLabelText("邮箱"), "LILIA@EXAMPLE.COM");
    await fireEvent.click(within(panel).getByRole("button", { name: "保存贡献身份" }));

    await waitFor(() => {
      expect(client.setContributionIdentities).toHaveBeenCalledWith([
        { name: "Lilia User", email: "lilia@example.com" },
      ]);
    });
    expect(await within(panel).findByText("已保存")).toBeInTheDocument();
  });

  it("扫描贡献身份推荐并采纳到现有列表", async () => {
    workspace.stateFeature.state.settings!.contributionIdentities = [
      { name: "Lilia User", email: "lilia@example.com" },
    ];
    client.scanContributionIdentities.mockResolvedValue({
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
    renderSection();

    const panel = screen.getByRole("region", { name: "贡献身份" });
    await fireEvent.click(within(panel).getByRole("button", { name: "扫描推荐" }));

    expect(await within(panel).findByText("Legacy Lilia <LEGACY@EXAMPLE.COM>")).toBeInTheDocument();
    await fireEvent.click(within(panel).getByRole("button", { name: "采纳" }));

    await waitFor(() => {
      expect(client.setContributionIdentities).toHaveBeenCalledWith([
        { name: "Lilia User", email: "lilia@example.com" },
        { name: "Legacy Lilia", email: "legacy@example.com" },
      ]);
    });
    expect(refreshRepoContributions).toHaveBeenCalledTimes(1);
  });

  it("展示已切到系统 git 凭证的仓库并提供恢复默认 token 入口", async () => {
    renderSection();

    const panel = screen.getByRole("region", { name: "系统 git 凭证" });
    expect(within(panel).getAllByText("LiliaGithub")).toHaveLength(1);

    await fireEvent.click(within(panel).getByRole("button", { name: "恢复默认 token" }));

    await waitFor(() => {
      expect(client.useDefaultTokenAuthForRepo).toHaveBeenCalledWith("LiliaGithub");
      expect(screen.queryByRole("region", { name: "系统 git 凭证" })).not.toBeInTheDocument();
    });
  });

  it("后台任务区只为真实可取消的 pending 任务提供取消入口", async () => {
    workspace.stateFeature.state.tasks = [
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
    client.cancelWorkspaceTask.mockImplementation(async (taskId: string) => {
      await new Promise<void>((resolve) => {
        resolveCancel = () => {
          workspace.stateFeature.state.tasks = workspace.stateFeature.state.tasks.map((task) => (
            task.id === taskId ? { ...task, status: "cancelled", message: "已取消" } : task
          ));
          resolve();
        };
      });
    });

    renderSection();

    const taskPanel = screen.getByRole("region", { name: "后台任务" });
    expect(within(taskPanel).getByText("等待检查远端状态")).toBeInTheDocument();
    expect(within(taskPanel).queryByText("扫描失败")).not.toBeInTheDocument();
    expect(within(taskPanel).queryByText("已取消")).not.toBeInTheDocument();
    expect(within(taskPanel).getAllByRole("button", { name: "取消" })).toHaveLength(1);

    const cancelButton = within(taskPanel).getByRole("button", { name: "取消" });
    await fireEvent.click(cancelButton);

    expect(client.cancelWorkspaceTask).toHaveBeenCalledWith("task-pending");
    expect(within(taskPanel).getByRole("button", { name: "取消中" })).toBeDisabled();

    resolveCancel?.();

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "后台任务" })).not.toBeInTheDocument();
    });
  });

  it("后台任务取消失败时仅在任务行内显示错误", async () => {
    workspace.stateFeature.state.tasks = [{
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
    client.cancelWorkspaceTask.mockRejectedValue(new Error("取消失败：任务已结束"));

    renderSection();

    const taskPanel = screen.getByRole("region", { name: "后台任务" });

    await fireEvent.click(within(taskPanel).getByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(within(taskPanel).getByText("Error: 取消失败：任务已结束")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Error: 取消失败：任务已结束")).toHaveLength(1);
    expect(within(taskPanel).getByRole("button", { name: "取消" })).toBeEnabled();
  });

});

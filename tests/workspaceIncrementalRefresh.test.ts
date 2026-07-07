import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/vue";
import {
  abortConflictOperation,
  acceptConflictFile,
  checkout,
  commit,
  createBranch,
  continueConflictOperation,
  hideRepo,
  loadRepoDetail,
  markConflictFileResolved,
  mergeBranch,
  mergePull,
  pull,
  push,
  renameBranch,
  autoSyncRepoIfNeeded,
  useDefaultTokenAuthForRepo,
  refreshRepoContributions,
  refreshRepos,
  refreshRepoLanguageStats,
  refreshRepoSummaries,
  requestRepoStatusRefresh,
  REPO_STATUS_REFRESH_DEBOUNCE_MS,
  refreshWorkspaceTasks,
  resolveConflictFile,
  resetRepositoryRuntimeForTests,
  discardChanges,
  stage,
  unhideRepo,
  unstage,
  deleteBranch,
} from "../src/composables/workspace/repositories";
import { initialize } from "../src/composables/workspace/lifecycle";
import { closeBulkPreview, executeBulk, previewBulk, syncAll } from "../src/composables/workspace/bulk";
import {
  bulkSyncRepoIds,
  bulkSyncRunningRepoIds,
  repoActionErrorForRepo,
  repoActionErrorDetailForRepo,
  syncErrorByRepoId,
  syncErrorDetailsByRepoId,
  recentSyncErrorForRepo,
  resetWorkspaceStateForTests,
  state,
} from "../src/composables/workspace/state";
import type { WorkspaceService } from "../src/composables/workspace/serviceLoader";
import type { BulkSyncPreview, GitHubContributionResult, RepoChange, WorkspaceStartupCache } from "../src/services/workspace";
import { conflictState, repoDetail, repoDetailPatch, repoSummary, workspaceSettings } from "./fixtures/workspace";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function repoChange(path: string, overrides: Partial<RepoChange> = {}): RepoChange {
  return {
    path,
    oldPath: null,
    indexStatus: " ",
    worktreeStatus: "M",
    staged: false,
    unstaged: true,
    untracked: false,
    conflicted: false,
    diff: "@@ -1 +1 @@\n-old\n+new",
    ...overrides,
  };
}

function repoChangePaths(repoId: string) {
  return state.repoDetails[repoId]?.changes.map((change) => change.path);
}

const service = {
  getWorkspaceSettings: vi.fn(),
  readStartupCache: vi.fn(),
  clearStartupCache: vi.fn(),
  writeStartupContributions: vi.fn(),
  setRepoAutoSync: vi.fn(),
  getGitHubBindingStatus: vi.fn(),
  listManagedRepos: vi.fn(),
  refreshRepos: vi.fn(),
  refreshRepoSummary: vi.fn(),
  discoverRepos: vi.fn(),
  pickRepo: vi.fn(),
  addRepo: vi.fn(),
  hideRepo: vi.fn(),
  unhideRepo: vi.fn(),
  getRepoSummary: vi.fn(),
  getRepoDetail: vi.fn(),
  refreshRepoDetailPatch: vi.fn(),
  listRepoContribution: vi.fn(),
  listWorkspaceTasks: vi.fn(),
  cancelWorkspaceTask: vi.fn(),
  refreshRepoLanguageStats: vi.fn(),
  stageFiles: vi.fn(),
  unstageFiles: vi.fn(),
  discardFiles: vi.fn(),
  commitRepo: vi.fn(),
  pullRepo: vi.fn(),
  mergePullRepo: vi.fn(),
  mergeBranch: vi.fn(),
  pushRepo: vi.fn(),
  pushRepoWithSystemGit: vi.fn(),
  useDefaultTokenAuthForRepo: vi.fn(),
  checkoutBranch: vi.fn(),
  createBranch: vi.fn(),
  renameBranch: vi.fn(),
  deleteBranch: vi.fn(),
  acceptConflictFile: vi.fn(),
  resolveConflictFile: vi.fn(),
  markFileResolved: vi.fn(),
  abortConflictOperation: vi.fn(),
  continueConflictOperation: vi.fn(),
  bulkSyncPreview: vi.fn(),
  bulkSyncExecute: vi.fn(),
};

vi.mock("../src/composables/workspace/serviceLoader", () => ({
  loadWorkspaceService: vi.fn(async () => service as unknown as WorkspaceService),
}));

beforeEach(() => {
  resetWorkspaceStateForTests();
  resetRepositoryRuntimeForTests();
  vi.clearAllMocks();
  service.listRepoContribution.mockResolvedValue({
    days: [],
    meta: {
      repoCount: 0,
      requestedRepoCount: 0,
      repoLimit: 30,
      truncated: false,
      skippedRepoCount: 0,
      refreshedAt: 1_780_000_000_000,
    },
  });
  service.listWorkspaceTasks.mockResolvedValue([]);
  const settings = workspaceSettings();
  service.getWorkspaceSettings.mockResolvedValue(settings);
  service.readStartupCache.mockResolvedValue(null);
  service.clearStartupCache.mockResolvedValue(undefined);
  service.writeStartupContributions.mockImplementation(async (contributions) => ({
    workspaceRoot: settings.workspaceRoot,
    bindingLogin: settings.githubBinding?.login ?? null,
    reposById: {},
    contributions: {
      ...contributions,
      cachedAt: Date.now(),
    },
  }));
  service.setRepoAutoSync.mockImplementation(async (repoId: string, autoSync: boolean) => ({
    ...settings,
    repoSyncPreferences: { [repoId]: { autoSync } },
  }));
  service.getGitHubBindingStatus.mockResolvedValue({
    state: "bound",
    clientIdConfigured: true,
    clientIdSource: "bundled",
    binding: {
      login: "sena-nana",
      avatarUrl: null,
      boundAt: 1,
      scopes: ["repo"],
      clientIdSource: "bundled",
    },
  });
  service.listManagedRepos.mockResolvedValue([]);
  service.refreshRepoSummary.mockImplementation(async (repoId: string) => repoSummary(repoId));
  service.refreshRepoDetailPatch.mockImplementation(async (
    repoId: string,
    request: { includeCommits?: boolean; includeBranches?: boolean } = {},
  ) => {
    const detail = repoDetail(repoSummary(repoId));
    return repoDetailPatch(detail.summary, {
      changes: detail.changes,
      conflicts: detail.conflicts,
      commits: request.includeCommits ? detail.commits : null,
      branches: request.includeBranches ? detail.branches : null,
    });
  });
  service.refreshRepoLanguageStats.mockImplementation(async (repoId: string) => repoSummary(repoId, {
    languageStats: [{ language: "TypeScript", bytes: 1, lines: 1 }],
    languageStatsUpdatedAt: 1,
  }));
});

describe("workspace incremental refresh", () => {
  it("初始化先显示轻量项目列表，不等待单仓库状态刷新完成", async () => {
    let resolveSummary: ((summary: ReturnType<typeof repoSummary>) => void) | null = null;
    const lightweight = repoSummary("LiliaGithub", {
      currentBranch: null,
      remoteUrl: null,
      githubFullName: null,
      ahead: 0,
      unstagedCount: 1,
    });
    const refreshed = repoSummary("LiliaGithub", {
      githubFullName: "sena-nana/LiliaGithub",
      ahead: 2,
      stagedCount: 1,
    });
    service.listManagedRepos.mockResolvedValue([lightweight]);
    service.refreshRepoSummary.mockReturnValue(new Promise((resolve) => {
      resolveSummary = resolve;
    }));
    service.refreshRepoLanguageStats.mockResolvedValue({
      ...refreshed,
      languageStats: [{ language: "TypeScript", bytes: 1, lines: 1 }],
      languageStatsUpdatedAt: 1,
    });

    await initialize();

    expect(service.listManagedRepos).toHaveBeenCalledTimes(1);
    expect(service.refreshRepos).not.toHaveBeenCalled();
    expect(state.loading).toBe(false);
    expect(state.repos).toEqual([lightweight]);
    expect(state.scanning).toBe(true);

    await waitFor(() => expect(service.refreshRepoSummary).toHaveBeenCalledWith("LiliaGithub", { fetchRemote: true }));
    resolveSummary?.(refreshed);
    await waitFor(() => expect(state.repos[0]).toMatchObject({ ahead: 2, stagedCount: 1 }));
  });

  it("自动仓库状态刷新只刷新有本地内容或未推送提交的仓库", async () => {
    const clean = repoSummary("Clean");
    const dirty = repoSummary("Dirty", { unstagedCount: 1 });
    const ahead = repoSummary("Ahead", { ahead: 2 });
    const behind = repoSummary("Behind", { behind: 3 });
    const conflict = repoSummary("Conflict", { conflictCount: 1 });
    service.listManagedRepos.mockResolvedValue([clean, dirty, ahead, behind, conflict]);
    service.refreshRepoSummary.mockImplementation(async (repoId: string) => repoSummary(repoId));

    await refreshRepos({ automatic: true });

    await waitFor(() => expect(service.refreshRepoSummary).toHaveBeenCalledTimes(3));
    expect(service.refreshRepoSummary.mock.calls.map(([repoId]) => repoId).sort()).toEqual([
      "Ahead",
      "Conflict",
      "Dirty",
    ]);
  });

  it("自动仓库状态刷新没有目标仓库时不进入扫描状态", async () => {
    service.listManagedRepos.mockResolvedValue([
      repoSummary("Clean"),
      repoSummary("Behind", { behind: 1 }),
    ]);

    await refreshRepoSummaries({ automatic: true });

    expect(service.refreshRepoSummary).not.toHaveBeenCalled();
    expect(state.scanning).toBe(false);
  });

  it("初始化命中新鲜启动缓存时跳过自动仓库状态刷新", async () => {
    const cached = repoSummary("LiliaGithub", {
      ahead: 2,
      githubFullName: "sena-nana/LiliaGithub",
      currentBranch: "main",
    });
    const startupCache: WorkspaceStartupCache = {
      workspaceRoot: "C:\\Files\\workspace",
      bindingLogin: "sena-nana",
      reposById: {
        LiliaGithub: {
          summary: cached,
          cachedAt: Date.now(),
        },
      },
      contributions: null,
    };
    service.readStartupCache.mockResolvedValue(startupCache);
    service.listManagedRepos.mockResolvedValue([cached]);

    await initialize();

    expect(service.listManagedRepos).toHaveBeenCalledTimes(1);
    expect(service.refreshRepoSummary).not.toHaveBeenCalled();
    expect(state.scanning).toBe(false);
    expect(state.repos[0]).toMatchObject({ id: "LiliaGithub", ahead: 2 });
  });

  it("手动刷新即使刚命中新鲜缓存也会刷新仓库状态", async () => {
    const cached = repoSummary("LiliaGithub", {
      githubFullName: "sena-nana/LiliaGithub",
      currentBranch: "main",
    });
    const refreshed = repoSummary("LiliaGithub", { ahead: 1 });
    const startupCache: WorkspaceStartupCache = {
      workspaceRoot: "C:\\Files\\workspace",
      bindingLogin: "sena-nana",
      reposById: {
        LiliaGithub: {
          summary: cached,
          cachedAt: Date.now(),
        },
      },
      contributions: null,
    };
    service.listManagedRepos.mockResolvedValue([cached]);
    service.refreshRepoSummary.mockResolvedValue(refreshed);

    await refreshRepos({ automatic: true, startupCache });
    expect(service.refreshRepoSummary).not.toHaveBeenCalled();

    await refreshRepos();

    await waitFor(() => expect(service.refreshRepoSummary).toHaveBeenCalledWith("LiliaGithub", { fetchRemote: true }));
    await waitFor(() => expect(state.repos[0]).toMatchObject({ ahead: 1 }));
  });

  it("后台仓库状态刷新会按仓库合并请求范围", async () => {
    vi.useFakeTimers();
    try {
      const updated = repoSummary("LiliaGithub", { unstagedCount: 1 });
      service.refreshRepoDetailPatch.mockResolvedValue(repoDetailPatch(updated, {
        commits: [],
        branches: [],
      }));

      const first = requestRepoStatusRefresh("LiliaGithub", { includeCommits: true });
      const second = requestRepoStatusRefresh("LiliaGithub", { includeBranches: true });

      expect(service.refreshRepoDetailPatch).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(REPO_STATUS_REFRESH_DEBOUNCE_MS);
      await Promise.all([first, second]);

      expect(service.refreshRepoDetailPatch).toHaveBeenCalledTimes(1);
      expect(service.refreshRepoDetailPatch).toHaveBeenCalledWith("LiliaGithub", {
        includeCommits: true,
        includeBranches: true,
      });
      expect(state.repos[0]).toMatchObject({ id: "LiliaGithub", unstagedCount: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("初始化从启动缓存恢复贡献图，再继续刷新仓库列表", async () => {
    service.listManagedRepos.mockResolvedValue([]);
    service.readStartupCache.mockResolvedValue({
      workspaceRoot: "C:\\Files\\workspace",
      bindingLogin: null,
      reposById: {},
      contributions: {
        days: [{
          date: "2026-06-11",
          count: 3,
          repositories: [{
            repoId: "Repo1",
            repoName: "Repo1",
            repoFullName: "sena-nana/Repo1",
            count: 3,
          }],
        }],
        meta: {
          repoCount: 1,
          requestedRepoCount: 1,
          repoLimit: 30,
          truncated: false,
          skippedRepoCount: 0,
          refreshedAt: 1_780_000_000_000,
        },
        cachedAt: 1_780_000_001_000,
      },
    });

    await initialize();

    expect(service.readStartupCache).toHaveBeenCalledTimes(1);
    expect(state.githubContributions.days).toEqual([{
      date: "2026-06-11",
      count: 3,
      repositories: [{
        repoId: "Repo1",
        repoName: "Repo1",
        repoFullName: "sena-nana/Repo1",
        count: 3,
      }],
    }]);
    expect(state.githubContributions.meta?.repoCount).toBe(1);
    expect(service.listManagedRepos).toHaveBeenCalledTimes(1);
  });

  it("贡献图刷新完成后写入启动缓存", async () => {
    state.repos = [repoSummary("Repo1")];
    service.listRepoContribution.mockResolvedValue({
      days: [{ date: "2026-06-11", count: 2 }],
      meta: {
        repoCount: 1,
        requestedRepoCount: 1,
        repoLimit: 30,
        truncated: false,
        skippedRepoCount: 0,
        refreshedAt: 1_780_000_000_000,
      },
    } satisfies GitHubContributionResult);

    await refreshRepoContributions();

    await waitFor(() =>
      expect(service.writeStartupContributions).toHaveBeenCalledWith({
        days: expect.arrayContaining([{
          date: "2026-06-11",
          count: 2,
          repositories: [{
            repoId: "Repo1",
            repoName: "Repo1",
            repoFullName: "sena-nana/Repo1",
            count: 2,
          }],
        }]),
        meta: expect.objectContaining({ repoCount: 1 }),
      }),
    );
  });

  it("贡献图按日期合并多仓库提交明细", async () => {
    state.repos = [
      repoSummary("Repo1"),
      repoSummary("Repo2", { githubFullName: null }),
    ];
    service.listRepoContribution.mockImplementation(async (scope: string) => ({
      days: scope === "local:Repo1"
        ? [
            { date: "2026-06-11", count: 2 },
            { date: "2026-06-12", count: 0 },
          ]
        : [
            { date: "2026-06-11", count: 1 },
            { date: "2026-06-12", count: 0 },
          ],
      meta: {
        repoCount: 1,
        requestedRepoCount: 1,
        repoLimit: 30,
        truncated: false,
        skippedRepoCount: 0,
        refreshedAt: 1_780_000_000_000,
      },
    } satisfies GitHubContributionResult));

    await refreshRepoContributions();

    await waitFor(() => {
      const day = state.githubContributions.days.find((item) => item.date === "2026-06-11");
      expect(day).toMatchObject({ count: 3 });
      expect(day?.repositories).toEqual(expect.arrayContaining([
        {
          repoId: "Repo1",
          repoName: "Repo1",
          repoFullName: "sena-nana/Repo1",
          count: 2,
        },
        {
          repoId: "Repo2",
          repoName: "Repo2",
          repoFullName: null,
          count: 1,
        },
      ]));
      expect(day?.repositories).toHaveLength(2);
    });

    const emptyDay = state.githubContributions.days.find((item) => item.date === "2026-06-12");
    expect(emptyDay).toMatchObject({ count: 0 });
    expect(emptyDay?.repositories).toBeUndefined();
  });

  it("重复刷新贡献图不会把上一轮计数再次累加", async () => {
    state.repos = [repoSummary("Repo1")];
    const expectRepo1Contribution = () => {
      expect(state.githubContributions.days.find((item) => item.date === "2026-06-11")).toMatchObject({
        count: 2,
        repositories: [{
          repoId: "Repo1",
          repoName: "Repo1",
          repoFullName: "sena-nana/Repo1",
          count: 2,
        }],
      });
      expect(state.githubContributions.meta).toMatchObject({
        repoCount: 1,
        requestedRepoCount: 1,
        skippedRepoCount: 0,
      });
    };
    service.listRepoContribution.mockResolvedValue({
      days: [{ date: "2026-06-11", count: 2 }],
      meta: {
        repoCount: 1,
        requestedRepoCount: 1,
        repoLimit: 30,
        truncated: false,
        skippedRepoCount: 0,
        refreshedAt: 1_780_000_000_000,
      },
    } satisfies GitHubContributionResult);

    await refreshRepoContributions();

    await waitFor(() => expect(service.listRepoContribution).toHaveBeenCalledTimes(1));
    expectRepo1Contribution();

    await refreshRepoContributions();

    await waitFor(() => expect(service.listRepoContribution).toHaveBeenCalledTimes(2));
    expectRepo1Contribution();
  });

  it("自动刷新发现开启自动同步的仓库有待同步提交时执行同步", async () => {
    const stale = repoSummary("Repo1", { ahead: 1, behind: 1 });
    const synced = repoSummary("Repo1", { ahead: 0, behind: 0 });
    state.settings = {
      ...workspaceSettings(),
      repoSyncPreferences: { Repo1: { autoSync: true } },
    };
    service.listManagedRepos.mockResolvedValue([repoSummary("Repo1")]);
    service.refreshRepoSummary.mockResolvedValue(stale);
    service.bulkSyncExecute.mockResolvedValue([
      { repoId: "Repo1", status: "success", message: "完成", summary: synced },
    ]);

    await refreshRepoSummaries();

    expect(service.bulkSyncExecute).toHaveBeenCalledWith("sync", ["Repo1"], "stash");
    expect(state.repos.find((repo) => repo.id === "Repo1")).toMatchObject({ ahead: 0, behind: 0 });
    expect(repoActionErrorForRepo("Repo1")).toBeNull();
  });

  it("自动刷新不会同步未开启自动同步的仓库", async () => {
    state.settings = workspaceSettings();
    service.listManagedRepos.mockResolvedValue([repoSummary("Repo1")]);
    service.refreshRepoSummary.mockResolvedValue(repoSummary("Repo1", { ahead: 1 }));

    await refreshRepoSummaries();

    expect(service.bulkSyncExecute).not.toHaveBeenCalled();
    expect(state.repos.find((repo) => repo.id === "Repo1")).toMatchObject({ ahead: 1 });
  });

  it("自动刷新遇到未提交变更时跳过自动同步并记录仓库错误", async () => {
    state.settings = {
      ...workspaceSettings(),
      repoSyncPreferences: { Repo1: { autoSync: true } },
    };
    service.listManagedRepos.mockResolvedValue([repoSummary("Repo1")]);
    service.refreshRepoSummary.mockResolvedValue(repoSummary("Repo1", { ahead: 1, unstagedCount: 1 }));

    await refreshRepoSummaries();

    expect(service.bulkSyncExecute).not.toHaveBeenCalled();
    expect(repoActionErrorForRepo("Repo1")).toBe("存在未提交变更，已跳过自动同步");
    expect(state.recentSync).toBeNull();
  });

  it("自动刷新遇到本地修改且落后远端时使用 stash 策略同步", async () => {
    const stale = repoSummary("Repo1", { behind: 1, unstagedCount: 1 });
    const synced = repoSummary("Repo1", { behind: 0, unstagedCount: 1 });
    state.settings = {
      ...workspaceSettings(),
      repoSyncPreferences: { Repo1: { autoSync: true } },
    };
    service.listManagedRepos.mockResolvedValue([repoSummary("Repo1")]);
    service.refreshRepoSummary.mockResolvedValue(stale);
    service.bulkSyncExecute.mockResolvedValue([
      { repoId: "Repo1", status: "success", message: "完成", summary: synced },
    ]);

    await refreshRepoSummaries();

    expect(service.bulkSyncExecute).toHaveBeenCalledWith("sync", ["Repo1"], "stash");
    expect(repoActionErrorForRepo("Repo1")).toBeNull();
    expect(state.repos[0]).toMatchObject({ behind: 0, unstagedCount: 1 });
  });

  it("自动刷新执行自动同步时暴露同步中状态并保存最近失败", async () => {
    const stale = repoSummary("Repo1", { ahead: 1 });
    const execution = deferred<typeof state.bulkResults>();
    state.settings = {
      ...workspaceSettings(),
      repoSyncPreferences: { Repo1: { autoSync: true } },
    };
    service.listManagedRepos.mockResolvedValue([repoSummary("Repo1")]);
    service.refreshRepoSummary.mockResolvedValue(stale);
    service.bulkSyncExecute.mockReturnValueOnce(execution.promise);

    const refreshing = refreshRepoSummaries();
    await waitFor(() => expect(service.bulkSyncExecute).toHaveBeenCalledWith("sync", ["Repo1"], "stash"));

    expect(bulkSyncRunningRepoIds().has("Repo1")).toBe(true);

    execution.resolve([
      { repoId: "Repo1", status: "error", message: "认证失败", summary: null },
    ]);
    await refreshing;

    expect(bulkSyncRunningRepoIds().has("Repo1")).toBe(false);
    expect(repoActionErrorForRepo("Repo1")).toBe("认证失败");
    expect(state.recentSync?.preview.operation).toBe("sync");
    expect(state.recentSync?.preview.eligible).toEqual([{ repo: stale, reason: "有本地提交待推送" }]);
    expect(recentSyncErrorForRepo("Repo1")).toEqual({ message: "认证失败", retrying: false });
  });

  it("自动同步重复触发时沿用运行中状态且不覆盖错误提示", async () => {
    const stale = repoSummary("Repo1", { behind: 1 });
    const synced = repoSummary("Repo1", { behind: 0 });
    const execution = deferred<typeof state.bulkResults>();
    state.settings = {
      ...workspaceSettings(),
      repoSyncPreferences: { Repo1: { autoSync: true } },
    };
    state.repos = [stale];
    service.bulkSyncExecute.mockReturnValueOnce(execution.promise);

    const running = autoSyncRepoIfNeeded("Repo1");
    await waitFor(() => expect(service.bulkSyncExecute).toHaveBeenCalledWith("sync", ["Repo1"], "stash"));
    expect(bulkSyncRunningRepoIds().has("Repo1")).toBe(true);

    await autoSyncRepoIfNeeded("Repo1");

    expect(service.bulkSyncExecute).toHaveBeenCalledTimes(1);
    expect(repoActionErrorForRepo("Repo1")).toBeNull();

    execution.resolve([
      { repoId: "Repo1", status: "success", message: "完成", summary: synced },
    ]);
    await running;

    expect(bulkSyncRunningRepoIds().has("Repo1")).toBe(false);
    expect(state.repos[0].behind).toBe(0);
  });

  it("仓库状态刷新按固定并发上限启动，单个仓库未完成时不阻塞同批其他仓库", async () => {
    const repoIds = ["Repo1", "Repo2", "Repo3", "Repo4", "Repo5", "Repo6"];
    const resolvers = new Map<string, () => void>();
    service.listManagedRepos.mockResolvedValue(repoIds.map((repoId) => repoSummary(repoId, { githubFullName: null })));
    service.refreshRepoSummary.mockImplementation((repoId: string) => new Promise((resolve) => {
      resolvers.set(repoId, () => resolve(repoSummary(repoId, { ahead: repoId === "Repo1" ? 1 : 0 })));
    }));

    await refreshRepos();

    await waitFor(() => expect(service.refreshRepoSummary).toHaveBeenCalledTimes(4));
    expect(service.refreshRepoSummary).not.toHaveBeenCalledWith("Repo5", { fetchRemote: true });
    expect(state.scanning).toBe(true);
    expect(state.refreshingRepoIds).toHaveLength(0);

    resolvers.get("Repo1")?.();
    await waitFor(() => expect(service.refreshRepoSummary).toHaveBeenCalledTimes(5));
    expect(service.refreshRepoSummary).toHaveBeenCalledWith("Repo5", { fetchRemote: true });
    await waitFor(() => expect(state.repos.find((repo) => repo.id === "Repo1")).toMatchObject({ ahead: 1 }));
    expect(state.refreshingRepoIds).toHaveLength(0);

    resolvers.get("Repo2")?.();
    await waitFor(() => expect(service.refreshRepoSummary).toHaveBeenCalledTimes(6));
    expect(service.refreshRepoSummary).toHaveBeenCalledWith("Repo6", { fetchRemote: true });

    for (const repoId of repoIds.slice(2)) {
      resolvers.get(repoId)?.();
    }
    await waitFor(() => expect(state.scanning).toBe(false));
    expect(state.refreshingRepoIds).toHaveLength(0);
  });

  it("后台批量仓库刷新不会展开行级刷新状态但仍批量提交完成项", async () => {
    const repoIds = ["Repo1", "Repo2", "Repo3"];
    const resolvers = new Map<string, () => void>();
    service.listManagedRepos.mockResolvedValue(repoIds.map((repoId) => repoSummary(repoId, { githubFullName: null })));
    service.refreshRepoSummary.mockImplementation((repoId: string) => new Promise((resolve) => {
      const aheadByRepoId: Record<string, number> = { Repo1: 1, Repo2: 2, Repo3: 3 };
      resolvers.set(repoId, () => resolve(repoSummary(repoId, { ahead: aheadByRepoId[repoId] ?? 0 })));
    }));

    await refreshRepos();
    await waitFor(() => expect(service.refreshRepoSummary).toHaveBeenCalledTimes(3));
    expect(state.scanning).toBe(true);
    expect(state.refreshingRepoIds).toHaveLength(0);

    resolvers.get("Repo1")?.();
    resolvers.get("Repo2")?.();

    await waitFor(() => {
      expect(state.repos.find((repo) => repo.id === "Repo1")).toMatchObject({ ahead: 1 });
      expect(state.repos.find((repo) => repo.id === "Repo2")).toMatchObject({ ahead: 2 });
    });
    expect(state.refreshingRepoIds).toHaveLength(0);

    resolvers.get("Repo3")?.();
    await waitFor(() => expect(state.scanning).toBe(false));
    expect(state.refreshingRepoIds).toHaveLength(0);
    expect(state.repos.find((repo) => repo.id === "Repo3")).toMatchObject({ ahead: 3 });
  });

  it("新一轮刷新开始后旧刷新完成不会清掉当前刷新状态", async () => {
    const firstRefresh = deferred<ReturnType<typeof repoSummary>>();
    const secondRefresh = deferred<ReturnType<typeof repoSummary>>();
    service.listManagedRepos.mockResolvedValue([repoSummary("Repo1", { githubFullName: null })]);
    service.refreshRepoSummary
      .mockReturnValueOnce(firstRefresh.promise)
      .mockReturnValueOnce(secondRefresh.promise);

    await refreshRepos();
    await waitFor(() => expect(service.refreshRepoSummary).toHaveBeenCalledTimes(1));
    expect(state.scanning).toBe(true);
    expect(state.refreshingRepoIds).toHaveLength(0);

    const currentRefresh = refreshRepoSummaries();
    await waitFor(() => expect(service.refreshRepoSummary).toHaveBeenCalledTimes(2));
    expect(state.scanning).toBe(true);
    expect(state.refreshingRepoIds).toHaveLength(0);

    firstRefresh.resolve(repoSummary("Repo1", { ahead: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.scanning).toBe(true);
    expect(state.refreshingRepoIds).toHaveLength(0);

    secondRefresh.resolve(repoSummary("Repo1", { ahead: 2 }));
    await currentRefresh;
    await waitFor(() => expect(state.scanning).toBe(false));
    expect(state.refreshingRepoIds).toHaveLength(0);
  });

  it("任务列表刷新只应用最后一轮返回结果", async () => {
    const firstRefresh = deferred<typeof state.tasks>();
    const secondRefresh = deferred<typeof state.tasks>();
    service.listWorkspaceTasks
      .mockReturnValueOnce(firstRefresh.promise)
      .mockReturnValueOnce(secondRefresh.promise);

    const firstLoad = refreshWorkspaceTasks();
    const secondLoad = refreshWorkspaceTasks();

    secondRefresh.resolve([{
      id: "new-task",
      kind: "repoStatus",
      priority: "normal",
      repoId: "Repo1",
      status: "success",
      message: "new",
      updatedAt: 2,
    }]);
    await secondLoad;
    expect(state.tasks.map((task) => task.id)).toEqual(["new-task"]);

    firstRefresh.resolve([{
      id: "old-task",
      kind: "repoStatus",
      priority: "normal",
      repoId: "Repo1",
      status: "success",
      message: "old",
      updatedAt: 1,
    }]);
    await firstLoad;
    expect(state.tasks.map((task) => task.id)).toEqual(["new-task"]);
  });

  it("任务列表同 ID 只保留更新时间最新的一笔", async () => {
    service.listWorkspaceTasks.mockResolvedValueOnce([
      {
        id: "repo-task",
        kind: "repoStatus",
        priority: "normal",
        repoId: "Repo1",
        status: "running",
        message: "old",
        updatedAt: 1,
      },
      {
        id: "repo-task",
        kind: "repoStatus",
        priority: "normal",
        repoId: "Repo1",
        status: "success",
        message: "new",
        updatedAt: 2,
      },
      {
        id: "other-task",
        kind: "languageStats",
        priority: "low",
        repoId: "Repo2",
        status: "pending",
        message: null,
        updatedAt: 1,
      },
    ]);

    await refreshWorkspaceTasks();

    expect(state.tasks.map((task) => [task.id, task.status, task.updatedAt])).toEqual([
      ["repo-task", "success", 2],
      ["other-task", "pending", 1],
    ]);
  });

  it("新一代语言统计刷新不会被旧一代同仓库 loading 跳过", async () => {
    const oldStats = deferred<ReturnType<typeof repoSummary>>();
    const newStats = deferred<ReturnType<typeof repoSummary>>();
    state.repos = [repoSummary("Repo1", {
      languageStats: [{ language: "Vue", bytes: 1, lines: 1 }],
      languageStatsUpdatedAt: 1,
    })];
    service.listManagedRepos.mockResolvedValue([repoSummary("Repo1", { githubFullName: null })]);
    service.refreshRepoSummary.mockResolvedValue(repoSummary("Repo1", { githubFullName: null }));
    service.refreshRepoLanguageStats
      .mockReturnValueOnce(oldStats.promise)
      .mockReturnValueOnce(newStats.promise);

    const oldRefresh = refreshRepoLanguageStats("Repo1");

    await refreshRepoSummaries();
    const newRefresh = refreshRepoLanguageStats("Repo1");
    await waitFor(() => expect(service.refreshRepoLanguageStats).toHaveBeenCalledTimes(2));

    oldStats.resolve(repoSummary("Repo1", {
      languageStats: [{ language: "Old", bytes: 10, lines: 10 }],
      languageStatsUpdatedAt: 2,
    }));
    await oldRefresh;
    expect(state.repos[0].languageStats).toEqual([{ language: "Vue", bytes: 1, lines: 1 }]);

    newStats.resolve(repoSummary("Repo1", {
      languageStats: [{ language: "TypeScript", bytes: 20, lines: 20 }],
      languageStatsUpdatedAt: 3,
    }));
    await newRefresh;

    expect(state.repos[0].languageStats).toEqual([{ language: "TypeScript", bytes: 20, lines: 20 }]);
    expect(state.repos[0].languageStatsUpdatedAt).toBe(3);
  });

  it("轻量刷新后逐个刷新仓库状态并按本地仓库列表刷新贡献图", async () => {
    service.listManagedRepos.mockResolvedValue([
      repoSummary("LiliaGithub", { githubFullName: null }),
      repoSummary("Lilia", { githubFullName: null }),
      repoSummary("LocalOnly", { githubFullName: null }),
      repoSummary("LiliaDuplicate", { githubFullName: null }),
    ]);
    service.refreshRepoSummary.mockImplementation(async (repoId: string) => ({
      ...repoSummary(repoId),
      githubFullName: repoId === "LocalOnly" ? null : repoId === "LiliaDuplicate" ? "sena-nana/Lilia" : `sena-nana/${repoId}`,
    }));
    service.refreshRepoLanguageStats.mockImplementation(async (repoId: string) => repoSummary(repoId, {
      githubFullName: repoId === "LocalOnly" ? null : repoId === "LiliaDuplicate" ? "sena-nana/Lilia" : `sena-nana/${repoId}`,
      languageStats: [{ language: "TypeScript", bytes: 1, lines: 1 }],
      languageStatsUpdatedAt: 1,
    }));
    service.listRepoContribution.mockImplementation(async (repoScope: string) => ({
      days: [{ date: "2026-06-11", count: repoScope === "local:LiliaGithub" ? 1 : 2 }],
      meta: {
        repoCount: 1,
        requestedRepoCount: 1,
        repoLimit: 30,
        truncated: false,
        skippedRepoCount: 0,
        refreshedAt: 1_780_000_000_000,
      },
    }));

    await refreshRepos();

    await waitFor(() => expect(service.refreshRepoSummary).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(service.listRepoContribution).toHaveBeenCalledTimes(4));
    expect(service.listRepoContribution).toHaveBeenCalledWith("local:LiliaGithub");
    expect(service.listRepoContribution).toHaveBeenCalledWith("local:Lilia");
    expect(service.listRepoContribution).toHaveBeenCalledWith("local:LocalOnly");
    expect(service.listRepoContribution).toHaveBeenCalledWith("local:LiliaDuplicate");
    expect(state.githubContributions.days.find((day) => day.date === "2026-06-11")).toMatchObject({
      date: "2026-06-11",
      count: 7,
    });
    expect(state.githubContributions.meta).toMatchObject({
      repoCount: 4,
      requestedRepoCount: 4,
      repoLimit: 30,
      truncated: false,
      skippedRepoCount: 0,
    });
    expect(state.githubContributions.error).toBeNull();
  });

  it("共享 worktree 只按代表仓库刷新一次本地贡献图", async () => {
    service.listManagedRepos.mockResolvedValue([
      repoSummary("main-repo", {
        githubFullName: null,
        worktree: {
          role: "main",
          sharedRepoKey: "shared:repo",
          mainRepoId: "main-repo",
        },
      }),
      repoSummary("linked-repo", {
        githubFullName: null,
        worktree: {
          role: "linked",
          sharedRepoKey: "shared:repo",
          mainRepoId: "main-repo",
        },
      }),
      repoSummary("standalone-repo", { githubFullName: null }),
    ]);
    service.refreshRepoSummary.mockImplementation(async (repoId: string) => ({
      ...repoSummary(repoId, { githubFullName: null }),
      worktree: repoId === "main-repo"
        ? { role: "main", sharedRepoKey: "shared:repo", mainRepoId: "main-repo" }
        : repoId === "linked-repo"
          ? { role: "linked", sharedRepoKey: "shared:repo", mainRepoId: "main-repo" }
          : { role: "standalone", sharedRepoKey: "repo:standalone-repo", mainRepoId: null },
    }));
    service.listRepoContribution.mockImplementation(async (repoScope: string) => ({
      days: [{ date: "2026-06-11", count: repoScope === "local:main-repo" ? 3 : 2 }],
      meta: {
        repoCount: 1,
        requestedRepoCount: 1,
        repoLimit: 30,
        truncated: false,
        skippedRepoCount: 0,
        refreshedAt: 1_780_000_000_000,
      },
    }));

    await refreshRepos();

    await waitFor(() => expect(service.listRepoContribution).toHaveBeenCalledTimes(2));
    expect(service.listRepoContribution).toHaveBeenCalledWith("local:main-repo");
    expect(service.listRepoContribution).toHaveBeenCalledWith("local:standalone-repo");
    expect(service.listRepoContribution).not.toHaveBeenCalledWith("local:linked-repo");
    expect(state.githubContributions.days.find((day) => day.date === "2026-06-11")).toMatchObject({
      date: "2026-06-11",
      count: 5,
    });
    expect(state.githubContributions.meta).toMatchObject({
      repoCount: 2,
      requestedRepoCount: 2,
      repoLimit: 30,
      truncated: false,
      skippedRepoCount: 0,
    });
  });

  it("本地贡献刷新失败不会回退到 GitHub scope", async () => {
    service.listManagedRepos.mockResolvedValue([
      repoSummary("LocalOnly", {
        githubFullName: null,
        remoteUrl: "https://github.com/sena-nana/LocalOnly.git",
      }),
    ]);
    service.refreshRepoSummary.mockResolvedValue(repoSummary("LocalOnly", {
      githubFullName: null,
      remoteUrl: "https://github.com/sena-nana/LocalOnly.git",
    }));
    service.listRepoContribution.mockRejectedValue(new Error("未读取到本地提交"));

    await refreshRepos();

    await waitFor(() => expect(service.listRepoContribution).toHaveBeenCalledWith("local:LocalOnly"));
    await waitFor(() => expect(state.githubContributions.error).toBe("Error: 未读取到本地提交"));
    expect(service.listRepoContribution).toHaveBeenCalledTimes(1);
    expect(service.listRepoContribution).not.toHaveBeenCalledWith("github:sena-nana/LocalOnly");
    expect(state.githubContributions.meta).toMatchObject({
      requestedRepoCount: 1,
      skippedRepoCount: 0,
    });
  });

  it("本地仓库无远端映射时仍按本地 scope 刷新", async () => {
    service.listManagedRepos.mockResolvedValue([
      repoSummary("LocalOnly", {
        githubFullName: null,
        remoteUrl: null,
      }),
    ]);
    service.refreshRepoSummary.mockResolvedValue(repoSummary("LocalOnly", {
      githubFullName: null,
      remoteUrl: null,
    }));
    service.listRepoContribution.mockResolvedValue({
      days: [{ date: "2026-06-11", count: 2 }],
      meta: {
        repoCount: 1,
        requestedRepoCount: 1,
        repoLimit: 30,
        truncated: false,
        skippedRepoCount: 0,
        refreshedAt: 1_780_000_000_000,
      },
    });

    await refreshRepos();

    await waitFor(() => expect(service.listRepoContribution).toHaveBeenCalledWith("local:LocalOnly"));
    expect(state.githubContributions.error).toBeNull();
    expect(state.githubContributions.meta).toMatchObject({
      repoCount: 1,
      requestedRepoCount: 1,
      skippedRepoCount: 0,
    });
  });

  it("GitHub 贡献图等待本轮仓库结果完成后一次提交", async () => {
    const contributionResolvers = new Map<string, (result: GitHubContributionResult) => void>();
    service.listManagedRepos.mockResolvedValue([
      repoSummary("FastRepo", { githubFullName: null }),
      repoSummary("SlowRepo", { githubFullName: null }),
    ]);
    service.refreshRepoSummary.mockImplementation(async (repoId: string) => ({
      ...repoSummary(repoId),
      githubFullName: `sena-nana/${repoId}`,
    }));
    service.listRepoContribution.mockImplementation((repoFullName: string) =>
      new Promise((resolve) => {
        contributionResolvers.set(repoFullName, resolve);
      }),
    );

    await refreshRepos();

    await waitFor(() => expect(service.listRepoContribution).toHaveBeenCalledTimes(2));
    contributionResolvers.get("local:FastRepo")?.({
      days: [{ date: "2026-06-11", count: 2 }],
      meta: {
        repoCount: 1,
        requestedRepoCount: 1,
        repoLimit: 30,
        truncated: false,
        skippedRepoCount: 0,
        refreshedAt: 1_780_000_000_000,
      },
    });

    await Promise.resolve();
    expect(state.githubContributions.days.find((day) => day.date === "2026-06-11")).toBeUndefined();
    expect(state.githubContributions.loading).toBe(true);

    contributionResolvers.get("local:SlowRepo")?.({
      days: [{ date: "2026-06-11", count: 3 }],
      meta: {
        repoCount: 1,
        requestedRepoCount: 1,
        repoLimit: 30,
        truncated: false,
        skippedRepoCount: 0,
        refreshedAt: 1_780_000_000_000,
      },
    });

    await waitFor(() => expect(state.githubContributions.loading).toBe(false));
    expect(state.githubContributions.days.find((day) => day.date === "2026-06-11")).toMatchObject({
      date: "2026-06-11",
      count: 5,
    });
    expect(state.githubContributions.meta).toMatchObject({
      repoCount: 2,
      requestedRepoCount: 2,
      repoLimit: 30,
      truncated: false,
      skippedRepoCount: 0,
    });
  });

  it("后台语言统计刷新完成后批量提交仓库语言数据", async () => {
    const languageResolvers = new Map<string, (summary: ReturnType<typeof repoSummary>) => void>();
    service.listManagedRepos.mockResolvedValue([
      repoSummary("Repo1", { githubFullName: null }),
      repoSummary("Repo2", { githubFullName: null }),
    ]);
    service.refreshRepoSummary.mockImplementation(async (repoId: string) => repoSummary(repoId, { githubFullName: null }));
    service.refreshRepoLanguageStats.mockImplementation((repoId: string) =>
      new Promise((resolve) => {
        languageResolvers.set(repoId, resolve);
      }),
    );

    await refreshRepos();

    await waitFor(() => expect(service.refreshRepoLanguageStats).toHaveBeenCalledTimes(2));
    languageResolvers.get("Repo1")?.(repoSummary("Repo1", {
      languageStats: [{ language: "TypeScript", bytes: 20, lines: 20 }],
      languageStatsUpdatedAt: 2,
    }));
    await Promise.resolve();
    expect(state.repos.find((repo) => repo.id === "Repo1")?.languageStats).toEqual([]);

    languageResolvers.get("Repo2")?.(repoSummary("Repo2", {
      languageStats: [{ language: "Vue", bytes: 10, lines: 10 }],
      languageStatsUpdatedAt: 3,
    }));

    await waitFor(() => {
      expect(state.repos.find((repo) => repo.id === "Repo1")?.languageStats).toEqual([
        { language: "TypeScript", bytes: 20, lines: 20 },
      ]);
      expect(state.repos.find((repo) => repo.id === "Repo2")?.languageStats).toEqual([
        { language: "Vue", bytes: 10, lines: 10 },
      ]);
    });
  });

  it("轻量仓库列表完成时立即刷新本地贡献图，不等待 summary", async () => {
    service.listManagedRepos.mockResolvedValue([
      repoSummary("FastRepo", { githubFullName: null }),
      repoSummary("SlowRepo", { githubFullName: null }),
    ]);
    service.refreshRepoSummary.mockImplementation(() => new Promise<ReturnType<typeof repoSummary>>(() => undefined));
    service.listRepoContribution.mockResolvedValue({
      days: [{ date: "2026-06-11", count: 2 }],
      meta: {
        repoCount: 1,
        requestedRepoCount: 1,
        repoLimit: 30,
        truncated: false,
        skippedRepoCount: 0,
        refreshedAt: 1_780_000_000_000,
      },
    });

    await refreshRepos();

    await waitFor(() => expect(service.refreshRepoSummary).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(service.listRepoContribution).toHaveBeenCalledWith("local:FastRepo"));
    await waitFor(() => expect(service.listRepoContribution).toHaveBeenCalledWith("local:SlowRepo"));
    await waitFor(() => expect(service.listRepoContribution).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(state.githubContributions.days.find((day) => day.date === "2026-06-11")).toMatchObject({
      date: "2026-06-11",
      count: 4,
    }));
    expect(state.githubContributions.meta).toMatchObject({
      repoCount: 2,
      requestedRepoCount: 2,
      repoLimit: 30,
      truncated: false,
    });
  });

  it("单仓库刷新失败不清空项目列表，也不影响其他仓库继续更新", async () => {
    const refreshedSummaries = new Map<string, ReturnType<typeof repoSummary>>();
    service.listManagedRepos.mockResolvedValue([
      repoSummary("LiliaGithub", { githubFullName: null }),
      repoSummary("Lilia", { githubFullName: null }),
      repoSummary("LocalOnly", { githubFullName: null }),
    ]);
    service.refreshRepoSummary.mockImplementation(async (repoId: string) => {
      if (repoId === "Lilia") throw new Error("status failed");
      const summary = repoSummary(repoId, {
        githubFullName: repoId === "LocalOnly" ? null : `sena-nana/${repoId}`,
        ahead: repoId === "LiliaGithub" ? 2 : 0,
      });
      refreshedSummaries.set(repoId, summary);
      return summary;
    });
    service.refreshRepoLanguageStats.mockImplementation(async (repoId: string) => ({
      ...(refreshedSummaries.get(repoId) ?? repoSummary(repoId)),
      languageStats: [{ language: "TypeScript", bytes: 1, lines: 1 }],
      languageStatsUpdatedAt: 1,
    }));

    await refreshRepos();

    await waitFor(() => expect(service.refreshRepoSummary).toHaveBeenCalledTimes(3));
    expect(state.repos.map((repo) => repo.id)).toEqual(["LiliaGithub", "Lilia", "LocalOnly"]);
    await waitFor(() => {
      expect(state.repos.find((repo) => repo.id === "LiliaGithub")).toMatchObject({
        githubFullName: "sena-nana/LiliaGithub",
        ahead: 2,
      });
    });
    expect(state.repos.find((repo) => repo.id === "Lilia")).toMatchObject({
      githubFullName: null,
      ahead: 0,
    });
    expect(state.error).toBeNull();
    await waitFor(() => expect(state.scanning).toBe(false));
  });

  it("轻量列表刷新不会覆盖已刷新的语言统计", async () => {
    const withLanguages = repoSummary("LiliaGithub", {
      languageStats: [{ language: "TypeScript", bytes: 10, lines: 10 }],
      languageStatsUpdatedAt: 123,
    });
    state.repos = [withLanguages];
    service.listManagedRepos.mockResolvedValue([
      repoSummary("LiliaGithub", {
        currentBranch: null,
        remoteUrl: null,
        githubFullName: null,
        languageStats: [],
        languageStatsUpdatedAt: 0,
      }),
    ]);
    service.refreshRepoSummary.mockImplementation(async (repoId: string) =>
      repoSummary(repoId, {
        languageStats: [],
        languageStatsUpdatedAt: 0,
      }),
    );

    await refreshRepos();

    await waitFor(() => expect(service.refreshRepoSummary).toHaveBeenCalledWith("LiliaGithub", { fetchRemote: true }));
    expect(state.repos[0].languageStats).toEqual([{ language: "TypeScript", bytes: 10, lines: 10 }]);
    expect(state.repos[0].languageStatsUpdatedAt).toBe(123);
  });

  it("本地贡献图失败不覆盖仓库扫描结果", async () => {
    const repo = repoSummary("LiliaGithub", { githubFullName: "sena-nana/LiliaGithub" });
    service.listManagedRepos.mockResolvedValue([repoSummary("LiliaGithub", { githubFullName: null })]);
    service.refreshRepoSummary.mockResolvedValue(repo);
    service.listRepoContribution.mockRejectedValue(new Error("rate limited"));

    await refreshRepos();

    await waitFor(() => expect(state.repos[0]).toMatchObject({
      id: repo.id,
      githubFullName: repo.githubFullName,
      remoteUrl: repo.remoteUrl,
    }));
    expect(state.error).toBeNull();
    await waitFor(() => expect(state.githubContributions.error).toBe("Error: rate limited"));
    expect(state.githubContributions.meta).toMatchObject({
      repoCount: 0,
      requestedRepoCount: 1,
      repoLimit: 30,
      truncated: false,
    });
  });

  it("没有本地仓库时写入空贡献图采样信息", async () => {
    service.listManagedRepos.mockResolvedValue([]);

    await refreshRepos();

    await waitFor(() => expect(state.githubContributions.meta).toMatchObject({
      repoCount: 0,
      requestedRepoCount: 0,
      repoLimit: 30,
      truncated: false,
    }));
    expect(service.listRepoContribution).not.toHaveBeenCalled();
    expect(typeof state.githubContributions.meta?.refreshedAt).toBe("number");
  });

  it("隐藏仓库只移除目标仓库和缓存，不触发全量扫描", async () => {
    const target = repoSummary("LiliaGithub");
    state.repos = [target, repoSummary("Lilia")];
    state.settings = {
      ...workspaceSettings(),
      localContributionCache: {
        [target.id]: {
          "2026-06-11": { count: 2, updatedAt: 1 },
        },
      },
    };
    state.repoDetails[target.id] = repoDetail(target);
    state.launchConfigs[target.id] = { command: "yarn dev", cwd: null, source: "manual", updatedAt: 1 };
    state.launchStatuses[target.id] = {
      repoId: target.id,
      state: "running",
      pid: 1234,
      command: "yarn dev",
      startedAt: 1,
      exitCode: null,
      error: null,
    };
    state.launchLogs[target.id] = [{ index: 1, repoId: target.id, stream: "system", line: "start", timestamp: 1 }];
    service.hideRepo.mockResolvedValue(workspaceSettings([target.id]));

    await hideRepo(target.id);

    expect(service.discoverRepos).not.toHaveBeenCalled();
    expect(state.repos.map((repo) => repo.id)).toEqual(["Lilia"]);
    expect(state.repoDetails[target.id]).toBeUndefined();
    expect(state.launchConfigs[target.id]).toBeUndefined();
    expect(state.launchStatuses[target.id]).toBeUndefined();
    expect(state.launchLogs[target.id]).toBeUndefined();
    expect(state.settings?.localContributionCache[target.id]).toBeUndefined();
  });

  it("恢复仓库只读取目标仓库 summary 并插回列表", async () => {
    const restored = repoSummary("LiliaGithub", { ahead: 2 });
    state.repos = [repoSummary("Lilia")];
    service.unhideRepo.mockResolvedValue(workspaceSettings());
    service.getRepoSummary.mockResolvedValue(restored);

    await unhideRepo(restored.id);

    expect(service.discoverRepos).not.toHaveBeenCalled();
    expect(service.getRepoSummary).toHaveBeenCalledWith(restored.id);
    expect(state.repos.map((repo) => repo.id)).toEqual(["Lilia", "LiliaGithub"]);
    expect(state.repos.find((repo) => repo.id === restored.id)?.ahead).toBe(2);
  });

  it("撤销系统 git 凭证偏好后同步 settings 状态", async () => {
    state.settings = {
      ...workspaceSettings(),
      systemGitRepoIds: ["Lilia", "LiliaGithub"],
    };
    service.useDefaultTokenAuthForRepo.mockResolvedValue({
      ...workspaceSettings(),
      systemGitRepoIds: ["Lilia"],
    });

    await useDefaultTokenAuthForRepo("LiliaGithub");

    expect(service.useDefaultTokenAuthForRepo).toHaveBeenCalledWith("LiliaGithub");
    expect(state.settings?.systemGitRepoIds).toEqual(["Lilia"]);
  });

  it("批量执行后只按返回的 summaries 更新相关仓库", async () => {
    const before = repoSummary("LiliaGithub", { ahead: 1 });
    const after = repoSummary("LiliaGithub", { ahead: 0 });
    state.repoDetails[before.id] = repoDetail(before);
    state.repos = [before, repoSummary("Lilia", { ahead: 3 })];
    state.bulkPreview = {
      operation: "push",
      eligible: [{ repo: before, reason: "有本地提交待推送" }],
      blocked: [],
      warnings: [],
    };
    service.bulkSyncExecute.mockResolvedValue([
      { repoId: before.id, status: "success", message: "完成", summary: after },
    ]);

    await executeBulk();

    expect(service.discoverRepos).not.toHaveBeenCalled();
    expect(state.repos.find((repo) => repo.id === before.id)?.ahead).toBe(0);
    expect(state.repoDetails[before.id]?.summary.ahead).toBe(0);
    expect(state.repos.find((repo) => repo.id === "Lilia")?.ahead).toBe(3);
  });

  it("批量 push 后同步系统 git 凭证 settings", async () => {
    const repo = repoSummary("LiliaGithub", { ahead: 1 });
    state.repos = [repo];
    state.bulkPreview = {
      operation: "push",
      eligible: [{ repo, reason: "有本地提交待推送" }],
      blocked: [],
      warnings: [],
    };
    service.bulkSyncExecute.mockResolvedValue([
      { repoId: repo.id, status: "success", message: "完成", summary: { ...repo, ahead: 0 } },
    ]);
    service.getWorkspaceSettings.mockResolvedValue({
      ...workspaceSettings(),
      systemGitRepoIds: [repo.id],
    });

    await executeBulk();

    expect(service.getWorkspaceSettings).toHaveBeenCalled();
    expect(state.settings?.systemGitRepoIds).toEqual([repo.id]);
  });

  it("批量预检只应用最后一轮返回结果", async () => {
    const repo = repoSummary("LiliaGithub", { ahead: 1, behind: 1 });
    const firstPreview = deferred<BulkSyncPreview>();
    const secondPreview = deferred<BulkSyncPreview>();
    service.bulkSyncPreview
      .mockReturnValueOnce(firstPreview.promise)
      .mockReturnValueOnce(secondPreview.promise);

    const firstLoad = previewBulk("push");
    const secondLoad = previewBulk("pull");

    secondPreview.resolve({
      operation: "pull",
      eligible: [{ repo, reason: "远端有更新" }],
      blocked: [],
      warnings: [],
    });
    await secondLoad;
    expect(state.bulkPreview?.operation).toBe("pull");

    firstPreview.resolve({
      operation: "push",
      eligible: [{ repo, reason: "有本地提交待推送" }],
      blocked: [],
      warnings: [],
    });
    await firstLoad;
    expect(state.bulkPreview?.operation).toBe("pull");
  });

  it("批量执行结果绑定启动执行时的预检上下文", async () => {
    const repo = repoSummary("LiliaGithub", { ahead: 1, behind: 1 });
    const pushPreview: BulkSyncPreview = {
      operation: "push",
      eligible: [{ repo, reason: "有本地提交待推送" }],
      blocked: [],
      warnings: [],
    };
    const pullPreview: BulkSyncPreview = {
      operation: "pull",
      eligible: [{ repo, reason: "远端有更新" }],
      blocked: [],
      warnings: [],
    };
    const execution = deferred<typeof state.bulkResults>();
    state.bulkPreview = pushPreview;
    service.bulkSyncExecute.mockReturnValueOnce(execution.promise);

    const running = executeBulk();
    await waitFor(() => expect(service.bulkSyncExecute).toHaveBeenCalledWith("push", [repo.id], "reject"));
    state.bulkPreview = pullPreview;

    execution.resolve([
      { repoId: repo.id, status: "success", message: "完成", summary: repoSummary(repo.id, { ahead: 0 }) },
    ]);
    await running;

    expect(state.bulkPreview).toEqual(pullPreview);
    expect(state.recentSync?.preview).toEqual(pushPreview);
    expect(state.bulkRunning).toBe(false);
  });

  it("一键同步会使仍在返回中的普通预检失效", async () => {
    const repo = repoSummary("LiliaGithub", { ahead: 1 });
    const pendingPreview = deferred<BulkSyncPreview>();
    const syncPreview: BulkSyncPreview = {
      operation: "sync",
      eligible: [{ repo, reason: "有本地提交待推送" }],
      blocked: [],
      warnings: [],
    };
    service.bulkSyncPreview
      .mockReturnValueOnce(pendingPreview.promise)
      .mockResolvedValueOnce(syncPreview);
    service.bulkSyncExecute.mockResolvedValue([
      { repoId: repo.id, status: "success", message: "完成", summary: repoSummary(repo.id, { ahead: 0 }) },
    ]);

    const stalePreview = previewBulk("push");
    await syncAll();
    expect(state.bulkPreview?.operation).toBe("sync");

    pendingPreview.resolve({
      operation: "push",
      eligible: [{ repo, reason: "有本地提交待推送" }],
      blocked: [],
      warnings: [],
    });
    await stalePreview;

    expect(state.bulkPreview?.operation).toBe("sync");
    expect(state.recentSync?.preview.operation).toBe("sync");
  });

  it("一键同步直接预检并执行可同步仓库，不再调用单仓库 push", async () => {
    const first = repoSummary("LiliaGithub", { ahead: 1 });
    const both = repoSummary("Lilia", { ahead: 1, behind: 1 });
    const preview: BulkSyncPreview = {
      operation: "sync",
      eligible: [
        { repo: first, reason: "有本地提交待推送" },
        { repo: both, reason: "需先拉取合并后推送" },
      ],
      blocked: [],
      warnings: [],
    };
    service.bulkSyncPreview.mockResolvedValue(preview);
    service.bulkSyncExecute.mockResolvedValue([
      { repoId: first.id, status: "success", message: "完成", summary: repoSummary(first.id, { ahead: 0 }) },
      { repoId: both.id, status: "error", message: "合并产生冲突，请处理后推送", summary: repoSummary(both.id, { conflictCount: 1 }) },
    ]);

    await syncAll();

    expect(service.bulkSyncPreview).toHaveBeenCalledWith("sync", expect.any(Array), "reject");
    expect(service.bulkSyncExecute).toHaveBeenCalledWith("sync", [first.id, both.id], "reject");
    expect(service.pushRepo).not.toHaveBeenCalled();
    expect(state.bulkPreview).toEqual(preview);
    expect(state.bulkResults).toEqual([
      { repoId: first.id, status: "success", message: "完成", summary: repoSummary(first.id, { ahead: 0 }) },
      { repoId: both.id, status: "error", message: "合并产生冲突，请处理后推送", summary: repoSummary(both.id, { conflictCount: 1 }) },
    ]);
  });

  it("sync 状态 helper 只暴露真实执行仓库和失败结果", () => {
    const ready = repoSummary("LiliaGithub", { ahead: 1 });
    const diverged = repoSummary("Lilia", { ahead: 1, behind: 1 });
    state.bulkPreview = {
      operation: "sync",
      eligible: [
        { repo: ready, reason: "有本地提交待推送" },
        { repo: diverged, reason: "需先拉取合并后推送" },
      ],
      blocked: [],
      warnings: [],
    };
    state.recentSync = {
      preview: state.bulkPreview,
      results: [],
      retryingRepoIds: [],
      updatedAt: 1,
    };

    expect(Array.from(bulkSyncRepoIds())).toEqual(["LiliaGithub", "Lilia"]);
    expect(syncErrorByRepoId().size).toBe(0);
    expect(recentSyncErrorForRepo(diverged.id)).toBeNull();

    state.recentSync = {
      ...state.recentSync,
      results: [{ repoId: diverged.id, status: "error", message: "合并产生冲突，请处理后推送", summary: null }],
      retryingRepoIds: [diverged.id],
    };

    expect(syncErrorByRepoId().get(diverged.id)).toBe("合并产生冲突，请处理后推送");
    expect(syncErrorDetailsByRepoId().get(diverged.id)).toEqual({
      message: "合并产生冲突，请处理后推送",
      updatedAt: 1,
    });
    expect(recentSyncErrorForRepo(diverged.id)).toEqual({
      message: "合并产生冲突，请处理后推送",
      retrying: true,
    });
  });

  it("push 预检和批量执行失败结果通过主流程状态保存", async () => {
    const first = repoSummary("LiliaGithub", { ahead: 1 });
    const second = repoSummary("Lilia", { ahead: 2 });
    state.repos = [first, second];
    service.bulkSyncPreview.mockResolvedValue({
      operation: "push",
      eligible: [
        { repo: first, reason: "有本地提交待推送" },
        { repo: second, reason: "有本地提交待推送" },
      ],
      blocked: [],
      warnings: [{ repo: first, reason: "存在未提交变更，但仍可执行 push" }],
    });
    service.bulkSyncExecute.mockResolvedValue([
      { repoId: first.id, status: "success", message: "完成", summary: repoSummary(first.id, { ahead: 0 }) },
      { repoId: second.id, status: "error", message: "认证失败", summary: null },
    ]);

    await previewBulk("push");
    await executeBulk();

    expect(state.bulkPreview?.warnings).toHaveLength(1);
    expect(state.bulkResults).toEqual([
      { repoId: first.id, status: "success", message: "完成", summary: repoSummary(first.id, { ahead: 0 }) },
      { repoId: second.id, status: "error", message: "认证失败", summary: null },
    ]);
    expect(state.repos.find((repo) => repo.id === first.id)?.ahead).toBe(0);
    expect(state.repos.find((repo) => repo.id === second.id)?.ahead).toBe(2);
    expect(state.recentSync?.results).toEqual(state.bulkResults);
  });

  it("关闭内部 sync 快照后仍保留最近一次执行失败结果", async () => {
    const blocked = repoSummary("Lilia", { ahead: 1, behind: 1 });
    const failed = repoSummary("LiliaGithub", { ahead: 1 });
    service.bulkSyncPreview.mockResolvedValue({
      operation: "sync",
      eligible: [{ repo: failed, reason: "有本地提交待推送" }],
      blocked: [{ repo: blocked, reason: "存在未提交变更" }],
      warnings: [],
    });
    service.bulkSyncExecute.mockResolvedValue([
      { repoId: failed.id, status: "error", message: "认证失败", summary: null },
      { repoId: blocked.id, status: "error", message: "合并产生冲突，请处理后推送", summary: null },
    ]);

    await syncAll();
    closeBulkPreview();

    expect(state.bulkPreview).toBeNull();
    expect(state.recentSync?.preview.blocked).toEqual([{ repo: blocked, reason: "存在未提交变更" }]);
    expect(state.recentSync?.results).toEqual([
      { repoId: failed.id, status: "error", message: "认证失败", summary: null },
      { repoId: blocked.id, status: "error", message: "合并产生冲突，请处理后推送", summary: null },
    ]);
  });

  it("单仓库 push 重试会更新最近一次同步失败状态", async () => {
    const failed = repoSummary("LiliaGithub", { ahead: 1 });
    const updated = repoSummary("LiliaGithub", { ahead: 0 });
    state.repos = [failed];
    state.recentSync = {
      preview: {
        operation: "sync",
        eligible: [{ repo: failed, reason: "有本地提交待推送" }],
        blocked: [],
        warnings: [],
      },
      results: [{ repoId: failed.id, status: "error", message: "认证失败", summary: null }],
      retryingRepoIds: [],
      updatedAt: 1,
    };
    service.pushRepo.mockResolvedValue(updated);
    service.refreshRepoDetailPatch.mockResolvedValue(repoDetailPatch(updated, { commits: [] }));

    await push(failed.id);

    expect(state.recentSync?.results).toEqual([
      { repoId: failed.id, status: "success", message: "完成", summary: updated },
    ]);
    expect(state.recentSync?.retryingRepoIds).toHaveLength(0);
    expect(state.repos[0].ahead).toBe(0);
  });

  it("单仓库合并失败后记录侧边栏可读取的仓库操作错误，后续成功操作清除", async () => {
    const initial = repoSummary("LiliaGithub", { ahead: 1, behind: 1 });
    const updated = repoSummary("LiliaGithub", { ahead: 0, behind: 0 });
    state.repos = [initial];
    service.mergePullRepo.mockRejectedValue(new Error("合并失败：not something we can merge"));
    service.refreshRepoDetailPatch.mockResolvedValue(repoDetailPatch(updated, { commits: [] }));
    service.pushRepo.mockResolvedValue(updated);

    await expect(mergePull(initial.id)).rejects.toThrow("合并失败：not something we can merge");
    expect(repoActionErrorForRepo(initial.id)).toBe("Error: 合并失败：not something we can merge");
    expect(repoActionErrorDetailForRepo(initial.id)).toMatchObject({
      message: "Error: 合并失败：not something we can merge",
      updatedAt: expect.any(Number),
    });

    await push(initial.id);

    expect(repoActionErrorForRepo(initial.id)).toBeNull();
  });

  it("单仓库本地分支合并和删除后刷新当前仓库状态", async () => {
    const initial = repoSummary("LiliaGithub", { currentBranch: "main" });
    const merged = repoSummary("LiliaGithub", { currentBranch: "main" });
    const deleted = repoSummary("LiliaGithub", { currentBranch: "main" });
    state.repos = [initial];
    service.refreshRepoDetailPatch.mockResolvedValue(repoDetailPatch(deleted, { branches: [] }));
    service.mergeBranch.mockResolvedValue({
      status: "success",
      message: "合并完成",
      summary: merged,
      conflicts: conflictState(),
    });
    service.deleteBranch.mockResolvedValue(deleted);

    await mergeBranch(initial.id, "feature/local");
    await deleteBranch(initial.id, "feature/local");

    expect(service.mergeBranch).toHaveBeenCalledWith(initial.id, "feature/local");
    expect(service.deleteBranch).toHaveBeenCalledWith(initial.id, "feature/local");
    expect(service.refreshRepoDetailPatch).toHaveBeenCalledTimes(2);
    expect(service.refreshRepoDetailPatch).toHaveBeenCalledWith(initial.id, { includeCommits: true, includeBranches: false });
    expect(service.refreshRepoDetailPatch).toHaveBeenCalledWith(initial.id, { includeCommits: false, includeBranches: true });
    expect(service.refreshRepoLanguageStats).not.toHaveBeenCalled();
  });

  it("仓库详情按请求 ID 写入，避免 alias summary 掉到当前路由空态", async () => {
    const requested = repoSummary("nested/linked", {
      name: "linked",
      path: "C:\\workspace\\nested\\linked",
      relativePath: "nested/linked",
      worktree: {
        role: "linked",
        sharedRepoKey: "gitdir:main",
        mainRepoId: "main",
      },
    });
    const alias = repoSummary("linked", {
      name: "linked",
      path: requested.path,
      relativePath: "linked",
      worktree: requested.worktree,
    });
    state.repos = [requested];
    service.getRepoDetail.mockResolvedValue(repoDetail(alias, {
      changes: [{
        path: "src/linked.ts",
        oldPath: null,
        indexStatus: " ",
        worktreeStatus: "M",
        staged: false,
        unstaged: true,
        untracked: false,
        conflicted: false,
        diff: "@@ -1 +1 @@\n-old\n+new",
      }],
    }));

    await loadRepoDetail(requested.id);

    expect(state.repoDetails[requested.id]?.summary.id).toBe(requested.id);
    expect(state.repoDetails[requested.id]?.summary.relativePath).toBe(requested.id);
    expect(state.repoDetails[requested.id]?.changes[0]?.path).toBe("src/linked.ts");
    expect(state.repoDetails[alias.id]).toBeUndefined();
    expect(state.repos.find((repo) => repo.id === requested.id)?.worktree.role).toBe("linked");
  });

  it("单仓库提交、拉取、推送和切换分支后只刷新需要的状态切片", async () => {
    const initial = repoSummary("LiliaGithub", { ahead: 1, stagedCount: 1 });
    const updated = repoSummary("LiliaGithub", { ahead: 0, stagedCount: 0 });
    const initialWithLanguageStats = repoSummary("LiliaGithub", {
      ahead: 1,
      stagedCount: 1,
      languageStats: [{ language: "Vue", bytes: 1, lines: 1 }],
      languageStatsUpdatedAt: 1,
    });
    state.repos = [initialWithLanguageStats];
    service.refreshRepoDetailPatch.mockResolvedValue(repoDetailPatch(updated, { commits: [], branches: [] }));
    service.commitRepo.mockResolvedValue(updated);
    service.pullRepo.mockResolvedValue(updated);
    service.pushRepo.mockResolvedValue(updated);
    service.checkoutBranch.mockResolvedValue(updated);

    await commit(initial.id, ["src/main.ts"], "提交说明", false);
    await pull(initial.id);
    await push(initial.id);
    await checkout(initial.id, "main");

    expect(service.refreshRepoLanguageStats).not.toHaveBeenCalled();
    expect(service.refreshRepoDetailPatch).toHaveBeenCalledWith(initial.id, { includeCommits: true, includeBranches: false });
    expect(service.refreshRepoDetailPatch).toHaveBeenCalledWith(initial.id, { includeCommits: true, includeBranches: true });
    expect(state.repos[0].languageStats).toEqual([{ language: "Vue", bytes: 1, lines: 1 }]);
    expect(state.repoDetails[initial.id]?.summary.languageStats).toEqual([{ language: "Vue", bytes: 1, lines: 1 }]);
  });

  it("单仓库创建和重命名分支后只刷新当前仓库详情", async () => {
    const initial = repoSummary("LiliaGithub", { currentBranch: "main" });
    const updated = repoSummary("LiliaGithub", { currentBranch: "feature/renamed" });
    state.repos = [initial];
    service.refreshRepoDetailPatch.mockResolvedValue(repoDetailPatch(updated, { commits: [], branches: [] }));
    service.createBranch.mockResolvedValue(updated);
    service.renameBranch.mockResolvedValue(updated);

    await createBranch(initial.id, "feature/new", "main", true);
    await renameBranch(initial.id, "feature/new", "feature/renamed");

    expect(service.createBranch).toHaveBeenCalledWith(initial.id, "feature/new", "main", true);
    expect(service.renameBranch).toHaveBeenCalledWith(initial.id, "feature/new", "feature/renamed");
    expect(service.refreshRepoDetailPatch).toHaveBeenCalledTimes(2);
    expect(service.refreshRepoDetailPatch).toHaveBeenCalledWith(initial.id, { includeCommits: true, includeBranches: true });
    expect(service.refreshRepoDetailPatch).toHaveBeenCalledWith(initial.id, { includeCommits: false, includeBranches: true });
    expect(service.refreshRepoLanguageStats).not.toHaveBeenCalled();
  });

  it("暂存和取消暂存会立即更新仓库详情并在成功后校准", async () => {
    const initial = repoSummary("LiliaGithub", { unstagedCount: 1 });
    const unstagedChange = repoChange("src/main.ts");
    state.repos = [initial];
    state.repoDetails[initial.id] = repoDetail(initial, { changes: [unstagedChange] });
    const stagePending = deferred<void>();
    const stagedChange = { ...unstagedChange, staged: true, unstaged: false };
    const stagedSummary = repoSummary(initial.id, { stagedCount: 1 });
    service.stageFiles.mockReturnValue(stagePending.promise);
    service.refreshRepoDetailPatch.mockResolvedValueOnce(repoDetailPatch(stagedSummary, {
      changes: [stagedChange],
    }));

    const stageRun = stage(initial.id, ["src/main.ts"]);

    await waitFor(() => {
      expect(state.repoDetails[initial.id]?.changes[0]).toMatchObject({ staged: true, unstaged: false });
    });
    expect(state.repos[0]).toMatchObject({ stagedCount: 1, unstagedCount: 0 });

    stagePending.resolve();
    await stageRun;

    expect(service.refreshRepoDetailPatch).toHaveBeenLastCalledWith(initial.id, {
      includeCommits: false,
      includeBranches: false,
    });
    const unstagePending = deferred<void>();
    const restoredSummary = repoSummary(initial.id, { unstagedCount: 1 });
    service.unstageFiles.mockReturnValue(unstagePending.promise);
    service.refreshRepoDetailPatch.mockResolvedValueOnce(repoDetailPatch(restoredSummary, {
      changes: [unstagedChange],
    }));

    const unstageRun = unstage(initial.id, ["src/main.ts"]);

    await waitFor(() => {
      expect(state.repoDetails[initial.id]?.changes[0]).toMatchObject({ staged: false, unstaged: true });
    });
    expect(state.repos[0]).toMatchObject({ stagedCount: 0, unstagedCount: 1 });

    unstagePending.resolve();
    await unstageRun;
  });

  it("暂存失败后刷新真实状态回滚乐观变更", async () => {
    const initial = repoSummary("LiliaGithub", { unstagedCount: 1 });
    const change = repoChange("src/main.ts");
    state.repos = [initial];
    state.repoDetails[initial.id] = repoDetail(initial, { changes: [change] });
    const pending = deferred<void>();
    service.stageFiles.mockReturnValue(pending.promise);
    service.refreshRepoDetailPatch.mockResolvedValue(repoDetailPatch(initial, { changes: [change] }));

    const run = stage(initial.id, ["src/main.ts"]);

    await waitFor(() => {
      expect(state.repoDetails[initial.id]?.changes[0]).toMatchObject({ staged: true, unstaged: false });
    });

    pending.reject(new Error("暂存失败"));

    await expect(run).rejects.toThrow("暂存失败");
    expect(state.repoDetails[initial.id]?.changes[0]).toMatchObject({ staged: false, unstaged: true });
    expect(state.repos[0]).toMatchObject({ stagedCount: 0, unstagedCount: 1 });
  });

  it("丢弃变更会立即从仓库详情移除并在成功后校准", async () => {
    const initial = repoSummary("LiliaGithub", { unstagedCount: 3, untrackedCount: 1 });
    const untrackedChange = repoChange("src/scratch.ts", {
      indexStatus: "?",
      worktreeStatus: "?",
      untracked: true,
    });
    const remainingChange = repoChange("src/keep.ts");
    state.repos = [initial];
    state.repoDetails[initial.id] = repoDetail(initial, {
      changes: [repoChange("src/main.ts"), untrackedChange, remainingChange],
    });
    const pending = deferred<ReturnType<typeof repoSummary>>();
    const refreshedSummary = repoSummary(initial.id, { unstagedCount: 1 });
    service.discardFiles.mockReturnValue(pending.promise);
    service.refreshRepoDetailPatch.mockResolvedValueOnce(repoDetailPatch(refreshedSummary, {
      changes: [remainingChange],
    }));

    const run = discardChanges(initial.id, ["src/main.ts", "src/scratch.ts"]);

    await waitFor(() => {
      expect(repoChangePaths(initial.id)).toEqual(["src/keep.ts"]);
    });
    expect(state.repos[0]).toMatchObject({ unstagedCount: 1, untrackedCount: 0 });

    pending.resolve(refreshedSummary);
    await run;

    expect(service.discardFiles).toHaveBeenCalledWith(initial.id, ["src/main.ts", "src/scratch.ts"]);
  });

  it("丢弃变更失败后刷新真实状态回滚乐观移除", async () => {
    const initial = repoSummary("LiliaGithub", { unstagedCount: 2, untrackedCount: 1 });
    const untrackedChange = repoChange("src/scratch.ts", {
      indexStatus: "?",
      worktreeStatus: "?",
      untracked: true,
    });
    const remainingChange = repoChange("src/keep.ts");
    state.repos = [initial];
    state.repoDetails[initial.id] = repoDetail(initial, {
      changes: [untrackedChange, remainingChange],
    });
    const pending = deferred<ReturnType<typeof repoSummary>>();
    service.discardFiles.mockReturnValue(pending.promise);
    service.refreshRepoDetailPatch.mockResolvedValue(repoDetailPatch(initial, {
      changes: [untrackedChange, remainingChange],
    }));

    const run = discardChanges(initial.id, ["src/scratch.ts"]);

    await waitFor(() => {
      expect(repoChangePaths(initial.id)).toEqual(["src/keep.ts"]);
    });
    expect(state.repos[0]).toMatchObject({ unstagedCount: 1, untrackedCount: 0 });

    pending.reject(new Error("丢弃失败"));

    await expect(run).rejects.toThrow("丢弃失败");
    expect(repoChangePaths(initial.id)).toEqual(["src/scratch.ts", "src/keep.ts"]);
    expect(state.repos[0]).toMatchObject({ unstagedCount: 2, untrackedCount: 1 });
  });

  it("提交会立即移除已暂存变更并更新提交摘要", async () => {
    const initial = repoSummary("LiliaGithub", { stagedCount: 2, ahead: 1 });
    const stagedOnly = repoChange("src/main.ts", {
      indexStatus: "M",
      worktreeStatus: " ",
      staged: true,
      unstaged: false,
    });
    const partiallyStaged = repoChange("src/partial.ts", {
      indexStatus: "M",
      worktreeStatus: "M",
      staged: true,
      unstaged: true,
    });
    state.repos = [initial];
    state.repoDetails[initial.id] = repoDetail(initial, { changes: [stagedOnly, partiallyStaged] });
    const pending = deferred<ReturnType<typeof repoSummary>>();
    const refreshedSummary = repoSummary(initial.id, {
      ahead: 2,
      unstagedCount: 1,
      lastCommitMessage: "提交说明",
    });
    service.commitRepo.mockReturnValue(pending.promise);
    service.refreshRepoDetailPatch.mockResolvedValue(repoDetailPatch(refreshedSummary, {
      changes: [{ ...partiallyStaged, staged: false, unstaged: true }],
      commits: [],
    }));

    const run = commit(initial.id, ["src/main.ts", "src/partial.ts"], "提交说明", false);

    await waitFor(() => {
      expect(state.repoDetails[initial.id]?.changes.map((change) => change.path)).toEqual(["src/partial.ts"]);
    });
    expect(state.repoDetails[initial.id]?.changes[0]).toMatchObject({ staged: false, unstaged: true });
    expect(state.repos[0]).toMatchObject({
      ahead: 2,
      stagedCount: 0,
      unstagedCount: 1,
      lastCommitMessage: "提交说明",
    });

    pending.resolve(refreshedSummary);
    await run;
  });

  it("提交并推送失败后刷新真实状态回滚乐观推送结果", async () => {
    const initial = repoSummary("LiliaGithub", { stagedCount: 1, ahead: 1 });
    const stagedChange = repoChange("src/main.ts", {
      indexStatus: "M",
      worktreeStatus: " ",
      staged: true,
      unstaged: false,
    });
    const actualAfterFailure = repoSummary(initial.id, { stagedCount: 1, ahead: 1 });
    state.repos = [initial];
    state.repoDetails[initial.id] = repoDetail(initial, { changes: [stagedChange] });
    const pending = deferred<ReturnType<typeof repoSummary>>();
    service.commitRepo.mockReturnValue(pending.promise);
    service.refreshRepoDetailPatch.mockResolvedValue(repoDetailPatch(actualAfterFailure, {
      changes: [stagedChange],
      commits: [],
    }));

    const run = commit(initial.id, ["src/main.ts"], "提交并推送", true);

    await waitFor(() => {
      expect(state.repoDetails[initial.id]?.changes).toEqual([]);
      expect(state.repos[0]).toMatchObject({ ahead: 0, stagedCount: 0 });
    });

    pending.reject(new Error("推送失败"));

    await expect(run).rejects.toThrow("推送失败");
    expect(state.repoDetails[initial.id]?.changes[0]).toMatchObject({ path: "src/main.ts", staged: true });
    expect(state.repos[0]).toMatchObject({ ahead: 1, stagedCount: 1 });
    expect(service.refreshRepoDetailPatch).toHaveBeenLastCalledWith(initial.id, {
      includeCommits: true,
      includeBranches: false,
    });
  });

  it("推送失败后刷新真实 ahead 作为回滚结果", async () => {
    const initial = repoSummary("LiliaGithub", { ahead: 2 });
    state.repos = [initial];
    state.repoDetails[initial.id] = repoDetail(initial);
    const pending = deferred<ReturnType<typeof repoSummary>>();
    service.pushRepo.mockReturnValue(pending.promise);
    service.refreshRepoDetailPatch.mockResolvedValue(repoDetailPatch(initial, { commits: [] }));

    const run = push(initial.id);

    await waitFor(() => {
      expect(state.repos[0]).toMatchObject({ ahead: 0 });
      expect(state.repoDetails[initial.id]?.summary).toMatchObject({ ahead: 0 });
    });

    pending.reject(new Error("推送失败"));

    await expect(run).rejects.toThrow("推送失败");
    expect(state.repos[0]).toMatchObject({ ahead: 2 });
    expect(state.repoDetails[initial.id]?.summary).toMatchObject({ ahead: 2 });
    expect(service.refreshRepoDetailPatch).toHaveBeenLastCalledWith(initial.id, {
      includeCommits: true,
      includeBranches: false,
    });
  });

  it("单仓库操作继续只刷新当前仓库详情，不触发全量扫描", async () => {
    const initial = repoSummary("LiliaGithub", { ahead: 1, stagedCount: 1 });
    const updated = repoSummary("LiliaGithub", { ahead: 0, stagedCount: 0 });
    state.repos = [initial];
    service.refreshRepoDetailPatch.mockResolvedValue(repoDetailPatch(updated, { commits: [], branches: [] }));
    service.stageFiles.mockResolvedValue(undefined);
    service.unstageFiles.mockResolvedValue(undefined);
    service.commitRepo.mockResolvedValue(updated);
    service.pullRepo.mockResolvedValue(updated);
    service.pushRepo.mockResolvedValue(updated);
    service.checkoutBranch.mockResolvedValue(updated);

    await stage(initial.id, ["src/main.ts"]);
    await unstage(initial.id, ["src/main.ts"]);
    await commit(initial.id, ["src/main.ts"], "提交说明", false);
    await pull(initial.id);
    await push(initial.id);
    await checkout(initial.id, "main");

    expect(service.discoverRepos).not.toHaveBeenCalled();
    expect(service.getRepoDetail).not.toHaveBeenCalled();
    expect(service.refreshRepoDetailPatch).toHaveBeenCalledTimes(6);
    expect(service.refreshRepoLanguageStats).not.toHaveBeenCalled();
    expect(state.repos[0]).toMatchObject({
      id: updated.id,
      ahead: 0,
      stagedCount: 0,
    });
    expect(state.repos[0].languageStats).toEqual([]);
  });

  it("冲突处理操作只刷新当前仓库详情，不触发全量扫描", async () => {
    const initial = repoSummary("Lilia", { conflictCount: 1, behind: 1 });
    const updated = repoSummary("Lilia", { conflictCount: 0, stagedCount: 1, behind: 1 });
    state.repos = [initial];
    service.refreshRepoDetailPatch.mockResolvedValue(repoDetailPatch(updated));
    service.mergePullRepo.mockResolvedValue({
      status: "conflicts",
      message: "合并产生冲突，请处理后提交",
      summary: initial,
      conflicts: conflictState({
        operation: "merge",
        allResolved: false,
        files: [
          {
            path: "src/main.ts",
            status: "UU",
            resolved: false,
            binary: false,
            hunks: [
              {
                id: "hunk-1",
                startLine: 1,
                endLine: 6,
                oursLabel: "HEAD",
                theirsLabel: "origin/main",
                oursLines: ["ours"],
                theirsLines: ["theirs"],
              },
            ],
          },
        ],
      }),
    });
    service.acceptConflictFile.mockResolvedValue(updated);
    service.resolveConflictFile.mockResolvedValue(updated);
    service.markFileResolved.mockResolvedValue(updated);
    service.abortConflictOperation.mockResolvedValue(updated);
    service.continueConflictOperation.mockResolvedValue(updated);

    await mergePull(initial.id);
    await acceptConflictFile(initial.id, "src/main.ts", "ours", true);
    await resolveConflictFile(initial.id, "src/main.ts", [{ hunkId: "hunk-1", side: "ours" }], true);
    await markConflictFileResolved(initial.id, "src/main.ts");
    await continueConflictOperation(initial.id);
    await abortConflictOperation(initial.id);

    expect(service.discoverRepos).not.toHaveBeenCalled();
    expect(service.getRepoDetail).not.toHaveBeenCalled();
    expect(service.refreshRepoDetailPatch).toHaveBeenCalledTimes(6);
    expect(state.repos).toEqual([updated]);
  });
});

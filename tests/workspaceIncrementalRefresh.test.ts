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
import {
  applyWorkspaceRepoRefreshed,
  applyWorkspaceTaskChanged,
  resetRepoRefreshRuntimeForTests,
} from "../src/composables/workspace/repoRefreshEvents";
import { closeBulkPreview, executeBulk, previewBulk, syncAll } from "../src/composables/workspace/bulk";
import {
  bulkSyncRepoIds,
  bulkSyncRunningRepoIds,
  repoActionErrorForRepo,
  repoActionErrorDetailForRepo,
  repoSyncIssueForRepo,
  syncErrorByRepoId,
  syncErrorDetailsByRepoId,
  recentSyncErrorForRepo,
  resetWorkspaceStateForTests,
  state,
} from "../src/composables/workspace/state";
import type { WorkspaceService } from "../src/composables/workspace/serviceLoader";
import type {
  BulkSyncPreview,
  GitHubContributionResult,
  RepoChange,
  RepoSummary,
  WorkspaceStartupCache,
} from "../src/services/workspace";
import {
  conflictState,
  repoCommitResult,
  repoDetail,
  repoDetailPatch,
  repoSummary,
  repoSyncResult,
  workspaceSettings,
} from "./fixtures/workspace";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function startupCache(
  settings: ReturnType<typeof workspaceSettings>,
  repos: RepoSummary[],
): WorkspaceStartupCache {
  return {
    workspaceRoot: settings.workspaceRoot,
    bindingLogin: settings.githubBinding?.login ?? null,
    reposById: Object.fromEntries(repos.map((summary) => [
      summary.id,
      { summary, cachedAt: Date.now() },
    ])),
    contributions: null,
  };
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
  setActiveWorkspaceRepo: vi.fn(),
  enqueueRepoRefresh: vi.fn(),
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
  resetRepoRefreshRuntimeForTests();
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
  let taskIndex = 0;
  service.setActiveWorkspaceRepo.mockResolvedValue(undefined);
  service.enqueueRepoRefresh.mockImplementation(async (request) => {
    const taskId = `test-refresh-${++taskIndex}`;
    const kind = request.mode === "remote" ? "repoRemote" : "repoStatus";
    applyWorkspaceTaskChanged({
      id: taskId,
      kind,
      title: kind === "repoRemote" ? "检查远端更新" : "刷新仓库状态",
      priority: request.priority,
      repoId: request.repoId,
      status: "running",
      message: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cancellable: false,
    });
    try {
      const summary = await service.refreshRepoSummary(request.repoId, {
        fetchRemote: request.mode === "remote",
      });
      const detailPatch = request.detailScope === "detail"
        ? await service.refreshRepoDetailPatch(request.repoId, {
            includeCommits: Boolean(request.includeCommits),
            includeBranches: Boolean(request.includeBranches),
          })
        : null;
      applyWorkspaceRepoRefreshed({
        taskId,
        repoId: request.repoId,
        mode: request.mode,
        summary,
        detailPatch,
        remoteCheckedAt: request.mode === "remote" ? Date.now() : null,
        trigger: request.trigger,
      });
      applyWorkspaceTaskChanged({
        id: taskId,
        kind,
        title: kind === "repoRemote" ? "检查远端更新" : "刷新仓库状态",
        priority: request.priority,
        repoId: request.repoId,
        status: "success",
        message: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        cancellable: false,
      });
    } catch (err) {
      applyWorkspaceTaskChanged({
        id: taskId,
        kind,
        title: kind === "repoRemote" ? "检查远端更新" : "刷新仓库状态",
        priority: request.priority,
        repoId: request.repoId,
        status: "error",
        message: String(err),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        cancellable: false,
      });
    }
    return taskId;
  });
});

describe("workspace incremental refresh", () => {
  it("初始化先恢复可见缓存仓库，再由权威列表校正", async () => {
    const settings = {
      ...workspaceSettings(["Hidden"]),
      managedRepoIds: ["Updated", "Removed", "Hidden", "Missing"],
    };
    service.getWorkspaceSettings.mockResolvedValue(settings);
    service.readStartupCache.mockResolvedValue(startupCache(
      settings,
      ["Updated", "Removed", "Hidden", "Unmanaged"]
        .map((repoId) => repoSummary(repoId, { ahead: 2 })),
    ));
    const managedRepos = deferred<RepoSummary[]>();
    service.listManagedRepos.mockReturnValue(managedRepos.promise);

    const initialization = initialize();

    await waitFor(() => expect(service.listManagedRepos).toHaveBeenCalledTimes(1));
    expect(state.repos.map((repo) => repo.id)).toEqual(["Updated", "Removed"]);
    expect(state.repos.every((repo) => repo.ahead === 2)).toBe(true);
    expect(service.refreshRepoSummary).not.toHaveBeenCalled();

    const updated = repoSummary("Updated", { ahead: 0, path: "C:\\Current\\Updated" });
    const added = repoSummary("Added");
    managedRepos.resolve([updated, added]);
    await initialization;

    expect(state.repos).toEqual([updated, added]);
  });

  it("权威仓库列表加载失败时保留启动缓存", async () => {
    const cached = repoSummary("Cached", { ahead: 1 });
    const settings = {
      ...workspaceSettings(),
      managedRepoIds: [cached.id],
    };
    service.getWorkspaceSettings.mockResolvedValue(settings);
    service.readStartupCache.mockResolvedValue(startupCache(settings, [cached]));
    const managedRepos = deferred<RepoSummary[]>();
    service.listManagedRepos.mockReturnValue(managedRepos.promise);

    const initialization = initialize();

    await waitFor(() => expect(service.listManagedRepos).toHaveBeenCalledTimes(1));
    managedRepos.reject(new Error("list failed"));
    await initialization;

    expect(state.repos).toEqual([cached]);
    expect(state.error).toBe("Error: list failed");
    expect(service.listRepoContribution).not.toHaveBeenCalled();
    expect(service.writeStartupContributions).not.toHaveBeenCalled();
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
    expect(service.listRepoContribution).not.toHaveBeenCalled();
  });

  it("启动缓存无贡献图时在权威仓库列表加载后自动生成并写入缓存", async () => {
    const repo = repoSummary("Repo1");
    const settings = {
      ...workspaceSettings(),
      managedRepoIds: [repo.id],
    };
    const managedRepos = deferred<RepoSummary[]>();
    service.getWorkspaceSettings.mockResolvedValue(settings);
    service.readStartupCache.mockResolvedValue(startupCache(settings, [repo]));
    service.listManagedRepos.mockReturnValue(managedRepos.promise);
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

    const initialization = initialize();

    await waitFor(() => expect(service.listManagedRepos).toHaveBeenCalledTimes(1));
    expect(service.listRepoContribution).not.toHaveBeenCalled();

    managedRepos.resolve([repo]);
    await initialization;
    await waitFor(() => {
      expect(service.listRepoContribution).toHaveBeenCalledWith("local:Repo1");
      expect(service.writeStartupContributions).toHaveBeenCalledTimes(1);
    });
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

  it("自动刷新不会同步未开启自动同步的仓库", async () => {
    state.settings = workspaceSettings();
    service.listManagedRepos.mockResolvedValue([repoSummary("Repo1")]);
    service.refreshRepoSummary.mockResolvedValue(repoSummary("Repo1", { ahead: 1 }));

    await refreshRepoSummaries();

    expect(service.bulkSyncExecute).not.toHaveBeenCalled();
    expect(state.repos.find((repo) => repo.id === "Repo1")).toMatchObject({ ahead: 1 });
  });

  it("批量刷新并发提交全部仓库，并在所有请求结束后汇总失败", async () => {
    const first = deferred<string>();
    const third = deferred<string>();
    service.listManagedRepos.mockResolvedValue([
      repoSummary("Repo1"),
      repoSummary("Repo2"),
      repoSummary("Repo3"),
    ]);
    service.enqueueRepoRefresh
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new Error("Repo2 enqueue failed"))
      .mockReturnValueOnce(third.promise);

    const refreshing = refreshRepoSummaries();
    await waitFor(() => expect(service.enqueueRepoRefresh).toHaveBeenCalledTimes(3));
    expect(state.error).toBeNull();

    first.resolve("refresh-1");
    third.resolve("refresh-3");
    await refreshing;

    expect(service.enqueueRepoRefresh.mock.calls.map(([request]) => request.repoId)).toEqual([
      "Repo1",
      "Repo2",
      "Repo3",
    ]);
    expect(state.error).toContain("Repo2 enqueue failed");
  });

  it("远端刷新结果会触发已启用仓库的自动同步", async () => {
    const stale = repoSummary("Repo1", { behind: 1 });
    const synced = repoSummary("Repo1", { behind: 0 });
    state.settings = {
      ...workspaceSettings(),
      repoSyncPreferences: { Repo1: { autoSync: true } },
    };
    state.repos = [stale];
    service.bulkSyncExecute.mockResolvedValue([
      { repoId: "Repo1", status: "success", message: "完成", summary: synced },
    ]);

    applyWorkspaceRepoRefreshed({
      taskId: "remote-1",
      repoId: "Repo1",
      mode: "remote",
      summary: stale,
      detailPatch: null,
      remoteCheckedAt: Date.now(),
      trigger: "autoSync",
    });

    await waitFor(() => expect(service.bulkSyncExecute).toHaveBeenCalledWith("sync", ["Repo1"], "stash", "autoSync"));
    await waitFor(() => expect(state.repos[0].behind).toBe(0));
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
    await waitFor(() => expect(service.bulkSyncExecute).toHaveBeenCalledWith("sync", ["Repo1"], "stash", "autoSync"));
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

  it("自动同步只按已配置远端角色决定拉取或推送", async () => {
    const summary = repoSummary("Repo1", {
      ahead: 1,
      behind: 0,
      remoteBranchStates: [
        { remote: "origin", remoteBranch: "main", exists: true, ahead: 1, behind: 0, needsPull: false, needsPush: true, upstream: true },
        { remote: "mirror", remoteBranch: "main", exists: true, ahead: 0, behind: 2, needsPull: true, needsPush: false, upstream: false },
      ],
      remotesNeedingPull: 1,
      remotesNeedingPush: 1,
    });
    state.settings = {
      ...workspaceSettings(),
      repoSyncPreferences: { Repo1: { autoSync: true } },
      repoRemoteSyncPolicies: {
        Repo1: { primaryRemote: "origin", pullRemotes: ["origin"], pushRemotes: ["origin"] },
      },
    };
    state.repos = [summary];
    service.bulkSyncExecute.mockResolvedValue([{
      repoId: summary.id,
      status: "success",
      message: "完成",
      summary,
      steps: [],
    }]);

    await autoSyncRepoIfNeeded(summary.id);

    expect(service.bulkSyncExecute).toHaveBeenCalledWith("push", [summary.id], "reject", "autoSync");
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

  it("任务快照不会覆盖请求期间到达的更新事件或移除新增活动任务", async () => {
    const snapshot = deferred<typeof state.tasks>();
    service.listWorkspaceTasks.mockReturnValueOnce(snapshot.promise);

    const loading = refreshWorkspaceTasks();
    await waitFor(() => expect(service.listWorkspaceTasks).toHaveBeenCalledTimes(1));
    applyWorkspaceTaskChanged({
      id: "existing-task",
      kind: "repoStatus",
      title: "刷新仓库状态",
      priority: "normal",
      repoId: "Repo1",
      status: "success",
      message: "event result",
      createdAt: 10,
      updatedAt: 20,
      cancellable: false,
    });
    applyWorkspaceTaskChanged({
      id: "new-active-task",
      kind: "repoRemote",
      title: "检查远端更新",
      priority: "low",
      repoId: "Repo2",
      status: "running",
      message: null,
      createdAt: 30,
      updatedAt: 30,
      cancellable: false,
    });

    snapshot.resolve([
      {
        id: "existing-task",
        kind: "repoStatus",
        priority: "normal",
        repoId: "Repo1",
        status: "running",
        message: "stale snapshot",
        updatedAt: 10,
        cancellable: false,
      },
      {
        id: "snapshot-task",
        kind: "languageStats",
        priority: "low",
        repoId: "Repo3",
        status: "success",
        message: null,
        updatedAt: 5,
        cancellable: false,
      },
    ]);
    await loading;

    expect(state.tasks.map((task) => [task.id, task.status, task.updatedAt])).toEqual([
      ["new-active-task", "running", 30],
      ["existing-task", "success", 20],
      ["snapshot-task", "success", 5],
    ]);
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
    await waitFor(() => expect(service.bulkSyncExecute).toHaveBeenCalledWith("push", [repo.id], "reject", "manual"));
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
    expect(service.bulkSyncExecute).toHaveBeenCalledWith("sync", [first.id, both.id], "reject", "syncAll");
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

  it("最近同步成功后不再回退到旧批量失败结果", () => {
    const repo = repoSummary("LiliaGithub", { ahead: 0 });
    state.bulkPreview = {
      operation: "sync",
      eligible: [{ repo, reason: "有本地提交待推送" }],
      blocked: [],
      warnings: [],
    };
    state.bulkResults = [{ repoId: repo.id, status: "error", message: "认证失败", summary: null }];
    state.recentSync = {
      preview: state.bulkPreview,
      results: [{ repoId: repo.id, status: "success", message: "完成", summary: repo }],
      retryingRepoIds: [],
      updatedAt: 2,
    };

    expect(repoSyncIssueForRepo(repo.id)).toBeNull();
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
      results: [{ repoId: failed.id, status: "error", message: "认证失败", summary: null, steps: [] }],
      retryingRepoIds: [],
      updatedAt: 1,
    };
    service.pushRepo.mockResolvedValue(repoSyncResult(updated));
    service.refreshRepoDetailPatch.mockResolvedValue(repoDetailPatch(updated, { commits: [] }));

    await push(failed.id);

    expect(state.recentSync?.results).toEqual([
      { repoId: failed.id, status: "success", message: "完成", summary: updated, steps: [] },
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
    service.pushRepo.mockResolvedValue(repoSyncResult(updated));

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
    service.commitRepo.mockResolvedValue(repoCommitResult(updated));
    service.pullRepo.mockResolvedValue(repoSyncResult(updated));
    service.pushRepo.mockResolvedValue(repoSyncResult(updated));
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
    const pending = deferred<ReturnType<typeof repoCommitResult>>();
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

    pending.resolve(repoCommitResult(refreshedSummary));
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
    const pending = deferred<ReturnType<typeof repoCommitResult>>();
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
    const pending = deferred<ReturnType<typeof repoCommitResult>>();
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

    pending.resolve(repoCommitResult(refreshedSummary));
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
    const pending = deferred<ReturnType<typeof repoCommitResult>>();
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
    service.commitRepo.mockResolvedValue(repoCommitResult(updated));
    service.pullRepo.mockResolvedValue(repoSyncResult(updated));
    service.pushRepo.mockResolvedValue(repoSyncResult(updated));
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
      steps: [],
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FOCUS_REFRESH_THRESHOLD_MS,
  createWorkspace,
  initialize,
  installWorkspaceFocusRefresh,
} from "../src/composables/workspace/lifecycle";
import {
  addLocalRepo,
  refreshRepoSummaries,
  resetRepositoryRuntimeForTests,
} from "../src/composables/workspace/repositories";
import {
  applyWorkspaceRepoRefreshed,
  applyWorkspaceTaskChanged,
  resetRepoRefreshRuntimeForTests,
} from "../src/composables/workspace/repoRefreshEvents";
import { recentSyncErrorForRepo, resetWorkspaceStateForTests, state } from "../src/composables/workspace/state";
import { resetLowPrioritySchedulerForTests } from "../src/utils/lowPriorityScheduler";
import type { WorkspaceService } from "../src/composables/workspace/serviceLoader";
import { repoDetailPatch, repoSummary, workspaceBootstrap, workspaceSettings } from "./fixtures/workspace";

const service = vi.hoisted(() => ({
  listManagedRepos: vi.fn(),
  getWorkspaceBootstrap: vi.fn(),
  getWorkspaceSettings: vi.fn(),
  readStartupCache: vi.fn(),
  clearStartupCache: vi.fn(),
  writeStartupContributions: vi.fn(),
  getGitHubBindingStatus: vi.fn(),
  pickWorkspaceRoot: vi.fn(),
  createWorkspace: vi.fn(),
  pickRepo: vi.fn(),
  addRepo: vi.fn(),
  refreshRepoSummary: vi.fn(),
  refreshRepoDetailPatch: vi.fn(),
  discoverRepos: vi.fn(),
  listRepoContribution: vi.fn(),
  listWorkspaceTasks: vi.fn(),
  refreshRepoLanguageStats: vi.fn(),
  bulkSyncExecute: vi.fn(),
  setActiveWorkspaceRepo: vi.fn(),
  enqueueRepoRefresh: vi.fn(),
}));

vi.mock("../src/composables/workspace/serviceLoader", () => ({
  loadWorkspaceService: vi.fn(async () => service as unknown as WorkspaceService),
}));

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function currentWorkspaceContext() {
  return { workspaceId: state.settings?.activeWorkspaceId ?? null, contextRevision: state.contextRevision };
}

function blurWindow() {
  window.dispatchEvent(new Event("blur"));
}

function focusWindow() {
  window.dispatchEvent(new Event("focus"));
}

describe("workspace focus refresh", () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T00:00:00Z"));
    resetWorkspaceStateForTests();
    resetRepositoryRuntimeForTests();
    resetRepoRefreshRuntimeForTests();
    resetLowPrioritySchedulerForTests();
    vi.clearAllMocks();
    const settings = workspaceSettings();
    state.settings = settings;
    service.getWorkspaceBootstrap.mockResolvedValue(workspaceBootstrap(settings));
    service.getWorkspaceSettings.mockResolvedValue(settings);
    service.readStartupCache.mockResolvedValue(null);
    service.clearStartupCache.mockResolvedValue(undefined);
    service.writeStartupContributions.mockResolvedValue({
      workspaceId: settings.activeWorkspaceId,
      rootsFingerprint: "root-default:C:\\Files\\workspace",
      workspaceRoot: settings.workspaceRoot,
      bindingLogin: settings.githubBinding?.login ?? null,
      reposById: {},
      contributions: null,
    });
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
    service.pickWorkspaceRoot.mockResolvedValue("D:\\NewWorkspace");
    service.createWorkspace.mockImplementation(async (name: string, rootPath: string) => {
      const created = workspaceSettings();
      const root = { id: "root-new", path: rootPath, available: true, unavailableReason: null };
      const activeWorkspace = { ...created.activeWorkspace!, id: "workspace-new", name, roots: [root], primaryRootId: root.id };
      return workspaceBootstrap({
        ...created,
        workspaceRoot: rootPath,
        workspaceCatalog: [{ id: activeWorkspace.id, name, roots: [root], primaryRootId: root.id }],
        activeWorkspaceId: activeWorkspace.id,
        activeWorkspace,
      }, null, 2);
    });
    service.pickRepo.mockResolvedValue(null);
    service.addRepo.mockResolvedValue(repoSummary("LocalRepo"));
    service.listManagedRepos.mockResolvedValue([repoSummary("LiliaGithub")]);
    service.refreshRepoSummary.mockImplementation(async (repoId: string) => repoSummary(repoId));
    service.refreshRepoDetailPatch.mockImplementation(async (repoId: string) =>
      repoDetailPatch(repoSummary(repoId))
    );
    service.listRepoContribution.mockResolvedValue({
      days: [],
      meta: {
        repoCount: 1,
        requestedRepoCount: 1,
        repoLimit: 30,
        truncated: false,
        skippedRepoCount: 0,
        refreshedAt: Date.now(),
      },
    });
    service.listWorkspaceTasks.mockResolvedValue([]);
    service.bulkSyncExecute.mockResolvedValue([]);
    service.refreshRepoLanguageStats.mockResolvedValue(repoSummary("LiliaGithub", {
      languageStats: [{ language: "TypeScript", bytes: 1, lines: 1 }],
      languageStatsUpdatedAt: Date.now(),
    }));
    let taskIndex = 0;
    service.setActiveWorkspaceRepo.mockResolvedValue(undefined);
    service.enqueueRepoRefresh.mockImplementation(async (request) => {
      const taskId = `focus-refresh-${++taskIndex}`;
      const kind = request.mode === "remote" ? "repoRemote" : "repoStatus";
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
        ...currentWorkspaceContext(),
        taskId,
        repoId: request.repoId,
        mode: request.mode,
        summary,
        detailPatch,
        remoteCheckedAt: request.mode === "remote" ? Date.now() : null,
        trigger: request.trigger,
      });
      applyWorkspaceTaskChanged({
        ...currentWorkspaceContext(),
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
      return taskId;
    });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    window.history.pushState({}, "", "/");
    vi.useRealTimers();
  });

  it("失焦超过 5 分钟后回焦点只入队本地校准，不获取远端", async () => {
    const initial = repoSummary("LiliaGithub", {
      ahead: 1,
      languageStats: [{ language: "Vue", bytes: 10, lines: 10 }],
      languageStatsUpdatedAt: 1,
    });
    const refreshed = repoSummary("LiliaGithub", { ahead: 2 });
    state.repos = [initial];
    service.listManagedRepos.mockResolvedValue([initial]);
    service.refreshRepoSummary.mockResolvedValue(refreshed);
    cleanup = await installWorkspaceFocusRefresh();

    blurWindow();
    vi.advanceTimersByTime(FOCUS_REFRESH_THRESHOLD_MS);
    focusWindow();
    await flushPromises();
    await flushPromises();
    await flushPromises();
    vi.advanceTimersByTime(16);
    await flushPromises();

    expect(service.refreshRepoSummary).toHaveBeenCalledWith("LiliaGithub", { fetchRemote: false });
    expect(service.refreshRepoSummary.mock.calls.every(([, options]) => options.fetchRemote === false)).toBe(true);
    expect(service.listManagedRepos).not.toHaveBeenCalled();
    expect(service.discoverRepos).not.toHaveBeenCalled();
    expect(service.listRepoContribution).not.toHaveBeenCalled();
    expect(service.refreshRepoLanguageStats).not.toHaveBeenCalled();
    expect(service.listWorkspaceTasks).not.toHaveBeenCalled();
    expect(state.repos[0].ahead).toBe(2);
    expect(state.repos[0].languageStats).toEqual(initial.languageStats);
    expect(state.repos[0].languageStatsUpdatedAt).toBe(1);
  });

  it("仓库状态刚刷新过时回焦点仍只执行本地补偿", async () => {
    const initial = repoSummary("LiliaGithub");
    state.repos = [initial];
    service.listManagedRepos.mockResolvedValue([initial]);
    service.refreshRepoSummary.mockResolvedValue(repoSummary("LiliaGithub", { behind: 1 }));
    await refreshRepoSummaries();
    vi.clearAllMocks();
    window.history.pushState({}, "", "/repos/LiliaGithub");
    cleanup = await installWorkspaceFocusRefresh();

    blurWindow();
    vi.advanceTimersByTime(FOCUS_REFRESH_THRESHOLD_MS);
    focusWindow();
    await flushPromises();

    expect(service.listManagedRepos).not.toHaveBeenCalled();
    expect(service.refreshRepoSummary.mock.calls.every(([, options]) => options.fetchRemote === false)).toBe(true);
    expect(service.refreshRepoDetailPatch).toHaveBeenCalledWith("LiliaGithub", {
      includeCommits: false,
      includeBranches: false,
    });
  });

  it("近期有输入时回焦点会跳过自动刷新", async () => {
    cleanup = await installWorkspaceFocusRefresh();

    blurWindow();
    vi.advanceTimersByTime(FOCUS_REFRESH_THRESHOLD_MS - 1);
    window.dispatchEvent(new WheelEvent("wheel"));
    vi.advanceTimersByTime(1);
    focusWindow();
    await flushPromises();

    expect(service.listManagedRepos).not.toHaveBeenCalled();
    expect(service.refreshRepoSummary).not.toHaveBeenCalled();
  });

  it("回焦点本地校准不会在未检查远端前启动自动同步", async () => {
    const initial = repoSummary("LiliaGithub", { ahead: 1 });
    const refreshed = repoSummary("LiliaGithub", { ahead: 2 });
    state.settings = {
      ...workspaceSettings(),
      repoSyncPreferences: { LiliaGithub: { autoSync: true } },
    };
    state.repos = [initial];
    service.listManagedRepos.mockResolvedValue([initial]);
    service.refreshRepoSummary.mockResolvedValue(refreshed);
    service.bulkSyncExecute.mockResolvedValue([
      { repoId: "LiliaGithub", status: "error", message: "认证失败", summary: null },
    ]);
    cleanup = await installWorkspaceFocusRefresh();

    blurWindow();
    vi.advanceTimersByTime(FOCUS_REFRESH_THRESHOLD_MS);
    focusWindow();
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(service.bulkSyncExecute).not.toHaveBeenCalled();
    expect(recentSyncErrorForRepo("LiliaGithub")).toBeNull();
  });

  it("创建工作区会阻止旧初始化结果覆盖当前设置", async () => {
    const initialBootstrap = deferred<ReturnType<typeof workspaceBootstrap>>();
    service.getWorkspaceBootstrap.mockReturnValueOnce(initialBootstrap.promise);
    service.listManagedRepos.mockResolvedValue([]);

    const initializing = initialize();
    await flushPromises();
    expect(state.loading).toBe(true);

    await createWorkspace("NewWorkspace", "D:\\NewWorkspace");
    expect(state.settings?.workspaceRoot).toBe("D:\\NewWorkspace");
    expect(state.loading).toBe(false);

    initialBootstrap.resolve(workspaceBootstrap({
      ...workspaceSettings(),
      workspaceRoot: "C:\\OldWorkspace",
    }));
    await initializing;

    expect(state.settings?.workspaceRoot).toBe("D:\\NewWorkspace");
    expect(state.loading).toBe(false);
  });

  it("添加本地仓库对选择、添加和刷新整段操作 single-flight", async () => {
    const picker = deferred<string | null>();
    const summary = repoSummary("LocalRepo");
    service.pickRepo.mockReturnValue(picker.promise);
    service.addRepo.mockResolvedValue(summary);
    service.listManagedRepos.mockResolvedValue([summary]);

    const first = addLocalRepo();
    const second = addLocalRepo();

    await flushPromises();
    expect(service.pickRepo).toHaveBeenCalledTimes(1);

    picker.resolve("D:\\Workspace\\LocalRepo");
    await expect(Promise.all([first, second])).resolves.toEqual([summary, summary]);

    expect(service.addRepo).toHaveBeenCalledTimes(1);
    expect(service.listManagedRepos).toHaveBeenCalledTimes(1);
    expect(state.repos).toEqual([summary]);
  });

  it("取消添加本地仓库不添加也不刷新", async () => {
    service.pickRepo.mockResolvedValue(null);

    await expect(addLocalRepo()).resolves.toBeNull();

    expect(service.addRepo).not.toHaveBeenCalled();
    expect(service.listManagedRepos).not.toHaveBeenCalled();
  });

  it("失焦不足 5 分钟后回焦点不会刷新", async () => {
    cleanup = await installWorkspaceFocusRefresh();

    blurWindow();
    vi.advanceTimersByTime(FOCUS_REFRESH_THRESHOLD_MS - 1);
    focusWindow();
    await flushPromises();

    expect(service.listManagedRepos).not.toHaveBeenCalled();
  });

  it("没有工作区时不会自动刷新", async () => {
    state.settings = {
      ...workspaceSettings(),
      workspaceRoot: null,
    };
    cleanup = await installWorkspaceFocusRefresh();

    blurWindow();
    vi.advanceTimersByTime(FOCUS_REFRESH_THRESHOLD_MS);
    focusWindow();
    await flushPromises();

    expect(service.listManagedRepos).not.toHaveBeenCalled();
  });

  it("初始化、扫描或批量同步进行中时不会自动刷新", async () => {
    for (const key of ["loading", "scanning", "bulkRunning"] as const) {
      cleanup = await installWorkspaceFocusRefresh();
      state[key] = true;

      blurWindow();
      vi.advanceTimersByTime(FOCUS_REFRESH_THRESHOLD_MS);
      focusWindow();
      await flushPromises();

      expect(service.listManagedRepos).not.toHaveBeenCalled();

      state[key] = false;
      cleanup();
      cleanup = null;
      vi.clearAllMocks();
    }
  });

  it("cleanup 后不会继续响应焦点事件", async () => {
    cleanup = await installWorkspaceFocusRefresh();
    cleanup();
    cleanup = null;

    blurWindow();
    vi.advanceTimersByTime(FOCUS_REFRESH_THRESHOLD_MS);
    focusWindow();
    await flushPromises();

    expect(service.listManagedRepos).not.toHaveBeenCalled();
  });
});

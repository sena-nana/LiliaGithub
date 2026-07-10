import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceService } from "../src/composables/workspace/serviceLoader";
import {
  applyWorkspaceRepoRefreshed,
  applyWorkspaceTaskChanged,
  ensureRepoRefreshEventsReady,
  hydrateRepoRemoteCheckedAt,
  markActiveRepoLocalReady,
  REMOTE_REPO_REFRESH_TTL_MS,
  requestManualRepoRemoteRefresh,
  resetRepoRefreshRuntimeForTests,
  scheduleAutoSyncRepoRefreshes,
  setActiveRepoForRefresh,
  setRepoRefreshLifecycleFocused,
  waitForWorkspaceTask,
} from "../src/composables/workspace/repoRefreshEvents";
import { resetWorkspaceStateForTests, state } from "../src/composables/workspace/state";
import { repoDetailPatch, repoSummary, workspaceSettings } from "./fixtures/workspace";

const service = vi.hoisted(() => ({
  setActiveWorkspaceRepo: vi.fn(),
  enqueueRepoRefresh: vi.fn(),
  listWorkspaceTasks: vi.fn(),
  setWorkspaceRefreshPaused: vi.fn(),
}));

vi.mock("../src/composables/workspace/serviceLoader", () => ({
  loadWorkspaceService: vi.fn(async () => service as unknown as WorkspaceService),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-10T00:00:00Z"));
  resetRepoRefreshRuntimeForTests();
  resetWorkspaceStateForTests();
  vi.clearAllMocks();
  state.settings = workspaceSettings();
  state.repos = [repoSummary("A"), repoSummary("B")];
  service.setActiveWorkspaceRepo.mockResolvedValue(undefined);
  service.listWorkspaceTasks.mockResolvedValue([]);
  service.setWorkspaceRefreshPaused.mockResolvedValue(undefined);
  let taskIndex = 0;
  service.enqueueRepoRefresh.mockImplementation(async () => `remote-${++taskIndex}`);
});

describe("workspace repo refresh events", () => {
  it("本地详情就绪后才为当前仓库入队远端检查", async () => {
    await setActiveRepoForRefresh("A");
    expect(service.enqueueRepoRefresh).not.toHaveBeenCalled();

    markActiveRepoLocalReady("A");
    await vi.advanceTimersByTimeAsync(0);

    expect(service.enqueueRepoRefresh).toHaveBeenCalledWith({
      repoId: "A",
      mode: "remote",
      priority: "normal",
      force: false,
      detailScope: "detail",
      trigger: "activeRepo",
    });
  });

  it("持久化远端时间命中十分钟 TTL 时只设置一次到期唤醒", async () => {
    hydrateRepoRemoteCheckedAt({ A: { remoteCheckedAt: Date.now() } });
    await setActiveRepoForRefresh("A");
    markActiveRepoLocalReady("A");

    await vi.advanceTimersByTimeAsync(REMOTE_REPO_REFRESH_TTL_MS - 1);
    expect(service.enqueueRepoRefresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(service.enqueueRepoRefresh).toHaveBeenCalledTimes(1);
  });

  it("失焦暂停到期检查，恢复后再检查当前仓库", async () => {
    hydrateRepoRemoteCheckedAt({ A: { remoteCheckedAt: Date.now() } });
    await setActiveRepoForRefresh("A");
    markActiveRepoLocalReady("A");
    setRepoRefreshLifecycleFocused(false);

    await vi.advanceTimersByTimeAsync(REMOTE_REPO_REFRESH_TTL_MS);
    expect(service.enqueueRepoRefresh).not.toHaveBeenCalled();

    setRepoRefreshLifecycleFocused(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(service.enqueueRepoRefresh).toHaveBeenCalledTimes(1);
  });

  it("快速切换仓库会同步更新后台活动仓库且旧仓库不再触发 timer", async () => {
    await setActiveRepoForRefresh("A");
    markActiveRepoLocalReady("A");
    await setActiveRepoForRefresh("B");
    markActiveRepoLocalReady("B");
    await vi.advanceTimersByTimeAsync(0);

    expect(service.setActiveWorkspaceRepo.mock.calls).toEqual([["A"], ["B"]]);
    expect(service.enqueueRepoRefresh).toHaveBeenCalledTimes(1);
    expect(service.enqueueRepoRefresh.mock.calls[0][0].repoId).toBe("B");
  });

  it("远端失败后按一分钟首次退避，不立即重试", async () => {
    await setActiveRepoForRefresh("A");
    markActiveRepoLocalReady("A");
    await vi.advanceTimersByTimeAsync(0);
    const firstTaskId = await service.enqueueRepoRefresh.mock.results[0].value;

    applyWorkspaceTaskChanged({
      id: firstTaskId,
      kind: "repoRemote",
      priority: "normal",
      repoId: "A",
      status: "error",
      message: "offline",
      updatedAt: Date.now(),
      cancellable: false,
    });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(service.enqueueRepoRefresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(service.enqueueRepoRefresh).toHaveBeenCalledTimes(2);
  });

  it("手动刷新等待后台任务真实完成并应用对应详情 patch", async () => {
    const pending = requestManualRepoRemoteRefresh("A", { includeCommits: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.enqueueRepoRefresh).toHaveBeenCalledWith(expect.objectContaining({
      repoId: "A",
      mode: "remote",
      priority: "high",
      force: true,
      trigger: "manual",
    }));
    let completed = false;
    void pending.then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);

    const summary = repoSummary("A", { behind: 2 });
    applyWorkspaceRepoRefreshed({
      taskId: "remote-1",
      repoId: "A",
      mode: "remote",
      summary,
      detailPatch: repoDetailPatch(summary),
      remoteCheckedAt: Date.now(),
      trigger: "manual",
    });
    applyWorkspaceTaskChanged({
      id: "remote-1",
      kind: "repoRemote",
      priority: "high",
      repoId: "A",
      status: "success",
      message: null,
      updatedAt: Date.now(),
      cancellable: false,
    });

    await expect(pending).resolves.toBe("remote-1");
    expect(state.repoDetails.A?.summary.behind).toBe(2);
  });

  it("foreground 本地任务也会等待对应终态", async () => {
    const pending = waitForWorkspaceTask("local-1");
    applyWorkspaceTaskChanged({
      id: "local-1",
      kind: "repoStatus",
      priority: "high",
      repoId: "A",
      status: "success",
      message: null,
      updatedAt: Date.now(),
      cancellable: false,
    });
    await expect(pending).resolves.toBeUndefined();
  });

  it("未选中的 autoSync 仓库按十分钟 TTL 低优先级检查", async () => {
    state.settings = {
      ...workspaceSettings(),
      repoSyncPreferences: { A: { autoSync: true } },
    };
    hydrateRepoRemoteCheckedAt({ A: { remoteCheckedAt: Date.now() } });
    scheduleAutoSyncRepoRefreshes();

    await vi.advanceTimersByTimeAsync(REMOTE_REPO_REFRESH_TTL_MS - 1);
    expect(service.enqueueRepoRefresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(service.enqueueRepoRefresh).toHaveBeenCalledWith({
      repoId: "A",
      mode: "remote",
      priority: "low",
      force: false,
      detailScope: "summary",
      trigger: "autoSync",
    });
  });

  it("autoSync 仓库的本地 watch 事件不会绕过远端 TTL", async () => {
    state.settings = {
      ...workspaceSettings(),
      repoSyncPreferences: { A: { autoSync: true } },
    };
    hydrateRepoRemoteCheckedAt({ A: { remoteCheckedAt: Date.now() } });

    applyWorkspaceRepoRefreshed({
      taskId: "local-1",
      repoId: "A",
      mode: "local",
      summary: repoSummary("A", { ahead: 1 }),
      detailPatch: null,
      remoteCheckedAt: null,
      trigger: "watch",
    });
    await vi.advanceTimersByTimeAsync(REMOTE_REPO_REFRESH_TTL_MS - 1);
    expect(service.enqueueRepoRefresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(service.enqueueRepoRefresh).toHaveBeenCalledTimes(1);
    expect(service.enqueueRepoRefresh).toHaveBeenCalledWith(expect.objectContaining({
      repoId: "A",
      mode: "remote",
      priority: "low",
      trigger: "autoSync",
    }));
  });

  it("loading 或 bulk 期间暂停本地通道并在空闲后恢复", async () => {
    await ensureRepoRefreshEventsReady();
    await Promise.resolve();
    expect(service.setWorkspaceRefreshPaused).toHaveBeenLastCalledWith(false);

    state.loading = true;
    await Promise.resolve();
    await Promise.resolve();
    expect(service.setWorkspaceRefreshPaused).toHaveBeenLastCalledWith(true);

    state.loading = false;
    await Promise.resolve();
    await Promise.resolve();
    expect(service.setWorkspaceRefreshPaused).toHaveBeenLastCalledWith(false);

    state.bulkRunning = true;
    await Promise.resolve();
    await Promise.resolve();
    expect(service.setWorkspaceRefreshPaused).toHaveBeenLastCalledWith(true);

    state.bulkRunning = false;
    await Promise.resolve();
    await Promise.resolve();
    expect(service.setWorkspaceRefreshPaused).toHaveBeenLastCalledWith(false);
  });
});

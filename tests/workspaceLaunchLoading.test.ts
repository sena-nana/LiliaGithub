import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/vue";
import { loadLaunch, refreshLaunchLogs, startLaunch } from "../src/composables/workspace/launch";
import { resetWorkspaceStateForTests, state } from "../src/composables/workspace/state";
import type { WorkspaceService } from "../src/composables/workspace/serviceLoader";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const service = {
  getRepoLaunchConfig: vi.fn(),
  listRepoLaunchCandidates: vi.fn(),
  getRepoLaunchStatus: vi.fn(),
  getRepoLaunchLogs: vi.fn(),
  startRepoLaunch: vi.fn(),
};

vi.mock("../src/composables/workspace/serviceLoader", () => ({
  loadWorkspaceService: vi.fn(async () => service as unknown as WorkspaceService),
}));

beforeEach(() => {
  resetWorkspaceStateForTests();
  vi.clearAllMocks();
  service.listRepoLaunchCandidates.mockResolvedValue([]);
  service.getRepoLaunchStatus.mockImplementation(async (repoId: string) => ({
    repoId,
    state: "idle",
    pid: null,
    command: null,
    startedAt: null,
    exitCode: null,
    error: null,
  }));
  service.getRepoLaunchLogs.mockResolvedValue([]);
  service.startRepoLaunch.mockImplementation(async (repoId: string) => ({
    repoId,
    state: "running",
    pid: 1,
    command: "yarn dev",
    startedAt: 1,
    exitCode: null,
    error: null,
  }));
});

describe("workspace launch loading", () => {
  it("并发加载多个仓库启动信息时保持 loading 到最后一个完成", async () => {
    const first = deferred();
    const second = deferred();
    service.getRepoLaunchConfig.mockImplementation(async (repoId: string) => {
      if (repoId === "repo-a") await first.promise;
      if (repoId === "repo-b") await second.promise;
      return null;
    });

    const firstLoad = loadLaunch("repo-a");
    const secondLoad = loadLaunch("repo-b");
    expect(state.launchLoading).toBe(true);

    second.resolve();
    await secondLoad;
    expect(state.launchLoading).toBe(true);

    first.resolve();
    await firstLoad;
    expect(state.launchLoading).toBe(false);
  });

  it("启动新进程时忽略旧日志刷新返回", async () => {
    const oldLogs = deferred<NonNullable<(typeof state.launchLogs)[string]>>();
    state.launchLogs["repo-a"] = [
      { index: 1, repoId: "repo-a", stream: "system", line: "旧输出", timestamp: 1 },
    ];
    service.getRepoLaunchLogs
      .mockReturnValueOnce(oldLogs.promise)
      .mockResolvedValueOnce([
        { index: 1, repoId: "repo-a", stream: "system", line: "启动命令：yarn dev", timestamp: 2 },
      ]);

    const staleRefresh = refreshLaunchLogs("repo-a");
    await waitFor(() => expect(service.getRepoLaunchLogs).toHaveBeenCalledTimes(1));

    await startLaunch("repo-a");
    expect(state.launchLogs["repo-a"]?.map((log) => log.line)).toEqual(["启动命令：yarn dev"]);

    oldLogs.resolve([
      { index: 2, repoId: "repo-a", stream: "stdout", line: "旧进程迟到输出", timestamp: 3 },
    ]);
    await staleRefresh;

    expect(state.launchLogs["repo-a"]?.map((log) => log.line)).toEqual(["启动命令：yarn dev"]);
  });

  it("并发日志刷新按 index 去重合并", async () => {
    const firstLogs = deferred<NonNullable<(typeof state.launchLogs)[string]>>();
    const secondLogs = deferred<NonNullable<(typeof state.launchLogs)[string]>>();
    state.launchLogs["repo-a"] = [
      { index: 1, repoId: "repo-a", stream: "system", line: "启动命令：yarn dev", timestamp: 1 },
    ];
    service.getRepoLaunchLogs
      .mockReturnValueOnce(firstLogs.promise)
      .mockReturnValueOnce(secondLogs.promise);

    const firstRefresh = refreshLaunchLogs("repo-a");
    const secondRefresh = refreshLaunchLogs("repo-a");
    await waitFor(() => expect(service.getRepoLaunchLogs).toHaveBeenCalledTimes(2));

    firstLogs.resolve([
      { index: 2, repoId: "repo-a", stream: "stdout", line: "ready", timestamp: 2 },
      { index: 3, repoId: "repo-a", stream: "stdout", line: "listening", timestamp: 3 },
    ]);
    await firstRefresh;

    secondLogs.resolve([
      { index: 2, repoId: "repo-a", stream: "stdout", line: "ready", timestamp: 2 },
      { index: 4, repoId: "repo-a", stream: "stderr", line: "warn", timestamp: 4 },
    ]);
    await secondRefresh;

    expect(state.launchLogs["repo-a"]?.map((log) => log.index)).toEqual([1, 2, 3, 4]);
  });
});

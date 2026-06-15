import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FOCUS_REFRESH_THRESHOLD_MS,
  installWorkspaceFocusRefresh,
} from "../src/composables/workspace/lifecycle";
import { resetWorkspaceStateForTests, state } from "../src/composables/workspace/state";
import type { WorkspaceService } from "../src/composables/workspace/serviceLoader";
import { repoSummary, workspaceSettings } from "./fixtures/workspace";

const service = vi.hoisted(() => ({
  listManagedRepos: vi.fn(),
  refreshRepoSummary: vi.fn(),
  discoverRepos: vi.fn(),
  listRepoContribution: vi.fn(),
  listWorkspaceTasks: vi.fn(),
  refreshRepoLanguageStats: vi.fn(),
}));

vi.mock("../src/composables/workspace/serviceLoader", () => ({
  loadWorkspaceService: vi.fn(async () => service as unknown as WorkspaceService),
}));

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
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
    vi.clearAllMocks();
    state.settings = workspaceSettings();
    service.listManagedRepos.mockResolvedValue([repoSummary("LiliaGithub")]);
    service.refreshRepoSummary.mockImplementation(async (repoId: string) => repoSummary(repoId));
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
    service.refreshRepoLanguageStats.mockResolvedValue(repoSummary("LiliaGithub", {
      languageStats: [{ language: "TypeScript", bytes: 1 }],
      workingTreeLanguageStats: [{ language: "TypeScript", bytes: 1 }],
      languageStatsUpdatedAt: Date.now(),
    }));
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.useRealTimers();
  });

  it("失焦超过 5 分钟后回焦点只同步仓库摘要和远端状态", async () => {
    const initial = repoSummary("LiliaGithub", {
      behind: 0,
      languageStats: [{ language: "Vue", bytes: 10 }],
      workingTreeLanguageStats: [{ language: "Vue", bytes: 10 }],
      languageStatsUpdatedAt: 1,
    });
    const refreshed = repoSummary("LiliaGithub", { behind: 2 });
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

    expect(service.refreshRepoSummary).toHaveBeenCalledWith("LiliaGithub", { fetchRemote: true });
    expect(service.listManagedRepos).toHaveBeenCalledTimes(1);
    expect(service.discoverRepos).not.toHaveBeenCalled();
    expect(service.listRepoContribution).not.toHaveBeenCalled();
    expect(service.refreshRepoLanguageStats).not.toHaveBeenCalled();
    expect(service.listWorkspaceTasks).toHaveBeenCalledTimes(1);
    expect(state.repos[0].behind).toBe(2);
    expect(state.repos[0].languageStats).toEqual(initial.languageStats);
    expect(state.repos[0].workingTreeLanguageStats).toEqual(initial.workingTreeLanguageStats);
    expect(state.repos[0].languageStatsUpdatedAt).toBe(1);
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

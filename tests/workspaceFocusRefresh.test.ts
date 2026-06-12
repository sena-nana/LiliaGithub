import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FOCUS_REFRESH_THRESHOLD_MS,
  installWorkspaceFocusRefresh,
} from "../src/composables/workspace/lifecycle";
import { resetWorkspaceStateForTests, state } from "../src/composables/workspace/state";
import type { WorkspaceService } from "../src/composables/workspace/serviceLoader";
import { repoSummary, workspaceSettings } from "./fixtures/workspace";

const service = vi.hoisted(() => ({
  refreshRepos: vi.fn(),
  discoverRepos: vi.fn(),
  listRepoContributions: vi.fn(),
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
    service.refreshRepos.mockResolvedValue([repoSummary("LiliaGithub")]);
    service.listRepoContributions.mockResolvedValue({
      days: [],
      meta: {
        repoCount: 1,
        requestedRepoCount: 1,
        repoLimit: 30,
        truncated: false,
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

  it("失焦超过 5 分钟后回焦点会刷新已管理仓库", async () => {
    cleanup = await installWorkspaceFocusRefresh();

    blurWindow();
    vi.advanceTimersByTime(FOCUS_REFRESH_THRESHOLD_MS);
    focusWindow();
    await flushPromises();

    expect(service.refreshRepos).toHaveBeenCalledTimes(1);
    expect(service.discoverRepos).not.toHaveBeenCalled();
  });

  it("失焦不足 5 分钟后回焦点不会刷新", async () => {
    cleanup = await installWorkspaceFocusRefresh();

    blurWindow();
    vi.advanceTimersByTime(FOCUS_REFRESH_THRESHOLD_MS - 1);
    focusWindow();
    await flushPromises();

    expect(service.refreshRepos).not.toHaveBeenCalled();
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

    expect(service.refreshRepos).not.toHaveBeenCalled();
  });

  it("初始化、扫描或批量同步进行中时不会自动刷新", async () => {
    for (const key of ["loading", "scanning", "bulkRunning"] as const) {
      cleanup = await installWorkspaceFocusRefresh();
      state[key] = true;

      blurWindow();
      vi.advanceTimersByTime(FOCUS_REFRESH_THRESHOLD_MS);
      focusWindow();
      await flushPromises();

      expect(service.refreshRepos).not.toHaveBeenCalled();

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

    expect(service.refreshRepos).not.toHaveBeenCalled();
  });
});

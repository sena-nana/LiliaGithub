import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyRepoChangedEvent,
  installRepoChangedEvents,
  REPO_CHANGED_EVENT,
} from "../src/composables/workspace/repoChangedEvents";
import {
  REPO_STATUS_REFRESH_DEBOUNCE_MS,
  resetRepositoryRuntimeForTests,
} from "../src/composables/workspace/repositories";
import { resetWorkspaceStateForTests, state } from "../src/composables/workspace/state";
import type { WorkspaceService } from "../src/composables/workspace/serviceLoader";
import { repoDetailPatch, repoSummary, workspaceSettings } from "./fixtures/workspace";

const service = vi.hoisted(() => ({
  refreshRepoSummary: vi.fn(),
  refreshRepoDetailPatch: vi.fn(),
  listWorkspaceTasks: vi.fn(),
  bulkSyncExecute: vi.fn(),
}));

vi.mock("../src/composables/workspace/serviceLoader", () => ({
  loadWorkspaceService: vi.fn(async () => service as unknown as WorkspaceService),
}));

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("workspace repo changed events", () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    resetWorkspaceStateForTests();
    resetRepositoryRuntimeForTests();
    vi.clearAllMocks();
    state.settings = workspaceSettings();
    state.repos = [
      repoSummary("alpha"),
      repoSummary("beta"),
      ...Array.from({ length: 18 }, (_, index) => repoSummary(`repo-${index}`)),
    ];
    service.refreshRepoSummary.mockImplementation(async (repoId: string) =>
      repoSummary(repoId, { stagedCount: 1, unstagedCount: 2, untrackedCount: 3 }),
    );
    service.refreshRepoDetailPatch.mockImplementation(async (repoId: string) =>
      repoDetailPatch(repoSummary(repoId, { stagedCount: 1, unstagedCount: 2, untrackedCount: 1 }), {
        changes: [
          {
            path: "src/a.ts",
            oldPath: null,
            indexStatus: "M",
            worktreeStatus: " ",
            staged: true,
            unstaged: false,
            untracked: false,
            conflicted: false,
            diff: "",
          },
        ],
      }),
    );
    service.listWorkspaceTasks.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.useRealTimers();
    window.history.replaceState({}, "", "/");
  });

  it("列表页只刷新变更仓库 summary，详情页走 debounce 合并刷新", async () => {
    window.history.replaceState({}, "", "/");
    applyRepoChangedEvent({ repoId: "alpha", kind: "worktree" });
    await flushPromises();
    expect(service.refreshRepoSummary).toHaveBeenCalledWith("alpha", { fetchRemote: false });
    expect(service.refreshRepoDetailPatch).not.toHaveBeenCalled();
    expect(state.repos.find((repo) => repo.id === "beta")?.stagedCount).toBe(0);

    window.history.replaceState({}, "", "/repos/alpha");
    applyRepoChangedEvent({ repoId: "alpha", kind: "worktree" });
    applyRepoChangedEvent({ repoId: "alpha", kind: "git-metadata" });
    await vi.advanceTimersByTimeAsync(REPO_STATUS_REFRESH_DEBOUNCE_MS);
    await flushPromises();
    expect(service.refreshRepoDetailPatch).toHaveBeenCalledTimes(1);
    expect(state.repoDetails.alpha?.changes).toHaveLength(1);
  });

  it("忽略未管理仓库与 scanning 状态", async () => {
    applyRepoChangedEvent({ repoId: "missing", kind: "worktree" });
    state.scanning = true;
    applyRepoChangedEvent({ repoId: "alpha", kind: "worktree" });
    await flushPromises();
    expect(service.refreshRepoSummary).not.toHaveBeenCalled();
  });

  it("多仓 workspace 下 watcher 不全量刷新", async () => {
    window.history.replaceState({}, "", "/");
    applyRepoChangedEvent({ repoId: "repo-7", kind: "worktree" });
    await flushPromises();
    expect(service.refreshRepoSummary).toHaveBeenCalledTimes(1);
    expect(service.refreshRepoSummary).toHaveBeenCalledWith("repo-7", { fetchRemote: false });
  });

  it("浏览器自定义事件入口可用", async () => {
    cleanup = await installRepoChangedEvents();
    window.dispatchEvent(
      new CustomEvent(REPO_CHANGED_EVENT, { detail: { repoId: "alpha", kind: "worktree" } }),
    );
    await flushPromises();
    expect(service.refreshRepoSummary).toHaveBeenCalledWith("alpha", { fetchRemote: false });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/vue";
import {
  abortConflictOperation,
  acceptConflictFile,
  checkout,
  commit,
  continueConflictOperation,
  hideRepo,
  markConflictFileResolved,
  mergePull,
  pull,
  push,
  resolveConflictFile,
  stage,
  unhideRepo,
  unstage,
} from "../src/composables/workspace/repositories";
import { closeBulkPreview, executeBulk, previewBulk, syncAll } from "../src/composables/workspace/bulk";
import {
  bulkSyncRepoIds,
  syncErrorByRepoId,
  recentSyncErrorForRepo,
  resetWorkspaceStateForTests,
  state,
} from "../src/composables/workspace/state";
import type { WorkspaceService } from "../src/composables/workspace/serviceLoader";
import type { BulkSyncPreview } from "../src/services/workspace";
import { conflictState, repoDetail, repoSummary, workspaceSettings } from "./fixtures/workspace";

const service = {
  refreshRepos: vi.fn(),
  discoverRepos: vi.fn(),
  pickRepo: vi.fn(),
  addRepo: vi.fn(),
  hideRepo: vi.fn(),
  unhideRepo: vi.fn(),
  getRepoSummary: vi.fn(),
  getRepoDetail: vi.fn(),
  listRepoContributions: vi.fn(),
  listWorkspaceTasks: vi.fn(),
  cancelWorkspaceTask: vi.fn(),
  refreshRepoLanguageStats: vi.fn(),
  stageFiles: vi.fn(),
  unstageFiles: vi.fn(),
  commitRepo: vi.fn(),
  pullRepo: vi.fn(),
  mergePullRepo: vi.fn(),
  pushRepo: vi.fn(),
  checkoutBranch: vi.fn(),
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
  vi.clearAllMocks();
  service.listRepoContributions.mockResolvedValue({
    days: [],
    meta: {
      repoCount: 0,
      requestedRepoCount: 0,
      repoLimit: 30,
      truncated: false,
      refreshedAt: 1_780_000_000_000,
    },
  });
  service.listWorkspaceTasks.mockResolvedValue([]);
  service.refreshRepoLanguageStats.mockImplementation(async (repoId: string) => repoSummary(repoId, {
    languageStats: [{ language: "TypeScript", bytes: 1 }],
    workingTreeLanguageStats: [{ language: "TypeScript", bytes: 1 }],
    languageStatsUpdatedAt: 1,
  }));
});

describe("workspace incremental refresh", () => {
  it("全量刷新成功后按 GitHub 仓库列表刷新贡献图", async () => {
    service.refreshRepos.mockResolvedValue([
      repoSummary("LiliaGithub", { githubFullName: "sena-nana/LiliaGithub" }),
      repoSummary("Lilia", { githubFullName: "sena-nana/Lilia" }),
      repoSummary("LocalOnly", { githubFullName: null }),
      repoSummary("LiliaDuplicate", { githubFullName: "sena-nana/Lilia" }),
    ]);
    service.listRepoContributions.mockResolvedValue({
      days: [{ date: "2026-06-11", count: 3 }],
      meta: {
        repoCount: 2,
        requestedRepoCount: 2,
        repoLimit: 30,
        truncated: false,
        refreshedAt: 1_780_000_000_000,
      },
    });

    const { refreshRepos } = await import("../src/composables/workspace/repositories");
    await refreshRepos();

    await waitFor(() => expect(service.listRepoContributions).toHaveBeenCalledWith(
      ["sena-nana/LiliaGithub", "sena-nana/Lilia"],
    ));
    expect(state.githubContributions.days).toEqual([{ date: "2026-06-11", count: 3 }]);
    expect(state.githubContributions.meta).toEqual({
      repoCount: 2,
      requestedRepoCount: 2,
      repoLimit: 30,
      truncated: false,
      refreshedAt: 1_780_000_000_000,
    });
    expect(state.githubContributions.error).toBeNull();
  });

  it("GitHub 贡献图失败不覆盖仓库扫描结果", async () => {
    const repo = repoSummary("LiliaGithub", { githubFullName: "sena-nana/LiliaGithub" });
    service.refreshRepos.mockResolvedValue([repo]);
    service.listRepoContributions.mockRejectedValue(new Error("rate limited"));

    const { refreshRepos } = await import("../src/composables/workspace/repositories");
    await refreshRepos();

    expect(state.repos).toEqual([repo]);
    expect(state.error).toBeNull();
    await waitFor(() => expect(state.githubContributions.error).toBe("Error: rate limited"));
    expect(state.githubContributions.meta).toBeNull();
  });

  it("没有 GitHub 仓库时写入空贡献图采样信息", async () => {
    service.refreshRepos.mockResolvedValue([repoSummary("LocalOnly", { githubFullName: null })]);

    const { refreshRepos } = await import("../src/composables/workspace/repositories");
    await refreshRepos();

    await waitFor(() => expect(state.githubContributions.days).toEqual([]));
    expect(service.listRepoContributions).not.toHaveBeenCalled();
    expect(state.githubContributions.meta).toMatchObject({
      repoCount: 0,
      requestedRepoCount: 0,
      repoLimit: 30,
      truncated: false,
    });
    expect(typeof state.githubContributions.meta?.refreshedAt).toBe("number");
  });

  it("隐藏仓库只移除目标仓库和缓存，不触发全量扫描", async () => {
    const target = repoSummary("LiliaGithub");
    state.repos = [target, repoSummary("Lilia")];
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

    expect(service.bulkSyncPreview).toHaveBeenCalledWith("sync", expect.any(Array));
    expect(service.bulkSyncExecute).toHaveBeenCalledWith("sync", [first.id, both.id]);
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
    service.getRepoDetail.mockResolvedValue(repoDetail(updated));

    await push(failed.id);

    expect(state.recentSync?.results).toEqual([
      { repoId: failed.id, status: "success", message: "完成", summary: updated },
    ]);
    expect(state.recentSync?.retryingRepoIds).toEqual([]);
    expect(state.repos[0].ahead).toBe(0);
  });

  it("单仓库提交、拉取、推送和切换分支后刷新当前仓库语言统计", async () => {
    const initial = repoSummary("LiliaGithub", { ahead: 1, stagedCount: 1 });
    const updated = repoSummary("LiliaGithub", { ahead: 0, stagedCount: 0 });
    state.repos = [initial];
    service.getRepoDetail.mockResolvedValue(repoDetail(updated));
    service.commitRepo.mockResolvedValue(updated);
    service.pullRepo.mockResolvedValue(updated);
    service.pushRepo.mockResolvedValue(updated);
    service.checkoutBranch.mockResolvedValue(updated);

    await commit(initial.id, ["src/main.ts"], "提交说明", false);
    await pull(initial.id);
    await push(initial.id);
    await checkout(initial.id, "main");

    expect(service.refreshRepoLanguageStats).toHaveBeenCalledTimes(4);
    expect(service.refreshRepoLanguageStats).toHaveBeenNthCalledWith(1, initial.id);
    expect(service.refreshRepoLanguageStats).toHaveBeenNthCalledWith(2, initial.id);
    expect(service.refreshRepoLanguageStats).toHaveBeenNthCalledWith(3, initial.id);
    expect(service.refreshRepoLanguageStats).toHaveBeenNthCalledWith(4, initial.id);
    expect(state.repos[0].languageStats).toEqual([{ language: "TypeScript", bytes: 1 }]);
    expect(state.repoDetails[initial.id]?.summary.languageStats).toEqual([{ language: "TypeScript", bytes: 1 }]);
  });

  it("单仓库操作继续只刷新当前仓库详情，不触发全量扫描", async () => {
    const initial = repoSummary("LiliaGithub", { ahead: 1, stagedCount: 1 });
    const updated = repoSummary("LiliaGithub", { ahead: 0, stagedCount: 0 });
    state.repos = [initial];
    service.getRepoDetail.mockResolvedValue(repoDetail(updated));
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
    expect(service.getRepoDetail).toHaveBeenCalledTimes(6);
    expect(service.refreshRepoLanguageStats).toHaveBeenCalledTimes(4);
    expect(state.repos[0]).toMatchObject({
      id: updated.id,
      ahead: 0,
      stagedCount: 0,
    });
    expect(state.repos[0].languageStats).toEqual([{ language: "TypeScript", bytes: 1 }]);
  });

  it("冲突处理操作只刷新当前仓库详情，不触发全量扫描", async () => {
    const initial = repoSummary("Lilia", { conflictCount: 1, behind: 1 });
    const updated = repoSummary("Lilia", { conflictCount: 0, stagedCount: 1, behind: 1 });
    state.repos = [initial];
    service.getRepoDetail.mockResolvedValue(repoDetail(updated));
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
    expect(service.getRepoDetail).toHaveBeenCalledTimes(6);
    expect(state.repos).toEqual([updated]);
  });
});

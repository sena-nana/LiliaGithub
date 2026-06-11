import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  abortConflictOperation,
  acceptConflictFile,
  checkout,
  commit,
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
import { closeBulkPreview, executeBulk, previewBulk, pushAll } from "../src/composables/workspace/bulk";
import { resetWorkspaceStateForTests, state } from "../src/composables/workspace/state";
import type { WorkspaceService } from "../src/composables/workspace/serviceLoader";
import type { BulkSyncPreview, RepoConflictState, RepoDetail, RepoSummary, WorkspaceSettings } from "../src/services/workspace";

const service = {
  scanRepos: vi.fn(),
  hideRepo: vi.fn(),
  unhideRepo: vi.fn(),
  getRepoSummary: vi.fn(),
  getRepoDetail: vi.fn(),
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
  bulkSyncPreview: vi.fn(),
  bulkSyncExecute: vi.fn(),
};

vi.mock("../src/composables/workspace/serviceLoader", () => ({
  loadWorkspaceService: vi.fn(async () => service as unknown as WorkspaceService),
}));

function repoSummary(id: string, overrides: Partial<RepoSummary> = {}): RepoSummary {
  return {
    id,
    name: id,
    path: `C:\\Files\\workspace\\${id}`,
    relativePath: id,
    currentBranch: "main",
    remoteUrl: `https://github.com/sena-nana/${id}.git`,
    githubFullName: `sena-nana/${id}`,
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictCount: 0,
    lastCommitAt: null,
    lastCommitMessage: null,
    ...overrides,
  };
}

function conflictState(overrides: Partial<RepoConflictState> = {}): RepoConflictState {
  return {
    operation: "none",
    files: [],
    allResolved: true,
    ...overrides,
  };
}

function repoDetail(summary: RepoSummary): RepoDetail {
  return {
    summary,
    changes: [],
    commits: [],
    branches: [],
    conflicts: conflictState(),
  };
}

function settings(hiddenRepoIds: string[] = []): WorkspaceSettings {
  return {
    workspaceRoot: "C:\\Files\\workspace",
    githubBinding: null,
    projectLaunchConfigs: {},
    hiddenRepoIds,
  };
}

beforeEach(() => {
  resetWorkspaceStateForTests();
  vi.clearAllMocks();
});

describe("workspace incremental refresh", () => {
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
    service.hideRepo.mockResolvedValue(settings([target.id]));

    await hideRepo(target.id);

    expect(service.scanRepos).not.toHaveBeenCalled();
    expect(state.repos.map((repo) => repo.id)).toEqual(["Lilia"]);
    expect(state.repoDetails[target.id]).toBeUndefined();
    expect(state.launchConfigs[target.id]).toBeUndefined();
    expect(state.launchStatuses[target.id]).toBeUndefined();
    expect(state.launchLogs[target.id]).toBeUndefined();
  });

  it("恢复仓库只读取目标仓库 summary 并插回列表", async () => {
    const restored = repoSummary("LiliaGithub", { ahead: 2 });
    state.repos = [repoSummary("Lilia")];
    service.unhideRepo.mockResolvedValue(settings());
    service.getRepoSummary.mockResolvedValue(restored);

    await unhideRepo(restored.id);

    expect(service.scanRepos).not.toHaveBeenCalled();
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

    expect(service.scanRepos).not.toHaveBeenCalled();
    expect(state.repos.find((repo) => repo.id === before.id)?.ahead).toBe(0);
    expect(state.repoDetails[before.id]?.summary.ahead).toBe(0);
    expect(state.repos.find((repo) => repo.id === "Lilia")?.ahead).toBe(3);
  });

  it("一键推送直接预检并执行待推送仓库，不再调用单仓库 push", async () => {
    const first = repoSummary("LiliaGithub", { ahead: 1 });
    const blocked = repoSummary("Lilia", { ahead: 1, behind: 1 });
    const preview: BulkSyncPreview = {
      operation: "push",
      eligible: [{ repo: first, reason: "有本地提交待推送" }],
      blocked: [{ repo: blocked, reason: "当前分支落后于 upstream" }],
      warnings: [],
    };
    service.bulkSyncPreview.mockResolvedValue(preview);
    service.bulkSyncExecute.mockResolvedValue([
      { repoId: first.id, status: "success", message: "完成", summary: repoSummary(first.id, { ahead: 0 }) },
      { repoId: blocked.id, status: "error", message: "当前分支落后于 upstream，已跳过 push", summary: null },
    ]);

    await pushAll();

    expect(service.bulkSyncPreview).toHaveBeenCalledWith("push");
    expect(service.bulkSyncExecute).toHaveBeenCalledWith("push", [first.id, blocked.id]);
    expect(service.pushRepo).not.toHaveBeenCalled();
    expect(state.bulkPreview).toEqual(preview);
    expect(state.bulkResults).toEqual([
      { repoId: first.id, status: "success", message: "完成", summary: repoSummary(first.id, { ahead: 0 }) },
      { repoId: blocked.id, status: "error", message: "当前分支落后于 upstream，已跳过 push", summary: null },
    ]);
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
    expect(state.recentPush?.results).toEqual(state.bulkResults);
  });

  it("关闭内部 push 快照后仍保留最近一次执行失败结果", async () => {
    const blocked = repoSummary("Lilia", { ahead: 1, behind: 1 });
    const failed = repoSummary("LiliaGithub", { ahead: 1 });
    service.bulkSyncPreview.mockResolvedValue({
      operation: "push",
      eligible: [{ repo: failed, reason: "有本地提交待推送" }],
      blocked: [{ repo: blocked, reason: "当前分支落后于 upstream" }],
      warnings: [],
    });
    service.bulkSyncExecute.mockResolvedValue([
      { repoId: failed.id, status: "error", message: "认证失败", summary: null },
      { repoId: blocked.id, status: "error", message: "当前分支落后于 upstream，已跳过 push", summary: null },
    ]);

    await pushAll();
    closeBulkPreview();

    expect(state.bulkPreview).toBeNull();
    expect(state.recentPush?.preview.blocked).toEqual([{ repo: blocked, reason: "当前分支落后于 upstream" }]);
    expect(state.recentPush?.results).toEqual([
      { repoId: failed.id, status: "error", message: "认证失败", summary: null },
      { repoId: blocked.id, status: "error", message: "当前分支落后于 upstream，已跳过 push", summary: null },
    ]);
  });

  it("单仓库 push 重试会更新最近一次 push 失败状态", async () => {
    const failed = repoSummary("LiliaGithub", { ahead: 1 });
    const updated = repoSummary("LiliaGithub", { ahead: 0 });
    state.repos = [failed];
    state.recentPush = {
      preview: {
        operation: "push",
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

    expect(state.recentPush?.results).toEqual([
      { repoId: failed.id, status: "success", message: "完成", summary: updated },
    ]);
    expect(state.recentPush?.retryingRepoIds).toEqual([]);
    expect(state.repos[0].ahead).toBe(0);
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

    expect(service.scanRepos).not.toHaveBeenCalled();
    expect(service.getRepoDetail).toHaveBeenCalledTimes(6);
    expect(state.repos).toEqual([updated]);
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

    await mergePull(initial.id);
    await acceptConflictFile(initial.id, "src/main.ts", "ours", true);
    await resolveConflictFile(initial.id, "src/main.ts", [{ hunkId: "hunk-1", side: "ours" }], true);
    await markConflictFileResolved(initial.id, "src/main.ts");
    await abortConflictOperation(initial.id);

    expect(service.scanRepos).not.toHaveBeenCalled();
    expect(service.getRepoDetail).toHaveBeenCalledTimes(5);
    expect(state.repos).toEqual([updated]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkout,
  commit,
  hideRepo,
  pull,
  push,
  stage,
  unhideRepo,
  unstage,
} from "../src/composables/workspace/repositories";
import { executeBulk } from "../src/composables/workspace/bulk";
import { resetWorkspaceStateForTests, state } from "../src/composables/workspace/state";
import type { WorkspaceService } from "../src/composables/workspace/serviceLoader";
import type { RepoDetail, RepoSummary, WorkspaceSettings } from "../src/services/workspace";

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
  pushRepo: vi.fn(),
  checkoutBranch: vi.fn(),
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
    lastCommitAt: null,
    lastCommitMessage: null,
    ...overrides,
  };
}

function repoDetail(summary: RepoSummary): RepoDetail {
  return {
    summary,
    changes: [],
    commits: [],
    branches: [],
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
    expect(state.repos.find((repo) => repo.id === "Lilia")?.ahead).toBe(3);
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
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  bulkSyncExecute,
  bulkSyncPreview,
  deleteGitHubRepo,
  getRepoDetail,
  listGitHubRepos,
  listWorkspaceTasks,
  refreshRepos,
  workspaceFallbackForTests,
} from "../src/services/workspace";

type WorkspaceFallbackForTests = Awaited<ReturnType<typeof workspaceFallbackForTests>>;
let workspaceFallback: WorkspaceFallbackForTests;

describe("workspace fallback refresh", () => {
  beforeEach(async () => {
    workspaceFallback = await workspaceFallbackForTests();
  });

  it("刷新仓库默认只读取本地状态", async () => {
    const repos = await refreshRepos();
    const tasks = await listWorkspaceTasks();

    expect(repos).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      kind: "repoStatus",
      priority: "high",
      repoId: null,
      status: "success",
      message: "已读取 2 个仓库的本地状态",
    });
  });

  it("本地刷新不受远端同步失败影响", async () => {
    workspaceFallback.setFallbackRepoRemoteSyncOverrideForTests((repo) => (
      repo.id === "LiliaGithub" ? "认证失败" : null
    ));

    const repos = await refreshRepos();
    const tasks = await listWorkspaceTasks();

    expect(repos.map((repo) => repo.id)).toEqual(["LiliaGithub", "Lilia"]);
    expect(tasks[0]).toMatchObject({
      kind: "repoStatus",
      priority: "high",
      repoId: null,
      status: "success",
      message: "已读取 2 个仓库的本地状态",
    });
  });

  it("删除 GitHub 远端仓库只清理远端列表并保留本地仓库", async () => {
    await deleteGitHubRepo("sena-nana/LiliaGithub");

    const githubRepos = await listGitHubRepos();
    const localRepos = await refreshRepos();

    expect(githubRepos.items.map((repo) => repo.fullName)).toEqual([
      "sena-nana/Lilia",
    ]);
    expect(localRepos.map((repo) => repo.id)).toEqual(["LiliaGithub", "Lilia"]);
  });

  it("批量 push 会纳入零 ahead 的未发布分支并补齐远端跟踪状态", async () => {
    const [repo] = await refreshRepos();
    const unpublished = {
      ...repo,
      currentBranch: "feature/bulk-publish",
      ahead: 0,
      behind: 0,
    };
    workspaceFallback.setFallbackRepoOverridesForTests({ [repo.id]: unpublished });

    const pushPreview = await bulkSyncPreview("push", [unpublished]);
    expect(pushPreview.eligible.map((item) => item.repo.id)).toEqual([repo.id]);
    const syncPreview = await bulkSyncPreview("sync", [unpublished]);
    expect(syncPreview.eligible).toHaveLength(0);
    expect(syncPreview.blocked).toHaveLength(1);

    const [result] = await bulkSyncExecute("push", [repo.id]);
    expect(result).toMatchObject({ status: "success", summary: { ahead: 0 } });
    const detail = await getRepoDetail(repo.id);
    expect(detail.branches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "feature/bulk-publish",
        upstream: "origin/feature/bulk-publish",
      }),
      expect.objectContaining({ name: "origin/feature/bulk-publish", remote: true }),
    ]));
  });
});

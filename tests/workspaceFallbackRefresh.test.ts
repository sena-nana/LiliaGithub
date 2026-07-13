import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bulkSyncExecute,
  bulkSyncPreview,
  deleteGitHubRepo,
  enqueueRepoRefresh,
  getRepoDetail,
  listGitHubRepos,
  listWorkspaceTasks,
  refreshRepos,
  setActiveWorkspaceRepo,
  setWorkspaceRefreshPaused,
  workspaceFallbackForTests,
} from "../src/services/workspace";

type WorkspaceFallbackForTests = Awaited<ReturnType<typeof workspaceFallbackForTests>>;
let workspaceFallback: WorkspaceFallbackForTests;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

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

  it("活动任务不会被终态历史淘汰，并在完成后恢复列表上限", async () => {
    await setWorkspaceRefreshPaused(true);
    const taskId = await enqueueRepoRefresh({
      repoId: "LiliaGithub",
      mode: "local",
      priority: "low",
      force: false,
      detailScope: "summary",
      trigger: "watch",
    });

    for (let index = 0; index < 200; index += 1) {
      await refreshRepos();
    }

    const tasksWhilePaused = await listWorkspaceTasks();
    expect(tasksWhilePaused).toHaveLength(200);
    expect(tasksWhilePaused.find((task) => task.id === taskId)).toMatchObject({
      status: "pending",
      repoId: "LiliaGithub",
    });

    await setWorkspaceRefreshPaused(false);
    await vi.waitFor(async () => {
      const completedTask = (await listWorkspaceTasks()).find((task) => task.id === taskId);
      expect(completedTask?.status).toBe("success");
    });

    expect(await listWorkspaceTasks()).toHaveLength(200);
  });

  it("同一仓库的本地与远端刷新不会跨 lane 同时执行", async () => {
    const detail = await getRepoDetail("LiliaGithub");
    const localDetail = deferred<typeof detail>();
    workspaceFallback.setFallbackRepoDetailOverrideForTests(() => localDetail.promise);
    await setActiveWorkspaceRepo("LiliaGithub");

    const localTaskId = await enqueueRepoRefresh({
      repoId: "LiliaGithub",
      mode: "local",
      priority: "normal",
      force: false,
      detailScope: "detail",
      trigger: "manual",
    });
    await vi.waitFor(async () => {
      expect((await listWorkspaceTasks()).find((task) => task.id === localTaskId)?.status).toBe("running");
    });

    const remoteTaskId = await enqueueRepoRefresh({
      repoId: "LiliaGithub",
      mode: "remote",
      priority: "high",
      force: true,
      detailScope: "summary",
      trigger: "manual",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await listWorkspaceTasks()).find((task) => task.id === remoteTaskId)?.status).toBe("pending");

    localDetail.resolve(detail);
    await vi.waitFor(async () => {
      const tasks = await listWorkspaceTasks();
      expect(tasks.find((task) => task.id === localTaskId)?.status).toBe("success");
      expect(tasks.find((task) => task.id === remoteTaskId)?.status).toBe("success");
    });
  });

  it("本地刷新最多并行四个仓库", async () => {
    const detail = await getRepoDetail("LiliaGithub");
    const releases: Array<() => void> = [];
    workspaceFallback.setFallbackRepoDetailOverrideForTests(async () => {
      const gate = deferred<void>();
      releases.push(() => gate.resolve(undefined));
      await gate.promise;
      return detail;
    });

    const taskIds = await Promise.all(Array.from({ length: 5 }, (_, index) => enqueueRepoRefresh({
      repoId: `Repo${index + 1}`,
      mode: "local",
      priority: "normal",
      force: false,
      detailScope: "detail",
      trigger: "manual",
    })));
    await vi.waitFor(() => expect(releases).toHaveLength(4));

    releases[0]();
    await vi.waitFor(() => expect(releases).toHaveLength(5));
    releases.forEach((release) => release());
    await vi.waitFor(async () => {
      const tasks = await listWorkspaceTasks();
      expect(taskIds.map((id) => tasks.find((task) => task.id === id)?.status)).toEqual([
        "success",
        "success",
        "success",
        "success",
        "success",
      ]);
    });
  });

  it("远端刷新保持单仓库串行", async () => {
    const detail = await getRepoDetail("LiliaGithub");
    const releases: Array<() => void> = [];
    workspaceFallback.setFallbackRepoDetailOverrideForTests(async () => {
      const gate = deferred<void>();
      releases.push(() => gate.resolve(undefined));
      await gate.promise;
      return detail;
    });

    const taskIds = await Promise.all(["LiliaGithub", "Lilia"].map((repoId) => enqueueRepoRefresh({
      repoId,
      mode: "remote",
      priority: "normal",
      force: true,
      detailScope: "detail",
      trigger: "autoSync",
    })));
    await vi.waitFor(() => expect(releases).toHaveLength(1));

    releases[0]();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]();
    await vi.waitFor(async () => {
      const tasks = await listWorkspaceTasks();
      expect(taskIds.map((id) => tasks.find((task) => task.id === id)?.status)).toEqual([
        "success",
        "success",
      ]);
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

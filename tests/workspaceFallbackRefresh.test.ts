import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bulkSyncExecute,
  bulkSyncPreview,
  cancelWorkspaceTask,
  createWorkspace,
  deleteGitHubRepo,
  enqueueRepoRefresh,
  getRepoDetail,
  getWorkspaceSettings,
  listGitHubRepos,
  listWorkspaceTasks,
  refreshRepoSummary,
  refreshRepos,
  setActiveWorkspaceRepo,
  setWorkspaceRefreshPaused,
  stopRepoLaunch,
  switchWorkspace,
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
      message: "已完成",
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
      message: "已完成",
    });
  });

  it("仓库摘要远端刷新失败时仍返回本地摘要，并如实记录失败终态", async () => {
    workspaceFallback.setFallbackRepoRemoteSyncOverrideForTests(() => "认证失败");

    const summary = await refreshRepoSummary("LiliaGithub", { fetchRemote: true });
    const task = (await listWorkspaceTasks()).find((candidate) => candidate.repoId === "LiliaGithub");

    expect(summary.id).toBe("LiliaGithub");
    expect(task).toMatchObject({
      kind: "repoStatus",
      status: "error",
      cancellable: false,
    });
    expect(task?.message).toEqual(expect.any(String));
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

  it("仓库刷新与普通写操作共享同一资源锁", async () => {
    const detail = await getRepoDetail("LiliaGithub");
    const localDetail = deferred<typeof detail>();
    workspaceFallback.setFallbackRepoDetailOverrideForTests(() => localDetail.promise);
    const bulkStarted = vi.fn();
    workspaceFallback.setFallbackBulkExecuteOverrideForTests(async (_operation, repoIds) => {
      bulkStarted();
      return [{ repoId: repoIds[0]!, status: "success", message: "", summary: null }];
    });

    const refreshTaskId = await enqueueRepoRefresh({
      repoId: "LiliaGithub",
      mode: "local",
      priority: "normal",
      force: false,
      detailScope: "detail",
      trigger: "manual",
    });
    await vi.waitFor(async () => {
      expect((await listWorkspaceTasks()).find((task) => task.id === refreshTaskId)?.status).toBe("running");
    });

    const syncing = bulkSyncExecute("sync", ["LiliaGithub"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bulkStarted).not.toHaveBeenCalled();
    expect((await listWorkspaceTasks()).find((task) => task.kind === "sync")).toMatchObject({
      status: "pending",
      cancellable: true,
    });

    localDetail.resolve(detail);
    await syncing;
    expect(bulkStarted).toHaveBeenCalledTimes(1);
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

    const pushPreview = await bulkSyncPreview("push", [unpublished.id]);
    expect(pushPreview.eligible.map((item) => item.repo.id)).toEqual([repo.id]);
    const syncPreview = await bulkSyncPreview("sync", [unpublished.id]);
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

  it("可见操作由后端语义任务驱动，并可在开始前取消", async () => {
    const execute = vi.fn(() => []);
    workspaceFallback.setFallbackBulkExecuteOverrideForTests(execute);

    const operation = bulkSyncExecute("sync", ["LiliaGithub"], "reject", "syncAll");
    const pending = (await listWorkspaceTasks()).find((task) => task.title === "同步全部仓库");

    expect(pending).toMatchObject({
      kind: "sync",
      priority: "high",
      status: "pending",
      cancellable: true,
    });
    expect(pending?.createdAt).toEqual(expect.any(Number));

    const cancelled = expect(operation).rejects.toThrow("任务已取消");
    await cancelWorkspaceTask(pending!.id);
    await cancelled;
    expect(execute).not.toHaveBeenCalled();
    expect((await listWorkspaceTasks()).find((task) => task.id === pending!.id)).toMatchObject({
      status: "cancelled",
      cancellable: false,
    });
  });

  it("写入任务未开始时也会阻止 fallback 切换工作区", async () => {
    const currentWorkspaceId = (await getWorkspaceSettings()).activeWorkspaceId!;
    const nextWorkspaceId = (await createWorkspace("Next", "D:\\NextWorkspace")).settings.activeWorkspaceId!;
    await switchWorkspace(currentWorkspaceId);
    await setWorkspaceRefreshPaused(true);
    const execute = vi.fn(() => []);
    workspaceFallback.setFallbackBulkExecuteOverrideForTests(execute);

    const operation = bulkSyncExecute("sync", ["LiliaGithub"]);
    const refreshTaskId = await enqueueRepoRefresh({
      repoId: "LiliaGithub",
      mode: "local",
      priority: "normal",
      force: false,
      detailScope: "summary",
      trigger: "manual",
    });
    await expect(switchWorkspace(nextWorkspaceId)).rejects.toThrow("有写入任务正在运行");
    const pending = (await listWorkspaceTasks()).find((task) => task.kind === "sync")!;
    const rejected = expect(operation).rejects.toThrow("任务已取消");
    await cancelWorkspaceTask(pending.id);
    await rejected;
    await setWorkspaceRefreshPaused(false);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const tasks = await listWorkspaceTasks();
    expect(tasks.find((task) => task.id === pending.id)).toMatchObject({
      status: "cancelled",
    });
    expect(tasks.find((task) => task.id === refreshTaskId)?.status).not.toBe("cancelled");
    expect(execute).not.toHaveBeenCalled();
  });

  it("reset 前的迟到 completion 不会污染新一代 scheduler 任务", async () => {
    const idleStatus = await stopRepoLaunch("LiliaGithub");
    const oldGate = deferred<typeof idleStatus>();
    workspaceFallback.setFallbackStopLaunchOverrideForTests(() => oldGate.promise);
    const oldOperation = stopRepoLaunch("LiliaGithub");
    await vi.waitFor(async () => {
      expect((await listWorkspaceTasks()).find((task) => task.kind === "launch")?.status).toBe("running");
    });

    workspaceFallback.resetWorkspaceFallbacksForTests();
    const newGate = deferred<void>();
    workspaceFallback.setFallbackBulkExecuteOverrideForTests(async (_operation, repoIds) => {
      await newGate.promise;
      return [{ repoId: repoIds[0]!, status: "success", message: "", summary: null }];
    });
    const newOperation = bulkSyncExecute("sync", ["LiliaGithub"]);
    await vi.waitFor(async () => {
      expect((await listWorkspaceTasks()).find((task) => task.kind === "sync")?.status).toBe("running");
    });
    const newTask = (await listWorkspaceTasks()).find((task) => task.kind === "sync")!;

    oldGate.resolve(idleStatus);
    await oldOperation;
    expect((await listWorkspaceTasks()).find((task) => task.id === newTask.id)?.status).toBe("running");

    newGate.resolve(undefined);
    await newOperation;
    expect((await listWorkspaceTasks()).find((task) => task.id === newTask.id)?.status).toBe("success");
  });

  it("批量 runner 限制四并发，并优先调度用户触发的高优先级任务", async () => {
    const starts: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred<void>>>();
    workspaceFallback.setFallbackBulkExecuteOverrideForTests(async (_operation, repoIds) => {
      const repoId = repoIds[0]!;
      const gate = deferred<void>();
      gates.set(repoId, gate);
      starts.push(repoId);
      await gate.promise;
      return [{ repoId, status: "success", message: "", summary: null }];
    });

    const initial = ["Repo1", "Repo2", "Repo3", "Repo4"].map((repoId) =>
      bulkSyncExecute("sync", [repoId], "reject", "manual")
    );
    await vi.waitFor(() => expect(starts).toHaveLength(4));

    const background = bulkSyncExecute("sync", ["Background"], "reject", "autoSync");
    const syncAll = bulkSyncExecute("sync", ["SyncAll"], "reject", "syncAll");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(starts).toHaveLength(4);

    gates.get("Repo1")!.resolve(undefined);
    await vi.waitFor(() => expect(starts).toContain("SyncAll"));
    expect(starts).not.toContain("Background");

    gates.get("Repo2")!.resolve(undefined);
    await vi.waitFor(() => expect(starts).toContain("Background"));
    for (const gate of gates.values()) gate.resolve(undefined);
    await Promise.all([...initial, syncAll, background]);
  });

  it("同仓库的不同 runner 共享排他资源，且运行中任务不可取消", async () => {
    const idleStatus = await stopRepoLaunch("LiliaGithub");
    const launchGate = deferred<typeof idleStatus>();
    workspaceFallback.setFallbackStopLaunchOverrideForTests(() => launchGate.promise);
    const stopping = stopRepoLaunch("LiliaGithub");

    await vi.waitFor(async () => {
      expect((await listWorkspaceTasks()).find((task) => task.kind === "launch")).toMatchObject({
        priority: "high",
        status: "running",
        cancellable: false,
      });
    });
    const launchTask = (await listWorkspaceTasks()).find((task) => task.kind === "launch")!;
    await expect(cancelWorkspaceTask(launchTask.id)).rejects.toThrow();

    const bulkStarted = vi.fn();
    workspaceFallback.setFallbackBulkExecuteOverrideForTests(async (_operation, repoIds) => {
      bulkStarted();
      return [{ repoId: repoIds[0]!, status: "success", message: "", summary: null }];
    });
    const syncing = bulkSyncExecute("sync", ["LiliaGithub"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bulkStarted).not.toHaveBeenCalled();
    expect((await listWorkspaceTasks()).find((task) => task.kind === "sync")).toMatchObject({
      status: "pending",
      cancellable: true,
    });

    launchGate.resolve(idleStatus);
    await stopping;
    await syncing;
    expect(bulkStarted).toHaveBeenCalledTimes(1);
  });
});

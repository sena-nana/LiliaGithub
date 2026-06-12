import { describe, expect, it } from "vitest";
import {
  listWorkspaceTasks,
  refreshRepos,
  setFallbackRepoRemoteSyncOverrideForTests,
} from "../src/services/workspace";

describe("workspace fallback refresh", () => {
  it("刷新仓库时使用远端状态同步语义记录成功任务", async () => {
    const repos = await refreshRepos();
    const tasks = await listWorkspaceTasks();

    expect(repos).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      kind: "repoStatus",
      priority: "high",
      repoId: null,
      status: "success",
      message: "已刷新 2 个仓库并同步远端状态",
    });
  });

  it("远端同步部分失败时保留仓库刷新结果并记录 error 任务", async () => {
    setFallbackRepoRemoteSyncOverrideForTests((repo) => (
      repo.id === "LiliaGithub" ? "认证失败" : null
    ));

    const repos = await refreshRepos();
    const tasks = await listWorkspaceTasks();

    expect(repos.map((repo) => repo.id)).toEqual(["LiliaGithub", "Lilia"]);
    expect(tasks[0]).toMatchObject({
      kind: "repoStatus",
      priority: "high",
      repoId: null,
      status: "error",
      message: "已刷新 2 个仓库，1 个仓库 fetch 失败：LiliaGithub（认证失败）",
    });
  });
});

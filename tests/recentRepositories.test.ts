import { describe, expect, it } from "vitest";
import { recordRecentLocalRepo, workspaceFallbackForTests } from "../src/services/workspace";
import { repoSummary } from "./fixtures/workspace";

describe("最近访问仓库", () => {
  it("仓库成功访问记录会持久化去重", async () => {
    const fallback = await workspaceFallbackForTests();
    fallback.setFallbackRepoOverridesForTests({ LiliaGithub: repoSummary("LiliaGithub") });

    await recordRecentLocalRepo("LiliaGithub");
    const settings = await recordRecentLocalRepo("LiliaGithub");

    expect(settings.recentLocalRepos.filter((visit) => visit.repoId === "LiliaGithub")).toHaveLength(1);
  });
});

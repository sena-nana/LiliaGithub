import { describe, expect, it } from "vitest";
import { repoSummary } from "./fixtures/workspace";
import { repoDisplayInfo, repoDisplayName } from "../src/utils/repoDisplay";

describe("repoDisplayName", () => {
  it("普通 GitHub 仓库显示远端仓库名", () => {
    const repo = repoSummary("local-folder", {
      githubFullName: "sena-nana/LiliaGithub",
      name: "local-folder",
    });

    expect(repoDisplayName(repo)).toBe("LiliaGithub");
    expect(repoDisplayInfo(repo)).toEqual({ name: "LiliaGithub", source: "remote" });
  });

  it("linked worktree 优先显示本地工作树名", () => {
    const repo = repoSummary("lilia-github-feature", {
      githubFullName: "sena-nana/LiliaGithub",
      name: "lilia-github-feature",
      worktree: {
        role: "linked",
        sharedRepoKey: "shared:lilia-github",
        mainRepoId: "LiliaGithub",
      },
    });

    expect(repoDisplayName(repo)).toBe("lilia-github-feature");
    expect(repoDisplayInfo(repo)).toEqual({ name: "lilia-github-feature", source: "worktree" });
  });

  it("缺失远端仓库名时回退本地文件夹名", () => {
    const repo = repoSummary("local-only", {
      githubFullName: null,
      name: "local-only",
    });

    expect(repoDisplayName(repo)).toBe("local-only");
    expect(repoDisplayInfo(repo)).toEqual({ name: "local-only", source: "local" });
  });
});

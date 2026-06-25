import { describe, expect, it } from "vitest";
import { repoSummary } from "./fixtures/workspace";
import { repoDisplayName } from "../src/utils/repoDisplay";

describe("repoDisplayName", () => {
  it("普通 GitHub 仓库显示远端仓库名", () => {
    const repo = repoSummary("local-folder", {
      githubFullName: "sena-nana/LiliaGithub",
      name: "local-folder",
    });

    expect(repoDisplayName(repo)).toBe("LiliaGithub");
  });

  it("linked worktree 显示本地工作树名", () => {
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
  });
});

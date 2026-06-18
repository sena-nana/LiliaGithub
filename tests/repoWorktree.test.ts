import { describe, expect, it } from "vitest";
import { repoSummary } from "./fixtures/workspace";
import {
  representativeReposByGitHubFullName,
  representativeReposBySharedGroup,
} from "../src/utils/repoWorktree";

describe("repoWorktree helpers", () => {
  it("共享仓库分组优先选择 main 作为代表仓库", () => {
    const main = repoSummary("main-repo", {
      worktree: {
        role: "main",
        sharedRepoKey: "shared:repo",
        mainRepoId: "main-repo",
      },
    });
    const linked = repoSummary("linked-repo", {
      worktree: {
        role: "linked",
        sharedRepoKey: "shared:repo",
        mainRepoId: "main-repo",
      },
    });

    expect(representativeReposBySharedGroup([linked, main])).toEqual([main]);
  });

  it("GitHub 映射先按 sharedRepoKey 去重，再稳定选代表仓库", () => {
    const main = repoSummary("main-repo", {
      githubFullName: "sena-nana/LiliaGithub",
      relativePath: "main-repo",
      worktree: {
        role: "main",
        sharedRepoKey: "shared:repo",
        mainRepoId: "main-repo",
      },
    });
    const linked = repoSummary("linked-repo", {
      githubFullName: "sena-nana/LiliaGithub",
      relativePath: "z-linked-repo",
      worktree: {
        role: "linked",
        sharedRepoKey: "shared:repo",
        mainRepoId: "main-repo",
      },
    });
    const secondClone = repoSummary("second-clone", {
      githubFullName: "sena-nana/LiliaGithub",
      relativePath: "aa-second-clone",
      worktree: {
        role: "standalone",
        sharedRepoKey: "repo:second-clone",
        mainRepoId: null,
      },
    });

    const mapped = representativeReposByGitHubFullName([secondClone, linked, main]);

    expect(mapped.get("sena-nana/LiliaGithub")).toEqual(main);
  });
});

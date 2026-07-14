import { beforeEach, describe, expect, it } from "vitest";
import {
  abortConflictOperation,
  acceptConflictFile,
  continueConflictOperation,
  getRepoConflicts,
  markFileResolved,
  resolveConflictFile,
  workspaceFallbackForTests,
} from "../src/services/workspace";
import { conflictState, repoSummary } from "./fixtures/workspace";

type WorkspaceFallbackForTests = Awaited<ReturnType<typeof workspaceFallbackForTests>>;
let workspaceFallback: WorkspaceFallbackForTests;

function conflictFile(path: string, hunkId: string) {
  return {
    path,
    status: "UU",
    resolved: false,
    binary: false,
    hunks: [{
      id: hunkId,
      startLine: 1,
      endLine: 4,
      oursLabel: "HEAD",
      theirsLabel: "origin/main",
      oursLines: ["ours"],
      theirsLines: ["theirs"],
    }],
  };
}

describe("workspace fallback conflicts", () => {
  beforeEach(async () => {
    workspaceFallback = await workspaceFallbackForTests();
  });

  it("逐文件解决冲突并在继续操作后结束仓库冲突状态", async () => {
    const repoId = "Lilia";
    workspaceFallback.setFallbackRepoOverridesForTests({
      [repoId]: repoSummary(repoId, { conflictCount: 3 }),
    });
    workspaceFallback.setFallbackConflictOverrideForTests((candidate) => candidate === repoId
      ? conflictState({
          operation: "rebase",
          allResolved: false,
          files: [
            conflictFile("src/accept.ts", "accept-hunk"),
            conflictFile("src/resolve.ts", "resolve-hunk"),
            conflictFile("src/mark.ts", "mark-hunk"),
          ],
        })
      : null);

    const accepted = await acceptConflictFile(repoId, "src/accept.ts", "ours");
    expect(accepted).toMatchObject({ conflictCount: 2, stagedCount: 1 });
    expect((await getRepoConflicts(repoId)).files.map((file) => file.path)).toEqual([
      "src/resolve.ts",
      "src/mark.ts",
    ]);

    const resolved = await resolveConflictFile(repoId, "src/resolve.ts", [
      { hunkId: "resolve-hunk", side: "theirs" },
    ]);
    expect(resolved).toMatchObject({ conflictCount: 1, stagedCount: 2 });

    const marked = await markFileResolved(repoId, "src/mark.ts");
    expect(marked).toMatchObject({ conflictCount: 0, stagedCount: 3 });
    expect(await getRepoConflicts(repoId)).toEqual({
      operation: "rebase",
      files: [],
      allResolved: true,
    });

    await expect(continueConflictOperation(repoId)).resolves.toMatchObject({ conflictCount: 0 });
    expect(await getRepoConflicts(repoId)).toEqual({
      operation: "none",
      files: [],
      allResolved: true,
    });
  });

  it("存在未解决文件时拒绝继续，并允许终止整个冲突操作", async () => {
    const repoId = "LiliaGithub";
    workspaceFallback.setFallbackRepoOverridesForTests({
      [repoId]: repoSummary(repoId, { conflictCount: 2 }),
    });
    workspaceFallback.setFallbackConflictOverrideForTests((candidate) => candidate === repoId
      ? conflictState({
          operation: "cherry-pick",
          allResolved: false,
          files: [
            conflictFile("src/one.ts", "one-hunk"),
            conflictFile("src/two.ts", "two-hunk"),
          ],
        })
      : null);

    await expect(continueConflictOperation(repoId)).rejects.toThrow("仍有冲突文件未解决");
    expect((await getRepoConflicts(repoId)).files).toHaveLength(2);

    await expect(abortConflictOperation(repoId)).resolves.toMatchObject({ conflictCount: 0 });
    expect(await getRepoConflicts(repoId)).toEqual({
      operation: "none",
      files: [],
      allResolved: true,
    });
  });

  it("替换测试 override 时重新初始化对应仓库状态", async () => {
    const repoId = "Mutsuki";
    workspaceFallback.setFallbackConflictOverrideForTests(() => conflictState({
      operation: "merge",
      files: [conflictFile("src/first.ts", "first-hunk")],
      allResolved: false,
    }));
    expect((await getRepoConflicts(repoId)).files[0]?.path).toBe("src/first.ts");

    workspaceFallback.setFallbackConflictOverrideForTests(() => conflictState({
      operation: "merge",
      files: [conflictFile("src/second.ts", "second-hunk")],
      allResolved: false,
    }));
    expect((await getRepoConflicts(repoId)).files[0]?.path).toBe("src/second.ts");
  });
});

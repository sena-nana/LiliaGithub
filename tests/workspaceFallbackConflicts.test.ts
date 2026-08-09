import { beforeEach, describe, expect, it } from "vitest";
import { workspaceFallbackForTests } from "../src/services/workspace";
import { createDefaultWorkspaceTransport, createWorkspaceClient } from "../src/services/workspace/client";
const {
  abortConflictOperation,
  acceptConflictFile,
  continueConflictOperation,
  getRepoConflicts,
  markFileResolved,
  resolveConflictFile,
  saveConflictFile,
} = createWorkspaceClient(createDefaultWorkspaceTransport());
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
    expect(marked).toMatchObject({ conflictCount: 0, conflictOperation: "rebase", stagedCount: 3 });
    expect(await getRepoConflicts(repoId)).toEqual({
      operation: "rebase",
      files: [],
      allResolved: true,
    });

    await expect(continueConflictOperation(repoId)).resolves.toMatchObject({
      conflictCount: 0,
      conflictOperation: "none",
    });
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

  it("保存完整冲突结果时校验原内容并同步预览与暂存状态", async () => {
    const repoId = "LiliaGithub";
    const path = "src/merged.ts";
    const original = "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> origin/main\n";
    workspaceFallback.setFallbackRepoOverridesForTests({
      [repoId]: repoSummary(repoId, { conflictCount: 1 }),
    });
    workspaceFallback.setFallbackConflictOverrideForTests((candidate) => candidate === repoId
      ? conflictState({ operation: "merge", files: [conflictFile(path, "hunk-1")], allResolved: false })
      : null);
    workspaceFallback.setFallbackRepoFilePreviewsForTests({
      [repoId]: {
        [path]: {
          path,
          name: "merged.ts",
          previewKind: "text",
          content: original,
          dataUrl: null,
          images: {},
          size: original.length,
          mimeType: "text/typescript",
          truncated: false,
        },
      },
    });

    await expect(saveConflictFile(repoId, path, "merged\n", "stale\n"))
      .rejects.toThrow("文件已在外部变化");
    await expect(saveConflictFile(repoId, path, original, original))
      .rejects.toThrow("仍包含未解决的冲突标记");

    await expect(saveConflictFile(repoId, path, "merged\n", original)).resolves.toMatchObject({
      conflictCount: 0,
      stagedCount: 1,
    });
    await expect(workspaceFallback.getRepoFilePreview(repoId, path)).resolves.toMatchObject({
      content: "merged\n",
      size: 7,
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

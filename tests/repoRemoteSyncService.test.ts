import { describe, expect, it } from "vitest";
import { repoSummary } from "./fixtures/workspace";
import {
  getRepoRemoteSyncConfig,
  getRepoSummary,
  pullRepo,
  pushRepo,
  setFallbackRemoteOperationErrorOverrideForTests,
  setFallbackRepoOverridesForTests,
  setFallbackRepoRemotesForTests,
  setRepoRemoteSyncPolicy,
} from "../src/services/workspace/fallback";

const remotes = [
  { name: "origin", fetchUrl: "https://example.test/origin.git", pushUrl: "https://example.test/origin.git", current: true },
  { name: "mirror", fetchUrl: "https://example.test/mirror.git", pushUrl: "https://example.test/mirror.git", current: false },
];

function configureMultiRemoteRepo() {
  const summary = repoSummary("LiliaGithub", {
    ahead: 2,
    behind: 1,
    remoteBranchStates: [
      { remote: "origin", remoteBranch: "main", exists: true, ahead: 2, behind: 1, needsPull: true, needsPush: true, upstream: true },
      { remote: "mirror", remoteBranch: "main", exists: true, ahead: 2, behind: 0, needsPull: false, needsPush: true, upstream: false },
    ],
    remotesNeedingPull: 1,
    remotesNeedingPush: 2,
  });
  setFallbackRepoOverridesForTests({ [summary.id]: summary });
  setFallbackRepoRemotesForTests(summary.id, remotes);
  return summary;
}

describe("repo remote sync fallback", () => {
  it("resolves the legacy primary remote and persists an explicit multi-remote policy", async () => {
    const repo = configureMultiRemoteRepo();

    expect(await getRepoRemoteSyncConfig(repo.id)).toMatchObject({
      policy: null,
      resolvedPolicy: { primaryRemote: "origin", pullRemotes: ["origin"], pushRemotes: ["origin"] },
      validationErrors: [],
    });

    const saved = await setRepoRemoteSyncPolicy(repo.id, {
      primaryRemote: "origin",
      pullRemotes: ["origin", "mirror"],
      pushRemotes: ["origin", "mirror"],
    });
    expect(saved.policy).toEqual(saved.resolvedPolicy);
    expect(saved.remotes.map((remote) => remote.name)).toEqual(["origin", "mirror"]);
  });

  it("returns partial push results and can retry only the failed remote", async () => {
    const repo = configureMultiRemoteRepo();
    await setRepoRemoteSyncPolicy(repo.id, {
      primaryRemote: "origin",
      pullRemotes: ["origin", "mirror"],
      pushRemotes: ["origin", "mirror"],
    });
    setFallbackRemoteOperationErrorOverrideForTests((_repoId, remote, operation) =>
      operation === "push" && remote === "mirror" ? "mirror unavailable" : null
    );

    const partial = await pushRepo(repo.id);
    expect(partial.status).toBe("partial");
    expect(partial.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ remote: "origin", operation: "push", status: "success" }),
      expect.objectContaining({ remote: "mirror", operation: "push", status: "error" }),
    ]));

    setFallbackRemoteOperationErrorOverrideForTests(null);
    const retried = await pushRepo(repo.id, ["mirror"]);
    expect(retried.status).toBe("success");
    expect(retried.steps.map((step) => step.remote)).toEqual(["mirror"]);
  });

  it("does not modify local sync state when any configured fetch fails", async () => {
    const repo = configureMultiRemoteRepo();
    await setRepoRemoteSyncPolicy(repo.id, {
      primaryRemote: "origin",
      pullRemotes: ["origin", "mirror"],
      pushRemotes: ["origin"],
    });
    setFallbackRemoteOperationErrorOverrideForTests((_repoId, remote, operation) =>
      operation === "fetch" && remote === "mirror" ? "fetch failed" : null
    );

    const result = await pullRepo(repo.id, "stash");
    const current = await getRepoSummary(repo.id);
    expect(result.status).toBe("partial");
    expect(result.steps.every((step) => step.operation === "fetch")).toBe(true);
    expect(current.behind).toBe(repo.behind);
    expect(current.remotesNeedingPull).toBe(repo.remotesNeedingPull);
  });
});

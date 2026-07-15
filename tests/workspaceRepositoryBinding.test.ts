import { beforeEach, describe, expect, it } from "vitest";
import {
  cloneRepo,
  deleteLocalRepo,
  forgetRemoteRepo,
  getWorkspaceSettings,
  rememberRemoteRepo,
  workspaceFallbackForTests,
} from "../src/services/workspace";

describe("workspace repository binding fallback", () => {
  beforeEach(async () => {
    await workspaceFallbackForTests();
  });

  it("persists canonical identity for clone and removes it with the local repo", async () => {
    const summary = await cloneRepo({
      remoteUrl: "binding-org/canonical-repo",
      repository: {
        id: 90210,
        fullName: "binding-org/canonical-repo",
        cloneUrl: "https://github.com/binding-org/canonical-repo.git",
      },
      target: { kind: "default" },
    });

    expect(summary).toMatchObject({
      id: "binding-org/canonical-repo",
      githubFullName: "binding-org/canonical-repo",
      githubRepositoryId: 90210,
      canonicalRemoteUrl: "https://github.com/binding-org/canonical-repo.git",
    });
    expect((await getWorkspaceSettings()).repoBindings[summary.id]).toEqual({
      repositoryId: 90210,
      remoteFullName: "binding-org/canonical-repo",
      canonicalRemoteUrl: "https://github.com/binding-org/canonical-repo.git",
      localPath: "C:\\Files\\workspace\\binding-org\\canonical-repo",
    });

    await deleteLocalRepo(summary.id);
    expect((await getWorkspaceSettings()).repoBindings[summary.id]).toBeUndefined();
  });

  it("keeps remote shortcuts isolated by the bound account", async () => {
    const fallback = await workspaceFallbackForTests();
    const bindAs = (login: string) => fallback.setFallbackGitHubBindingStatusForTests({
      state: "bound",
      clientIdConfigured: true,
      clientIdSource: "test",
      binding: {
        login,
        avatarUrl: null,
        boundAt: 1,
        scopes: ["repo"],
        clientIdSource: "test",
      },
    });
    const shortcut = (repositoryId: number) => ({
      repositoryId,
      fullName: "binding-org/shared-repo",
      name: "shared-repo",
      private: false,
      archived: false,
      defaultBranch: "main",
      htmlUrl: "https://github.com/binding-org/shared-repo",
      cloneUrl: "https://github.com/binding-org/shared-repo.git",
      openedAt: 0,
    });

    bindAs("account-a");
    await rememberRemoteRepo(shortcut(1));
    expect((await getWorkspaceSettings()).remoteRepoShortcuts[0]).toMatchObject({
      accountLogin: "account-a",
      repositoryId: 1,
      canonicalRemoteUrl: "https://github.com/binding-org/shared-repo.git",
    });

    bindAs("account-b");
    expect((await getWorkspaceSettings()).remoteRepoShortcuts).toEqual([]);
    await rememberRemoteRepo(shortcut(2));
    expect((await getWorkspaceSettings()).remoteRepoShortcuts).toHaveLength(1);
    expect((await getWorkspaceSettings()).remoteRepoShortcuts[0].repositoryId).toBe(2);

    bindAs("account-a");
    expect((await getWorkspaceSettings()).remoteRepoShortcuts[0].repositoryId).toBe(1);
    await forgetRemoteRepo("binding-org/shared-repo");
    expect((await getWorkspaceSettings()).remoteRepoShortcuts).toEqual([]);

    bindAs("account-b");
    expect((await getWorkspaceSettings()).remoteRepoShortcuts[0].repositoryId).toBe(2);
  });
});

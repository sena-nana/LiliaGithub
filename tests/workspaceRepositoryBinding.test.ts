import { beforeEach, describe, expect, it } from "vitest";
import {
  cloneRepo,
  createLocalRepo,
  createRepoGroup,
  deleteLocalRepo,
  forgetRemoteRepo,
  getWorkspaceSettings,
  reconcileOrganizationRepoGroups,
  rememberRemoteRepo,
  renameRepoGroup,
  workspaceFallbackForTests,
} from "../src/services/workspace";

describe("workspace repository binding fallback", () => {
  beforeEach(async () => {
    await workspaceFallbackForTests();
  });

  it("persists canonical identity for clone and removes it with the local repo", async () => {
    const { repo: summary } = await cloneRepo({
      remoteUrl: "binding-org/canonical-repo",
      repository: {
        id: 90210,
        fullName: "binding-org/canonical-repo",
        cloneUrl: "https://github.com/binding-org/canonical-repo.git",
      },
      placement: { kind: "automatic" },
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

  it("creates one persistent group per organization and reuses it after rename", async () => {
    const first = await cloneRepo({
      remoteUrl: "https://github.com/Binding-Org/first.git",
      repository: {
        id: 91001,
        fullName: "Binding-Org/first",
        cloneUrl: "https://github.com/Binding-Org/first.git",
        owner: { login: "Binding-Org", kind: "organization", avatarUrl: null },
      },
      placement: { kind: "automatic" },
      target: { kind: "default" },
    });
    const organizationGroup = first.settings.repoGroups.find((group) =>
      group.organizationLogin?.toLocaleLowerCase() === "binding-org"
    );
    expect(organizationGroup).toMatchObject({ name: "Binding-Org", repoIds: [first.repo.id] });

    await renameRepoGroup(organizationGroup!.id, "核心项目");
    const second = await cloneRepo({
      remoteUrl: "https://github.com/binding-org/second.git",
      repository: {
        id: 91002,
        fullName: "binding-org/second",
        cloneUrl: "https://github.com/binding-org/second.git",
        owner: { login: "binding-org", kind: "organization", avatarUrl: null },
      },
      placement: { kind: "automatic" },
      target: { kind: "default" },
    });

    expect(second.settings.repoGroups).toEqual([
      expect.objectContaining({
        id: organizationGroup!.id,
        name: "核心项目",
        organizationLogin: "Binding-Org",
        repoIds: [first.repo.id, second.repo.id],
      }),
    ]);
  });

  it("keeps explicit ungrouped and custom placements after organization reconciliation", async () => {
    const customSettings = await createRepoGroup("自定义");
    const customGroup = customSettings.repoGroups.find((group) => group.name === "自定义")!;
    const owner = { login: "binding-org", kind: "organization" as const, avatarUrl: null };
    const ungrouped = await cloneRepo({
      remoteUrl: "https://github.com/binding-org/ungrouped.git",
      repository: {
        id: 92001,
        fullName: "binding-org/ungrouped",
        cloneUrl: "https://github.com/binding-org/ungrouped.git",
        owner,
      },
      placement: { kind: "ungrouped" },
      target: { kind: "default" },
    });
    const custom = await cloneRepo({
      remoteUrl: "https://github.com/binding-org/custom.git",
      repository: {
        id: 92002,
        fullName: "binding-org/custom",
        cloneUrl: "https://github.com/binding-org/custom.git",
        owner,
      },
      placement: { kind: "group", groupId: customGroup.id },
      target: { kind: "default" },
    });

    const reconciled = await reconcileOrganizationRepoGroups(["Binding-Org"]);
    expect(reconciled.repoGroups.find((group) => group.id === customGroup.id)?.repoIds).toEqual([custom.repo.id]);
    expect(reconciled.repoGroups.every((group) => !group.repoIds.includes(ungrouped.repo.id))).toBe(true);
    expect(reconciled.organizationGroupingResolvedRepoIds).toEqual(
      expect.arrayContaining([ungrouped.repo.id, custom.repo.id]),
    );
  });

  it("defers unknown owners until organization data is complete and leaves personal or local repos ungrouped", async () => {
    const pending = await cloneRepo({
      remoteUrl: "https://github.com/binding-org/pending.git",
      repository: {
        id: 93001,
        fullName: "binding-org/pending",
        cloneUrl: "https://github.com/binding-org/pending.git",
      },
      placement: { kind: "automatic" },
      target: { kind: "default" },
    });
    expect(pending.settings.repoGroups).toEqual([]);
    expect(pending.settings.organizationGroupingResolvedRepoIds).not.toContain(pending.repo.id);

    const incomplete = await reconcileOrganizationRepoGroups([]);
    expect(incomplete.repoGroups).toEqual([]);
    expect(incomplete.organizationGroupingResolvedRepoIds).not.toContain(pending.repo.id);

    const migrated = await reconcileOrganizationRepoGroups(["Binding-Org"]);
    expect(migrated.repoGroups).toEqual([
      expect.objectContaining({
        organizationLogin: "Binding-Org",
        repoIds: [pending.repo.id],
      }),
    ]);

    const personal = await cloneRepo({
      remoteUrl: "https://github.com/lilia-user/personal.git",
      repository: {
        id: 93002,
        fullName: "lilia-user/personal",
        cloneUrl: "https://github.com/lilia-user/personal.git",
        owner: { login: "lilia-user", kind: "user", avatarUrl: null },
      },
      placement: { kind: "automatic" },
      target: { kind: "default" },
    });
    const local = await createLocalRepo({ name: "local-only", addReadme: true });
    const settings = await getWorkspaceSettings();
    expect(settings.repoGroups.every((group) => !group.repoIds.includes(personal.repo.id))).toBe(true);
    expect(settings.repoGroups.every((group) => !group.repoIds.includes(local.id))).toBe(true);
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

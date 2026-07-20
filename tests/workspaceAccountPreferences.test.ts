import { beforeEach, describe, expect, it } from "vitest";
import {
  addWorkspaceRoot,
  createLocalRepo,
  createWorkspace,
  deleteWorkspace,
  getGitHubAccountProfile,
  getGitHubAccountReadme,
  getGitHubBindingStatus,
  getWorkspaceBootstrap,
  getWorkspaceSettings,
  pollGitHubDeviceFlow,
  renameWorkspace,
  resetWorkspaceFallbacksForTests,
  setContributionIdentities,
  startGitHubDeviceFlow,
  switchWorkspace,
  unbindGitHub,
  updateAccountPreferences,
  updateWorkspaceRecentContext,
  updateWorkspaceViewPreferences,
  updateGitHubAccountProfile,
  workspaceFallbackForTests,
} from "../src/services/workspace";
import { REQUIRED_GITHUB_AUTH_SCOPES } from "../src/services/workspace/authScopes";
import type { AccountPreferences, GitHubBindingStatus } from "../src/services/workspace";

type WorkspaceFallback = Awaited<ReturnType<typeof workspaceFallbackForTests>>;
let fallback: WorkspaceFallback;

function binding(login: string, scopes: string[] = ["repo"]): GitHubBindingStatus {
  return {
    state: "bound",
    clientIdConfigured: true,
    clientIdSource: "test",
    binding: {
      login,
      avatarUrl: null,
      boundAt: 1,
      scopes,
      clientIdSource: "test",
    },
  };
}

function preferences(): AccountPreferences {
  return {
    repositoryScope: { kind: "organization", login: "lilia-org" },
    repositorySort: { key: "name", direction: "asc" },
    issues: { state: "all", sort: "comments", direction: "asc" },
    pullRequests: { state: "merged", sort: "updated", direction: "desc" },
    actions: { state: "completed", sort: "run-number", direction: "asc" },
  };
}

describe("workspace account preferences fallback", () => {
  beforeEach(async () => {
    await resetWorkspaceFallbacksForTests();
    fallback = await workspaceFallbackForTests();
  });

  it("isolates named workspace roots, repositories, and view preferences across switches", async () => {
    const alpha = await createWorkspace("Alpha", "C:\\Workspaces\\Alpha");
    const alphaId = alpha.settings.activeWorkspaceId!;
    const expanded = await addWorkspaceRoot(alphaId, "D:\\Workspaces\\Shared");
    const secondaryRoot = expanded.settings.activeWorkspace!.roots.find(
      (root) => root.path === "D:\\Workspaces\\Shared",
    )!;

    await expect(addWorkspaceRoot(alphaId, "C:\\Workspaces\\Alpha\\nested"))
      .rejects.toThrow("互相包含");
    await updateWorkspaceViewPreferences({
      sidebarRepositorySort: "name:asc",
      collapsedGroupIds: ["group-alpha"],
      homeRepositoryStatusSort: "created:desc",
    });
    const alphaRepo = await createLocalRepo({
      name: "same-name",
      rootId: secondaryRoot.id,
      addReadme: true,
      gitignoreTemplate: null,
      licenseTemplate: null,
    });
    expect(alphaRepo.id).toBe(`local:${secondaryRoot.id}/same-name`);

    const beta = await createWorkspace("Beta", "C:\\Workspaces\\Beta");
    expect(beta.settings.activeWorkspace?.name).toBe("Beta");
    expect(beta.settings.activeWorkspace?.viewPreferences.collapsedGroupIds).toEqual([]);
    await expect(createWorkspace("alpha", "E:\\Another"))
      .rejects.toThrow("已存在");

    const restored = await switchWorkspace(alphaId);
    expect(restored.settings.activeWorkspace?.roots).toHaveLength(2);
    expect(restored.settings.activeWorkspace?.viewPreferences).toEqual({
      sidebarRepositorySort: "name:asc",
      collapsedGroupIds: ["group-alpha"],
      homeRepositoryStatusSort: "created:desc",
    });
    expect(restored.settings.managedRepoIds).toContain(alphaRepo.id);
  });

  it("persists recent context by workspace without changing the active context revision", async () => {
    const alpha = await createWorkspace("Alpha", "C:\\Workspaces\\Alpha");
    const alphaId = alpha.settings.activeWorkspaceId!;
    await updateWorkspaceRecentContext(alphaId, {
      version: 1,
      route: "/repos/alpha/issues/42?state=open",
    });
    await renameWorkspace(alphaId, "Alpha Renamed");

    const beta = await createWorkspace("Beta", "C:\\Workspaces\\Beta");
    const betaId = beta.settings.activeWorkspaceId!;
    const revision = beta.contextRevision;

    await updateWorkspaceRecentContext(alphaId, {
      version: 1,
      route: "/repos/alpha/pulls/7",
    });
    const activeBeta = await getWorkspaceBootstrap();
    expect(activeBeta.contextRevision).toBe(revision);
    expect(activeBeta.settings.activeWorkspace).toMatchObject({
      id: betaId,
      recentContext: null,
    });

    const restoredAlpha = await switchWorkspace(alphaId);
    expect(restoredAlpha.settings.activeWorkspace).toMatchObject({
      name: "Alpha Renamed",
      recentContext: { version: 1, route: "/repos/alpha/pulls/7" },
    });

    const switchedRevision = restoredAlpha.contextRevision;
    await updateWorkspaceRecentContext(alphaId, null);
    const cleared = await getWorkspaceBootstrap();
    expect(cleared.contextRevision).toBe(switchedRevision);
    expect(cleared.settings.activeWorkspace?.recentContext).toBeNull();

    const afterDelete = await deleteWorkspace(alphaId);
    expect(afterDelete.settings.activeWorkspace?.id).toBe(betaId);
  });

  it("keeps the complete workspace profile isolated across bound and anonymous accounts", async () => {
    const accountA = (await getGitHubBindingStatus()).binding!.login;
    const accountAWorkspace = await createWorkspace("Account A", "C:\\Accounts\\A");
    await updateWorkspaceRecentContext(accountAWorkspace.settings.activeWorkspaceId!, {
      version: 1,
      route: "/repos/account-a/issues/1",
    });
    await updateAccountPreferences(preferences());
    await setContributionIdentities([{ name: "Account A", email: "a@example.com" }]);

    fallback.setFallbackGitHubBindingStatusForTests(binding("account-b"));
    const newAccount = await getWorkspaceSettings();
    expect(newAccount.workspaceRoot).toBeNull();
    expect(newAccount.accountPreferences).toMatchObject({
      pullRequests: { state: "open", sort: "updated", direction: "desc" },
    });
    expect(newAccount.contributionIdentities).toEqual([]);
    const accountBWorkspace = await createWorkspace("Account B", "C:\\Accounts\\B");
    await updateWorkspaceRecentContext(accountBWorkspace.settings.activeWorkspaceId!, {
      version: 1,
      route: "/repos/account-b/files?ref=main",
    });

    fallback.setFallbackGitHubBindingStatusForTests(binding(accountA));
    const restoredA = await getWorkspaceSettings();
    expect(restoredA.workspaceRoot).toBe("C:\\Accounts\\A");
    expect(restoredA.activeWorkspace?.recentContext?.route).toBe("/repos/account-a/issues/1");
    expect(restoredA.accountPreferences).toEqual(preferences());
    expect(restoredA.contributionIdentities).toEqual([{ name: "Account A", email: "a@example.com" }]);

    await unbindGitHub();
    expect((await getWorkspaceSettings()).workspaceRoot).toBeNull();
    await createWorkspace("Anonymous", "C:\\Accounts\\Anonymous");

    fallback.setFallbackGitHubBindingStatusForTests(binding("account-b"));
    expect((await getWorkspaceSettings()).workspaceRoot).toBe("C:\\Accounts\\B");
    expect((await getWorkspaceSettings()).activeWorkspace?.recentContext?.route)
      .toBe("/repos/account-b/files?ref=main");
    await unbindGitHub();
    expect((await getWorkspaceSettings()).workspaceRoot).toBe("C:\\Accounts\\Anonymous");
  });

  it("upgrades a legacy binding to the complete scope set and persists editable profile fields", async () => {
    const request = {
      name: "Lilia User",
      email: "lilia@example.com",
      bio: "Maintainer",
      company: "Lilia",
      location: "Shanghai",
      blog: "https://example.com",
      twitterUsername: "lilia_user",
      hireable: true,
    };

    fallback.setFallbackGitHubBindingStatusForTests(binding("legacy-account", ["repo", "read:user"]));
    await expect(updateGitHubAccountProfile(request)).rejects.toThrow();
    await startGitHubDeviceFlow();
    await pollGitHubDeviceFlow("device-code");
    expect((await getGitHubBindingStatus()).binding?.scopes).toEqual(REQUIRED_GITHUB_AUTH_SCOPES);
    expect(await updateGitHubAccountProfile(request)).toMatchObject(request);
    expect(await getGitHubAccountProfile()).toMatchObject(request);

    fallback.setFallbackGitHubBindingStatusForTests(binding("another-account", ["repo", "user"]));
    expect(await getGitHubAccountProfile()).toMatchObject({
      login: "another-account",
      name: null,
      email: null,
    });
  });

  it("returns the active account's public profile README", async () => {
    fallback.setFallbackGitHubBindingStatusForTests(binding("Profile-Owner"));

    const readme = await getGitHubAccountReadme();

    expect(readme).toMatchObject({
      status: "ready",
      sourceRepo: "Profile-Owner/Profile-Owner",
      htmlUrl: "https://github.com/Profile-Owner/Profile-Owner/blob/main/README.md",
      error: null,
      preview: {
        path: "README.md",
        previewKind: "markdown",
      },
    });
    expect(readme.preview?.content).toContain("Profile-Owner");
  });
});

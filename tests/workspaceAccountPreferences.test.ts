import { beforeEach, describe, expect, it } from "vitest";
import {
  getGitHubAccountProfile,
  getGitHubBindingStatus,
  getWorkspaceSettings,
  pollGitHubDeviceFlow,
  setContributionIdentities,
  setWorkspaceRoot,
  startGitHubDeviceFlow,
  unbindGitHub,
  updateAccountPreferences,
  updateGitHubAccountProfile,
  workspaceFallbackForTests,
} from "../src/services/workspace";
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

function preferences(defaultWorkspaceRoot: string): AccountPreferences {
  return {
    defaultWorkspaceRoot,
    repositoryScope: { kind: "organization", login: "lilia-org" },
    repositorySort: { key: "name", direction: "asc" },
    issues: { state: "all", sort: "comments", direction: "asc" },
    pullRequests: { state: "merged", sort: "updated", direction: "desc" },
    actions: { state: "completed", sort: "run-number", direction: "asc" },
  };
}

describe("workspace account preferences fallback", () => {
  beforeEach(async () => {
    fallback = await workspaceFallbackForTests();
  });

  it("keeps the complete workspace profile isolated across bound and anonymous accounts", async () => {
    const accountA = (await getGitHubBindingStatus()).binding!.login;
    await updateAccountPreferences(preferences("C:\\Accounts\\A"));
    await setContributionIdentities([{ name: "Account A", email: "a@example.com" }]);

    fallback.setFallbackGitHubBindingStatusForTests(binding("account-b"));
    const newAccount = await getWorkspaceSettings();
    expect(newAccount.workspaceRoot).toBeNull();
    expect(newAccount.accountPreferences).toMatchObject({
      defaultWorkspaceRoot: null,
      pullRequests: { state: "open", sort: "updated", direction: "desc" },
    });
    expect(newAccount.contributionIdentities).toEqual([]);
    await setWorkspaceRoot("C:\\Accounts\\B");

    fallback.setFallbackGitHubBindingStatusForTests(binding(accountA));
    const restoredA = await getWorkspaceSettings();
    expect(restoredA.workspaceRoot).toBe("C:\\Accounts\\A");
    expect(restoredA.accountPreferences).toEqual(preferences("C:\\Accounts\\A"));
    expect(restoredA.contributionIdentities).toEqual([{ name: "Account A", email: "a@example.com" }]);

    await unbindGitHub();
    expect((await getWorkspaceSettings()).workspaceRoot).toBeNull();
    await setWorkspaceRoot("C:\\Accounts\\Anonymous");

    fallback.setFallbackGitHubBindingStatusForTests(binding("account-b"));
    expect((await getWorkspaceSettings()).workspaceRoot).toBe("C:\\Accounts\\B");
    await unbindGitHub();
    expect((await getWorkspaceSettings()).workspaceRoot).toBe("C:\\Accounts\\Anonymous");
  });

  it("grants profile write scope on demand and persists editable profile fields per account", async () => {
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

    await expect(updateGitHubAccountProfile(request)).rejects.toThrow();
    await startGitHubDeviceFlow("profileWrite");
    await pollGitHubDeviceFlow("device-code-profileWrite");
    expect((await getGitHubBindingStatus()).binding?.scopes).toContain("user");
    expect(await updateGitHubAccountProfile(request)).toMatchObject(request);
    expect(await getGitHubAccountProfile()).toMatchObject(request);

    fallback.setFallbackGitHubBindingStatusForTests(binding("another-account", ["repo", "user"]));
    expect(await getGitHubAccountProfile()).toMatchObject({
      login: "another-account",
      name: null,
      email: null,
    });
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { workspaceFallbackForTests } from "../src/services/workspace";
import type {
  GitHubBindingStatus,
  GitHubRepoSummary,
} from "../src/services/workspace";

type WorkspaceFallback = Awaited<ReturnType<typeof workspaceFallbackForTests>>;
let fallback: WorkspaceFallback;

function binding(scopes: string[]): GitHubBindingStatus {
  return {
    state: "bound",
    clientIdConfigured: true,
    clientIdSource: "test",
    binding: {
      login: "lilia-member",
      avatarUrl: null,
      boundAt: 1,
      scopes,
      clientIdSource: "test",
    },
  };
}

function repository(name: string, privateRepository: boolean): GitHubRepoSummary {
  return {
    id: privateRepository ? 2 : 1,
    name,
    fullName: `lilia-org/${name}`,
    ownerLogin: "lilia-org",
    private: privateRepository,
    disabled: false,
    archived: false,
    description: null,
    defaultBranch: "main",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-15T00:00:00Z",
    cloneUrl: `https://github.com/lilia-org/${name}.git`,
    htmlUrl: `https://github.com/lilia-org/${name}`,
    fork: false,
    isTemplate: false,
    language: privateRepository ? "Rust" : "TypeScript",
    topics: [privateRepository ? "internal" : "public"],
    stargazersCount: privateRepository ? 20 : 10,
    forksCount: 3,
    licenseSpdxId: "MIT",
  };
}

describe("organization workspace fallback", () => {
  beforeEach(async () => {
    fallback = await workspaceFallbackForTests();
    fallback.resetWorkspaceFallbacksForTests();
    fallback.setFallbackGitHubRepoPagesForTests([{
      items: [repository("Public", false), repository("Private", true)],
      nextPage: null,
    }]);
  });

  it("keeps private organization data out of the Public view", async () => {
    fallback.setFallbackGitHubBindingStatusForTests(binding(["repo", "read:org"]));

    const publicOverview = await fallback.getGitHubOrganizationOverview("lilia-org", "public");
    expect(publicOverview.effectiveView).toBe("public");
    expect(publicOverview.featured.items.map((repo) => repo.fullName)).toEqual([
      "lilia-org/Public",
    ]);
    expect(publicOverview.members.items).toEqual([]);

    const memberOverview = await fallback.getGitHubOrganizationOverview("lilia-org", "member");
    expect(memberOverview.effectiveView).toBe("member");
    expect(memberOverview.featured.items.map((repo) => repo.fullName)).toEqual([
      "lilia-org/Private",
      "lilia-org/Public",
    ]);
    expect(memberOverview.members.items[0]?.login).toBe("lilia-member");
  });

  it("falls a Member request back to Public without confirmed member access", async () => {
    fallback.setFallbackGitHubBindingStatusForTests(binding(["repo"]));

    const overview = await fallback.getGitHubOrganizationOverview("lilia-org", "member");
    expect(overview.memberViewAvailable).toBe(false);
    expect(overview.effectiveView).toBe("public");
    expect(overview.featured.items.every((repo) => !repo.private)).toBe(true);
    expect(overview.readme.sourceRepo).toBe("lilia-org/.github");
    expect(overview.members.items).toEqual([]);
  });
});

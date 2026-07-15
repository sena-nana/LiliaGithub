import { beforeEach, describe, expect, it } from "vitest";
import {
  getGitHubRepositorySubscription,
  githubErrorCode,
  isGitHubPermissionError,
  listGitHubRepos,
  listGitHubWatchedRepos,
  updateGitHubRepositorySubscription,
  workspaceFallbackForTests,
} from "../src/services/workspace";

type WorkspaceFallback = Awaited<ReturnType<typeof workspaceFallbackForTests>>;
let fallback: WorkspaceFallback;

describe("GitHub repository subscription fallback", () => {
  beforeEach(async () => {
    fallback = await workspaceFallbackForTests();
  });

  it("drives watched pages and repository state from the same subscription state", async () => {
    const repositories = (await listGitHubRepos()).items;
    const watchedRepo = repositories[0]!.fullName;
    const otherRepo = repositories[1]!.fullName;
    fallback.setFallbackGitHubRepositorySubscriptionsForTests({
      [watchedRepo]: "watching",
      [otherRepo]: "participating",
    });

    expect((await listGitHubWatchedRepos()).items.map((repo) => repo.fullName)).toEqual([watchedRepo]);
    expect(await getGitHubRepositorySubscription(watchedRepo)).toEqual({ mode: "watching" });

    await updateGitHubRepositorySubscription(watchedRepo, "participating");
    expect((await listGitHubWatchedRepos()).items).toEqual([]);
    expect(await getGitHubRepositorySubscription(watchedRepo)).toEqual({ mode: "participating" });

    await updateGitHubRepositorySubscription(otherRepo, "watching");
    expect((await listGitHubWatchedRepos()).items.map((repo) => repo.fullName)).toEqual([otherRepo]);

    await updateGitHubRepositorySubscription(otherRepo, "ignored");
    expect((await listGitHubWatchedRepos()).items).toEqual([]);
    expect(await getGitHubRepositorySubscription(otherRepo)).toEqual({ mode: "ignored" });
  });

  it("classifies missing notifications scope without matching HTTP text", async () => {
    fallback.setFallbackGitHubBindingStatusForTests({
      state: "bound",
      clientIdConfigured: true,
      clientIdSource: "test",
      binding: {
        login: "scope-limited",
        avatarUrl: null,
        boundAt: 1,
        scopes: ["repo"],
        clientIdSource: "test",
      },
    });

    const error = await listGitHubWatchedRepos().catch((caught) => caught);
    expect(githubErrorCode(error)).toBe("github_notifications_scope_required");
    expect(isGitHubPermissionError(error)).toBe(true);
    expect(isGitHubPermissionError("github_forbidden：操作被拒绝")).toBe(true);
    expect(isGitHubPermissionError("github_org_sso_required：需要 SSO 授权")).toBe(true);
    expect(isGitHubPermissionError(new Error("HTTP 403"))).toBe(false);
  });
});

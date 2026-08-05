import { describe, expect, it } from "vitest";
import {
  createWorkspaceClientCache,
  GITHUB_PROJECT_CACHE_LIMITS,
  githubProjectRepoKey,
} from "../src/services/workspace/cache";
import type { RepoFilePreview } from "../src/services/workspace/types";

function preview(path: string, content: string): RepoFilePreview {
  return {
    path,
    name: path,
    previewKind: "text",
    content,
    size: content.length,
    truncated: false,
  };
}

describe("GitHub project client cache LRU", () => {
  it("keeps eight recently used repositories and evicts the oldest", () => {
    const cache = createWorkspaceClientCache();
    for (let index = 0; index < 20; index += 1) {
      cache.githubProjectRepoCache(`owner/repo-${index}`);
    }

    cache.githubProjectRepoCache("owner/repo-12");
    cache.githubProjectRepoCache("owner/repo-next");

    expect(cache.githubProjectCache).toHaveLength(GITHUB_PROJECT_CACHE_LIMITS.repos);
    expect(cache.githubProjectCache.has(githubProjectRepoKey("owner/repo-11"))).toBe(false);
    expect(cache.githubProjectCache.has(githubProjectRepoKey("owner/repo-12"))).toBe(true);
    expect(cache.githubProjectCache.has(githubProjectRepoKey("owner/repo-13"))).toBe(false);
    expect(cache.githubProjectCache.has(githubProjectRepoKey("owner/repo-19"))).toBe(true);
    expect(cache.githubProjectCache.has(githubProjectRepoKey("owner/repo-next"))).toBe(true);
  });

  it("keeps twelve recently used query keys in each collection", () => {
    const cache = createWorkspaceClientCache().githubProjectRepoCache("owner/query-cache");
    for (let index = 0; index < GITHUB_PROJECT_CACHE_LIMITS.collectionEntries; index += 1) {
      cache.issues[`query-${index}`] = [];
    }

    expect(cache.issues["query-0"]).toEqual([]);
    cache.issues["query-next"] = [];

    expect(Object.keys(cache.issues)).toHaveLength(GITHUB_PROJECT_CACHE_LIMITS.collectionEntries);
    expect("query-0" in cache.issues).toBe(true);
    expect("query-1" in cache.issues).toBe(false);
    expect("query-next" in cache.issues).toBe(true);
  });

  it("shares the heavy byte budget across previews, artifact previews, and job logs", () => {
    const cache = createWorkspaceClientCache().githubProjectRepoCache("owner/heavy-cache");
    const sixMiB = "x".repeat(6 * 1024 * 1024);

    cache.filePreviews["README.md"] = preview("README.md", sixMiB);
    cache.workflowArtifactPreviews["1:artifact.txt"] = preview("artifact.txt", sixMiB);
    cache.workflowJobLogs[42] = { jobId: 42, content: sixMiB };

    expect("README.md" in cache.filePreviews).toBe(false);
    expect("1:artifact.txt" in cache.workflowArtifactPreviews).toBe(true);
    expect("42" in cache.workflowJobLogs).toBe(true);
  });

  it("keeps pending request deduplication independent from repository eviction", async () => {
    const cache = createWorkspaceClientCache();
    let resolveRequest!: (value: string) => void;
    const pending = cache.cachedWorkspaceRead("test_project_cache", { key: 1 }, () =>
      new Promise<string>((resolve) => {
        resolveRequest = resolve;
      })
    );

    for (let index = 0; index <= GITHUB_PROJECT_CACHE_LIMITS.repos; index += 1) {
      cache.githubProjectRepoCache(`owner/pending-${index}`);
    }
    const deduplicated = cache.cachedWorkspaceRead("test_project_cache", { key: 1 }, () =>
      Promise.resolve("unexpected")
    );
    resolveRequest("done");

    await expect(deduplicated).resolves.toBe("done");
    expect(deduplicated).toBe(pending);
  });
});

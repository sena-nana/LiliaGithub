import { describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import { createLiliaGithubApp } from "../src/createLiliaGithubApp";
import { createWorkspaceStoreFixture } from "./fixtures/createWorkspaceStoreFixture";
import { repoSummary } from "./fixtures/workspace";

describe("workspace store isolation", () => {
  it("keeps state and in-flight repository resources isolated between stores", async () => {
    const firstRefresh = Promise.withResolvers<ReturnType<typeof repoSummary>[]>();
    const firstService = {
      listManagedRepos: vi.fn(() => firstRefresh.promise),
    };
    const secondService = {
      listManagedRepos: vi.fn(async () => [repoSummary("repo-b")]),
    };
    const first = createWorkspaceStoreFixture(firstService);
    const second = createWorkspaceStoreFixture(secondService);

    first.stateFeature.upsertRepo(repoSummary("repo-local-a"));
    expect(second.state.repos).toEqual([]);

    const firstPending = first.refreshRepos();
    await second.refreshRepos();
    expect(second.state.repos.map((repo) => repo.id)).toEqual(["repo-b"]);
    expect(first.state.repos.map((repo) => repo.id)).toEqual(["repo-local-a"]);

    firstRefresh.resolve([repoSummary("repo-a")]);
    await firstPending;
    expect(first.state.repos.map((repo) => repo.id)).toEqual(["repo-a"]);
    expect(second.state.repos.map((repo) => repo.id)).toEqual(["repo-b"]);
  });

  it("keeps route navigation inside the current session and isolates explicit session changes", async () => {
    const first = createLiliaGithubApp({ history: createMemoryHistory() });
    const second = createLiliaGithubApp({ history: createMemoryHistory() });

    expect(first.workspace).not.toBe(second.workspace);
    expect(first.workspace.state).not.toBe(second.workspace.state);
    expect(first.workspace.repositories).not.toBe(second.workspace.repositories);
    expect(first.sessionContext).not.toBe(second.sessionContext);

    await first.router.push("/settings");
    expect(first.sessionContext.revision).toBe(0);
    expect(second.sessionContext.revision).toBe(0);

    first.sessionContext.invalidate();
    expect(first.sessionContext.revision).toBe(1);
    expect(second.sessionContext.revision).toBe(0);
  });
});

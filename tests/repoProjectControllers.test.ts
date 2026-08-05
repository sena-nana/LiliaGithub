import { describe, expect, it, vi } from "vitest";
import { useRepoIssuesController } from "../src/components/repo/controllers/useRepoProjectControllers";
import { createWorkspaceStoreFixture } from "./fixtures/createWorkspaceStoreFixture";
import type { GitHubIssue } from "../src/services/workspace/types";

function issue(number: number, title: string): GitHubIssue {
  return {
    number,
    title,
    state: "open",
    body: null,
    labels: [],
    assignees: [],
    htmlUrl: `https://github.com/owner/repo/issues/${number}`,
    comments: 0,
    createdAt: "2026-08-05T00:00:00Z",
    updatedAt: "2026-08-05T00:00:00Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("repo project feature controllers", () => {
  it("commits only the latest repo key when requests resolve out of order", async () => {
    const first = deferred<GitHubIssue[]>();
    const second = deferred<GitHubIssue[]>();
    const listGitHubIssues = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const workspace = createWorkspaceStoreFixture({ listGitHubIssues });
    let repo = "owner/old";
    const controller = useRepoIssuesController({
      workspace,
      repoFullName: () => repo,
      available: () => true,
      remoteDeleted: () => false,
      options: () => ({ state: "open" }),
      focus: () => null,
    });

    const oldLoad = controller.load();
    repo = "owner/new";
    const newLoad = controller.load();
    second.resolve([issue(2, "new")]);
    await newLoad;
    first.resolve([issue(1, "old")]);
    await oldLoad;

    expect(controller.items.value.map((item) => item.title)).toEqual(["new"]);
  });

  it("keeps current data and exposes an error when refresh fails", async () => {
    const listGitHubIssues = vi.fn()
      .mockResolvedValueOnce([issue(1, "stable")])
      .mockRejectedValueOnce(new Error("offline"));
    const workspace = createWorkspaceStoreFixture({ listGitHubIssues });
    const controller = useRepoIssuesController({
      workspace,
      repoFullName: () => "owner/repo",
      available: () => true,
      remoteDeleted: () => false,
      options: () => ({ state: "open" }),
      focus: () => null,
    });

    await controller.load();
    await controller.load(true);

    expect(controller.items.value.map((item) => item.title)).toEqual(["stable"]);
    expect(controller.error.value).toContain("offline");
  });
});

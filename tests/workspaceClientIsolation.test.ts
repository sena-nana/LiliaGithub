import { describe, expect, it, vi } from "vitest";
import { createWorkspaceClient } from "../src/services/workspace/client";
import { WorkspaceCommandError } from "../src/services/workspace/errors";
import { createWorkspaceHandlerTransport } from "../src/services/workspace/transport";
import type { GitHubRepoOwner } from "../src/services/workspace/types";

function owner(login: string): GitHubRepoOwner {
  return {
    login,
    kind: "user",
    avatarUrl: null,
    membershipVisible: true,
    membershipComplete: true,
    repositoryAccessVisible: true,
    source: "authenticated_user",
  };
}

describe("workspace client isolation", () => {
  it("keeps cache and in-flight requests private to each client", async () => {
    const firstRequest = Promise.withResolvers<GitHubRepoOwner[]>();
    const firstHandler = vi.fn(() => firstRequest.promise);
    const secondHandler = vi.fn(async () => [owner("second")]);
    const firstRepos = vi.fn(async ({ scope }: { scope: { kind: "organization"; login: string } }) => ({
      items: [], nextPage: null, scope,
    }));
    const secondRepos = vi.fn(async ({ scope }: { scope: { kind: "organization"; login: string } }) => ({
      items: [], nextPage: null, scope,
    }));
    const first = createWorkspaceClient(createWorkspaceHandlerTransport({
      github_get_binding_status: async () => ({
        state: "bound", clientIdConfigured: true, clientIdSource: "bundled",
        binding: { login: "first", avatarUrl: null, boundAt: 1, scopes: ["repo"], clientIdSource: "bundled" },
      }),
      github_list_repo_owners: firstHandler,
      github_list_repos: firstRepos,
    }));
    const second = createWorkspaceClient(createWorkspaceHandlerTransport({
      github_get_binding_status: async () => ({
        state: "bound", clientIdConfigured: true, clientIdSource: "bundled",
        binding: { login: "second", avatarUrl: null, boundAt: 2, scopes: ["repo"], clientIdSource: "bundled" },
      }),
      github_list_repo_owners: secondHandler,
      github_list_repos: secondRepos,
    }));

    await Promise.all([first.getGitHubBindingStatus(), second.getGitHubBindingStatus()]);
    const firstPending = first.listGitHubRepoOwners();
    const firstDeduplicated = first.listGitHubRepoOwners();
    await expect(second.listGitHubRepoOwners()).resolves.toEqual([owner("second")]);

    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).toHaveBeenCalledTimes(1);
    firstRequest.resolve([owner("first")]);
    await expect(Promise.all([firstPending, firstDeduplicated])).resolves.toEqual([
      [owner("first")],
      [owner("first")],
    ]);

    await expect(first.listGitHubRepoOwners()).resolves.toEqual([owner("first")]);
    await expect(second.listGitHubRepoOwners()).resolves.toEqual([owner("second")]);
    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).toHaveBeenCalledTimes(1);

    const scope = { kind: "organization" as const, login: "shared" };
    await Promise.all([
      first.listGitHubRepos(scope),
      first.listGitHubRepos(scope),
      second.listGitHubRepos(scope),
      second.listGitHubRepos(scope),
    ]);
    expect(firstRepos).toHaveBeenCalledTimes(1);
    expect(secondRepos).toHaveBeenCalledTimes(1);
  });

  it("normalizes errors from raw and structured transports to the same wire shape", async () => {
    const payload = {
      code: "unknown",
      category: "network" as const,
      message: "network timed out",
      retryable: true,
    };
    const raw = createWorkspaceClient(createWorkspaceHandlerTransport({
      workspace_get_settings: async () => {
        throw new Error(payload.message);
      },
    }));
    const structured = createWorkspaceClient(createWorkspaceHandlerTransport({
      workspace_get_settings: async () => {
        throw new WorkspaceCommandError(payload);
      },
    }));

    const rawError = await raw.getWorkspaceSettings().catch((error: unknown) => error);
    const structuredError = await structured.getWorkspaceSettings().catch((error: unknown) => error);

    expect(rawError).toBeInstanceOf(WorkspaceCommandError);
    expect(structuredError).toBeInstanceOf(WorkspaceCommandError);
    expect({ ...rawError }).toEqual({ ...structuredError });
    expect(rawError).toMatchObject(payload);
  });
});

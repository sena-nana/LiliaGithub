import { describe, expect, it } from "vitest";
import { resolveRepoContext } from "../src/utils/repoContext";
import { repoSummary, workspaceSettings } from "./fixtures/workspace";

describe("repoContext", () => {
  it("marks a local non-GitHub repo as local-only", () => {
    const context = resolveRepoContext({
      repoId: "PlainRepo",
      repoSummary: repoSummary("PlainRepo", {
        remoteUrl: null,
        githubFullName: null,
      }),
      settings: workspaceSettings(["PlainRepo"]),
      githubAuthorized: true,
    });

    expect(context.tags).toEqual(expect.arrayContaining(["local"]));
    expect(context.tags).not.toContain("github");
    expect(context.preferredProvider).toBe("local");
    expect(context.capabilities.changes).toMatchObject({ available: true, provider: "local" });
    expect(context.capabilities.commit).toMatchObject({ available: true, provider: "local" });
    expect(context.capabilities.issues).toMatchObject({ available: false, provider: "unavailable" });
    expect(context.capabilities.issues.reason).toContain("没有 GitHub 远端");
  });

  it("keeps local operations local and GitHub operations on GitHub when authorized", () => {
    const settings = workspaceSettings();
    settings.managedRepoIds = ["LiliaGithub"];
    const context = resolveRepoContext({
      repoId: "LiliaGithub",
      repoSummary: repoSummary("LiliaGithub"),
      settings,
      githubAuthorized: true,
    });

    expect(context.tags).toEqual(expect.arrayContaining(["local", "managed", "github", "github-authorized"]));
    expect(context.localRepoId).toBe("LiliaGithub");
    expect(context.githubFullName).toBe("sena-nana/LiliaGithub");
    expect(context.capabilities.history).toMatchObject({ available: true, provider: "local-first" });
    expect(context.capabilities.branchBrowse).toMatchObject({ available: true, provider: "local-first" });
    expect(context.capabilities.issues).toMatchObject({ available: true, provider: "github" });
    expect(context.capabilities.settings).toMatchObject({ available: true, provider: "github" });
  });

  it("leaves local operations available when GitHub is not authorized", () => {
    const context = resolveRepoContext({
      repoId: "LiliaGithub",
      repoSummary: repoSummary("LiliaGithub"),
      settings: workspaceSettings(),
      githubAuthorized: false,
    });

    expect(context.tags).toEqual(expect.arrayContaining(["local", "github", "github-anonymous"]));
    expect(context.capabilities.commit).toMatchObject({ available: true, provider: "local" });
    expect(context.capabilities.stash).toMatchObject({ available: true, provider: "local" });
    expect(context.capabilities.issues).toMatchObject({ available: false, provider: "unavailable" });
    expect(context.capabilities.issues.reason).toContain("GitHub 未授权");
  });

  it("treats github-prefixed routes as remote-only GitHub repos", () => {
    const context = resolveRepoContext({
      repoId: "github:sena-nana/RemoteRepo",
      settings: workspaceSettings(),
      githubAuthorized: true,
    });

    expect(context.tags).toEqual(expect.arrayContaining(["github", "github-remote", "github-authorized"]));
    expect(context.tags).not.toContain("local");
    expect(context.localRepoId).toBeUndefined();
    expect(context.githubFullName).toBe("sena-nana/RemoteRepo");
    expect(context.preferredProvider).toBe("github");
    expect(context.capabilities.changes).toMatchObject({ available: false, provider: "unavailable" });
    expect(context.capabilities.launch).toMatchObject({ available: false, provider: "unavailable" });
    expect(context.capabilities.readme).toMatchObject({ available: true, provider: "github" });
    expect(context.capabilities.pulls).toMatchObject({ available: true, provider: "github" });
  });

  it("blocks GitHub permission content for system-git local repos without disabling local operations", () => {
    const settings = workspaceSettings();
    settings.systemGitRepoIds = ["LiliaGithub"];
    const context = resolveRepoContext({
      repoId: "LiliaGithub",
      repoSummary: repoSummary("LiliaGithub"),
      settings,
      githubAuthorized: true,
    });

    expect(context.tags).toEqual(expect.arrayContaining(["local", "github", "github-authorized", "system-git"]));
    expect(context.capabilities.changes).toMatchObject({ available: true, provider: "local" });
    expect(context.capabilities.branch).toMatchObject({ available: true, provider: "local" });
    expect(context.capabilities.actions).toMatchObject({ available: false, provider: "unavailable" });
    expect(context.capabilities.actions.reason).toContain("系统 Git");
  });
});

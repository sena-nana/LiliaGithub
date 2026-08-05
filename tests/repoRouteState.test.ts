import { describe, expect, it } from "vitest";
import { createMemoryHistory } from "vue-router";
import { createLiliaGithubRouter } from "../src/router";
import { RepoRouteStateCodec } from "../src/utils/repoRouteState";
import { createSessionContext } from "../src/composables/sessionContext";

describe("RepoRouteStateCodec", () => {
  it("parses only focus and create state owned by the active project section", async () => {
    const router = createLiliaGithubRouter(createSessionContext(), createMemoryHistory());
    await router.push("/repos/LiliaGithub?projectTab=release&create=release&issue=4&releaseTag=v1.0.0");

    expect(RepoRouteStateCodec.parse(router.currentRoute.value)).toMatchObject({
      repoId: "LiliaGithub",
      tab: "repo",
      projectTab: "release",
      create: "release",
      issue: null,
      releaseTag: "v1.0.0",
    });
  });

  it("patches sections atomically without carrying targets or filters across features", () => {
    const query = RepoRouteStateCodec.patch({
      projectTab: "issues",
      issue: "7",
      issueLabels: ["bug"],
      create: "issue",
      unrelated: "kept",
    }, { projectTab: "actions", run: 42, job: 9 });

    expect(query).toEqual({
      projectTab: "actions",
      run: "42",
      job: "9",
      unrelated: "kept",
    });
  });

  it("round-trips project filters through the single codec without changing public query keys", async () => {
    const router = createLiliaGithubRouter(createSessionContext(), createMemoryHistory());
    await router.push(
      "/repos/LiliaGithub?projectTab=pulls&pullState=merged&pullQ=cache&pullLabels=bug&pullLabels=perf&pullReview=approved&pullSort=comments&pr=17",
    );

    const parsed = RepoRouteStateCodec.parse(router.currentRoute.value);
    expect(parsed?.filters.pulls).toEqual({
      state: "merged",
      filters: {
        creator: null,
        assignee: null,
        labels: ["bug", "perf"],
        milestone: null,
        project: null,
        review: "approved",
        sort: "comments",
        direction: "desc",
        query: "cache",
      },
    });

    expect(RepoRouteStateCodec.projectQuery({}, "pulls", {
      pulls: parsed!.filters.pulls,
      pull: parsed!.pull,
    })).toEqual({
      projectTab: "pulls",
      pullState: "merged",
      pullQ: "cache",
      pullLabels: ["bug", "perf"],
      pullSort: "comments",
      pullReview: "approved",
      pr: "17",
    });
  });

  it("normalizes invalid filter values to caller defaults", async () => {
    const router = createLiliaGithubRouter(createSessionContext(), createMemoryHistory());
    await router.push("/repos/LiliaGithub?projectTab=actions&actionState=unknown&actionSort=random&actionDirection=sideways");

    expect(RepoRouteStateCodec.parse(router.currentRoute.value, {
      issues: { state: "closed", sort: "updated", direction: "asc" },
      pulls: { state: "merged", sort: "created", direction: "asc" },
      actions: { state: "completed", sort: "created", direction: "asc" },
    })?.filters.actions).toMatchObject({
      state: "completed",
      filters: { sort: "created", direction: "asc" },
    });
  });

  it("filters transient creation state from persisted recent context", async () => {
    const router = createLiliaGithubRouter(createSessionContext(), createMemoryHistory());
    await router.push("/repos/LiliaGithub?projectTab=release&create=release&releaseTag=v2.0.0");

    expect(RepoRouteStateCodec.recentContextRoute(router, router.currentRoute.value)).toBe(
      "/repos/LiliaGithub?projectTab=release&releaseTag=v2.0.0",
    );
  });
});

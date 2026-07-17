import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import ContextMenuHost from "../src/ui/contextMenuHost";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace } from "../src/composables/useWorkspace";
import { resetWorkspaceStateForTests } from "../src/composables/workspace/state";
import {
  clearGitHubRepoCache,
  resetWorkspaceFallbacksForTests,
  workspaceFallbackForTests,
  type GitHubRepoSummary,
} from "../src/services/workspace";
import {
  HOME_GITHUB_OVERVIEW_SNAPSHOT_REFRESH_MS,
  clearHomeGitHubOverviewSnapshot,
} from "../src/pages/homeOverviewCache";
import Home from "../src/pages/Home.vue";
import { repoSummary } from "./fixtures/workspace";

const STORAGE_KEY = "lilia-github.home.overviewSnapshot.v1";
const SORT_STORAGE_KEY = "lilia-github.home.repoStatusSort.v2:lilia-user";
const repoFullName = "sena-nana/LiliaGithub";
const accountLogin = "lilia-user";

type WorkspaceFallbackForTests = Awaited<ReturnType<typeof workspaceFallbackForTests>>;

let workspaceFallback: WorkspaceFallbackForTests;

function githubRepoSummary(overrides: Partial<GitHubRepoSummary> = {}): GitHubRepoSummary {
  return {
    id: 1,
    name: "LiliaGithub",
    fullName: repoFullName,
    ownerLogin: "sena-nana",
    private: false,
    disabled: false,
    archived: false,
    description: null,
    defaultBranch: "main",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-25T08:00:00Z",
    cloneUrl: "https://github.com/sena-nana/LiliaGithub.git",
    htmlUrl: "https://github.com/sena-nana/LiliaGithub",
    ...overrides,
  };
}

function writeRepoOnlySnapshot(cachedAt = Date.now(), repos: GitHubRepoSummary[] = [githubRepoSummary()]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    schemaVersion: 3,
    accountLogin,
    cachedAt,
    repos,
    nextPage: null,
  }));
}

async function renderHomeFromStoredSnapshot(
  cachedAt = Date.now(),
  repos: GitHubRepoSummary[] = [githubRepoSummary()],
  withContextMenu = false,
) {
  const workspace = useWorkspace();
  await workspace.initialize();
  clearHomeGitHubOverviewSnapshot();
  writeRepoOnlySnapshot(cachedAt, repos);

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        component: Home,
      },
      {
        path: "/repos/:repoId(.*)",
        component: { template: "<div>repo</div>" },
      },
    ],
  });
  await router.push("/");
  await router.isReady();

  const component = withContextMenu
    ? {
        components: { ContextMenuHost, Home },
        template: "<Home /><ContextMenuHost />",
      }
    : Home;

  return {
    ...render(component, {
      global: {
        plugins: [router],
      },
    }),
    router,
  };
}

function repoStatusOrder() {
  return screen.getAllByRole("link")
    .map((element) => element.getAttribute("aria-label"))
    .filter((label): label is string => Boolean(label?.startsWith("打开 sena-nana/")))
    .map((label) => label.replace("打开 ", ""));
}

async function expectRepoStatusOrder(expected: string[]) {
  await screen.findByRole("link", { name: `打开 ${expected[0]!}` });
  await waitFor(() => expect(repoStatusOrder()).toEqual(expected));
}

beforeEach(async () => {
  vi.useRealTimers();
  await resetWorkspaceFallbacksForTests();
  workspaceFallback = await workspaceFallbackForTests();
  const localRepo = repoSummary("LiliaGithub", {
    githubFullName: repoFullName,
    ahead: 0,
    behind: 0,
    conflictCount: 0,
    lastCommitAt: null,
  });
  workspaceFallback.setFallbackRepoOverridesForTests({
    LiliaGithub: localRepo,
  });
  const settings = await workspaceFallback.getWorkspaceSettings();
  workspaceFallback.setFallbackStartupCacheForTests({
    workspaceRoot: settings.workspaceRoot,
    bindingLogin: settings.githubBinding?.login ?? null,
    reposById: {
      LiliaGithub: {
        summary: localRepo,
        cachedAt: Date.now(),
      },
    },
    contributions: null,
  });
  resetWorkspaceStateForTests();
  clearGitHubRepoCache();
  clearHomeGitHubOverviewSnapshot();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Home cold start repository status", () => {
  it("sorts repo status rows from a persisted local preference", async () => {
    const repos = [
      githubRepoSummary({
        id: 101,
        name: "Alpha",
        fullName: "sena-nana/Alpha",
        createdAt: "2026-01-10T00:00:00Z",
        updatedAt: "2026-06-10T00:00:00Z",
      }),
      githubRepoSummary({
        id: 102,
        name: "Beta",
        fullName: "sena-nana/Beta",
        createdAt: "2026-02-10T00:00:00Z",
        updatedAt: "2026-06-20T00:00:00Z",
      }),
      githubRepoSummary({
        id: 103,
        name: "Gamma",
        fullName: "sena-nana/Gamma",
        createdAt: "2026-03-10T00:00:00Z",
        updatedAt: "2026-06-01T00:00:00Z",
      }),
      githubRepoSummary({
        id: 104,
        name: "ZetaArchive",
        fullName: "sena-nana/ZetaArchive",
        archived: true,
        createdAt: "2026-04-10T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      }),
    ];

    const rendered = await renderHomeFromStoredSnapshot(Date.now(), repos, true);

    await expectRepoStatusOrder([
      "sena-nana/Beta",
      "sena-nana/Alpha",
      "sena-nana/Gamma",
      "sena-nana/ZetaArchive",
    ]);

    await fireEvent.click(screen.getByRole("button", { name: /仓库排序：最近更新 新到旧/ }));
    await fireEvent.click(await screen.findByRole("menuitem", { name: "首字母 A-Z" }));

    await expectRepoStatusOrder([
      "sena-nana/Alpha",
      "sena-nana/Beta",
      "sena-nana/Gamma",
      "sena-nana/ZetaArchive",
    ]);

    await fireEvent.click(screen.getByRole("button", { name: /仓库排序：首字母 A-Z/ }));
    await fireEvent.click(await screen.findByRole("menuitem", { name: "首字母 Z-A" }));

    await expectRepoStatusOrder([
      "sena-nana/Gamma",
      "sena-nana/Beta",
      "sena-nana/Alpha",
      "sena-nana/ZetaArchive",
    ]);
    expect(JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) ?? "{}")).toEqual({
      sort: "name",
      direction: "desc",
    });

    rendered.unmount();
    await renderHomeFromStoredSnapshot(Date.now(), repos, true);

    await expectRepoStatusOrder([
      "sena-nana/Gamma",
      "sena-nana/Beta",
      "sena-nana/Alpha",
      "sena-nana/ZetaArchive",
    ]);
  });

});

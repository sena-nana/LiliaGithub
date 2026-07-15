import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Organization from "../src/pages/Organization.vue";
import type { GitHubRepoPage, GitHubRepoSummary } from "../src/services/workspace";
import { repoSummary } from "./fixtures/workspace";

const { listGitHubRepos, workspace } = vi.hoisted(() => ({
  listGitHubRepos: vi.fn(),
  workspace: {
    state: {
      repos: [] as ReturnType<typeof repoSummary>[],
    },
    githubBinding: {
      value: null as null | {
        login: string;
        avatarUrl: string | null;
        scopes: string[];
        boundAt: string;
      },
    },
    rememberRemoteRepo: vi.fn(async () => undefined),
  },
}));

vi.mock("../src/services/workspace", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/services/workspace")>(),
  listGitHubRepos,
}));

vi.mock("../src/composables/useWorkspace", async () => {
  const { reactive, ref } = await vi.importActual<typeof import("vue")>("vue");
  workspace.state = reactive(workspace.state);
  workspace.githubBinding = ref(workspace.githubBinding.value);
  return { useWorkspace: () => workspace };
});

function githubRepository(fullName: string, overrides: Partial<GitHubRepoSummary> = {}): GitHubRepoSummary {
  const [ownerLogin = "", name = fullName] = fullName.split("/");
  return {
    id: 1000 + fullName.length,
    name,
    fullName,
    ownerLogin,
    private: false,
    disabled: false,
    archived: false,
    description: null,
    defaultBranch: "main",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-15T00:00:00Z",
    cloneUrl: `https://github.com/${fullName}.git`,
    htmlUrl: `https://github.com/${fullName}`,
    ...overrides,
  };
}

function page(login: string, items: GitHubRepoSummary[], nextPage: number | null = null): GitHubRepoPage {
  return { items, nextPage, scope: { kind: "organization", login } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

async function renderOrganization(login = "alpha-org") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/organizations/:login", name: "github-organization", component: Organization },
      { path: "/repos/:repoId(.*)", component: { template: "<div>repo</div>" } },
      { path: "/settings", component: { template: "<div>settings</div>" } },
    ],
  });
  await router.push(`/organizations/${login}`);
  await router.isReady();
  return {
    ...render(RouterView, { global: { plugins: [router] } }),
    router,
  };
}

describe("组织仓库页", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspace.state.repos = [];
    workspace.githubBinding.value = {
      login: "octocat",
      avatarUrl: null,
      scopes: ["repo", "read:org"],
      boundAt: "2026-07-15T00:00:00Z",
    };
  });

  it("分页加载、按仓库身份去重并展示真实状态", async () => {
    workspace.state.repos = [repoSummary("local-alpha", { githubFullName: "alpha-org/Alpha" })];
    listGitHubRepos
      .mockResolvedValueOnce(page("alpha-org", [
        githubRepository("alpha-org/Alpha"),
        githubRepository("alpha-org/Private", {
          private: true,
          permissions: { pull: true, push: false, admin: false },
        }),
      ], 2))
      .mockResolvedValueOnce(page("alpha-org", [
        githubRepository("ALPHA-ORG/alpha"),
        githubRepository("alpha-org/Archived", {
          archived: true,
          permissions: { pull: true, push: true, admin: true },
        }),
      ]));

    await renderOrganization();
    const repositories = await screen.findByLabelText("组织仓库");
    expect(within(repositories).getByRole("button", { name: /Alpha.*本地/ })).toBeInTheDocument();
    expect(within(repositories).getByRole("button", { name: /Private.*远程.*私有.*只读/ })).toBeInTheDocument();

    await fireEvent.click(within(repositories).getByRole("button", { name: "加载更多" }));
    await waitFor(() => {
      expect(within(repositories).getByRole("button", { name: /Archived.*已归档.*管理/ })).toBeInTheDocument();
      expect(within(repositories).getAllByRole("button", { name: /^alpha.*本地$/i })).toHaveLength(1);
    });
    expect(listGitHubRepos).toHaveBeenNthCalledWith(1, { kind: "organization", login: "alpha-org" }, 1);
    expect(listGitHubRepos).toHaveBeenNthCalledWith(2, { kind: "organization", login: "alpha-org" }, 2);
  });

  it("本地仓库直接打开，远程仓库先记录快捷入口", async () => {
    workspace.state.repos = [repoSummary("local-alpha", { githubFullName: "alpha-org/Alpha" })];
    listGitHubRepos.mockResolvedValue(page("alpha-org", [
      githubRepository("alpha-org/Alpha"),
      githubRepository("alpha-org/Remote"),
    ]));
    const localView = await renderOrganization();

    await fireEvent.click(await screen.findByRole("button", { name: /Alpha.*本地/ }));
    await waitFor(() => expect(localView.router.currentRoute.value.fullPath).toBe("/repos/local-alpha"));
    expect(workspace.rememberRemoteRepo).not.toHaveBeenCalled();
    localView.unmount();

    const remoteView = await renderOrganization();
    await fireEvent.click(await screen.findByRole("button", { name: /Remote.*远程/ }));
    await waitFor(() => {
      expect(workspace.rememberRemoteRepo).toHaveBeenCalledWith(expect.objectContaining({
        fullName: "alpha-org/Remote",
      }));
      expect(remoteView.router.currentRoute.value.fullPath).toBe("/repos/github%3Aalpha-org%2FRemote");
    });
  });

  it("失败可重试且组织切换会隔离旧响应", async () => {
    listGitHubRepos
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(page("alpha-org", []));
    const view = await renderOrganization();
    await fireEvent.click(await screen.findByRole("button", { name: "重试" }));
    await waitFor(() => expect(listGitHubRepos).toHaveBeenCalledTimes(2));

    const alpha = deferred<GitHubRepoPage>();
    listGitHubRepos
      .mockReset()
      .mockImplementationOnce(() => alpha.promise)
      .mockResolvedValueOnce(page("beta-org", [githubRepository("beta-org/Beta")]));
    await view.router.push("/organizations/pending-org");
    await waitFor(() => {
      expect(listGitHubRepos).toHaveBeenCalledWith(
        { kind: "organization", login: "pending-org" },
        1,
      );
    });
    await view.router.push("/organizations/beta-org");
    expect(await screen.findByRole("button", { name: /Beta.*远程/ })).toBeInTheDocument();

    alpha.resolve(page("pending-org", [githubRepository("pending-org/Stale")]));
    await Promise.resolve();
    expect(screen.queryByRole("button", { name: /Stale/ })).toBeNull();
  });

  it("未绑定时不发请求并进入账户设置", async () => {
    workspace.githubBinding.value = null;
    const view = await renderOrganization();
    await fireEvent.click(screen.getByRole("link", { name: "前往账户设置" }));
    await waitFor(() => expect(view.router.currentRoute.value.fullPath).toBe("/settings?tab=account"));
    expect(listGitHubRepos).not.toHaveBeenCalled();
  });
});

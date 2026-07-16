import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Organization from "../src/pages/Organization.vue";
import type {
  GitHubOrganizationOverview,
  GitHubOrganizationProfile,
  GitHubRepoSummary,
} from "../src/services/workspace";
import { repoSummary } from "./fixtures/workspace";

const {
  getGitHubOrganizationOverview,
  getGitHubOrganizationProfile,
  workspace,
} = vi.hoisted(() => ({
  getGitHubOrganizationOverview: vi.fn(),
  getGitHubOrganizationProfile: vi.fn(),
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
    openUrl: vi.fn(async () => undefined),
  },
}));

vi.mock("../src/services/workspace", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/services/workspace")>(),
  getGitHubOrganizationOverview,
  getGitHubOrganizationProfile,
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

function organizationProfile(login = "alpha-org", overrides: Partial<GitHubOrganizationProfile> = {}): GitHubOrganizationProfile {
  return {
    login,
    name: "Alpha Org",
    avatarUrl: "https://avatars.githubusercontent.com/u/1",
    description: "面向开发者的工具",
    htmlUrl: `https://github.com/${login}`,
    location: "Shanghai",
    websiteUrl: "https://alpha.example.com",
    email: "hello@alpha.example.com",
    twitterUsername: null,
    followers: 1200,
    publicRepoCount: 24,
    totalRepoCount: 30,
    isVerified: true,
    ...overrides,
  };
}

function organizationOverview(
  overrides: Partial<GitHubOrganizationOverview> = {},
): GitHubOrganizationOverview {
  return {
    effectiveView: "member",
    memberViewAvailable: true,
    readme: {
      status: "ready",
      preview: {
        path: "profile/README.md",
        name: "README.md",
        previewKind: "markdown",
        content: "# Alpha\n\n[指南](docs/guide.md)<script>alert('unsafe')</script>",
        images: {},
        size: 72,
        truncated: false,
      },
      sourceRepo: "alpha-org/.github-private",
      htmlUrl: "https://github.com/alpha-org/.github-private/blob/main/profile/README.md",
      error: null,
    },
    featured: {
      status: "ready",
      source: "pinned",
      items: [githubRepository("alpha-org/Featured", { stargazersCount: 18 })],
      error: null,
    },
    recent: {
      status: "ready",
      items: [githubRepository("alpha-org/Recent")],
      error: null,
    },
    members: {
      status: "ready",
      items: [{
        login: "octocat",
        name: "Octo Cat",
        avatarUrl: "https://avatars.githubusercontent.com/u/2",
        htmlUrl: "https://github.com/octocat",
      }],
      totalCount: 1,
      error: null,
    },
    ...overrides,
  };
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

async function renderOrganization(path = "/organizations/alpha-org") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/organizations/:login", name: "github-organization", component: Organization },
      { path: "/repos/:repoId(.*)", component: { template: "<div>repo</div>" } },
      { path: "/settings", component: { template: "<div>settings</div>" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  return {
    ...render(RouterView, { global: { plugins: [router] } }),
    router,
  };
}

describe("GitHub 风格组织页", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspace.state.repos = [];
    workspace.githubBinding.value = {
      login: "octocat",
      avatarUrl: null,
      scopes: ["repo", "read:org"],
      boundAt: "2026-07-15T00:00:00Z",
    };
    getGitHubOrganizationProfile.mockResolvedValue(organizationProfile());
    getGitHubOrganizationOverview.mockResolvedValue(organizationOverview());
  });

  it("展示真实组织 Overview、安全 README，并在 Public 与 Member 视图间切换", async () => {
    getGitHubOrganizationOverview
      .mockResolvedValueOnce(organizationOverview())
      .mockResolvedValueOnce(organizationOverview({ effectiveView: "public" }));
    const view = await renderOrganization();

    const githubProfileButton = await screen.findByRole("button", { name: "在 GitHub 查看" });
    await fireEvent.click(githubProfileButton);
    expect(workspace.openUrl).toHaveBeenCalledWith("https://github.com/alpha-org");
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeInTheDocument();
    expect(view.container.querySelector("script")).toBeNull();
    expect(screen.getByRole("button", { name: /Featured/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Recent/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Octo Cat/ })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "组织页面" })).toBeNull();
    expect(getGitHubOrganizationOverview).toHaveBeenNthCalledWith(1, "alpha-org", "member");

    await fireEvent.click(screen.getByRole("link", { name: "指南" }));
    const linkToolbar = await screen.findByRole("toolbar", { name: "链接操作" });
    await fireEvent.click(within(linkToolbar).getByRole("button", { name: "打开" }));
    expect(workspace.openUrl).toHaveBeenCalledWith(
      "https://github.com/alpha-org/.github-private/blob/main/profile/docs/guide.md",
    );

    await fireEvent.click(screen.getByRole("button", { name: "Public" }));
    await waitFor(() => expect(getGitHubOrganizationOverview).toHaveBeenNthCalledWith(2, "alpha-org", "public"));
    expect(screen.getByRole("button", { name: "Public" })).toHaveClass("is-active");

    await fireEvent.click(screen.getByRole("button", { name: /Octo Cat/ }));
    expect(workspace.openUrl).toHaveBeenLastCalledWith("https://github.com/octocat");

    await fireEvent.click(screen.getByRole("button", { name: /Featured/ }));
    await waitFor(() => expect(view.router.currentRoute.value.fullPath).toBe("/repos/github%3Aalpha-org%2FFeatured"));
    expect(workspace.rememberRemoteRepo).toHaveBeenCalledWith(expect.objectContaining({ fullName: "alpha-org/Featured" }));
  });

  it("Overview 各区块独立呈现不可用和空状态，且不泄漏技术错误", async () => {
    getGitHubOrganizationOverview.mockResolvedValue(organizationOverview({
      memberViewAvailable: false,
      effectiveView: "public",
      readme: { status: "unavailable", preview: null, sourceRepo: null, htmlUrl: null, error: "GraphQL 502" },
      featured: { status: "empty", source: null, items: [], error: null },
      recent: { status: "empty", items: [], error: null },
      members: { status: "unavailable", items: [], totalCount: 0, error: "HTTP 403" },
    }));
    await renderOrganization();

    expect(await screen.findByText("暂时无法读取组织 README。")).toBeInTheDocument();
    expect(screen.getByText("该组织暂无可展示的精选仓库。")).toBeInTheDocument();
    expect(screen.getByText("暂无近期仓库。")).toBeInTheDocument();
    expect(screen.getByText("暂时无法读取成员。")).toBeInTheDocument();
    expect(screen.queryByText(/GraphQL|HTTP 403/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Member" })).toBeNull();
  });

  it("组织切换隔离旧组织资料响应", async () => {
    const staleProfile = deferred<GitHubOrganizationProfile>();
    getGitHubOrganizationProfile
      .mockImplementationOnce(() => staleProfile.promise)
      .mockResolvedValueOnce(organizationProfile("beta-org", { name: "Beta Org" }));
    const view = await renderOrganization();

    await view.router.push("/organizations/beta-org");
    const githubProfileButton = await screen.findByRole("button", { name: "在 GitHub 查看" });
    await fireEvent.click(githubProfileButton);
    expect(workspace.openUrl).toHaveBeenLastCalledWith("https://github.com/beta-org");
    staleProfile.resolve(organizationProfile("alpha-org", { name: "Stale Org" }));
    await Promise.resolve();
    await fireEvent.click(githubProfileButton);
    expect(workspace.openUrl).toHaveBeenLastCalledWith("https://github.com/beta-org");
  });

  it("未绑定时不发请求并进入账户设置", async () => {
    workspace.githubBinding.value = null;
    const view = await renderOrganization();
    await fireEvent.click(screen.getByRole("link", { name: "前往账户设置" }));
    await waitFor(() => expect(view.router.currentRoute.value.fullPath).toBe("/settings?tab=account"));
    expect(getGitHubOrganizationProfile).not.toHaveBeenCalled();
    expect(getGitHubOrganizationOverview).not.toHaveBeenCalled();
  });
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateSessionContextSnapshot, resetSessionContextForTests } from "../src/composables/sessionContext";
import type { GitHubRepoOwner } from "../src/services/workspace";
import { liliaContextMenuPlugin } from "./helpers/liliaContextMenu";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const binding = {
  login: "octocat",
  avatarUrl: null as string | null,
  boundAt: 1_780_000_000_000,
  scopes: ["repo", "read:org"],
  clientIdSource: "bundled",
};

const { workspace } = vi.hoisted(() => ({
  workspace: {
    state: {} as Record<string, unknown>,
    githubBinding: { value: null as null | typeof binding },
    isAuthorized: { value: true },
    workspaceRoot: { value: "/tmp/workspace" as string | null },
    activeWorkspace: { value: null as null | Record<string, unknown> },
    workspaceCatalog: { value: [] as Record<string, unknown>[] },
    switchingWorkspace: { value: false },
    contextRevision: { value: 1 },
    hasAvailableWorkspaceRoot: { value: true },
    forgetRemoteRepo: vi.fn(async () => undefined),
    setLocalRepoFavorite: vi.fn(async () => undefined),
    setRemoteRepoFavorite: vi.fn(async () => undefined),
    createRepoGroup: vi.fn(async () => undefined),
    renameRepoGroup: vi.fn(async () => undefined),
    deleteRepoGroup: vi.fn(async () => undefined),
    moveRepoToGroup: vi.fn(async () => undefined),
    hideRepo: vi.fn(async () => undefined),
    openUrl: vi.fn(async () => undefined),
    getAccountRepositoryOwners: vi.fn(),
  },
}));

vi.mock("../src/composables/useWorkspace", async () => {
  const { reactive, ref } = await vi.importActual<typeof import("vue")>("vue");
  workspace.state = reactive({
    settings: {
      workspaceRoot: "/tmp/workspace",
      githubBinding: binding,
      accountPreferences: {
        repositoryScope: { kind: "all" },
        repositorySort: { key: "updated", direction: "desc" },
        issues: { state: "open", sort: "updated", direction: "desc" },
        pullRequests: { state: "open", sort: "updated", direction: "desc" },
        actions: { state: "all", sort: "updated", direction: "desc" },
      },
      projectLaunchConfigs: {},
      repoSyncPreferences: {},
      repoRemoteSyncPolicies: {},
      hiddenRepoIds: [],
      managedRepoIds: [],
      systemGitRepoIds: [],
      repoBindings: {},
      favoriteRepoIds: [],
      repoGroups: [],
      organizationGroupingResolvedRepoIds: [],
      remoteRepoShortcuts: [],
      localContributionCache: {},
      contributionIdentities: [],
    },
    repos: [],
    tasks: [],
    repoListChange: { structural: false, repoIds: [] },
    bindingStatus: {
      state: "bound",
      clientIdConfigured: true,
      clientIdSource: "bundled",
      binding,
    },
    error: null,
  });
  workspace.githubBinding = ref(binding);
  workspace.isAuthorized = ref(true);
  workspace.workspaceRoot = ref("/tmp/workspace");
  workspace.activeWorkspace = ref({
    id: "workspace-default",
    name: "workspace",
    roots: [{ id: "root-default", path: "/tmp/workspace", available: true, unavailableReason: null }],
    primaryRootId: "root-default",
    viewPreferences: {
      sidebarRepositorySort: "updated:desc",
      collapsedGroupIds: [],
      homeRepositoryStatusSort: "updated:desc",
    },
  });
  workspace.workspaceCatalog = ref([{
    id: "workspace-default",
    name: "workspace",
    roots: [{ id: "root-default", path: "/tmp/workspace", available: true, unavailableReason: null }],
    primaryRootId: "root-default",
  }]);
  workspace.switchingWorkspace = ref(false);
  workspace.contextRevision = ref(1);
  workspace.hasAvailableWorkspaceRoot = ref(true);
  return { useWorkspace: () => workspace };
});

vi.mock("../src/composables/workspace/state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/composables/workspace/state")>();
  return {
    ...actual,
    bulkSyncRunningRepoIds: () => new Set<string>(),
    repoSyncIssuesByRepoId: () => new Map(),
  };
});

const { default: SecondaryPanel } = await import("../src/layouts/SecondaryPanel.vue");

async function renderPanel() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/profile", component: { template: "<div />" } },
      { path: "/organizations/:login", name: "github-organization", component: { template: "<div />" } },
      { path: "/settings", component: { template: "<div />" } },
      { path: "/repos/:repoId(.*)", component: { template: "<div />" } },
    ],
  });
  await router.push("/");
  await router.isReady();
  render(SecondaryPanel, {
    global: { plugins: [router, liliaContextMenuPlugin] },
  });
}

async function openAccountMenu() {
  const connection = document.querySelector('[data-agent-id="sidebar.footer.connection"]');
  if (!(connection instanceof HTMLElement)) throw new Error("未找到账号菜单入口");
  await fireEvent.click(connection);
  return screen.findByRole("menu", { name: "个人与组织主页" });
}

const resolvedOwners: GitHubRepoOwner[] = [
  {
    login: "alpha-org",
    kind: "organization",
    avatarUrl: null,
    membershipVisible: true,
    membershipComplete: true,
    repositoryAccessVisible: false,
    source: "membership",
  },
];

describe("侧边栏组织加载", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionContextForTests();
  });

  it("session 失效后仍会结束组织加载", async () => {
    const pending = deferred<GitHubRepoOwner[]>();
    workspace.getAccountRepositoryOwners.mockReturnValue(pending.promise);

    await renderPanel();
    const menu = await openAccountMenu();

    await waitFor(() => expect(within(menu).getByText("正在加载组织…")).toBeInTheDocument());
    invalidateSessionContextSnapshot();
    pending.resolve(resolvedOwners);

    await waitFor(() => expect(within(menu).queryByText("正在加载组织…")).toBeNull());
    expect(await within(menu).findByRole("menuitem", { name: "alpha-org" }))
      .toHaveAttribute("data-agent-id", "sidebar.organization.alpha-org");
  });

  it("组织加载失败后可在账户菜单重试", async () => {
    workspace.getAccountRepositoryOwners
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(resolvedOwners);

    await renderPanel();
    const menu = await openAccountMenu();
    const error = await within(menu).findByRole("alert");
    expect(error).toHaveTextContent("账号与组织加载失败：network down");

    await fireEvent.click(within(error).getByRole("button", { name: "重试" }));

    await waitFor(() => expect(workspace.getAccountRepositoryOwners).toHaveBeenCalledTimes(2));
    expect(await within(menu).findByRole("menuitem", { name: "alpha-org" }))
      .toHaveAttribute("href", "/organizations/alpha-org");
    expect(within(menu).queryByRole("alert")).toBeNull();
  });

  it("组织权限受限时从账户菜单打开 GitHub 授权", async () => {
    const recoveryUrl = "https://github.com/orgs/locked-org/sso";
    workspace.getAccountRepositoryOwners.mockResolvedValueOnce([{
      login: "locked-org",
      kind: "organization",
      avatarUrl: null,
      membershipVisible: false,
      membershipComplete: false,
      membershipRestriction: "sso_required",
      membershipRecoveryUrl: recoveryUrl,
      repositoryAccessVisible: true,
      source: "repository_access",
    } satisfies GitHubRepoOwner]);

    await renderPanel();
    const menu = await openAccountMenu();
    const authorize = await within(menu).findByRole("button", { name: "在 GitHub 授权" });
    expect(authorize).toHaveAttribute("data-agent-id", "sidebar.organizations.limited.authorize");

    await fireEvent.click(authorize);

    await waitFor(() => expect(workspace.openUrl).toHaveBeenCalledWith(recoveryUrl));
  });
});

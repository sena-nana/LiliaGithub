import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { computed, defineComponent, reactive, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDiscoveryRepositories } from "../src/composables/discovery/useDiscoveryRepositories";

const mocks = vi.hoisted(() => ({ preload: vi.fn(), listRepos: vi.fn(), listOwners: vi.fn(), clear: vi.fn(), updatePreferences: vi.fn() }));
const settings = reactive({
  accountPreferences: {
    defaultWorkspaceRoot: null,
    repositoryScope: { kind: "all" as const },
    repositorySort: { key: "updated" as const, direction: "desc" as const },
    issues: { state: "open" as const, sort: "created" as const, direction: "desc" as const },
    pullRequests: { state: "open" as const, sort: "updated" as const, direction: "desc" as const },
    actions: { state: "all" as const, sort: "updated" as const, direction: "desc" as const },
  },
  favoriteRepoIds: [],
  remoteRepoShortcuts: Array.from({ length: 14 }, (_, index) => ({
    fullName: `frequent/repo-${index + 1}`,
    openedAt: 100 - index,
  })),
  recentLocalRepos: [],
});
const localRepos = reactive<Array<{
  id: string;
  githubFullName: string;
}>>([]);

vi.mock("../src/services/workspace/client", () => ({
  clearGitHubRepoCache: mocks.clear,
  listGitHubRepoOwners: mocks.listOwners,
  listGitHubRepos: mocks.listRepos,
  preloadGitHubRepos: mocks.preload,
}));
vi.mock("../src/composables/useWorkspace", () => ({
  useWorkspace: () => ({
    state: reactive({ repos: localRepos, settings }),
    githubBinding: computed(() => ({ login: "sena", boundAt: 1, scopes: ["repo", "read:org"] })),
    isReady: ref(true),
    updateAccountPreferences: mocks.updatePreferences,
  }),
}));

function repos(start: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: start + index, name: `repo-${start + index}`, fullName: `lilia/repo-${start + index}`,
  }));
}

const Harness = defineComponent({
  setup() { return { discovery: useDiscoveryRepositories() }; },
  template: `
    <span data-testid="repo-count">{{ discovery.repositories.value.length }}</span>
    <span data-testid="scope-kind">{{ discovery.scope.value.kind }}</span>
    <button type="button" @click="discovery.loadMore">更多</button>
    <button type="button" @click="discovery.setScope({ kind: 'all' })">全部</button>
    <button type="button" @click="discovery.setScope({ kind: 'organization', login: 'lilia' })">组织</button>
  `,
});

beforeEach(() => {
  vi.clearAllMocks();
  localRepos.splice(0);
  settings.remoteRepoShortcuts = Array.from({ length: 14 }, (_, index) => ({
    fullName: `frequent/repo-${index + 1}`,
    openedAt: 100 - index,
  }));
  mocks.listOwners.mockResolvedValue([{ login: "lilia", kind: "organization", avatarUrl: null, membershipVisible: true, membershipComplete: true, repositoryAccessVisible: true, source: "both" }]);
  mocks.preload.mockResolvedValue({ items: repos(1, 20), nextPage: 2 });
  mocks.listRepos.mockResolvedValue({ items: repos(21, 10), nextPage: null });
  mocks.updatePreferences.mockResolvedValue(undefined);
});

describe("跨仓库范围与批次", () => {
  it("常用范围会纳入尚未收藏或访问的本地 GitHub 仓库", async () => {
    settings.remoteRepoShortcuts = [];
    localRepos.push({ id: "local-repo", githubFullName: "lilia/local-repo" });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/discovery", component: Harness }] });
    await router.push("/discovery");
    await router.isReady();
    render(Harness, { global: { plugins: [router] } });

    await waitFor(() => expect(screen.getByTestId("repo-count")).toHaveTextContent("1"));
    expect(mocks.preload).not.toHaveBeenCalled();
  });

  it("默认显示 12 个常用仓库，其他范围分批读取并可切换组织", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/discovery", component: Harness }] });
    await router.push("/discovery");
    await router.isReady();
    render(Harness, { global: { plugins: [router] } });

    await waitFor(() => expect(screen.getByTestId("repo-count")).toHaveTextContent("12"));
    expect(screen.getByTestId("scope-kind")).toHaveTextContent("frequent");
    expect(mocks.preload).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole("button", { name: "全部" }));
    await waitFor(() => expect(screen.getByTestId("scope-kind")).toHaveTextContent("all"));
    await waitFor(() => expect(mocks.preload).toHaveBeenCalledWith({ force: false, scope: { kind: "all" } }));
    expect(screen.getByTestId("repo-count")).toHaveTextContent("12");

    await fireEvent.click(screen.getByRole("button", { name: "更多" }));
    expect(screen.getByTestId("repo-count")).toHaveTextContent("20");
    expect(mocks.listRepos).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole("button", { name: "更多" }));
    await waitFor(() => expect(screen.getByTestId("repo-count")).toHaveTextContent("30"));
    expect(mocks.listRepos).toHaveBeenCalledWith({ kind: "all" }, 2);

    await fireEvent.click(screen.getByRole("button", { name: "组织" }));
    await waitFor(() => expect(screen.getByTestId("scope-kind")).toHaveTextContent("organization"));
    await waitFor(() => expect(mocks.preload).toHaveBeenLastCalledWith({ force: false, scope: { kind: "organization", login: "lilia" } }));
    expect(router.currentRoute.value.query).toMatchObject({ githubScope: "organization", githubOwner: "lilia" });
  });
});

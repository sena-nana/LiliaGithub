import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { nextTick, reactive, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Discovery from "../src/pages/Discovery.vue";
import type { DiscoveryScanResult } from "../src/services/discovery";
import type { GitHubAccountIssueItem } from "../src/services/workspace";

const mocks = vi.hoisted(() => ({
  discovery: null as any,
  scan: null as any,
  workspace: null as any,
  listAssignedWork: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("../src/composables/discovery/useDiscoveryRepositories", () => ({
  useDiscoveryRepositories: () => mocks.discovery,
}));
vi.mock("../src/composables/discovery/useDiscoveryScan", () => ({
  useDiscoveryScan: () => mocks.scan,
}));
vi.mock("../src/composables/useWorkspace", () => ({
  useWorkspace: () => mocks.workspace,
}));
vi.mock("../src/services/discovery", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/services/discovery")>(),
  listGitHubAssignedWork: mocks.listAssignedWork,
}));

beforeEach(() => {
  vi.clearAllMocks();
  const login = ref<string | null>("sena");
  mocks.discovery = {
    login,
    repositories: ref([]),
    refreshToken: ref(0),
    scope: ref({ kind: "frequent" }),
    organizations: ref([]),
    loading: ref(false),
    loadingMore: ref(false),
    error: ref<string | null>(null),
    hasMore: ref(false),
    refresh: mocks.refresh.mockResolvedValue(undefined),
    loadMore: vi.fn(),
    setScope: vi.fn(),
  };
  mocks.scan = {
    result: ref(emptyScan()),
    loading: ref(false),
    error: ref<string | null>(null),
  };
  mocks.workspace = { state: reactive({ tasks: [] }) };
});

describe("跨仓库 assigned work", () => {
  it("加载全账号工作，并在刷新和账号切换时更新", async () => {
    mocks.listAssignedWork
      .mockResolvedValueOnce([assignedItem("acme/alpha", 21, "初始分配")])
      .mockResolvedValueOnce([assignedItem("acme/alpha", 22, "刷新分配")])
      .mockResolvedValueOnce([assignedItem("octo/beta", 23, "新账号分配")]);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/discovery", component: Discovery }],
    });
    await router.push("/discovery");
    await router.isReady();

    render(Discovery, {
      global: {
        plugins: [router],
        stubs: { DiscoveryRepositoryScopeControl: true },
      },
    });

    expect(await screen.findByText("初始分配")).toBeInTheDocument();
    expect(mocks.listAssignedWork).toHaveBeenLastCalledWith(50, { forceRefresh: false });

    await fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(await screen.findByText("刷新分配")).toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.listAssignedWork).toHaveBeenLastCalledWith(50, { forceRefresh: true });

    mocks.discovery.login.value = "octocat";
    await nextTick();
    expect(await screen.findByText("新账号分配")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("刷新分配")).not.toBeInTheDocument());
    expect(mocks.listAssignedWork).toHaveBeenLastCalledWith(50, { forceRefresh: false });
  });
});

function assignedItem(repoFullName: string, number: number, title: string): GitHubAccountIssueItem {
  return {
    repoFullName,
    pullRequest: false,
    issue: {
      number,
      title,
      state: "open",
      body: null,
      labels: [],
      assignees: ["sena"],
      htmlUrl: `https://github.com/${repoFullName}/issues/${number}`,
      createdAt: "2026-07-19T00:00:00Z",
      updatedAt: "2026-07-19T01:00:00Z",
    },
  };
}

function emptyScan(): DiscoveryScanResult {
  const section = <T>() => ({
    items: [] as T[],
    failures: [],
    truncated: false,
    requestedRepositoryCount: 0,
    successfulRepositoryCount: 0,
  });
  return {
    pendingPullRequests: section(),
    assignedIssues: section(),
    failedWorkflows: section(),
    recentReleases: section(),
    repositoryStatuses: section(),
  };
}

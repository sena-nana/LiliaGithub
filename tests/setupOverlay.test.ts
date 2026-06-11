import { render, screen } from "@testing-library/vue";
import { computed, reactive, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it, vi } from "vitest";

const workspaceRoot = ref<string | null>(null);
const githubBinding = ref<null>(null);
const deviceFlow = ref<null>(null);
const isReady = computed(() => false);
const isAuthorized = computed(() => false);
const state = reactive({
  loading: true,
  authLoading: false,
  error: null,
  githubContributions: {
    days: [],
    loading: false,
    error: null,
    updatedAt: null,
  },
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: vi.fn(async () => false),
    onResized: vi.fn(async () => vi.fn()),
    minimize: vi.fn(async () => undefined),
    toggleMaximize: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }),
}));

vi.mock("../src/composables/useWorkspace", () => ({
  useWorkspace: () => ({
    state,
    deviceFlow,
    workspaceRoot,
    githubBinding,
    isAuthorized,
    isReady,
    overviewStats: computed(() => ({
      totalRepos: 0,
      dirtyRepos: 0,
      pullable: 0,
      pushable: 0,
    })),
    initialize: vi.fn(async () => undefined),
    chooseWorkspaceRoot: vi.fn(async () => null),
    refreshRepoContributions: vi.fn(async () => undefined),
    startAuthFlow: vi.fn(async () => undefined),
    pollAuthFlow: vi.fn(async () => null),
  }),
}));

const { default: AppShell } = await import("../src/layouts/AppShell.vue");
const { default: Home } = await import("../src/pages/Home.vue");

async function renderSetupHome() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        component: Home,
      },
    ],
  });
  await router.push("/");
  await router.isReady();

  return render(AppShell, {
    global: {
      plugins: [router],
    },
  });
}

describe("初始化覆盖界面", () => {
  it("初始化加载期间覆盖标题栏下方整窗并隐藏侧栏", async () => {
    const view = await renderSetupHome();
    const shell = view.container.querySelector(".shell");

    expect(shell).toHaveClass("is-setup-overlay");
    expect(view.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();
    expect(view.container.querySelector(".shell__resizer")).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "折叠左侧栏" })).toBeDisabled();

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub 初始化" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "工作区文件夹" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "GitHub 授权" })).toBeInTheDocument();
    expect(view.container.querySelector(".setup-screen .card")).not.toBeInTheDocument();
  });
});

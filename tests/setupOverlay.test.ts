import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { reactive, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceRoot = ref<string | null>(null);
const activeWorkspace = ref(null);
const workspaceCatalog = ref([]);
const switchingWorkspace = ref(false);
const contextRevision = ref(0);
const hasAvailableWorkspaceRoot = ref(false);
const githubBinding = ref<null>(null);
const deviceFlow = ref<null>(null);
const isReady = ref(false);
const isAuthorized = ref(false);
const state = reactive({
  loading: true,
  authLoading: false,
  authNotice: null,
  error: null,
  githubContributions: {
    days: [],
    meta: null,
    loading: false,
    error: null,
  },
  languageStatsLoadingRepoIds: [],
  tasks: [],
});
const pickWorkspaceRoot = vi.fn(async () => null as string | null);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

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
    activeWorkspace,
    workspaceCatalog,
    switchingWorkspace,
    contextRevision,
    hasAvailableWorkspaceRoot,
    githubBinding,
    isAuthorized,
    isReady,
    initialize: vi.fn(async () => undefined),
    pickWorkspaceRoot,
    createWorkspace: vi.fn(async () => undefined),
    addWorkspaceRoot: vi.fn(async () => undefined),
    addLocalRepo: vi.fn(async () => null),
    discoverRepos: vi.fn(async () => []),
    refreshRepos: vi.fn(async () => undefined),
    refreshRepoContributions: vi.fn(async () => undefined),
    startAuthFlow: vi.fn(async () => undefined),
    pollAuthFlow: vi.fn(async () => null),
  }),
}));

const { setLiliaUiConfig } = await import("../src/ui");
const { LILIA_UI_CONFIG } = await import("../src/config/appShell");
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

  setLiliaUiConfig(LILIA_UI_CONFIG);
  return render(AppShell, {
    global: {
      plugins: [router],
    },
  });
}

describe("初始化覆盖界面", () => {
  beforeEach(() => {
    workspaceRoot.value = null;
    pickWorkspaceRoot.mockReset();
    pickWorkspaceRoot.mockResolvedValue(null);
  });

  it("初始化加载期间覆盖标题栏下方整窗并隐藏侧栏", async () => {
    const view = await renderSetupHome();

    expect(view.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "展开左侧栏" })).toBeDisabled();

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub 初始化" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "命名工作区" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "GitHub 授权" })).toBeInTheDocument();
  });

  it("工作区选择期间禁用入口并保持图标占位", async () => {
    const picker = deferred<string | null>();
    pickWorkspaceRoot.mockImplementation(() => picker.promise);
    await renderSetupHome();

    const button = await screen.findByRole("button", { name: "创建工作区" });
    await fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(button.querySelector(".sb-spin")).toBeInTheDocument();

    picker.resolve(null);

    await waitFor(() => expect(button).toBeEnabled());
    expect(button.querySelector(".sb-spin")).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceClient } from "../src/services/workspace/client";
import {
  createWorkspaceStoreFixture,
  provideWorkspaceStoreFixture,
} from "./fixtures/createWorkspaceStoreFixture";

const pickWorkspaceRoot = vi.fn<WorkspaceClient["pickWorkspaceRoot"]>();
const workspace = createWorkspaceStoreFixture({ pickWorkspaceRoot });
const initialize = vi.spyOn(workspace, "initialize");
const { state } = workspace.stateFeature;

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

const { setLiliaUiConfig } = await import("@lilia/ui/shell");
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
      provide: provideWorkspaceStoreFixture(workspace),
    },
  });
}

describe("初始化覆盖界面", () => {
  beforeEach(() => {
    workspace.stateFeature.resetWorkspaceStateForTests();
    pickWorkspaceRoot.mockReset();
    pickWorkspaceRoot.mockResolvedValue(null);
    initialize.mockReset();
    initialize.mockResolvedValue(undefined);
    state.bootstrapStatus = "loading";
    state.loading = true;
    state.error = null;
  });

  it("初始化加载期间覆盖标题栏下方整窗并隐藏侧栏", async () => {
    const view = await renderSetupHome();

    expect(view.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "展开左侧栏" })).toBeDisabled();

    expect(await screen.findByRole("heading", { level: 1, name: "正在打开 LiliaGithub" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "创建工作区" })).toBeNull();
    expect(screen.queryByRole("button", { name: "绑定 GitHub" })).toBeNull();
  });

  it("工作区选择期间禁用入口并保持图标占位", async () => {
    state.bootstrapStatus = "ready";
    state.loading = false;
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

  it("初始化失败只提供重试，不提前暴露 setup 写操作", async () => {
    state.bootstrapStatus = "error";
    state.loading = false;
    state.error = "工作区配置读取失败";
    await renderSetupHome();

    expect(await screen.findByRole("heading", { level: 1, name: "无法打开工作区" })).toBeInTheDocument();
    expect(screen.getByText("工作区配置读取失败")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "创建工作区" })).toBeNull();
    expect(screen.queryByRole("button", { name: "绑定 GitHub" })).toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(initialize).toHaveBeenCalledTimes(1);
  });
});

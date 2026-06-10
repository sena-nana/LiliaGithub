import { fireEvent, render, waitFor } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { SIDEBAR_CONFIG } from "../src/config/appShell";
import ContextMenuHost from "../src/components/ContextMenuHost.vue";
import { closeContextMenu, installContextMenu } from "../src/composables/useContextMenu";
import { resetWorkspaceStateForTests, state } from "../src/composables/workspace/state";
import { vContextMenu } from "../src/directives/contextMenu";
import AppShell from "../src/layouts/AppShell.vue";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: vi.fn(async () => false),
    onResized: vi.fn(async () => vi.fn()),
    minimize: vi.fn(async () => undefined),
    toggleMaximize: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }),
}));

async function renderAppShell(initialRoute = "/") {
  const Wrapper = defineComponent({
    components: { AppShell, ContextMenuHost },
    template: "<AppShell /><ContextMenuHost />",
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        component: { template: "<div>home</div>" },
      },
      {
        path: "/plugins",
        component: { template: "<div>plugins</div>" },
      },
      {
        path: "/repos/:repoId(.*)",
        component: { template: "<div>repo</div>" },
      },
      {
        path: "/settings",
        component: { template: "<div>settings</div>" },
        meta: { sidebar: "settings", lockSidebar: true, returnable: false },
      },
      { path: "/:pathMatch(.*)*", redirect: "/" },
    ],
  });
  await router.push(initialRoute);
  await router.isReady();

  const view = render(Wrapper, {
    global: {
      plugins: [router],
      directives: {
        contextMenu: vContextMenu,
      },
    },
  });

  return {
    ...view,
    router,
  };
}

function shellElement(container: HTMLElement): HTMLElement {
  const shell = container.querySelector(".shell");
  if (!(shell instanceof HTMLElement)) {
    throw new Error("未找到 shell");
  }
  return shell;
}

function leftResizer(container: HTMLElement): HTMLElement {
  const resizer = container.querySelector(".shell__resizer");
  if (!(resizer instanceof HTMLElement)) {
    throw new Error("未找到左侧栏拖拽线");
  }
  return resizer;
}

function sidebarRowForText(container: HTMLElement, text: string): HTMLElement {
  const label = Array.from(container.querySelectorAll(".sb-tree__name")).find(
    (node) => node.textContent === text,
  );
  const row = label?.closest(".sb-tree__row");
  if (!(row instanceof HTMLElement)) {
    throw new Error(`未找到侧边栏行: ${text}`);
  }
  return row;
}

beforeEach(() => {
  resetWorkspaceStateForTests();
  closeContextMenu();
  installContextMenu();
  localStorage.clear();
});

describe("AppShell sidebar", () => {
  it("主侧边栏显示总览、仓库列表和同步预检工具", async () => {
    const view = await renderAppShell("/plugins");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    expect(sidebarRowForText(view.container, "概览")).toBeInTheDocument();
    expect(view.getAllByRole("button", { name: "刷新仓库" }).length).toBeGreaterThanOrEqual(1);
    expect(view.getByRole("button", { name: "拉取预检" })).toBeEnabled();
    expect(view.getByRole("button", { name: "一键推送" })).toBeEnabled();

    await fireEvent.click(sidebarRowForText(view.container, "LiliaGithub"));

    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub");
    });
  });

  it("侧边栏一键推送运行中显示蓝底按钮和仓库行状态", async () => {
    const view = await renderAppShell("/plugins");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    state.bulkPushRunning = true;
    state.bulkPushStatuses.LiliaGithub = { state: "running" };

    await waitFor(() => {
      expect(view.getByRole("button", { name: "一键推送" })).toHaveClass("is-running");
      expect(view.getByLabelText("正在推送")).toBeInTheDocument();
    });

    state.bulkPushRunning = false;
    state.bulkPushStatuses.LiliaGithub = {
      state: "error",
      message: "认证失败",
    };

    await waitFor(() => {
      expect(view.getByLabelText("推送失败")).toHaveAttribute("title", "认证失败");
    });
  });

  it("仓库右键菜单可隐藏仓库并从详情页返回总览", async () => {
    const view = await renderAppShell("/repos/LiliaGithub");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    await fireEvent.contextMenu(sidebarRowForText(view.container, "LiliaGithub"));
    await fireEvent.click(await view.findByRole("menuitem", { name: "隐藏仓库" }));

    expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    await fireEvent.click(view.getByRole("menuitem", { name: "确认隐藏？再点一次" }));

    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/");
    });
    await waitFor(() => {
      expect(() => sidebarRowForText(view.container, "LiliaGithub")).toThrow("未找到侧边栏行: LiliaGithub");
    });
  });

  it("只有进入首页时工作区概览才处于选中状态", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "概览")).toHaveClass("is-active");
    });

    await view.router.push("/plugins");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "概览")).not.toHaveClass("is-active");
    });

    await view.router.push("/repos/LiliaGithub");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "概览")).not.toHaveClass("is-active");
    });
  });

  it("左上角按钮切换左侧栏折叠状态并写回本地存储", async () => {
    const view = await renderAppShell("/plugins");
    const shell = shellElement(view.container);
    const collapse = view.getByRole("button", { name: "折叠左侧栏" });

    expect(shell).not.toHaveClass("is-sidebar-collapsed");
    expect(leftResizer(view.container)).not.toHaveAttribute("aria-disabled");
    expect(collapse).toHaveAttribute("aria-pressed", "false");

    await fireEvent.click(collapse);

    expect(shell).toHaveClass("is-sidebar-collapsed");
    expect(leftResizer(view.container)).toHaveAttribute("aria-disabled", "true");
    expect(localStorage.getItem(SIDEBAR_CONFIG.collapsedStorageKey)).toBe("1");

    const expand = view.getByRole("button", { name: "展开左侧栏" });
    expect(expand).toHaveAttribute("aria-pressed", "true");

    await fireEvent.click(expand);

    expect(shell).not.toHaveClass("is-sidebar-collapsed");
    expect(leftResizer(view.container)).not.toHaveAttribute("aria-disabled");
    expect(localStorage.getItem(SIDEBAR_CONFIG.collapsedStorageKey)).toBe("0");
  });

  it("左侧栏宽度可拖拽调整、写回存储并双击恢复默认", async () => {
    localStorage.setItem(SIDEBAR_CONFIG.widthStorageKey, "260");
    const view = await renderAppShell("/plugins");
    const shell = shellElement(view.container);
    const resizer = leftResizer(view.container);

    expect(shell.style.getPropertyValue("--sidebar-width")).toBe("260px");
    expect(resizer).toHaveAttribute("aria-valuemin", "180");
    expect(resizer).toHaveAttribute("aria-valuemax", "480");
    expect(resizer).toHaveAttribute("aria-valuenow", "260");

    await fireEvent.pointerDown(resizer, {
      button: 0,
      clientX: 200,
      pointerId: 1,
    });
    await fireEvent.pointerMove(window, {
      clientX: 300,
      pointerId: 1,
    });

    expect(shell.style.getPropertyValue("--sidebar-width")).toBe("360px");
    expect(resizer).toHaveAttribute("aria-valuenow", "360");

    await fireEvent.pointerUp(window, {
      clientX: 300,
      pointerId: 1,
    });

    expect(localStorage.getItem(SIDEBAR_CONFIG.widthStorageKey)).toBe("360");

    await fireEvent.dblClick(resizer);

    expect(shell.style.getPropertyValue("--sidebar-width")).toBe("220px");
    expect(localStorage.getItem(SIDEBAR_CONFIG.widthStorageKey)).toBe("220");
  });

  it("设置页替换左侧栏、禁用折叠并保留折叠偏好", async () => {
    localStorage.setItem(SIDEBAR_CONFIG.collapsedStorageKey, "1");
    const view = await renderAppShell("/settings");
    const shell = shellElement(view.container);
    const leftToggle = view.getByRole("button", { name: "折叠左侧栏" });

    expect(shell).toHaveClass("is-settings-mode");
    expect(shell).not.toHaveClass("is-sidebar-collapsed");
    expect(leftToggle).toBeDisabled();
    expect(view.getByRole("navigation", { name: "设置分类" })).toBeInTheDocument();
    expect(view.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: /外观/ })).toHaveClass("is-active");
    expect(view.router.currentRoute.value.meta.sidebar).toBe("settings");
    expect(view.router.currentRoute.value.meta.lockSidebar).toBe(true);
    expect(localStorage.getItem(SIDEBAR_CONFIG.collapsedStorageKey)).toBe("1");

    await fireEvent.click(view.getByRole("button", { name: /关于/ }));

    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/settings?tab=about");
    });
    expect(view.getByRole("button", { name: /关于/ })).toHaveClass("is-active");

    await view.router.push("/plugins");
    expect(shell).toHaveClass("is-sidebar-collapsed");
    expect(localStorage.getItem(SIDEBAR_CONFIG.collapsedStorageKey)).toBe("1");
  });

  it("设置页返回进入设置前的主窗口路由", async () => {
    const view = await renderAppShell("/plugins");

    await view.router.push("/settings?tab=about");
    await fireEvent.click(view.getByRole("button", { name: "返回" }));
    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/plugins");
    });
  });
});

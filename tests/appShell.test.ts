import { fireEvent, render, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { SIDEBAR_CONFIG } from "../src/config/appShell";
import ContextMenuHost from "../src/components/ContextMenuHost.vue";
import { closeContextMenu, installContextMenu } from "../src/composables/useContextMenu";
import { resetWorkspaceStateForTests, state } from "../src/composables/workspace/state";
import {
  setFallbackGitHubBindingStatusForTests,
  setFallbackGitHubReposErrorForTests,
} from "../src/services/workspace";
import { vContextMenu } from "../src/directives/contextMenu";
import AppShell from "../src/layouts/AppShell.vue";
import Home from "../src/pages/Home.vue";
import { repoSummary } from "./fixtures/workspace";

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
        component: Home,
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
  it("主侧边栏显示总览和仓库列表，仓库操作集中在总览页", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    expect(sidebarRowForText(view.container, "概览")).toBeInTheDocument();
    expect(view.container.querySelector(".sb-section--actions")).toBeNull();
    expect(view.container.querySelector(".shell-actions")).toBeNull();
    expect(view.getByLabelText("项目总览操作")).toBeInTheDocument();
    expect(within(view.getByLabelText("项目总览操作")).getByRole("button", { name: "刷新仓库" })).toBeInTheDocument();
    expect(within(view.getByLabelText("项目总览操作")).getByRole("button", { name: "一键同步" })).toBeEnabled();

    await fireEvent.click(sidebarRowForText(view.container, "LiliaGithub"));

    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub");
    });
  });

  it("仓库行优先显示 GitHub repo 名称，缺失时回退本地目录名", async () => {
    const view = await renderAppShell("/repos/LiliaGithub");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    state.repos = [
      repoSummary("workspace/local-folder", {
        name: "local-folder",
        path: "C:\\Files\\workspace\\local-folder",
        relativePath: "workspace/local-folder",
        githubFullName: "sena-nana/remote-repo",
      }),
      repoSummary("workspace/local-only", {
        name: "local-only",
        path: "C:\\Files\\workspace\\local-only",
        relativePath: "workspace/local-only",
        githubFullName: null,
      }),
    ];

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "remote-repo")).toHaveAttribute(
        "title",
        "sena-nana/remote-repo · C:\\Files\\workspace\\local-folder",
      );
      expect(sidebarRowForText(view.container, "local-only")).toBeInTheDocument();
    });
  });

  it("总览页一键同步运行中显示按钮和仓库行状态", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    state.bulkPreview = {
      operation: "sync",
      eligible: [{ repo: state.repos[0], reason: "有本地提交待推送" }],
      blocked: [],
      warnings: [],
    };
    state.recentSync = {
      preview: state.bulkPreview,
      results: [
        {
          repoId: "LiliaGithub",
          status: "error",
          message: "认证失败",
          summary: null,
        },
      ],
      retryingRepoIds: [],
      updatedAt: 2,
    };
    state.bulkRunning = true;

    await waitFor(() => {
      expect(within(view.getByLabelText("项目总览操作")).getByRole("button", { name: "一键同步" })).toHaveClass("is-running");
      const row = sidebarRowForText(view.container, "LiliaGithub");
      expect(within(row).getByLabelText("正在同步")).toBeInTheDocument();
      expect(within(row).queryByLabelText("同步失败")).not.toBeInTheDocument();
    });
  });

  it("侧边栏显示最近一次同步失败结果", async () => {
    const view = await renderAppShell("/repos/LiliaGithub");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    state.recentSync = {
      preview: {
        operation: "sync",
        eligible: [],
        blocked: [{ repo: state.repos[0], reason: "需先拉取合并后推送" }],
        warnings: [],
      },
      results: [
        {
          repoId: "LiliaGithub",
          status: "error",
          message: "认证失败",
          summary: null,
        },
      ],
      retryingRepoIds: [],
      updatedAt: 2,
    };

    await waitFor(() => {
      expect(
        within(sidebarRowForText(view.container, "LiliaGithub")).getByLabelText("同步失败"),
      ).toHaveAttribute("title", "认证失败");
    });
  });

  it("侧边栏显示自动合并冲突仓库提示", async () => {
    const view = await renderAppShell("/repos/LiliaGithub");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    state.repos = [
      repoSummary("LiliaGithub", { conflictCount: 1 }),
      repoSummary("Lilia"),
    ];

    await waitFor(() => {
      expect(
        within(sidebarRowForText(view.container, "LiliaGithub")).getByLabelText("存在合并冲突"),
      ).toHaveAttribute("title", "存在合并冲突，请处理后再同步");
    });
  });

  it("侧边栏搜索可过滤仓库并回车跳转首个结果", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
      expect(sidebarRowForText(view.container, "Lilia")).toBeInTheDocument();
    });

    await fireEvent.click(within(view.getByLabelText("项目总览操作")).getByRole("button", { name: "搜索" }));
    const search = view.getByRole("searchbox", { name: "搜索仓库" });
    await fireEvent.update(search, "sena-nana/LiliaGithub");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
      expect(() => sidebarRowForText(view.container, "Lilia")).toThrow("未找到侧边栏行: Lilia");
    });

    await fireEvent.keyDown(search, { key: "Enter" });

    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub");
    });
  });

  it("未绑定 GitHub 时首页保持初始化页且不显示总览操作卡片", async () => {
    setFallbackGitHubBindingStatusForTests({
      state: "unbound",
      clientIdConfigured: true,
      clientIdSource: "bundled",
      binding: null,
    });
    const view = await renderAppShell("/");

    expect(await view.findByRole("heading", { level: 1, name: "LiliaGithub 初始化" })).toBeInTheDocument();
    expect(view.queryByLabelText("项目总览操作")).toBeNull();
    expect(view.queryByRole("navigation", { name: "主导航" })).toBeNull();
  });

  it("已绑定 GitHub 时克隆弹窗展示账号仓库列表并可选择克隆", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    await fireEvent.click(within(view.getByLabelText("项目总览操作")).getByRole("button", { name: "克隆仓库" }));

    expect(view.getByRole("dialog", { name: "克隆仓库" })).toBeInTheDocument();
    const input = await view.findByPlaceholderText("搜索仓库，或直接输入 owner/repo");
    expect(view.getByText(/当前绑定账号：/)).toBeInTheDocument();

    await fireEvent.focus(input);
    expect(await view.findByText("sena-nana/Lilia")).toBeInTheDocument();

    await fireEvent.click(view.getByText("sena-nana/Lilia"));
    expect(view.getByPlaceholderText("默认从 URL 推导")).toHaveValue("Lilia");

    await fireEvent.click(view.getByRole("button", { name: "克隆" }));

    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/repos/Lilia");
    });
  });

  it("已绑定 GitHub 时支持 owner/repo 直接克隆", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    await fireEvent.click(within(view.getByLabelText("项目总览操作")).getByRole("button", { name: "克隆仓库" }));
    const input = await view.findByPlaceholderText("搜索仓库，或直接输入 owner/repo");

    await fireEvent.update(input, "sena-nana/NewRepo");
    await waitFor(() => {
      expect(view.getByText("直接克隆 sena-nana/NewRepo")).toBeInTheDocument();
      expect(view.getByPlaceholderText("默认从 URL 推导")).toHaveValue("NewRepo");
    });
    await fireEvent.click(view.getByRole("button", { name: "克隆" }));

    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/repos/NewRepo");
      expect(sidebarRowForText(view.container, "NewRepo")).toBeInTheDocument();
    });
  });

  it("GitHub 仓库列表绑定失效时提供重新绑定入口", async () => {
    setFallbackGitHubReposErrorForTests("GitHub 绑定已失效，请重新绑定");
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    await fireEvent.click(within(view.getByLabelText("项目总览操作")).getByRole("button", { name: "克隆仓库" }));

    expect(await view.findByText("GitHub 绑定已失效，请重新绑定。")).toBeInTheDocument();
    await fireEvent.focus(view.getByPlaceholderText("搜索仓库，或直接输入 owner/repo"));
    expect(view.getByText("GitHub 绑定已失效，请重新绑定后再加载账号仓库。")).toBeInTheDocument();

    await fireEvent.click(view.getByRole("button", { name: "重新绑定 GitHub" }));

    await waitFor(() => {
      expect(view.router.currentRoute.value.path).toBe("/settings");
      expect(view.router.currentRoute.value.query.tab).toBe("repositories");
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

    await view.router.push("/repos/LiliaGithub");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "概览")).not.toHaveClass("is-active");
    });
  });

  it("左上角按钮切换左侧栏折叠状态并写回本地存储", async () => {
    const view = await renderAppShell("/repos/LiliaGithub");
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
    const view = await renderAppShell("/repos/LiliaGithub");
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

  it("左侧栏拖拽中断后恢复主内容交互", async () => {
    const view = await renderAppShell("/repos/LiliaGithub");
    const shell = shellElement(view.container);
    const resizer = leftResizer(view.container);

    await fireEvent.pointerDown(resizer, {
      button: 0,
      clientX: 220,
      pointerId: 1,
    });

    expect(shell).toHaveClass("is-resizing");

    await fireEvent.pointerCancel(window, {
      clientX: 220,
      pointerId: 1,
    });

    expect(shell).not.toHaveClass("is-resizing");
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

    await view.router.push("/repos/LiliaGithub");
    expect(shell).toHaveClass("is-sidebar-collapsed");
    expect(localStorage.getItem(SIDEBAR_CONFIG.collapsedStorageKey)).toBe("1");
  });

  it("设置页返回进入设置前的主窗口路由", async () => {
    const view = await renderAppShell("/repos/LiliaGithub");

    await view.router.push("/settings?tab=about");
    await fireEvent.click(view.getByRole("button", { name: "返回" }));
    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub");
    });
  });
});

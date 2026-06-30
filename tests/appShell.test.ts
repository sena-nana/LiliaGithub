import { fireEvent, render, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { SIDEBAR_CONFIG } from "../src/config/appShell";
import { ContextMenuHost } from "@lilia/ui";
import { closeContextMenu, installContextMenu } from "@lilia/ui";
import { resetWorkspaceStateForTests, setRepoActionError, state } from "../src/composables/workspace/state";
import { REPO_LAUNCH_STATUS_EVENT } from "../src/composables/workspace/launchEvents";
import { workspaceFallbackForTests, type GitHubRepoSummary } from "../src/services/workspace";
import { vContextMenu } from "@lilia/ui";
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

function leftResizer(container: HTMLElement): HTMLElement {
  const resizer = container.querySelector(".shell__resizer");
  if (!(resizer instanceof HTMLElement)) {
    throw new Error("未找到左侧栏拖拽线");
  }
  return resizer;
}

function sidebarZone(container: HTMLElement, className: string): HTMLElement {
  const zone = container.querySelector(`.${className}`);
  if (!(zone instanceof HTMLElement)) {
    throw new Error(`未找到侧边栏区域: ${className}`);
  }
  return zone;
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

function repoStatusRowForText(container: HTMLElement, text: string): HTMLElement {
  const label = Array.from(container.querySelectorAll(".repo-status-row__name")).find(
    (node) => node.textContent === text,
  );
  const row = label?.closest(".repo-status-row");
  if (!(row instanceof HTMLElement)) {
    throw new Error(`未找到首页仓库状态行: ${text}`);
  }
  return row;
}

function sidebarGroupForText(container: HTMLElement, name: string, count: number): HTMLElement {
  const text = `${name}${count}`;
  const group = Array.from(container.querySelectorAll(".sb-group-toggle")).find(
    (node) => node.textContent?.replace(/\s+/g, "") === text,
  );
  if (!(group instanceof HTMLElement)) {
    throw new Error(`未找到侧边栏分组: ${name} ${count}`);
  }
  return group;
}

function githubRepoSummary(fullName: string, overrides: Partial<GitHubRepoSummary> = {}): GitHubRepoSummary {
  const [ownerLogin = "", rawName] = fullName.split("/");
  const name = rawName || fullName;
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
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
    cloneUrl: `https://github.com/${fullName}.git`,
    htmlUrl: `https://github.com/${fullName}`,
    ...overrides,
  };
}

type AppShellView = Awaited<ReturnType<typeof renderAppShell>>;
type WorkspaceFallbackForTests = Awaited<ReturnType<typeof workspaceFallbackForTests>>;
let workspaceFallback: WorkspaceFallbackForTests;

async function createSidebarRepoGroup(view: AppShellView, name: string) {
  await fireEvent.click(view.getByRole("button", { name: "创建仓库分组" }));
  const input = await view.findByRole("textbox", { name: "重命名分组" });
  await fireEvent.update(input, name);
  await fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => {
    expect(sidebarGroupForText(view.container, name.trim(), 0)).toBeInTheDocument();
  });
}

async function selectHomeCreateRepoAction(view: AppShellView, action: string, groupName?: string) {
  await fireEvent.click(within(view.getByLabelText("项目总览操作")).getByRole("button", { name: "创建仓库" }));
  const item = await view.findByRole("menuitem", { name: action });
  if (!groupName) {
    await fireEvent.click(item);
    return;
  }
  await fireEvent.mouseEnter(item);
  await fireEvent.click(await view.findByRole("menuitem", { name: groupName }));
}

async function selectCreateRepoGroup(view: AppShellView, dialog: HTMLElement, groupName: string) {
  const trigger = dialog.querySelector('[data-agent-id="repo-create.group.trigger"]');
  if (!(trigger instanceof HTMLElement)) {
    throw new Error("未找到创建仓库分组选择器");
  }
  await fireEvent.click(trigger);
  await fireEvent.click(await view.findByRole("option", { name: new RegExp(groupName) }));
}

async function openHomeCloneDialog(view: AppShellView, groupName = "未分组仓库") {
  await selectHomeCreateRepoAction(view, "克隆仓库", groupName);
}

async function toggleSidebarRepoGroup(view: AppShellView, name: string) {
  const group = Array.from(view.container.querySelectorAll(".sb-group-toggle")).find((node) =>
    node.getAttribute("aria-label")?.endsWith(`分组 ${name}`)
  );
  if (!(group instanceof HTMLElement)) {
    throw new Error(`未找到侧边栏分组开关: ${name}`);
  }
  await fireEvent.click(group);
}

async function moveSidebarRepoToGroup(view: AppShellView, repoName: string, groupName: string) {
  await fireEvent.contextMenu(sidebarRowForText(view.container, repoName));
  await fireEvent.mouseEnter(await view.findByRole("menuitem", { name: "移动到分组" }));
  await fireEvent.click(await view.findByRole("menuitem", { name: groupName }));
}

beforeEach(async () => {
  workspaceFallback = await workspaceFallbackForTests();
  resetWorkspaceStateForTests();
  closeContextMenu();
  installContextMenu();
  localStorage.clear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(async () => undefined),
    },
  });
});

describe("AppShell sidebar", () => {
  it("主侧边栏显示总览和仓库列表，仓库操作集中在总览页", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    expect(sidebarRowForText(view.container, "概览")).toBeInTheDocument();
    expect(sidebarGroupForText(view.container, "未分组仓库", 2)).toBeInTheDocument();
    expect(view.getByRole("button", { name: "折叠分组 未分组仓库" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "创建仓库分组" })).toBeInTheDocument();
    expect(view.getByLabelText("项目总览操作")).toBeInTheDocument();
    expect(within(view.getByLabelText("项目总览操作")).getByRole("button", { name: "创建仓库" })).toBeInTheDocument();
    expect(within(view.getByLabelText("项目总览操作")).queryByRole("button", { name: "克隆仓库" })).toBeNull();
    expect(within(view.getByLabelText("项目总览操作")).getByRole("button", { name: "刷新并抓取" })).toBeInTheDocument();
    expect(within(view.getByLabelText("项目总览操作")).getByRole("button", { name: "一键同步" })).toBeEnabled();
    expect(view.queryByRole("button", { name: "在 未分组仓库 创建仓库" })).toBeNull();

    await fireEvent.click(sidebarRowForText(view.container, "LiliaGithub"));

    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub");
    });
  });

  it("侧边栏用固定顶部、滚动仓库区和固定底部承载长列表", async () => {
    state.repos = Array.from({ length: 120 }, (_, index) =>
      repoSummary(`Repo-${String(index + 1).padStart(3, "0")}`),
    );
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "Repo-001")).toBeInTheDocument();
    });

    const top = sidebarZone(view.container, "secondary-panel__top");
    const body = sidebarZone(view.container, "secondary-panel__body");
    const footer = sidebarZone(view.container, "secondary-panel__footer");
    const mainNav = view.getByRole("navigation", { name: "主导航" });
    const footerSettings = view.container.querySelector('[data-agent-id="sidebar.footer.settings"]');
    const footerConnection = view.container.querySelector('[data-agent-id="sidebar.footer.connection"]');

    expect(top).toContainElement(mainNav);
    expect(body).toContainElement(sidebarGroupForText(view.container, "未分组仓库", 120));
    expect(body).toContainElement(sidebarRowForText(view.container, "Repo-001"));
    expect(footer).toContainElement(footerSettings);
    expect(footer).toContainElement(footerConnection);
    expect(body).not.toContainElement(mainNav);
    expect(body).not.toContainElement(footerSettings);

    await fireEvent.click(view.getByRole("button", { name: "显示更多 40 个" }));

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "Repo-120")).toBeInTheDocument();
    });
  });

  it("长列表中仓库行状态只影响对应行并保留分页结构", async () => {
    state.repos = Array.from({ length: 120 }, (_, index) =>
      repoSummary(`Repo-${String(index + 1).padStart(3, "0")}`),
    );
    state.refreshingRepoIds = ["Repo-001"];
    state.syncingRepoIds = ["Repo-002"];

    const view = await renderAppShell("/repos/Repo-003");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "Repo-001")).toBeInTheDocument();
    });

    const firstRow = sidebarRowForText(view.container, "Repo-001");
    const secondRow = sidebarRowForText(view.container, "Repo-002");
    const thirdRow = sidebarRowForText(view.container, "Repo-003");
    expect(sidebarGroupForText(view.container, "未分组仓库", 120)).toBeInTheDocument();
    expect(view.getByRole("button", { name: "显示更多 40 个" })).toBeInTheDocument();
    expect(within(firstRow).getByLabelText("正在刷新仓库")).toBeInTheDocument();
    expect(within(secondRow).getByLabelText("正在同步")).toBeInTheDocument();
    expect(thirdRow).toHaveClass("is-active");
    expect(within(secondRow).queryByLabelText("正在刷新仓库")).toBeNull();
    expect(within(thirdRow).queryByLabelText("正在同步")).toBeNull();

    state.refreshingRepoIds = ["Repo-003"];

    await waitFor(() => {
      expect(within(sidebarRowForText(view.container, "Repo-001")).queryByLabelText("正在刷新仓库")).toBeNull();
      expect(within(sidebarRowForText(view.container, "Repo-003")).getByLabelText("正在刷新仓库")).toBeInTheDocument();
    });
    expect(sidebarGroupForText(view.container, "未分组仓库", 120)).toBeInTheDocument();
  });

  it("侧边栏可创建仓库分组、立即重命名并折叠已有分组", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarGroupForText(view.container, "未分组仓库", 2)).toBeInTheDocument();
    });

    await fireEvent.click(view.getByRole("button", { name: "创建仓库分组" }));
    const input = await view.findByRole("textbox", { name: "重命名分组" });
    expect(input).toHaveValue("未命名分组");
    await fireEvent.update(input, " 前端 ");
    await fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(sidebarGroupForText(view.container, "前端", 0)).toBeInTheDocument();
    });

    expect(view.getByRole("button", { name: "展开分组 未分组仓库" })).toBeInTheDocument();
    await toggleSidebarRepoGroup(view, "未分组仓库");
    expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();

    await createSidebarRepoGroup(view, "后端");
    expect(view.getByRole("button", { name: "展开分组 未分组仓库" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "展开分组 前端" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "展开分组 后端" })).toBeInTheDocument();

    await fireEvent.click(view.getByRole("button", { name: "重命名分组 后端" }));
    await fireEvent.update(await view.findByRole("textbox", { name: "重命名分组" }), "前端");
    await fireEvent.keyDown(view.getByRole("textbox", { name: "重命名分组" }), { key: "Enter" });
    expect(await view.findByText("已存在同名仓库分组")).toBeInTheDocument();
  });

  it("仓库右键菜单可移动到分组并移回未分组", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    await createSidebarRepoGroup(view, "前端");
    await toggleSidebarRepoGroup(view, "未分组仓库");
    await moveSidebarRepoToGroup(view, "LiliaGithub", "前端");

    await waitFor(() => {
      expect(sidebarGroupForText(view.container, "未分组仓库", 1)).toBeInTheDocument();
      expect(sidebarGroupForText(view.container, "前端", 1)).toBeInTheDocument();
    });

    await toggleSidebarRepoGroup(view, "前端");
    await moveSidebarRepoToGroup(view, "LiliaGithub", "移到未分组");

    await waitFor(() => {
      expect(sidebarGroupForText(view.container, "未分组仓库", 2)).toBeInTheDocument();
      expect(sidebarGroupForText(view.container, "前端", 0)).toBeInTheDocument();
    });
  });

  it("首页入口可创建本地仓库并打开", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarGroupForText(view.container, "未分组仓库", 2)).toBeInTheDocument();
    });

    await selectHomeCreateRepoAction(view, "创建本地仓库");
    const dialog = await view.findByRole("dialog", { name: "新建本地仓库" });
    expect(within(dialog).getByRole("button", { name: /未分组仓库/ })).toBeInTheDocument();
    await fireEvent.update(within(dialog).getByLabelText("仓库名"), "local-new");
    await fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/repos/local-new");
      expect(sidebarRowForText(view.container, "local-new")).toBeInTheDocument();
      expect(sidebarGroupForText(view.container, "未分组仓库", 3)).toBeInTheDocument();
    });
  });

  it("首页入口可从 GitHub 模板创建远程仓库、克隆并归组", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarGroupForText(view.container, "未分组仓库", 2)).toBeInTheDocument();
    });

    await createSidebarRepoGroup(view, "前端");
    await selectHomeCreateRepoAction(view, "创建远程仓库");
    const dialog = await view.findByRole("dialog", { name: "新建 GitHub 仓库" });
    await within(dialog).findByRole("button", { name: /lilia-user · user/ });
    await selectCreateRepoGroup(view, dialog, "前端");
    await fireEvent.update(within(dialog).getByLabelText("仓库名"), "template-made");
    await fireEvent.click(within(dialog).getByLabelText("使用模板"));
    await fireEvent.update(within(dialog).getByLabelText("模板仓库"), "sena-nana/LiliaGithub");
    await fireEvent.click(within(dialog).getByRole("button", { name: "创建并克隆" }));

    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/repos/template-made");
      expect(sidebarGroupForText(view.container, "前端", 1)).toBeInTheDocument();
    });
    await toggleSidebarRepoGroup(view, "前端");
    expect(sidebarRowForText(view.container, "template-made")).toBeInTheDocument();
  });

  it("删除非空分组后仓库回到未分组", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    await createSidebarRepoGroup(view, "前端");
    await toggleSidebarRepoGroup(view, "未分组仓库");
    await moveSidebarRepoToGroup(view, "LiliaGithub", "前端");

    await waitFor(() => {
      expect(sidebarGroupForText(view.container, "未分组仓库", 1)).toBeInTheDocument();
      expect(sidebarGroupForText(view.container, "前端", 1)).toBeInTheDocument();
    });

    await fireEvent.click(view.getByRole("button", { name: "删除分组 前端" }));
    await fireEvent.click(view.getByRole("button", { name: "确认删除分组 前端" }));

    await waitFor(() => {
      expect(sidebarGroupForText(view.container, "未分组仓库", 2)).toBeInTheDocument();
      expect(() => sidebarGroupForText(view.container, "前端", 1)).toThrow("未找到侧边栏分组: 前端 1");
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

  it("侧边栏底部显示打开过的远程仓库并可移除跳转", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    state.settings = {
      ...state.settings!,
      remoteRepoShortcuts: [
        {
          fullName: "sena-nana/RemoteOnly",
          name: "RemoteOnly",
          private: true,
          archived: false,
          defaultBranch: "main",
          htmlUrl: "https://github.com/sena-nana/RemoteOnly",
          cloneUrl: "https://github.com/sena-nana/RemoteOnly.git",
          openedAt: 10,
        },
      ],
    };

    await waitFor(() => {
      expect(view.getByText("远程仓库 1")).toBeInTheDocument();
      expect(sidebarRowForText(view.container, "RemoteOnly")).toHaveAttribute("title", "sena-nana/RemoteOnly");
    });

    await fireEvent.click(sidebarRowForText(view.container, "RemoteOnly"));
    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/repos/github%3Asena-nana%2FRemoteOnly");
    });

    await fireEvent.click(view.getByRole("button", { name: "移除 sena-nana/RemoteOnly" }));
    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/");
      expect(() => sidebarRowForText(view.container, "RemoteOnly")).toThrow("未找到侧边栏行: RemoteOnly");
    });
  });

  it("侧边栏远程仓库在同名仓库已 clone 后自动去重", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    state.settings = {
      ...state.settings!,
      remoteRepoShortcuts: [
        {
          fullName: "sena-nana/RemoteOnly",
          name: "RemoteOnly",
          private: false,
          archived: false,
          defaultBranch: "main",
          htmlUrl: "https://github.com/sena-nana/RemoteOnly",
          cloneUrl: "https://github.com/sena-nana/RemoteOnly.git",
          openedAt: 10,
        },
      ],
    };
    state.repos = [
      ...state.repos,
      repoSummary("RemoteOnly", { githubFullName: "sena-nana/RemoteOnly" }),
    ];

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "RemoteOnly")).toHaveAttribute(
        "title",
        "sena-nana/RemoteOnly · C:\\Files\\workspace\\RemoteOnly",
      );
      expect(view.queryByText("远程仓库 1")).toBeNull();
    });
  });

  it("总览页一键同步运行中显示按钮和仓库行状态", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    state.bulkPreview = {
      operation: "sync",
      eligible: [{ repo: repoSummary("LiliaGithub", { ahead: 1 }), reason: "有本地提交待推送" }],
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
      const row = sidebarRowForText(view.container, "LiliaGithub");
      expect(within(row).getByLabelText("正在同步")).toBeInTheDocument();
      expect(within(row).queryByLabelText("同步失败")).not.toBeInTheDocument();
    });
  });

  it("首页仓库行显示最近同步失败并提供就地重试", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    state.recentSync = {
      preview: {
        operation: "sync",
        eligible: [{ repo: state.repos[0], reason: "有本地提交待推送" }],
        blocked: [],
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
      const row = repoStatusRowForText(view.container, "sena-nana/LiliaGithub");
      expect(within(row).getByLabelText("最近同步失败")).toHaveAttribute("title", "认证失败");
      expect(within(row).getByText("最近同步失败：认证失败")).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: "重试" })).toBeInTheDocument();
    });

    await fireEvent.click(within(repoStatusRowForText(view.container, "sena-nana/LiliaGithub")).getByRole("button", { name: "重试" }));

    await waitFor(() => {
      const row = repoStatusRowForText(view.container, "sena-nana/LiliaGithub");
      expect(within(row).queryByLabelText("最近同步失败")).toBeNull();
      expect(within(row).queryByRole("button", { name: "重试" })).toBeNull();
    });
  });

  it("侧边栏显示自动同步运行中的仓库行状态", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    state.syncingRepoIds = ["LiliaGithub"];

    await waitFor(() => {
      const row = sidebarRowForText(view.container, "LiliaGithub");
      expect(within(row).getByLabelText("正在同步")).toBeInTheDocument();
      expect(within(row).queryByLabelText("同步失败")).not.toBeInTheDocument();
    });
  });

  it("进程停止后移除侧边栏 RUN 标签", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    state.launchStatuses.LiliaGithub = {
      repoId: "LiliaGithub",
      state: "running",
      pid: 1,
      command: "yarn dev",
      startedAt: 1,
      exitCode: null,
      error: null,
    };

    await waitFor(() => {
      expect(within(sidebarRowForText(view.container, "LiliaGithub")).getByText("RUN")).toBeInTheDocument();
    });

    await waitFor(() => {
      window.dispatchEvent(
        new CustomEvent(REPO_LAUNCH_STATUS_EVENT, {
          detail: {
            repoId: "LiliaGithub",
            state: "exited",
            pid: null,
            command: "yarn dev",
            startedAt: 1,
            exitCode: 0,
            error: null,
          },
        }),
      );
      expect(within(sidebarRowForText(view.container, "LiliaGithub")).queryByText("RUN")).toBeNull();
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
      const row = sidebarRowForText(view.container, "LiliaGithub");
      expect(within(row).getByLabelText("最近同步失败")).toHaveAttribute("title", "认证失败");
      expect(within(row).getByRole("button", { name: "重试最近同步失败" })).toBeInTheDocument();
    });
  });

  it("侧边栏直接显示自动同步跳过原因且不提供重试", async () => {
    const view = await renderAppShell("/repos/LiliaGithub");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    setRepoActionError("LiliaGithub", "存在未提交变更，已跳过自动同步");

    await waitFor(() => {
      const row = sidebarRowForText(view.container, "LiliaGithub");
      expect(within(row).getByLabelText("自动同步已跳过")).toHaveAttribute(
        "title",
        "存在未提交变更，已跳过自动同步",
      );
      expect(within(row).queryByRole("button", { name: "重试最近同步失败" })).toBeNull();
    });
  });

  it("侧边栏显示单仓库操作失败结果", async () => {
    const view = await renderAppShell("/repos/LiliaGithub");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    setRepoActionError("LiliaGithub", "合并失败：not something we can merge");

    await waitFor(() => {
      expect(
        within(sidebarRowForText(view.container, "LiliaGithub")).getByLabelText("仓库操作失败"),
      ).toHaveAttribute("title", "合并失败：not something we can merge");
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

  it("总览页搜索可过滤本地仓库并回车跳转首个结果", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
      expect(sidebarRowForText(view.container, "Lilia")).toBeInTheDocument();
    });

    await fireEvent.click(within(view.getByLabelText("项目总览操作")).getByRole("button", { name: "搜索" }));
    const search = view.getByRole("searchbox", { name: "搜索仓库" });
    await fireEvent.update(search, "sena-nana/LiliaGithub");

    await waitFor(() => {
      expect(
        within(view.getByRole("listbox", { name: "仓库搜索结果" })).getByRole("option", {
          name: "打开本地仓库 LiliaGithub",
        }),
      ).toBeInTheDocument();
    });

    await fireEvent.keyDown(search, { key: "Enter" });

    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub");
    });
  });

  it("总览页搜索可打开远程账号仓库", async () => {
    workspaceFallback.setFallbackGitHubRepoPagesForTests([
      {
        items: [githubRepoSummary("sena-nana/PageOne")],
        nextPage: 2,
      },
      {
        items: [githubRepoSummary("sena-nana/RemoteOnly")],
        nextPage: null,
      },
    ]);
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    await fireEvent.click(within(view.getByLabelText("项目总览操作")).getByRole("button", { name: "搜索" }));
    const search = view.getByRole("searchbox", { name: "搜索仓库" });
    await fireEvent.update(search, "RemoteOnly");

    const result = await waitFor(() =>
      within(view.getByRole("listbox", { name: "仓库搜索结果" })).getByRole("option", {
        name: "打开远程仓库 sena-nana/RemoteOnly",
      })
    );
    await fireEvent.click(result);

    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/repos/github%3Asena-nana%2FRemoteOnly");
    });
  });

  it("总览页搜索同名仓库时本地优先并去掉远程重复项", async () => {
    workspaceFallback.setFallbackGitHubRepoPagesForTests([
      {
        items: [githubRepoSummary("sena-nana/LiliaGithub")],
        nextPage: null,
      },
    ]);
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    await fireEvent.click(within(view.getByLabelText("项目总览操作")).getByRole("button", { name: "搜索" }));
    const search = view.getByRole("searchbox", { name: "搜索仓库" });
    await fireEvent.update(search, "LiliaGithub");

    await waitFor(() => {
      const results = within(view.getByRole("listbox", { name: "仓库搜索结果" }));
      expect(results.getByRole("option", { name: "打开本地仓库 LiliaGithub" })).toBeInTheDocument();
      expect(results.queryByRole("option", { name: "打开远程仓库 sena-nana/LiliaGithub" })).toBeNull();
    });

    await fireEvent.keyDown(search, { key: "Enter" });

    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub");
    });
  });

  it("总览页搜索打开时侧边栏保持分组仓库树", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarGroupForText(view.container, "未分组仓库", 2)).toBeInTheDocument();
    });

    state.settings = {
      ...state.settings!,
      repoGroups: [
        {
          id: "frontend",
          name: "前端",
          repoIds: ["LiliaGithub"],
        },
      ],
    };

    await waitFor(() => {
      expect(sidebarGroupForText(view.container, "前端", 1)).toBeInTheDocument();
    });

    await fireEvent.click(within(view.getByLabelText("项目总览操作")).getByRole("button", { name: "搜索" }));
    const search = view.getByRole("searchbox", { name: "搜索仓库" });
    await fireEvent.update(search, "LiliaGithub");

    await waitFor(() => {
      expect(
        within(view.getByRole("listbox", { name: "仓库搜索结果" })).getByRole("option", {
          name: "打开本地仓库 LiliaGithub",
        }),
      ).toBeInTheDocument();
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
      expect(sidebarRowForText(view.container, "Lilia")).toBeInTheDocument();
      expect(sidebarGroupForText(view.container, "前端", 1)).toBeInTheDocument();
      expect(sidebarGroupForText(view.container, "未分组仓库", 1)).toBeInTheDocument();
      expect(view.queryByText(/^搜索结果/)).toBeNull();
    });
  });

  it("已绑定 GitHub 时克隆弹窗展示账号仓库列表并可选择克隆", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    await createSidebarRepoGroup(view, "前端");
    await openHomeCloneDialog(view, "前端");

    expect(view.getByRole("dialog", { name: "克隆仓库" })).toBeInTheDocument();
    const dialog = view.getByRole("dialog", { name: "克隆仓库" });
    const input = await view.findByPlaceholderText("搜索仓库，或直接输入 owner/repo");
    expect(view.getByText(/当前绑定账号：/)).toBeInTheDocument();

    await fireEvent.focus(input);
    expect(await within(dialog).findByText("sena-nana/Lilia")).toBeInTheDocument();

    await fireEvent.click(within(dialog).getByText("sena-nana/Lilia"));
    expect(view.getByPlaceholderText("默认从 URL 推导")).toHaveValue("Lilia");

    await fireEvent.click(view.getByRole("button", { name: "克隆" }));

    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/repos/Lilia");
      expect(sidebarGroupForText(view.container, "前端", 1)).toBeInTheDocument();
    });
  });

  it("首页入口可打开克隆仓库入口并按分组归位", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    await createSidebarRepoGroup(view, "前端");
    await openHomeCloneDialog(view, "前端");
    const dialog = await view.findByRole("dialog", { name: "克隆仓库" });
    const input = await within(dialog).findByPlaceholderText("搜索仓库，或直接输入 owner/repo");

    await fireEvent.update(input, "sena-nana/HomeClone");
    await waitFor(() => {
      expect(within(dialog).getByText("直接克隆 sena-nana/HomeClone")).toBeInTheDocument();
      expect(within(dialog).getByPlaceholderText("默认从 URL 推导")).toHaveValue("HomeClone");
    });
    await fireEvent.click(within(dialog).getByRole("button", { name: "克隆" }));

    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/repos/HomeClone");
      expect(sidebarGroupForText(view.container, "前端", 1)).toBeInTheDocument();
    });
    await toggleSidebarRepoGroup(view, "前端");
    expect(sidebarRowForText(view.container, "HomeClone")).toBeInTheDocument();
  });

  it("已绑定 GitHub 时支持 owner/repo 直接克隆", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    await openHomeCloneDialog(view);
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

  it("已绑定 GitHub 时支持完整 GitHub 链接直接克隆", async () => {
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    await openHomeCloneDialog(view);
    const input = await view.findByPlaceholderText("搜索仓库，或直接输入 owner/repo");

    await fireEvent.update(input, "https://github.com/meijustory123/TapdClient");
    await waitFor(() => {
      expect(view.getByText("直接克隆 meijustory123/TapdClient")).toBeInTheDocument();
      expect(view.getByPlaceholderText("默认从 URL 推导")).toHaveValue("TapdClient");
    });

    await fireEvent.update(input, "https://github.com/meijustory123/TapdClient.git");
    await waitFor(() => {
      expect(view.getByText("直接克隆 meijustory123/TapdClient")).toBeInTheDocument();
      expect(view.getByPlaceholderText("默认从 URL 推导")).toHaveValue("TapdClient");
    });
    await fireEvent.click(view.getByRole("button", { name: "克隆" }));

    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/repos/TapdClient");
      expect(sidebarRowForText(view.container, "TapdClient")).toBeInTheDocument();
    });
  });

  it("GitHub 仓库列表绑定失效时提供重新绑定入口", async () => {
    workspaceFallback.setFallbackGitHubReposErrorForTests("GitHub 绑定已失效，请重新绑定");
    const view = await renderAppShell("/");

    await waitFor(() => {
      expect(sidebarRowForText(view.container, "LiliaGithub")).toBeInTheDocument();
    });

    await openHomeCloneDialog(view);

    expect(await view.findByText("GitHub 绑定已失效，请重新绑定。")).toBeInTheDocument();
    const dialog = view.getByRole("dialog", { name: "克隆仓库" });
    await fireEvent.focus(view.getByPlaceholderText("搜索仓库，或直接输入 owner/repo"));
    expect(within(dialog).getByText("GitHub 绑定已失效，请重新绑定后再加载账号仓库。")).toBeInTheDocument();

    await fireEvent.click(view.getByRole("button", { name: "重新绑定 GitHub" }));

    await waitFor(() => {
      expect(view.router.currentRoute.value.path).toBe("/settings");
      expect(view.router.currentRoute.value.query.tab).toBe("repositories");
    });
  });

  it("未绑定 GitHub 时首页保持初始化页且不显示总览操作卡片", async () => {
    workspaceFallback.setFallbackGitHubBindingStatusForTests({
      state: "unbound",
      clientIdConfigured: true,
      clientIdSource: "bundled",
      binding: null,
    });
    const view = await renderAppShell("/");

    expect(await view.findByRole("heading", { level: 1, name: "LiliaGithub 初始化" })).toBeInTheDocument();
    expect(view.queryByLabelText("项目总览操作")).toBeNull();
    expect(view.queryByRole("navigation", { name: "主导航" })).toBeNull();

    await fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(view.queryByRole("dialog", { name: "命令入口" })).toBeNull();
    expect(view.queryByText("创建远程仓库")).toBeNull();
  });

  it("首页初始绑定会自动复制授权码并提示已复制", async () => {
    workspaceFallback.setFallbackGitHubBindingStatusForTests({
      state: "unbound",
      clientIdConfigured: true,
      clientIdSource: "bundled",
      binding: null,
    });
    const view = await renderAppShell("/");

    await fireEvent.click(view.getByRole("button", { name: "绑定 GitHub" }));

    expect(await view.findByText("授权码已复制，请在 GitHub 授权页粘贴。")).toBeInTheDocument();
    expect(view.getByText("ABCD-1234")).toBeInTheDocument();
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

  it("左上角按钮切换左侧栏折叠状态并写回本地存储", async () => {
    const view = await renderAppShell("/repos/LiliaGithub");
    const collapse = view.getByRole("button", { name: "折叠左侧栏" });

    expect(leftResizer(view.container)).not.toHaveAttribute("aria-disabled");
    expect(collapse).toHaveAttribute("aria-pressed", "false");

    await fireEvent.click(collapse);

    expect(leftResizer(view.container)).toHaveAttribute("aria-disabled", "true");
    expect(localStorage.getItem(SIDEBAR_CONFIG.collapsedStorageKey)).toBe("1");

    const expand = view.getByRole("button", { name: "展开左侧栏" });
    expect(expand).toHaveAttribute("aria-pressed", "true");

    await fireEvent.click(expand);

    expect(leftResizer(view.container)).not.toHaveAttribute("aria-disabled");
    expect(localStorage.getItem(SIDEBAR_CONFIG.collapsedStorageKey)).toBe("0");
  });

  it("左侧栏宽度可拖拽调整、写回存储并双击恢复默认", async () => {
    localStorage.setItem(SIDEBAR_CONFIG.widthStorageKey, "260");
    const view = await renderAppShell("/repos/LiliaGithub");
    const resizer = leftResizer(view.container);

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

    expect(resizer).toHaveAttribute("aria-valuenow", "360");

    await fireEvent.pointerUp(window, {
      clientX: 300,
      pointerId: 1,
    });

    expect(localStorage.getItem(SIDEBAR_CONFIG.widthStorageKey)).toBe("360");

    await fireEvent.dblClick(resizer);

    expect(localStorage.getItem(SIDEBAR_CONFIG.widthStorageKey)).toBe("220");
  });

  it("设置页替换左侧栏、禁用折叠并保留折叠偏好", async () => {
    localStorage.setItem(SIDEBAR_CONFIG.collapsedStorageKey, "1");
    const view = await renderAppShell("/settings");
    const leftToggle = view.getByRole("button", { name: "折叠左侧栏" });

    expect(leftToggle).toBeDisabled();
    expect(view.getByRole("navigation", { name: "设置分类" })).toBeInTheDocument();
    expect(view.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: /外观/ })).toHaveAttribute("aria-current", "page");
    expect(view.getByRole("button", { name: /仓库/ })).toBeInTheDocument();
    expect(view.router.currentRoute.value.meta.sidebar).toBe("settings");
    expect(view.router.currentRoute.value.meta.lockSidebar).toBe(true);
    expect(localStorage.getItem(SIDEBAR_CONFIG.collapsedStorageKey)).toBe("1");

    await fireEvent.click(view.getByRole("button", { name: /关于/ }));

    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/settings?tab=about");
    });
    expect(view.getByRole("button", { name: /关于/ })).toHaveAttribute("aria-current", "page");

    await fireEvent.click(view.getByRole("button", { name: /仓库/ }));
    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe("/settings?tab=repositories");
    });
    expect(view.getByRole("button", { name: /仓库/ })).toHaveAttribute("aria-current", "page");

    await view.router.push("/repos/LiliaGithub");
    expect(view.getByRole("button", { name: "展开左侧栏" })).toHaveAttribute("aria-pressed", "true");
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

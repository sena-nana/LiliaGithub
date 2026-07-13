import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { Settings } from "@lucide/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it } from "vitest";
import SidebarFooter from "../src/components/sidebar/SidebarFooter.vue";
import { resetWorkspaceStateForTests, setWorkspaceTasks } from "../src/composables/workspace/state";

function testRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/settings", component: { template: "<div />" } },
    ],
  });
}

async function renderFooter() {
  const router = testRouter();
  await router.push("/");
  await router.isReady();

  return render(SidebarFooter, {
    props: {
      status: {
        to: "/settings",
        label: "GitHub",
        title: "GitHub 已授权。点击进入设置。",
        tone: "ok",
        icon: Settings,
      },
    },
    global: {
      plugins: [router],
    },
  });
}

function fixedRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function setElementBox(element: HTMLElement, box: { width: number; height: () => number }) {
  Object.defineProperty(element, "offsetWidth", {
    configurable: true,
    get: () => box.width,
  });
  Object.defineProperty(element, "offsetHeight", {
    configurable: true,
    get: box.height,
  });
  element.getBoundingClientRect = () => fixedRect(0, 0, box.width, box.height());
}

function translateY(element: HTMLElement) {
  const translate = element.style.getPropertyValue("translate");
  const match = /(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px/.exec(translate);
  if (!match) throw new Error(`Missing translate style: ${translate}`);
  return Number(match[2]);
}

describe("SidebarFooter tasks", () => {
  afterEach(() => {
    resetWorkspaceStateForTests();
  });

  it("没有后台任务时不显示计数，悬浮时显示空状态", async () => {
    await renderFooter();

    const button = screen.getByRole("button", { name: "后台任务" });
    expect(within(button).queryByText("1")).not.toBeInTheDocument();

    await fireEvent.mouseEnter(button);

    const menu = await screen.findByRole("menu", { name: "后台任务" });
    expect(within(menu).getByText("暂无后台任务")).toBeInTheDocument();
  });

  it("显示后台任务计数并在悬浮时渲染单行任务", async () => {
    const now = Date.now();
    setWorkspaceTasks([{
      id: "push-task",
      kind: "git",
      title: "推送当前分支",
      repoId: "LiliaGithub",
      message: "main",
      priority: "high",
      status: "running",
      cancellable: false,
      createdAt: now,
      updatedAt: now,
    }]);
    await renderFooter();

    const button = screen.getByRole("button", { name: "后台任务" });
    expect(within(button).getByText("1")).toBeInTheDocument();

    await fireEvent.mouseEnter(button);

    const menu = await screen.findByRole("menu", { name: "后台任务" });
    const runningTask = within(menu).getByText("推送当前分支").closest('[role="menuitem"]');
    expect(runningTask).not.toHaveAttribute("title");
    expect(within(menu).getByText("LiliaGithub")).toBeInTheDocument();
    expect(within(menu).getByRole("img", { name: "进行中" })).toBeInTheDocument();
    expect(within(menu).queryByText("main")).not.toBeInTheDocument();

    await fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "后台任务" })).not.toBeInTheDocument();
    });
  });

  it("只显示后端报告的等待中与运行中任务", async () => {
    const now = Date.now();
    setWorkspaceTasks([{
      id: "pending-task",
      kind: "discoverRepos",
      title: "发现工作区仓库",
      priority: "normal",
      repoId: null,
      status: "pending",
      message: "等待发现",
      cancellable: true,
      createdAt: now,
      updatedAt: now,
    }, {
      id: "finished-task",
      kind: "git",
      title: "提交变更",
      priority: "high",
      repoId: "LiliaGithub",
      status: "success",
      message: "已完成",
      cancellable: false,
      createdAt: now - 1,
      updatedAt: now,
    }]);
    await renderFooter();

    const button = screen.getByRole("button", { name: "后台任务" });
    expect(within(button).getByText("1")).toBeInTheDocument();

    await fireEvent.mouseEnter(button);

    const menu = await screen.findByRole("menu", { name: "后台任务" });
    expect(within(menu).getByText("发现工作区仓库")).toBeInTheDocument();
    expect(within(menu).queryByText("提交变更")).not.toBeInTheDocument();
    expect(within(menu).getByText("工作区")).toBeInTheDocument();
    expect(within(menu).getByRole("img", { name: "等待中" })).toBeInTheDocument();
    expect(within(menu).queryByText("等待发现")).not.toBeInTheDocument();
  });

  it("任务项删除后弹层按底部锚点向下收缩", async () => {
    const now = Date.now();
    setWorkspaceTasks([
      {
        id: "push-task",
        kind: "git",
        title: "推送当前分支",
        repoId: "LiliaGithub",
        priority: "high",
        status: "running",
        message: null,
        cancellable: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "refresh-task",
        kind: "sync",
        title: "刷新仓库状态",
        repoId: "LiliaGithub",
        priority: "normal",
        status: "pending",
        message: null,
        cancellable: true,
        createdAt: now + 1,
        updatedAt: now + 1,
      },
    ]);
    await renderFooter();

    const button = screen.getByRole("button", { name: "后台任务" });
    button.getBoundingClientRect = () => fixedRect(24, 320, 26, 26);

    await fireEvent.mouseEnter(button);

    const menu = await screen.findByRole("menu", { name: "后台任务" });
    setElementBox(menu, {
      width: 280,
      height: () => 8 + menu.querySelectorAll('[role="menuitem"]').length * 34,
    });
    window.dispatchEvent(new Event("resize"));

    await waitFor(() => {
      expect(translateY(menu)).toBeLessThan(320);
    });
    const initialHeight = menu.offsetHeight;
    const initialTop = translateY(menu);
    const initialBottom = translateY(menu) + initialHeight;

    setWorkspaceTasks([{
      id: "refresh-task",
      kind: "sync",
      title: "刷新仓库状态",
      repoId: "LiliaGithub",
      priority: "normal",
      status: "success",
      message: "已完成",
      cancellable: false,
      createdAt: now + 1,
      updatedAt: now + 2,
    }]);

    await waitFor(() => {
      expect(within(menu).queryByText("刷新仓库状态")).not.toBeInTheDocument();
      expect(translateY(menu)).toBeGreaterThan(initialTop);
    });
    expect(within(menu).getByText("推送当前分支")).toBeInTheDocument();
    expect(translateY(menu) + menu.offsetHeight).toBeCloseTo(initialBottom);
  });
});

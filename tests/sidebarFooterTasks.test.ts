import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { Settings } from "@lucide/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it } from "vitest";
import SidebarFooter from "../src/components/sidebar/SidebarFooter.vue";
import {
  beginBackgroundTask,
  clearFrontendBackgroundTasksForTests,
  completeBackgroundTask,
  failBackgroundTask,
} from "../src/composables/useBackgroundTasks";
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

describe("SidebarFooter tasks", () => {
  afterEach(() => {
    clearFrontendBackgroundTasksForTests();
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
    beginBackgroundTask({
      kind: "git",
      title: "推送当前分支",
      repoName: "LiliaGithub",
      detail: "main",
      priority: "high",
    });
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

  it("显示任务完成、失败和等待状态", async () => {
    const completedTaskId = beginBackgroundTask({
      kind: "git",
      title: "提交变更",
      repoName: "LiliaGithub",
      priority: "high",
    });
    completeBackgroundTask(completedTaskId);
    const failedTaskId = beginBackgroundTask({
      kind: "git",
      title: "推送当前分支",
      repoName: "LiliaGithub",
      priority: "high",
    });
    failBackgroundTask(failedTaskId, "远端拒绝推送");
    setWorkspaceTasks([{
      id: "pending-task",
      kind: "discoverRepos",
      priority: "normal",
      repoId: null,
      status: "pending",
      message: "等待发现",
      updatedAt: Date.now(),
    }]);
    await renderFooter();

    const button = screen.getByRole("button", { name: "后台任务" });
    expect(within(button).queryByText("2")).not.toBeInTheDocument();
    expect(button.querySelector(".sb-tasks__badge--failed")).toBeInstanceOf(HTMLElement);

    await fireEvent.mouseEnter(button);

    const menu = await screen.findByRole("menu", { name: "后台任务" });
    expect(within(menu).getByText("提交变更")).toBeInTheDocument();
    expect(within(menu).getByRole("img", { name: "已完成" })).toBeInTheDocument();
    const failedTask = within(menu).getByText("推送当前分支").closest('[role="menuitem"]');
    expect(failedTask).toHaveAttribute("title", "失败：远端拒绝推送");
    expect(within(menu).getByRole("img", { name: "失败" })).toBeInTheDocument();
    expect(within(menu).queryByText("失败：远端拒绝推送")).not.toBeInTheDocument();
    expect(within(menu).getByText("发现工作区仓库")).toBeInTheDocument();
    expect(within(menu).getByText("工作区")).toBeInTheDocument();
    expect(within(menu).getByRole("img", { name: "等待中" })).toBeInTheDocument();
    expect(within(menu).queryByText("等待发现")).not.toBeInTheDocument();
  });
});

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
  });

  it("没有后台任务时不显示计数，悬浮时显示空状态", async () => {
    await renderFooter();

    const button = screen.getByRole("button", { name: "后台任务" });
    expect(within(button).queryByText("1")).not.toBeInTheDocument();

    await fireEvent.mouseEnter(button);

    const menu = await screen.findByRole("menu", { name: "后台任务" });
    expect(within(menu).getByText("暂无后台任务")).toBeInTheDocument();
  });

  it("显示后台任务计数并在悬浮时渲染任务卡片", async () => {
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
    expect(within(menu).getByText("推送当前分支")).toBeInTheDocument();
    expect(within(menu).getByText("LiliaGithub")).toBeInTheDocument();
    expect(within(menu).getByText("main")).toBeInTheDocument();

    await fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "后台任务" })).not.toBeInTheDocument();
    });
  });

  it("显示任务完成和失败状态", async () => {
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
    await renderFooter();

    const button = screen.getByRole("button", { name: "后台任务" });
    expect(within(button).getByText("2")).toBeInTheDocument();

    await fireEvent.mouseEnter(button);

    const menu = await screen.findByRole("menu", { name: "后台任务" });
    expect(within(menu).getByText("提交变更")).toBeInTheDocument();
    expect(within(menu).getAllByText(/已完成/).length).toBeGreaterThan(0);
    expect(within(menu).getByText("推送当前分支")).toBeInTheDocument();
    expect(within(menu).getByText("失败：远端拒绝推送")).toBeInTheDocument();
  });
});

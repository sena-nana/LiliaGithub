import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { createMemoryHistory } from "vue-router";
import { describe, expect, it } from "vitest";
import App from "../src/App.vue";
import { createLiliaGithubRouter } from "../src/router";

async function renderAt(path: string) {
  const router = createLiliaGithubRouter(createMemoryHistory());
  await router.push(path);
  await router.isReady();

  render(App, {
    global: {
      plugins: [router],
    },
  });
}

describe("基础路由", () => {
  it("默认首页显示 Git 项目总览", async () => {
    await renderAt("/");

    expect(
      await screen.findByRole("heading", { level: 1, name: "项目总览" }),
    ).toBeInTheDocument();
    expect(screen.getByText("最近工作结果")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "一键拉取" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "一键推送" })).toBeInTheDocument();
  });

  it("侧边栏左下角提供设置、扩展和 GitHub 状态入口", async () => {
    await renderAt("/");

    expect(screen.getAllByRole("link", { name: "设置" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "扩展" })).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: "GitHub 已授权。点击进入设置。" }),
    ).toHaveClass("sb-conn--ok");
  });

  it("仓库详情页提供变更、历史、分支和提交视图", async () => {
    await renderAt("/repos/LiliaGithub");

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
    expect(screen.getByText("快速启动")).toBeInTheDocument();
    expect(await screen.findByText("yarn tauri:dev")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "变更" })).toHaveClass("is-active");
    expect(screen.getByText("src/pages/Home.vue")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("tab", { name: "历史" }));
    expect(screen.getByText("搭建 LiliaGithub MVP")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("tab", { name: "分支" }));
    expect(screen.getByText("origin/main")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("tab", { name: "提交" }));
    expect(screen.getByPlaceholderText("提交说明")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();
  });

  it("仓库详情页可配置、运行并查看快速启动终端", async () => {
    await renderAt("/repos/LiliaGithub");

    expect(await screen.findByText("yarn tauri:dev")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "启动配置" }));
    await fireEvent.update(screen.getByPlaceholderText("例如 yarn tauri:dev"), "yarn dev --host 127.0.0.1");
    await fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => {
      expect(screen.getByText("yarn dev --host 127.0.0.1")).toBeInTheDocument();
    });
    expect(screen.getByText(/手动配置/)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "运行" }));

    await waitFor(() => {
      expect(screen.getByText(/启动命令：yarn dev --host 127.0.0.1/)).toBeInTheDocument();
      expect(screen.getByText(/开发服务已启动/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "停止" })).toBeEnabled();
  });

  it("总览页批量同步先展示预检再执行", async () => {
    await renderAt("/");

    await fireEvent.click(await screen.findByRole("button", { name: "一键推送" }));

    expect(await screen.findByRole("dialog", { name: "批量同步预检" })).toBeInTheDocument();
    expect(screen.getByText("一键推送预检")).toBeInTheDocument();
    expect(screen.getByText("有本地提交待推送")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "确认执行" }));

    await waitFor(() => {
      expect(screen.getByText(/LiliaGithub · success · 完成/)).toBeInTheDocument();
    });
  });

  it("设置页默认显示外观设置并使用设置侧栏", async () => {
    await renderAt("/settings");

    expect(await screen.findByRole("heading", { level: 1, name: "外观" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "设置分类" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /外观/ })).toHaveClass("is-active");
    expect(screen.queryByText(/Claude|Codex|CC-Switch|agent/i)).toBeNull();
  });

  it("设置页可通过 tab query 显示关于页，未知 tab 回落外观", async () => {
    await renderAt("/settings?tab=about");

    expect(await screen.findByRole("heading", { level: 1, name: "关于" })).toBeInTheDocument();
    expect(await screen.findByText("Tauri 2 + Vue 3")).toBeInTheDocument();
  });

  it("扩展页显示模板占位内容", async () => {
    await renderAt("/plugins");

    expect(await screen.findByRole("heading", { level: 1, name: "扩展" })).toBeInTheDocument();
    expect(screen.getByText("当前模板不包含 Lilia 的真实插件管理逻辑。")).toBeInTheDocument();
  });

  it("未知路由回到首页", async () => {
    await renderAt("/missing");

    expect(await screen.findByRole("heading", { level: 1, name: "项目总览" })).toBeInTheDocument();
  });

  it("未知设置 tab 回落到外观", async () => {
    await renderAt("/settings?tab=missing");

    expect(await screen.findByRole("heading", { level: 1, name: "外观" })).toBeInTheDocument();
  });
});

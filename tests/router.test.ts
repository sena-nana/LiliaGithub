import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory } from "vue-router";
import { describe, expect, it } from "vitest";
import App from "../src/App.vue";
import { vContextMenu } from "../src/directives/contextMenu";
import { createLiliaGithubRouter } from "../src/router";

async function renderAt(path: string) {
  const router = createLiliaGithubRouter(createMemoryHistory());
  await router.push(path);
  await router.isReady();

  render(App, {
    global: {
      plugins: [router],
      directives: {
        contextMenu: vContextMenu,
      },
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
    expect(screen.getAllByRole("button", { name: "一键推送" })).toHaveLength(2);
  });

  it("侧边栏左下角提供设置、扩展和 GitHub 状态入口", async () => {
    await renderAt("/");

    expect(
      await screen.findByRole("link", { name: "GitHub 已授权。点击进入设置。" }),
    ).toHaveClass("sb-conn--ok");
    expect(screen.getAllByRole("link", { name: "设置" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "扩展" })).toBeInTheDocument();
  });

  it("仓库详情页提供变更、历史、分支和提交视图", async () => {
    await renderAt("/repos/LiliaGithub");

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
    expect(screen.getByLabelText("仓库状态条")).toBeInTheDocument();
    expect(screen.getByText("仓库健康")).toBeInTheDocument();
    expect(screen.getByText("快速启动")).toBeInTheDocument();
    expect(screen.getByText("提交并推送")).toBeInTheDocument();
    expect(await screen.findByText("yarn tauri:dev")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "变更" })).toHaveClass("is-active");
    expect(screen.getByText("src/pages/Home.vue")).toBeInTheDocument();
    expect(screen.getByLabelText("变更预览")).toBeInTheDocument();
    expect(screen.getByText("当前没有可展示的差异内容。")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("提交说明")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();
    expect(screen.getByText("未选择文件")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: /src\/pages\/Home\.vue已暂存/ }));
    const diffPreview = await screen.findByLabelText("变更预览");
    expect(diffPreview).toBeInTheDocument();
    expect(diffPreview).toHaveTextContent("@@ -1 +1 @@");

    await fireEvent.click(screen.getByRole("tab", { name: "历史" }));
    expect(screen.getAllByText("搭建 LiliaGithub MVP").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("提交历史和分支树")).toBeInTheDocument();
    expect(screen.getByLabelText("历史和分支树")).toBeInTheDocument();
    expect(screen.getByLabelText("提交历史密集列表")).toBeInTheDocument();
    expect(screen.getAllByLabelText("提交图谱").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("1234567")).toBeInTheDocument();
    expect(screen.getAllByText("HEAD -> main").length).toBeGreaterThanOrEqual(1);

    await fireEvent.click(screen.getByRole("tab", { name: "分支" }));
    expect(screen.getByText("origin/main")).toBeInTheDocument();
  });

  it("提交历史行点击后进入提交详情页", async () => {
    await renderAt("/repos/LiliaGithub");

    await fireEvent.click(await screen.findByRole("tab", { name: "历史" }));
    await fireEvent.click(screen.getByRole("button", { name: /搭建 LiliaGithub MVP/ }));

    expect(await screen.findByRole("heading", { level: 1, name: "搭建 LiliaGithub MVP" })).toBeInTheDocument();
    expect(screen.getByLabelText("提交元数据")).toHaveTextContent("1234567890abcdef");
    expect(screen.getByLabelText("改动文件列表")).toHaveTextContent("src-tauri/src/workspace.rs");
  });

  it("提交详情页可通过独立路由打开并返回仓库历史", async () => {
    await renderAt("/repos/LiliaGithub/commits/1234567890abcdef");

    expect(await screen.findByRole("heading", { level: 1, name: "搭建 LiliaGithub MVP" })).toBeInTheDocument();
    expect(screen.getByText("改动文件")).toBeInTheDocument();
    expect(screen.getByText("+42")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("link", { name: "返回历史" }));

    expect(await screen.findByRole("tab", { name: "历史" })).toHaveClass("is-active");
    expect(await screen.findByLabelText("提交历史密集列表")).toBeInTheDocument();
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
    expect(screen.getAllByText(/手动配置/).length).toBeGreaterThanOrEqual(1);

    await fireEvent.click(screen.getByRole("button", { name: "运行" }));

    await waitFor(() => {
      expect(screen.getByText(/启动命令：yarn dev --host 127.0.0.1/)).toBeInTheDocument();
      expect(screen.getByText(/开发服务已启动/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "停止" })).toBeEnabled();
  });

  it("总览页一键推送先打开预检弹层并展示 push 可执行项", async () => {
    await renderAt("/");

    const pushButtons = await screen.findAllByRole("button", { name: "一键推送" });
    await fireEvent.click(pushButtons[1]);

    expect(await screen.findByRole("dialog", { name: "批量同步预检" })).toBeInTheDocument();
    expect(screen.getByText("一键推送预检")).toBeInTheDocument();
    expect(screen.getByText("可执行")).toBeInTheDocument();
    expect(screen.getByText("阻止")).toBeInTheDocument();
    expect(screen.getByText("提示")).toBeInTheDocument();
  });

  it("批量推送失败关闭预检后仍可从总览处理失败仓库", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackBulkExecuteOverrideForTests((operation, repoIds) =>
      repoIds.map((repoId) => ({
        repoId,
        status: repoId === "LiliaGithub" && operation === "push" ? "error" : "success",
        message: repoId === "LiliaGithub" && operation === "push" ? "认证失败" : "完成",
        summary: repoId === "LiliaGithub" && operation === "push" ? null : {
          id: repoId,
          name: repoId,
          path: `C:\\Files\\workspace\\${repoId}`,
          relativePath: repoId,
          currentBranch: "main",
          remoteUrl: `https://github.com/sena-nana/${repoId}.git`,
          githubFullName: `sena-nana/${repoId}`,
          ahead: 0,
          behind: 0,
          stagedCount: 0,
          unstagedCount: 0,
          untrackedCount: 0,
          lastCommitAt: null,
          lastCommitMessage: null,
        },
      })),
    );
    await renderAt("/");

    const pushButtons = await screen.findAllByRole("button", { name: "一键推送" });
    await fireEvent.click(pushButtons[1]);
    await fireEvent.click(await screen.findByRole("button", { name: "确认执行" }));

    const dialog = await screen.findByRole("dialog", { name: "批量同步预检" });
    expect(await within(dialog).findByText("认证失败")).toBeInTheDocument();
    await fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));

    expect(screen.queryByRole("dialog", { name: "批量同步预检" })).toBeNull();
    expect(screen.getByLabelText("最近推送失败")).toHaveTextContent("认证失败");
    expect(screen.getByLabelText("最近推送失败")).toHaveTextContent("执行失败");

    const failedRow = screen.getByText("执行失败 · 认证失败").closest("li");
    if (!(failedRow instanceof HTMLElement)) throw new Error("未找到推送失败行");
    await fireEvent.click(within(failedRow).getByRole("link", { name: "详情" }));
    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("link", { name: "概览" }));
    expect(await screen.findByRole("heading", { level: 1, name: "项目总览" })).toBeInTheDocument();
    service.setFallbackBulkExecuteOverrideForTests(null);
    const retryRow = screen.getByText("执行失败 · 认证失败").closest("li");
    if (!(retryRow instanceof HTMLElement)) throw new Error("未找到可重试推送失败行");
    await fireEvent.click(within(retryRow).getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(screen.queryByText("认证失败")).toBeNull();
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

  it("设置页仓库 tab 可恢复隐藏仓库", async () => {
    const service = await import("../src/services/workspace");
    await service.hideRepo("LiliaGithub");

    await renderAt("/settings?tab=repositories");

    expect(await screen.findByRole("heading", { level: 1, name: "仓库" })).toBeInTheDocument();
    expect(await screen.findByText("LiliaGithub")).toBeInTheDocument();

    await fireEvent.click(await screen.findByRole("button", { name: "恢复管理" }));

    await waitFor(() => {
      expect(screen.getByText("没有隐藏仓库。")).toBeInTheDocument();
    });
    expect((await service.scanRepos()).some((repo) => repo.id === "LiliaGithub")).toBe(true);
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

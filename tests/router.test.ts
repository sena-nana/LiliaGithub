import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import App from "../src/App.vue";
import { vContextMenu } from "../src/directives/contextMenu";
import { createLiliaGithubRouter } from "../src/router";
import type { RepoConflictState } from "../src/services/workspace";
import { conflictState, repoSummary } from "./fixtures/workspace";
import { useWorkspace } from "../src/composables/useWorkspace";

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

  return { router };
}

async function overrideLiliaConflict(conflict: RepoConflictState) {
  const service = await import("../src/services/workspace");
  service.setFallbackConflictOverrideForTests((repoId) => repoId === "Lilia" ? conflict : null);
}

async function clickOverviewSync() {
  const syncButtons = await screen.findAllByRole("button", { name: "一键同步" });
  await fireEvent.click(syncButtons[1]);
}

async function mockLiliaGithubSyncFailure() {
  const service = await import("../src/services/workspace");
  service.setFallbackBulkExecuteOverrideForTests((operation, repoIds) =>
    repoIds.map((repoId) => ({
      repoId,
      status: repoId === "LiliaGithub" && operation === "sync" ? "error" : "success",
      message: repoId === "LiliaGithub" && operation === "sync" ? "认证失败" : "完成",
      summary: repoId === "LiliaGithub" && operation === "sync" ? null : repoSummary(repoId),
    })),
  );
  return service;
}

describe("基础路由", () => {
  it("默认首页显示 Git 项目总览", async () => {
    await renderAt("/");

    expect(
      await screen.findByRole("heading", { level: 1, name: "项目总览" }),
    ).toBeInTheDocument();
    expect(screen.getByText("最近工作结果")).toBeInTheDocument();
    expect(await screen.findByLabelText("GitHub 提交贡献图")).toBeInTheDocument();
    expect(screen.getByText(/次提交，最近一年/)).toBeInTheDocument();
    expect(screen.getByText(/覆盖 2 个仓库 · 刷新于/)).toBeInTheDocument();
    expect(document.querySelector(".contribution-day[title$='次提交']")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "变更量排行" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "编程语言占比" })).toBeInTheDocument();
    expect(screen.getByLabelText("编程语言占比图")).toBeInTheDocument();
    expect(await screen.findByText(/HEAD 已提交文件 · 刷新于/)).toBeInTheDocument();
    expect(await screen.findByText("TypeScript")).toBeInTheDocument();
    expect(await screen.findByText("50%")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "含改动" }));
    expect(await screen.findByText(/包含未提交改动 · 刷新于/)).toBeInTheDocument();
    expect(await screen.findByText("49%")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "一键同步" })).toHaveLength(2);
  });

  it("首页 GitHub 贡献图支持空状态和错误重试", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackRepoContributionsOverrideForTests((repoFullNames) => ({
      days: [],
      meta: {
        repoCount: repoFullNames.length,
        requestedRepoCount: repoFullNames.length,
        repoLimit: 30,
        truncated: false,
        refreshedAt: 1_780_000_000_000,
      },
    }));

    await renderAt("/");

    expect(await screen.findByText("暂无 GitHub 提交")).toBeInTheDocument();

    service.setFallbackRepoContributionsOverrideForTests(() => {
      throw new Error("rate limited");
    });
    await fireEvent.click(screen.getByRole("button", { name: "刷新" }));

    expect(await screen.findByText("Error: rate limited")).toBeInTheDocument();

    service.setFallbackRepoContributionsOverrideForTests((repoFullNames) => ({
      days: [{ date: "2026-06-11", count: 4 }],
      meta: {
        repoCount: repoFullNames.length,
        requestedRepoCount: repoFullNames.length,
        repoLimit: 30,
        truncated: false,
        refreshedAt: 1_780_000_000_000,
      },
    }));
    await fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByLabelText("2026-06-11：4 次提交")).toBeInTheDocument();
  });

  it("首页 GitHub 贡献图命中仓库采样上限时显示提示", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackRepoContributionsOverrideForTests((repoFullNames) => ({
      days: [{ date: "2026-06-11", count: 1 }],
      meta: {
        repoCount: 30,
        requestedRepoCount: repoFullNames.length,
        repoLimit: 30,
        truncated: true,
        refreshedAt: 1_780_000_000_000,
      },
    }));
    for (let index = 0; index < 31; index += 1) {
      await service.cloneRepo(`https://github.com/sena-nana/sample-${index}.git`);
    }

    await renderAt("/");

    expect(await screen.findByText(/覆盖 30\/33 个仓库 · 仅统计前 30 个 · 刷新于/)).toBeInTheDocument();
  });

  it("首页 GitHub 贡献图默认定位到末尾并支持拖动横向浏览", async () => {
    const service = await import("../src/services/workspace");
    const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    const scrollWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    try {
      Object.defineProperty(HTMLElement.prototype, "clientWidth", {
        configurable: true,
        get() {
          return this.classList?.contains("contribution-scroll") ? 120 : 0;
        },
      });
      Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
        configurable: true,
        get() {
          return this.classList?.contains("contribution-scroll") ? 760 : 0;
        },
      });
      service.setFallbackRepoContributionsOverrideForTests(() => ({
        days: [{ date: "2025-01-01", count: 1 }],
        meta: {
          repoCount: 2,
          requestedRepoCount: 2,
          repoLimit: 30,
          truncated: false,
          refreshedAt: 1_780_000_000_000,
        },
      }));

      await renderAt("/");

      service.setFallbackRepoContributionsOverrideForTests(() => ({
        days: Array.from({ length: 371 }, (_, index) => ({
          date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
          count: index === 370 ? 4 : 0,
        })),
        meta: {
          repoCount: 2,
          requestedRepoCount: 2,
          repoLimit: 30,
          truncated: false,
          refreshedAt: 1_780_000_000_000,
        },
      }));

      await useWorkspace().refreshRepoContributions();
      const chart = await screen.findByLabelText("GitHub 提交贡献图");
      const scroller = chart.querySelector(".contribution-scroll");
      if (!(scroller instanceof HTMLElement)) throw new Error("未找到贡献图滚动容器");

      await waitFor(() => {
        expect(scroller.scrollLeft).toBe(640);
      });

      scroller.setPointerCapture = vi.fn();
      scroller.releasePointerCapture = vi.fn();
      scroller.hasPointerCapture = vi.fn(() => true);
      await fireEvent.pointerDown(scroller, { button: 0, clientX: 100, pointerId: 1 });
      await fireEvent.pointerMove(scroller, { clientX: 160, pointerId: 1 });

      expect(scroller.scrollLeft).toBe(580);
    } finally {
      if (clientWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidthDescriptor);
      }
      if (scrollWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, "scrollWidth", scrollWidthDescriptor);
      }
    }
  });

  it("侧边栏左下角提供设置和 GitHub 状态入口", async () => {
    await renderAt("/");

    expect(
      await screen.findByRole("link", { name: "GitHub 已授权。点击进入设置。" }),
    ).toHaveClass("sb-conn--ok");
    expect(screen.getAllByRole("link", { name: "设置" })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "扩展" })).toBeNull();
  });

  it("仓库详情页提供变更、历史、分支和提交视图", async () => {
    await renderAt("/repos/LiliaGithub");

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
    expect(screen.getByLabelText("仓库状态条")).toBeInTheDocument();
    expect(screen.getByText("仓库健康")).toBeInTheDocument();
    expect(screen.getByText("快速启动")).toBeInTheDocument();
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
    expect(screen.getAllByLabelText("提交图谱").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("1234567")).toBeInTheDocument();
    expect(screen.getAllByText("HEAD -> main").length).toBeGreaterThanOrEqual(1);

    await fireEvent.click(screen.getByRole("tab", { name: "分支" }));
    expect(screen.getByText("origin/main")).toBeInTheDocument();
  });

  it("冲突仓库默认进入冲突视图并支持分段处理入口", async () => {
    await renderAt("/repos/Lilia");

    expect(await screen.findByRole("heading", { level: 1, name: "Lilia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "处理冲突" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "冲突" })).toHaveClass("is-active");
    });
    const conflictPanel = screen.getByLabelText("冲突分段处理");
    expect(screen.getByText("合并冲突")).toBeInTheDocument();
    expect(within(conflictPanel).getByText("src/pages/TaskDetail.vue")).toBeInTheDocument();
    expect(within(conflictPanel).getByText("hunk-1")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "采用此段" }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: "解决并暂存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();

    await fireEvent.click(screen.getAllByRole("button", { name: "采用此段" })[0]);
    await fireEvent.click(screen.getAllByRole("button", { name: "采用此段" })[3]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "解决并暂存" })).toBeEnabled();
    });
  });

  it("整文件采用 ours 需要二次确认", async () => {
    await renderAt("/repos/Lilia");

    const firstButton = await screen.findByRole("button", { name: "整文件采用 ours" });
    await fireEvent.click(firstButton);

    expect(screen.getByRole("button", { name: "确认整文件采用 ours 并暂存" })).toBeInTheDocument();
  });

  it("rebase 冲突支持应用内继续和终止入口", async () => {
    await overrideLiliaConflict(conflictState({
      operation: "rebase",
      allResolved: false,
      files: [
        {
          path: "src/rebase.ts",
          status: "UU",
          resolved: false,
          binary: false,
          hunks: [
            {
              id: "hunk-1",
              startLine: 1,
              endLine: 5,
              oursLabel: "HEAD",
              theirsLabel: "feature",
              oursLines: ["ours"],
              theirsLines: ["theirs"],
            },
          ],
        },
      ],
    }));

    await renderAt("/repos/Lilia");

    expect(await screen.findByText("rebase 冲突")).toBeInTheDocument();
    expect(screen.queryByText(/第一版暂不支持/)).toBeNull();
    expect(screen.getByRole("button", { name: "继续 rebase" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "终止 rebase" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();
  });

  it("cherry-pick 冲突文件处理完后仍禁用普通提交并允许继续", async () => {
    await overrideLiliaConflict(conflictState({
      operation: "cherry-pick",
      allResolved: true,
      files: [],
    }));

    await renderAt("/repos/Lilia");

    expect(await screen.findByText("cherry-pick 冲突")).toBeInTheDocument();
    expect(screen.queryByText(/第一版暂不支持/)).toBeNull();
    expect(screen.getByText("冲突文件已处理，可继续当前操作。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "继续 cherry-pick" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "终止 cherry-pick" })).toBeEnabled();
    expect(screen.getByText("当前存在冲突，先完成冲突处理再提交。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();
  });

  it("提交历史行点击后进入提交详情页", async () => {
    await renderAt("/repos/LiliaGithub");

    await fireEvent.click(await screen.findByRole("tab", { name: "历史" }));
    await fireEvent.click(await screen.findByRole("button", { name: /搭建 LiliaGithub MVP/ }));

    expect(await screen.findByRole("heading", { level: 1, name: "搭建 LiliaGithub MVP" })).toBeInTheDocument();
    expect(screen.getByLabelText("提交元数据")).toHaveTextContent("1234567890abcdef");
    expect(screen.getByLabelText("改动文件 diff")).toHaveTextContent("src-tauri/src/workspace.rs");
    expect(screen.getByLabelText("改动文件 diff")).toHaveTextContent("@@ -10,4 +10,5 @@");
    expect(screen.getByLabelText("改动文件 diff")).toHaveTextContent("pub github_full_name: Option<String>,");
  });

  it("提交详情页可通过独立路由打开并返回仓库历史", async () => {
    await renderAt("/repos/LiliaGithub/commits/1234567890abcdef");

    expect(await screen.findByRole("heading", { level: 1, name: "搭建 LiliaGithub MVP" })).toBeInTheDocument();
    expect(screen.getByText("改动文件")).toBeInTheDocument();
    expect(screen.getAllByText("修改").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("+42")).toBeInTheDocument();
    expect(screen.getByText("-3")).toBeInTheDocument();
    expect(screen.getByText("@@ -1,3 +1,4 @@")).toBeInTheDocument();
    expect(screen.getByLabelText("改动文件 diff")).toHaveTextContent("<h1>LiliaGithub</h1>");

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

  it("总览页一键同步直接执行且不打开预检弹层", async () => {
    await renderAt("/");

    await clickOverviewSync();

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "批量同步预检" })).toBeNull();
    });
    expect(screen.queryByText("一键拉取预检")).toBeNull();
  });

  it("批量同步失败后从侧边栏进入项目详情处理失败仓库", async () => {
    const service = await mockLiliaGithubSyncFailure();
    await renderAt("/");

    await clickOverviewSync();

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "批量同步预检" })).toBeNull();
      expect(screen.queryByLabelText("最近同步失败")).toBeNull();
      expect(screen.getByLabelText("同步失败")).toHaveAttribute("title", "认证失败");
    });

    const failedLink = screen.getByLabelText("同步失败").closest("a");
    if (!(failedLink instanceof HTMLElement)) throw new Error("未找到同步失败仓库入口");
    await fireEvent.click(failedLink);
    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
    expect(screen.getByLabelText("最近同步失败")).toHaveTextContent("认证失败");

    service.setFallbackBulkExecuteOverrideForTests(null);
    await fireEvent.click(within(screen.getByLabelText("最近同步失败")).getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(screen.queryByText("认证失败")).toBeNull();
    });
  });

  it("总览页可直接进入最近同步失败仓库继续处理", async () => {
    await mockLiliaGithubSyncFailure();
    const { router } = await renderAt("/");

    await clickOverviewSync();

    await waitFor(() => {
      expect(screen.getByText("同步失败")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "处理失败" })).toHaveAttribute("title", "认证失败");
    });

    await fireEvent.click(screen.getByRole("link", { name: "处理失败" }));

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
    expect(router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub");
    expect(screen.getByLabelText("最近同步失败")).toHaveTextContent("认证失败");
  });

  it("总览页可直接进入冲突仓库的冲突处理视图", async () => {
    const { router } = await renderAt("/");

    expect(await screen.findByText("存在冲突")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("link", { name: "处理冲突" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Lilia" })).toBeInTheDocument();
    expect(router.currentRoute.value.fullPath).toBe("/repos/Lilia?tab=conflicts");
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "冲突" })).toHaveClass("is-active");
    });
  });

  it("总览页可直接进入待拉取仓库继续处理", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackBulkExecuteOverrideForTests((_operation, repoIds) =>
      repoIds.map((repoId) => ({
        repoId,
        status: "success",
        message: "完成",
        summary: repoId === "LiliaGithub"
          ? repoSummary(repoId, { ahead: 0, behind: 2 })
          : repoSummary(repoId),
      })),
    );
    const { router } = await renderAt("/");

    await clickOverviewSync();

    await waitFor(() => {
      expect(screen.getByText("待拉取")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "继续处理" })).toHaveAttribute("title", "远端领先 2 个提交");
    });

    await fireEvent.click(screen.getByRole("link", { name: "继续处理" }));

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
    expect(router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub");
    expect(screen.getByRole("button", { name: "Pull" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拉取并合并" })).toBeInTheDocument();
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
    expect((await service.refreshRepos()).some((repo) => repo.id === "LiliaGithub")).toBe(true);
  });

  it("未知路由回到首页", async () => {
    await renderAt("/missing");

    expect(await screen.findByRole("heading", { level: 1, name: "项目总览" })).toBeInTheDocument();
  });

  it("旧扩展路由回到首页", async () => {
    await renderAt("/plugins");

    expect(await screen.findByRole("heading", { level: 1, name: "项目总览" })).toBeInTheDocument();
  });

  it("未知设置 tab 回落到外观", async () => {
    await renderAt("/settings?tab=missing");

    expect(await screen.findByRole("heading", { level: 1, name: "外观" })).toBeInTheDocument();
  });
});

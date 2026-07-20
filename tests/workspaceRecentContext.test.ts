import { ref } from "vue";
import { createMemoryHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceRecentContextController,
  normalizeWorkspaceRecentContextRoute,
} from "../src/composables/useWorkspaceRecentContext";
import type { useWorkspace } from "../src/composables/useWorkspace";
import { createLiliaGithubRouter } from "../src/router";
import type { NamedWorkspace, WorkspaceRecentContextV1 } from "../src/services/workspace";

function namedWorkspace(id: string, recentContext: WorkspaceRecentContextV1 | null): NamedWorkspace {
  return {
    id,
    name: id,
    roots: [],
    recentContext,
  };
}

function workspaceHarness(
  active: NamedWorkspace,
  catalog: NamedWorkspace[],
  update = vi.fn(async (_workspaceId: string, _context: WorkspaceRecentContextV1 | null) => {}),
) {
  const activeWorkspace = ref<NamedWorkspace | null>(active);
  const workspaceCatalog = ref(catalog);
  const api = {
    activeWorkspace,
    workspaceCatalog,
    initialize: vi.fn(async () => {}),
    switchWorkspace: vi.fn(async (workspaceId: string) => {
      const target = workspaceCatalog.value.find((item) => item.id === workspaceId);
      if (!target) throw new Error("workspace missing");
      activeWorkspace.value = target;
    }),
    createWorkspace: vi.fn(async (name: string) => {
      const created = namedWorkspace(name, null);
      workspaceCatalog.value = [...workspaceCatalog.value, created];
      activeWorkspace.value = created;
    }),
    deleteWorkspace: vi.fn(async (workspaceId: string) => {
      workspaceCatalog.value = workspaceCatalog.value.filter((item) => item.id !== workspaceId);
      if (activeWorkspace.value?.id === workspaceId) activeWorkspace.value = workspaceCatalog.value[0] ?? null;
    }),
    updateWorkspaceRecentContext: update,
  };
  return { api: api as unknown as ReturnType<typeof useWorkspace>, activeWorkspace, update };
}

async function routerAt(path: string) {
  const router = createLiliaGithubRouter(createMemoryHistory());
  await router.push(path);
  await router.isReady();
  return router;
}

describe("workspace recent context", () => {
  it("只规范化可重建仓库路由并移除瞬时与未知状态", async () => {
    const router = await routerAt("/repos/repo-a?projectTab=issues&issue=42&issueState=closed&create=issue&dialog=1");
    expect(normalizeWorkspaceRecentContextRoute(router, router.currentRoute.value)).toBe(
      "/repos/repo-a?projectTab=issues&issue=42&issueState=closed",
    );

    await router.replace("/repos/repo-a/files?ref=feature%2Fdocs&file=docs%2Fguide.md&hash=install&expanded=src");
    expect(normalizeWorkspaceRecentContextRoute(router, router.currentRoute.value)).toBe(
      "/repos/repo-a/files?ref=feature/docs&file=docs/guide.md&hash=install",
    );

    await router.replace("/repos/repo-a/changes?change=src%2Fmain.ts&resolveConflicts=1");
    expect(normalizeWorkspaceRecentContextRoute(router, router.currentRoute.value)).toBe(
      "/repos/repo-a/changes?change=src/main.ts",
    );

    await router.replace(
      "/repos/repo-a?projectTab=discussions&discussion=8&discussionState=closed&discussionCategory=help&discussionAnswered=true&discussionSort=updated&discussionDirection=asc&create=discussion",
    );
    expect(normalizeWorkspaceRecentContextRoute(router, router.currentRoute.value)).toBe(
      "/repos/repo-a?projectTab=discussions&discussion=8&discussionState=closed&discussionCategory=help&discussionAnswered=true&discussionSort=updated&discussionDirection=asc",
    );

    await router.replace("/repos/repo-a/commits/abcdef123456?dialog=1");
    expect(normalizeWorkspaceRecentContextRoute(router, router.currentRoute.value)).toBe(
      "/repos/repo-a/commits/abcdef123456",
    );

    await router.replace("/settings");
    expect(normalizeWorkspaceRecentContextRoute(router, router.currentRoute.value)).toBeNull();
  });

  it("普通启动恢复活动工作区，明确深链覆盖已保存值", async () => {
    const saved = { version: 1, route: "/repos/repo-a?projectTab=issues&issue=7" } as const;
    const homeRouter = await routerAt("/");
    const homeHarness = workspaceHarness(namedWorkspace("a", saved), [namedWorkspace("a", saved)]);
    const homeController = createWorkspaceRecentContextController(homeRouter, homeHarness.api);
    await homeController.initialize();
    expect(homeRouter.currentRoute.value.fullPath).toBe(saved.route);
    expect(homeHarness.api.initialize).toHaveBeenCalledOnce();
    expect(homeHarness.update).not.toHaveBeenCalled();
    homeController.dispose();

    const deepRouter = await routerAt("/repos/repo-b/files?ref=main&file=README.md");
    const deepHarness = workspaceHarness(namedWorkspace("a", saved), [namedWorkspace("a", saved)]);
    const deepController = createWorkspaceRecentContextController(deepRouter, deepHarness.api);
    await deepController.initialize();
    await deepController.flush();
    expect(deepRouter.currentRoute.value.fullPath).toBe("/repos/repo-b/files?ref=main&file=README.md");
    expect(deepHarness.update).toHaveBeenLastCalledWith("a", {
      version: 1,
      route: "/repos/repo-b/files?ref=main&file=README.md",
    });
    deepController.dispose();
  });

  it("启动恢复尚未完成时的新深链导航优先", async () => {
    let finishInitialize!: () => void;
    const initializeGate = new Promise<void>((resolve) => { finishInitialize = resolve; });
    const saved = { version: 1, route: "/repos/repo-a/history" } as const;
    const router = await routerAt("/");
    const harness = workspaceHarness(namedWorkspace("a", saved), [namedWorkspace("a", saved)]);
    harness.api.initialize = vi.fn(() => initializeGate);
    const controller = createWorkspaceRecentContextController(router, harness.api);

    const initializing = controller.initialize();
    await router.push("/repos/repo-b/files?ref=main&file=README.md");
    finishInitialize();
    await initializing;
    await controller.flush();

    expect(router.currentRoute.value.fullPath).toBe("/repos/repo-b/files?ref=main&file=README.md");
    expect(harness.update).toHaveBeenLastCalledWith("a", {
      version: 1,
      route: "/repos/repo-b/files?ref=main&file=README.md",
    });
    controller.dispose();
  });

  it("切换前保存来源并恢复目标，首页和设置不覆盖最近仓库位置", async () => {
    const a = namedWorkspace("a", null);
    const b = namedWorkspace("b", { version: 1, route: "/repos/repo-b/files?ref=dev&file=src%2Fmain.ts&hash=L12" });
    const router = await routerAt("/repos/repo-a?projectTab=issues&issue=12&issueLabels=bug");
    const harness = workspaceHarness(a, [a, b]);
    const controller = createWorkspaceRecentContextController(router, harness.api);
    await controller.initialize();
    await controller.switchWorkspace("b");
    expect(router.currentRoute.value.fullPath).toBe("/repos/repo-b/files?ref=dev&file=src/main.ts&hash=L12");
    expect(harness.update).toHaveBeenCalledWith("a", {
      version: 1,
      route: "/repos/repo-a?projectTab=issues&issue=12&issueLabels=bug",
    });

    const callsAfterSwitch = harness.update.mock.calls.length;
    await router.replace("/");
    await router.replace("/settings");
    await controller.flush();
    expect(harness.update).toHaveBeenCalledTimes(callsAfterSwitch);
    controller.dispose();
  });

  it("串行合并快速导航，并在写入清空前不开始切换", async () => {
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const update = vi.fn()
      .mockImplementationOnce(() => firstWrite)
      .mockResolvedValue(undefined);
    const a = namedWorkspace("a", null);
    const b = namedWorkspace("b", null);
    const router = await routerAt("/repos/repo-a?projectTab=issues&issue=1");
    const harness = workspaceHarness(a, [a, b], update);
    const controller = createWorkspaceRecentContextController(router, harness.api);
    await controller.initialize();
    await router.replace("/repos/repo-a?projectTab=issues&issue=2");
    await router.replace("/repos/repo-a?projectTab=issues&issue=3");

    const switching = controller.switchWorkspace("b");
    await Promise.resolve();
    expect(harness.api.switchWorkspace).not.toHaveBeenCalled();
    releaseFirst();
    await switching;

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith("a", {
      version: 1,
      route: "/repos/repo-a?projectTab=issues&issue=3",
    });
    expect(router.currentRoute.value.fullPath).toBe("/");
    controller.dispose();
  });

  it("切换失败保持原工作区与原路由", async () => {
    const a = namedWorkspace("a", null);
    const router = await routerAt("/repos/repo-a/history");
    const harness = workspaceHarness(a, [a]);
    harness.api.switchWorkspace = vi.fn(async () => { throw new Error("switch failed"); });
    const controller = createWorkspaceRecentContextController(router, harness.api);
    await controller.initialize();
    await expect(controller.switchWorkspace("missing")).rejects.toThrow("switch failed");
    expect(harness.activeWorkspace.value?.id).toBe("a");
    expect(router.currentRoute.value.fullPath).toBe("/repos/repo-a/history");
    controller.dispose();
  });

  it("确认仓库缺失降到首页时立即清除失效上下文", async () => {
    const a = namedWorkspace("a", { version: 1, route: "/repos/deleted/issues" });
    const router = await routerAt("/repos/deleted?projectTab=issues&issue=9");
    const harness = workspaceHarness(a, [a]);
    const controller = createWorkspaceRecentContextController(router, harness.api);
    await controller.initialize();

    await controller.replaceAfterConfirmedMissing("/");

    expect(router.currentRoute.value.fullPath).toBe("/");
    expect(harness.update).toHaveBeenLastCalledWith("a", null);
    controller.dispose();
  });
});

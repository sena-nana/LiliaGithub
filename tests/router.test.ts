import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateSessionContextSnapshot, resetSessionContextForTests } from "../src/composables/sessionContext";
import { refreshRepoSummaries } from "../src/composables/workspace/repositories";
import { resetWorkspaceStateForTests, state } from "../src/composables/workspace/state";
import { useWorkspace } from "../src/composables/useWorkspace";
import { createLiliaGithubApp } from "../src/createLiliaGithubApp";
import { workspaceFallbackForTests } from "../src/services/workspace";
import type {
  CommitSummary,
  GitHubIssue,
  GitHubRepoSummary,
  RepoChange,
  RepoDetail,
  RepoOperationResult,
} from "../src/services/workspace";
import { repoDetail, repoSummary } from "./fixtures/workspace";

type WorkspaceFallbackForTests = Awaited<ReturnType<typeof workspaceFallbackForTests>>;
type RepoDetailOptions = NonNullable<Parameters<typeof repoDetail>[1]>;
let workspaceFallback: WorkspaceFallbackForTests;
let mountedApp: ReturnType<typeof createLiliaGithubApp>["app"] | null = null;
let mountedContainer: HTMLElement | null = null;

function cleanupMountedApp() {
  mountedApp?.unmount();
  mountedApp = null;
  mountedContainer?.remove();
  mountedContainer = null;
  cleanup();
  document.body.replaceChildren();
}

async function flushFakeTimersIfNeeded() {
  try {
    await vi.runOnlyPendingTimersAsync();
  } catch {
    // Real timers are active for most tests.
  }
}

async function waitForContributionRefresh(workspace: ReturnType<typeof useWorkspace>) {
  workspace.refreshRepoContributions();
  for (let index = 0; index < 20; index += 1) {
    await flushFakeTimersIfNeeded();
    await Promise.resolve();
    if (!workspace.state.githubContributions.loading) return;
  }
}

async function renderAt(path: string) {
  cleanupMountedApp();
  const workspace = useWorkspace();
  const initializePromise = workspace.initialize();
  await flushFakeTimersIfNeeded();
  await initializePromise;
  const refreshPromise = refreshRepoSummaries();
  await flushFakeTimersIfNeeded();
  await refreshPromise;
  await flushFakeTimersIfNeeded();
  await waitForContributionRefresh(workspace);
  const { app, router } = createLiliaGithubApp({ history: createMemoryHistory() });
  await router.push(path);
  await router.isReady();

  const container = document.createElement("div");
  document.body.appendChild(container);
  app.mount(container);
  mountedApp = app;
  mountedContainer = container;
  await flushFakeTimersIfNeeded();

  return {
    router,
    container,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

async function clickOverviewSync() {
  const main = document.querySelector("main");
  if (!(main instanceof HTMLElement)) throw new Error("未找到主内容区域");
  await screen.findByRole("heading", { level: 1, name: "项目总览" });
  await within(main).findByLabelText("仓库状态列表");
  await waitFor(() => {
    expect(useWorkspace().state.repos.some((repo) => repo.ahead > 0 || repo.behind > 0)).toBe(true);
  });
  const syncButton = within(screen.getByLabelText("项目总览操作")).getByRole("button", { name: "一键同步" });
  await waitFor(() => expect(syncButton).toBeEnabled());
  await fireEvent.click(syncButton);
  await waitFor(() => expect(useWorkspace().state.recentSync?.results.length).toBeGreaterThan(0));
}

async function waitForRepoTitle(name: string) {
  await waitFor(() => {
    expect(document.querySelector(".repo-header__sr-title")).toHaveTextContent(name);
  });
}

function linkedWorktreeSummary(id: string, name: string, overrides: Parameters<typeof repoSummary>[1] = {}) {
  return repoSummary(id, {
    name,
    path: `C:\\Files\\workspace\\${id}`,
    relativePath: id,
    githubFullName: "sena-nana/LiliaGithub",
    worktree: {
      role: "linked",
      sharedRepoKey: "gitdir:LiliaGithub",
      mainRepoId: "LiliaGithub",
    },
    ...overrides,
  });
}

function mockRepoDetail(summary: ReturnType<typeof repoSummary>, detailOptions: RepoDetailOptions) {
  const detailRequests: string[] = [];
  workspaceFallback.setFallbackRepoOverridesForTests({ [summary.id]: summary });
  workspaceFallback.setFallbackRepoDetailOverrideForTests((repoId) => {
    detailRequests.push(repoId);
    return repoId === summary.id ? repoDetail(summary, detailOptions) : null;
  });
  return detailRequests;
}

function repoStatusRow(repoFullName: string) {
  const list = screen.getByLabelText("仓库状态列表");
  const row = within(list).getByText(repoFullName).closest(".repo-status-row");
  if (!(row instanceof HTMLElement)) throw new Error(`未找到仓库状态行: ${repoFullName}`);
  return row;
}

function repoSidebarErrorCard() {
  const status = screen.getByRole("region", { name: "仓库错误" });
  if (!(status instanceof HTMLElement)) throw new Error("未找到仓库错误区");
  return status;
}

async function findRepoSidebarErrorCard() {
  const status = await screen.findByRole("region", { name: "仓库错误" });
  if (!(status instanceof HTMLElement)) throw new Error("未找到仓库错误区");
  return status;
}

function queryRepoSidebarErrorCard() {
  return screen.queryByRole("region", { name: "仓库错误" });
}

function repoDetailRecentSyncFailure() {
  return within(repoSidebarErrorCard()).getByText("最近同步失败").closest(".project-sidebar-error-card__item") as HTMLElement;
}

async function findRepoDetailRecentSyncFailure() {
  return within(await findRepoSidebarErrorCard()).getByText("最近同步失败").closest(".project-sidebar-error-card__item") as HTMLElement;
}

function mockLiliaGithubSyncFailure() {
  workspaceFallback.setFallbackBulkExecuteOverrideForTests((operation, repoIds) =>
    repoIds.map((repoId) => ({
      repoId,
      status: repoId === "LiliaGithub" && operation === "sync" ? "error" : "success",
      message: repoId === "LiliaGithub" && operation === "sync" ? "认证失败" : "完成",
      summary: repoId === "LiliaGithub" && operation === "sync" ? null : repoSummary(repoId),
    })),
  );
}

function githubWorkflowRun(
  repoFullName: string,
  id: number,
  updatedAt: string,
  overrides: Partial<import("../src/services/workspace").GitHubWorkflowRun> = {},
) {
  return {
    id,
    name: "CI",
    displayTitle: `${repoFullName} run ${id}`,
    status: "completed",
    conclusion: "success",
    branch: "main",
    event: "push",
    htmlUrl: `https://github.com/${repoFullName}/actions/runs/${id}`,
    createdAt: updatedAt,
    updatedAt,
    ...overrides,
  };
}

function githubRepoSummary(fullName: string, overrides: Partial<GitHubRepoSummary> = {}): GitHubRepoSummary {
  const [, name = fullName] = fullName.split("/");
  return {
    id: Math.floor(Math.random() * 1_000_000),
    name,
    fullName,
    ownerLogin: fullName.split("/")[0] ?? "sena-nana",
    private: false,
    disabled: false,
    archived: false,
    description: null,
    defaultBranch: "main",
    createdAt: "2026-06-10T08:00:00Z",
    updatedAt: "2026-06-12T08:00:00Z",
    cloneUrl: `https://github.com/${fullName}.git`,
    htmlUrl: `https://github.com/${fullName}`,
    ...overrides,
  };
}

function githubIssue(repoFullName: string, number: number, updatedAt: string, createdAt = updatedAt): GitHubIssue {
  return {
    number,
    title: `${repoFullName} issue ${number}`,
    state: number % 2 === 0 ? "closed" : "open",
    body: null,
    labels: [],
    assignees: [],
    htmlUrl: `https://github.com/${repoFullName}/issues/${number}`,
    updatedAt,
    createdAt,
  };
}

function repoChange(path: string, overrides: Partial<RepoChange> = {}): RepoChange {
  return {
    path,
    oldPath: null,
    indexStatus: " ",
    worktreeStatus: "M",
    staged: false,
    unstaged: true,
    untracked: false,
    conflicted: false,
    diff: `@@ -1 +1 @@\n-old\n+${path}`,
    ...overrides,
  };
}

function commitSummary(overrides: Partial<CommitSummary> = {}): CommitSummary {
  return {
    hash: "fedcba9876543210",
    shortHash: "fedcba9",
    author: "Sena",
    authorEmail: "sena@example.com",
    timestamp: 1_785_010_000,
    subject: "远程历史提交",
    parents: ["1234567890abcdef"],
    refs: ["main"],
    ...overrides,
  };
}

describe("基础路由", () => {
  beforeEach(async () => {
    workspaceFallback = await workspaceFallbackForTests();
    workspaceFallback.resetWorkspaceFallbacksForTests();
    resetWorkspaceStateForTests();
    resetSessionContextForTests();
  });

  afterEach(async () => {
    cleanupMountedApp();
    vi.useRealTimers();
    workspaceFallback.setFallbackStopLaunchOverrideForTests(null);
  });

  it("用户资料与组织纵览进入独立页面，旧组织仓库深链回到首页", async () => {
    const profile = await renderAt("/profile");
    expect(profile.router.currentRoute.value.fullPath).toBe("/profile");
    await waitFor(() => {
      expect(document.querySelector('[data-agent-id="profile.editor"]')).toBeInstanceOf(HTMLElement);
    });

    const organization = await renderAt("/organizations/sena-nana");
    expect(organization.router.currentRoute.value.fullPath).toBe("/organizations/sena-nana");
    expect(await screen.findByLabelText("组织 Overview")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 2, name: "近期仓库" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "组织页面" })).toBeNull();

    const repositoriesRoute = organization.router.resolve("/organizations/sena-nana/repositories");
    expect(repositoriesRoute.matched).toHaveLength(1);
    expect(repositoriesRoute.matched[0]?.redirect).toBe("/");
  });

  it("总览页项目代码占比展示本地项目占比", async () => {
    const service = await import("../src/services/workspace");
    const repos = [
      ["LiliaGithub", 1000],
      ["Lilia", 900],
      ["RepoC", 800],
      ["RepoD", 700],
    ] as const;
    for (const [repoId] of repos.slice(2)) {
      await service.cloneRepo({
        remoteUrl: `https://github.com/sena-nana/${repoId}.git`,
        placement: { kind: "automatic" },
        target: { kind: "custom", path: `C:\\Files\\workspace\\${repoId}` },
      });
    }
    workspaceFallback.setFallbackRepoOverridesForTests(Object.fromEntries(
      repos.map(([repoId, bytes]) => [repoId, repoSummary(repoId, {
        languageStats: [{ language: "TypeScript", bytes, lines: Math.round(bytes / 10) }],
      })]),
    ));

    await renderAt("/overview");
    await fireEvent.click(await screen.findByRole("button", { name: "按项目" }));

    const chart = await screen.findByLabelText("编程语言占比图");
    expect(within(chart).getByText("LiliaGithub")).toBeInTheDocument();
    expect(within(chart).getByText("RepoD")).toBeInTheDocument();
    expect(within(chart).queryByText("Other")).toBeNull();
  });

  it("总览页未 clone 的 GitHub 项目可进入远程详情并屏蔽本地 Git 功能", async () => {
    workspaceFallback.setFallbackGitHubRepoPagesForTests([
      {
        items: [
          githubRepoSummary("sena-nana/LiliaGithub"),
          githubRepoSummary("sena-nana/NewRepo", {
            description: "Not cloned yet",
            private: true,
            updatedAt: "2026-06-13T08:00:00Z",
          }),
        ],
        nextPage: null,
      },
    ]);
    const { router, container } = await renderAt("/overview");

    await fireEvent.click(await within(container).findByRole("link", { name: "打开 sena-nana/NewRepo" }));

    await waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe("/repos/github%3Asena-nana%2FNewRepo");
    }, { timeout: 5000 });
    expect(await screen.findByRole("heading", { level: 1, name: "NewRepo" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Git 信息" })).toBeNull();
    expect(screen.queryByRole("tablist", { name: "本地 Git 视图" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Push" })).toBeNull();
    expect(screen.queryByRole("button", { name: "拉取" })).toBeNull();
    expect(screen.queryByRole("button", { name: "文件夹" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: "提交" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: "快速启动" })).toBeNull();
    expect(await screen.findByText("当前仓库没有 README.md。")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Issues" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "变更" })).toBeNull();
    expect(screen.getByRole("tab", { name: "历史" })).toBeInTheDocument();
  });

  it("linked worktree 变更页读取当前工作树自己的变更并在进入历史时刷新详情", async () => {
    const linkedSummary = linkedWorktreeSummary("LiliaGithub-linked", "LiliaGithub linked", {
      unstagedCount: 1,
    });
    const linkedCommit = commitSummary({
      hash: "abcabcabcabcabc1",
      shortHash: "abcabca",
      subject: "linked worktree history",
      refs: ["feature/worktree"],
    });
    const detailRequests = mockRepoDetail(linkedSummary, {
      changes: [
        repoChange("src/linked-worktree.ts", {
          diff: "@@ -1 +1 @@\n-old linked\n+new linked",
        }),
      ],
      commits: [linkedCommit],
    });

    await renderAt("/repos/LiliaGithub-linked/changes");

    expect(await screen.findByRole("tab", { name: "变更" })).toHaveAttribute("aria-selected", "true");
    await fireEvent.click(await screen.findByText("src/linked-worktree.ts"));
    expect(screen.getByLabelText("变更预览")).toHaveTextContent("new linked");
    expect(detailRequests).toContain(linkedSummary.id);

    detailRequests.length = 0;
    await fireEvent.click(screen.getByRole("tab", { name: "历史" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "历史" })).toHaveAttribute("aria-selected", "true");
    });
    await waitFor(() => {
      expect(detailRequests).toContain(linkedSummary.id);
    });
    expect(await screen.findByRole("button", { name: /linked worktree history/ })).toBeInTheDocument();
  });

  it("linked worktree 变更页读取期间不显示空变更", async () => {
    const linkedSummary = linkedWorktreeSummary("LiliaGithub-loading-worktree", "LiliaGithub loading worktree", {
      unstagedCount: 1,
    });
    const detail = repoDetail(linkedSummary, {
      changes: [
        repoChange("src/loading-worktree.ts", {
          diff: "@@ -1 +1 @@\n-old loading\n+new loading",
        }),
      ],
    });
    const detailGate = deferred<RepoDetail>();
    workspaceFallback.setFallbackRepoOverridesForTests({ [linkedSummary.id]: linkedSummary });
    workspaceFallback.setFallbackRepoDetailOverrideForTests((repoId) =>
      repoId === linkedSummary.id ? detailGate.promise : null
    );

    await renderAt("/repos/LiliaGithub-loading-worktree/changes");

    expect((await screen.findAllByText("正在读取本地变更。")).length).toBeGreaterThan(0);
    expect(screen.queryByText("没有本地变更。")).toBeNull();
    detailGate.resolve(detail);
    expect(await screen.findByText("src/loading-worktree.ts")).toBeInTheDocument();
  });

  it("linked worktree 历史页直接进入时读取本地提交历史", async () => {
    const linkedSummary = linkedWorktreeSummary(
      "LiliaGithub-history-worktree",
      "LiliaGithub history worktree",
    );
    const linkedCommit = commitSummary({
      hash: "defdefdefdefdef2",
      shortHash: "defdefd",
      subject: "direct linked history",
      refs: ["feature/direct-history"],
    });
    const detailRequests = mockRepoDetail(linkedSummary, { commits: [linkedCommit] });

    await renderAt("/repos/LiliaGithub-history-worktree/history");

    expect(await screen.findByRole("tab", { name: "历史" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("button", { name: /direct linked history/ })).toBeInTheDocument();
    expect(detailRequests).toContain(linkedSummary.id);
    expect(screen.queryByRole("tab", { name: "变更" })).toBeInTheDocument();
  });

  it("linked worktree 历史页读取失败不显示空历史", async () => {
    const linkedSummary = linkedWorktreeSummary(
      "LiliaGithub-missing-worktree",
      "LiliaGithub missing worktree",
    );
    workspaceFallback.setFallbackRepoOverridesForTests({ [linkedSummary.id]: linkedSummary });
    workspaceFallback.setFallbackRepoDetailOverrideForTests((repoId) => {
      if (repoId === linkedSummary.id) throw new Error("未找到 Git 仓库：LiliaGithub-missing-worktree");
      return null;
    });

    await renderAt("/repos/LiliaGithub-missing-worktree/history");

    expect(await screen.findByText("提交历史读取失败。")).toBeInTheDocument();
    expect(screen.queryByText("没有提交历史。")).toBeNull();
    expect(await screen.findByText(/未找到 Git 仓库：LiliaGithub-missing-worktree/)).toBeInTheDocument();
  });

  it("本地仓库可通过一级文件树 tab 进入文件浏览页", async () => {
    workspaceFallback.setFallbackRepoFilesForTests({
      LiliaGithub: {
        "": [
          { path: "README.md", name: "README.md", kind: "file", hasChildren: false },
        ],
      },
    });
    workspaceFallback.setFallbackRepoFilePreviewsForTests({
      LiliaGithub: {
        "README.md": {
          path: "README.md",
          name: "README.md",
          previewKind: "markdown",
          content: "# Files View\n",
          dataUrl: null,
          images: {},
          size: 13,
          mimeType: "text/markdown",
          truncated: false,
        },
      },
    });
    const { router } = await renderAt("/repos/LiliaGithub/files");

    expect(await screen.findByRole("heading", { level: 1, name: "Files View" })).toBeInTheDocument();
    expect(within(screen.getByRole("tablist", { name: "仓库页面" })).getByRole("tab", { name: "文件树" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tablist", { name: "右侧面板" })).toBeNull();
    expect(router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub/files");
  });

  it("文件页根目录请求期间会话上下文失效后仍显示文件树", async () => {
    const rootEntries = deferred([
      { path: "README.md", name: "README.md", kind: "file" as const, hasChildren: false },
    ]);
    workspaceFallback.setFallbackRepoFilesOverrideForTests((repoId, parentPath) => {
      if (repoId === "LiliaGithub" && parentPath === null) return rootEntries.promise;
      return [];
    });
    workspaceFallback.setFallbackRepoFilePreviewsForTests({
      LiliaGithub: {
        "README.md": {
          path: "README.md",
          name: "README.md",
          previewKind: "markdown",
          content: "# Files View\n",
          dataUrl: null,
          images: {},
          size: 13,
          mimeType: "text/markdown",
          truncated: false,
        },
      },
    });

    const { router } = await renderAt("/repos/LiliaGithub/files");
    expect(await screen.findByText("正在读取文件树。")).toBeInTheDocument();

    invalidateSessionContextSnapshot();
    rootEntries.resolve([
      { path: "README.md", name: "README.md", kind: "file", hasChildren: false },
    ]);

    expect(await screen.findByRole("button", { name: /README\.md/ })).toBeInTheDocument();
    expect(screen.queryByText("正在读取文件树。")).toBeNull();
    expect(await screen.findByRole("heading", { level: 1, name: "Files View" })).toBeInTheDocument();
    expect(router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub/files");
  });

  it("远程仓库文件树按分支选择器当前分支读取 GitHub 结构", async () => {
    const service = await import("../src/services/workspace");
    const repoFullName = "sena-nana/RemoteFiles";
    service.clearGitHubRepoCache();
    workspaceFallback.setFallbackGitHubRepoPagesForTests([
      {
        items: [githubRepoSummary(repoFullName, { defaultBranch: "main" })],
        nextPage: null,
      },
    ]);
    workspaceFallback.setFallbackGitHubBranchesForTests({
      [repoFullName]: [
        {
          name: "main",
          remote: true,
          current: false,
          upstream: null,
          ahead: 0,
          behind: 0,
          protected: true,
          tipTimestamp: 1_785_000_000,
          checkedOutWorktreePaths: [],
        },
        {
          name: "dev",
          remote: true,
          current: false,
          upstream: null,
          ahead: 0,
          behind: 0,
          protected: false,
          tipTimestamp: 1_784_990_000,
          checkedOutWorktreePaths: [],
        },
      ],
    });
    workspaceFallback.setFallbackGitHubRepoFilesForTests({
      [repoFullName]: {
        "": [{ path: "README.md", name: "README.md", kind: "file", hasChildren: false }],
      },
    });
    workspaceFallback.setFallbackGitHubRepoFilePreviewsForTests({
      [repoFullName]: {
        "README.md": {
          path: "README.md",
          name: "README.md",
          previewKind: "markdown",
          content: "# Remote Files\n",
          dataUrl: null,
          images: {},
          size: 15,
          mimeType: "text/markdown",
          truncated: false,
        },
      },
    });
    await service.rememberRemoteRepo({
      fullName: repoFullName,
      name: "RemoteFiles",
      private: false,
      archived: false,
      defaultBranch: "main",
      htmlUrl: `https://github.com/${repoFullName}`,
      cloneUrl: `https://github.com/${repoFullName}.git`,
      openedAt: Date.now(),
    });

    const { router } = await renderAt("/repos/github%3Asena-nana%2FRemoteFiles/files");

    expect(await screen.findByRole("heading", { level: 1, name: "Remote Files" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "文件树", selected: true })).toBeInTheDocument();
    expect(router.currentRoute.value.fullPath).toBe("/repos/github%3Asena-nana%2FRemoteFiles/files");
    await waitFor(() => {
      expect(workspaceFallback.getFallbackGitHubRepoFileListCallsForTests()).toContainEqual({
        repoFullName,
        parentPath: null,
        refName: "main",
      });
    });

    await fireEvent.click(screen.getByRole("button", { name: "main" }));
    await fireEvent.click(await within(
      await screen.findByRole("listbox", { name: "分支候选" }),
    ).findByRole("button", { name: "dev" }));

    await waitFor(() => {
      expect(workspaceFallback.getFallbackGitHubRepoFileListCallsForTests()).toContainEqual({
        repoFullName,
        parentPath: null,
        refName: "dev",
      });
    });
  });

  it("直接进入 issue 深链时按需拉取并定位目标 issue", async () => {
    workspaceFallback.setFallbackGitHubIssuesForTests({
      "sena-nana/LiliaGithub": [
        githubIssue("sena-nana/LiliaGithub", 12, "2026-06-18T08:00:00Z"),
      ],
    });

    const { router } = await renderAt("/repos/LiliaGithub?projectTab=issues&issue=12");

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Issues" })).toHaveAttribute("aria-selected", "true");
    });
    expect(router.currentRoute.value.query).toMatchObject({
      projectTab: "issues",
      issue: "12",
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 3, name: /#12/ })).toBeInTheDocument();
    });
  });

  it("旧 projectTab=milestones 不再提供标签并按无效值回落 README", async () => {
    const { router } = await renderAt("/repos/LiliaGithub?projectTab=milestones");

    expect(await screen.findByLabelText("README 内容")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Milestones" })).toBeNull();
    expect(router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub?projectTab=milestones");
  });

  it("旧 projectTab=board 不再激活视图并回落 README", async () => {
    const { router } = await renderAt("/repos/LiliaGithub?projectTab=board");

    expect(await screen.findByLabelText("README 内容")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Issues" })).toHaveAttribute("aria-selected", "false");
    expect(router.currentRoute.value.query).toMatchObject({ projectTab: "board" });
  });

  it("仓库 Issues 筛选写入 URL，并支持返回前进恢复", async () => {
    workspaceFallback.setFallbackGitHubIssuesForTests({
      "sena-nana/LiliaGithub": [
        githubIssue("sena-nana/LiliaGithub", 12, "2026-06-18T08:00:00Z"),
      ],
    });
    const { router } = await renderAt("/repos/LiliaGithub?projectTab=issues&issueQ=initial");

    const searchInput = await screen.findByLabelText("搜索 Issues", {}, { timeout: 5000 });
    await waitFor(() => {
      expect(searchInput).toHaveValue("initial");
      expect(workspaceFallback.getFallbackGitHubIssueListCallsForTests()).toContainEqual(
        expect.objectContaining({
          repoFullName: "sena-nana/LiliaGithub",
          query: "initial",
        }),
      );
    });

    await fireEvent.update(searchInput, "Roadmap");
    await waitFor(() => {
      expect(router.currentRoute.value.query).toMatchObject({
        projectTab: "issues",
        issueQ: "Roadmap",
      });
    });
    expect(workspaceFallback.getFallbackGitHubIssueListCallsForTests()).toContainEqual(
      expect.objectContaining({
        repoFullName: "sena-nana/LiliaGithub",
        query: "Roadmap",
      }),
    );

    router.back();
    await waitFor(() => {
      expect(router.currentRoute.value.query.issueQ).toBe("initial");
      expect(screen.getByLabelText("搜索 Issues")).toHaveValue("initial");
    });
    expect(workspaceFallback.getFallbackGitHubIssueListCallsForTests()).toContainEqual(
      expect.objectContaining({
        repoFullName: "sena-nana/LiliaGithub",
        query: "initial",
      }),
    );

    router.forward();
    await waitFor(() => {
      expect(router.currentRoute.value.query.issueQ).toBe("Roadmap");
      expect(screen.getByLabelText("搜索 Issues")).toHaveValue("Roadmap");
    });
  });

  it("直接进入 actions 深链时按需拉取并定位目标 run", async () => {
    workspaceFallback.setFallbackGitHubWorkflowRunsForTests({
      "sena-nana/LiliaGithub": [
        githubWorkflowRun("sena-nana/LiliaGithub", 1310, "2026-06-18T08:00:00Z", {
          displayTitle: "release pipeline",
        }),
      ],
    });

    const { router } = await renderAt("/repos/LiliaGithub?projectTab=actions&run=1310&job=13101");

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Actions" })).toHaveAttribute("aria-selected", "true");
    });
    expect(router.currentRoute.value.query).toMatchObject({
      projectTab: "actions",
      run: "1310",
      job: "13101",
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 3, name: "release pipeline" })).toBeInTheDocument();
      expect(screen.getByText("3 steps")).toBeInTheDocument();
      expect(screen.getByText("Run lint")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("总览页隐藏禁用的 GitHub 项目", async () => {
    workspaceFallback.setFallbackGitHubRepoPagesForTests([
      {
        items: [
          githubRepoSummary("sena-nana/LiliaGithub"),
          githubRepoSummary("sena-nana/DisabledRepo", {
            disabled: true,
            updatedAt: "2026-06-13T08:00:00Z",
          }),
        ],
        nextPage: null,
      },
    ]);
    await renderAt("/overview");

    const repoStatusList = await screen.findByLabelText("仓库状态列表");
    expect(await within(repoStatusList).findByText("sena-nana/LiliaGithub")).toBeInTheDocument();
    expect(within(repoStatusList).queryByText("sena-nana/DisabledRepo")).toBeNull();
  });

  it("总览页归档 GitHub 项目显示 Archive 标签并排序到最后", async () => {
    workspaceFallback.setFallbackGitHubRepoPagesForTests([
      {
        items: [
          githubRepoSummary("sena-nana/ArchivedRepo", {
            archived: true,
            updatedAt: "2026-06-13T08:00:00Z",
          }),
          githubRepoSummary("sena-nana/ActiveRepo", {
            archived: false,
            updatedAt: "2026-06-13T09:00:00Z",
          }),
        ],
        nextPage: null,
      },
    ]);
    await renderAt("/overview");

    const repoStatusList = await screen.findByLabelText("仓库状态列表");
    await within(repoStatusList).findByText("sena-nana/ArchivedRepo");
    await within(repoStatusList).findByText("sena-nana/ActiveRepo");
    const archivedRow = within(repoStatusList).getByText("sena-nana/ArchivedRepo").closest(".repo-status-row");
    expect(within(archivedRow as HTMLElement).getByText("Archive")).toBeInTheDocument();
    const rows = Array.from(repoStatusList.querySelectorAll(".repo-status-row"));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent("sena-nana/ArchivedRepo");
  });

  it("总览页 GitHub 项目支持手动加载更多并去重", async () => {
    workspaceFallback.setFallbackGitHubRepoPagesForTests([
      {
        items: [githubRepoSummary("sena-nana/LiliaGithub")],
        nextPage: 2,
      },
      {
        items: [
          githubRepoSummary("sena-nana/LiliaGithub"),
          githubRepoSummary("sena-nana/PageTwo"),
        ],
        nextPage: null,
      },
    ]);
    await renderAt("/overview");

    const repoStatusList = await screen.findByLabelText("仓库状态列表");
    await within(repoStatusList).findByText("sena-nana/LiliaGithub");
    expect(within(repoStatusList).queryByText("sena-nana/PageTwo")).toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: "加载更多" }));

    expect(await within(repoStatusList).findByText("sena-nana/PageTwo")).toBeInTheDocument();
    expect(within(repoStatusList).getAllByText("sena-nana/LiliaGithub")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "加载更多" })).toBeNull();
  });

  it("总览页 GitHub 项目加载失败时保留本地侧栏并可重试", async () => {
    workspaceFallback.setFallbackGitHubReposErrorForTests("GitHub 绑定已失效，请重新绑定");
    await renderAt("/overview");

    expect(await screen.findByText("GitHub 绑定已失效，请重新绑定后再加载账号仓库。")).toBeInTheDocument();
    const ungroupedSection = screen.getByRole("button", { name: "折叠分组 未分组仓库" });
    expect(ungroupedSection).toHaveTextContent("未分组仓库");
    expect(ungroupedSection).toHaveTextContent("2");
    expect(screen.getAllByText("LiliaGithub").length).toBeGreaterThan(0);

    workspaceFallback.setFallbackGitHubReposErrorForTests(null);
    await fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await within(screen.getByLabelText("仓库状态列表")).findByText("sena-nana/LiliaGithub")).toBeInTheDocument();
    expect(screen.queryByText("GitHub 绑定已失效，请重新绑定后再加载账号仓库。")).toBeNull();
  });

  it("首页本地提交贡献图支持空状态和错误重试", async () => {
    workspaceFallback.setFallbackRepoContributionOverrideForTests(() => ({
      days: [],
      meta: {
        repoCount: 1,
        requestedRepoCount: 1,
        repoLimit: 30,
        truncated: false,
        skippedRepoCount: 0,
        refreshedAt: 1_780_000_000_000,
      },
    }));

    await renderAt("/overview");

    expect(await screen.findByText("暂无本地提交")).toBeInTheDocument();

    workspaceFallback.setFallbackRepoContributionOverrideForTests(() => {
      throw new Error("rate limited");
    });
    const refreshRepos = within(screen.getByLabelText("项目总览操作")).getByRole("button", { name: "刷新并抓取" });
    await waitFor(() => {
      expect(refreshRepos).toBeEnabled();
    });
    await fireEvent.click(refreshRepos);

    expect(await screen.findByText("Error: rate limited")).toBeInTheDocument();

    workspaceFallback.setFallbackRepoContributionOverrideForTests((repoScope) => ({
      days: [{ date: "2026-06-11", count: repoScope === "local:LiliaGithub" ? 4 : 0 }],
      meta: {
        repoCount: 1,
        requestedRepoCount: 1,
        repoLimit: 30,
        truncated: false,
        skippedRepoCount: 0,
        refreshedAt: 1_780_000_000_000,
      },
    }));
    await fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByText("4 次提交，最近一年")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "本地提交贡献图" })).toBeInTheDocument();
  });

  it("侧边栏左下角提供设置和 GitHub 状态入口", async () => {
    await renderAt("/overview");

    expect(
      await screen.findByRole("link", { name: "GitHub 已授权。点击进入设置。" }),
    ).toHaveAttribute("href", expect.stringContaining("/settings"));
    expect(screen.getAllByRole("link", { name: "设置" })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "扩展" })).toBeNull();
  });

  it("没有 remote 的本地分支不会暴露发布操作", async () => {
    workspaceFallback.setFallbackRepoOverridesForTests({
      LiliaGithub: repoSummary("LiliaGithub", {
        currentBranch: "feature/local-only",
        remoteUrl: null,
        ahead: 0,
      }),
    });

    await renderAt("/repos/LiliaGithub/changes");

    expect(await screen.findByRole("button", { name: "推送" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "发布" })).toBeNull();
  });

  it("冲突深链只自动打开一次，并可从仓库工具栏重新打开", async () => {
    const summary = repoSummary("LiliaGithub", { conflictCount: 1 });
    state.repoDetails[summary.id] = repoDetail(summary, {
      conflicts: { operation: "none", files: [], allResolved: true },
    });
    mockRepoDetail(summary, {
      conflicts: {
        operation: "merge",
        allResolved: false,
        files: [{
          path: "src/main.ts",
          status: "UU",
          resolved: false,
          binary: false,
          hunks: [],
        }],
      },
    });

    const { router } = await renderAt("/repos/LiliaGithub/changes?resolveConflicts=1");

    expect(await screen.findByRole("dialog", { name: "合并冲突" })).toBeInTheDocument();
    await waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub/changes");
    });

    await fireEvent.click(screen.getByRole("button", { name: "关闭冲突处理" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "合并冲突" })).toBeNull();
    });
    expect(router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub/changes");

    const toolbarEntry = screen.getByRole("button", { name: "处理冲突" });
    expect(toolbarEntry).toHaveAttribute("data-agent-id", "repo.toolbar.conflict.resolve");
    await fireEvent.click(toolbarEntry);
    expect(await screen.findByRole("dialog", { name: "合并冲突" })).toBeInTheDocument();
  });

  it("过期冲突深链停留在变更页且不打开冲突卡片", async () => {
    const summary = repoSummary("LiliaGithub", { conflictCount: 0 });
    mockRepoDetail(summary, {
      conflicts: { operation: "none", files: [], allResolved: true },
    });

    const { router } = await renderAt("/repos/LiliaGithub/changes?resolveConflicts=1");

    await waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub/changes");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "处理冲突" })).toBeNull();
    expect(await screen.findByRole("tab", { name: "变更" })).toHaveAttribute("aria-selected", "true");
  });

  it("仓库详情页右上角独立刷新当前 Issues 页面", async () => {
    workspaceFallback.setFallbackGitHubIssuesForTests({
      "sena-nana/LiliaGithub": [
        githubIssue("sena-nana/LiliaGithub", 11, "2026-06-18T08:00:00Z"),
      ],
    });
    const summary = repoSummary("LiliaGithub");
    mockRepoDetail(summary, {});
    await renderAt("/repos/LiliaGithub?projectTab=issues");
    await waitForRepoTitle("LiliaGithub");
    await waitFor(() => {
      expect(workspaceFallback.getFallbackGitHubIssueListCallsForTests()).toContainEqual(
        expect.objectContaining({ repoFullName: "sena-nana/LiliaGithub" }),
      );
    });
    expect(await screen.findByText("#11 sena-nana/LiliaGithub issue 11")).toBeInTheDocument();
    const initialIssueRequestCount = workspaceFallback.getFallbackGitHubIssueListCallsForTests().length;
    const refresh = screen.getByRole("button", { name: "刷新当前页" });
    const actions = screen.getByRole("group", { name: "项目操作" });
    expect(refresh).toHaveAttribute("data-agent-id", "repo.toolbar.refresh-page");
    expect(within(actions).queryByRole("button", { name: "刷新当前页" })).toBeNull();
    expect(within(screen.getByLabelText("右侧面板工具栏")).queryByRole("button", { name: "刷新当前页" })).toBeNull();

    workspaceFallback.setFallbackGitHubIssuesForTests({
      "sena-nana/LiliaGithub": [
        githubIssue("sena-nana/LiliaGithub", 13, "2026-06-19T08:00:00Z"),
      ],
    });

    await fireEvent.click(refresh);

    expect(await screen.findByText("#13 sena-nana/LiliaGithub issue 13")).toBeInTheDocument();
    expect(screen.queryByText("#11 sena-nana/LiliaGithub issue 11")).toBeNull();
    expect(workspaceFallback.getFallbackGitHubIssueListCallsForTests().length).toBeGreaterThan(initialIssueRequestCount);
  });

  it("仓库详情页右上角刷新 Changes 的当前 Git 状态", async () => {
    const summary = repoSummary("LiliaGithub");
    let currentChanges = [repoChange("src/before-refresh.ts")];
    workspaceFallback.setFallbackRepoOverridesForTests({ [summary.id]: summary });
    workspaceFallback.setFallbackRepoDetailOverrideForTests((repoId) => (
      repoId === summary.id ? repoDetail(summary, { changes: currentChanges }) : null
    ));
    await renderAt("/repos/LiliaGithub/changes");

    expect(await screen.findByText("src/before-refresh.ts")).toBeInTheDocument();
    currentChanges = [repoChange("src/after-refresh.ts")];
    await fireEvent.click(screen.getByRole("button", { name: "刷新当前页" }));

    expect(await screen.findByText("src/after-refresh.ts")).toBeInTheDocument();
    expect(screen.queryByText("src/before-refresh.ts")).toBeNull();
  });

  it("仓库详情页右上角刷新 Run 的启动配置数据", async () => {
    workspaceFallback.setFallbackLaunchCandidatesForTests({
      LiliaGithub: [{
        command: "yarn old-refresh-command",
        label: "old refresh command",
        hint: null,
        kind: "script",
        cwd: null,
      }],
    });
    await renderAt("/repos/LiliaGithub/run");
    await waitFor(() => {
      expect(useWorkspace().state.launchCandidates.LiliaGithub?.[0]?.command).toBe("yarn old-refresh-command");
    });

    workspaceFallback.setFallbackLaunchCandidatesForTests({
      LiliaGithub: [{
        command: "yarn refreshed-command",
        label: "refreshed command",
        hint: null,
        kind: "script",
        cwd: null,
      }],
    });
    const refresh = screen.getByRole("button", { name: "刷新当前页" });
    await waitFor(() => expect(refresh).toBeEnabled());
    await fireEvent.click(refresh);
    await waitFor(() => {
      expect(useWorkspace().state.launchCandidates.LiliaGithub?.[0]?.command).toBe("yarn refreshed-command");
    });
  });

  it("仓库详情页右上角刷新 Stash 列表并保持当前路由", async () => {
    const service = await import("../src/services/workspace");
    await service.saveRepoStash("LiliaGithub", "On main: before page refresh");
    const { router } = await renderAt("/repos/LiliaGithub/stash");
    expect(await screen.findByRole("button", { name: /before page refresh/ })).toBeInTheDocument();

    await service.saveRepoStash("LiliaGithub", "On main: after page refresh");
    await fireEvent.click(screen.getByRole("button", { name: "刷新当前页" }));

    expect(await screen.findByRole("button", { name: /after page refresh/ })).toBeInTheDocument();
    expect(router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub/stash");
  });

  it("仓库详情页打开目标按钮可下拉切换并立即打开目标", async () => {
    await renderAt("/repos/LiliaGithub/changes");

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
    const actions = await screen.findByLabelText("项目操作");
    const openMain = actions.querySelector(".repo-toolbar__open-main");
    const openToggle = actions.querySelector(".repo-toolbar__open-target-toggle");
    expect(openMain).toBeInstanceOf(HTMLButtonElement);
    expect(openToggle).toBeInstanceOf(HTMLButtonElement);
    expect(openMain).toHaveAttribute("aria-label", "文件夹");

    await fireEvent.click(openToggle as HTMLButtonElement);
    const menu = await screen.findByRole("listbox", { name: "打开目标" });
    expect(within(menu).getByRole("option", { name: "文件夹" })).toBeInTheDocument();
    expect(within(menu).getByRole("option", { name: "终端" })).toBeInTheDocument();
    expect(within(menu).getByRole("option", { name: "VSCode" })).toBeInTheDocument();
    expect(within(menu).getByRole("option", { name: "LiliaCode" })).toBeInTheDocument();

    await fireEvent.click(within(menu).getByRole("option", { name: "VSCode" }));

    await waitFor(() => {
      expect(workspaceFallback.getFallbackOpenPathTargetCallsForTests()).toEqual([
        { path: "C:\\Files\\workspace\\LiliaGithub", target: "vscode" },
      ]);
    });
    expect(openMain).toHaveAttribute("aria-label", "VSCode");
  });

  it("仓库详情页提供本地 stash 管理页签并按选中 stash 执行操作", async () => {
    const service = await import("../src/services/workspace");
    await service.saveRepoStash("LiliaGithub", "On main: newer stash");
    const applyStash = vi.spyOn(service, "applyRepoStash");

    await renderAt("/repos/LiliaGithub/stash");

    expect(await screen.findByRole("tab", { name: "Stash" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab", { name: "文件树" }).length).toBeGreaterThan(0);
    await waitForRepoTitle("LiliaGithub");
    expect(screen.queryByRole("group", { name: "扩展仓库操作" })).toBeNull();

    const stash = await screen.findByRole("button", { name: /stash@\{1\}/ }, { timeout: 5_000 });
    await fireEvent.click(stash);

    await waitFor(() => {
      expect(screen.getByLabelText("Stash 内容")).toHaveTextContent("On main: WIP toolbar");
    });
    expect(await screen.findByText("stash 变更")).toBeInTheDocument();
    expect(screen.getByLabelText("改动文件列表")).toHaveTextContent("src/pages/RepoDetail.vue");
    expect(screen.getByLabelText("stash diff")).toHaveTextContent("@@ -1,3 +1,4 @@");

    await fireEvent.click(screen.getByRole("button", { name: "Raw diff" }));
    expect(screen.getByLabelText("stash diff")).toHaveTextContent("diff --git a/src/pages/RepoDetail.vue b/src/pages/RepoDetail.vue");

    await fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(applyStash).toHaveBeenCalledWith("LiliaGithub", "stash@{1}");
    });
    workspaceFallback.resetWorkspaceFallbacksForTests();
  });

  it("stash 操作完成时不会把旧仓库状态写回新路由", async () => {
    const service = await import("../src/services/workspace");
    await service.saveRepoStash("LiliaGithub", "On main: delayed stash");
    const applyResult = deferred<RepoOperationResult>();
    const applyStash = vi.spyOn(service, "applyRepoStash").mockReturnValue(applyResult.promise);
    workspaceFallback.setFallbackGitHubBranchesForTests({ "sena-nana/EmptyRemote": [] });

    const { router } = await renderAt("/repos/LiliaGithub/stash");
    await fireEvent.click(await screen.findByRole("button", { name: /stash@\{1\}/ }));
    await waitFor(() => {
      expect(screen.getByLabelText("Stash 内容")).toHaveTextContent("On main: WIP toolbar");
    });

    await fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(applyStash).toHaveBeenCalledWith("LiliaGithub", "stash@{1}");

    await router.push("/repos/github%3Asena-nana%2FEmptyRemote/stash");
    await waitFor(() => {
      expect(screen.getByText("stash 仅支持本地仓库。")).toBeInTheDocument();
    });

    applyResult.resolve({
      status: "success",
      message: "applied",
      summary: repoSummary("LiliaGithub"),
      conflicts: { operation: "none", files: [], allResolved: true },
    });

    await waitFor(() => {
      expect(screen.getByText("stash 仅支持本地仓库。")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("Stash 列表")).toBeNull();

    applyStash.mockRestore();
    workspaceFallback.resetWorkspaceFallbacksForTests();
  });

  it("远程仓库直达 stash 页显示本地限制空状态", async () => {
    workspaceFallback.setFallbackGitHubBranchesForTests({ "sena-nana/EmptyRemote": [] });

    await renderAt("/repos/github%3Asena-nana%2FEmptyRemote/stash");

    expect(await screen.findByText("stash 仅支持本地仓库。")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Stash" })).toBeNull();
  });

  it("删除 GitHub 远端后返回首页不会恢复旧的仓库状态快照", async () => {
    const { router } = await renderAt("/overview");

    const repoStatusList = await screen.findByLabelText("仓库状态列表");
    expect(await within(repoStatusList).findByText("sena-nana/LiliaGithub")).toBeInTheDocument();

    await router.push("/repos/LiliaGithub");
    await fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    const deleteRepoButton = await screen.findByRole("button", { name: "删除仓库" });
    await waitFor(() => expect(deleteRepoButton).toBeEnabled(), { timeout: 3000 });
    await fireEvent.click(deleteRepoButton);

    await fireEvent.update(screen.getByPlaceholderText("sena-nana/LiliaGithub"), "sena-nana/LiliaGithub");
    await fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "删除 GitHub 仓库" })).toBeNull();
    });
    await router.push("/overview");

    const refreshedRepoStatusList = await screen.findByLabelText("仓库状态列表");
    await waitFor(() => {
      expect(within(refreshedRepoStatusList).queryByText("sena-nana/LiliaGithub")).toBeNull();
    });
  });

  it("仓库设置删除本地仓库需要输入仓库 ID 确认并返回首页", async () => {
    const service = await import("../src/services/workspace");
    const { router } = await renderAt("/repos/LiliaGithub");

    await waitForRepoTitle("LiliaGithub");
    await fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    const deleteLocalButton = await screen.findByRole("button", { name: "删除本地" });
    await fireEvent.click(deleteLocalButton);
    expect(await screen.findByRole("dialog", { name: "删除本地仓库" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认删除" })).toBeDisabled();

    await fireEvent.update(screen.getByPlaceholderText("LiliaGithub"), "sena-nana/LiliaGithub");
    expect(screen.getByRole("button", { name: "确认删除" })).toBeDisabled();

    await fireEvent.update(screen.getByPlaceholderText("LiliaGithub"), "LiliaGithub");
    expect(screen.getByRole("button", { name: "确认删除" })).toBeEnabled();
    await fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "删除本地仓库" })).toBeNull();
      expect(router.currentRoute.value.fullPath).toBe("/");
    });
    expect((await service.refreshRepos()).some((repo) => repo.id === "LiliaGithub")).toBe(false);
  });

  it("仓库项目信息页支持编辑 Issue（标题、正文、labels、assignees）", async () => {
    const issueItemByTitle = (name: string | RegExp) => {
      const titleButton = screen.getByRole("button", { name });
      const item = titleButton.closest('[role="listitem"]');
      if (!(item instanceof HTMLElement)) throw new Error("未找到 Issue 行");
      return item;
    };
    workspaceFallback.setFallbackGitHubIssuesForTests({
      "sena-nana/LiliaGithub": [
        {
          number: 12,
          title: "待编辑 Issue",
          state: "open",
          body: "初始正文",
          labels: ["bug", "ui"],
          assignees: ["alice", "bob"],
          htmlUrl: "https://github.com/sena-nana/LiliaGithub/issues/12",
          updatedAt: "2026-06-11T12:00:00Z",
          createdAt: "2026-06-10T12:00:00Z",
        },
      ],
    });

    await renderAt("/repos/LiliaGithub");
    await waitForRepoTitle("LiliaGithub");
    await fireEvent.click(await screen.findByRole("tab", { name: "Issues" }));

    expect(await screen.findByText(/待编辑 Issue/, {}, { timeout: 5000 })).toBeInTheDocument();
    const editingItem = issueItemByTitle(/待编辑 Issue/);
    await fireEvent.click(within(editingItem).getByRole("button", { name: "编辑" }));
    await fireEvent.update(within(editingItem).getByPlaceholderText("Issue 标题"), "编辑后标题");
    await fireEvent.update(within(editingItem).getByPlaceholderText("Issue 内容"), "新正文");
    await fireEvent.update(within(editingItem).getByPlaceholderText("labels, comma separated"), "backend, docs");
    await fireEvent.update(within(editingItem).getByPlaceholderText("assignees"), "carol, dana");
    await fireEvent.click(within(editingItem).getByRole("button", { name: "保存" }));

    expect(await screen.findByText("#12 编辑后标题")).toBeInTheDocument();
    expect(issueItemByTitle("#12 编辑后标题")).toHaveTextContent("backend, docs");
    expect(issueItemByTitle("#12 编辑后标题")).toHaveTextContent("carol, dana");

    const updatedItem = issueItemByTitle("#12 编辑后标题");
    await fireEvent.click(within(updatedItem).getByRole("button", { name: "编辑" }));
    expect(within(updatedItem).getByDisplayValue("新正文")).toBeInTheDocument();
  });

  it("仓库项目信息页无 GitHub 远端时保留 README 并显示远端空态", async () => {
    workspaceFallback.setFallbackRepoFilesForTests({
      LiliaGithub: {
        "": [
          { path: "README.md", name: "README.md", kind: "file", hasChildren: false },
        ],
      },
    });
    workspaceFallback.setFallbackRepoFilePreviewsForTests({
      LiliaGithub: {
        "README.md": {
          path: "README.md",
          name: "README.md",
          previewKind: "markdown",
          images: {},
          content: "# LocalOnly\n\n本地 README。",
          size: 24,
          truncated: false,
        },
      },
    });
    workspaceFallback.setFallbackRepoOverridesForTests({
      LiliaGithub: repoSummary("LiliaGithub", { githubFullName: null, remoteUrl: null }),
    });
    await renderAt("/repos/LiliaGithub");

    expect(await screen.findByRole("heading", { level: 1, name: "LocalOnly" })).toBeInTheDocument();
    expect(await screen.findByLabelText("README 内容")).toHaveTextContent("本地 README");
    expect(screen.queryByRole("tab", { name: "README.md" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "README.txt" })).toBeNull();

    await fireEvent.click(screen.getByRole("tab", { name: "Actions" }));
    expect(screen.getByText("当前仓库没有 GitHub 远端，Issues、Actions 和 Settings 不可用。")).toBeInTheDocument();
  });

  it("提交历史行点击后在主区域卡片下方显示提交详情卡片", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { router } = await renderAt("/repos/LiliaGithub");

    await fireEvent.click(await screen.findByRole("tab", { name: "历史" }));
    await fireEvent.click(await screen.findByRole("button", { name: /搭建 LiliaGithub MVP/ }));

    expect(router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub/history");
    expect(await screen.findByLabelText("提交详情卡片")).toBeInTheDocument();
    expect(await screen.findByLabelText("提交元数据")).toHaveTextContent("1234567");
    expect(screen.getByLabelText("提交元数据")).not.toHaveTextContent("1234567890abcdef");
    await fireEvent.click(screen.getByRole("button", { name: "复制完整 hash 1234567" }));
    expect(writeText).toHaveBeenCalledWith("1234567890abcdef");
    expect(await screen.findByText("完整 hash 已复制")).toBeInTheDocument();
    expect(await screen.findByLabelText("改动文件列表")).toHaveTextContent("src/pages/Home.vue");
    const diffPanel = await screen.findByLabelText("改动文件 diff");
    const collapseToggle = within(diffPanel).getByRole("button", { name: "折叠 diff" });
    expect(collapseToggle).toHaveAttribute("aria-pressed", "true");
    expect(diffPanel).toHaveTextContent("@@ -1,3 +1,4 @@");
    expect(diffPanel).toHaveTextContent("<h1>LiliaGithub</h1>");

    await fireEvent.click(collapseToggle);

    expect(collapseToggle).toHaveAttribute("aria-pressed", "false");
    expect(diffPanel).toHaveTextContent("diff --git a/src/pages/Home.vue b/src/pages/Home.vue");

    await fireEvent.click(collapseToggle);

    await fireEvent.click(screen.getByRole("button", { name: /src-tauri\/src\/workspace.rs/ }));

    expect(screen.getByLabelText("改动文件 diff")).toHaveTextContent("@@ -10,4 +10,5 @@");
    expect(screen.getByLabelText("改动文件 diff")).toHaveTextContent("pub github_full_name: Option<String>,");

    await fireEvent.click(screen.getByRole("button", { name: "关闭提交详情" }));

    expect(screen.queryByLabelText("提交详情卡片")).toBeNull();
  });

  it("提交详情页可通过独立路由打开并返回仓库历史", async () => {
    await renderAt("/repos/LiliaGithub/commits/1234567890abcdef");

    expect(await screen.findByRole("heading", { level: 1, name: "提交详情" })).toBeInTheDocument();
    expect(await screen.findByText("改动文件")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "折叠 diff" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("+42")).toBeInTheDocument();
    expect(screen.getByText("-3")).toBeInTheDocument();
    expect(screen.getByText("@@ -1,3 +1,4 @@")).toBeInTheDocument();
    expect(screen.getByLabelText("改动文件 diff")).toHaveTextContent("<h1>LiliaGithub</h1>");

    await fireEvent.click(screen.getByRole("link", { name: "返回历史" }));

    expect(await screen.findByRole("tab", { name: "历史" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByLabelText("提交历史密集列表")).toBeInTheDocument();
  });

  it("仓库详情页可配置、运行并查看命令运行终端", async () => {
    const { router } = await renderAt("/repos/LiliaGithub");

    await waitForRepoTitle("LiliaGithub");
    expect(screen.queryByRole("button", { name: "启动配置" })).toBeNull();
    expect(screen.queryByRole("button", { name: "刷新状态" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "命令运行" })).toBeNull();
    const viewTabs = screen.getByRole("tablist", { name: "仓库页面" });
    expect(within(viewTabs).queryByRole("tab", { name: "分支" })).toBeNull();
    expect(screen.queryByRole("group", { name: "当前分支" })).toBeNull();

    const launchGroup = screen.getByRole("group", { name: "命令执行" });
    const launchInput = await within(launchGroup).findByRole("combobox", { name: "启动命令" });
    await waitFor(() => {
      expect(launchInput).toHaveValue("yarn tauri:dev");
      expect(within(launchGroup).getByRole("button", { name: "运行" })).toBeEnabled();
    });
    await fireEvent.click(within(launchGroup).getByRole("link", { name: "日志" }));
    await waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub/run");
    });
    expect(await screen.findByLabelText("启动终端")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "刷新状态" })).toBeNull();
    expect(screen.queryByRole("button", { name: "启动配置" })).toBeNull();

    const launchTerminal = screen.getByLabelText("启动终端");
    const launchCard = launchTerminal.closest(".project-terminal-card");
    if (!(launchCard instanceof HTMLElement)) throw new Error("未找到启动终端卡片");
    await fireEvent.update(launchInput, "ver");
    expect(await screen.findByRole("listbox", { name: "启动指令候选" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^preview/ })).toBeNull();
    expect(screen.getByRole("option", { name: /^verify/ })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("option", { name: /^verify/ }));
    await waitFor(() => {
      expect(launchInput).toHaveValue("yarn verify");
      expect(within(launchGroup).getByRole("button", { name: "运行" })).toBeEnabled();
    });
    const idleTerminal = screen.getByLabelText("启动终端");
    expect(idleTerminal).toHaveTextContent("暂无输出。");
    expect(idleTerminal).not.toHaveTextContent("启动命令：");
    expect(within(launchCard).queryByRole("button", { name: /yarn verify/ })).toBeNull();
    expect(within(launchCard).queryByRole("button", { name: "隐藏" })).toBeNull();

    await fireEvent.click(within(launchGroup).getByRole("button", { name: "运行" }));

    await waitFor(() => {
      const terminal = screen.getByLabelText("启动终端");
      expect(terminal).toHaveTextContent("启动命令：yarn verify");
      expect(terminal).toHaveTextContent("开发服务已启动");
    });
    expect(within(launchGroup).getByRole("button", { name: "停止" })).toBeEnabled();
    expect(within(launchCard).queryByRole("button", { name: "停止" })).toBeNull();

    await fireEvent.click(within(launchGroup).getByRole("button", { name: "停止" }));
    await waitFor(() => {
      expect(within(launchGroup).getByRole("button", { name: "运行" })).toBeEnabled();
    });
    expect(screen.getByLabelText("启动终端")).toHaveTextContent("启动命令：yarn verify");
    await waitFor(() => {
      expect(screen.getByLabelText("启动终端")).toHaveTextContent("已停止快速启动进程");
    });

    await fireEvent.update(launchInput, "   ");
    expect(within(launchGroup).getByRole("button", { name: "运行" })).toBeDisabled();
    await fireEvent.update(launchInput, "yarn test --watch");
    await fireEvent.click(within(launchGroup).getByRole("button", { name: "运行" }));
    await waitFor(() => {
      expect(screen.getByLabelText("启动终端")).toHaveTextContent("启动命令：yarn test --watch");
    });
    await waitFor(() => {
      expect(within(launchGroup).getByRole("button", { name: "停止" })).toBeEnabled();
    });
    await fireEvent.click(within(launchGroup).getByRole("button", { name: "停止" }));
  });

  it("运行失败信息显示在命令卡片内而不是页头状态区", async () => {
    workspaceFallback.setFallbackStopLaunchOverrideForTests(() => {
      throw new Error("停止失败：operation attempted is not supported");
    });

    await renderAt("/repos/LiliaGithub");

    const launchGroup = screen.getByRole("group", { name: "命令执行" });
    await waitFor(() => {
      expect(within(launchGroup).getByRole("button", { name: "运行" })).toBeEnabled();
    });
    await fireEvent.click(within(launchGroup).getByRole("link", { name: "日志" }));
    expect(await screen.findByLabelText("启动终端")).toBeInTheDocument();

    await fireEvent.click(within(launchGroup).getByRole("button", { name: "运行" }));
    await waitFor(() => {
      expect(within(launchGroup).getByRole("button", { name: "停止" })).toBeEnabled();
    });

    await fireEvent.click(within(launchGroup).getByRole("button", { name: "停止" }));

    const launchCard = document.querySelector(".project-terminal-card");
    if (!(launchCard instanceof HTMLElement)) throw new Error("未找到启动终端卡片");
    await waitFor(() => {
      expect(within(launchCard).getAllByText("Error: 停止失败：operation attempted is not supported").length).toBeGreaterThan(0);
    });
    expect(document.querySelector(".repo-workbench__status")).toBeNull();
  });

  it("总览页一键同步直接执行且不打开预检弹层", async () => {
    await renderAt("/overview");

    await clickOverviewSync();

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "批量同步预检" })).toBeNull();
    });
  });

  it("批量同步失败后进入项目详情处理失败仓库", async () => {
    mockLiliaGithubSyncFailure();
    const { router } = await renderAt("/overview");

    await clickOverviewSync();

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "批量同步预检" })).toBeNull();
      expect(queryRepoSidebarErrorCard()).toBeNull();
      expect(within(repoStatusRow("sena-nana/LiliaGithub")).getByLabelText("最近同步失败"))
        .toHaveAttribute("title", "认证失败");
    });

    await router.push("/repos/LiliaGithub");
    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
    expect(await findRepoDetailRecentSyncFailure()).toHaveTextContent("认证失败");

    workspaceFallback.setFallbackBulkExecuteOverrideForTests(null);
    await fireEvent.click(within(repoDetailRecentSyncFailure()).getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(queryRepoSidebarErrorCard()).toBeNull();
    });
  });

  it("仓库详情页优先显示最近同步失败而不重复仓库操作错误", async () => {
    const { setRepoActionError, state } = await import("../src/composables/workspace/state");
    await renderAt("/repos/LiliaGithub");
    await waitForRepoTitle("LiliaGithub");

    const repo = state.repos.find((item) => item.id === "LiliaGithub") ?? repoSummary("LiliaGithub", { ahead: 1 });
    state.recentSync = {
      preview: {
        operation: "sync",
        eligible: [{ repo, reason: "有本地提交待推送" }],
        blocked: [],
        warnings: [],
      },
      results: [{ repoId: repo.id, status: "error", message: "认证失败", summary: null }],
      retryingRepoIds: [],
      updatedAt: 2,
    };
    setRepoActionError(repo.id, "自动同步正在执行");

    await waitFor(() => {
      expect(repoDetailRecentSyncFailure()).toHaveTextContent("认证失败");
    });
    expect(await findRepoSidebarErrorCard()).not.toHaveTextContent("自动同步正在执行");
  });

  it("仓库详情页右侧错误区出现或消失时保留项目主内容区", async () => {
    mockLiliaGithubSyncFailure();
    await renderAt("/overview");

    await clickOverviewSync();

    await waitFor(() => {
      expect(within(repoStatusRow("sena-nana/LiliaGithub")).getByLabelText("最近同步失败"))
        .toHaveAttribute("title", "认证失败");
    });

    await fireEvent.click(repoStatusRow("sena-nana/LiliaGithub"));

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();

    expect(await findRepoDetailRecentSyncFailure()).toHaveTextContent("认证失败");
    expect(screen.getByRole("tablist", { name: "仓库页面" })).toBeInTheDocument();

    workspaceFallback.setFallbackBulkExecuteOverrideForTests(null);
    await fireEvent.click(within(repoDetailRecentSyncFailure()).getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(queryRepoSidebarErrorCard()).toBeNull();
    });
    expect(document.querySelector(".repo-workbench__status")).toBeNull();
    expect(screen.getByRole("tablist", { name: "仓库页面" })).toBeInTheDocument();
  });

  it("总览页可直接进入最近同步失败仓库继续处理", async () => {
    await mockLiliaGithubSyncFailure();
    const { router } = await renderAt("/overview");

    await clickOverviewSync();

    await waitFor(() => {
      expect(within(repoStatusRow("sena-nana/LiliaGithub")).getByLabelText("最近同步失败"))
        .toHaveAttribute("title", "认证失败");
    });

    await fireEvent.click(repoStatusRow("sena-nana/LiliaGithub"));

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
    expect(router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub");
    expect(await findRepoDetailRecentSyncFailure()).toHaveTextContent("认证失败");
  });

  it("设置页可通过 tab query 显示关于页", async () => {
    await renderAt("/settings?tab=about");

    expect(await screen.findByRole("heading", { level: 1, name: "关于" })).toBeInTheDocument();
  });

  it("设置页仓库 tab 可恢复隐藏仓库", async () => {
    const service = await import("../src/services/workspace");
    await service.hideRepo("LiliaGithub");

    await renderAt("/settings?tab=repositories");

    expect(await screen.findAllByRole("heading", { name: "仓库" })).toHaveLength(1);
    expect(await screen.findByRole("region", { name: "工作区与仓库" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "贡献身份" })).toBeInTheDocument();
    await fireEvent.click(await screen.findByRole("button", { name: "恢复管理" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "恢复管理" })).not.toBeInTheDocument();
    });
    expect((await service.refreshRepos()).some((repo) => repo.id === "LiliaGithub")).toBe(true);
  });

  it("设置页账户 tab 可更换 GitHub 账号", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined),
      },
    });
    await renderAt("/settings?tab=account");

    expect(await screen.findAllByText("lilia-user")).not.toHaveLength(0);
    await fireEvent.click(await screen.findByRole("button", { name: "更换 GitHub 账号" }));

    expect(await screen.findByText("等待 GitHub 授权确认")).toBeInTheDocument();
    expect(await screen.findByText("授权码已复制，请在 GitHub 授权页粘贴。")).toBeInTheDocument();
    expect(screen.getByText("ABCD-1234")).toBeInTheDocument();
  });

  it("未知路由回到首页", async () => {
    await renderAt("/missing");

    expect(await screen.findByRole("heading", { level: 1, name: "个人首页" })).toBeInTheDocument();
  });

  it("未知设置 tab 回落到外观", async () => {
    await renderAt("/settings?tab=missing");

    expect(await screen.findByRole("heading", { level: 1, name: "外观" })).toBeInTheDocument();
  });
});

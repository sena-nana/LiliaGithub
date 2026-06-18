import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.vue";
import { installContextMenu } from "../src/composables/useContextMenu";
import { vContextMenu } from "../src/directives/contextMenu";
import { createLiliaGithubRouter } from "../src/router";
import type { GitHubIssue, GitHubRepoSummary, GitHubWorkflowRun, RepoChange } from "../src/services/workspace";
import { repoDetail, repoSummary } from "./fixtures/workspace";

const TIMELINE_ISSUE_CACHE_KEY = "lilia-github.home.timelineIssues.v1";

async function renderAt(path: string) {
  installContextMenu();
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

async function clickOverviewSync() {
  const main = document.querySelector("main");
  if (!(main instanceof HTMLElement)) throw new Error("未找到主内容区域");
  await screen.findByRole("heading", { level: 1, name: "项目总览" });
  await within(main).findByLabelText("仓库状态列表");
  await screen.findByText("↑1");
  await fireEvent.click(within(screen.getByLabelText("项目总览操作")).getByRole("button", { name: "一键同步" }));
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

describe("基础路由", () => {
  afterEach(async () => {
    cleanup();
    vi.useRealTimers();
    const service = await import("../src/services/workspace");
    service.setFallbackStopLaunchOverrideForTests(null);
  });

  it("默认首页显示 Git 项目总览", async () => {
    await renderAt("/");

    expect(
      await screen.findByRole("heading", { level: 1, name: "项目总览" }),
    ).toBeInTheDocument();
    expect(screen.getByText("C:\\Files\\workspace")).toBeInTheDocument();
    expect(screen.queryByText("octo-user")).toBeNull();
    expect(screen.getByText("最近工作结果")).toBeInTheDocument();
    expect(await screen.findByLabelText("本地提交贡献图")).toBeInTheDocument();
    expect(screen.getByText(/次提交，最近一年/)).toBeInTheDocument();
    expect(screen.queryByText(/刷新于/)).toBeNull();
    expect(screen.queryByText(/覆盖 \d+ 个仓库/)).toBeNull();
    expect(document.querySelector(".contribution-day[title$='次提交']")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "变更量排行" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "编程语言占比" })).toBeInTheDocument();
    expect(await screen.findByLabelText("编程语言占比图")).toBeInTheDocument();
    expect(screen.queryByText(/HEAD 已提交文件/)).toBeNull();
    expect(await screen.findByText("TypeScript")).toBeInTheDocument();
    expect(await screen.findByText("50%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "刷新语言" })).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "含改动" }));
    expect(screen.queryByText(/包含未提交改动/)).toBeNull();
    expect(await screen.findByText("49%")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "GitHub 时间线" })).toBeInTheDocument();
    const githubTimelineList = screen.getByLabelText("GitHub 时间线列表");
    expect(await within(githubTimelineList).findByText("Issue #12")).toBeInTheDocument();
    expect(githubTimelineList).toHaveTextContent("补齐仓库管理入口");
    expect(githubTimelineList).toHaveTextContent("提交");
    expect(githubTimelineList).toHaveTextContent("搭建 LiliaGithub MVP");
    expect(githubTimelineList).toHaveTextContent("创建仓库");
    expect(githubTimelineList).toHaveTextContent("仓库同步状态");
    expect(githubTimelineList).toHaveTextContent("sena-nana/LiliaGithub");
    expect(screen.getByRole("heading", { level: 2, name: "仓库状态" })).toBeInTheDocument();
    expect(screen.getByText("2 个 GitHub 项目")).toBeInTheDocument();
    const repoStatusList = screen.getByLabelText("仓库状态列表");
    expect(repoStatusList).toBeInTheDocument();
    expect(repoStatusList).toHaveTextContent("sena-nana/LiliaGithub");
    expect(repoStatusList).not.toHaveTextContent("分支");
    expect(repoStatusList).not.toHaveTextContent("同步");
    expect(repoStatusList).not.toHaveTextContent("更新时间");
    expect(screen.getByRole("link", { name: "打开 sena-nana/LiliaGithub" })).toBeInTheDocument();
    expect(screen.getByLabelText("项目总览操作")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "一键同步" })).toHaveLength(1);
  });

  it("总览页仓库状态行可直接进入仓库详情", async () => {
    const { router } = await renderAt("/");

    const repoLink = await screen.findByRole("link", { name: "打开 sena-nana/LiliaGithub" });
    await waitFor(() => expect(repoLink).toHaveAttribute("title", "C:\\Files\\workspace\\LiliaGithub"), { timeout: 3000 });
    await fireEvent.click(repoLink);

    await waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub");
    });
    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" }, { timeout: 3000 }))
      .toBeInTheDocument();
  });

  it("总览页未 clone 的 GitHub 项目可进入远程详情并屏蔽本地 Git 功能", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackGitHubRepoPagesForTests([
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
    service.setFallbackGitHubRepoReadmesForTests({
      "sena-nana/NewRepo": {
        repoId: "github:sena-nana/NewRepo",
        path: "README.md",
        images: {},
        format: "md",
        updatedAt: null,
        content: "# NewRepo\n\n云端 README。",
      },
    });
    const { router } = await renderAt("/");

    await fireEvent.click(await screen.findByRole("link", { name: "打开 sena-nana/NewRepo" }));

    await waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe("/repos/github%3Asena-nana%2FNewRepo");
    });
    expect(await screen.findByRole("heading", { level: 1, name: "NewRepo" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Git 信息" })).toBeNull();
    expect(screen.queryByRole("tablist", { name: "本地 Git 视图" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Push" })).toBeNull();
    expect(screen.queryByRole("button", { name: "拉取" })).toBeNull();
    expect(screen.queryByRole("button", { name: "文件夹" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: "提交" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: "快速启动" })).toBeNull();
    expect(await screen.findByLabelText("README 内容")).toHaveTextContent("云端 README");
    expect(screen.getByRole("tab", { name: "Issues" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
  });

  it("远程详情页没有云端 README 时显示远程空态", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackGitHubRepoPagesForTests([
      {
        items: [githubRepoSummary("sena-nana/EmptyRemote")],
        nextPage: null,
      },
    ]);
    service.setFallbackGitHubRepoReadmesForTests({
      "sena-nana/EmptyRemote": null,
    });

    await renderAt("/repos/github%3Asena-nana%2FEmptyRemote");

    expect(await screen.findByRole("heading", { level: 1, name: "EmptyRemote" })).toBeInTheDocument();
    expect(await screen.findByText("当前远程仓库没有 README。")).toBeInTheDocument();
  });

  it("本地仓库可通过一级文件树 tab 进入文件浏览页", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackRepoFilesForTests({
      LiliaGithub: {
        "": [
          { path: "README.md", name: "README.md", kind: "file", hasChildren: false },
        ],
      },
    });
    service.setFallbackRepoFilePreviewsForTests({
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
    expect(screen.getByRole("tab", { name: "文件树" })).toHaveClass("is-active");
    expect(router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub/files");
  });

  it("远端仓库不显示文件树一级 tab，直接访问 /files 会回退到默认页", async () => {
    const { router } = await renderAt("/repos/github%3Asena-nana%2FEmptyRemote/files");

    expect(await screen.findByRole("heading", { level: 1, name: "EmptyRemote" })).toBeInTheDocument();
    await waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe("/repos/github%3Asena-nana%2FEmptyRemote");
    });
    expect(screen.queryByRole("tab", { name: "文件树" })).toBeNull();
    expect(screen.getByRole("tab", { name: "项目" })).toHaveClass("is-active");
  });

  it("总览页隐藏禁用的 GitHub 项目", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackGitHubRepoPagesForTests([
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
    await renderAt("/");

    const repoStatusList = await screen.findByLabelText("仓库状态列表");
    expect(await within(repoStatusList).findByText("sena-nana/LiliaGithub")).toBeInTheDocument();
    expect(within(repoStatusList).queryByText("sena-nana/DisabledRepo")).toBeNull();
  });

  it("总览页归档 GitHub 项目显示 Archive 标签", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackGitHubRepoPagesForTests([
      {
        items: [
          githubRepoSummary("sena-nana/ArchivedRepo", {
            archived: true,
            updatedAt: "2026-06-13T08:00:00Z",
          }),
        ],
        nextPage: null,
      },
    ]);
    await renderAt("/");

    const repoStatusList = await screen.findByLabelText("仓库状态列表");
    const row = (await within(repoStatusList).findByText("sena-nana/ArchivedRepo")).closest(".repo-status-row");
    expect(row).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("Archive")).toBeInTheDocument();
  });

  it("总览页归档 GitHub 项目排序到最后", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackGitHubRepoPagesForTests([
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
    await renderAt("/");

    const repoStatusList = await screen.findByLabelText("仓库状态列表");
    await within(repoStatusList).findByText("sena-nana/ArchivedRepo");
    await within(repoStatusList).findByText("sena-nana/ActiveRepo");
    const rows = Array.from(repoStatusList.querySelectorAll(".repo-status-row"));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent("sena-nana/ArchivedRepo");
  });

  it("总览页 GitHub 项目支持手动加载更多并去重", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackGitHubRepoPagesForTests([
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
    await renderAt("/");

    const repoStatusList = await screen.findByLabelText("仓库状态列表");
    await within(repoStatusList).findByText("sena-nana/LiliaGithub");
    expect(within(repoStatusList).queryByText("sena-nana/PageTwo")).toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: "加载更多" }));

    expect(await within(repoStatusList).findByText("sena-nana/PageTwo")).toBeInTheDocument();
    expect(within(repoStatusList).getAllByText("sena-nana/LiliaGithub")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "加载更多" })).toBeNull();
  });

  it("总览页 GitHub 时间线按最近一周更新时间拉取 issue", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00Z"));
    const service = await import("../src/services/workspace");
    const repos = Array.from({ length: 3 }, (_, index) =>
      githubRepoSummary(`sena-nana/Timeline${index}`, {
        createdAt: `2026-06-${String(index + 1).padStart(2, "0")}T08:00:00Z`,
        updatedAt: `2026-06-${String(index + 1).padStart(2, "0")}T09:00:00Z`,
      }),
    );
    service.setFallbackGitHubRepoPagesForTests([{ items: repos, nextPage: null }]);
    service.setFallbackGitHubIssuesForTests(Object.fromEntries(
      repos.map((repo, repoIndex) => [
        repo.fullName,
        [
          githubIssue(repo.fullName, repoIndex * 10 + 1, "2026-06-13T10:00:00Z"),
          githubIssue(repo.fullName, repoIndex * 10 + 2, "2026-06-05T10:00:00Z"),
        ],
      ]),
    ));

    await renderAt("/");

    await screen.findByLabelText("GitHub 时间线列表");
    await waitFor(() => {
      expect(service.getFallbackGitHubIssueListCallsForTests()).toHaveLength(3);
    });
    expect(service.getFallbackGitHubIssueListCallsForTests()).toEqual(
      repos.map((repo) => ({
        repoFullName: repo.fullName,
        state: "all",
        perPage: 100,
        sort: "updated",
        direction: "desc",
        since: "2026-06-06T12:00:00.000Z",
      })),
    );
    expect(await screen.findByText("Issue #1")).toBeInTheDocument();
    expect(screen.queryByText("Issue #2")).toBeNull();
  });

  it("总览页 GitHub 时间线展示 Actions 运行并在仓库状态直达对应运行", async () => {
    const { setRepoActionError } = await import("../src/composables/workspace/state");
    const service = await import("../src/services/workspace");
    const repo = githubRepoSummary("sena-nana/LiliaGithub");
    service.setFallbackGitHubWorkflowRunsForTests({
      [repo.fullName]: [
        githubWorkflowRun(repo.fullName, 1200, "2026-08-13T12:30:00Z", {
          status: "in_progress",
          conclusion: null,
          displayTitle: "正在验证总览页",
          branch: "codex/project-view",
          event: "workflow_dispatch",
        }),
      ],
    });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(new Date("2026-06-10T09:00:00Z").getTime());
    setRepoActionError(repo.name, "合并失败：not something we can merge");
    nowSpy.mockRestore();

    await renderAt("/");

    expect(await screen.findByRole("heading", { level: 1, name: "项目总览" })).toBeInTheDocument();
    await waitFor(() => {
      expect(service.getFallbackGitHubWorkflowRunListCallsForTests()).toContainEqual({
        repoFullName: repo.fullName,
        perPage: 5,
      });
    });

    const repoStatusList = await screen.findByLabelText("仓库状态列表");
    const statusRow = await waitFor(() => {
      const candidate = within(repoStatusList).getByText(repo.fullName).closest(".repo-status-row");
      if (!candidate) throw new Error("未找到仓库状态行");
      return candidate;
    });
    const actionStatus = await waitFor(() => within(statusRow as HTMLElement).getByLabelText("Actions 运行中"));
    expect(actionStatus).toHaveAttribute("title", "Actions 运行中 · 正在验证总览页 · CI · codex/project-view");
    expect(within(statusRow as HTMLElement).queryByRole("link", { name: "运行" })).toBeNull();

    const timeline = await screen.findByLabelText("GitHub 时间线列表");
    expect(await within(timeline).findByText("Issue #12")).toBeInTheDocument();
    expect(await within(timeline).findByText("Actions 运行中")).toBeInTheDocument();
    const rows = within(timeline).getAllByRole("listitem");
    const issueIndex = rows.findIndex((row) => row.textContent?.includes("Issue #12"));
    const errorIndex = rows.findIndex((row) => row.textContent?.includes("合并失败：not something we can merge"));
    const workflowIndex = rows.findIndex((row) => row.textContent?.includes("正在验证总览页"));
    expect(issueIndex).toBeGreaterThanOrEqual(0);
    expect(errorIndex).toBeGreaterThanOrEqual(0);
    expect(workflowIndex).toBeGreaterThanOrEqual(0);
    expect(workflowIndex).toBeLessThan(issueIndex);
    expect(issueIndex).toBeLessThan(errorIndex);
  });

  it("总览页 GitHub 时间线按仓库增量刷新 Actions 运行", async () => {
    const service = await import("../src/services/workspace");
    const fastRepo = githubRepoSummary("sena-nana/FastTimeline", { updatedAt: "2026-06-12T08:00:00Z" });
    const slowRepo = githubRepoSummary("sena-nana/SlowTimeline", { updatedAt: "2026-06-12T09:00:00Z" });
    const workflowResolvers = new Map<string, (runs: GitHubWorkflowRun[]) => void>();
    service.setFallbackGitHubRepoPagesForTests([{ items: [fastRepo, slowRepo], nextPage: null }]);
    service.setFallbackGitHubIssuesForTests({
      [fastRepo.fullName]: [],
      [slowRepo.fullName]: [],
    });
    service.setFallbackGitHubWorkflowRunsOverrideForTests((repoFullName) =>
      new Promise((resolve) => {
        workflowResolvers.set(repoFullName, resolve);
      }),
    );

    await renderAt("/");

    await waitFor(() => {
      expect(service.getFallbackGitHubWorkflowRunListCallsForTests()).toHaveLength(2);
    });
    workflowResolvers.get(fastRepo.fullName)?.([
      githubWorkflowRun(fastRepo.fullName, 2101, "2026-06-13T10:00:00Z", {
        displayTitle: "快速仓库已验证",
      }),
    ]);

    const timeline = await screen.findByLabelText("GitHub 时间线列表");
    expect(await within(timeline).findByText("快速仓库已验证")).toBeInTheDocument();
    expect(within(timeline).queryByText("慢速仓库已验证")).toBeNull();

    workflowResolvers.get(slowRepo.fullName)?.([
      githubWorkflowRun(slowRepo.fullName, 2102, "2026-06-13T11:00:00Z", {
        displayTitle: "慢速仓库已验证",
      }),
    ]);

    expect(await within(timeline).findByText("慢速仓库已验证")).toBeInTheDocument();
  });

  it("总览页 GitHub 时间线点击 Issue 事件进入仓库详情项目信息 Issues 并定位目标 issue", async () => {
    const { router } = await renderAt("/");

    const timeline = await screen.findByLabelText("GitHub 时间线列表");
    const issueLink = await within(timeline).findByRole("link", { name: "Issue #12" });
    await fireEvent.click(issueLink);

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Issues" })).toHaveClass("is-active");
    });
    expect(router.currentRoute.value.path).toBe("/repos/LiliaGithub");
    expect(router.currentRoute.value.query).toMatchObject({
      projectTab: "issues",
      issue: "12",
    });
    await waitFor(() => {
      expect(document.querySelector('[data-issue-number="12"].project-row--issue.is-target')).toBeInTheDocument();
    });
  });

  it("总览页 GitHub 时间线点击 Actions 事件进入仓库详情项目信息 Actions 并定位目标 run", async () => {
    const service = await import("../src/services/workspace");
    const repo = githubRepoSummary("sena-nana/LiliaGithub");
    service.setFallbackGitHubWorkflowRunsForTests({
      [repo.fullName]: [
        githubWorkflowRun(repo.fullName, 1310, "2026-06-12T14:00:00Z", {
          status: "completed",
          conclusion: "success",
          displayTitle: "release pipeline",
          branch: "main",
          event: "workflow_dispatch",
        }),
      ],
    });
    const { router } = await renderAt("/");

    const timeline = await screen.findByLabelText("GitHub 时间线列表");
    const workflowLink = await within(timeline).findByRole("link", { name: "Actions 通过" });
    await fireEvent.click(workflowLink);

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Actions" })).toHaveClass("is-active");
    });
    expect(router.currentRoute.value.path).toBe("/repos/LiliaGithub");
    expect(router.currentRoute.value.query).toMatchObject({
      projectTab: "actions",
      run: "1310",
    });
    await waitFor(() => {
      expect(document.querySelector('[data-run-id="1310"].project-row--action.is-target')).toBeInTheDocument();
    });
  });

  it("总览页 GitHub 时间线命中持久缓存时不重复拉取 issue", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00Z"));
    const service = await import("../src/services/workspace");
    const repo = githubRepoSummary("sena-nana/CachedTimeline");
    service.setFallbackGitHubRepoPagesForTests([{ items: [repo], nextPage: null }]);
    localStorage.setItem(TIMELINE_ISSUE_CACHE_KEY, JSON.stringify({
      [repo.fullName]: {
        repoFullName: repo.fullName,
        since: "2026-06-06T12:00:00.000Z",
        fetchedAt: Date.now() - 60_000,
        issues: [githubIssue(repo.fullName, 88, "2026-06-13T10:00:00Z")],
      },
    }));

    await renderAt("/");

    expect(await screen.findByText("Issue #88")).toBeInTheDocument();
    await waitFor(() => {
      expect(service.getFallbackGitHubIssueListCallsForTests()).toHaveLength(0);
    });
  });

  it("总览页 GitHub 时间线缓存过期后重新拉取并刷新缓存", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00Z"));
    const service = await import("../src/services/workspace");
    const repo = githubRepoSummary("sena-nana/ExpiredTimeline");
    service.setFallbackGitHubRepoPagesForTests([{ items: [repo], nextPage: null }]);
    service.setFallbackGitHubIssuesForTests({
      [repo.fullName]: [githubIssue(repo.fullName, 90, "2026-06-13T10:00:00Z")],
    });
    localStorage.setItem(TIMELINE_ISSUE_CACHE_KEY, JSON.stringify({
      [repo.fullName]: {
        repoFullName: repo.fullName,
        since: "2026-06-06T12:00:00.000Z",
        fetchedAt: Date.now() - 6 * 60_000,
        issues: [githubIssue(repo.fullName, 89, "2026-06-13T09:00:00Z")],
      },
    }));

    await renderAt("/");

    expect(await screen.findByText("Issue #90")).toBeInTheDocument();
    await waitFor(() => {
      expect(service.getFallbackGitHubIssueListCallsForTests()).toHaveLength(1);
    });
    expect(JSON.parse(localStorage.getItem(TIMELINE_ISSUE_CACHE_KEY) ?? "{}")[repo.fullName].issues[0].number)
      .toBe(90);
  });

  it("从仓库详情返回总览时复用仓库状态和时间线缓存", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00Z"));
    const service = await import("../src/services/workspace");
    const repo = githubRepoSummary("sena-nana/ReturnTimeline");
    service.setFallbackGitHubRepoPagesForTests([{ items: [repo], nextPage: null }]);
    service.setFallbackGitHubIssuesForTests({
      [repo.fullName]: [githubIssue(repo.fullName, 93, "2026-06-13T10:00:00Z")],
    });
    const { router } = await renderAt("/");

    expect(await screen.findByText("Issue #93")).toBeInTheDocument();
    await waitFor(() => {
      expect(service.getFallbackGitHubIssueListCallsForTests()).toHaveLength(1);
    });

    await router.push("/repos/LiliaGithub");
    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();

    await router.push("/");
    expect(await screen.findByRole("heading", { level: 1, name: "项目总览" })).toBeInTheDocument();
    expect(await screen.findByText("Issue #93")).toBeInTheDocument();
    expect(screen.getByLabelText("仓库状态列表")).toHaveTextContent(repo.fullName);
    expect(service.getFallbackGitHubIssueListCallsForTests()).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(TIMELINE_ISSUE_CACHE_KEY) ?? "{}")[repo.fullName].issues[0].number)
      .toBe(93);
  });

  it("总览页刷新仓库后重新拉取当前可见仓库的 issue", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00Z"));
    const service = await import("../src/services/workspace");
    const repo = githubRepoSummary("sena-nana/RefreshTimeline");
    service.setFallbackGitHubRepoPagesForTests([{ items: [repo], nextPage: null }]);
    service.setFallbackGitHubIssuesForTests({
      [repo.fullName]: [githubIssue(repo.fullName, 92, "2026-06-13T10:00:00Z")],
    });
    localStorage.setItem(TIMELINE_ISSUE_CACHE_KEY, JSON.stringify({
      [repo.fullName]: {
        repoFullName: repo.fullName,
        since: "2026-06-06T12:00:00.000Z",
        fetchedAt: Date.now() - 60_000,
        issues: [githubIssue(repo.fullName, 91, "2026-06-13T09:00:00Z")],
      },
    }));

    await renderAt("/");

    expect(await screen.findByText("Issue #91")).toBeInTheDocument();
    expect(service.getFallbackGitHubIssueListCallsForTests()).toHaveLength(0);

    const refreshRepos = within(screen.getByLabelText("项目总览操作")).getByRole("button", { name: "刷新仓库" });
    await waitFor(() => {
      expect(refreshRepos).toBeEnabled();
    });
    await fireEvent.click(refreshRepos);

    expect(await screen.findByText("Issue #92")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Issue #91")).toBeNull();
    });
    expect(service.getFallbackGitHubIssueListCallsForTests()).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(TIMELINE_ISSUE_CACHE_KEY) ?? "{}")[repo.fullName].issues[0].number)
      .toBe(92);
  });

  it("总览页 GitHub 项目加载失败时保留本地侧栏并可重试", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackGitHubReposErrorForTests("GitHub 绑定已失效，请重新绑定");
    await renderAt("/");

    expect(await screen.findByText("GitHub 绑定已失效，请重新绑定后再加载账号仓库。")).toBeInTheDocument();
    expect(screen.getByText("仓库 2")).toBeInTheDocument();
    expect(screen.getAllByText("LiliaGithub").length).toBeGreaterThan(0);

    service.setFallbackGitHubReposErrorForTests(null);
    await fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await within(screen.getByLabelText("仓库状态列表")).findByText("sena-nana/LiliaGithub")).toBeInTheDocument();
    expect(screen.queryByText("GitHub 绑定已失效，请重新绑定后再加载账号仓库。")).toBeNull();
  });

  it("总览页语言列表可跳转到对应仓库，饼图仅展示占比", async () => {
    const { router } = await renderAt("/");

    expect(screen.queryByRole("link", { name: /TypeScript：50%/ })).toBeNull();
    const chart = await screen.findByLabelText("编程语言占比图");
    const pieSlice = chart.querySelector(".language-pie__slice");
    expect(pieSlice).toBeInTheDocument();
    await fireEvent.click(pieSlice as Element);
    expect(router.currentRoute.value.fullPath).toBe("/");

    const languageName = await screen.findByText("TypeScript", { selector: ".language-list__link .language-name" });
    const listLink = languageName.closest("a");
    expect(listLink).toBeInTheDocument();
    await fireEvent.click(listLink);

    await waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub");
    });
    expect((await screen.findAllByRole("heading", { level: 1, name: "LiliaGithub" })).length).toBeGreaterThanOrEqual(1);
  });

  it("首页本地提交贡献图支持空状态和错误重试", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackRepoContributionOverrideForTests(() => ({
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

    await renderAt("/");

    expect(await screen.findByText("暂无本地提交")).toBeInTheDocument();

    service.setFallbackRepoContributionOverrideForTests(() => {
      throw new Error("rate limited");
    });
    const refreshRepos = within(screen.getByLabelText("项目总览操作")).getByRole("button", { name: "刷新仓库" });
    await waitFor(() => {
      expect(refreshRepos).toBeEnabled();
    });
    await fireEvent.click(refreshRepos);

    expect(await screen.findByText("Error: rate limited")).toBeInTheDocument();

    service.setFallbackRepoContributionOverrideForTests((repoScope) => ({
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

    expect(await screen.findByLabelText("2026-06-11：4 次提交")).toBeInTheDocument();
  });

  it("首页本地提交贡献图命中仓库采样上限时显示提示", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackRepoContributionOverrideForTests(() => ({
      days: [{ date: "2026-06-11", count: 1 }],
      meta: {
        repoCount: 1,
        requestedRepoCount: 1,
        repoLimit: 30,
        truncated: true,
        skippedRepoCount: 0,
        refreshedAt: 1_780_000_000_000,
      },
    }));
    for (let index = 0; index < 31; index += 1) {
      await service.cloneRepo(`https://github.com/sena-nana/sample-${index}.git`);
    }

    await renderAt("/");

    expect(await screen.findByLabelText("2026-06-11：30 次提交")).toBeInTheDocument();
    expect(screen.queryByText(/仅统计前 30 个/)).toBeNull();
  });

  it("首页本地提交贡献图使用固定右侧窗口显示", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackRepoContributionOverrideForTests((repoScope) => ({
      days: Array.from({ length: 371 }, (_, index) => ({
        date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
        count: index === 370 && repoScope === "local:LiliaGithub" ? 4 : 0,
      })),
      meta: {
        repoCount: 1,
        requestedRepoCount: 1,
        repoLimit: 30,
        truncated: false,
        skippedRepoCount: 0,
        refreshedAt: 1_780_000_000_000,
      },
    }));

    await renderAt("/");
    const chart = await screen.findByLabelText("本地提交贡献图");

    expect(chart.querySelector(".contribution-window")).toBeInTheDocument();
    expect(chart.querySelector(".contribution-months")).toHaveTextContent("1月");
    expect(chart.querySelector(".contribution-scroll")).toBeNull();
    expect(await screen.findByLabelText("2026-01-06：4 次提交")).toBeInTheDocument();
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
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const service = await import("../src/services/workspace");
    const addFilesToGitignore = vi.spyOn(service, "addFilesToGitignore");
    const stageFiles = vi.spyOn(service, "stageFiles");
    const unstageFiles = vi.spyOn(service, "unstageFiles");
    const checkoutBranch = vi.spyOn(service, "checkoutBranch");
    await renderAt("/repos/LiliaGithub/changes");

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
    expect(screen.queryByText("C:\\Files\\workspace\\LiliaGithub")).toBeNull();
    expect(screen.queryByLabelText("仓库状态条")).toBeNull();
    expect(screen.queryByText("仓库健康")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Git 信息" })).toBeNull();
    expect(screen.getByRole("tablist", { name: "仓库页面" })).toBeInTheDocument();
    expect(screen.queryByLabelText("快速启动")).toBeNull();
    expect(screen.queryByRole("button", { name: "启动配置" })).toBeNull();
    expect(screen.getByRole("tab", { name: "变更" })).toHaveClass("is-active");
    expect(screen.getByRole("button", { name: "推送" })).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("仓库操作"))
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"))
        .filter(Boolean),
    ).toEqual(["刷新", "文件夹", "拉取", "推送"]);
    expect(screen.getByText("src/pages/Home.vue")).toBeInTheDocument();
    expect(screen.getByLabelText("变更预览")).toBeInTheDocument();
    expect(screen.getByText("当前没有可展示的差异内容。")).toBeInTheDocument();
    expect(screen.getByLabelText("未暂存变更")).toBeInTheDocument();
    expect(screen.getByLabelText("已暂存变更")).toBeInTheDocument();
    expect(screen.getByLabelText("提交操作")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "暂存全部未暂存变更" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "取消暂存全部已暂存变更" })).toBeEnabled();
    expect(screen.getByPlaceholderText("提交说明")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交并推送" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "仅提交" })).toBeDisabled();
    expect(screen.queryByText("提交内容")).toBeNull();
    expect(screen.queryByText("1 个已暂存文件")).toBeNull();
    expect(screen.queryByText("提交后立即 push")).toBeNull();

    await fireEvent.click(screen.getByText("src/pages/Home.vue").closest("button")!);
    const diffPreview = await screen.findByLabelText("变更预览");
    expect(diffPreview).toBeInTheDocument();
    expect(diffPreview).toHaveTextContent("@@ -1 +1 @@");
    expect(diffPreview.querySelector(".diff-code__line.is-added")).toHaveTextContent("LiliaGithub");
    expect(diffPreview.querySelector(".diff-code__raw-line")).toBeNull();
    const diffWorkspace = diffPreview.closest(".repo-diff-workspace") as HTMLElement;
    Object.defineProperty(diffWorkspace, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, width: 1000 }),
    });
    const splitter = within(diffWorkspace).getByRole("separator");
    await fireEvent.pointerDown(splitter, { clientX: 380, pointerId: 1 });
    await fireEvent.pointerMove(window, { clientX: 500, pointerId: 1 });
    expect(diffWorkspace.style.getPropertyValue("--commit-detail-left")).toBe("50%");
    await fireEvent.pointerUp(window, { clientX: 500, pointerId: 1 });

    const diffToggle = within(diffPreview).getByRole("button", { name: "折叠 diff" });
    expect(diffToggle).toHaveAttribute("aria-pressed", "true");
    await fireEvent.click(diffToggle);
    expect(diffToggle).toHaveAttribute("aria-pressed", "false");
    expect(diffPreview.querySelector(".diff-code__raw-line")).toBeInTheDocument();
    await fireEvent.click(diffToggle);
    expect(diffToggle).toHaveAttribute("aria-pressed", "true");
    expect(diffPreview.querySelector(".diff-code__line.is-added")).toHaveTextContent("LiliaGithub");

    const unstagedGroup = screen.getByLabelText("未暂存变更");
    const untrackedRow = within(unstagedGroup).getByText("src-tauri/src/workspace.rs").closest("button")!;
    await fireEvent.contextMenu(untrackedRow);
    expect(await screen.findByRole("menuitem", { name: "暂存" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "放弃更改" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "添加到 gitignore" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "复制文件路径" })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("menuitem", { name: "添加到 gitignore" }));
    await waitFor(() =>
      expect(addFilesToGitignore).toHaveBeenCalledWith("LiliaGithub", ["src-tauri/src/workspace.rs"]),
    );

    await fireEvent.contextMenu(untrackedRow);
    await fireEvent.click(await screen.findByRole("menuitem", { name: "复制文件路径" }));
    expect(writeText).toHaveBeenCalledWith("src-tauri/src/workspace.rs");
    await waitFor(() => expect(screen.getByRole("button", { name: "暂存全部未暂存变更" })).toBeEnabled());

    await fireEvent.contextMenu(untrackedRow);
    expect(await screen.findByRole("menuitem", { name: "暂存" })).toBeEnabled();
    await fireEvent.click(await screen.findByRole("menuitem", { name: "暂存" }));
    await waitFor(() =>
      expect(stageFiles).toHaveBeenCalledWith("LiliaGithub", ["src-tauri/src/workspace.rs"]),
    );

    const stagedGroup = screen.getByLabelText("已暂存变更");
    const stagedRow = within(stagedGroup).getByText("src/pages/Home.vue").closest("button")!;
    await waitFor(() => expect(screen.getByRole("button", { name: "取消暂存全部已暂存变更" })).toBeEnabled());
    await fireEvent.contextMenu(stagedRow);
    expect(await screen.findByRole("menuitem", { name: "移出暂存" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "放弃更改" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "添加到 gitignore" })).toBeDisabled();
    await fireEvent.click(screen.getByRole("menuitem", { name: "移出暂存" }));
    await waitFor(() =>
      expect(unstageFiles).toHaveBeenCalledWith("LiliaGithub", ["src/pages/Home.vue"]),
    );

    await fireEvent.click(screen.getByRole("tab", { name: "历史" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "历史" })).toHaveClass("is-active");
    });
    expect(screen.getAllByText("搭建 LiliaGithub MVP").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("提交历史密集列表")).toBeInTheDocument();
    expect(screen.queryByText("提交历史")).toBeNull();
    expect(screen.queryByText("按时间倒序展示最近提交")).toBeNull();
    expect(screen.queryByLabelText("历史和分支树")).toBeNull();
    expect(screen.getAllByLabelText("提交图谱").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("1234567")).toBeNull();
    expect(screen.getAllByText("HEAD -> main").length).toBeGreaterThanOrEqual(1);

    const viewTabs = screen.getByRole("tablist", { name: "仓库页面" });
    expect(within(viewTabs).queryByRole("tab", { name: "分支" })).toBeNull();
    expect(screen.queryByRole("group", { name: "当前分支" })).toBeNull();
    await fireEvent.click(within(viewTabs).getByRole("button", { name: "main" }));
    const branchList = await within(viewTabs).findByRole("listbox", { name: "分支候选" });
    expect(branchList).toBeInTheDocument();
    expect(screen.getByText("当前分支")).toBeInTheDocument();
    expect(screen.getByText("本地分支")).toBeInTheDocument();
    expect(screen.getByText("远程分支")).toBeInTheDocument();
    await fireEvent.contextMenu(within(branchList).getByRole("button", { name: "main" }));
    expect(await screen.findByRole("menuitem", { name: "更新" })).toBeInTheDocument();
    expect(within(branchList).getAllByText("origin").length).toBeGreaterThan(0);
    await fireEvent.click(within(branchList).getByRole("button", { name: "feature/notice-update (origin)" }));
    await waitFor(() =>
      expect(checkoutBranch).toHaveBeenCalledWith("LiliaGithub", "origin/feature/notice-update"),
    );
  });

  it("本地仓库页的本地分支和远程分支右键菜单都提供删除入口", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackGitHubBranchesForTests({
      "sena-nana/LiliaGithub": [
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
          tipTimestamp: 1_784_998_000,
          checkedOutWorktreePaths: [],
        },
        {
          name: "feature/notice-update",
          remote: true,
          current: false,
          upstream: null,
          ahead: 0,
          behind: 0,
          protected: false,
          tipTimestamp: 1_784_200_000,
          checkedOutWorktreePaths: [],
        },
      ],
    });

    await renderAt("/repos/LiliaGithub");

    const viewTabs = await screen.findByRole("tablist", { name: "仓库页面" });
    const branchTrigger = await within(viewTabs).findByRole("button", { name: "main" });
    await waitFor(() => expect(branchTrigger).toBeEnabled());
    await fireEvent.click(branchTrigger);
    const branchList = await within(viewTabs).findByRole("listbox", { name: "分支候选" });

    await fireEvent.contextMenu(within(branchList).getByRole("button", { name: "dev" }));
    expect(await screen.findByRole("menuitem", { name: "删除" })).toBeInTheDocument();

    await fireEvent.contextMenu(within(branchList).getByRole("button", { name: "feature/notice-update (origin)" }));
    await fireEvent.click(await screen.findByRole("menuitem", { name: "删除" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "确认删除远程分支？再点一次" }));

    await waitFor(() => {
      expect(
        within(screen.getByRole("listbox", { name: "分支候选" })).queryByRole("button", {
          name: "feature/notice-update (origin)",
        }),
      ).toBeNull();
    });
    await expect(service.listGitHubBranches("sena-nana/LiliaGithub")).resolves.toEqual([
      expect.objectContaining({ name: "main" }),
      expect.objectContaining({ name: "dev" }),
    ]);
  });

  it("变更页文件列表支持多选后批量处理变更", async () => {
    const service = await import("../src/services/workspace");
    const stageFiles = vi.spyOn(service, "stageFiles");
    const unstageFiles = vi.spyOn(service, "unstageFiles");
    const addFilesToGitignore = vi.spyOn(service, "addFilesToGitignore");
    const discardFiles = vi.spyOn(service, "discardFiles");
    service.setFallbackRepoDetailOverrideForTests((repoId) => {
      if (repoId !== "LiliaGithub") return null;
      const summary = repoSummary("LiliaGithub", {
        stagedCount: 2,
        unstagedCount: 3,
        untrackedCount: 0,
      });
      return repoDetail(summary, {
        changes: [
          repoChange("src/staged-a.ts", {
            indexStatus: "M",
            worktreeStatus: " ",
            staged: true,
            unstaged: false,
            diff: "@@ -1 +1 @@\n-old\n+staged-a",
          }),
          repoChange("src/staged-b.ts", {
            indexStatus: "M",
            worktreeStatus: " ",
            staged: true,
            unstaged: false,
            diff: "@@ -1 +1 @@\n-old\n+staged-b",
          }),
          repoChange("src/alpha.ts", { indexStatus: "?", worktreeStatus: "?", untracked: true }),
          repoChange("src/beta.ts", { indexStatus: "?", worktreeStatus: "?", untracked: true }),
          repoChange("src/gamma.ts", { indexStatus: "?", worktreeStatus: "?", untracked: true }),
        ],
      });
    });

    await renderAt("/repos/LiliaGithub/changes");

    const unstagedGroup = await screen.findByLabelText("未暂存变更");
    const alphaRow = (await within(unstagedGroup).findByText("src/alpha.ts")).closest("button")!;
    const betaRow = within(unstagedGroup).getByText("src/beta.ts").closest("button")!;
    const gammaRow = within(unstagedGroup).getByText("src/gamma.ts").closest("button")!;
    const waitUnstagedReady = () =>
      waitFor(() => expect(screen.getByRole("button", { name: "暂存全部未暂存变更" })).toBeEnabled());
    const waitStagedReady = () =>
      waitFor(() => expect(screen.getByRole("button", { name: "取消暂存全部已暂存变更" })).toBeEnabled());
    const selectBetaGamma = async () => {
      await fireEvent.click(betaRow);
      await fireEvent.click(gammaRow, { ctrlKey: true });
    };
    const selectContextMenuItem = async (row: Element, name: string) => {
      await fireEvent.contextMenu(row);
      await fireEvent.click(await screen.findByRole("menuitem", { name }));
    };

    await fireEvent.click(alphaRow);
    expect(alphaRow).toHaveAttribute("aria-pressed", "true");
    expect(betaRow).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("变更预览")).toHaveTextContent("src/alpha.ts");

    await fireEvent.click(gammaRow, { ctrlKey: true });
    expect(alphaRow).toHaveAttribute("aria-pressed", "true");
    expect(gammaRow).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("变更预览")).toHaveTextContent("src/gamma.ts");

    await fireEvent.click(gammaRow, { ctrlKey: true });
    expect(alphaRow).toHaveAttribute("aria-pressed", "true");
    expect(gammaRow).toHaveAttribute("aria-pressed", "false");

    await fireEvent.click(betaRow, { ctrlKey: true });
    await fireEvent.click(gammaRow, { shiftKey: true });
    expect(alphaRow).toHaveAttribute("aria-pressed", "false");
    expect(betaRow).toHaveAttribute("aria-pressed", "true");
    expect(gammaRow).toHaveAttribute("aria-pressed", "true");

    await selectContextMenuItem(betaRow, "暂存");
    await waitFor(() =>
      expect(stageFiles).toHaveBeenCalledWith("LiliaGithub", ["src/beta.ts", "src/gamma.ts"]),
    );
    expect(betaRow).toHaveAttribute("aria-pressed", "false");
    expect(gammaRow).toHaveAttribute("aria-pressed", "false");
    await waitUnstagedReady();

    stageFiles.mockClear();
    await selectContextMenuItem(alphaRow, "暂存");
    await waitFor(() =>
      expect(stageFiles).toHaveBeenCalledWith("LiliaGithub", ["src/alpha.ts"]),
    );
    await waitUnstagedReady();

    await selectBetaGamma();
    await selectContextMenuItem(gammaRow, "添加到 gitignore");
    await waitFor(() =>
      expect(addFilesToGitignore).toHaveBeenCalledWith("LiliaGithub", ["src/beta.ts", "src/gamma.ts"]),
    );
    await waitUnstagedReady();

    await selectBetaGamma();
    await fireEvent.contextMenu(betaRow);
    await fireEvent.click(await screen.findByRole("menuitem", { name: "放弃更改" }));
    await fireEvent.click(await screen.findByRole("menuitem", { name: "确认放弃？再点一次" }));
    await waitFor(() =>
      expect(discardFiles).toHaveBeenCalledWith("LiliaGithub", ["src/beta.ts", "src/gamma.ts"]),
    );
    await waitUnstagedReady();

    await selectBetaGamma();
    await fireEvent.click(screen.getByRole("button", { name: "暂存全部未暂存变更" }));
    await waitFor(() =>
      expect(stageFiles).toHaveBeenCalledWith("LiliaGithub", ["src/beta.ts", "src/gamma.ts"]),
    );
    await waitStagedReady();

    const stagedGroup = screen.getByLabelText("已暂存变更");
    const stagedARow = within(stagedGroup).getByText("src/staged-a.ts").closest("button")!;
    const stagedBRow = within(stagedGroup).getByText("src/staged-b.ts").closest("button")!;

    await fireEvent.click(stagedARow);
    await fireEvent.click(stagedBRow, { metaKey: true });
    expect(stagedARow).toHaveAttribute("aria-pressed", "true");
    expect(stagedBRow).toHaveAttribute("aria-pressed", "true");

    await selectContextMenuItem(stagedBRow, "移出暂存");
    await waitFor(() =>
      expect(unstageFiles).toHaveBeenCalledWith("LiliaGithub", ["src/staged-a.ts", "src/staged-b.ts"]),
    );
    expect(stagedARow).toHaveAttribute("aria-pressed", "false");
    expect(stagedBRow).toHaveAttribute("aria-pressed", "false");
    await waitStagedReady();

    unstageFiles.mockClear();
    await fireEvent.click(stagedARow);
    await fireEvent.click(stagedBRow, { metaKey: true });
    await fireEvent.click(screen.getByRole("button", { name: "取消暂存全部已暂存变更" }));
    await waitFor(() =>
      expect(unstageFiles).toHaveBeenCalledWith("LiliaGithub", ["src/staged-a.ts", "src/staged-b.ts"]),
    );
  });

  it("仓库项目信息页显示 README、Issues、Actions 和 Settings", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackRepoReadmesForTests({
      LiliaGithub: [
        {
          repoId: "LiliaGithub",
          path: "README.md",
          images: {},
          format: "md",
          updatedAt: 1,
          content: [
            "# LiliaGithub",
            "",
            "[中文](./README.txt#local-doc) [开发指南](docs/guide.md)",
            "",
            "## 当前能力",
            "",
            "- 工作区 Git 仓库扫描",
          ].join("\n"),
        },
        {
          repoId: "LiliaGithub",
          path: "README.txt",
          images: {},
          format: "text",
          updatedAt: 2,
          content: "# local-doc\n\nLiliaGithub 本地仓库管理工具。",
        },
      ],
    });
    await renderAt("/repos/LiliaGithub");

    await fireEvent.click(await screen.findByRole("tab", { name: "README.md" }));
    expect((await screen.findAllByRole("heading", { level: 1, name: "LiliaGithub" })).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("tablist", { name: "项目信息视图" })).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "README.md" })).toHaveClass("is-active");
    expect(screen.getByRole("tab", { name: "README.txt" })).toBeInTheDocument();
    expect(await screen.findByLabelText("README 内容")).toHaveTextContent("工作区 Git 仓库扫描");
    await fireEvent.click(screen.getByRole("link", { name: "中文" }));
    expect(await screen.findByRole("toolbar", { name: "链接操作" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "README.txt" })).toHaveClass("is-active");
    });
    expect(await screen.findByLabelText("README 内容")).toHaveTextContent("LiliaGithub 本地仓库管理工具");

    await fireEvent.click(screen.getByRole("tab", { name: "README.md" }));
    await fireEvent.click(screen.getByRole("link", { name: "开发指南" }));
    expect(await screen.findByRole("toolbar", { name: "链接操作" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await waitFor(() => {
      expect(service.getFallbackOpenPathCallsForTests()).toEqual(["C:\\Files\\workspace\\LiliaGithub\\docs\\guide.md"]);
    });
    await fireEvent.click(screen.getByRole("tab", { name: "README.txt" }));
    expect(await screen.findByLabelText("README 内容")).toHaveTextContent("LiliaGithub 本地仓库管理工具");

    await fireEvent.click(screen.getByRole("tab", { name: "Issues" }));
    expect(await screen.findByRole("heading", { level: 3, name: "Issues" })).toBeInTheDocument();
    expect(await screen.findByText(/#12 补齐仓库管理入口/)).toBeInTheDocument();
    await fireEvent.click(screen.getAllByRole("button", { name: "关闭" }).at(-1) as HTMLElement);
    expect(await screen.findByRole("button", { name: "重开" })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("tab", { name: "Actions" }));
    expect(await screen.findByText("验证仓库详情页")).toBeInTheDocument();
    expect(screen.getByText(/CI · main · push/)).toBeInTheDocument();
    expect(screen.getByLabelText("Actions 通过")).toHaveAttribute("title", "Actions 通过");

    await fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(await screen.findByRole("heading", { level: 3, name: "仓库设置" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByDisplayValue("Local GitHub workspace manager")).toBeInTheDocument();
    });
    await fireEvent.update(screen.getByDisplayValue("Local GitHub workspace manager"), "Updated description");
    await fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Updated description")).toBeInTheDocument();
    });
  });

  it("仓库设置删除 GitHub 远端需要输入完整仓库名确认并保留本地仓库", async () => {
    const service = await import("../src/services/workspace");
    const { router } = await renderAt("/repos/LiliaGithub");

    await fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    expect(await screen.findByRole("heading", { level: 3, name: "仓库设置" })).toBeInTheDocument();

    const deleteRepoButton = await screen.findByRole("button", { name: "删除仓库" });
    await waitFor(() => expect(deleteRepoButton).toBeEnabled(), { timeout: 3000 });
    await fireEvent.click(deleteRepoButton);
    expect(await screen.findByRole("dialog", { name: "删除 GitHub 仓库" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认删除" })).toBeDisabled();

    await fireEvent.update(screen.getByPlaceholderText("sena-nana/LiliaGithub"), "sena-nana/Wrong");
    expect(screen.getByRole("button", { name: "确认删除" })).toBeDisabled();

    await fireEvent.update(screen.getByPlaceholderText("sena-nana/LiliaGithub"), "sena-nana/LiliaGithub");
    expect(screen.getByRole("button", { name: "确认删除" })).toBeEnabled();
    await fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "删除 GitHub 仓库" })).toBeNull();
      expect(screen.getByText("GitHub 远端仓库已删除，本地目录仍保留。")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
    await router.push("/");
    expect(await screen.findByRole("heading", { level: 1, name: "项目总览" })).toBeInTheDocument();
    const repoStatusList = await screen.findByLabelText("仓库状态列表");
    await waitFor(() => {
      expect(within(repoStatusList).queryByText("sena-nana/LiliaGithub")).toBeNull();
    });
    expect((await service.refreshRepos()).some((repo) => repo.id === "LiliaGithub")).toBe(true);
    expect((await service.listGitHubRepos()).items.some((repo) => repo.fullName === "sena-nana/LiliaGithub")).toBe(false);
  });

  it("删除 GitHub 远端后返回首页不会恢复旧的仓库状态快照", async () => {
    const { router } = await renderAt("/");

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
    await router.push("/");

    const refreshedRepoStatusList = await screen.findByLabelText("仓库状态列表");
    await waitFor(() => {
      expect(within(refreshedRepoStatusList).queryByText("sena-nana/LiliaGithub")).toBeNull();
    });
  });

  it("仓库设置删除本地仓库需要输入仓库 ID 确认并返回首页", async () => {
    const service = await import("../src/services/workspace");
    const { router } = await renderAt("/repos/LiliaGithub");

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

  it("未 clone 的远程详情页删除 GitHub 远端后移除侧边栏入口并跳回首页", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackGitHubRepoPagesForTests([
      {
        items: [
          githubRepoSummary("sena-nana/DeleteRemoteRepo", {
            description: "Ready to delete",
            updatedAt: "2026-06-14T08:00:00Z",
          }),
        ],
        nextPage: null,
      },
    ]);
    service.setFallbackGitHubRepoReadmesForTests({
      "sena-nana/DeleteRemoteRepo": {
        repoId: "github:sena-nana/DeleteRemoteRepo",
        path: "README.md",
        images: {},
        format: "md",
        updatedAt: null,
        content: "# DeleteRemoteRepo\n\n用于验证删除后移除侧边栏入口。",
      },
    });
    await service.rememberRemoteRepo({
      fullName: "sena-nana/DeleteRemoteRepo",
      name: "DeleteRemoteRepo",
      private: false,
      archived: false,
      defaultBranch: "main",
      htmlUrl: "https://github.com/sena-nana/DeleteRemoteRepo",
      cloneUrl: "https://github.com/sena-nana/DeleteRemoteRepo.git",
      openedAt: Date.now(),
    });
    const { router } = await renderAt("/");

    expect(await screen.findByText("远程仓库 1")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "打开 sena-nana/DeleteRemoteRepo" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("link", { name: "打开 sena-nana/DeleteRemoteRepo" }));

    await waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe("/repos/github%3Asena-nana%2FDeleteRemoteRepo");
    });
    expect(await screen.findByRole("heading", { level: 1, name: "DeleteRemoteRepo" })).toBeInTheDocument();
    await fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    const deleteRepoButton = await screen.findByRole("button", { name: "删除仓库" });
    await waitFor(() => expect(deleteRepoButton).toBeEnabled(), { timeout: 3000 });
    await fireEvent.click(deleteRepoButton);
    expect(await screen.findByRole("dialog", { name: "删除 GitHub 仓库" })).toBeInTheDocument();

    await fireEvent.update(screen.getByPlaceholderText("sena-nana/DeleteRemoteRepo"), "sena-nana/DeleteRemoteRepo");
    await fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "删除 GitHub 仓库" })).toBeNull();
      expect(screen.getByText("GitHub 远端仓库已删除，本地目录仍保留。")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe("/");
      expect(screen.queryByText("远程仓库 1")).toBeNull();
    });
    const latestSettings = await service.getWorkspaceSettings();
    expect(
      latestSettings.remoteRepoShortcuts.some((repo) =>
        repo.fullName.toLowerCase() === "sena-nana/deleteremoterepo",
      ),
    ).toBe(false);
    expect(screen.getByRole("heading", { level: 1, name: "项目总览" })).toBeInTheDocument();
  });

  it("未 clone 的远程详情页在现有分支选择器中展示并删除 GitHub 远程分支", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackGitHubRepoPagesForTests([
      {
        items: [
          githubRepoSummary("sena-nana/RemoteBranchMenu", {
            description: "Branch picker integration",
            updatedAt: "2026-06-15T08:00:00Z",
          }),
        ],
        nextPage: null,
      },
    ]);
    service.setFallbackGitHubBranchesForTests({
      "sena-nana/RemoteBranchMenu": [
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
          name: "feature/cleanup",
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
    await service.rememberRemoteRepo({
      fullName: "sena-nana/RemoteBranchMenu",
      name: "RemoteBranchMenu",
      private: false,
      archived: false,
      defaultBranch: "main",
      htmlUrl: "https://github.com/sena-nana/RemoteBranchMenu",
      cloneUrl: "https://github.com/sena-nana/RemoteBranchMenu.git",
      openedAt: Date.now(),
    });

    await renderAt("/repos/github%3Asena-nana%2FRemoteBranchMenu");

    const trigger = await screen.findByRole("button", { name: "main" });
    await fireEvent.click(trigger);
    expect(screen.getByText("默认")).toBeInTheDocument();

    const branchList = screen.getByRole("listbox", { name: "分支候选" });
    await fireEvent.contextMenu(within(branchList).getByRole("button", { name: "feature/cleanup" }));
    await fireEvent.click(await screen.findByRole("menuitem", { name: "删除" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "确认删除远程分支？再点一次" }));

    await waitFor(() => {
      expect(within(screen.getByRole("listbox", { name: "分支候选" })).queryByRole("button", { name: "feature/cleanup" })).toBeNull();
    });
    await expect(service.listGitHubBranches("sena-nana/RemoteBranchMenu")).resolves.toEqual([
      expect.objectContaining({ name: "main" }),
    ]);
  });

  it("仓库项目信息页支持编辑 Issue（标题、正文、labels、assignees）", async () => {
    const service = await import("../src/services/workspace");
    const issueRow = () => {
      const row = document.querySelector(".project-row--issue[data-issue-number=\"12\"]");
      if (!row) throw new Error("未找到 Issue 行");
      return row as HTMLElement;
    };
    service.setFallbackGitHubIssuesForTests({
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
    await fireEvent.click(await screen.findByRole("tab", { name: "Issues" }));

    expect(await screen.findByText(/待编辑 Issue/, {}, { timeout: 5000 })).toBeInTheDocument();
    await fireEvent.click(within(issueRow()).getByRole("button", { name: "编辑" }));
    await fireEvent.update(within(issueRow()).getByPlaceholderText("Issue 标题"), "编辑后标题");
    await fireEvent.update(within(issueRow()).getByPlaceholderText("Issue 内容"), "新正文");
    await fireEvent.update(within(issueRow()).getByPlaceholderText("labels, comma separated"), "backend, docs");
    await fireEvent.update(within(issueRow()).getByPlaceholderText("assignees"), "carol, dana");
    await fireEvent.click(within(issueRow()).getByRole("button", { name: "保存" }));

    expect(await screen.findByText("#12 编辑后标题")).toBeInTheDocument();
    expect(screen.getByText("backend, docs · carol, dana")).toBeInTheDocument();

    await fireEvent.click(within(issueRow()).getByRole("button", { name: "编辑" }));
    expect(within(issueRow()).getByDisplayValue("新正文")).toBeInTheDocument();
  });

  it("仓库项目信息页无 GitHub 远端时保留 README 并显示远端空态", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackRepoReadmesForTests({
      LiliaGithub: [
        {
          repoId: "LiliaGithub",
          path: "README.md",
          images: {},
          format: "md",
          updatedAt: 1,
          content: "# LocalOnly\n\n本地 README。",
        },
        {
          repoId: "LiliaGithub",
          path: "README.txt",
          images: {},
          format: "text",
          updatedAt: 2,
          content: "本地纯文本 README。",
        },
      ],
    });
    service.setFallbackRepoOverridesForTests({
      LiliaGithub: repoSummary("LiliaGithub", { githubFullName: null, remoteUrl: null }),
    });
    await renderAt("/repos/LiliaGithub");

    await fireEvent.click(await screen.findByRole("tab", { name: "README.md" }));
    expect(await screen.findByRole("heading", { level: 1, name: "LocalOnly" })).toBeInTheDocument();
    expect(await screen.findByLabelText("README 内容")).toHaveTextContent("本地 README");
    await fireEvent.click(await screen.findByRole("tab", { name: "README.txt" }));
    expect(await screen.findByLabelText("README 内容")).toHaveTextContent("本地纯文本 README");

    await fireEvent.click(screen.getByRole("tab", { name: "Actions" }));
    expect(screen.getByText("当前仓库没有 GitHub 远端，Issues、Actions 和 Settings 不可用。")).toBeInTheDocument();
  });

  it("冲突仓库不再暴露旧冲突解决入口", async () => {
    await renderAt("/repos/Lilia");

    expect(await screen.findByRole("heading", { level: 1, name: "Lilia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "有冲突" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "推送" })).toBeNull();
    expect(screen.getByRole("tab", { name: "项目" })).toHaveClass("is-active");
    expect(screen.queryByRole("tab", { name: "冲突" })).toBeNull();
    expect(screen.queryByLabelText("冲突分段处理")).toBeNull();
    expect(screen.queryByRole("button", { name: "整文件采用 ours" })).toBeNull();
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
    expect(diffPanel.querySelector(".diff-code__token--type")).toHaveTextContent("template");
    expect(diffPanel.querySelector(".diff-code__line.is-added .diff-code__token--type")).toHaveTextContent("h1");

    await fireEvent.click(collapseToggle);

    expect(collapseToggle).toHaveAttribute("aria-pressed", "false");
    expect(diffPanel).toHaveTextContent("diff --git a/src/pages/Home.vue b/src/pages/Home.vue");
    expect(diffPanel.querySelector(".diff-code__raw-line.is-meta")).toHaveTextContent("diff --git");
    expect(diffPanel.querySelector(".diff-code__raw-line.is-added .diff-code__token--type")).toHaveTextContent("h1");

    await fireEvent.click(collapseToggle);

    await fireEvent.click(screen.getByRole("button", { name: /src-tauri\/src\/workspace.rs/ }));

    expect(screen.getByLabelText("改动文件 diff")).toHaveTextContent("@@ -10,4 +10,5 @@");
    expect(screen.getByLabelText("改动文件 diff")).toHaveTextContent("pub github_full_name: Option<String>,");
    expect(screen.getByLabelText("改动文件 diff").querySelector(".diff-code__token--keyword")).toHaveTextContent("pub");

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

    expect(await screen.findByRole("tab", { name: "历史" })).toHaveClass("is-active");
    expect(await screen.findByLabelText("提交历史密集列表")).toBeInTheDocument();
  });

  it("仓库详情页可配置、运行并查看命令运行终端", async () => {
    const { router } = await renderAt("/repos/LiliaGithub");

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "启动配置" })).toBeNull();
    expect(screen.queryByRole("button", { name: "刷新状态" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "命令运行" })).toBeNull();
    const viewTabs = screen.getByRole("tablist", { name: "仓库页面" });
    expect(within(viewTabs).queryByRole("tab", { name: "分支" })).toBeNull();
    expect(screen.queryByRole("group", { name: "当前分支" })).toBeNull();
    expect(within(viewTabs).getByRole("button", { name: "main" })).toBeInTheDocument();

    const launchGroup = screen.getByRole("group", { name: "命令执行" });
    expect(await within(launchGroup).findByRole("button", { name: /yarn tauri:dev/ })).toBeInTheDocument();
    await waitFor(() => {
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
    await fireEvent.click(within(launchGroup).getByRole("button", { name: /yarn tauri:dev/ }));
    expect(await within(launchGroup).findByRole("listbox", { name: "启动指令候选" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^preview/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^verify/ })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("option", { name: /^verify/ }));
    await waitFor(() => {
      expect(within(launchGroup).getByRole("button", { name: /yarn verify/ })).toBeInTheDocument();
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
  });

  it("运行失败信息显示在命令卡片内而不是页头状态区", async () => {
    const service = await import("../src/services/workspace");
    service.setFallbackStopLaunchOverrideForTests(() => {
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
      expect(within(launchCard).getByText("Error: 停止失败：operation attempted is not supported")).toBeInTheDocument();
    });
    expect(document.querySelector(".repo-workbench__status")).toBeNull();
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

  it("仓库详情页状态区出现或消失时保留项目主内容区", async () => {
    const service = await mockLiliaGithubSyncFailure();
    await renderAt("/");

    await clickOverviewSync();

    await waitFor(() => {
      expect(screen.getByLabelText("同步失败")).toHaveAttribute("title", "认证失败");
    });

    const failedLink = screen.getByLabelText("同步失败").closest("a");
    if (!(failedLink instanceof HTMLElement)) throw new Error("未找到同步失败仓库入口");
    await fireEvent.click(failedLink);

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();

    const status = document.querySelector(".repo-workbench__status");
    if (!(status instanceof HTMLElement)) throw new Error("未找到仓库状态区");
    expect(screen.getByLabelText("最近同步失败")).toHaveTextContent("认证失败");
    expect(screen.getByRole("tablist", { name: "仓库页面" })).toBeInTheDocument();

    service.setFallbackBulkExecuteOverrideForTests(null);
    await fireEvent.click(within(screen.getByLabelText("最近同步失败")).getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(screen.queryByLabelText("最近同步失败")).toBeNull();
    });
    expect(document.querySelector(".repo-workbench__status")).toBeNull();
    expect(screen.getByRole("tablist", { name: "仓库页面" })).toBeInTheDocument();
  });

  it("总览页可直接进入最近同步失败仓库继续处理", async () => {
    await mockLiliaGithubSyncFailure();
    const { router } = await renderAt("/");

    await clickOverviewSync();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "处理失败" })).toHaveAttribute("title", "认证失败");
    });

    await fireEvent.click(screen.getByRole("link", { name: "处理失败" }));

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
    expect(router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub");
    expect(screen.getByLabelText("最近同步失败")).toHaveTextContent("认证失败");
  });

  it("总览页冲突仓库入口进入变更页", async () => {
    const { router } = await renderAt("/");

    expect(await screen.findByRole("link", { name: "查看变更" })).toHaveAttribute("title", "1 个冲突待处理，冲突解决功能将重新设计");
    await fireEvent.click(screen.getByRole("link", { name: "查看变更" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Lilia" })).toBeInTheDocument();
    expect(router.currentRoute.value.fullPath).toBe("/repos/Lilia/changes");
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "变更" })).toHaveClass("is-active");
    });
  });

  it("总览页待同步按钮直接执行同步", async () => {
    const service = await import("../src/services/workspace");
    const initial = repoSummary("LiliaGithub", { ahead: 0, behind: 2 });
    service.setFallbackRepoOverridesForTests({
      LiliaGithub: initial,
    });
    await renderAt("/");

    await waitFor(() => {
      expect(screen.getByText("待同步")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "待同步" })).toHaveAttribute("title", "远端领先 2 个提交");
    });

    await fireEvent.click(screen.getByRole("button", { name: "待同步" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "待同步" })).toBeNull();
      expect(screen.getAllByText("已 clone").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole("heading", { level: 1, name: "项目总览" })).toBeInTheDocument();
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
    expect((await service.refreshRepos()).some((repo) => repo.id === "LiliaGithub")).toBe(true);
  });

  it("设置页仓库 tab 可重新绑定 GitHub", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined),
      },
    });
    await renderAt("/settings?tab=repositories");

    expect(await screen.findByText("lilia-user")).toBeInTheDocument();
    await fireEvent.click(await screen.findByRole("button", { name: "重新绑定 GitHub" }));

    expect(await screen.findByText("等待 GitHub 授权确认")).toBeInTheDocument();
    expect(await screen.findByText("授权码已复制，请在 GitHub 授权页粘贴。")).toBeInTheDocument();
    expect(screen.getByText("ABCD-1234")).toBeInTheDocument();
  });

  it("设置页仓库 tab 可新建 GitHub 仓库并克隆到工作区", async () => {
    const service = await import("../src/services/workspace");
    await renderAt("/settings?tab=repositories");

    await fireEvent.click(await screen.findByRole("button", { name: "新建 GitHub 仓库" }));
    expect(await screen.findByRole("dialog", { name: "新建 GitHub 仓库" })).toBeInTheDocument();
    await fireEvent.update(screen.getByPlaceholderText("new-repo"), "NewRepo");
    await fireEvent.update(screen.getByPlaceholderText("Node"), "Node");
    await fireEvent.click(screen.getByRole("button", { name: "创建" }));

    expect(await screen.findByText("lilia-user/NewRepo")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "克隆到工作区" }));

    await waitFor(async () => {
      expect((await service.refreshRepos()).some((repo) => repo.id === "NewRepo")).toBe(true);
    });
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

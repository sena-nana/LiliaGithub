import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.vue";
import { vContextMenu } from "../src/directives/contextMenu";
import { createLiliaGithubRouter } from "../src/router";
import type { GitHubIssue, GitHubRepoSummary, RepoConflictState } from "../src/services/workspace";
import { conflictState, repoSummary } from "./fixtures/workspace";

const TIMELINE_ISSUE_CACHE_KEY = "lilia-github.home.timelineIssues.v1";

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
  const main = document.querySelector("main");
  if (!(main instanceof HTMLElement)) throw new Error("未找到主内容区域");
  await screen.findByRole("heading", { level: 1, name: "项目总览" });
  await within(main).findByLabelText("仓库状态列表");
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

describe("基础路由", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("默认首页显示 Git 项目总览", async () => {
    await renderAt("/");

    expect(
      await screen.findByRole("heading", { level: 1, name: "项目总览" }),
    ).toBeInTheDocument();
    expect(screen.getByText("C:\\Files\\workspace")).toBeInTheDocument();
    expect(screen.queryByText("octo-user")).toBeNull();
    expect(screen.getByText("最近工作结果")).toBeInTheDocument();
    expect(await screen.findByLabelText("GitHub 提交贡献图")).toBeInTheDocument();
    expect(screen.getByText(/次提交，最近一年/)).toBeInTheDocument();
    expect(screen.queryByText(/刷新于/)).toBeNull();
    expect(screen.queryByText(/覆盖 \d+ 个仓库/)).toBeNull();
    expect(document.querySelector(".contribution-day[title$='次提交']")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "变更量排行" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "编程语言占比" })).toBeInTheDocument();
    expect(screen.getByLabelText("编程语言占比图")).toBeInTheDocument();
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
    expect(repoStatusList).not.toHaveTextContent("变更");
    expect(repoStatusList).not.toHaveTextContent("同步");
    expect(repoStatusList).not.toHaveTextContent("更新时间");
    expect(screen.getByRole("link", { name: "打开 sena-nana/LiliaGithub" })).toBeInTheDocument();
    expect(screen.getByLabelText("项目总览操作")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "一键同步" })).toHaveLength(1);
  });

  it("总览页仓库状态行可直接进入仓库详情", async () => {
    const { router } = await renderAt("/");

    await fireEvent.click(await screen.findByRole("link", { name: "打开 sena-nana/LiliaGithub" }));

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
    expect(router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub");
  });

  it("总览页未 clone 的 GitHub 项目点击 clone 后保持在总览页", async () => {
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
    const { router } = await renderAt("/");

    const repoStatusList = await screen.findByLabelText("仓库状态列表");
    await within(repoStatusList).findByText("sena-nana/NewRepo");
    expect(screen.queryByText("Not cloned yet")).toBeNull();
    const row = within(repoStatusList).getByText("sena-nana/NewRepo").closest(".repo-status-row");
    expect(row).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("私有")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByRole("button", { name: "clone" })).toBeInTheDocument();

    await fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "clone" }));

    await waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe("/");
      expect(within(row as HTMLElement).queryByRole("button", { name: "clone" })).toBeNull();
      expect(within(row as HTMLElement).getByText("已 clone")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { level: 1, name: "项目总览" })).toBeInTheDocument();
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
    expect(service.getFallbackGitHubIssueListCallsForTests()).toHaveLength(1);
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
    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
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
    const refreshRepos = within(screen.getByLabelText("项目总览操作")).getByRole("button", { name: "刷新仓库" });
    await waitFor(() => {
      expect(refreshRepos).toBeEnabled();
    });
    await fireEvent.click(refreshRepos);

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

    expect(await screen.findByLabelText("2026-06-11：1 次提交")).toBeInTheDocument();
    expect(screen.queryByText(/仅统计前 30 个/)).toBeNull();
  });

  it("首页 GitHub 贡献图使用固定右侧窗口显示", async () => {
    const service = await import("../src/services/workspace");
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

    await renderAt("/");
    const chart = await screen.findByLabelText("GitHub 提交贡献图");

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
    await renderAt("/repos/LiliaGithub");

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
    expect(screen.queryByText("C:\\Files\\workspace\\LiliaGithub")).toBeNull();
    expect(screen.queryByLabelText("仓库状态条")).toBeNull();
    expect(screen.queryByText("仓库健康")).toBeNull();
    expect(screen.getByRole("tab", { name: "Git 信息" })).toHaveClass("is-active");
    expect(screen.getByRole("tab", { name: "项目信息" })).toBeInTheDocument();
    expect(screen.queryByText("快速启动")).toBeNull();
    expect(screen.queryByRole("button", { name: "启动配置" })).toBeNull();
    expect(screen.getByRole("tab", { name: "变更" })).toHaveClass("is-active");
    expect(screen.getByRole("button", { name: "Push" })).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("仓库操作"))
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"))
        .filter(Boolean),
    ).toEqual(["刷新", "文件夹", "GitHub", "拉取"]);
    expect(screen.getByText("src/pages/Home.vue")).toBeInTheDocument();
    expect(screen.getByLabelText("变更预览")).toBeInTheDocument();
    expect(screen.getByText("当前没有可展示的差异内容。")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("提交说明")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();
    expect(screen.getByText("未选择文件")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("tab", { name: "项目信息" }));
    expect(await screen.findByLabelText("快速启动")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "运行" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "刷新状态" })).toBeNull();
    expect(screen.queryByRole("button", { name: "启动配置" })).toBeNull();
    expect(await screen.findByRole("button", { name: /yarn tauri:dev/ })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("tab", { name: "Git 信息" }));

    await fireEvent.click(screen.getByRole("button", { name: /src\/pages\/Home\.vue已暂存/ }));
    const diffPreview = await screen.findByLabelText("变更预览");
    expect(diffPreview).toBeInTheDocument();
    expect(diffPreview).toHaveTextContent("@@ -1 +1 @@");

    await fireEvent.click(screen.getByRole("tab", { name: "历史" }));
    expect(screen.getAllByText("搭建 LiliaGithub MVP").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("提交历史密集列表")).toBeInTheDocument();
    expect(screen.queryByText("提交历史")).toBeNull();
    expect(screen.queryByText("按时间倒序展示最近提交")).toBeNull();
    expect(screen.queryByLabelText("历史和分支树")).toBeNull();
    expect(screen.getAllByLabelText("提交图谱").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("1234567")).toBeNull();
    expect(screen.getAllByText("HEAD -> main").length).toBeGreaterThanOrEqual(1);

    await fireEvent.click(screen.getByRole("tab", { name: "分支" }));
    expect(screen.getByText("origin/main")).toBeInTheDocument();
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

    await fireEvent.click(await screen.findByRole("tab", { name: "项目信息" }));
    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
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

    await fireEvent.click(await screen.findByRole("tab", { name: "项目信息" }));
    expect(await screen.findByRole("heading", { level: 1, name: "LocalOnly" })).toBeInTheDocument();
    expect(await screen.findByLabelText("README 内容")).toHaveTextContent("本地 README");
    await fireEvent.click(await screen.findByRole("tab", { name: "README.txt" }));
    expect(await screen.findByLabelText("README 内容")).toHaveTextContent("本地纯文本 README");

    await fireEvent.click(screen.getByRole("tab", { name: "Actions" }));
    expect(screen.getByText("当前仓库没有 GitHub 远端，Issues、Actions 和 Settings 不可用。")).toBeInTheDocument();
  });

  it("冲突仓库默认进入冲突视图并支持分段处理入口", async () => {
    await renderAt("/repos/Lilia");

    expect(await screen.findByRole("heading", { level: 1, name: "Lilia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "处理冲突" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Push" })).toBeNull();
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

    expect(await screen.findByRole("heading", { level: 1, name: "LiliaGithub" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "启动配置" })).toBeNull();
    expect(screen.queryByRole("button", { name: "刷新状态" })).toBeNull();

    await fireEvent.click(await screen.findByRole("tab", { name: "项目信息" }));
    expect(await screen.findByLabelText("快速启动")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /yarn tauri:dev/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "刷新状态" })).toBeNull();
    expect(screen.queryByRole("button", { name: "启动配置" })).toBeNull();

    await fireEvent.click(screen.getByRole("tab", { name: "Git 信息" }));
    expect(screen.queryByLabelText("快速启动")).toBeNull();
    expect(screen.queryByRole("button", { name: "启动配置" })).toBeNull();

    await fireEvent.click(screen.getByRole("tab", { name: "项目信息" }));
    expect(await screen.findByLabelText("README 内容")).toBeInTheDocument();
    const readmeTab = screen.getByRole("tab", { name: "README.md" });
    const launchPanel = screen.getByLabelText("快速启动");
    const launchSidebarButton = within(launchPanel).getByRole("button", { name: /yarn tauri:dev/ });
    await fireEvent.click(screen.getByRole("button", { name: /yarn tauri:dev/ }));
    expect(await screen.findByLabelText("启动终端")).toBeInTheDocument();
    expect(screen.queryByLabelText("README 内容")).toBeNull();
    expect(readmeTab).not.toHaveClass("is-active");
    expect(launchPanel).not.toHaveClass("is-active");
    expect(launchSidebarButton).toHaveClass("is-active");
    const launchTerminal = screen.getByLabelText("启动终端");
    const launchCard = launchTerminal.closest(".project-terminal-card");
    if (!(launchCard instanceof HTMLElement)) throw new Error("未找到启动终端卡片");
    await fireEvent.click(within(launchCard).getByRole("button", { name: /yarn tauri:dev/ }));
    expect(await within(launchCard).findByRole("listbox", { name: "启动指令候选" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("option", { name: /^dev/ }));
    await waitFor(() => {
      expect(within(launchCard).getByRole("button", { name: /yarn dev/ })).toBeInTheDocument();
    });
    const idleTerminal = screen.getByLabelText("启动终端");
    expect(idleTerminal).toHaveTextContent("请选择一个启动指令并运行。");
    expect(idleTerminal).toHaveTextContent("当前指令：yarn dev");
    expect(idleTerminal).not.toHaveTextContent("启动命令：");

    await fireEvent.click(within(launchCard).getByRole("button", { name: "运行" }));

    await waitFor(() => {
      const terminal = screen.getByLabelText("启动终端");
      expect(terminal).toHaveTextContent("启动命令：yarn dev");
      expect(terminal).toHaveTextContent("开发服务已启动");
    });
    expect(within(launchCard).getByRole("button", { name: "停止" })).toBeEnabled();

    await fireEvent.click(within(launchCard).getByRole("button", { name: "停止" }));
    await waitFor(() => {
      expect(within(launchCard).getByRole("button", { name: "运行" })).toBeEnabled();
    });
    expect(screen.getByLabelText("启动终端")).toHaveTextContent("请选择一个启动指令并运行。");
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
    await fireEvent.click(await screen.findByRole("tab", { name: "项目信息" }));

    const status = document.querySelector(".repo-workbench__status");
    if (!(status instanceof HTMLElement)) throw new Error("未找到仓库状态区");
    expect(screen.getByLabelText("最近同步失败")).toHaveTextContent("认证失败");
    expect(screen.getByLabelText("快速启动")).toBeInTheDocument();

    service.setFallbackBulkExecuteOverrideForTests(null);
    await fireEvent.click(within(screen.getByLabelText("最近同步失败")).getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(screen.queryByLabelText("最近同步失败")).toBeNull();
    });
    expect(document.querySelector(".repo-workbench__status")).toBeNull();
    expect(screen.getByLabelText("快速启动")).toBeInTheDocument();
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

  it("总览页可直接进入冲突仓库的冲突处理视图", async () => {
    const { router } = await renderAt("/");

    expect(await screen.findByRole("link", { name: "处理冲突" })).toHaveAttribute("title", "1 个冲突待处理");
    await fireEvent.click(screen.getByRole("link", { name: "处理冲突" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Lilia" })).toBeInTheDocument();
    expect(router.currentRoute.value.fullPath).toBe("/repos/Lilia?tab=conflicts");
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "冲突" })).toHaveClass("is-active");
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

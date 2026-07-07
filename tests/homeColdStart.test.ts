import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { ContextMenuHost } from "@lilia/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace } from "../src/composables/useWorkspace";
import { resetWorkspaceStateForTests } from "../src/composables/workspace/state";
import { clearFrontendBackgroundTasksForTests, useBackgroundTasks } from "../src/composables/useBackgroundTasks";
import {
  clearGitHubRepoCache,
  resetWorkspaceFallbacksForTests,
  workspaceFallbackForTests,
  type GitHubAccountIssueItem,
  type GitHubActionNotification,
  type GitHubIssue,
  type GitHubPullRequest,
  type GitHubRepoSummary,
} from "../src/services/workspace";
import {
  HOME_GITHUB_OVERVIEW_SNAPSHOT_REFRESH_MS,
  clearHomeGitHubOverviewSnapshot,
} from "../src/pages/homeOverviewCache";
import Home from "../src/pages/Home.vue";
import { repoSummary } from "./fixtures/workspace";

const STORAGE_KEY = "lilia-github.home.overviewSnapshot.v1";
const SORT_STORAGE_KEY = "lilia-github.home.repoStatusSort.v1";
const repoFullName = "sena-nana/LiliaGithub";
const accountLogin = "lilia-user";

type WorkspaceFallbackForTests = Awaited<ReturnType<typeof workspaceFallbackForTests>>;

let workspaceFallback: WorkspaceFallbackForTests;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function githubRepoSummary(overrides: Partial<GitHubRepoSummary> = {}): GitHubRepoSummary {
  return {
    id: 1,
    name: "LiliaGithub",
    fullName: repoFullName,
    ownerLogin: "sena-nana",
    private: false,
    disabled: false,
    archived: false,
    description: null,
    defaultBranch: "main",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-25T08:00:00Z",
    cloneUrl: "https://github.com/sena-nana/LiliaGithub.git",
    htmlUrl: "https://github.com/sena-nana/LiliaGithub",
    ...overrides,
  };
}

function issue(number: number, title: string): GitHubIssue {
  return {
    number,
    title,
    state: "open",
    body: null,
    labels: [],
    assignees: [],
    author: "sena",
    htmlUrl: `https://github.com/${repoFullName}/issues/${number}`,
    updatedAt: "2026-06-25T12:00:00Z",
    createdAt: "2026-06-01T00:00:00Z",
  };
}

function pullRequest(number: number, title: string): GitHubPullRequest {
  return {
    number,
    title,
    state: "open",
    draft: false,
    body: null,
    labels: [],
    assignees: [],
    author: "sena",
    htmlUrl: `https://github.com/${repoFullName}/pull/${number}`,
    updatedAt: "2026-06-25T12:00:00Z",
    createdAt: "2026-06-01T00:00:00Z",
    baseBranch: "main",
    headBranch: `branch-${number}`,
    merged: false,
    mergeable: true,
    mergeableState: "clean",
  };
}

function accountIssueItem(number: number, title: string, pullRequest = false): GitHubAccountIssueItem {
  return {
    repoFullName,
    issue: issue(number, title),
    pullRequest,
  };
}

function actionNotification(id: string): GitHubActionNotification {
  return {
    id,
    repoFullName,
    title: "CI failed",
    subjectType: "WorkflowRun",
    subjectUrl: `https://api.github.com/repos/${repoFullName}/actions/runs/${id}`,
    latestCommentUrl: null,
    reason: "ci_activity",
    updatedAt: "2026-06-25T09:00:00Z",
    unread: true,
  };
}

function writeRepoOnlySnapshot(cachedAt = Date.now(), repos: GitHubRepoSummary[] = [githubRepoSummary()]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    schemaVersion: 3,
    accountLogin,
    cachedAt,
    repos,
    nextPage: null,
  }));
}

async function renderHomeFromStoredSnapshot(
  cachedAt = Date.now(),
  repos: GitHubRepoSummary[] = [githubRepoSummary()],
  withContextMenu = false,
) {
  const workspace = useWorkspace();
  await workspace.initialize();
  clearHomeGitHubOverviewSnapshot();
  writeRepoOnlySnapshot(cachedAt, repos);

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        component: Home,
      },
      {
        path: "/repos/:repoId(.*)",
        component: { template: "<div>repo</div>" },
      },
    ],
  });
  await router.push("/");
  await router.isReady();

  const component = withContextMenu
    ? {
        components: { ContextMenuHost, Home },
        template: "<Home /><ContextMenuHost />",
      }
    : Home;

  return {
    ...render(component, {
      global: {
        plugins: [router],
      },
    }),
    router,
  };
}

function repoStatusOrder() {
  return screen.getAllByRole("link")
    .map((element) => element.getAttribute("aria-label"))
    .filter((label): label is string => Boolean(label?.startsWith("打开 sena-nana/")))
    .map((label) => label.replace("打开 ", ""));
}

async function expectRepoStatusOrder(expected: string[]) {
  await screen.findByRole("link", { name: `打开 ${expected[0]!}` });
  await waitFor(() => expect(repoStatusOrder()).toEqual(expected));
}

async function expectPendingIssueNavigation(trigger: (row: HTMLElement) => Promise<void>, expectNoDialog = false) {
  const rendered = await renderHomeFromStoredSnapshot();
  const issueRow = await screen.findByRole("link", { name: /Issue #12 Navigate issue/ });
  await trigger(issueRow);
  await waitFor(() => {
    expect(rendered.router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub?projectTab=issues&issue=12");
  });
  if (expectNoDialog) expect(screen.queryByRole("dialog")).toBeNull();
  rendered.unmount();
}

beforeEach(async () => {
  vi.useRealTimers();
  await resetWorkspaceFallbacksForTests();
  workspaceFallback = await workspaceFallbackForTests();
  const localRepo = repoSummary("LiliaGithub", {
    githubFullName: repoFullName,
    ahead: 0,
    behind: 0,
    conflictCount: 0,
    lastCommitAt: null,
  });
  workspaceFallback.setFallbackRepoOverridesForTests({
    LiliaGithub: localRepo,
  });
  const settings = await workspaceFallback.getWorkspaceSettings();
  workspaceFallback.setFallbackStartupCacheForTests({
    workspaceRoot: settings.workspaceRoot,
    bindingLogin: settings.githubBinding?.login ?? null,
    reposById: {
      LiliaGithub: {
        summary: localRepo,
        cachedAt: Date.now(),
      },
    },
    contributions: null,
  });
  resetWorkspaceStateForTests();
  clearGitHubRepoCache();
  clearHomeGitHubOverviewSnapshot();
  localStorage.clear();
});

afterEach(() => {
  clearFrontendBackgroundTasksForTests();
});

describe("Home cold start pending items", () => {
  it("sorts repo status rows from a persisted local preference", async () => {
    const repos = [
      githubRepoSummary({
        id: 101,
        name: "Alpha",
        fullName: "sena-nana/Alpha",
        createdAt: "2026-01-10T00:00:00Z",
        updatedAt: "2026-06-10T00:00:00Z",
      }),
      githubRepoSummary({
        id: 102,
        name: "Beta",
        fullName: "sena-nana/Beta",
        createdAt: "2026-02-10T00:00:00Z",
        updatedAt: "2026-06-20T00:00:00Z",
      }),
      githubRepoSummary({
        id: 103,
        name: "Gamma",
        fullName: "sena-nana/Gamma",
        createdAt: "2026-03-10T00:00:00Z",
        updatedAt: "2026-06-01T00:00:00Z",
      }),
      githubRepoSummary({
        id: 104,
        name: "ZetaArchive",
        fullName: "sena-nana/ZetaArchive",
        archived: true,
        createdAt: "2026-04-10T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      }),
    ];

    const rendered = await renderHomeFromStoredSnapshot(Date.now(), repos, true);

    await expectRepoStatusOrder([
      "sena-nana/Beta",
      "sena-nana/Alpha",
      "sena-nana/Gamma",
      "sena-nana/ZetaArchive",
    ]);

    await fireEvent.click(screen.getByRole("button", { name: /仓库排序：最近更新 新到旧/ }));
    await fireEvent.click(await screen.findByRole("menuitem", { name: "首字母 A-Z" }));

    await expectRepoStatusOrder([
      "sena-nana/Alpha",
      "sena-nana/Beta",
      "sena-nana/Gamma",
      "sena-nana/ZetaArchive",
    ]);

    await fireEvent.click(screen.getByRole("button", { name: /仓库排序：首字母 A-Z/ }));
    await fireEvent.click(await screen.findByRole("menuitem", { name: "首字母 Z-A" }));

    await expectRepoStatusOrder([
      "sena-nana/Gamma",
      "sena-nana/Beta",
      "sena-nana/Alpha",
      "sena-nana/ZetaArchive",
    ]);
    expect(JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) ?? "{}")).toEqual({
      sort: "name",
      direction: "desc",
    });

    rendered.unmount();
    await renderHomeFromStoredSnapshot(Date.now(), repos, true);

    await expectRepoStatusOrder([
      "sena-nana/Gamma",
      "sena-nana/Beta",
      "sena-nana/Alpha",
      "sena-nana/ZetaArchive",
    ]);
  });

  it("keeps repo-only restored pending items in loading state until lazy details resolve", async () => {
    const accountIssues = deferred<GitHubAccountIssueItem[]>();
    const actionNotifications = deferred<GitHubActionNotification[]>();
    workspaceFallback.setFallbackGitHubAccountIssuesOverrideForTests(() => accountIssues.promise);
    workspaceFallback.setFallbackGitHubActionNotificationsOverrideForTests(() => actionNotifications.promise);

    await renderHomeFromStoredSnapshot();

    await waitFor(() => {
      expect(workspaceFallback.getFallbackGitHubAccountIssueListCallsForTests()).toHaveLength(1);
      expect(workspaceFallback.getFallbackGitHubActionNotificationListCallsForTests()).toHaveLength(1);
    });
    expect(screen.getByText("正在加载待处理事项...")).toBeInTheDocument();
    expect(screen.queryByText("暂无待处理事项")).toBeNull();

    accountIssues.resolve([
      accountIssueItem(12, "Fix cold start issue"),
      accountIssueItem(7, "Fix cold start PR", true),
    ]);
    actionNotifications.resolve([actionNotification("90")]);

    const issueRow = await screen.findByLabelText(/Issue #12 Fix cold start issue/);
    await fireEvent.focus(issueRow);
    const issueLink = within(issueRow).getByRole("link", { name: "打开 Issue #12" });

    const pullRow = await screen.findByLabelText(/PR #7 Fix cold start PR/);
    await fireEvent.focus(pullRow);
    const pullLink = within(pullRow).getByRole("link", { name: "打开 PR #7" });

    const actionRow = await screen.findByRole("link", { name: /Actions 报错 CI failed/ });
    await fireEvent.focus(actionRow);
    const actionLink = within(actionRow).getByRole("link", { name: "打开 Actions 报错" });

    expect(issueLink).toHaveAttribute("href", "/repos/LiliaGithub?projectTab=issues&issue=12");
    expect(pullLink).toHaveAttribute("href", "/repos/LiliaGithub?projectTab=pulls&pr=7");
    expect(actionLink).toHaveAttribute("href", "/repos/LiliaGithub?projectTab=actions&run=90");
  });

  it("opens pending item targets from the row and the jump button without confirmation", async () => {
    workspaceFallback.setFallbackGitHubAccountIssuesOverrideForTests(() => [
      accountIssueItem(12, "Navigate issue"),
    ]);
    workspaceFallback.setFallbackGitHubActionNotificationsOverrideForTests(() => []);

    await expectPendingIssueNavigation(async (row) => {
      await fireEvent.focus(row);
      await fireEvent.click(within(row).getByRole("link", { name: "打开 Issue #12" }));
    }, true);
    await expectPendingIssueNavigation((row) => fireEvent.click(row));
    await expectPendingIssueNavigation(async (row) => {
      await fireEvent.focus(row);
      await fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
    });
  });

  it("keeps restored repos and pending links when stale background repo refresh fails", async () => {
    workspaceFallback.setFallbackGitHubAccountIssuesOverrideForTests(() => [
      accountIssueItem(12, "Fix cold start issue"),
    ]);
    workspaceFallback.setFallbackGitHubActionNotificationsOverrideForTests(() => []);
    workspaceFallback.setFallbackGitHubReposErrorForTests("refresh unavailable");

    await renderHomeFromStoredSnapshot(Date.now() - HOME_GITHUB_OVERVIEW_SNAPSHOT_REFRESH_MS - 1);

    const issueRow = await screen.findByLabelText(/Issue #12 Fix cold start issue/);
    await fireEvent.focus(issueRow);

    expect(within(issueRow).getByRole("link", { name: "打开 Issue #12" })).toHaveAttribute(
      "href",
      "/repos/LiliaGithub?projectTab=issues&issue=12",
    );

    await waitFor(() => {
      expect(screen.getByText(/GitHub 仓库列表加载失败/)).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: `打开 ${repoFullName}` })).toBeInTheDocument();
    expect(screen.queryByText("暂无待处理事项")).toBeNull();
  });

  it("runs Issue pending quick actions and removes completed rows", async () => {
    const workspaceService = await import("../src/services/workspace");
    const pendingIssueUpdate = deferred<GitHubIssue>();
    workspaceFallback.setFallbackGitHubIssuesForTests({
      [repoFullName]: [
        issue(12, "Complete issue"),
        issue(13, "Close issue"),
      ],
    });
    workspaceFallback.setFallbackGitHubAccountIssuesOverrideForTests(() => [
      accountIssueItem(12, "Complete issue"),
      accountIssueItem(13, "Close issue"),
    ]);
    workspaceFallback.setFallbackGitHubActionNotificationsOverrideForTests(() => []);
    const updateGitHubIssueSpy = vi.spyOn(workspaceService, "updateGitHubIssue").mockImplementation((currentRepoFullName, issueNumber, request) => {
      if (issueNumber === 12) return pendingIssueUpdate.promise;
      return Promise.resolve({
        ...issue(issueNumber, issueNumber === 13 ? "Close issue" : "Issue"),
        state: request.state ?? "open",
        updatedAt: "2026-06-25T13:00:00Z",
        htmlUrl: `https://github.com/${currentRepoFullName}/issues/${issueNumber}`,
      });
    });
    const { tasks } = useBackgroundTasks();

    await renderHomeFromStoredSnapshot();

    const completeRow = await screen.findByLabelText(/Issue #12 Complete issue/);
    await fireEvent.focus(completeRow);
    await fireEvent.click(within(completeRow).getByRole("button", { name: "完成" }));
    expect(updateGitHubIssueSpy).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(updateGitHubIssueSpy).not.toHaveBeenCalled();

    await fireEvent.click(within(completeRow).getByRole("button", { name: "完成" }));
    expect(screen.getByRole("dialog", { name: "确认完成 Issue #12" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "确认完成" }));

    await waitFor(() => {
      expect(tasks.value).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "github",
          title: "完成 Issue",
          repoName: repoFullName,
          status: "running",
        }),
      ]));
    });
    await waitFor(() => {
      const runningRow = screen.getByLabelText(/Issue #12 Complete issue/);
      const completeButton = within(runningRow).getByRole("button", { name: "完成" });
      const closeButton = within(runningRow).getByRole("button", { name: "关闭" });
      expect(completeButton).toBeDisabled();
      expect(closeButton).toBeDisabled();
      expect(completeButton.querySelector(".sb-spin")).toBeInTheDocument();
      expect(closeButton.querySelector(".sb-spin")).toBeNull();
    });
    const otherRow = screen.getByLabelText(/Issue #13 Close issue/);
    expect(within(otherRow).getByRole("button", { name: "完成" })).toBeEnabled();
    expect(within(otherRow).getByRole("button", { name: "关闭" })).toBeEnabled();

    pendingIssueUpdate.resolve({
      ...issue(12, "Complete issue"),
      state: "closed",
      updatedAt: "2026-06-25T13:00:00Z",
    });
    await waitFor(() => expect(screen.queryByLabelText(/Issue #12 Complete issue/)).toBeNull());

    const closeRow = await screen.findByLabelText(/Issue #13 Close issue/);
    await fireEvent.focus(closeRow);
    await fireEvent.click(within(closeRow).getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("dialog", { name: "确认关闭 Issue #13" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "确认关闭" }));
    await waitFor(() => expect(screen.queryByLabelText(/Issue #13 Close issue/)).toBeNull());
  });

  it("runs pull request pending quick actions and removes handled rows", async () => {
    workspaceFallback.setFallbackGitHubPullRequestsForTests({
      [repoFullName]: [
        pullRequest(7, "Merge PR"),
        pullRequest(8, "Close PR"),
      ],
    });
    workspaceFallback.setFallbackGitHubAccountIssuesOverrideForTests(() => [
      accountIssueItem(7, "Merge PR", true),
      accountIssueItem(8, "Close PR", true),
    ]);
    workspaceFallback.setFallbackGitHubActionNotificationsOverrideForTests(() => []);

    await renderHomeFromStoredSnapshot();

    const mergeRow = await screen.findByLabelText(/PR #7 Merge PR/);
    await fireEvent.focus(mergeRow);
    await fireEvent.click(within(mergeRow).getByRole("button", { name: "合并" }));
    expect(screen.getByRole("dialog", { name: "确认合并 PR #7" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "确认合并" }));
    await waitFor(() => expect(screen.queryByLabelText(/PR #7 Merge PR/)).toBeNull());

    const closeRow = await screen.findByLabelText(/PR #8 Close PR/);
    await fireEvent.focus(closeRow);
    await fireEvent.click(within(closeRow).getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("dialog", { name: "确认关闭 PR #8" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "确认关闭" }));
    await waitFor(() => expect(screen.queryByLabelText(/PR #8 Close PR/)).toBeNull());
  });
});

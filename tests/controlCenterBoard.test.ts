import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ControlCenterBoard from "../src/components/control-center/ControlCenterBoard.vue";
import type { DiscoveryScanResult } from "../src/services/discovery/types";
import type { GitHubIssue } from "../src/services/workspace/types";
import { recordContinueContext } from "../src/services/controlCenter";
import { repoSummary } from "./fixtures/workspace";

const handoff = vi.hoisted(() => ({
  build: vi.fn(() => ({ id: "handoff-1" })),
  create: vi.fn(async () => ({ handoffId: "handoff-1", status: "pending", updatedAt: "2026-07-17T00:00:00Z" })),
  wait: vi.fn(async () => ({ handoffId: "handoff-1", status: "accepted", taskId: "task-1", resultRoute: "liliacode://tasks/task-1", updatedAt: "2026-07-17T00:00:01Z" })),
  open: vi.fn(async () => undefined),
  detail: vi.fn(),
  jobLog: vi.fn(),
}));

vi.mock("../src/services/liliaCodeHandoff", () => ({
  buildWorkflowFailureHandoff: handoff.build,
  createLiliaCodeTaskHandoff: handoff.create,
  openLiliaCodeTaskHandoffResult: handoff.open,
  waitForLiliaCodeTaskHandoff: handoff.wait,
}));
vi.mock("../src/services/workspace/client", () => ({
  getGitHubWorkflowRunDetail: handoff.detail,
  getGitHubWorkflowJobLog: handoff.jobLog,
}));

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("ControlCenterBoard", () => {
  it("renders explainable next actions and persists real disposition controls", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }],
    });
    await router.push("/");
    await router.isReady();
    const repo = repoSummary("repo", { githubFullName: "acme/repo", conflictCount: 1 });
    const scan = emptyScan();
    scan.assignedIssues.items = [{ repoFullName: "acme/repo", issue: issue(26) }];
    recordContinueContext({
      id: "pull_request:repo:26",
      kind: "pull_request",
      title: "Pull Request #26",
      detail: "acme/repo",
      route: "/repos/repo?projectTab=pulls&pr=26",
      repositoryId: "repo",
      branch: null,
      objectId: "26",
      updatedAt: 1,
    });
    render(ControlCenterBoard, {
      props: {
        repositories: [{ fullName: "acme/repo", localRepo: repo, remote: null }],
        localRepositories: [repo],
        scan,
        scope: "board-test",
      },
      global: { plugins: [router] },
    });

    const attention = screen.getByRole("region", { name: "Attention" });
    expect(attention).toHaveAttribute("data-agent-id", "control-center.attention");
    expect(document.querySelector('[data-agent-id="control-center.attention.local-repo-worktree.open"]')).toBeInTheDocument();
    expect(document.querySelector('[data-agent-id="control-center.today.github-acme-repo-issue-26.ignore"]')).toBeInTheDocument();
    expect(document.querySelector('[data-agent-id="control-center.continue.pull_request-repo-26.open"]')).toBeInTheDocument();
    expect(within(attention).getByText(/Git 冲突阻塞/)).toBeInTheDocument();
    expect(within(attention).getByRole("link", { name: "继续解决冲突" })).toHaveAttribute(
      "href",
      "/repos/repo/changes?resolveConflicts=1",
    );
    const today = screen.getByRole("region", { name: "Today" });
    await fireEvent.click(within(today).getByRole("button", { name: "忽略" }));
    expect(within(today).queryByText("Issue 26")).not.toBeInTheDocument();
    expect(screen.getByText("1 项已忽略、稍后处理或完成")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "恢复已隐藏项" }));
    expect(within(today).getByText("Issue 26")).toBeInTheDocument();
  });

  it("creates a workflow handoff from the local worktree and existing failure diagnosis", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }],
    });
    await router.push("/");
    await router.isReady();
    const repo = repoSummary("repo", {
      githubFullName: "acme/repo",
      path: "/workspace/repo",
      currentBranch: "fix/ci",
    });
    const scan = emptyScan();
    const run = {
      id: 91, name: "CI", displayTitle: "CI failed", status: "completed", conclusion: "failure",
      branch: "fix/ci", event: "push", htmlUrl: "https://github.com/acme/repo/actions/runs/91",
      createdAt: "2026-07-17T00:00:00Z", updatedAt: "2026-07-17T00:00:00Z",
    };
    scan.failedWorkflows.items = [{ repoFullName: "acme/repo", run }];
    handoff.detail.mockResolvedValue({
      run,
      jobs: [{
        id: 7, name: "test", status: "completed", conclusion: "failure", startedAt: null, completedAt: null,
        htmlUrl: null, runnerName: null,
        steps: [{ name: "Run tests", status: "completed", conclusion: "failure", number: 2, startedAt: null, completedAt: null }],
      }],
      artifacts: [],
      workflow: null,
    });
    handoff.jobLog.mockResolvedValue({
      jobId: 7,
      content: "setup\nerror: expected value was missing\nProcess completed with exit code 1",
    });
    render(ControlCenterBoard, {
      props: {
        repositories: [{ fullName: "acme/repo", localRepo: repo, remote: null }],
        localRepositories: [repo],
        scan,
        scope: "handoff-test",
      },
      global: { plugins: [router] },
    });

    handoff.create.mockRejectedValueOnce(new Error("LiliaCode unavailable"));
    await fireEvent.click(screen.getByRole("button", { name: "交给 LiliaCode" }));
    await waitFor(() => expect(screen.getByText(/任务草稿已保留，可重试/)).toBeInTheDocument());
    await fireEvent.click(screen.getByRole("button", { name: "重试交接" }));
    await waitFor(() => expect(screen.getByText("LiliaCode 已接收任务。")).toBeInTheDocument());
    const resultButton = screen.getByRole("button", { name: "在 LiliaCode 查看任务" });
    expect(resultButton).toHaveAttribute(
      "data-agent-id",
      "control-center.attention.github-acme-repo-workflow-91.handoff-result",
    );
    let finishOpen: (() => void) | null = null;
    handoff.open.mockImplementationOnce(() => new Promise<void>((resolve) => { finishOpen = resolve; }));
    await fireEvent.click(resultButton);
    await waitFor(() => expect(resultButton).toBeDisabled());
    finishOpen?.();
    await waitFor(() => expect(document.querySelector(
      '[data-agent-id="control-center.attention.github-acme-repo-workflow-91.handoff-result.status"]',
    )).toBeInTheDocument());
    handoff.open.mockRejectedValueOnce(new Error("LiliaCode task unavailable"));
    await fireEvent.click(resultButton);
    await waitFor(() => expect(document.querySelector(
      '[data-agent-id="control-center.attention.github-acme-repo-workflow-91.handoff-result.error"]',
    )).toBeInTheDocument());
    expect(handoff.build).toHaveBeenCalledWith(expect.objectContaining({
      repository: expect.objectContaining({ worktreePath: "/workspace/repo", branch: "fix/ci" }),
      run,
      logSummary: "test:\nsetup\nerror: expected value was missing\nProcess completed with exit code 1",
    }));
    expect(handoff.create).toHaveBeenCalledWith(expect.objectContaining({ id: "handoff-1" }));
    expect(handoff.build).toHaveBeenCalledTimes(1);
    expect(handoff.create).toHaveBeenCalledTimes(2);
    expect(handoff.wait).toHaveBeenCalledWith("handoff-1", { attempts: 8, intervalMs: 500 });
    expect(handoff.open).toHaveBeenCalledTimes(2);
    expect(handoff.open).toHaveBeenLastCalledWith("handoff-1");
  });
});

function issue(number: number): GitHubIssue {
  return {
    number, title: `Issue ${number}`, state: "open", body: null, labels: [], assignees: ["octocat"],
    htmlUrl: `https://github.com/acme/repo/issues/${number}`,
    createdAt: "2026-07-17T00:00:00Z", updatedAt: "2026-07-17T00:00:00Z",
  };
}

function emptyScan(): DiscoveryScanResult {
  const section = <T>() => ({
    items: [] as T[], failures: [], truncated: false, requestedRepositoryCount: 0, successfulRepositoryCount: 0,
  });
  return {
    pendingPullRequests: section(),
    assignedIssues: section(),
    failedWorkflows: section(),
    recentReleases: section(),
    repositoryStatuses: section(),
  };
}

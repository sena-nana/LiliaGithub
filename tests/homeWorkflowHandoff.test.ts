import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace } from "../src/composables/useWorkspace";
import { replaceRepos, resetWorkspaceStateForTests } from "../src/composables/workspace/state";
import {
  clearGitHubRepoCache,
  resetWorkspaceFallbacksForTests,
  workspaceFallbackForTests,
  type GitHubRepoSummary,
  type GitHubWorkflowJob,
  type GitHubWorkflowRun,
  type GitHubWorkflowRunDetail,
} from "../src/services/workspace";
import type { LiliaCodeTaskHandoffStatus } from "../src/services/liliaCodeHandoff";
import type { HomeAttentionResult } from "../src/services/homeAttention";
import { clearHomeGitHubOverviewSnapshot } from "../src/pages/homeOverviewCache";
import Home from "../src/pages/Home.vue";
import { findWorkflowFailureWorktree } from "../src/composables/useHomeWorkflowFailureHandoff";
import { repoSummary } from "./fixtures/workspace";

const workflowMocks = vi.hoisted(() => ({
  detail: vi.fn(),
  log: vi.fn(),
}));
const handoffMocks = vi.hoisted(() => ({
  create: vi.fn(),
  wait: vi.fn(),
  open: vi.fn(),
}));
const attentionMocks = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock("../src/services/workspace", async () => ({
  ...await vi.importActual<typeof import("../src/services/workspace")>("../src/services/workspace"),
  getGitHubWorkflowRunDetail: workflowMocks.detail,
  getGitHubWorkflowJobLog: workflowMocks.log,
}));

vi.mock("../src/services/liliaCodeHandoff", async () => ({
  ...await vi.importActual<typeof import("../src/services/liliaCodeHandoff")>("../src/services/liliaCodeHandoff"),
  createLiliaCodeTaskHandoff: handoffMocks.create,
  waitForLiliaCodeTaskHandoff: handoffMocks.wait,
  openLiliaCodeTaskHandoffResult: handoffMocks.open,
}));

vi.mock("../src/services/homeAttention", async () => ({
  ...await vi.importActual<typeof import("../src/services/homeAttention")>("../src/services/homeAttention"),
  listGitHubHomeAttention: attentionMocks.list,
}));

const repoFullName = "sena-nana/LiliaGithub";
const runId = 91;
const workflowAgentId = `home.pending.workflow-run:${repoFullName}:${runId}`;
const mainRepoId = "LiliaGithub";
const failureRepoId = "LiliaGithub-failure";
const failureBranch = "feature/workflow-fix";
const failureWorktreePath = "/work/LiliaGithub-workflow-fix";
const failureRoute = `/repos/${failureRepoId}?projectTab=actions&run=${runId}`;

beforeEach(async () => {
  await resetWorkspaceFallbacksForTests();
  resetWorkspaceStateForTests();
  clearGitHubRepoCache();
  clearHomeGitHubOverviewSnapshot();
  localStorage.clear();

  workflowMocks.detail.mockReset().mockResolvedValue(workflowDetail());
  workflowMocks.log.mockReset().mockImplementation(workflowJobLog);
  handoffMocks.create.mockReset().mockImplementation(async (handoff) => acceptedStatus(handoff.id));
  handoffMocks.wait.mockReset();
  handoffMocks.open.mockReset().mockResolvedValue(undefined);
  attentionMocks.list.mockReset().mockResolvedValue(attentionResult(workflowRun()));

  const fallback = await workspaceFallbackForTests();
  fallback.setFallbackGitHubRepoPagesForTests([{ items: [githubRepo()], nextPage: null }]);
  fallback.setFallbackGitHubAccountIssuesOverrideForTests(async () => []);
  fallback.setFallbackGitHubActionNotificationsOverrideForTests(async () => []);
  const mainRepo = repoSummary(mainRepoId, {
    name: "LiliaGithub",
    path: "/work/LiliaGithub",
    githubFullName: repoFullName,
    currentBranch: "main",
    remoteUrl: `https://github.com/${repoFullName}.git`,
    worktree: {
      role: "main",
      sharedRepoKey: "github:sena-nana/liliagithub",
      mainRepoId: mainRepoId,
    },
  });
  const failureRepo = repoSummary(failureRepoId, {
    name: "LiliaGithub",
    path: failureWorktreePath,
    githubFullName: repoFullName,
    currentBranch: failureBranch,
    remoteUrl: `https://github.com/${repoFullName}.git`,
    worktree: {
      role: "linked",
      sharedRepoKey: "github:sena-nana/liliagithub",
      mainRepoId: mainRepoId,
    },
  });
  const workspace = useWorkspace();
  await workspace.initialize();
  replaceRepos([mainRepo, failureRepo]);
});

describe("Home workflow failure handoff", () => {
  it("rejects remote-only, detached HEAD, and non-matching branch candidates", () => {
    const candidate = (id: string, path: string, currentBranch: string | null) => repoSummary(id, {
      name: "LiliaGithub",
      path,
      githubFullName: repoFullName,
      currentBranch,
      remoteUrl: `https://github.com/${repoFullName}.git`,
    });

    expect(findWorkflowFailureWorktree(
      [candidate("remote-only", "", failureBranch)],
      repoFullName,
      failureBranch,
    )).toBeNull();
    expect(findWorkflowFailureWorktree(
      [candidate("detached", "/work/detached", null)],
      repoFullName,
      failureBranch,
    )).toBeNull();
    expect(findWorkflowFailureWorktree(
      [candidate("other-branch", "/work/other", "main")],
      repoFullName,
      failureBranch,
    )).toBeNull();
    expect(findWorkflowFailureWorktree(
      [candidate("missing-run-branch", failureWorktreePath, failureBranch)],
      repoFullName,
      "",
    )).toBeNull();
  });

  it("collects failed diagnostics and hands the matching branch worktree to LiliaCode", async () => {
    const { container } = await renderHome();
    await screen.findByText("Actions 失败");

    const openLink = agentElement<HTMLAnchorElement>(container, `${workflowAgentId}.open`);
    expect(openLink).toHaveAttribute("href", failureRoute);

    await fireEvent.click(agentButton(container, `${workflowAgentId}.handoff.create`));

    await waitFor(() => expect(handoffMocks.create).toHaveBeenCalledTimes(1));
    expect(workflowMocks.detail).toHaveBeenCalledWith(repoFullName, runId);
    expect(workflowMocks.log.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [repoFullName, 911],
      [repoFullName, 912],
    ]);

    const payload = handoffMocks.create.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      kind: "workflowFailure",
      repository: {
        fullName: repoFullName,
        worktreePath: failureWorktreePath,
        branch: failureBranch,
        remoteUrl: `https://github.com/${repoFullName}.git`,
      },
      source: {
        application: "LiliaGithub",
        route: failureRoute,
        objectUrl: `https://github.com/${repoFullName}/actions/runs/${runId}`,
      },
      relatedFiles: [".github/workflows/ci.yml"],
      workflow: {
        runId,
        runUrl: `https://github.com/${repoFullName}/actions/runs/${runId}`,
        workflowName: "CI",
      },
    });
    expect(payload.logSummary).toContain("test");
    expect(payload.logSummary).toContain("assertion failed in workflow handoff");
    expect(payload.logSummary).toContain("lint");

    await fireEvent.click(agentButton(container, `${workflowAgentId}.handoff.open-result`));
    expect(handoffMocks.open).toHaveBeenCalledOnce();
    expect(handoffMocks.open).toHaveBeenCalledWith(payload.id);
  });

  it("keeps the draft id when an incompatible handoff is retried and then accepted", async () => {
    handoffMocks.create
      .mockImplementationOnce(async (handoff) => incompatibleStatus(handoff.id))
      .mockImplementationOnce(async (handoff) => acceptedStatus(handoff.id));
    const { container } = await renderHome();
    await screen.findByText("Actions 失败");

    await fireEvent.click(agentButton(container, `${workflowAgentId}.handoff.create`));
    await waitFor(() => expect(handoffMocks.create).toHaveBeenCalledTimes(1));
    expect(agentElement(container, `${workflowAgentId}.handoff.error`)).toBeVisible();

    await fireEvent.click(agentButton(container, `${workflowAgentId}.handoff.create`));
    await waitFor(() => expect(handoffMocks.create).toHaveBeenCalledTimes(2));

    const firstDraft = handoffMocks.create.mock.calls[0]?.[0];
    const retriedDraft = handoffMocks.create.mock.calls[1]?.[0];
    expect(retriedDraft.id).toBe(firstDraft.id);

    await waitFor(() => expect(
      container.querySelector(`[data-agent-id="${workflowAgentId}.handoff.open-result"]`),
    ).not.toBeNull());
    await fireEvent.click(agentButton(container, `${workflowAgentId}.handoff.open-result`));
    expect(handoffMocks.open).toHaveBeenCalledWith(firstDraft.id);
  });

  it("keeps successful diagnostics when one failed job log is unavailable", async () => {
    workflowMocks.log.mockImplementation(async (_repoFullName: string, jobId: number) => {
      if (jobId === 912) throw new Error("GitHub log unavailable");
      return {
        jobId,
        content: "Error: assertion failed in workflow handoff",
      };
    });
    const { container } = await renderHome();
    await screen.findByText("Actions 失败");

    await fireEvent.click(agentButton(container, `${workflowAgentId}.handoff.create`));

    await waitFor(() => expect(handoffMocks.create).toHaveBeenCalledTimes(1));
    const payload = handoffMocks.create.mock.calls[0]?.[0];
    expect(payload.logSummary).toContain("assertion failed in workflow handoff");
    expect(payload.logSummary).toContain("lint");
    expect(payload.logSummary).toContain("GitHub log unavailable");
  });

  it("only polls an existing pending handoff instead of creating it again", async () => {
    handoffMocks.create.mockImplementation(async (handoff) => pendingStatus(handoff.id));
    handoffMocks.wait.mockImplementation(async (handoffId) => pendingStatus(handoffId));
    const { container } = await renderHome();
    await screen.findByText("Actions 失败");

    await fireEvent.click(agentButton(container, `${workflowAgentId}.handoff.create`));
    await waitFor(() => expect(handoffMocks.wait).toHaveBeenCalledTimes(1));
    expect(handoffMocks.create).toHaveBeenCalledTimes(1);
    const handoffId = handoffMocks.create.mock.calls[0]?.[0].id;

    await fireEvent.click(agentButton(container, `${workflowAgentId}.handoff.create`));
    await waitFor(() => expect(handoffMocks.wait).toHaveBeenCalledTimes(2));
    expect(handoffMocks.create).toHaveBeenCalledTimes(1);
    expect(handoffMocks.wait.mock.calls.map((call) => call[0])).toEqual([handoffId, handoffId]);
  });

  it("does not create a handoff when every failed job log is unavailable", async () => {
    workflowMocks.log.mockRejectedValue(new Error("GitHub log unavailable"));
    const { container } = await renderHome();
    await screen.findByText("Actions 失败");

    await fireEvent.click(agentButton(container, `${workflowAgentId}.handoff.create`));

    await waitFor(() => expect(workflowMocks.log).toHaveBeenCalledTimes(2));
    expect(handoffMocks.create).not.toHaveBeenCalled();
    await waitFor(() => expect(
      container.querySelector(`[data-agent-id="${workflowAgentId}.handoff.error"]`),
    ).not.toBeNull());
    expect(agentElement(container, `${workflowAgentId}.handoff.error`)).toBeVisible();
    expect(agentButton(container, `${workflowAgentId}.handoff.create`)).toBeEnabled();
    expect(agentElement(container, `${workflowAgentId}.open`)).toHaveAttribute("href", failureRoute);

    workflowMocks.log.mockImplementation(workflowJobLog);
    await fireEvent.click(agentButton(container, `${workflowAgentId}.handoff.create`));
    await waitFor(() => expect(handoffMocks.create).toHaveBeenCalledTimes(1));
  });

  it("does not mix refreshed Workflow detail with a stale branch row", async () => {
    workflowMocks.detail.mockResolvedValue(workflowDetail({ branch: "updated-branch" }));
    const { container } = await renderHome();
    await screen.findByText("Actions 失败");

    await fireEvent.click(agentButton(container, `${workflowAgentId}.handoff.create`));

    await waitFor(() => expect(workflowMocks.detail).toHaveBeenCalledOnce());
    expect(handoffMocks.create).not.toHaveBeenCalled();
    await waitFor(() => expect(agentElement(container, `${workflowAgentId}.handoff.error`)).toBeVisible());
    expect(agentElement(container, `${workflowAgentId}.open`)).toHaveAttribute("href", failureRoute);
  });

  it("disables handoff without a local worktree on the failed branch and preserves the Actions link", async () => {
    attentionMocks.list.mockResolvedValue(attentionResult(workflowRun({ branch: "missing-branch" })));
    const { container } = await renderHome();
    await screen.findByText("Actions 失败");

    expect(agentButton(container, `${workflowAgentId}.handoff.create`)).toBeDisabled();
    expect(agentElement(container, `${workflowAgentId}.handoff.status`)).toBeVisible();
    expect(agentElement(container, `${workflowAgentId}.open`)).toHaveAttribute(
      "href",
      `/repos/${mainRepoId}?projectTab=actions&run=${runId}`,
    );
    expect(handoffMocks.create).not.toHaveBeenCalled();
  });
});

async function renderHome() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: Home },
      { path: "/repos/:repoId(.*)", component: { template: "<div>repo</div>" } },
    ],
  });
  await router.push("/");
  await router.isReady();
  return render(Home, { global: { plugins: [router] } });
}

function agentElement<T extends Element = HTMLElement>(container: HTMLElement, agentId: string) {
  const element = container.querySelector(`[data-agent-id="${agentId}"]`);
  if (!element) throw new Error(`未找到 Agent 元素：${agentId}`);
  return element as T;
}

function agentButton(container: HTMLElement, agentId: string) {
  const button = agentElement(container, agentId);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Agent 元素不是按钮：${agentId}`);
  return button;
}

function workflowRun(overrides: Partial<GitHubWorkflowRun> = {}): GitHubWorkflowRun {
  return {
    id: runId,
    name: "CI",
    displayTitle: "CI failed",
    status: "completed",
    conclusion: "failure",
    branch: failureBranch,
    event: "push",
    htmlUrl: `https://github.com/${repoFullName}/actions/runs/${runId}`,
    createdAt: "2026-07-18T12:00:00Z",
    updatedAt: "2026-07-18T12:05:00Z",
    runAttempt: 1,
    runNumber: 91,
    workflowId: 901,
    ...overrides,
  };
}

function workflowDetail(runOverrides: Partial<GitHubWorkflowRun> = {}): GitHubWorkflowRunDetail {
  return {
    run: workflowRun(runOverrides),
    jobs: [
      failedJob(911, "test", "Run tests"),
      failedJob(912, "lint", "Run lint"),
    ],
    artifacts: [],
    workflow: {
      id: 901,
      path: ".github/workflows/ci.yml",
      refName: failureBranch,
      content: "name: CI\njobs:\n  test:\n    runs-on: ubuntu-latest",
    },
  };
}

function failedJob(id: number, name: string, stepName: string): GitHubWorkflowJob {
  return {
    id,
    name,
    status: "completed",
    conclusion: "failure",
    startedAt: "2026-07-18T12:00:00Z",
    completedAt: "2026-07-18T12:05:00Z",
    htmlUrl: `https://github.com/${repoFullName}/actions/runs/${runId}/job/${id}`,
    runnerName: "GitHub Actions 1",
    steps: [{
      name: stepName,
      status: "completed",
      conclusion: "failure",
      number: 1,
      startedAt: "2026-07-18T12:00:00Z",
      completedAt: "2026-07-18T12:05:00Z",
    }],
  };
}

function githubRepo(): GitHubRepoSummary {
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
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-18T12:00:00Z",
    cloneUrl: `https://github.com/${repoFullName}.git`,
    htmlUrl: `https://github.com/${repoFullName}`,
    permissions: { pull: true, push: true, admin: false },
  };
}

function attentionResult(run: GitHubWorkflowRun): HomeAttentionResult {
  const section = <T,>(items: T[]) => ({
    items,
    failures: [],
    truncated: false,
    requestedRepositoryCount: 1,
    successfulRepositoryCount: 1,
  });
  return {
    pendingPullRequests: section([]),
    workflowRuns: section([{ repoFullName, run }]),
  };
}

function acceptedStatus(handoffId: string): LiliaCodeTaskHandoffStatus {
  return {
    protocol: "lilia-code-task-handoff",
    version: 1,
    handoffId,
    status: "accepted",
    taskId: "task-workflow-91",
    projectId: "project-liliagithub",
    resultRoute: "/projects/project-liliagithub/tasks/task-workflow-91",
    updatedAt: "2026-07-18T12:10:00Z",
  };
}

async function workflowJobLog(_repoFullName: string, jobId: number) {
  return {
    jobId,
    content: jobId === 911
      ? "##[group]Run tests\nError: assertion failed in workflow handoff\n##[endgroup]"
      : "Error: lint failed",
  };
}

function incompatibleStatus(handoffId: string): LiliaCodeTaskHandoffStatus {
  return {
    protocol: "lilia-code-task-handoff",
    version: 1,
    handoffId,
    status: "incompatible",
    error: "LiliaCode does not support workflowFailure v1",
    updatedAt: "2026-07-18T12:10:00Z",
  };
}

function pendingStatus(handoffId: string): LiliaCodeTaskHandoffStatus {
  return {
    protocol: "lilia-code-task-handoff",
    version: 1,
    handoffId,
    status: "pending",
    updatedAt: "2026-07-18T12:10:00Z",
  };
}

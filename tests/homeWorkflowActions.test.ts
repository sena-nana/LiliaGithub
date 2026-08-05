import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceStore, workspaceStoreKey } from "../src/composables/workspace/store";
import {
  createDefaultWorkspaceTransport,
  createWorkspaceClient,
} from "../src/services/workspace/client";
import { createSessionContext, sessionContextKey } from "../src/composables/sessionContext";
import {
  resetWorkspaceFallbacksForTests,
  workspaceFallbackForTests,
  type GitHubRepoSummary,
  type GitHubWorkflowRun,
} from "../src/services/workspace";
import type { HomeAttentionResult } from "../src/services/homeAttention";
import Home from "../src/pages/Home.vue";

const actionMocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  rerun: vi.fn(),
}));
const attentionMocks = vi.hoisted(() => ({
  list: vi.fn(),
}));

const repoFullName = "sena-nana/LiliaGithub";
const sessionContext = createSessionContext();
const workspaceClient = createWorkspaceClient(createDefaultWorkspaceTransport());
workspaceClient.listGitHubHomeAttention = (...args) => attentionMocks.list(...args);
workspaceClient.cancelGitHubWorkflowRun = (...args) => actionMocks.cancel(...args);
workspaceClient.rerunFailedGitHubWorkflowRun = (...args) => actionMocks.rerun(...args);
const workspace = createWorkspaceStore({ client: workspaceClient, sessionContext });

beforeEach(async () => {
  await resetWorkspaceFallbacksForTests();
  workspace.stateFeature.resetWorkspaceStateForTests();
  workspace.resetRepositoryRuntimeForTests();
  workspace.resetRepoRefreshRuntimeForTests();
  workspace.clearGitHubRepoCache();
  localStorage.clear();
  actionMocks.cancel.mockReset().mockResolvedValue(undefined);
  actionMocks.rerun.mockReset().mockResolvedValue(undefined);
  attentionMocks.list.mockReset().mockResolvedValue(attentionResult([
    workflowRun(91, "completed", "failure"),
    workflowRun(92, "in_progress", null),
  ]));

  const fallback = await workspaceFallbackForTests();
  fallback.setFallbackGitHubRepoPagesForTests([{
    items: [githubRepo()],
    nextPage: null,
  }]);
  fallback.setFallbackGitHubAccountIssuesOverrideForTests(async () => []);
  fallback.setFallbackGitHubActionNotificationsOverrideForTests(async () => []);
  await workspace.initialize();
});

describe("Home workflow actions", () => {
  it("confirms and runs the action that matches the real workflow state", async () => {
    const { container } = await renderHome();
    await screen.findByText("Actions 失败");
    await screen.findByText("Actions 运行中");

    const rerunId = `home.pending.workflow-run:${repoFullName}:91.workflow-rerun`;
    const cancelId = `home.pending.workflow-run:${repoFullName}:92.workflow-cancel`;
    expect(agentButton(container, rerunId)).toHaveAccessibleName("重跑");
    expect(agentButton(container, cancelId)).toHaveAccessibleName("取消");

    await fireEvent.click(agentButton(container, rerunId));
    await fireEvent.click(agentButton(container, `${rerunId}.confirm`));

    await waitFor(() => expect(actionMocks.rerun).toHaveBeenCalledWith(repoFullName, 91));
    await waitFor(() => expect(attentionMocks.list.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("keeps cancellation failures visible, refreshes attention, and allows retry", async () => {
    actionMocks.cancel.mockRejectedValue(new Error("HTTP 409 Conflict"));
    const { container } = await renderHome();
    await screen.findByText("Actions 运行中");

    const cancelId = `home.pending.workflow-run:${repoFullName}:92.workflow-cancel`;
    await fireEvent.click(agentButton(container, cancelId));
    await fireEvent.click(agentButton(container, `${cancelId}.confirm`));

    expect(await screen.findByRole("alert")).toHaveTextContent("状态可能已经改变");
    expect(actionMocks.cancel).toHaveBeenCalledTimes(1);
    expect(actionMocks.cancel).toHaveBeenCalledWith(repoFullName, 92);
    await waitFor(() => expect(attentionMocks.list.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(agentButton(container, cancelId)).toBeEnabled();
  });

  it("hides write actions for explicitly read-only workflow rows", async () => {
    const fallback = await workspaceFallbackForTests();
    fallback.setFallbackGitHubRepoPagesForTests([{
      items: [githubRepo({ permissions: { pull: true, push: false, admin: false } })],
      nextPage: null,
    }]);
    workspace.clearGitHubRepoCache();

    const { container } = await renderHome();
    await screen.findByText("Actions 失败");

    expect(container.querySelector('[data-agent-id$="workflow-rerun"]')).toBeNull();
    expect(container.querySelector('[data-agent-id$="workflow-cancel"]')).toBeNull();
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
  return render(Home, {
    global: {
      plugins: [router],
      provide: {
        [workspaceStoreKey as symbol]: workspace,
        [sessionContextKey as symbol]: sessionContext,
      },
    },
  });
}

function agentButton(container: HTMLElement, agentId: string) {
  const button = container.querySelector(`[data-agent-id="${agentId}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`未找到快捷操作：${agentId}`);
  return button;
}

function attentionResult(runs: GitHubWorkflowRun[]): HomeAttentionResult {
  const section = <T,>(items: T[]) => ({
    items,
    failures: [],
    truncated: false,
    requestedRepositoryCount: 1,
    successfulRepositoryCount: 1,
  });
  return {
    pendingPullRequests: section([]),
    workflowRuns: section(runs.map((run) => ({ repoFullName, run }))),
  };
}

function githubRepo(overrides: Partial<GitHubRepoSummary> = {}): GitHubRepoSummary {
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
    ...overrides,
  };
}

function workflowRun(id: number, status: string, conclusion: string | null): GitHubWorkflowRun {
  return {
    id,
    name: "CI",
    displayTitle: `CI #${id}`,
    status,
    conclusion,
    branch: "main",
    event: "push",
    htmlUrl: `https://github.com/${repoFullName}/actions/runs/${id}`,
    createdAt: "2026-07-18T12:00:00Z",
    updatedAt: "2026-07-18T12:05:00Z",
    runAttempt: 1,
  };
}

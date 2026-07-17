import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AssignedIssuesPanel from "../src/components/discovery/AssignedIssuesPanel.vue";
import FailedWorkflowsPanel from "../src/components/discovery/FailedWorkflowsPanel.vue";
import PendingPullRequestsPanel from "../src/components/discovery/PendingPullRequestsPanel.vue";
import RecentReleasesPanel from "../src/components/discovery/RecentReleasesPanel.vue";
import RepositoryStatusPanel from "../src/components/discovery/RepositoryStatusPanel.vue";

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(), review: vi.fn(), refresh: vi.fn(),
  mergePr: vi.fn(), updatePr: vi.fn(), updateIssue: vi.fn(), rerun: vi.fn(), mergePull: vi.fn(),
}));

vi.mock("../src/services/discovery", () => ({
  getGitHubDiscoveryRepositoryStatus: mocks.getStatus,
  submitGitHubDiscoveryPullRequestReview: mocks.review,
}));
vi.mock("../src/services/workspace/client", () => ({
  mergeGitHubPullRequest: mocks.mergePr,
  updateGitHubPullRequest: mocks.updatePr,
  updateGitHubIssue: mocks.updateIssue,
  rerunFailedGitHubWorkflowRun: mocks.rerun,
}));
vi.mock("../src/composables/useWorkspace", () => ({
  useWorkspace: () => ({ mergePull: mocks.mergePull }),
}));

const repository = { fullName: "lilia/app", remote: null, localRepo: null };
const emptyResult = { items: [], failures: [], truncated: false, requestedRepositoryCount: 1, successfulRepositoryCount: 1 };
const pullItem = { repoFullName: "lilia/app", reasons: ["review_requested"], pullRequest: { number: 22, title: "跨仓库", updatedAt: "2026-07-17T00:00:00Z" } };
const issueItem = { repoFullName: "lilia/app", issue: { number: 7, title: "修复同步", updatedAt: "2026-07-17T00:00:00Z" } };
const runItem = { repoFullName: "lilia/app", run: { id: 9, name: "CI", displayTitle: "CI", status: "completed", conclusion: "failure", createdAt: "2026-07-16T00:00:00Z", updatedAt: "2026-07-16T00:00:00Z", runAttempt: 1 } };

function renderPanel(component: object, result: object, props: Record<string, unknown> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }, { path: "/repos/:repoId(.*)", component: { template: "<div />" } }],
  });
  return render(component, {
    props: { result, loading: false, error: null, refresh: mocks.refresh, ...props },
    global: { plugins: [router] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const status = { fullName: "lilia/app", updatedAt: "2026-07-17T00:00:00Z", private: false, archived: false, disabled: false, permissions: { pull: true, push: true, admin: false }, allowMergeCommit: true, allowSquashMerge: false, allowRebaseMerge: false };
  mocks.getStatus.mockResolvedValue(status);
  mocks.refresh.mockResolvedValue(undefined);
});

describe("跨仓库面板动作", () => {
  it("提交审查、按仓库策略合并并关闭 Pull Request", async () => {
    renderPanel(PendingPullRequestsPanel, { ...emptyResult, items: [pullItem] });
    await fireEvent.click(await screen.findByRole("button", { name: "审查" }));
    await fireEvent.click(screen.getByRole("button", { name: "提交审查" }));
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith("lilia/app", 22, { event: "approve", body: undefined }));

    await fireEvent.click(screen.getByRole("button", { name: "合并" }));
    await fireEvent.click(await screen.findByRole("button", { name: "确认合并" }));
    await waitFor(() => expect(mocks.mergePr).toHaveBeenCalledWith("lilia/app", 22, { method: "merge" }));

    await fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await fireEvent.click(await screen.findByRole("button", { name: "确认关闭" }));
    await waitFor(() => expect(mocks.updatePr).toHaveBeenCalledWith("lilia/app", 22, { state: "closed" }));
  });

  it("用明确原因关闭 Issue，并重跑符合规则的失败 Workflow", async () => {
    renderPanel(AssignedIssuesPanel, { ...emptyResult, items: [issueItem] });
    await fireEvent.click(await screen.findByRole("button", { name: "完成" }));
    await fireEvent.click(screen.getByRole("button", { name: "确认完成" }));
    await waitFor(() => expect(mocks.updateIssue).toHaveBeenCalledWith("lilia/app", 7, { state: "closed", stateReason: "completed" }));
    await fireEvent.click(screen.getByRole("button", { name: "不做" }));
    await fireEvent.click(screen.getByRole("button", { name: "确认不做" }));
    await waitFor(() => expect(mocks.updateIssue).toHaveBeenCalledWith("lilia/app", 7, { state: "closed", stateReason: "not_planned" }));

    renderPanel(FailedWorkflowsPanel, { ...emptyResult, items: [runItem] });
    await fireEvent.click(await screen.findByRole("button", { name: "重跑失败任务" }));
    await waitFor(() => expect(mocks.rerun).toHaveBeenCalledWith("lilia/app", 9));
  });

  it("Release 只提供详情跳转，常用本地仓库通过 stash-safe 流程同步", async () => {
    renderPanel(RecentReleasesPanel, { ...emptyResult, items: [{ repoFullName: "lilia/app", release: { id: 2, name: "v2", tagName: "v2", prerelease: true, publishedAt: "2026-07-16T00:00:00Z" } }] });
    const release = await screen.findByRole("link", { name: "v2" });
    expect(release).toHaveAttribute("href", expect.stringContaining("projectTab=release"));

    const status = { fullName: "lilia/app", updatedAt: "2026-07-17T00:00:00Z", private: false, archived: false, disabled: false, permissions: { pull: true, push: true, admin: false }, allowMergeCommit: true, allowSquashMerge: false, allowRebaseMerge: false };
    const statusResult = { ...emptyResult, items: [{ repoFullName: "lilia/app", status }] };
    renderPanel(RepositoryStatusPanel, statusResult, { repositories: [{ ...repository, localRepo: { id: "local-app", stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictCount: 0, ahead: 0, behind: 1 } }] });
    await fireEvent.click(await screen.findByRole("button", { name: "同步" }));
    await waitFor(() => expect(mocks.mergePull).toHaveBeenCalledWith("local-app", "stash"));

    renderPanel(RepositoryStatusPanel, statusResult, { repositories: [{ ...repository, localRepo: { id: "conflicted-app", stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictCount: 1, ahead: 0, behind: 1 } }] });
    const conflictLinks = await screen.findAllByRole("link", { name: "处理冲突" });
    expect(conflictLinks.at(-1)).toHaveAttribute("href", expect.stringContaining("resolveConflicts=1"));
  });
});

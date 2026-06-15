import { fireEvent, render, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepoProjectPanel from "../src/components/repo/RepoProjectPanel.vue";
import { updateGitHubRepoSettings } from "../src/services/workspace/client";
import type {
  GitHubRepoManagement,
  ProjectLaunchCandidate,
  ProjectLaunchConfig,
} from "../src/services/workspace/types";

const githubSettings: GitHubRepoManagement = {
  fullName: "sena-nana/remote-repo",
  name: "remote-repo",
  description: null,
  homepage: null,
  private: false,
  defaultBranch: "main",
  hasIssues: true,
  hasWiki: false,
  hasProjects: true,
  hasDiscussions: false,
  allowMergeCommit: true,
  allowSquashMerge: true,
  allowRebaseMerge: true,
  allowAutoMerge: false,
  deleteBranchOnMerge: false,
  allowForking: true,
  webCommitSignoffRequired: false,
  htmlUrl: "https://github.com/sena-nana/remote-repo",
};

vi.mock("../src/services/workspace/client", () => ({
  createGitHubIssue: vi.fn(),
  deleteGitHubRepo: vi.fn(),
  getGitHubRepoManagement: vi.fn(async () => githubSettings),
  listGitHubIssues: vi.fn(async () => []),
  listGitHubRepoReadmes: vi.fn(async () => []),
  listGitHubWorkflowRuns: vi.fn(async () => []),
  listRepoReadmes: vi.fn(async () => []),
  openPath: vi.fn(),
  openUrl: vi.fn(),
  updateGitHubIssue: vi.fn(),
  updateGitHubRepoSettings: vi.fn(async () => githubSettings),
}));

const launchConfig: ProjectLaunchConfig = {
  command: "yarn dev",
  cwd: null,
  source: "inferred",
  updatedAt: null,
};

const launchCandidates: ProjectLaunchCandidate[] = [
  {
    command: "yarn dev",
    label: "Vite dev",
    hint: "package.json",
    kind: "package",
    cwd: null,
  },
];

async function renderProjectPanel(props: Partial<InstanceType<typeof RepoProjectPanel>["$props"]> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/repos/:repoId(.*)", component: { template: "<div />" } }],
  });
  await router.push("/repos/local-repo");
  await router.isReady();

  return render(RepoProjectPanel, {
    props: {
      repoId: "local-repo",
      repoFullName: null,
      repoPath: "C:\\Files\\workspace\\local-repo",
      loading: false,
      launchConfig,
      launchStatus: null,
      launchCandidates,
      launchLogs: [],
      launchTerminalVisible: false,
      actionRunning: false,
      launchRunning: false,
      remoteOnly: false,
      projectTab: "readme",
      projectIssueNumber: null,
      projectRunId: null,
      ...props,
    },
    global: {
      plugins: [router],
    },
  });
}

describe("RepoProjectPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("本地仓库保留快速启动入口和启动终端", async () => {
    const view = await renderProjectPanel();

    const quickLaunch = view.getByRole("region", { name: "快速启动" });
    await fireEvent.click(within(quickLaunch).getByRole("button", { name: "yarn dev" }));

    expect(view.emitted("openTerminal")).toHaveLength(1);

    await view.rerender({ launchTerminalVisible: true });

    const terminalCard = view.container.querySelector(".project-terminal-card");
    expect(terminalCard).toBeInstanceOf(HTMLElement);
    const terminal = view.getByLabelText("启动终端");
    expect(within(terminal).getByText("当前指令：yarn dev")).toBeInTheDocument();
    expect(within(terminalCard as HTMLElement).getByRole("button", { name: "yarn dev" })).toBeInTheDocument();
    expect(within(terminalCard as HTMLElement).getByRole("button", { name: "运行" })).toBeInTheDocument();
  });

  it("远程仓库只显示项目 tabs，不进入启动工作流", async () => {
    const view = await renderProjectPanel({
      repoId: "github:sena-nana/remote-repo",
      repoFullName: "sena-nana/remote-repo",
      repoPath: "",
      remoteOnly: true,
      launchTerminalVisible: true,
      projectTab: "settings",
    });

    expect(view.queryByRole("region", { name: "快速启动" })).toBeNull();
    expect(view.queryByLabelText("启动终端")).toBeNull();
    expect(view.queryByRole("button", { name: "yarn dev" })).toBeNull();
    expect(view.getByRole("tab", { name: "Issues" })).toBeInTheDocument();
    expect(view.getByRole("tab", { name: "Actions" })).toBeInTheDocument();
    expect(view.getByRole("tab", { name: "Settings" })).toBeInTheDocument();

    await waitFor(() => {
      expect(view.getByText("删除 GitHub 远端仓库")).toBeInTheDocument();
    });
    expect(view.queryByText("删除本地仓库")).toBeNull();
  });

  it("仓库设置分区展示并统一保存功能开关", async () => {
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });
    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));

    expect(await view.findByRole("heading", { level: 4, name: "基础设置" })).toBeInTheDocument();
    expect(view.getByRole("heading", { level: 4, name: "功能开关" })).toBeInTheDocument();
    expect(view.getByRole("heading", { level: 4, name: "Pull Request / Merge" })).toBeInTheDocument();
    expect(view.getByLabelText("本地危险操作")).toBeInTheDocument();
    expect(view.getByLabelText("远端危险操作")).toBeInTheDocument();
    expect(view.queryByText("默认分支")).toBeNull();

    const wikiSwitch = view.getByRole("checkbox", { name: /Wiki/ });
    await fireEvent.click(wikiSwitch);
    await fireEvent.click(view.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(updateGitHubRepoSettings).toHaveBeenCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ hasWiki: true }),
      );
    });
    expect(vi.mocked(updateGitHubRepoSettings).mock.calls[0][1]).not.toHaveProperty("defaultBranch");
  });
});

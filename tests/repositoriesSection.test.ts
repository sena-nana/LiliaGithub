import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepositoriesSection from "../src/pages/settings/RepositoriesSection.vue";
import { repoSummary, workspaceSettings } from "./fixtures/workspace";

const workspace = vi.hoisted(() => ({
  state: {
    settings: {
      workspaceRoot: "C:\\Files\\workspace",
      githubBinding: null,
      projectLaunchConfigs: {},
      hiddenRepoIds: [],
      managedRepoIds: [],
      systemGitRepoIds: ["LiliaGithub"],
      remoteRepoShortcuts: [],
      localContributionCache: {},
    },
    repos: [
      {
        id: "LiliaGithub",
        name: "LiliaGithub",
        path: "C:\\Files\\workspace\\LiliaGithub",
        relativePath: "LiliaGithub",
        currentBranch: "main",
        remoteUrl: "https://github.com/sena-nana/LiliaGithub.git",
        githubFullName: "sena-nana/LiliaGithub",
        ahead: 0,
        behind: 0,
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
        conflictCount: 0,
        lastCommitAt: null,
        lastCommitMessage: null,
        languageStats: [],
        workingTreeLanguageStats: [],
        languageStatsUpdatedAt: 0,
      },
    ],
    authLoading: false,
    authNotice: null,
    tasks: [],
  },
  githubBinding: { value: null },
  authBindingStatusText: { value: "尚未绑定 GitHub" },
  deviceFlow: { value: null },
  authRemainingText: { value: null },
  startAuthFlow: vi.fn(),
  listHiddenRepos: vi.fn(async () => []),
  unhideRepo: vi.fn(),
  addLocalRepo: vi.fn(),
  discoverRepos: vi.fn(),
  cloneRepo: vi.fn(),
  refreshRepos: vi.fn(),
  useDefaultTokenAuthForRepo: vi.fn(async (repoId: string) => {
    workspace.state.settings.systemGitRepoIds = workspace.state.settings.systemGitRepoIds.filter((id) => id !== repoId);
  }),
}));

vi.mock("../src/composables/useWorkspace", () => ({
  useWorkspace: () => workspace,
}));

vi.mock("../src/services/workspace", async () => {
  const actual = await vi.importActual<typeof import("../src/services/workspace")>("../src/services/workspace");
  return {
    ...actual,
    createGitHubRepo: vi.fn(),
    listGitHubRepoOwners: vi.fn(async () => []),
  };
});

describe("RepositoriesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspace.state.settings = {
      ...workspaceSettings(),
      systemGitRepoIds: ["LiliaGithub"],
    };
    workspace.state.repos = [repoSummary("LiliaGithub")];
    workspace.state.tasks = [];
    workspace.state.authLoading = false;
    workspace.state.authNotice = null;
    workspace.githubBinding.value = null;
    workspace.deviceFlow.value = null;
    workspace.listHiddenRepos.mockResolvedValue([]);
  });

  it("展示已切到系统 git 凭证的仓库并提供恢复默认 token 入口", async () => {
    render(RepositoriesSection);

    const panel = screen.getByRole("region", { name: "系统 git 凭证" });
    expect(within(panel).getByText("LiliaGithub", { selector: ".system-git-list__name" })).toBeInTheDocument();
    expect(within(panel).getByText("LiliaGithub", { selector: ".system-git-list__id" })).toBeInTheDocument();

    await fireEvent.click(within(panel).getByRole("button", { name: "恢复默认 token" }));

    await waitFor(() => {
      expect(workspace.useDefaultTokenAuthForRepo).toHaveBeenCalledWith("LiliaGithub");
    });
  });
});

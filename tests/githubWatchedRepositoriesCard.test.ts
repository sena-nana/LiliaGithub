import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GitHubWatchedRepositoriesCard from "../src/pages/settings/account/GitHubWatchedRepositoriesCard.vue";
import type { GitHubRepoSummary } from "../src/services/workspace";

const { workspace } = vi.hoisted(() => ({
  workspace: {
    githubBinding: null as unknown as { value: null | { login: string; avatarUrl: string | null; scopes: string[] } },
    listGitHubWatchedRepos: vi.fn(),
    updateGitHubRepositorySubscription: vi.fn(),
    openUrl: vi.fn(async () => undefined),
  },
}));

vi.mock("../src/composables/useWorkspace", async () => {
  const { ref } = await vi.importActual<typeof import("vue")>("vue");
  workspace.githubBinding = ref(null);
  return { useWorkspace: () => workspace };
});

function repo(id: number, fullName: string): GitHubRepoSummary {
  const [ownerLogin, name] = fullName.split("/");
  return {
    id,
    name,
    fullName,
    ownerLogin,
    private: false,
    disabled: false,
    archived: false,
    description: `${fullName} description`,
    defaultBranch: "main",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    cloneUrl: `https://github.com/${fullName}.git`,
    htmlUrl: `https://github.com/${fullName}`,
    owner: { login: ownerLogin, kind: "user", avatarUrl: null },
    permissions: { pull: true, push: true, admin: false },
  };
}

async function selectMode(rowAgentId: string, modeLabel: string) {
  const row = document.querySelector(`[data-agent-id="${rowAgentId}"]`);
  expect(row).not.toBeNull();
  await fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "关注仓库" }));
  await fireEvent.click(await screen.findByRole("option", { name: modeLabel }));
}

describe("GitHubWatchedRepositoriesCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspace.githubBinding.value = {
      login: "octocat",
      avatarUrl: null,
      scopes: ["repo", "notifications"],
    };
    workspace.listGitHubWatchedRepos.mockResolvedValue({ items: [repo(1, "octocat/alpha")], nextPage: null });
    workspace.updateGitHubRepositorySubscription.mockImplementation(async (_repoFullName, mode) => ({ mode }));
  });

  it("分页展示关注仓库，并在切换离开关注后移除对应行", async () => {
    workspace.listGitHubWatchedRepos
      .mockResolvedValueOnce({ items: [repo(1, "octocat/alpha")], nextPage: 2 })
      .mockResolvedValueOnce({ items: [repo(2, "octocat/beta")], nextPage: null });
    render(GitHubWatchedRepositoriesCard);

    const alphaButton = await screen.findByRole("button", { name: /octocat\/alpha/ });
    await fireEvent.click(alphaButton);
    expect(workspace.openUrl).toHaveBeenCalledWith("https://github.com/octocat/alpha");
    await fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByRole("button", { name: /octocat\/beta/ })).toBeInTheDocument();
    expect(workspace.listGitHubWatchedRepos).toHaveBeenNthCalledWith(2, 2);

    await selectMode("settings.account.notifications.row.octocat-alpha", "仅参与和提及");
    await waitFor(() => expect(workspace.updateGitHubRepositorySubscription).toHaveBeenCalledWith("octocat/alpha", "participating"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /octocat\/alpha/ })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /octocat\/beta/ })).toBeInTheDocument();
  });

  it("订阅更新失败时保留原仓库和关注状态", async () => {
    workspace.updateGitHubRepositorySubscription.mockRejectedValueOnce(new Error("network unavailable"));
    render(GitHubWatchedRepositoriesCard);
    await screen.findByRole("button", { name: /octocat\/alpha/ });

    await selectMode("settings.account.notifications.row.octocat-alpha", "忽略此仓库");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    const row = document.querySelector('[data-agent-id="settings.account.notifications.row.octocat-alpha"]') as HTMLElement;
    expect(within(row).getByRole("button", { name: /octocat\/alpha/ })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "关注仓库" })).toBeInTheDocument();
  });

  it("缺少通知授权时不请求列表、不显示假可用控件，并保留 GitHub 入口", async () => {
    workspace.githubBinding.value = { login: "octocat", avatarUrl: null, scopes: ["repo"] };
    render(GitHubWatchedRepositoriesCard);

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(workspace.listGitHubWatchedRepos).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "刷新" })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "在 GitHub 管理关注仓库" }));
    await fireEvent.click(screen.getByRole("button", { name: "通知设置" }));
    expect(workspace.openUrl).toHaveBeenNthCalledWith(1, "https://github.com/watching");
    expect(workspace.openUrl).toHaveBeenNthCalledWith(2, "https://github.com/settings/notifications");
  });

  it("权限错误降级为 GitHub 入口，普通错误允许重试", async () => {
    workspace.listGitHubWatchedRepos.mockRejectedValueOnce(new Error("github_forbidden：access denied"));
    const view = render(GitHubWatchedRepositoriesCard);

    await waitFor(() => expect(screen.getByText("当前账户无法在应用内管理仓库通知。")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "通知设置" })).toBeInTheDocument();

    view.unmount();
    workspace.listGitHubWatchedRepos
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ items: [repo(2, "octocat/recovered")], nextPage: null });
    render(GitHubWatchedRepositoriesCard);
    await screen.findByRole("alert");
    await fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("button", { name: /octocat\/recovered/ })).toBeInTheDocument();
  });

  it("GitHub 限流保留重试能力而不误判为权限不足", async () => {
    workspace.listGitHubWatchedRepos.mockRejectedValueOnce(
      new Error("github_rate_limited：API rate limit exceeded"),
    );
    render(GitHubWatchedRepositoriesCard);

    expect(await screen.findByRole("alert")).toHaveTextContent("请求暂时受限");
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "通知设置" })).toBeInTheDocument();
  });

  it("账号切换后忽略旧账号的延迟响应", async () => {
    let resolveOldRequest!: (value: { items: GitHubRepoSummary[]; nextPage: null }) => void;
    workspace.listGitHubWatchedRepos
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldRequest = resolve; }))
      .mockResolvedValueOnce({ items: [repo(2, "mona/new-repo")], nextPage: null });
    render(GitHubWatchedRepositoriesCard);
    await waitFor(() => expect(workspace.listGitHubWatchedRepos).toHaveBeenCalledTimes(1));

    workspace.githubBinding.value = { login: "mona", avatarUrl: null, scopes: ["repo", "notifications"] };
    expect(await screen.findByRole("button", { name: /mona\/new-repo/ })).toBeInTheDocument();
    resolveOldRequest({ items: [repo(1, "octocat/old-repo")], nextPage: null });

    await waitFor(() => expect(screen.queryByRole("button", { name: /octocat\/old-repo/ })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /mona\/new-repo/ })).toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GitHubWatchedRepositoriesCard from "../src/pages/settings/account/GitHubWatchedRepositoriesCard.vue";
import type { GitHubBinding, GitHubRepoSummary } from "../src/services/workspace";
import type { WorkspaceStore } from "../src/composables/workspace/store";
import {
  createWorkspaceStoreFixture,
  provideWorkspaceStoreFixture,
} from "./fixtures/createWorkspaceStoreFixture";

const listGitHubWatchedRepos = vi.fn();
const updateGitHubRepositorySubscription = vi.fn();
const openUrl = vi.fn(async () => undefined);
let workspace: WorkspaceStore;

function setBinding(binding: GitHubBinding | null) {
  workspace.stateFeature.state.bindingStatus = binding
    ? { state: "bound", binding }
    : { state: "unbound", binding: null };
}

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
    workspace = createWorkspaceStoreFixture({
      listGitHubWatchedRepos,
      updateGitHubRepositorySubscription,
      openUrl,
    });
    setBinding({
      login: "octocat",
      avatarUrl: null,
      scopes: ["repo", "notifications"],
      boundAt: "2026-07-15T00:00:00Z",
    });
    listGitHubWatchedRepos.mockResolvedValue({ items: [repo(1, "octocat/alpha")], nextPage: null });
    updateGitHubRepositorySubscription.mockImplementation(async (_repoFullName, mode) => ({ mode }));
  });

  it("分页展示关注仓库，并在切换离开关注后移除对应行", async () => {
    listGitHubWatchedRepos
      .mockResolvedValueOnce({ items: [repo(1, "octocat/alpha")], nextPage: 2 })
      .mockResolvedValueOnce({ items: [repo(2, "octocat/beta")], nextPage: null });
    render(GitHubWatchedRepositoriesCard, { global: { provide: provideWorkspaceStoreFixture(workspace) } });

    const alphaButton = await screen.findByRole("button", { name: /octocat\/alpha/ });
    await fireEvent.click(alphaButton);
    expect(openUrl).toHaveBeenCalledWith("https://github.com/octocat/alpha");
    await fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByRole("button", { name: /octocat\/beta/ })).toBeInTheDocument();
    expect(listGitHubWatchedRepos).toHaveBeenNthCalledWith(2, 2);

    await selectMode("settings.account.notifications.row.octocat-alpha", "仅参与和提及");
    await waitFor(() => expect(updateGitHubRepositorySubscription).toHaveBeenCalledWith("octocat/alpha", "participating"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /octocat\/alpha/ })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /octocat\/beta/ })).toBeInTheDocument();
  });

  it("订阅更新失败时保留原仓库和关注状态", async () => {
    updateGitHubRepositorySubscription.mockRejectedValueOnce(new Error("network unavailable"));
    render(GitHubWatchedRepositoriesCard, { global: { provide: provideWorkspaceStoreFixture(workspace) } });
    await screen.findByRole("button", { name: /octocat\/alpha/ });

    await selectMode("settings.account.notifications.row.octocat-alpha", "忽略此仓库");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    const row = document.querySelector('[data-agent-id="settings.account.notifications.row.octocat-alpha"]') as HTMLElement;
    expect(within(row).getByRole("button", { name: /octocat\/alpha/ })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "关注仓库" })).toBeInTheDocument();
  });

  it("缺少通知授权时不请求列表、不显示假可用控件，并保留 GitHub 入口", async () => {
    setBinding({ login: "octocat", avatarUrl: null, scopes: ["repo"], boundAt: "2026-07-15T00:00:00Z" });
    render(GitHubWatchedRepositoriesCard, { global: { provide: provideWorkspaceStoreFixture(workspace) } });

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(listGitHubWatchedRepos).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "刷新" })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "在 GitHub 管理关注仓库" }));
    await fireEvent.click(screen.getByRole("button", { name: "通知设置" }));
    expect(openUrl).toHaveBeenNthCalledWith(1, "https://github.com/watching");
    expect(openUrl).toHaveBeenNthCalledWith(2, "https://github.com/settings/notifications");
  });

  it("权限错误降级为 GitHub 入口，普通错误允许重试", async () => {
    listGitHubWatchedRepos.mockRejectedValueOnce(new Error("github_forbidden：access denied"));
    const view = render(GitHubWatchedRepositoriesCard, { global: { provide: provideWorkspaceStoreFixture(workspace) } });

    await waitFor(() => expect(screen.getByText("当前账户无法在应用内管理仓库通知。")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "通知设置" })).toBeInTheDocument();

    view.unmount();
    listGitHubWatchedRepos
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ items: [repo(2, "octocat/recovered")], nextPage: null });
    render(GitHubWatchedRepositoriesCard, { global: { provide: provideWorkspaceStoreFixture(workspace) } });
    await screen.findByRole("alert");
    await fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("button", { name: /octocat\/recovered/ })).toBeInTheDocument();
  });

  it("GitHub 限流保留重试能力而不误判为权限不足", async () => {
    listGitHubWatchedRepos.mockRejectedValueOnce(
      new Error("github_rate_limited：API rate limit exceeded"),
    );
    render(GitHubWatchedRepositoriesCard, { global: { provide: provideWorkspaceStoreFixture(workspace) } });

    expect(await screen.findByRole("alert")).toHaveTextContent("请求暂时受限");
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "通知设置" })).toBeInTheDocument();
  });

  it("账号切换后忽略旧账号的延迟响应", async () => {
    let resolveOldRequest!: (value: { items: GitHubRepoSummary[]; nextPage: null }) => void;
    listGitHubWatchedRepos
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldRequest = resolve; }))
      .mockResolvedValueOnce({ items: [repo(2, "mona/new-repo")], nextPage: null });
    render(GitHubWatchedRepositoriesCard, { global: { provide: provideWorkspaceStoreFixture(workspace) } });
    await waitFor(() => expect(listGitHubWatchedRepos).toHaveBeenCalledTimes(1));

    setBinding({ login: "mona", avatarUrl: null, scopes: ["repo", "notifications"], boundAt: "2026-07-15T01:00:00Z" });
    expect(await screen.findByRole("button", { name: /mona\/new-repo/ })).toBeInTheDocument();
    resolveOldRequest({ items: [repo(1, "octocat/old-repo")], nextPage: null });

    await waitFor(() => expect(screen.queryByRole("button", { name: /octocat\/old-repo/ })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /mona\/new-repo/ })).toBeInTheDocument();
  });
});

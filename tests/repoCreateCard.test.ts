import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepoCreateCard from "../src/components/sidebar/RepoCreateCard.vue";
import type {
  GitHubRepoOwner,
  GitHubRepoSummary,
  GitHubRepoTemplate,
} from "../src/services/workspace";
import { repoSummary } from "./fixtures/workspace";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function githubRepo(name: string, id: number): GitHubRepoSummary {
  return {
    id,
    name,
    fullName: `sena-nana/${name}`,
    ownerLogin: "sena-nana",
    private: false,
    disabled: false,
    archived: false,
    description: null,
    defaultBranch: "main",
    createdAt: "2026-06-20T00:00:00Z",
    updatedAt: "2026-06-20T00:00:00Z",
    cloneUrl: `https://github.com/sena-nana/${name}.git`,
    htmlUrl: `https://github.com/sena-nana/${name}`,
  };
}

function githubOwner(login: string, kind: GitHubRepoOwner["kind"]): GitHubRepoOwner {
  return {
    login,
    kind,
    avatarUrl: null,
    membershipVisible: kind === "user" || kind === "organization",
    membershipComplete: true,
    repositoryAccessVisible: kind === "user",
    source: kind === "user" ? "authenticated_user" : "membership",
  };
}

function githubTemplate(
  name: string,
  id: number,
  overrides: Partial<GitHubRepoTemplate> = {},
): GitHubRepoTemplate {
  return {
    id,
    name,
    fullName: `sena-nana/${name}`,
    ownerLogin: "sena-nana",
    private: false,
    description: null,
    ...overrides,
  };
}

const workspace = vi.hoisted(() => ({
  createLocalRepo: vi.fn(),
  cloneRepo: vi.fn(),
  refreshRepos: vi.fn(),
  createGitHubRepo: vi.fn(),
  listGitHubRepoTemplates: vi.fn(async () => []),
  getAccountRepositoryOwners: vi.fn(async () => []),
}));

vi.mock("../src/composables/useWorkspace", () => ({
  useWorkspace: () => workspace,
}));

const listGitHubRepoOwners = workspace.getAccountRepositoryOwners;
const listGitHubRepoTemplates = workspace.listGitHubRepoTemplates;
const createGitHubRepo = workspace.createGitHubRepo;

async function renderRemoteRepoCard(repoGroups?: Array<{
  id: string;
  name: string;
  repoIds: string[];
  organizationLogin?: string | null;
}>) {
  const view = render(RepoCreateCard, {
    props: {
      open: false,
      mode: "remote",
      workspaceReady: true,
      githubReady: true,
      repoGroups,
    },
  });
  await view.rerender({
    open: true,
    mode: "remote",
    workspaceReady: true,
    githubReady: true,
    repoGroups,
  });
  return view;
}

describe("RepoCreateCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listGitHubRepoOwners).mockResolvedValue([]);
    vi.mocked(listGitHubRepoTemplates).mockResolvedValue([]);
    vi.mocked(createGitHubRepo).mockReset();
    workspace.cloneRepo.mockReset();
    workspace.refreshRepos.mockReset();
    workspace.refreshRepos.mockResolvedValue(undefined);
  });

  it("创建仓库请求返回前关闭弹窗时忽略旧结果", async () => {
    const createRequest = deferred<GitHubRepoSummary>();
    vi.mocked(listGitHubRepoOwners).mockResolvedValue([githubOwner("sena-nana", "user")]);
    vi.mocked(createGitHubRepo).mockReturnValue(createRequest.promise);
    const view = await renderRemoteRepoCard();

    const dialog = screen.getByRole("dialog", { name: "新建 GitHub 仓库" });
    await within(dialog).findByRole("button", { name: "sena-nana · 个人" });
    await fireEvent.update(within(dialog).getByLabelText("仓库名"), "new-repo");
    await fireEvent.click(within(dialog).getByRole("button", { name: "创建并克隆" }));

    expect(vi.mocked(createGitHubRepo)).toHaveBeenCalledWith(expect.objectContaining({
      owner: "sena-nana",
      name: "new-repo",
    }));

    await fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    expect(view.emitted("close")).toHaveLength(1);
    await view.rerender({
      open: false,
      mode: "remote",
      workspaceReady: true,
      githubReady: true,
    });
    expect(screen.queryByRole("dialog", { name: "新建 GitHub 仓库" })).not.toBeInTheDocument();

    createRequest.resolve(githubRepo("new-repo", 1));
    await createRequest.promise;
    await Promise.resolve();

    expect(view.emitted("remoteCloned")).toBeUndefined();
    expect(workspace.cloneRepo).not.toHaveBeenCalled();
    expect(workspace.refreshRepos).not.toHaveBeenCalled();
  });

  it("创建 GitHub 仓库时默认选择 user owner 并将 user 排在最上方", async () => {
    vi.mocked(listGitHubRepoOwners).mockResolvedValue([
      githubOwner("sena-nana", "organization"),
      githubOwner("team-lilia", "organization"),
      githubOwner("lilia-user", "user"),
    ]);
    await renderRemoteRepoCard();

    const dialog = screen.getByRole("dialog", { name: "新建 GitHub 仓库" });
    const ownerTrigger = await within(dialog).findByRole("button", { name: "lilia-user · 个人" });
    await fireEvent.click(ownerTrigger);

    const ownerOptions = await screen.findAllByRole("option");
    expect(ownerOptions.map((option) => option.textContent?.trim())).toEqual([
      "lilia-user · 个人",
      "sena-nana · 组织",
      "team-lilia · 组织",
    ]);
  });

  it("owner 加载失败时显示错误并可重试", async () => {
    vi.mocked(listGitHubRepoOwners)
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce([githubOwner("sena-nana", "user")]);
    await renderRemoteRepoCard();

    const dialog = screen.getByRole("dialog", { name: "新建 GitHub 仓库" });
    expect(await within(dialog).findByText(/账号与组织加载失败/)).toBeInTheDocument();
    const retry = within(dialog).getByRole("button", { name: "重试" });
    expect(retry).toHaveAttribute("data-agent-id", "repo-create.owner.retry");
    await fireEvent.click(retry);

    expect(await within(dialog).findByRole("button", { name: "sena-nana · 个人" })).toBeEnabled();
    expect(listGitHubRepoOwners).toHaveBeenCalledTimes(2);
  });

  it("选择组织时不预判创建权限", async () => {
    vi.mocked(listGitHubRepoOwners).mockResolvedValue([
      githubOwner("sena-nana", "user"),
      githubOwner("team-lilia", "organization"),
    ]);
    await renderRemoteRepoCard();

    const dialog = screen.getByRole("dialog", { name: "新建 GitHub 仓库" });
    await fireEvent.click(await within(dialog).findByRole("button", { name: "sena-nana · 个人" }));
    await fireEvent.click(await screen.findByRole("option", { name: "team-lilia · 组织" }));

    expect(within(dialog).getByText("组织将根据当前账号权限确认创建请求。")).toBeInTheDocument();
  });

  it("可只创建远程 GitHub 仓库并关闭弹窗", async () => {
    vi.mocked(listGitHubRepoOwners).mockResolvedValue([githubOwner("sena-nana", "user")]);
    vi.mocked(createGitHubRepo).mockResolvedValue(githubRepo("remote-only", 3));
    const view = await renderRemoteRepoCard();

    const dialog = screen.getByRole("dialog", { name: "新建 GitHub 仓库" });
    await within(dialog).findByRole("button", { name: "sena-nana · 个人" });
    await fireEvent.update(within(dialog).getByLabelText("仓库名"), "remote-only");
    await fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(createGitHubRepo).toHaveBeenCalledWith(expect.objectContaining({
        owner: "sena-nana",
        name: "remote-only",
      }));
      expect(view.emitted("close")).toHaveLength(1);
    });
    expect(view.emitted("remoteCloned")).toBeUndefined();
    expect(workspace.cloneRepo).not.toHaveBeenCalled();
    expect(workspace.refreshRepos).not.toHaveBeenCalled();
  });

  it("创建 GitHub 仓库时传递模板仓库字段并自动克隆", async () => {
    vi.mocked(listGitHubRepoOwners).mockResolvedValue([githubOwner("sena-nana", "user")]);
    vi.mocked(listGitHubRepoTemplates).mockResolvedValue([
      githubTemplate("template", 20, { description: "template source" }),
    ]);
    vi.mocked(createGitHubRepo).mockResolvedValue({
      ...githubRepo("from-template", 2),
      private: true,
      description: "template repo",
    });
    workspace.cloneRepo.mockResolvedValue(repoSummary("from-template"));
    const view = await renderRemoteRepoCard();

    const dialog = screen.getByRole("dialog", { name: "新建 GitHub 仓库" });
    await within(dialog).findByRole("button", { name: "sena-nana · 个人" });
    await fireEvent.update(within(dialog).getByLabelText("仓库名"), "from-template");
    await fireEvent.update(within(dialog).getByLabelText("描述"), "template repo");
    await fireEvent.click(within(dialog).getByLabelText("Private"));
    await fireEvent.click(within(dialog).getByLabelText("使用模板"));
    const templateTrigger = await within(dialog).findByRole("button", { name: "选择模板仓库" });
    expect(templateTrigger).toHaveAttribute("data-agent-id", "repo-create.template.trigger");
    await fireEvent.click(templateTrigger);
    const templateOption = await screen.findByRole("option", { name: /sena-nana\/template/ });
    expect(templateOption).toHaveAttribute("data-agent-id", "repo-create.template.option.20");
    await fireEvent.click(templateOption);
    await fireEvent.click(within(dialog).getByLabelText("包含所有分支"));
    await fireEvent.click(within(dialog).getByRole("button", { name: "创建并克隆" }));

    await waitFor(() => {
      expect(createGitHubRepo).toHaveBeenCalledWith(expect.objectContaining({
        owner: "sena-nana",
        ownerKind: "user",
        name: "from-template",
        description: "template repo",
        private: true,
        autoInit: false,
        templateFullName: "sena-nana/template",
        includeAllBranches: true,
      }));
      expect(workspace.cloneRepo).toHaveBeenCalledWith({
        remoteUrl: "https://github.com/sena-nana/from-template.git",
        repository: {
          id: 2,
          fullName: "sena-nana/from-template",
          cloneUrl: "https://github.com/sena-nana/from-template.git",
          defaultBranch: "main",
          owner: null,
        },
        placement: { kind: "automatic" },
        target: { kind: "default" },
      });
      expect(workspace.refreshRepos).toHaveBeenCalledTimes(1);
    });
    expect(view.emitted("remoteCloned")?.[0]).toEqual([
      repoSummary("from-template"),
      expect.objectContaining({ fullName: "sena-nana/from-template" }),
    ]);
    expect(view.emitted("close")).toHaveLength(1);
  });

  it.each([
    ["未分组仓库", { kind: "ungrouped" }],
    ["自定义", { kind: "group", groupId: "custom" }],
  ] as const)("组织仓库默认显示组织分组并允许显式选择 %s", async (optionLabel, placement) => {
    vi.mocked(listGitHubRepoOwners).mockResolvedValue([
      githubOwner("lilia-user", "user"),
      githubOwner("team-lilia", "organization"),
    ]);
    const remote = {
      ...githubRepo("created", 30),
      fullName: "team-lilia/created",
      ownerLogin: "team-lilia",
      cloneUrl: "https://github.com/team-lilia/created.git",
      htmlUrl: "https://github.com/team-lilia/created",
      owner: { login: "team-lilia", kind: "organization" as const, avatarUrl: null },
    };
    vi.mocked(createGitHubRepo).mockResolvedValue(remote);
    workspace.cloneRepo.mockResolvedValue(repoSummary("created"));
    await renderRemoteRepoCard([
      { id: "organization", name: "组织项目", repoIds: [], organizationLogin: "TEAM-LILIA" },
      { id: "custom", name: "自定义", repoIds: [] },
    ]);

    const dialog = screen.getByRole("dialog", { name: "新建 GitHub 仓库" });
    await fireEvent.click(await within(dialog).findByRole("button", { name: "lilia-user · 个人" }));
    await fireEvent.click(await screen.findByRole("option", { name: "team-lilia · 组织" }));
    const groupTrigger = within(dialog).getByRole("button", { name: "组织项目" });
    await fireEvent.click(groupTrigger);
    await fireEvent.click(await screen.findByRole("option", { name: new RegExp(`^${optionLabel}`) }));
    await fireEvent.update(within(dialog).getByLabelText("仓库名"), "created");
    await fireEvent.click(within(dialog).getByRole("button", { name: "创建并克隆" }));

    await waitFor(() => {
      expect(workspace.cloneRepo).toHaveBeenCalledWith({
        remoteUrl: remote.cloneUrl,
        repository: {
          id: remote.id,
          fullName: remote.fullName,
          cloneUrl: remote.cloneUrl,
          defaultBranch: remote.defaultBranch,
          owner: remote.owner,
        },
        placement,
        target: { kind: "default" },
      });
    });
  });

  it("仅在启用模板时加载，并在同一弹窗会话复用成功结果、新会话重新加载", async () => {
    const firstLoad = deferred<GitHubRepoTemplate[]>();
    vi.mocked(listGitHubRepoOwners).mockResolvedValue([githubOwner("sena-nana", "user")]);
    vi.mocked(listGitHubRepoTemplates)
      .mockReturnValueOnce(firstLoad.promise)
      .mockResolvedValueOnce([githubTemplate("second-session", 22)]);
    const view = await renderRemoteRepoCard();
    let dialog = screen.getByRole("dialog", { name: "新建 GitHub 仓库" });

    expect(listGitHubRepoTemplates).not.toHaveBeenCalled();
    await fireEvent.click(within(dialog).getByLabelText("使用模板"));
    expect(await within(dialog).findByRole("status")).toHaveTextContent("正在加载模板仓库");
    expect(within(dialog).getByRole("button", { name: "创建" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "创建并克隆" })).toBeDisabled();

    firstLoad.resolve([githubTemplate("first-session", 21)]);
    const firstTemplateTrigger = within(dialog).getByRole("button", { name: "选择模板仓库" });
    await waitFor(() => expect(firstTemplateTrigger).toBeEnabled());
    await fireEvent.click(firstTemplateTrigger);
    await fireEvent.click(await screen.findByRole("option", { name: /sena-nana\/first-session/ }));
    await fireEvent.click(within(dialog).getByLabelText("使用模板"));
    await fireEvent.click(within(dialog).getByLabelText("使用模板"));
    expect(listGitHubRepoTemplates).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole("button", { name: "选择模板仓库" })).toBeEnabled();

    await fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    await view.rerender({
      open: false,
      mode: "remote",
      workspaceReady: true,
      githubReady: true,
    });
    await view.rerender({
      open: true,
      mode: "remote",
      workspaceReady: true,
      githubReady: true,
    });
    dialog = screen.getByRole("dialog", { name: "新建 GitHub 仓库" });
    await fireEvent.click(within(dialog).getByLabelText("使用模板"));
    await waitFor(() => expect(listGitHubRepoTemplates).toHaveBeenCalledTimes(2));
    expect(await within(dialog).findByRole("button", { name: "选择模板仓库" })).toBeEnabled();
  });

  it("远端没有模板仓库时显示空态并保持创建操作不可用", async () => {
    vi.mocked(listGitHubRepoOwners).mockResolvedValue([githubOwner("sena-nana", "user")]);
    vi.mocked(listGitHubRepoTemplates).mockResolvedValue([]);
    await renderRemoteRepoCard();

    const dialog = screen.getByRole("dialog", { name: "新建 GitHub 仓库" });
    await fireEvent.update(within(dialog).getByLabelText("仓库名"), "empty-template");
    await fireEvent.click(within(dialog).getByLabelText("使用模板"));

    expect(await within(dialog).findByText("没有可用的模板仓库。")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "选择模板仓库" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "创建" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "创建并克隆" })).toBeDisabled();
  });

  it("模板仓库加载失败后可重试", async () => {
    vi.mocked(listGitHubRepoOwners).mockResolvedValue([githubOwner("sena-nana", "user")]);
    vi.mocked(listGitHubRepoTemplates)
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce([githubTemplate("retry-template", 23)]);
    await renderRemoteRepoCard();

    const dialog = screen.getByRole("dialog", { name: "新建 GitHub 仓库" });
    await fireEvent.click(within(dialog).getByLabelText("使用模板"));
    expect(await within(dialog).findByText("模板仓库加载失败。")).toBeInTheDocument();

    const retry = within(dialog).getByRole("button", { name: "重试" });
    expect(retry).toHaveAttribute("data-agent-id", "repo-create.template.retry");
    await fireEvent.click(retry);

    await waitFor(() => expect(listGitHubRepoTemplates).toHaveBeenCalledTimes(2));
    const trigger = await within(dialog).findByRole("button", { name: "选择模板仓库" });
    expect(trigger).toBeEnabled();
    await fireEvent.click(trigger);
    expect(await screen.findByRole("option", { name: /sena-nana\/retry-template/ })).toBeInTheDocument();
  });

  it("取消模板模式后忽略迟到的模板列表并在再次启用时重新加载", async () => {
    const staleLoad = deferred<GitHubRepoTemplate[]>();
    vi.mocked(listGitHubRepoOwners).mockResolvedValue([githubOwner("sena-nana", "user")]);
    vi.mocked(listGitHubRepoTemplates)
      .mockReturnValueOnce(staleLoad.promise)
      .mockResolvedValueOnce([]);
    await renderRemoteRepoCard();

    const dialog = screen.getByRole("dialog", { name: "新建 GitHub 仓库" });
    const useTemplate = within(dialog).getByLabelText("使用模板");
    await fireEvent.click(useTemplate);
    await waitFor(() => expect(listGitHubRepoTemplates).toHaveBeenCalledTimes(1));
    await fireEvent.click(useTemplate);
    staleLoad.resolve([githubTemplate("stale-template", 24)]);
    await staleLoad.promise;
    await Promise.resolve();

    await fireEvent.click(useTemplate);
    await waitFor(() => expect(listGitHubRepoTemplates).toHaveBeenCalledTimes(2));
    expect(await within(dialog).findByText("没有可用的模板仓库。")).toBeInTheDocument();
    expect(screen.queryByText("sena-nana/stale-template")).not.toBeInTheDocument();
  });

  it("关闭弹窗后忽略迟到的模板列表", async () => {
    const staleLoad = deferred<GitHubRepoTemplate[]>();
    vi.mocked(listGitHubRepoOwners).mockResolvedValue([githubOwner("sena-nana", "user")]);
    vi.mocked(listGitHubRepoTemplates)
      .mockReturnValueOnce(staleLoad.promise)
      .mockResolvedValueOnce([]);
    const view = await renderRemoteRepoCard();

    let dialog = screen.getByRole("dialog", { name: "新建 GitHub 仓库" });
    await fireEvent.click(within(dialog).getByLabelText("使用模板"));
    await waitFor(() => expect(listGitHubRepoTemplates).toHaveBeenCalledTimes(1));
    await fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    await view.rerender({
      open: false,
      mode: "remote",
      workspaceReady: true,
      githubReady: true,
    });
    staleLoad.resolve([githubTemplate("stale-template", 25)]);
    await staleLoad.promise;

    await view.rerender({
      open: true,
      mode: "remote",
      workspaceReady: true,
      githubReady: true,
    });
    dialog = screen.getByRole("dialog", { name: "新建 GitHub 仓库" });
    await fireEvent.click(within(dialog).getByLabelText("使用模板"));
    await waitFor(() => expect(listGitHubRepoTemplates).toHaveBeenCalledTimes(2));
    expect(await within(dialog).findByText("没有可用的模板仓库。")).toBeInTheDocument();
    expect(screen.queryByText("sena-nana/stale-template")).not.toBeInTheDocument();
  });
});

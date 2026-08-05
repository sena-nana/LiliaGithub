import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Profile from "../src/pages/Profile.vue";
import type {
  GitHubAccountProfile,
  GitHubProfileReadmeSection,
} from "../src/services/workspace";
import type { WorkspaceStore } from "../src/composables/workspace/store";
import {
  createWorkspaceStoreFixture,
  provideWorkspaceStoreFixture,
} from "./fixtures/createWorkspaceStoreFixture";

type GitHubBinding = {
  login: string;
  avatarUrl: string | null;
  scopes: string[];
  boundAt: string;
};

const getAccountProfile = vi.fn();
const getAccountReadme = vi.fn();
const updateAccountProfile = vi.fn();
const startGitHubDeviceFlow = vi.fn();
const openUrl = vi.fn(async () => undefined);
let workspace: WorkspaceStore;

function setBinding(binding: GitHubBinding | null) {
  workspace.stateFeature.state.bindingStatus = binding
    ? { state: "bound", binding }
    : { state: "unbound", binding: null };
}

function accountProfile(
  login = "octocat",
  overrides: Partial<GitHubAccountProfile> = {},
): GitHubAccountProfile {
  return {
    login,
    avatarUrl: `https://avatars.example/${login}.png`,
    name: "Octo Cat",
    email: "octocat@example.com",
    bio: "Builds developer tools",
    company: "GitHub",
    location: "San Francisco",
    blog: "https://octocat.example",
    twitterUsername: "octocat",
    hireable: false,
    ...overrides,
  };
}

function accountReadme(
  login = "octocat",
  overrides: Partial<GitHubProfileReadmeSection> = {},
): GitHubProfileReadmeSection {
  return {
    status: "ready",
    preview: {
      path: "README.md",
      name: "README.md",
      previewKind: "markdown",
      content: `# ${login}\n\n[指南](docs/guide.md)<script>alert('unsafe')</script>`,
      images: {},
      size: 72,
      truncated: false,
    },
    sourceRepo: `${login}/${login}`,
    htmlUrl: `https://github.com/${login}/${login}/blob/main/README.md`,
    error: null,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function agent<T extends Element = HTMLElement>(container: HTMLElement, id: string): T {
  const element = container.querySelector(`[data-agent-id="${id}"]`);
  expect(element, `missing data-agent-id=${id}`).not.toBeNull();
  return element as T;
}

async function renderProfile() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/profile", component: Profile },
      { path: "/settings", component: { template: "<div>settings</div>" } },
    ],
  });
  await router.push("/profile");
  await router.isReady();
  return {
    ...render(Profile, {
      global: {
        plugins: [router],
        provide: provideWorkspaceStoreFixture(workspace),
      },
    }),
    router,
  };
}

describe("用户资料页", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspace = createWorkspaceStoreFixture({
      getGitHubAccountProfile: getAccountProfile,
      getGitHubAccountReadme: getAccountReadme,
      updateGitHubAccountProfile: updateAccountProfile,
      startGitHubDeviceFlow,
      openUrl,
    });
    setBinding({
      login: "octocat",
      avatarUrl: "https://avatars.example/octocat.png",
      scopes: ["repo", "user"],
      boundAt: "2026-07-15T00:00:00Z",
    });
    getAccountProfile.mockResolvedValue(accountProfile());
    getAccountReadme.mockResolvedValue(accountReadme());
    updateAccountProfile.mockImplementation(async (request) => accountProfile("octocat", request));
  });

  it("资料加载后进入只读展示态", async () => {
    const view = await renderProfile();

    const editor = await waitFor(() => agent(view.container, "profile.editor"));
    await waitFor(() => expect(editor).toHaveTextContent("Octo Cat"));
    expect(editor).toHaveTextContent("octocat");
    expect(editor).toHaveTextContent("Builds developer tools");
    expect(view.container.querySelector('[data-agent-id="profile.name"]')).toBeNull();
    expect(agent(view.container, "profile.edit")).toBeEnabled();
  });

  it("左侧展示个人资料，右侧安全渲染 README 并打开相对链接", async () => {
    const view = await renderProfile();

    const sidebar = await waitFor(() => agent(view.container, "profile.sidebar"));
    const readme = await waitFor(() => agent(view.container, "profile.readme"));
    await waitFor(() => expect(sidebar).toHaveTextContent("Octo Cat"));
    expect(within(readme).getByRole("heading", { name: "octocat" })).toBeInTheDocument();
    expect(readme.querySelector("script")).toBeNull();

    await fireEvent.click(within(readme).getByRole("link", { name: "指南" }));
    const toolbar = await screen.findByRole("toolbar", { name: "链接操作" });
    await fireEvent.click(within(toolbar).getByRole("button", { name: "打开" }));

    expect(openUrl).toHaveBeenCalledWith(
      "https://github.com/octocat/octocat/blob/main/docs/guide.md",
    );
  });

  it("README 不存在时展示独立空态", async () => {
    getAccountReadme.mockResolvedValueOnce(accountReadme("octocat", {
      status: "empty",
      preview: null,
      sourceRepo: null,
      htmlUrl: null,
    }));
    const view = await renderProfile();

    const readme = await waitFor(() => agent(view.container, "profile.readme"));
    expect(await within(readme).findByText("尚未公开个人 README。")).toBeInTheDocument();
    expect(within(readme).queryByRole("button", { name: "重试" })).toBeNull();
  });

  it("README 不可用时可独立重试并恢复内容", async () => {
    getAccountReadme
      .mockResolvedValueOnce(accountReadme("octocat", {
        status: "unavailable",
        preview: null,
        sourceRepo: null,
        htmlUrl: null,
        error: "HTTP 502",
      }))
      .mockResolvedValueOnce(accountReadme("octocat", {
        preview: {
          ...accountReadme().preview!,
          content: "# Recovered README",
        },
      }));
    const view = await renderProfile();

    const readme = await waitFor(() => agent(view.container, "profile.readme"));
    await fireEvent.click(await within(readme).findByRole("button", { name: "重试" }));

    expect(await within(readme).findByRole("heading", { name: "Recovered README" })).toBeInTheDocument();
    expect(getAccountReadme).toHaveBeenCalledTimes(2);
    expect(readme).not.toHaveTextContent("HTTP 502");
  });

  it("账号切换后忽略旧账号的延迟 README", async () => {
    const oldReadme = deferred<GitHubProfileReadmeSection>();
    getAccountReadme
      .mockReturnValueOnce(oldReadme.promise)
      .mockResolvedValueOnce(accountReadme("mona", {
        preview: {
          ...accountReadme("mona").preview!,
          content: "# Mona README",
        },
      }));
    getAccountProfile
      .mockResolvedValueOnce(accountProfile())
      .mockResolvedValueOnce(accountProfile("mona", { name: "Mona" }));
    const view = await renderProfile();
    await waitFor(() => expect(getAccountReadme).toHaveBeenCalledTimes(1));

    setBinding({
      login: "mona",
      avatarUrl: "https://avatars.example/mona.png",
      scopes: ["repo", "user"],
      boundAt: "2026-07-15T01:00:00Z",
    });
    await waitFor(() => expect(getAccountReadme).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("heading", { name: "Mona README" })).toBeInTheDocument();

    oldReadme.resolve(accountReadme("octocat", {
      preview: {
        ...accountReadme().preview!,
        content: "# Late Octocat README",
      },
    }));
    await Promise.resolve();
    expect(view.container).not.toHaveTextContent("Late Octocat README");
  });

  it("取消编辑后恢复服务端资料快照", async () => {
    const view = await renderProfile();
    await waitFor(() => expect(agent(view.container, "profile.edit")).toBeEnabled());

    await fireEvent.click(agent(view.container, "profile.edit"));
    const name = agent<HTMLInputElement>(view.container, "profile.name");
    expect(name).toHaveValue("Octo Cat");
    await fireEvent.update(name, "Local draft");
    await fireEvent.click(agent(view.container, "profile.cancel"));

    expect(view.container.querySelector('[data-agent-id="profile.name"]')).toBeNull();
    await fireEvent.click(agent(view.container, "profile.edit"));
    expect(agent<HTMLInputElement>(view.container, "profile.name")).toHaveValue("Octo Cat");
    expect(updateAccountProfile).not.toHaveBeenCalled();
  });

  it("授权成功后允许编辑并提交完整公开资料", async () => {
    setBinding({
      ...workspace.githubBinding.value!,
      scopes: ["repo", "read:user"],
    });
    const view = await renderProfile();
    await waitFor(() => expect(agent(view.container, "profile.authorize")).toBeEnabled());

    await fireEvent.click(agent(view.container, "profile.authorize"));
    expect(startGitHubDeviceFlow).toHaveBeenCalledTimes(1);

    setBinding({
      ...workspace.githubBinding.value!,
      scopes: ["repo", "user"],
      boundAt: "2026-07-15T00:01:00Z",
    });
    getAccountProfile.mockResolvedValueOnce(accountProfile());
    await waitFor(() => expect(agent(view.container, "profile.edit")).toBeEnabled());
    await fireEvent.click(agent(view.container, "profile.edit"));
    await fireEvent.update(agent(view.container, "profile.name"), "Mona Lisa");
    await fireEvent.click(agent(view.container, "profile.save"));

    await waitFor(() => {
      expect(updateAccountProfile).toHaveBeenCalledWith({
        name: "Mona Lisa",
        email: "octocat@example.com",
        bio: "Builds developer tools",
        company: "GitHub",
        location: "San Francisco",
        blog: "https://octocat.example",
        twitterUsername: "octocat",
        hireable: false,
      });
    });
  });

  it("授权进行中展示设备码并阻止重复发起", async () => {
    setBinding({
      ...workspace.githubBinding.value!,
      scopes: ["repo", "read:user"],
    });
    startGitHubDeviceFlow.mockResolvedValueOnce({
      deviceCode: "device-code",
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      expiresInSeconds: 900,
      intervalSeconds: 5,
      expiresAt: Date.now() + 900_000,
    });
    const view = await renderProfile();
    await waitFor(() => expect(agent(view.container, "profile.authorize")).toBeEnabled());

    const authorize = agent<HTMLButtonElement>(view.container, "profile.authorize");
    await fireEvent.click(authorize);
    await fireEvent.click(authorize);

    expect(startGitHubDeviceFlow).toHaveBeenCalledTimes(1);
    expect(agent(view.container, "profile.authorization")).toHaveAttribute("role", "status");
    expect(agent(view.container, "profile.authorization.code")).toHaveTextContent("ABCD-1234");
  });

  it("保存采用服务端回显、清除 dirty 状态并阻止重复提交", async () => {
    const save = deferred<GitHubAccountProfile>();
    updateAccountProfile.mockReturnValueOnce(save.promise);
    const view = await renderProfile();
    await waitFor(() => expect(agent(view.container, "profile.edit")).toBeEnabled());
    await fireEvent.click(agent(view.container, "profile.edit"));
    await fireEvent.update(agent(view.container, "profile.name"), "Client value");

    const saveButton = agent(view.container, "profile.save");
    await fireEvent.click(saveButton);
    await fireEvent.click(saveButton);
    expect(updateAccountProfile).toHaveBeenCalledTimes(1);

    save.resolve(accountProfile("octocat", { name: "Server value" }));
    await waitFor(() => expect(view.container.querySelector('[data-agent-id="profile.name"]')).toBeNull());
    expect(agent(view.container, "profile.editor")).toHaveTextContent("Server value");

    await fireEvent.click(agent(view.container, "profile.edit"));
    expect(agent<HTMLInputElement>(view.container, "profile.name")).toHaveValue("Server value");
    expect(agent<HTMLButtonElement>(view.container, "profile.save")).toBeDisabled();
  });

  it("保存失败时保留草稿和编辑态", async () => {
    updateAccountProfile.mockRejectedValueOnce(new Error("422 validation failed"));
    const view = await renderProfile();
    await waitFor(() => expect(agent(view.container, "profile.edit")).toBeEnabled());
    await fireEvent.click(agent(view.container, "profile.edit"));

    const name = agent<HTMLInputElement>(view.container, "profile.name");
    await fireEvent.update(name, "Unsaved Name");
    await fireEvent.click(agent(view.container, "profile.save"));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(name).toHaveValue("Unsaved Name");
    expect(agent(view.container, "profile.cancel")).toBeInTheDocument();
  });

  it("账号切换后忽略旧账号的延迟响应", async () => {
    const oldRequest = deferred<GitHubAccountProfile>();
    getAccountProfile
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce(accountProfile("mona", { name: "Mona" }));
    const view = await renderProfile();
    await waitFor(() => expect(getAccountProfile).toHaveBeenCalledTimes(1));

    setBinding({
      login: "mona",
      avatarUrl: "https://avatars.example/mona.png",
      scopes: ["repo", "user"],
      boundAt: "2026-07-15T01:00:00Z",
    });
    await waitFor(() => expect(agent(view.container, "profile.editor")).toHaveTextContent("Mona"));

    oldRequest.resolve(accountProfile("octocat", { name: "Late Octocat" }));
    await waitFor(() => expect(agent(view.container, "profile.editor")).not.toHaveTextContent("Late Octocat"));
    expect(agent(view.container, "profile.editor")).toHaveTextContent("Mona");
  });

  it("加载失败后可重试并恢复远端资料", async () => {
    getAccountProfile
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(accountProfile("octocat", { name: "Recovered profile" }));
    const view = await renderProfile();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(view.container.querySelector('[data-agent-id="profile.edit"]')).toBeNull();
    expect(updateAccountProfile).not.toHaveBeenCalled();
    await fireEvent.click(agent(view.container, "profile.retry"));

    await waitFor(() => expect(agent(view.container, "profile.editor")).toHaveTextContent("Recovered profile"));
    expect(getAccountProfile).toHaveBeenCalledTimes(2);
    expect(agent(view.container, "profile.edit")).toBeEnabled();
  });

  it("未绑定时通过账户设置入口完成站内导航", async () => {
    setBinding(null);
    const view = await renderProfile();

    await fireEvent.click(agent(view.container, "profile.open-account-settings"));
    await waitFor(() => expect(view.router.currentRoute.value.fullPath).toBe("/settings?tab=account"));
    expect(getAccountProfile).not.toHaveBeenCalled();
    expect(getAccountReadme).not.toHaveBeenCalled();
  });

  it("通过资料页入口在 GitHub 打开当前账号", async () => {
    const view = await renderProfile();
    await waitFor(() => expect(agent(view.container, "profile.open-github")).toBeEnabled());

    await fireEvent.click(agent(view.container, "profile.open-github"));

    expect(openUrl).toHaveBeenCalledWith("https://github.com/octocat");
  });
});

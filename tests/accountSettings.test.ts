import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountSection from "../src/pages/settings/AccountSection.vue";

const { preferences, workspace } = vi.hoisted(() => {
  const preferences = {
    defaultWorkspaceRoot: "C:\\Files\\workspace",
    repositoryScope: { kind: "all" as const },
    repositorySort: { key: "updated" as const, direction: "desc" as const },
    issues: { state: "open" as const, sort: "created" as const, direction: "desc" as const },
    pullRequests: { state: "open" as const, sort: "updated" as const, direction: "desc" as const },
    actions: { state: "all" as const, sort: "updated" as const, direction: "desc" as const },
  };
  return { preferences, workspace: {
    state: {
      settings: { workspaceRoot: "C:\\Files\\workspace", accountPreferences: preferences },
    authLoading: false,
    authFlowStatus: "idle",
    authNotice: null,
    error: null,
  },
  githubBinding: { value: null as null | { login: string; avatarUrl: string | null; scopes: string[] } },
  deviceFlow: { value: null },
  authRemainingText: { value: null },
  authBindingStatusText: { value: "GitHub 已授权" },
  startAuthFlow: vi.fn(async () => undefined),
  unbindGitHub: vi.fn(async () => undefined),
  getAccountProfile: vi.fn(),
  updateAccountProfile: vi.fn(),
  getAccountRepositoryOwners: vi.fn(async () => []),
  pickAccountWorkspaceRoot: vi.fn(async () => "D:\\Projects"),
    updateAccountPreferences: vi.fn(),
  } };
});

vi.mock("../src/composables/useWorkspace", async () => {
  const { reactive, ref } = await vi.importActual<typeof import("vue")>("vue");
  workspace.state = reactive(workspace.state);
  workspace.githubBinding = ref(workspace.githubBinding.value);
  workspace.deviceFlow = ref(null);
  return { useWorkspace: () => workspace };
});

describe("账户设置", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspace.githubBinding.value = {
      login: "octocat",
      avatarUrl: "https://avatars.example/octocat.png",
      scopes: ["repo", "read:user"],
    };
    workspace.state.settings = { workspaceRoot: "C:\\Files\\workspace", accountPreferences: structuredClone(preferences) };
    workspace.state.authLoading = false;
    workspace.state.authFlowStatus = "idle";
    workspace.state.authNotice = null;
    workspace.state.error = null;
    workspace.getAccountProfile.mockResolvedValue({
      login: "octocat",
      avatarUrl: "https://avatars.example/octocat.png",
      name: "Octo Cat",
      email: null,
      bio: "Builder",
      company: null,
      location: null,
      blog: null,
      twitterUsername: null,
      hireable: null,
    });
    workspace.updateAccountProfile.mockImplementation(async (request) => ({
      login: "octocat",
      avatarUrl: null,
      ...request,
    }));
    workspace.updateAccountPreferences.mockImplementation(async (next) => {
      workspace.state.settings.accountPreferences = structuredClone(next);
      return workspace.state.settings;
    });
  });

  it("按需授权编辑资料并提交完整公开资料", async () => {
    const { container } = render(AccountSection);
    await screen.findByDisplayValue("Octo Cat");

    await fireEvent.click(screen.getByRole("button", { name: "授权编辑资料" }));
    expect(workspace.startAuthFlow).toHaveBeenCalledWith("profileWrite");

    workspace.githubBinding.value = { ...workspace.githubBinding.value!, scopes: ["repo", "user"] };
    const name = container.querySelector('[data-agent-id="settings.account.profile.name"]');
    expect(name).toBeInstanceOf(HTMLInputElement);
    await waitFor(() => expect(name).not.toBeDisabled());
    await fireEvent.update(name!, "Mona Lisa");
    await fireEvent.click(screen.getByRole("button", { name: "保存资料" }));

    await waitFor(() => {
      expect(workspace.updateAccountProfile).toHaveBeenCalledWith(expect.objectContaining({
        name: "Mona Lisa",
        bio: "Builder",
        hireable: false,
      }));
    });
  });

  it("选择默认工作区后原子保存整组账户偏好", async () => {
    workspace.state.settings.workspaceRoot = null;
    render(AccountSection);
    await screen.findByDisplayValue("Octo Cat");
    expect(screen.getByText("默认工作区当前不可用，可重新选择。")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "选择" }));
    await fireEvent.click(screen.getByRole("button", { name: "保存偏好" }));

    await waitFor(() => {
      expect(workspace.updateAccountPreferences).toHaveBeenCalledWith(expect.objectContaining({
        defaultWorkspaceRoot: "D:\\Projects",
        repositorySort: { key: "updated", direction: "desc" },
        actions: { state: "all", sort: "updated", direction: "desc" },
      }));
    });
  });

  it("资料保存失败时保留用户草稿", async () => {
    workspace.githubBinding.value = { ...workspace.githubBinding.value!, scopes: ["repo", "user"] };
    workspace.updateAccountProfile.mockRejectedValueOnce(new Error("422 validation failed"));
    const { container } = render(AccountSection);
    await screen.findByDisplayValue("Octo Cat");

    const name = container.querySelector('[data-agent-id="settings.account.profile.name"]') as HTMLInputElement;
    await fireEvent.update(name, "Unsaved Name");
    await fireEvent.click(screen.getByRole("button", { name: "保存资料" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("资料未能保存");
    expect(name).toHaveValue("Unsaved Name");
  });

  it("更换账号时丢弃旧账号草稿并加载新资料", async () => {
    workspace.githubBinding.value = { ...workspace.githubBinding.value!, scopes: ["repo", "user"] };
    const { container } = render(AccountSection);
    await screen.findByDisplayValue("Octo Cat");

    const name = container.querySelector('[data-agent-id="settings.account.profile.name"]') as HTMLInputElement;
    await fireEvent.update(name, "Old account draft");
    workspace.getAccountProfile.mockResolvedValueOnce({
      login: "mona",
      avatarUrl: null,
      name: "Mona",
      email: null,
      bio: null,
      company: null,
      location: null,
      blog: null,
      twitterUsername: null,
      hireable: null,
    });
    workspace.githubBinding.value = { login: "mona", avatarUrl: null, scopes: ["repo", "user"] };

    await waitFor(() => expect(name).toHaveValue("Mona"));
    expect(name).not.toHaveValue("Old account draft");
  });
});

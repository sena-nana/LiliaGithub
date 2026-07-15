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
    workspace.updateAccountPreferences.mockImplementation(async (next) => {
      workspace.state.settings.accountPreferences = structuredClone(next);
      return workspace.state.settings;
    });
  });

  it("选择默认工作区后原子保存整组账户偏好", async () => {
    workspace.state.settings.workspaceRoot = null;
    const { container } = render(AccountSection);
    expect(container.querySelector('[data-agent-id="profile.editor"]')).toBeNull();
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
});

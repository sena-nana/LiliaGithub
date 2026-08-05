import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountSection from "../src/pages/settings/AccountSection.vue";
import { REQUIRED_GITHUB_AUTH_SCOPES } from "../src/services/workspace/authScopes";
import type { GitHubBinding } from "../src/services/workspace";
import type { WorkspaceStore } from "../src/composables/workspace/store";
import { workspaceSettings } from "./fixtures/workspace";
import {
  createWorkspaceStoreFixture,
  provideWorkspaceStoreFixture,
} from "./fixtures/createWorkspaceStoreFixture";

const preferences = {
    repositoryScope: { kind: "all" as const },
    repositorySort: { key: "updated" as const, direction: "desc" as const },
    issues: { state: "open" as const, sort: "number" as const, direction: "desc" as const },
    pullRequests: { state: "open" as const, sort: "number" as const, direction: "desc" as const },
    actions: { state: "all" as const, sort: "updated" as const, direction: "desc" as const },
};
const client = {
  startGitHubDeviceFlow: vi.fn(),
  openUrl: vi.fn(async () => undefined),
  listGitHubRepoOwners: vi.fn(async () => []),
  updateAccountPreferences: vi.fn(),
};
let workspace: WorkspaceStore;

function setBinding(binding: GitHubBinding | null) {
  workspace.stateFeature.state.bindingStatus = binding
    ? { state: "bound", binding }
    : { state: "unbound", binding: null };
}

function renderAccountSection() {
  return render(AccountSection, {
    global: { provide: provideWorkspaceStoreFixture(workspace) },
  });
}

describe("账户设置", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspace = createWorkspaceStoreFixture(client);
    const settings = workspaceSettings();
    settings.accountPreferences = structuredClone(preferences);
    workspace.stateFeature.state.settings = settings;
    setBinding({
      login: "octocat",
      avatarUrl: "https://avatars.example/octocat.png",
      scopes: ["repo", "read:user"],
      boundAt: "2026-07-15T00:00:00Z",
    });
    client.startGitHubDeviceFlow.mockResolvedValue({
      deviceCode: "device",
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      expiresInSeconds: 900,
      intervalSeconds: 5,
      expiresAt: Date.now() + 900_000,
    });
    client.updateAccountPreferences.mockImplementation(async (next) => {
      const updated = { ...workspace.stateFeature.state.settings!, accountPreferences: structuredClone(next) };
      return updated;
    });
  });

  it("账户设置只保存账号级仓库偏好", async () => {
    workspace.stateFeature.state.settings!.workspaceRoot = null;
    const { container } = renderAccountSection();
    expect(container.querySelector('[data-agent-id="profile.editor"]')).toBeNull();
    expect(screen.queryByText("默认工作区当前不可用，可重新选择。")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "保存偏好" }));

    await waitFor(() => {
      expect(client.updateAccountPreferences).toHaveBeenCalledWith({
        repositoryScope: { kind: "all" },
        repositorySort: { key: "updated", direction: "desc" },
        issues: { state: "open", sort: "number", direction: "desc" },
        pullRequests: { state: "open", sort: "number", direction: "desc" },
        actions: { state: "all", sort: "updated", direction: "desc" },
      });
    });
  });

  it("旧绑定统一提示补全授权，完整授权后不再提示", async () => {
    const view = renderAccountSection();
    const completeAuthorization = view.container.querySelector(
      '[data-agent-id="settings.account.github.complete-authorization"]',
    ) as HTMLButtonElement;

    expect(completeAuthorization).toBeInTheDocument();
    expect(screen.getByText("授权待补全")).toBeInTheDocument();
    await fireEvent.click(completeAuthorization);
    expect(client.startGitHubDeviceFlow).toHaveBeenCalledWith();

    setBinding({
      ...workspace.githubBinding.value!,
      scopes: [...REQUIRED_GITHUB_AUTH_SCOPES],
    });
    await waitFor(() => {
      expect(view.container.querySelector(
        '[data-agent-id="settings.account.github.complete-authorization"]',
      )).toBeNull();
    });
  });
});

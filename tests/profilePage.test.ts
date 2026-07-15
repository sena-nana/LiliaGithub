import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Profile from "../src/pages/Profile.vue";

const { workspace } = vi.hoisted(() => ({
  workspace: {
    state: {
      authLoading: false,
      error: null as string | null,
    },
    githubBinding: {
      value: null as null | {
        login: string;
        avatarUrl: string | null;
        scopes: string[];
        boundAt: string;
      },
    },
    getAccountProfile: vi.fn(),
    updateAccountProfile: vi.fn(),
    startAuthFlow: vi.fn(async () => undefined),
  },
}));

vi.mock("../src/composables/useWorkspace", async () => {
  const { reactive, ref } = await vi.importActual<typeof import("vue")>("vue");
  workspace.state = reactive(workspace.state);
  workspace.githubBinding = ref(workspace.githubBinding.value);
  return { useWorkspace: () => workspace };
});

function accountProfile(login: string, name: string) {
  return {
    login,
    avatarUrl: null,
    name,
    email: null,
    bio: "Builder",
    company: null,
    location: null,
    blog: null,
    twitterUsername: null,
    hireable: null,
  };
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
    ...render(Profile, { global: { plugins: [router] } }),
    router,
  };
}

describe("用户资料页", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspace.state.authLoading = false;
    workspace.state.error = null;
    workspace.githubBinding.value = {
      login: "octocat",
      avatarUrl: "https://avatars.example/octocat.png",
      scopes: ["repo", "read:user"],
      boundAt: "2026-07-15T00:00:00Z",
    };
    workspace.getAccountProfile.mockResolvedValue(accountProfile("octocat", "Octo Cat"));
    workspace.updateAccountProfile.mockImplementation(async (request) => ({
      login: "octocat",
      avatarUrl: null,
      ...request,
    }));
  });

  it("按需授权并提交完整公开资料", async () => {
    const view = await renderProfile();
    await screen.findByDisplayValue("Octo Cat");

    await fireEvent.click(screen.getByRole("button", { name: "授权编辑资料" }));
    expect(workspace.startAuthFlow).toHaveBeenCalledWith("profileWrite");

    workspace.githubBinding.value = {
      ...workspace.githubBinding.value!,
      scopes: ["repo", "user"],
      boundAt: "2026-07-15T00:01:00Z",
    };
    const name = view.container.querySelector('[data-agent-id="profile.name"]');
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

  it("保存失败时保留用户草稿", async () => {
    workspace.githubBinding.value = { ...workspace.githubBinding.value!, scopes: ["repo", "user"] };
    workspace.updateAccountProfile.mockRejectedValueOnce(new Error("422 validation failed"));
    const view = await renderProfile();
    await screen.findByDisplayValue("Octo Cat");

    const name = view.container.querySelector('[data-agent-id="profile.name"]') as HTMLInputElement;
    await fireEvent.update(name, "Unsaved Name");
    await fireEvent.click(screen.getByRole("button", { name: "保存资料" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(name).toHaveValue("Unsaved Name");
  });

  it("更换账号或重新绑定时丢弃旧草稿和旧响应", async () => {
    workspace.githubBinding.value = { ...workspace.githubBinding.value!, scopes: ["repo", "user"] };
    const view = await renderProfile();
    await screen.findByDisplayValue("Octo Cat");

    const name = view.container.querySelector('[data-agent-id="profile.name"]') as HTMLInputElement;
    await fireEvent.update(name, "Old account draft");
    workspace.getAccountProfile.mockResolvedValueOnce(accountProfile("mona", "Mona"));
    workspace.githubBinding.value = {
      login: "mona",
      avatarUrl: null,
      scopes: ["repo", "user"],
      boundAt: "2026-07-15T01:00:00Z",
    };

    await waitFor(() => expect(name).toHaveValue("Mona"));
    expect(name).not.toHaveValue("Old account draft");
  });

  it("未绑定时提供真实的账户设置入口", async () => {
    workspace.githubBinding.value = null;
    const view = await renderProfile();

    await fireEvent.click(screen.getByRole("link", { name: "前往账户设置" }));
    await waitFor(() => expect(view.router.currentRoute.value.fullPath).toBe("/settings?tab=account"));
    expect(workspace.getAccountProfile).not.toHaveBeenCalled();
  });
});

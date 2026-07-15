import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepoNotificationPreferencesCard from "../src/components/repo/RepoNotificationPreferencesCard.vue";

const mocks = vi.hoisted(() => ({
  binding: {
    value: {
      login: "octocat",
      avatarUrl: null as string | null,
      scopes: ["repo", "notifications"],
    } as { login: string; avatarUrl: string | null; scopes: string[] } | null,
  },
  getSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("../src/composables/useWorkspace", () => ({
  useWorkspace: () => ({ githubBinding: mocks.binding }),
}));

vi.mock("../src/services/workspace", () => ({
  getGitHubRepositorySubscription: mocks.getSubscription,
  updateGitHubRepositorySubscription: mocks.updateSubscription,
  openUrl: mocks.openUrl,
  githubErrorCode: (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return message.match(/^(github_[a-z0-9_]+)\s*[:：]/i)?.[1]?.toLocaleLowerCase() ?? null;
  },
  isGitHubBindingExpiredError: (error: unknown) =>
    (error as { code?: string } | null)?.code === "github_authentication_required",
  isGitHubPermissionError: (error: unknown) =>
    (error as { code?: string } | null)?.code === "github_permission_denied",
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function permissionError() {
  return Object.assign(new Error("permission denied"), { code: "github_permission_denied" });
}

function renderCard(repoFullName = "sena-nana/LiliaGithub") {
  return render(RepoNotificationPreferencesCard, {
    props: { repoFullName },
    global: { stubs: { transition: false } },
  });
}

async function selectMode(label: string) {
  await fireEvent.click(screen.getByRole("button", { name: /已关注|仅参与和提及|忽略此仓库/ }));
  await fireEvent.click(await screen.findByRole("option", { name: label }));
}

describe("RepoNotificationPreferencesCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.binding.value = {
      login: "octocat",
      avatarUrl: null,
      scopes: ["repo", "notifications"],
    };
    mocks.getSubscription.mockResolvedValue({ mode: "watching" });
    mocks.updateSubscription.mockImplementation(async (_repoFullName, mode) => ({ mode }));
    mocks.openUrl.mockResolvedValue(undefined);
  });

  it("加载服务端模式并按返回值切换三种通知偏好", async () => {
    renderCard();

    expect(await screen.findByRole("button", { name: /已关注/ })).toBeInTheDocument();
    await selectMode("仅参与和提及");
    await waitFor(() => {
      expect(mocks.updateSubscription).toHaveBeenLastCalledWith(
        "sena-nana/LiliaGithub",
        "participating",
      );
    });
    expect(await screen.findByRole("button", { name: /仅参与和提及/ })).toBeInTheDocument();

    await selectMode("忽略此仓库");
    await waitFor(() => {
      expect(mocks.updateSubscription).toHaveBeenLastCalledWith(
        "sena-nana/LiliaGithub",
        "ignored",
      );
    });
    expect(await screen.findByRole("button", { name: /忽略此仓库/ })).toBeInTheDocument();
  });

  it("保存失败时保留原模式并允许重新读取", async () => {
    mocks.updateSubscription.mockRejectedValueOnce(new Error("network unavailable"));
    renderCard();
    await screen.findByRole("button", { name: /已关注/ });

    await selectMode("忽略此仓库");

    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法读取仓库通知偏好");
    expect(screen.getByRole("button", { name: /已关注/ })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: /重试/ }));
    await waitFor(() => expect(mocks.getSubscription).toHaveBeenCalledTimes(2));
  });

  it("限流时保留重试入口且不暴露 HTTP 错误文本", async () => {
    mocks.getSubscription.mockRejectedValueOnce(
      new Error("github_rate_limited：读取失败（403 Forbidden）"),
    );
    renderCard();

    expect(await screen.findByRole("alert")).toHaveTextContent("GitHub 请求暂时受限");
    expect(screen.getByRole("alert")).not.toHaveTextContent("403 Forbidden");
    await fireEvent.click(screen.getByRole("button", { name: /重试/ }));
    await waitFor(() => expect(mocks.getSubscription).toHaveBeenCalledTimes(2));
  });

  it("缺少 notifications scope 时不显示假可用控件并保留 GitHub 入口", async () => {
    mocks.binding.value = {
      login: "octocat",
      avatarUrl: null,
      scopes: ["repo"],
    };
    renderCard();

    expect(screen.getByRole("status")).toHaveTextContent("未包含通知权限");
    expect(screen.queryByRole("button", { name: /已关注|仅参与和提及|忽略此仓库/ })).toBeNull();
    expect(mocks.getSubscription).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole("button", { name: "在 GitHub 自定义" }));
    expect(mocks.openUrl).toHaveBeenCalledWith("https://github.com/sena-nana/LiliaGithub");
  });

  it("权限错误降级为真实不可用状态且不提供无效重试", async () => {
    mocks.getSubscription.mockRejectedValueOnce(permissionError());
    renderCard();

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("无法管理此仓库的通知偏好");
    });
    expect(screen.queryByRole("button", { name: /重试/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /已关注|仅参与和提及|忽略此仓库/ })).toBeNull();
    expect(screen.getByRole("button", { name: "在 GitHub 自定义" })).toBeInTheDocument();
  });

  it("绑定失效后移除订阅控件并保留 GitHub 网页入口", async () => {
    mocks.getSubscription.mockRejectedValueOnce(
      Object.assign(new Error("authentication required"), { code: "github_authentication_required" }),
    );
    renderCard();

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("无法管理此仓库的通知偏好");
    });
    expect(screen.queryByRole("button", { name: /重试/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /已关注|仅参与和提及|忽略此仓库/ })).toBeNull();
    expect(screen.getByRole("button", { name: "在 GitHub 自定义" })).toBeInTheDocument();
  });

  it("快速切换仓库时忽略旧仓库的延迟响应", async () => {
    const oldRequest = deferred<{ mode: "watching" }>();
    mocks.getSubscription.mockImplementation(async (repoFullName: string) => {
      if (repoFullName === "sena-nana/old-repo") return oldRequest.promise;
      return { mode: "ignored" };
    });
    const view = renderCard("sena-nana/old-repo");

    await view.rerender({ repoFullName: "sena-nana/new-repo" });
    expect(await screen.findByRole("button", { name: /忽略此仓库/ })).toBeInTheDocument();
    oldRequest.resolve({ mode: "watching" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /忽略此仓库/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /已关注/ })).toBeNull();
  });
});

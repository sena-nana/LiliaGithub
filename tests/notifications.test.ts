import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Notifications from "../src/pages/Notifications.vue";
import {
  listNotificationsFallback,
  markNotificationsReadFallback,
  setNotificationFallbackForTests,
  unsubscribeNotificationFallback,
} from "../src/services/notifications/fallback";
import type {
  GitHubNotification,
  GitHubNotificationMutationResult,
} from "../src/services/notifications/types";
import {
  notificationCategory,
  notificationTarget,
} from "../src/utils/notifications";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  markRead: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("../src/services/notifications", async () => {
  const types = await vi.importActual("../src/services/notifications/types");
  return {
    ...types,
    listGitHubNotifications: api.list,
    markGitHubNotificationsRead: api.markRead,
    unsubscribeGitHubNotification: api.unsubscribe,
  };
});

function notification(
  id: string,
  subjectType: string,
  subjectUrl: string,
  overrides: Partial<GitHubNotification> = {},
): GitHubNotification {
  return {
    id,
    repoFullName: "sena-nana/LiliaGithub",
    title: `${subjectType} ${id}`,
    reason: "subscribed",
    subjectType,
    subjectUrl,
    latestCommentUrl: null,
    updatedAt: `2026-07-17T08:00:0${id}Z`,
    unread: true,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function renderPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/notifications", component: Notifications },
      { path: "/repos/:repoId(.*)", component: { template: "<div>repository target</div>" } },
    ],
  });
  await router.push("/notifications");
  await router.isReady();
  render(Notifications, { global: { plugins: [router] } });
  return router;
}

describe("通知契约与导航", () => {
  it("将可识别对象映射到应用内上下文，其他对象降级到 GitHub", () => {
    const issue = notification(
      "1",
      "Issue",
      "https://api.github.com/repos/sena-nana/LiliaGithub/issues/26",
    );
    const review = notification(
      "2",
      "PullRequest",
      "https://api.github.com/repos/sena-nana/LiliaGithub/pulls/19",
      { reason: "review_requested" },
    );
    const release = notification(
      "3",
      "Release",
      "https://api.github.com/repos/sena-nana/LiliaGithub/releases/42",
    );
    const workflow = notification(
      "4",
      "WorkflowRun",
      "https://api.github.com/repos/sena-nana/LiliaGithub/actions/runs/41",
    );

    expect(notificationCategory(review)).toBe("review");
    expect(notificationTarget(issue)).toEqual({
      kind: "internal",
      to: "/repos/github%3Asena-nana%2FLiliaGithub?projectTab=issues&issue=26",
    });
    expect(notificationTarget(review)).toEqual({
      kind: "internal",
      to: "/repos/github%3Asena-nana%2FLiliaGithub?projectTab=pulls&pr=19",
    });
    expect(notificationTarget(workflow)).toEqual({
      kind: "internal",
      to: "/repos/github%3Asena-nana%2FLiliaGithub?projectTab=actions&run=41",
    });
    expect(notificationTarget(release)).toEqual({
      kind: "external",
      url: "https://github.com/sena-nana/LiliaGithub/releases",
    });
  });

  it("分页、已读和取消订阅共享同一份本地状态", async () => {
    setNotificationFallbackForTests([
      notification("1", "Issue", "https://api.github.com/repos/sena-nana/LiliaGithub/issues/1"),
      notification("2", "Discussion", "https://api.github.com/repos/sena-nana/LiliaGithub/discussions/2"),
      notification("3", "WorkflowRun", "https://api.github.com/repos/sena-nana/LiliaGithub/actions/runs/3"),
    ]);

    const first = await listNotificationsFallback(false, 1, 2);
    const second = await listNotificationsFallback(false, 2, 2);
    expect(first.items.map((item) => item.id)).toEqual(["1", "2"]);
    expect(first.hasNextPage).toBe(true);
    expect(second.items.map((item) => item.id)).toEqual(["3"]);

    await markNotificationsReadFallback(["1", "2"]);
    expect((await listNotificationsFallback(false, 1, 10)).items.map((item) => item.id)).toEqual(["3"]);
    expect((await listNotificationsFallback(true, 1, 10)).items.filter((item) => !item.unread)).toHaveLength(2);

    await unsubscribeNotificationFallback("3");
    expect((await listNotificationsFallback(true, 1, 10)).items.map((item) => item.id)).toEqual(["1", "2"]);
  });
});

describe("通知收件箱", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({
      items: [
        notification("1", "Issue", "https://api.github.com/repos/sena-nana/LiliaGithub/issues/26"),
        notification("2", "WorkflowRun", "https://api.github.com/repos/sena-nana/LiliaGithub/actions/runs/9"),
      ],
      page: 1,
      hasNextPage: false,
    });
    api.markRead.mockResolvedValue({ succeededIds: ["1"], failures: [] });
    api.unsubscribe.mockResolvedValue(undefined);
  });

  it("按对象类型筛选并防止重复提交批量已读", async () => {
    const pending = deferred<GitHubNotificationMutationResult>();
    api.markRead.mockReturnValueOnce(pending.promise);
    await renderPage();
    expect(await screen.findByText("Issue 1")).toBeInTheDocument();
    expect(screen.getByText("WorkflowRun 2")).toBeInTheDocument();

    await fireEvent.update(screen.getByLabelText("类型"), "issue");
    expect(screen.getByText("Issue 1")).toBeInTheDocument();
    expect(screen.queryByText("WorkflowRun 2")).toBeNull();

    await fireEvent.click(screen.getByRole("checkbox", { name: "选择 Issue 1" }));
    const markButton = screen.getByRole("button", { name: /标记已读/ });
    await fireEvent.click(markButton);
    await waitFor(() => expect(markButton).toBeDisabled());
    await fireEvent.click(markButton);
    expect(api.markRead).toHaveBeenCalledTimes(1);

    pending.resolve({ succeededIds: ["1"], failures: [] });
    await waitFor(() => expect(screen.queryByText("Issue 1")).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent("已标记为已读");
  });

  it("打开可识别通知时标记已读并进入应用内对象", async () => {
    const router = await renderPage();
    const openButton = await screen.findByRole("button", { name: /Issue 1/ });
    await fireEvent.click(openButton);

    await waitFor(() => expect(api.markRead).toHaveBeenCalledWith(["1"]));
    await waitFor(() => expect(router.currentRoute.value.fullPath).toBe(
      "/repos/github%3Asena-nana%2FLiliaGithub?projectTab=issues&issue=26",
    ));
  });

  it("取消订阅成功后只移除目标通知", async () => {
    await renderPage();
    await screen.findByText("Issue 1");
    const row = screen.getByText("Issue 1").closest("li");
    expect(row).not.toBeNull();
    await fireEvent.click(row!.querySelector("[data-agent-id$='.unsubscribe']") as HTMLElement);

    await waitFor(() => expect(api.unsubscribe).toHaveBeenCalledWith("1"));
    expect(screen.queryByText("Issue 1")).toBeNull();
    expect(screen.getByText("WorkflowRun 2")).toBeInTheDocument();
  });
});

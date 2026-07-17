import type {
  GitHubNotification,
  GitHubNotificationMutationResult,
  GitHubNotificationPage,
} from "./types";

const agentDebugMock = typeof import.meta !== "undefined"
  && import.meta.env?.DEV === true
  && import.meta.env?.VITE_LILIA_GITHUB_AGENT_DEBUG_MOCK_WORKSPACE === "1";

function agentDebugNotifications(): GitHubNotification[] {
  return [
    {
      id: "agent-debug-mark-read",
      repoFullName: "sena-nana/LiliaGithub",
      title: "Agent debug workflow notification",
      reason: "subscribed",
      subjectType: "WorkflowRun",
      subjectUrl: "https://api.github.com/repos/sena-nana/LiliaGithub/actions/runs/41",
      latestCommentUrl: null,
      updatedAt: "2026-07-17T08:00:00Z",
      unread: true,
    },
    {
      id: "agent-debug-open-issue",
      repoFullName: "sena-nana/LiliaGithub",
      title: "Agent debug Issue #12",
      reason: "participating",
      subjectType: "Issue",
      subjectUrl: "https://api.github.com/repos/sena-nana/LiliaGithub/issues/12",
      latestCommentUrl: null,
      updatedAt: "2026-07-17T08:01:00Z",
      unread: true,
    },
  ];
}

let notifications: GitHubNotification[] = agentDebugMock ? agentDebugNotifications() : [];

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function listNotificationsFallback(
  all: boolean,
  page: number,
  perPage: number,
): Promise<GitHubNotificationPage> {
  const filtered = all ? notifications : notifications.filter((item) => item.unread);
  const start = (page - 1) * perPage;
  const items = filtered.slice(start, start + perPage);
  return Promise.resolve(clone({
    items,
    page,
    hasNextPage: start + items.length < filtered.length,
  }));
}

export function markNotificationsReadFallback(
  notificationIds: readonly string[],
): Promise<GitHubNotificationMutationResult> {
  const succeededIds = [...new Set(notificationIds)].filter((id) =>
    notifications.some((item) => item.id === id)
  );
  const succeeded = new Set(succeededIds);
  notifications = notifications.map((item) =>
    succeeded.has(item.id) ? { ...item, unread: false } : item
  );
  return Promise.resolve({ succeededIds, failures: [] });
}

export function unsubscribeNotificationFallback(notificationId: string): Promise<void> {
  notifications = notifications.filter((item) => item.id !== notificationId);
  return Promise.resolve();
}

export function notificationFallbackItems(perPage = 50) {
  return clone(notifications.slice(0, perPage));
}

export function setNotificationFallbackForTests(items: readonly GitHubNotification[]) {
  notifications = clone([...items]);
}

export function resetNotificationFallbackForTests() {
  notifications = [];
}

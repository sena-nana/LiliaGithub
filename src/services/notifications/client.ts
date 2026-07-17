import { createCachedAsyncModule } from "../../utils/asyncModule";
import { call } from "../workspace/client";
import type {
  GitHubNotificationListOptions,
  GitHubNotificationMutationResult,
  GitHubNotificationPage,
} from "./types";

const fallbackModule = createCachedAsyncModule(() => import("./fallback"));

export function listGitHubNotifications(
  options: GitHubNotificationListOptions = {},
): Promise<GitHubNotificationPage> {
  const all = options.all ?? false;
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const perPage = Math.min(100, Math.max(1, Math.trunc(options.perPage ?? 50)));
  return call(
    "github_list_notifications",
    {
      all,
      page,
      perPage,
      forceRefresh: options.forceRefresh ?? null,
    },
    async () => (await fallbackModule.load()).listNotificationsFallback(all, page, perPage),
  );
}

export function markGitHubNotificationsRead(
  notificationIds: readonly string[],
): Promise<GitHubNotificationMutationResult> {
  const ids = [...new Set(notificationIds.map((id) => id.trim()).filter(Boolean))];
  return call(
    "github_mark_notifications_read",
    { notificationIds: ids },
    async () => (await fallbackModule.load()).markNotificationsReadFallback(ids),
  );
}

export function unsubscribeGitHubNotification(notificationId: string): Promise<void> {
  const normalizedId = notificationId.trim();
  return call(
    "github_unsubscribe_notification",
    { notificationId: normalizedId },
    async () => (await fallbackModule.load()).unsubscribeNotificationFallback(normalizedId),
  );
}

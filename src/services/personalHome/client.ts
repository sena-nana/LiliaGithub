import { createCachedAsyncModule } from "../../utils/asyncModule";
import { call } from "../workspace/client";
import type { GitHubAccountIssueItem } from "../workspace/types";
import type { PersonalHomeNotification } from "./types";

const fallbackModule = createCachedAsyncModule(() => import("./fallback"));

export function listAssignedWork(
  perPage = 50,
  options: { forceRefresh?: boolean } = {},
): Promise<GitHubAccountIssueItem[]> {
  const args = { perPage, forceRefresh: options.forceRefresh ?? null };
  return call("github_list_assigned_work", args, async () =>
    (await fallbackModule.load()).listAssignedWork(perPage));
}

export function listPersonalNotifications(
  perPage = 50,
  options: { forceRefresh?: boolean } = {},
): Promise<PersonalHomeNotification[]> {
  const args = { perPage, forceRefresh: options.forceRefresh ?? null };
  return call("github_list_personal_notifications", args, async () =>
    (await fallbackModule.load()).listPersonalNotifications(perPage));
}

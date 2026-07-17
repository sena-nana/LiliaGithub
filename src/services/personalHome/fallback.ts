import type { GitHubAccountIssueItem } from "../workspace/types";
import type { PersonalHomeNotification } from "./types";
import {
  notificationFallbackItems,
  resetNotificationFallbackForTests,
  setNotificationFallbackForTests,
} from "../notifications/fallback";

let assignedWork: GitHubAccountIssueItem[] = [];

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function listAssignedWork(perPage = 50) {
  return Promise.resolve(clone(assignedWork.slice(0, perPage)));
}

export function listPersonalNotifications(perPage = 50) {
  return Promise.resolve(notificationFallbackItems(perPage));
}

export function setPersonalHomeFallbackForTests(values: {
  assignedWork?: GitHubAccountIssueItem[];
  notifications?: PersonalHomeNotification[];
}) {
  assignedWork = clone(values.assignedWork ?? []);
  setNotificationFallbackForTests(values.notifications ?? []);
}

export function resetPersonalHomeFallbackForTests() {
  assignedWork = [];
  resetNotificationFallbackForTests();
}

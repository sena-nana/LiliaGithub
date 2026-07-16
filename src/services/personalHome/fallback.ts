import type { GitHubAccountIssueItem } from "../workspace/types";
import type { PersonalHomeNotification } from "./types";

let assignedWork: GitHubAccountIssueItem[] = [];
let notifications: PersonalHomeNotification[] = [];

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function listAssignedWork(perPage = 50) {
  return Promise.resolve(clone(assignedWork.slice(0, perPage)));
}

export function listPersonalNotifications(perPage = 50) {
  return Promise.resolve(clone(notifications.slice(0, perPage)));
}

export function setPersonalHomeFallbackForTests(values: {
  assignedWork?: GitHubAccountIssueItem[];
  notifications?: PersonalHomeNotification[];
}) {
  assignedWork = clone(values.assignedWork ?? []);
  notifications = clone(values.notifications ?? []);
}

export function resetPersonalHomeFallbackForTests() {
  assignedWork = [];
  notifications = [];
}

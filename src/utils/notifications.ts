import type {
  GitHubNotification,
  GitHubNotificationCategory,
} from "../services/notifications";
import { remoteRepoId } from "./remoteRepo";
import { repoProjectRoute } from "./repoRoutes";

export type GitHubNotificationTarget =
  | { kind: "internal"; to: string }
  | { kind: "external"; url: string };

const categoryLabels: Record<GitHubNotificationCategory, string> = {
  issue: "Issue",
  pull_request: "Pull Request",
  review: "Review",
  discussion: "Discussion",
  actions: "Actions",
  other: "其他",
};

export function notificationCategory(notification: Pick<GitHubNotification, "reason" | "subjectType">) {
  const reason = notification.reason.toLocaleLowerCase();
  const type = notification.subjectType.toLocaleLowerCase();
  if (type.includes("review") || reason.includes("review")) return "review" as const;
  if (type.includes("pull")) return "pull_request" as const;
  if (type.includes("issue")) return "issue" as const;
  if (type.includes("discussion")) return "discussion" as const;
  if (type.includes("workflow") || type.includes("check") || reason === "ci_activity") return "actions" as const;
  return "other" as const;
}

export function notificationCategoryLabel(category: GitHubNotificationCategory) {
  return categoryLabels[category];
}

export function notificationTarget(notification: GitHubNotification): GitHubNotificationTarget {
  const internal = internalNotificationTarget(notification);
  if (internal) return { kind: "internal", to: internal };
  return { kind: "external", url: externalNotificationUrl(notification) };
}

function internalNotificationTarget(notification: GitHubNotification) {
  const url = parseUrl(notification.subjectUrl);
  if (!url) return null;
  const repoId = remoteRepoId(notification.repoFullName);
  const segments = url.pathname.split("/").filter(Boolean);
  const subjectIndex = findRepoSubjectIndex(segments, notification.repoFullName);
  if (subjectIndex < 0) return null;
  const subject = segments[subjectIndex]?.toLocaleLowerCase();
  if (subject === "actions" && segments[subjectIndex + 1] === "runs") {
    const runId = positiveInteger(segments[subjectIndex + 2]);
    return runId ? repoProjectRoute(repoId, "actions", runId) : null;
  }
  const identifier = positiveInteger(segments[subjectIndex + 1]);
  if (!identifier) return null;
  const category = notificationCategory(notification);
  if (subject === "issues" && category !== "pull_request" && category !== "review") {
    return repoProjectRoute(repoId, "issues", identifier);
  }
  if (subject === "pulls" || category === "pull_request" || category === "review") {
    return repoProjectRoute(repoId, "pulls", identifier);
  }
  if (subject === "discussions") {
    return repoProjectRoute(repoId, "discussions", identifier);
  }
  return null;
}

function externalNotificationUrl(notification: GitHubNotification) {
  const url = parseUrl(notification.subjectUrl);
  if (!url) return `https://github.com/${notification.repoFullName}`;
  if (url.hostname !== "api.github.com") return url.toString();
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "repos" || segments.length < 4) {
    return `https://github.com/${notification.repoFullName}`;
  }
  const [, owner, repo, ...subject] = segments;
  if (subject[0] === "pulls") subject[0] = "pull";
  if (subject[0] === "commits") subject[0] = "commit";
  if (subject[0] === "releases") return `https://github.com/${owner}/${repo}/releases`;
  if (subject[0] === "check-suites" || subject[0] === "check-runs") {
    return `https://github.com/${owner}/${repo}/actions`;
  }
  const supported = new Set(["issues", "pull", "discussions", "actions", "commit"]);
  if (!subject[0] || !supported.has(subject[0])) return `https://github.com/${owner}/${repo}`;
  return `https://github.com/${owner}/${repo}/${subject.join("/")}`;
}

function findRepoSubjectIndex(segments: string[], repoFullName: string) {
  const [owner, repo] = repoFullName.split("/");
  if (segments[0] !== "repos" || segments[1] !== owner || segments[2] !== repo) return -1;
  return 3;
}

function positiveInteger(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseUrl(value: string | null) {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

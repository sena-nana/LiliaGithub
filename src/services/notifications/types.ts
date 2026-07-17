export type GitHubNotificationCategory =
  | "issue"
  | "pull_request"
  | "review"
  | "discussion"
  | "actions"
  | "other";

export interface GitHubNotification {
  id: string;
  repoFullName: string;
  title: string;
  reason: string;
  subjectType: string;
  subjectUrl: string | null;
  latestCommentUrl: string | null;
  updatedAt: string;
  unread: boolean;
}

export interface GitHubNotificationPage {
  items: GitHubNotification[];
  page: number;
  hasNextPage: boolean;
}

export interface GitHubNotificationMutationFailure {
  notificationId: string;
  message: string;
}

export interface GitHubNotificationMutationResult {
  succeededIds: string[];
  failures: GitHubNotificationMutationFailure[];
}

export interface GitHubNotificationListOptions {
  all?: boolean;
  page?: number;
  perPage?: number;
  forceRefresh?: boolean;
}

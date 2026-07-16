export interface PersonalHomeNotification {
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

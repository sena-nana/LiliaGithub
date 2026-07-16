export type GitHubRepositoryDiscussionState = "open" | "closed" | "all";
export type GitHubRepositoryDiscussionSort = "created" | "updated";
export type GitHubRepositoryDiscussionDirection = "asc" | "desc";

export interface GitHubRepositoryDiscussionCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  emoji: string;
  isAnswerable: boolean;
}

export interface GitHubRepositoryDiscussionMetadata {
  enabled: boolean;
  categories: GitHubRepositoryDiscussionCategory[];
  creatableCategories: GitHubRepositoryDiscussionCategory[];
}

export interface GitHubCursorPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface GitHubRepositoryDiscussionPage {
  items: GitHubRepositoryDiscussionSummary[];
  pageInfo: GitHubCursorPageInfo;
  totalCount: number;
}

export interface GitHubRepositoryDiscussionAuthor {
  login: string;
  avatarUrl: string | null;
  url: string | null;
}

export interface GitHubRepositoryDiscussionSummary {
  id: string;
  number: number;
  title: string;
  author: GitHubRepositoryDiscussionAuthor | null;
  category: GitHubRepositoryDiscussionCategory;
  isAnswered: boolean;
  closed: boolean;
  locked: boolean;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface GitHubRepositoryDiscussion extends GitHubRepositoryDiscussionSummary {
  body: string;
  answerId: string | null;
}

export interface GitHubRepositoryDiscussionComment {
  id: string;
  author: GitHubRepositoryDiscussionAuthor | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  isAnswer: boolean;
  replyToId: string | null;
  replyCount: number;
}

export interface GitHubRepositoryDiscussionCommentPage {
  items: GitHubRepositoryDiscussionComment[];
  pageInfo: GitHubCursorPageInfo;
  totalCount: number;
}

export interface GitHubRepositoryDiscussionListOptions {
  first?: number | null;
  after?: string | null;
  categoryId?: string | null;
  answered?: boolean | null;
  state?: GitHubRepositoryDiscussionState | null;
  sort?: GitHubRepositoryDiscussionSort | null;
  direction?: GitHubRepositoryDiscussionDirection | null;
}

export interface GitHubRepositoryDiscussionPageOptions {
  first?: number | null;
  after?: string | null;
}

export interface GitHubCreateRepositoryDiscussionRequest {
  categoryId: string;
  title: string;
  body: string;
}

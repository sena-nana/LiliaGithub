import type {
  GitHubRepositoryDiscussionComment,
  GitHubCreateRepositoryDiscussionRequest,
  GitHubRepositoryDiscussion,
  GitHubRepositoryDiscussionListOptions,
  GitHubRepositoryDiscussionMetadata,
  GitHubRepositoryDiscussionPage,
  GitHubRepositoryDiscussionCommentPage,
  GitHubRepositoryDiscussionPageOptions,
} from "./types";

const categories = [
  { id: "general", name: "General", slug: "general", description: "常规讨论", emoji: "💬", isAnswerable: false },
  { id: "questions", name: "Q&A", slug: "q-and-a", description: "提问与解答", emoji: "❓", isAnswerable: true },
];

const discussions: GitHubRepositoryDiscussion[] = [{
  id: "discussion-1",
  number: 1,
  title: "欢迎来到 Discussions",
  body: "在这里讨论项目方向、问题和想法。",
  author: { login: "sena-nana", avatarUrl: "", url: "https://github.com/sena-nana" },
  category: categories[0],
  isAnswered: false,
  closed: false,
  locked: false,
  commentCount: 1,
  createdAt: "2026-06-24T09:58:15Z",
  updatedAt: "2026-06-24T09:58:15Z",
  url: "https://github.com/sena-nana/LiliaGithub/discussions/1",
  answerId: null,
}];

const comments = new Map<number, GitHubRepositoryDiscussionComment[]>([[1, [{
  id: "discussion-comment-1",
  author: { login: "sena-nana", avatarUrl: "", url: "https://github.com/sena-nana" },
  body: "欢迎参与讨论。",
  isAnswer: false,
  replyToId: null,
  replyCount: 1,
  createdAt: "2026-06-24T10:00:00Z",
  updatedAt: "2026-06-24T10:00:00Z",
  url: "https://github.com/sena-nana/LiliaGithub/discussions/1#discussioncomment-1",
}]]]);

const replies = new Map<string, GitHubRepositoryDiscussionComment[]>([["discussion-comment-1", [{
  id: "discussion-reply-1",
  author: { login: "octocat", avatarUrl: "", url: "https://github.com/octocat" },
  body: "收到。",
  createdAt: "2026-06-24T10:01:00Z",
  updatedAt: "2026-06-24T10:01:00Z",
  url: "https://github.com/sena-nana/LiliaGithub/discussions/1#discussioncomment-1",
  isAnswer: false,
  replyToId: "discussion-comment-1",
  replyCount: 0,
}]]]);

export async function getDiscussionMetadataFallback(): Promise<GitHubRepositoryDiscussionMetadata> {
  return clone({ enabled: true, categories, creatableCategories: categories });
}

export async function listDiscussionsFallback(
  options: GitHubRepositoryDiscussionListOptions = {},
): Promise<GitHubRepositoryDiscussionPage> {
  let items = discussions.filter((item) => {
    if (options.categoryId && item.category.id !== options.categoryId) return false;
    if (options.answered != null && item.isAnswered !== options.answered) return false;
    return !options.state || options.state === "all" || item.closed === (options.state === "closed");
  });
  const field = options.sort === "created" ? "createdAt" : "updatedAt";
  const direction = options.direction === "asc" ? 1 : -1;
  items = [...items].sort((left, right) => left[field].localeCompare(right[field]) * direction);
  return paginate(items, options.first, options.after);
}

export async function getDiscussionFallback(discussionNumber: number): Promise<GitHubRepositoryDiscussion> {
  const discussion = discussions.find((item) => item.number === discussionNumber);
  if (!discussion) throw new Error(`未找到 Discussion #${discussionNumber}`);
  return clone(discussion);
}

export async function listDiscussionCommentsFallback(
  discussionNumber: number,
  options: GitHubRepositoryDiscussionPageOptions = {},
): Promise<GitHubRepositoryDiscussionCommentPage> {
  return paginate(comments.get(discussionNumber) ?? [], options.first, options.after);
}

export async function listDiscussionCommentRepliesFallback(
  commentId: string,
  options: GitHubRepositoryDiscussionPageOptions = {},
): Promise<GitHubRepositoryDiscussionCommentPage> {
  return paginate(replies.get(commentId) ?? [], options.first, options.after);
}

export async function createDiscussionFallback(
  repoFullName: string,
  request: GitHubCreateRepositoryDiscussionRequest,
): Promise<GitHubRepositoryDiscussion> {
  const category = categories.find((item) => item.id === request.categoryId);
  if (!category) throw new Error("请选择可用的 Discussion 分类");
  const number = Math.max(0, ...discussions.map((item) => item.number)) + 1;
  const now = new Date().toISOString();
  const discussion: GitHubRepositoryDiscussion = {
    id: `discussion-${number}`,
    number,
    title: request.title.trim(),
    body: request.body,
    author: { login: "sena-nana", avatarUrl: "", url: "https://github.com/sena-nana" },
    category,
    isAnswered: false,
    closed: false,
    locked: false,
    commentCount: 0,
    createdAt: now,
    updatedAt: now,
    url: `https://github.com/${repoFullName}/discussions/${number}`,
    answerId: null,
  };
  discussions.unshift(discussion);
  comments.set(number, []);
  return clone(discussion);
}

function paginate<T>(items: readonly T[], first?: number | null, after?: string | null) {
  const start = cursorIndex(after);
  const size = Math.max(1, Math.trunc(first ?? 25));
  const pageItems = items.slice(start, start + size);
  const nextIndex = start + pageItems.length;
  return clone({
    items: pageItems,
    pageInfo: {
      hasNextPage: nextIndex < items.length,
      endCursor: nextIndex < items.length ? String(nextIndex) : null,
    },
    totalCount: items.length,
  });
}

function cursorIndex(cursor?: string | null) {
  const parsed = Number.parseInt(cursor ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

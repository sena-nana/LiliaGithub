import { ref } from "vue";
import { createLatestAsyncLoader } from "../../../composables/useLatestAsyncLoader";
import {
  getGitHubRepositoryDiscussion,
  listGitHubRepositoryDiscussionCommentReplies,
  listGitHubRepositoryDiscussionComments,
  createGitHubDiscussionComment,
  updateGitHubDiscussionComment,
  deleteGitHubDiscussionComment,
  updateGitHubDiscussionReaction,
  updateGitHubDiscussionState,
  updateGitHubDiscussionAnswer,
} from "../../../services/workspace/discussions/client";
import type {
  GitHubRepositoryDiscussion,
  GitHubRepositoryDiscussionComment,
} from "../../../services/workspace/discussions/types";

const COMMENT_PAGE_SIZE = 30;
const REPLY_PAGE_SIZE = 20;

export type DiscussionReplyState = {
  items: GitHubRepositoryDiscussionComment[];
  totalCount: number;
  endCursor: string | null;
  hasNextPage: boolean;
  loading: boolean;
  loaded: boolean;
  error: string | null;
};

export function useDiscussionDetail(repoFullName: string) {
  const detail = ref<GitHubRepositoryDiscussion | null>(null);
  const comments = ref<GitHubRepositoryDiscussionComment[]>([]);
  const commentsTotalCount = ref(0);
  const commentsEndCursor = ref<string | null>(null);
  const commentsHasNextPage = ref(false);
  const detailLoading = ref(false);
  const commentsLoading = ref(false);
  const commentsLoadingMore = ref(false);
  const detailError = ref<string | null>(null);
  const commentsError = ref<string | null>(null);
  const replyStates = ref<Record<string, DiscussionReplyState>>({});
  const mutationPending = ref<Record<string, boolean>>({});
  const mutationErrors = ref<Record<string, string | null>>({});
  const detailLoader = createLatestAsyncLoader({ trackSessionContext: false });
  const commentsLoader = createLatestAsyncLoader({ trackSessionContext: false });
  const replyLoaders = new Map<string, ReturnType<typeof createLatestAsyncLoader>>();

  async function loadDetail(discussionNumber: number, force = false) {
    if (!force && detail.value?.number === discussionNumber) return;
    await detailLoader.run(discussionNumber, async (runId) => {
      detailLoading.value = true;
      detailError.value = null;
      try {
        const next = await getGitHubRepositoryDiscussion(repoFullName, discussionNumber);
        if (detailLoader.isCurrent(runId)) detail.value = next;
      } catch (error) {
        if (detailLoader.isCurrent(runId)) detailError.value = readableError(error);
      } finally {
        if (detailLoader.isCurrent(runId)) detailLoading.value = false;
      }
    }, { reusePending: !force });
  }

  async function loadComments(discussionNumber: number, reset = true) {
    if (!reset && (!commentsHasNextPage.value || commentsLoadingMore.value)) return;
    const cursor = reset ? null : commentsEndCursor.value;
    await commentsLoader.run(`${discussionNumber}:${cursor ?? "first"}`, async (runId) => {
      if (reset) commentsLoading.value = true;
      else commentsLoadingMore.value = true;
      commentsError.value = null;
      try {
        const page = await listGitHubRepositoryDiscussionComments(repoFullName, discussionNumber, {
          first: COMMENT_PAGE_SIZE,
          after: cursor,
        });
        if (!commentsLoader.isCurrent(runId)) return;
        comments.value = reset ? dedupe(page.items) : dedupe([...comments.value, ...page.items]);
        commentsTotalCount.value = page.totalCount;
        commentsEndCursor.value = page.pageInfo.endCursor;
        commentsHasNextPage.value = page.pageInfo.hasNextPage;
        if (reset) replyStates.value = {};
      } catch (error) {
        if (commentsLoader.isCurrent(runId)) commentsError.value = readableError(error);
      } finally {
        if (commentsLoader.isCurrent(runId)) {
          commentsLoading.value = false;
          commentsLoadingMore.value = false;
        }
      }
    }, { reusePending: true });
  }

  async function open(discussionNumber: number, force = false) {
    if (detail.value?.number !== discussionNumber) clearDetail();
    await Promise.all([
      loadDetail(discussionNumber, force),
      loadComments(discussionNumber, true),
    ]);
  }

  async function loadReplies(commentId: string, reset = true) {
    const current = replyStates.value[commentId] ?? blankReplyState();
    if (!reset && (!current.hasNextPage || current.loading)) return;
    const loader = replyLoaders.get(commentId) ?? createLatestAsyncLoader({ trackSessionContext: false });
    replyLoaders.set(commentId, loader);
    const cursor = reset ? null : current.endCursor;
    updateReplyState(commentId, { ...current, loading: true, error: null });
    await loader.run(`${commentId}:${cursor ?? "first"}`, async (runId) => {
      try {
        const page = await listGitHubRepositoryDiscussionCommentReplies(repoFullName, commentId, {
          first: REPLY_PAGE_SIZE,
          after: cursor,
        });
        if (!loader.isCurrent(runId)) return;
        updateReplyState(commentId, {
          items: reset ? dedupe(page.items) : dedupe([...current.items, ...page.items]),
          totalCount: page.totalCount,
          endCursor: page.pageInfo.endCursor,
          hasNextPage: page.pageInfo.hasNextPage,
          loading: false,
          loaded: true,
          error: null,
        });
      } catch (error) {
        if (loader.isCurrent(runId)) {
          updateReplyState(commentId, { ...current, loading: false, error: readableError(error) });
        }
      }
    }, { reusePending: true });
  }

  function setCreatedDetail(created: GitHubRepositoryDiscussion) {
    clearDetail();
    detail.value = created;
  }

  async function createComment(body: string, replyToId: string | null = null) {
    const discussion = detail.value;
    if (!discussion) return null;
    const key = replyToId ? `reply:${replyToId}` : "create";
    return runMutation(key, async () => {
      const created = await createGitHubDiscussionComment({ discussionId: discussion.id, body, replyToId });
      if (replyToId) {
        const parent = comments.value.find((item) => item.id === replyToId);
        if (parent) Object.assign(parent, { replyCount: parent.replyCount + 1 });
        const state = replyStates.value[replyToId];
        if (state?.loaded) updateReplyState(replyToId, { ...state, items: dedupe([...state.items, created]), totalCount: state.totalCount + 1 });
      } else {
        comments.value = dedupe([...comments.value, created]);
        commentsTotalCount.value += 1;
        detail.value = { ...discussion, commentCount: discussion.commentCount + 1 };
      }
      return created;
    });
  }

  async function updateComment(commentId: string, body: string) {
    return runMutation(`edit:${commentId}`, async () => {
      const updated = await updateGitHubDiscussionComment({ commentId, body });
      replaceComment(updated);
      return updated;
    });
  }

  async function deleteComment(commentId: string) {
    return runMutation(`delete:${commentId}`, async () => {
      await deleteGitHubDiscussionComment(commentId);
      const topLevel = comments.value.some((item) => item.id === commentId);
      comments.value = comments.value.filter((item) => item.id !== commentId);
      if (topLevel) {
        commentsTotalCount.value = Math.max(0, commentsTotalCount.value - 1);
        if (detail.value) detail.value = { ...detail.value, commentCount: Math.max(0, detail.value.commentCount - 1) };
      }
      for (const [parentId, state] of Object.entries(replyStates.value)) {
        if (!state.items.some((item) => item.id === commentId)) continue;
        updateReplyState(parentId, { ...state, items: state.items.filter((item) => item.id !== commentId), totalCount: Math.max(0, state.totalCount - 1) });
        const parent = comments.value.find((item) => item.id === parentId);
        if (parent) Object.assign(parent, { replyCount: Math.max(0, parent.replyCount - 1) });
      }
    });
  }

  async function react(commentId: string, content: import("../../../services/workspace/discussions/types").GitHubDiscussionReactionContent, remove = false) {
    return runMutation(`reaction:${commentId}:${content}`, () => updateGitHubDiscussionReaction({ subjectId: commentId, content, remove }));
  }

  async function changeState(action: import("../../../services/workspace/discussions/types").GitHubDiscussionStateAction) {
    const discussion = detail.value;
    if (!discussion) return;
    await runMutation(`state:${action}`, async () => {
      await updateGitHubDiscussionState({ discussionId: discussion.id, action });
      if (detail.value) detail.value = { ...detail.value,
        closed: action === "close" ? true : action === "reopen" ? false : detail.value.closed,
        locked: action === "lock" ? true : action === "unlock" ? false : detail.value.locked,
      };
    });
  }

  async function setAnswer(commentId: string, mark: boolean) {
    await runMutation(`answer:${commentId}`, async () => {
      await updateGitHubDiscussionAnswer({ commentId, mark });
      comments.value = comments.value.map((item) => ({ ...item, isAnswer: item.id === commentId ? mark : mark ? false : item.isAnswer }));
      if (detail.value) detail.value = { ...detail.value, isAnswered: mark, answerId: mark ? commentId : null };
    });
  }

  function replaceComment(updated: GitHubRepositoryDiscussionComment) {
    comments.value = comments.value.map((item) => item.id === updated.id ? updated : item);
    for (const [parentId, state] of Object.entries(replyStates.value)) {
      if (state.items.some((item) => item.id === updated.id)) updateReplyState(parentId, { ...state, items: state.items.map((item) => item.id === updated.id ? updated : item) });
    }
  }

  async function runMutation<T>(key: string, task: () => Promise<T>): Promise<T | null> {
    if (mutationPending.value[key]) return null;
    mutationPending.value = { ...mutationPending.value, [key]: true };
    mutationErrors.value = { ...mutationErrors.value, [key]: null };
    try { return await task(); }
    catch (error) { mutationErrors.value = { ...mutationErrors.value, [key]: readableError(error) }; return null; }
    finally { mutationPending.value = { ...mutationPending.value, [key]: false }; }
  }

  function clearDetail() {
    detailLoader.invalidate();
    commentsLoader.invalidate();
    replyLoaders.forEach((loader) => loader.invalidate());
    detail.value = null;
    comments.value = [];
    commentsTotalCount.value = 0;
    commentsEndCursor.value = null;
    commentsHasNextPage.value = false;
    detailError.value = null;
    commentsError.value = null;
    replyStates.value = {};
    replyLoaders.clear();
    mutationPending.value = {};
    mutationErrors.value = {};
  }

  function updateReplyState(commentId: string, state: DiscussionReplyState) {
    replyStates.value = { ...replyStates.value, [commentId]: state };
  }

  function dispose() {
    clearDetail();
  }

  return {
    detail,
    comments,
    commentsTotalCount,
    commentsHasNextPage,
    detailLoading,
    commentsLoading,
    commentsLoadingMore,
    detailError,
    commentsError,
    replyStates,
    mutationPending,
    mutationErrors,
    open,
    loadDetail,
    loadComments,
    loadMoreComments: (discussionNumber: number) => loadComments(discussionNumber, false),
    loadReplies,
    loadMoreReplies: (commentId: string) => loadReplies(commentId, false),
    setCreatedDetail,
    createComment,
    updateComment,
    deleteComment,
    react,
    changeState,
    setAnswer,
    clearDetail,
    dispose,
  };
}

function blankReplyState(): DiscussionReplyState {
  return { items: [], totalCount: 0, endCursor: null, hasNextPage: false, loading: false, loaded: false, error: null };
}

function dedupe(items: readonly GitHubRepositoryDiscussionComment[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function readableError(error: unknown) {
  const text = String(error).replace(/^Error:\s*/, "");
  const lower = text.toLowerCase();
  if (lower.includes("forbidden") || lower.includes("permission") || lower.includes("scope") || lower.includes("403") || text.includes("权限") || text.includes("授权")) return `当前 GitHub 授权无权执行此操作，请重新绑定有写权限的账号后重试。（${text}）`;
  if (lower.includes("network") || lower.includes("timeout") || text.includes("连接失败") || text.includes("网络")) return `网络连接失败，草稿、分页和展开状态已保留，请检查网络后重试。（${text}）`;
  if (lower.includes("not found") || lower.includes("404") || text.includes("失效") || text.includes("不存在")) return `Discussion 或评论已失效，请刷新详情后重试。（${text}）`;
  if (text.includes("绑定已失效") || lower.includes("unauthorized")) return "GitHub 绑定已失效，请重新绑定后重试；草稿和当前阅读位置已保留。";
  return text;
}

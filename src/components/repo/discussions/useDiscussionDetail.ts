import { ref } from "vue";
import { createLatestAsyncLoader } from "../../../composables/useLatestAsyncLoader";
import {
  getGitHubRepositoryDiscussion,
  listGitHubRepositoryDiscussionCommentReplies,
  listGitHubRepositoryDiscussionComments,
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
    open,
    loadDetail,
    loadComments,
    loadMoreComments: (discussionNumber: number) => loadComments(discussionNumber, false),
    loadReplies,
    loadMoreReplies: (commentId: string) => loadReplies(commentId, false),
    setCreatedDetail,
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
  return String(error).replace(/^Error:\s*/, "");
}

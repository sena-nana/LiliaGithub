import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  repoDiscussionsStore,
  resetRepoDiscussionsStoresForTests,
} from "../src/components/repo/discussions/useRepoDiscussions";
import type {
  GitHubRepositoryDiscussion,
  GitHubRepositoryDiscussionComment,
  GitHubRepositoryDiscussionMetadata,
  GitHubRepositoryDiscussionSummary,
} from "../src/services/workspace/discussions/types";

const api = vi.hoisted(() => ({
  getMetadata: vi.fn(),
  listDiscussions: vi.fn(),
  getDiscussion: vi.fn(),
  listComments: vi.fn(),
  listReplies: vi.fn(),
  createDiscussion: vi.fn(),
}));

vi.mock("../src/services/workspace/discussions/client", () => ({
  getGitHubRepositoryDiscussionMetadata: api.getMetadata,
  listGitHubRepositoryDiscussions: api.listDiscussions,
  getGitHubRepositoryDiscussion: api.getDiscussion,
  listGitHubRepositoryDiscussionComments: api.listComments,
  listGitHubRepositoryDiscussionCommentReplies: api.listReplies,
  createGitHubRepositoryDiscussion: api.createDiscussion,
}));

const metadata: GitHubRepositoryDiscussionMetadata = {
  enabled: true,
  categories: [{
    id: "questions",
    name: "Q&A",
    slug: "q-and-a",
    description: "Questions",
    emoji: "❓",
    isAnswerable: true,
  }],
  creatableCategories: [],
};

function discussion(number: number, overrides: Partial<GitHubRepositoryDiscussion> = {}): GitHubRepositoryDiscussion {
  return {
    id: `discussion-${number}`,
    number,
    title: `Discussion ${number}`,
    body: `Body ${number}`,
    category: metadata.categories[0]!,
    author: { login: "sena", avatarUrl: null, url: null },
    commentCount: 0,
    isAnswered: false,
    closed: false,
    locked: false,
    createdAt: "2026-07-16T00:00:00Z",
    updatedAt: "2026-07-16T00:00:00Z",
    url: `https://github.com/acme/repo/discussions/${number}`,
    answerId: null,
    ...overrides,
  };
}

function summary(number: number): GitHubRepositoryDiscussionSummary {
  const { body: _body, answerId: _answerId, ...item } = discussion(number);
  return item;
}

function comment(id: string): GitHubRepositoryDiscussionComment {
  return {
    id,
    author: { login: "reader", avatarUrl: null, url: null },
    body: `Comment ${id}`,
    createdAt: "2026-07-16T00:00:00Z",
    updatedAt: "2026-07-16T00:00:00Z",
    url: `https://github.com/acme/repo/discussions/1#${id}`,
    isAnswer: false,
    replyToId: null,
    replyCount: 0,
  };
}

describe("repo discussions store", () => {
  beforeEach(() => {
    resetRepoDiscussionsStoresForTests();
    vi.clearAllMocks();
    api.getMetadata.mockResolvedValue(metadata);
  });

  it("loads cursor pages with the selected filters and deduplicates overlapping items", async () => {
    api.listDiscussions
      .mockResolvedValueOnce({
        items: [summary(3), summary(2)],
        pageInfo: { endCursor: "cursor-1", hasNextPage: true },
        totalCount: 3,
      })
      .mockResolvedValueOnce({
        items: [summary(2), summary(1)],
        pageInfo: { endCursor: null, hasNextPage: false },
        totalCount: 3,
      });

    const store = repoDiscussionsStore("acme/repo");
    await store.list.ensureLoaded();
    await store.list.loadMore();

    expect(api.listDiscussions).toHaveBeenNthCalledWith(1, "acme/repo", {
      first: 25,
      after: null,
      categoryId: null,
      answered: null,
      state: "open",
      sort: "updated",
      direction: "desc",
    });
    expect(api.listDiscussions).toHaveBeenNthCalledWith(2, "acme/repo", expect.objectContaining({
      first: 25,
      after: "cursor-1",
    }));
    expect(store.list.items.value.map((item) => item.id)).toEqual([
      "discussion-3",
      "discussion-2",
      "discussion-1",
    ]);
    expect(store.list.hasNextPage.value).toBe(false);
  });

  it("loads comment and reply cursors without duplicating overlapping nodes", async () => {
    api.getDiscussion.mockResolvedValue(discussion(1));
    api.listComments
      .mockResolvedValueOnce({
        items: [comment("comment-1")],
        pageInfo: { endCursor: "comments-next", hasNextPage: true },
        totalCount: 2,
      })
      .mockResolvedValueOnce({
        items: [comment("comment-1"), comment("comment-2")],
        pageInfo: { endCursor: null, hasNextPage: false },
        totalCount: 2,
      });
    api.listReplies
      .mockResolvedValueOnce({
        items: [comment("reply-1")],
        pageInfo: { endCursor: "replies-next", hasNextPage: true },
        totalCount: 2,
      })
      .mockResolvedValueOnce({
        items: [comment("reply-1"), comment("reply-2")],
        pageInfo: { endCursor: null, hasNextPage: false },
        totalCount: 2,
      });

    const store = repoDiscussionsStore("acme/repo");
    await store.detail.open(1);
    await store.detail.loadMoreComments(1);
    await store.detail.loadReplies("comment-1");
    await store.detail.loadMoreReplies("comment-1");

    expect(api.listComments).toHaveBeenNthCalledWith(2, "acme/repo", 1, {
      first: 30,
      after: "comments-next",
    });
    expect(store.detail.comments.value.map((item) => item.id)).toEqual(["comment-1", "comment-2"]);
    expect(api.listReplies).toHaveBeenNthCalledWith(2, "acme/repo", "comment-1", {
      first: 20,
      after: "replies-next",
    });
    expect(store.detail.replyStates.value["comment-1"]?.items.map((item) => item.id)).toEqual([
      "reply-1",
      "reply-2",
    ]);
  });

  it("creates with the prepared category, trims the title, and selects the created detail", async () => {
    const creatableMetadata = { ...metadata, creatableCategories: metadata.categories };
    api.getMetadata.mockResolvedValue(creatableMetadata);
    api.listDiscussions.mockResolvedValue({
      items: [],
      pageInfo: { endCursor: null, hasNextPage: false },
      totalCount: 0,
    });
    const created = discussion(8, { title: "New topic", body: "Body" });
    api.createDiscussion.mockResolvedValue(created);

    const store = repoDiscussionsStore("acme/repo");
    await store.list.ensureLoaded();
    store.create.prepare();
    store.create.draft.title = "  New topic  ";
    store.create.draft.body = "Body";
    const result = await store.createDiscussion();

    expect(api.createDiscussion).toHaveBeenCalledWith("acme/repo", {
      categoryId: "questions",
      title: "New topic",
      body: "Body",
    });
    expect(result).toEqual(created);
    expect(store.list.items.value[0]?.id).toBe("discussion-8");
    expect(store.detail.detail.value).toEqual(created);
    expect(store.create.draft.title).toBe("");
  });
});

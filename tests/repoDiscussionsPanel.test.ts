import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepoDiscussionsPanel from "../src/components/repo/discussions/RepoDiscussionsPanel.vue";
import { resetRepoDiscussionsStoresForTests } from "../src/components/repo/discussions/useRepoDiscussions";
import type {
  GitHubRepositoryDiscussion,
  GitHubRepositoryDiscussionComment,
  GitHubRepositoryDiscussionMetadata,
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

function detail(): GitHubRepositoryDiscussion {
  return {
    id: "discussion-12",
    number: 12,
    title: "Rendered discussion",
    body: "## Safe Markdown\n\n**Rendered body**\n\n<script>window.bad = true</script>",
    category: metadata.categories[0]!,
    author: { login: "author", avatarUrl: null, url: null },
    commentCount: 1,
    isAnswered: false,
    closed: false,
    locked: false,
    createdAt: "2026-07-16T00:00:00Z",
    updatedAt: "2026-07-16T00:00:00Z",
    url: "https://github.com/acme/repo/discussions/12",
    answerId: null,
  };
}

function comment(id: string, body: string, replyCount = 0): GitHubRepositoryDiscussionComment {
  return {
    id,
    body,
    author: { login: "commenter", avatarUrl: null, url: null },
    createdAt: "2026-07-16T00:00:00Z",
    updatedAt: "2026-07-16T00:00:00Z",
    url: `https://github.com/acme/repo/discussions/12#${id}`,
    isAnswer: false,
    replyToId: null,
    replyCount,
  };
}

describe("RepoDiscussionsPanel", () => {
  beforeEach(() => {
    resetRepoDiscussionsStoresForTests();
    vi.clearAllMocks();
    api.getMetadata.mockResolvedValue(metadata);
    api.listDiscussions.mockResolvedValue({
      items: [{ ...detail(), body: undefined, answerId: undefined }],
      pageInfo: { endCursor: null, hasNextPage: false },
      totalCount: 1,
    });
    api.getDiscussion.mockResolvedValue(detail());
    api.listComments.mockResolvedValue({
      items: [comment("comment-1", "Comment with `code`", 1)],
      pageInfo: { endCursor: null, hasNextPage: false },
      totalCount: 1,
    });
  });

  it("navigates from list to detail and renders bodies, comments and retryable replies as Markdown", async () => {
    api.listReplies
      .mockRejectedValueOnce(new Error("reply failed"))
      .mockResolvedValueOnce({
        items: [comment("reply-1", "Reply with **bold**")],
        pageInfo: { endCursor: null, hasNextPage: false },
        totalCount: 1,
      });
    const view = render(RepoDiscussionsPanel, {
      props: {
        repoFullName: "acme/repo",
        focusedDiscussionNumber: null,
        createView: false,
      },
    });

    await fireEvent.click(await screen.findByRole("button", { name: /Rendered discussion/ }));
    expect(view.emitted("focus")).toEqual([[12]]);
    await view.rerender({ focusedDiscussionNumber: 12 });

    expect(await screen.findByRole("heading", { name: "Safe Markdown" })).toBeInTheDocument();
    expect(screen.getByText("Rendered body").tagName).toBe("STRONG");
    expect(view.container.querySelector("script")).toBeNull();
    expect(screen.getByText("code").tagName).toBe("CODE");

    await fireEvent.click(screen.getByRole("button", { name: "查看 1 条回复" }));
    expect(await screen.findByText("reply failed")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "重试读取回复" }));
    expect(await screen.findByText("bold")).toHaveProperty("tagName", "STRONG");
    expect(api.listReplies).toHaveBeenCalledTimes(2);

    await fireEvent.click(screen.getByRole("button", { name: "Discussions" }));
    expect(view.emitted("back")).toEqual([[]]);
  });

  it("submits a real create request and emits the created discussion number", async () => {
    const creatable = { ...metadata, creatableCategories: metadata.categories };
    api.getMetadata.mockResolvedValue(creatable);
    api.createDiscussion.mockResolvedValue(detail());
    const view = render(RepoDiscussionsPanel, {
      props: {
        repoFullName: "acme/repo",
        focusedDiscussionNumber: null,
        createView: true,
      },
    });

    await fireEvent.update(await screen.findByRole("textbox", { name: "标题" }), "  Rendered discussion  ");
    await fireEvent.update(screen.getByRole("textbox", { name: "正文" }), "Created body");
    await waitFor(() => expect(screen.getByRole("button", { name: "创建 Discussion" })).toBeEnabled());
    await fireEvent.click(screen.getByRole("button", { name: "创建 Discussion" }));

    await waitFor(() => expect(api.createDiscussion).toHaveBeenCalledWith("acme/repo", {
      categoryId: "questions",
      title: "Rendered discussion",
      body: "Created body",
    }));
    await waitFor(() => expect(view.emitted("created")).toEqual([[12]]));
  });

  it("only offers answer selection for answerable discussion categories", async () => {
    const category = { ...metadata.categories[0]!, isAnswerable: false };
    api.getDiscussion.mockResolvedValue({ ...detail(), category });
    const view = render(RepoDiscussionsPanel, {
      props: {
        repoFullName: "acme/repo",
        focusedDiscussionNumber: null,
        createView: false,
      },
    });

    await fireEvent.click(await screen.findByRole("button", { name: /Rendered discussion/ }));
    await view.rerender({ focusedDiscussionNumber: 12 });
    await screen.findByRole("heading", { name: "Safe Markdown" });

    expect(screen.queryByRole("button", { name: "采纳答案" })).toBeNull();
  });
});

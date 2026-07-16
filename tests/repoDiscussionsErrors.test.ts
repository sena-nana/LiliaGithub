import { fireEvent, render, screen } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepoDiscussionsPanel from "../src/components/repo/discussions/RepoDiscussionsPanel.vue";
import { resetRepoDiscussionsStoresForTests } from "../src/components/repo/discussions/useRepoDiscussions";

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

const category = {
  id: "general",
  name: "General",
  slug: "general",
  description: null,
  emoji: "💬",
  isAnswerable: false,
};
const metadata = { enabled: true, categories: [category], creatableCategories: [category] };
const detail = {
  id: "discussion-2",
  number: 2,
  title: "Recovered detail",
  body: "Recovered body",
  category,
  author: null,
  commentCount: 0,
  isAnswered: false,
  closed: false,
  locked: false,
  createdAt: "2026-07-16T00:00:00Z",
  updatedAt: "2026-07-16T00:00:00Z",
  url: "https://github.com/acme/repo/discussions/2",
  answerId: null,
};
const emptyPage = { items: [], pageInfo: { endCursor: null, hasNextPage: false }, totalCount: 0 };

describe("RepoDiscussionsPanel recoverable errors", () => {
  beforeEach(() => {
    resetRepoDiscussionsStoresForTests();
    vi.clearAllMocks();
    api.listDiscussions.mockResolvedValue(emptyPage);
    api.listComments.mockResolvedValue(emptyPage);
  });

  it("retries metadata loading from an actionable error state", async () => {
    api.getMetadata.mockRejectedValueOnce(new Error("metadata unavailable")).mockResolvedValueOnce(metadata);
    render(RepoDiscussionsPanel, {
      props: { repoFullName: "acme/repo", focusedDiscussionNumber: null, createView: false },
    });

    expect(await screen.findByText("metadata unavailable")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("没有匹配的 Discussion。")).toBeInTheDocument();
    expect(api.getMetadata).toHaveBeenCalledTimes(2);
  });

  it("lets a failed deep link return to the list or retry the detail", async () => {
    api.getMetadata.mockResolvedValue(metadata);
    api.getDiscussion.mockRejectedValueOnce(new Error("detail unavailable")).mockResolvedValueOnce(detail);
    const view = render(RepoDiscussionsPanel, {
      props: { repoFullName: "acme/repo", focusedDiscussionNumber: 2, createView: false },
    });

    expect(await screen.findByText("detail unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回列表" })).toHaveAttribute(
      "data-agent-id",
      "repo.discussions.detail.error-back",
    );
    await fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("heading", { name: "#2 Recovered detail" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Discussions" }));
    expect(view.emitted("back")).toEqual([[]]);
  });
});

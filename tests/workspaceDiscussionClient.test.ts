import { describe, expect, it, vi } from "vitest";
import type { WorkspaceCommandName } from "../src/services/workspace/contracts";
import {
  createGitHubRepositoryDiscussion,
  getGitHubRepositoryDiscussion,
  getGitHubRepositoryDiscussionMetadata,
  listGitHubRepositoryDiscussionCommentReplies,
  listGitHubRepositoryDiscussionComments,
  listGitHubRepositoryDiscussions,
} from "../src/services/workspace/discussions/client";

const call = vi.hoisted(() => vi.fn());

vi.mock("../src/services/workspace/client", () => ({ call }));

describe("workspace discussions client", () => {
  it("uses the registered commands and preserves nullable cursor/filter arguments", async () => {
    call.mockResolvedValue({});

    await getGitHubRepositoryDiscussionMetadata("acme/repo");
    await listGitHubRepositoryDiscussions("acme/repo", {
      first: 10,
      after: "next",
      categoryId: "questions",
      answered: false,
      state: "all",
      sort: "created",
      direction: "asc",
    });
    await getGitHubRepositoryDiscussion("acme/repo", 7);
    await listGitHubRepositoryDiscussionComments("acme/repo", 7, { first: 5, after: "comments" });
    await listGitHubRepositoryDiscussionCommentReplies("acme/repo", "comment-id", { first: 4 });
    await createGitHubRepositoryDiscussion("acme/repo", {
      categoryId: "questions",
      title: "Question",
      body: "Body",
    });

    const commands = call.mock.calls.map(([command]) => command as WorkspaceCommandName);
    expect(commands).toEqual([
      "github_get_discussion_metadata",
      "github_list_discussions",
      "github_get_discussion",
      "github_list_discussion_comments",
      "github_list_discussion_comment_replies",
      "github_create_discussion",
    ]);
    expect(call.mock.calls[1]?.[1]).toEqual({
      repoFullName: "acme/repo",
      first: 10,
      after: "next",
      categoryId: "questions",
      answered: false,
      state: "all",
      sort: "created",
      direction: "asc",
    });
    expect(call.mock.calls[4]?.[1]).toEqual({
      repoFullName: "acme/repo",
      commentId: "comment-id",
      first: 4,
      after: null,
    });
    expect(call.mock.calls[5]?.[1]).toEqual({
      repoFullName: "acme/repo",
      request: { categoryId: "questions", title: "Question", body: "Body" },
    });
  });
});

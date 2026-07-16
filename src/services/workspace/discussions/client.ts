import { call as callWorkspaceCommand } from "../client";
import { createCachedAsyncModule } from "../../../utils/asyncModule";
import type {
  GitHubCreateRepositoryDiscussionRequest,
  GitHubRepositoryDiscussion,
  GitHubRepositoryDiscussionListOptions,
  GitHubRepositoryDiscussionMetadata,
  GitHubRepositoryDiscussionPage,
  GitHubRepositoryDiscussionCommentPage,
  GitHubRepositoryDiscussionPageOptions,
} from "./types";

const fallbackModule = createCachedAsyncModule(() => import("./fallback"));

export function getGitHubRepositoryDiscussionMetadata(
  repoFullName: string,
): Promise<GitHubRepositoryDiscussionMetadata> {
  return callWorkspaceCommand(
    "github_get_discussion_metadata",
    { repoFullName },
    async () => (await fallbackModule.load()).getDiscussionMetadataFallback(),
  );
}

export function listGitHubRepositoryDiscussions(
  repoFullName: string,
  options: GitHubRepositoryDiscussionListOptions = {},
): Promise<GitHubRepositoryDiscussionPage> {
  const args = {
    repoFullName,
    first: options.first ?? null,
    after: options.after ?? null,
    categoryId: options.categoryId ?? null,
    answered: options.answered ?? null,
    state: options.state ?? null,
    sort: options.sort ?? null,
    direction: options.direction ?? null,
  };
  return callWorkspaceCommand(
    "github_list_discussions",
    args,
    async () => (await fallbackModule.load()).listDiscussionsFallback(options),
  );
}

export function getGitHubRepositoryDiscussion(
  repoFullName: string,
  discussionNumber: number,
): Promise<GitHubRepositoryDiscussion> {
  return callWorkspaceCommand(
    "github_get_discussion",
    { repoFullName, discussionNumber },
    async () => (await fallbackModule.load()).getDiscussionFallback(discussionNumber),
  );
}

export function listGitHubRepositoryDiscussionComments(
  repoFullName: string,
  discussionNumber: number,
  options: GitHubRepositoryDiscussionPageOptions = {},
): Promise<GitHubRepositoryDiscussionCommentPage> {
  return callWorkspaceCommand(
    "github_list_discussion_comments",
    { repoFullName, discussionNumber, first: options.first ?? null, after: options.after ?? null },
    async () => (await fallbackModule.load()).listDiscussionCommentsFallback(discussionNumber, options),
  );
}

export function listGitHubRepositoryDiscussionCommentReplies(
  repoFullName: string,
  commentId: string,
  options: GitHubRepositoryDiscussionPageOptions = {},
): Promise<GitHubRepositoryDiscussionCommentPage> {
  return callWorkspaceCommand(
    "github_list_discussion_comment_replies",
    { repoFullName, commentId, first: options.first ?? null, after: options.after ?? null },
    async () => (await fallbackModule.load()).listDiscussionCommentRepliesFallback(commentId, options),
  );
}

export function createGitHubRepositoryDiscussion(
  repoFullName: string,
  request: GitHubCreateRepositoryDiscussionRequest,
): Promise<GitHubRepositoryDiscussion> {
  return callWorkspaceCommand(
    "github_create_discussion",
    { repoFullName, request },
    async () => (await fallbackModule.load()).createDiscussionFallback(repoFullName, request),
  );
}

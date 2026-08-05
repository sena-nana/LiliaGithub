import type { WorkspaceClient } from "../client";
import type {
  GitHubCreateRepositoryDiscussionRequest,
  GitHubRepositoryDiscussion,
  GitHubRepositoryDiscussionListOptions,
  GitHubRepositoryDiscussionMetadata,
  GitHubRepositoryDiscussionPage,
  GitHubRepositoryDiscussionCommentPage,
  GitHubRepositoryDiscussionPageOptions,
  GitHubCreateDiscussionCommentRequest,
  GitHubUpdateDiscussionCommentRequest,
  GitHubDiscussionReactionRequest,
  GitHubDiscussionStateRequest,
  GitHubDiscussionAnswerRequest,
  GitHubRepositoryDiscussionComment,
} from "./types";

export function getGitHubRepositoryDiscussionMetadata(
  client: WorkspaceClient,
  repoFullName: string,
): Promise<GitHubRepositoryDiscussionMetadata> {
  return client.call(
    "github_get_discussion_metadata",
    { repoFullName },
  );
}

export function listGitHubRepositoryDiscussions(
  client: WorkspaceClient,
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
  return client.call(
    "github_list_discussions",
    args,
  );
}

export function getGitHubRepositoryDiscussion(
  client: WorkspaceClient,
  repoFullName: string,
  discussionNumber: number,
): Promise<GitHubRepositoryDiscussion> {
  return client.call(
    "github_get_discussion",
    { repoFullName, discussionNumber },
  );
}

export function listGitHubRepositoryDiscussionComments(
  client: WorkspaceClient,
  repoFullName: string,
  discussionNumber: number,
  options: GitHubRepositoryDiscussionPageOptions = {},
): Promise<GitHubRepositoryDiscussionCommentPage> {
  return client.call(
    "github_list_discussion_comments",
    { repoFullName, discussionNumber, first: options.first ?? null, after: options.after ?? null },
  );
}

export function listGitHubRepositoryDiscussionCommentReplies(
  client: WorkspaceClient,
  repoFullName: string,
  commentId: string,
  options: GitHubRepositoryDiscussionPageOptions = {},
): Promise<GitHubRepositoryDiscussionCommentPage> {
  return client.call(
    "github_list_discussion_comment_replies",
    { repoFullName, commentId, first: options.first ?? null, after: options.after ?? null },
  );
}

export function createGitHubRepositoryDiscussion(
  client: WorkspaceClient,
  repoFullName: string,
  request: GitHubCreateRepositoryDiscussionRequest,
): Promise<GitHubRepositoryDiscussion> {
  return client.call(
    "github_create_discussion",
    { repoFullName, request },
  );
}

export function createGitHubDiscussionComment(client: WorkspaceClient, request: GitHubCreateDiscussionCommentRequest): Promise<GitHubRepositoryDiscussionComment> {
  return client.call("github_create_discussion_comment", { request });
}

export function updateGitHubDiscussionComment(client: WorkspaceClient, request: GitHubUpdateDiscussionCommentRequest): Promise<GitHubRepositoryDiscussionComment> {
  return client.call("github_update_discussion_comment", { request });
}

export function deleteGitHubDiscussionComment(client: WorkspaceClient, commentId: string): Promise<void> {
  return client.call("github_delete_discussion_comment", { commentId });
}

export function updateGitHubDiscussionReaction(client: WorkspaceClient, request: GitHubDiscussionReactionRequest): Promise<void> {
  return client.call("github_update_discussion_reaction", { request });
}

export function updateGitHubDiscussionState(client: WorkspaceClient, request: GitHubDiscussionStateRequest): Promise<void> {
  return client.call("github_update_discussion_state", { request });
}

export function updateGitHubDiscussionAnswer(client: WorkspaceClient, request: GitHubDiscussionAnswerRequest): Promise<void> {
  return client.call("github_update_discussion_answer", { request });
}

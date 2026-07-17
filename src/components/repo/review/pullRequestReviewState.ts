import type { PullRequestReview } from "../../../services/codeReview";

export function latestPullRequestReviews(
  reviews: readonly PullRequestReview[],
): PullRequestReview[] {
  const latest = new Map<string, PullRequestReview>();
  for (const review of reviews) {
    latest.set(review.author.toLocaleLowerCase(), review);
  }
  return [...latest.values()];
}

export function activeRequestedChanges(
  reviews: readonly PullRequestReview[],
): PullRequestReview[] {
  const active = new Map<string, PullRequestReview>();
  for (const review of reviews) {
    const author = review.author.toLocaleLowerCase();
    const state = review.state.toLocaleUpperCase();
    if (state === "CHANGES_REQUESTED") active.set(author, review);
    else if (state === "APPROVED" || state === "DISMISSED") active.delete(author);
  }
  return [...active.values()];
}

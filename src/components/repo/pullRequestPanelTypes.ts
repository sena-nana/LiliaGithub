export type PullRequestState = "open" | "closed" | "merged";
export type PullRequestSort = "number" | "created" | "updated" | "comments";
export type PullRequestDirection = "asc" | "desc";
export type PullRequestReview = "none" | "required" | "approved" | "changes_requested" | null;

export type PullRequestPanelFilters = {
  creator: string | null;
  assignee: string | null;
  labels: string[];
  milestone: string | number | null;
  project: string | null;
  review: PullRequestReview;
  sort: PullRequestSort;
  direction: PullRequestDirection;
  query: string;
};

export function blankPullRequestPanelFilters(): PullRequestPanelFilters {
  return {
    creator: null,
    assignee: null,
    labels: [],
    milestone: null,
    project: null,
    review: null,
    sort: "number",
    direction: "desc",
    query: "",
  };
}

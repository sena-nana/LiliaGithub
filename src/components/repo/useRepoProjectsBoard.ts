import { computed, type Ref } from "vue";
import type {
  GitHubIssue,
  GitHubIssueProjectItem,
  GitHubPullRequest,
} from "../../services/workspace/types";

export type RepoProjectsBoardItemKind = "issue" | "pull";
export type RepoProjectsBoardTypeFilter = "all" | RepoProjectsBoardItemKind;
export type RepoProjectsBoardStateFilter = "open" | "closed" | "all";
export type RepoProjectsBoardProjectFilter = string;
export type RepoProjectsBoardItem = {
  key: string;
  kind: RepoProjectsBoardItemKind;
  number: number;
  title: string;
  state: string;
  merged: boolean;
  draft: boolean;
  author: string;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  projectItems: GitHubIssueProjectItem[];
  updatedAt: string;
  searchText: string;
  issue?: GitHubIssue;
  pull?: GitHubPullRequest;
};

type SourceRef<T> = Readonly<Ref<T>>;

export const ALL_PROJECTS_ID = "__all_projects__";
export const NO_PROJECT_ID = "__no_project__";

export function useRepoProjectsBoard(input: {
  issues: SourceRef<readonly GitHubIssue[]>;
  pulls: SourceRef<readonly GitHubPullRequest[]>;
  projects: SourceRef<readonly GitHubIssueProjectItem[]>;
  typeFilter: SourceRef<RepoProjectsBoardTypeFilter>;
  stateFilter: SourceRef<RepoProjectsBoardStateFilter>;
  projectFilter: SourceRef<RepoProjectsBoardProjectFilter>;
  query: SourceRef<string>;
}) {
  const allItems = computed<RepoProjectsBoardItem[]>(() => [
    ...input.issues.value.map((issue) => boardIssue(issue)),
    ...input.pulls.value.map((pull) => boardPull(pull)),
  ].sort((left, right) => dateValue(right.updatedAt) - dateValue(left.updatedAt)));

  const projects = computed(() => {
    const byId = new Map<string, GitHubIssueProjectItem>();
    for (const project of input.projects.value) byId.set(project.id, project);
    for (const item of allItems.value) {
      for (const project of item.projectItems) byId.set(project.id, project);
    }
    return [...byId.values()].sort((left, right) => left.title.localeCompare(right.title));
  });

  const baseFilteredItems = computed(() => {
    const needle = input.query.value.trim().toLowerCase();
    return allItems.value.filter((item) => {
      if (input.typeFilter.value !== "all" && item.kind !== input.typeFilter.value) return false;
      if (input.stateFilter.value === "open" && !isOpenRepoProjectsBoardItem(item)) return false;
      if (input.stateFilter.value === "closed" && isOpenRepoProjectsBoardItem(item)) return false;
      return !needle || item.searchText.includes(needle);
    });
  });

  const visibleItems = computed(() =>
    baseFilteredItems.value.filter((item) => projectMatches(item, input.projectFilter.value))
  );

  const projectFilterOptions = computed(() => {
    const options = projects.value.map((project) => ({
      id: project.id,
      title: project.title,
      count: projectCount(project.id),
    }));
    const unassignedCount = projectCount(NO_PROJECT_ID);
    if (unassignedCount || !options.length) {
      options.push({ id: NO_PROJECT_ID, title: "No project", count: unassignedCount });
    }
    return options;
  });

  const issueCount = computed(() => visibleItems.value.filter((item) => item.kind === "issue").length);
  const pullCount = computed(() => visibleItems.value.filter((item) => item.kind === "pull").length);
  const projectCountTotal = computed(() => projects.value.length);

  function projectCount(projectId: RepoProjectsBoardProjectFilter) {
    return baseFilteredItems.value.filter((item) => projectMatches(item, projectId)).length;
  }

  return {
    baseFilteredItems,
    issueCount,
    projectCountTotal,
    projectFilterOptions,
    pullCount,
    visibleItems,
  };
}

export function isOpenRepoProjectsBoardItem(item: RepoProjectsBoardItem) {
  return item.kind === "pull" ? item.state === "open" && !item.merged : item.state === "open";
}

export function repoProjectsBoardItemStateText(item: RepoProjectsBoardItem) {
  if (item.merged) return "merged";
  if (item.draft) return "draft";
  return item.state;
}

function boardIssue(issue: GitHubIssue): RepoProjectsBoardItem {
  const projectItems = issue.projectItems ?? [];
  return {
    key: `issue:${issue.number}`,
    kind: "issue",
    number: issue.number,
    title: issue.title,
    state: issue.state,
    merged: false,
    draft: false,
    author: issue.author ?? "",
    labels: issue.labels ?? [],
    assignees: issue.assignees ?? [],
    milestone: issue.milestone?.title ?? null,
    projectItems,
    updatedAt: issue.updatedAt,
    searchText: searchText([
      issue.title,
      issue.author,
      issue.state,
      issue.milestone?.title,
      ...(issue.labels ?? []),
      ...(issue.assignees ?? []),
      ...projectItems.map((project) => project.title),
    ]),
    issue,
  };
}

function boardPull(pull: GitHubPullRequest): RepoProjectsBoardItem {
  const projectItems = pull.projectItems ?? [];
  return {
    key: `pull:${pull.number}`,
    kind: "pull",
    number: pull.number,
    title: pull.title,
    state: pull.state,
    merged: pull.merged,
    draft: pull.draft,
    author: pull.author,
    labels: pull.labels ?? [],
    assignees: pull.assignees ?? [],
    milestone: pull.milestone?.title ?? null,
    projectItems,
    updatedAt: pull.updatedAt,
    searchText: searchText([
      pull.title,
      pull.author,
      pull.state,
      pull.baseBranch,
      pull.headBranch,
      pull.milestone?.title,
      ...(pull.labels ?? []),
      ...(pull.assignees ?? []),
      ...projectItems.map((project) => project.title),
    ]),
    pull,
  };
}

function projectMatches(item: RepoProjectsBoardItem, projectId: RepoProjectsBoardProjectFilter) {
  if (projectId === ALL_PROJECTS_ID) return true;
  if (projectId === NO_PROJECT_ID) return item.projectItems.length === 0;
  return item.projectItems.some((project) => project.id === projectId);
}

function searchText(parts: readonly (string | null | undefined)[]) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function dateValue(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

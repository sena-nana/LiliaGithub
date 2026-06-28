import { computed, type Ref } from "vue";
import type {
  GitHubIssue,
  GitHubIssueMilestone,
  GitHubPullRequest,
} from "../../services/workspace/types";

export type RepoMilestonesBoardItemKind = "issue" | "pull";
export type RepoMilestonesBoardTypeFilter = "all" | RepoMilestonesBoardItemKind;
export type RepoMilestonesBoardStateFilter = "open" | "closed" | "all";
export type RepoMilestonesBoardMilestoneFilter = string;
export type RepoMilestonesBoardItem = {
  key: string;
  kind: RepoMilestonesBoardItemKind;
  number: number;
  title: string;
  state: string;
  merged: boolean;
  draft: boolean;
  author: string;
  labels: string[];
  assignees: string[];
  milestone: GitHubIssueMilestone | null;
  updatedAt: string;
  searchText: string;
  issue?: GitHubIssue;
  pull?: GitHubPullRequest;
};
export type RepoMilestonesBoardGroup = {
  id: string;
  title: string;
  state: string | null;
  items: RepoMilestonesBoardItem[];
};

type SourceRef<T> = Readonly<Ref<T>>;

export const ALL_MILESTONES_ID = "__all_milestones__";
export const NO_MILESTONE_ID = "__no_milestone__";

export function useRepoMilestonesBoard(input: {
  issues: SourceRef<readonly GitHubIssue[]>;
  pulls: SourceRef<readonly GitHubPullRequest[]>;
  milestones: SourceRef<readonly GitHubIssueMilestone[]>;
  typeFilter: SourceRef<RepoMilestonesBoardTypeFilter>;
  stateFilter: SourceRef<RepoMilestonesBoardStateFilter>;
  milestoneFilter: SourceRef<RepoMilestonesBoardMilestoneFilter>;
  query: SourceRef<string>;
}) {
  const allItems = computed<RepoMilestonesBoardItem[]>(() => [
    ...input.issues.value.map((issue) => milestoneIssue(issue)),
    ...input.pulls.value.map((pull) => milestonePull(pull)),
  ].sort((left, right) => dateValue(right.updatedAt) - dateValue(left.updatedAt)));

  const milestones = computed(() => {
    const byNumber = new Map<number, GitHubIssueMilestone>();
    for (const milestone of input.milestones.value) byNumber.set(milestone.number, { ...milestone });
    for (const item of allItems.value) {
      if (item.milestone) byNumber.set(item.milestone.number, { ...item.milestone });
    }
    return [...byNumber.values()].sort(compareMilestones);
  });

  const baseFilteredItems = computed(() => {
    const needle = input.query.value.trim().toLowerCase();
    return allItems.value.filter((item) => {
      if (input.typeFilter.value !== "all" && item.kind !== input.typeFilter.value) return false;
      if (input.stateFilter.value === "open" && !isOpenRepoMilestonesBoardItem(item)) return false;
      if (input.stateFilter.value === "closed" && isOpenRepoMilestonesBoardItem(item)) return false;
      return !needle || item.searchText.includes(needle);
    });
  });

  const visibleItems = computed(() =>
    baseFilteredItems.value.filter((item) => milestoneMatches(item, input.milestoneFilter.value))
  );

  const visibleGroups = computed<RepoMilestonesBoardGroup[]>(() => {
    const byId = new Map<string, RepoMilestonesBoardGroup>();
    for (const item of visibleItems.value) {
      const id = item.milestone ? milestoneId(item.milestone.number) : NO_MILESTONE_ID;
      const group = byId.get(id) ?? {
        id,
        title: item.milestone?.title ?? "No milestone",
        state: item.milestone?.state ?? null,
        items: [],
      };
      group.items.push(item);
      byId.set(id, group);
    }
    return [...byId.values()]
      .map((group) => ({
        ...group,
        items: [...group.items].sort((left, right) => dateValue(right.updatedAt) - dateValue(left.updatedAt)),
      }))
      .sort(compareGroups);
  });

  const milestoneFilterOptions = computed(() => {
    const options = milestones.value.map((milestone) => ({
      id: milestoneId(milestone.number),
      title: milestone.title,
      state: milestone.state ?? null,
      count: milestoneCount(milestoneId(milestone.number)),
    }));
    const unassignedCount = milestoneCount(NO_MILESTONE_ID);
    if (unassignedCount || !options.length) {
      options.push({ id: NO_MILESTONE_ID, title: "No milestone", state: null, count: unassignedCount });
    }
    return options;
  });

  const issueCount = computed(() => visibleItems.value.filter((item) => item.kind === "issue").length);
  const milestoneCountTotal = computed(() => milestones.value.length);
  const pullCount = computed(() => visibleItems.value.filter((item) => item.kind === "pull").length);

  function milestoneCount(id: RepoMilestonesBoardMilestoneFilter) {
    return baseFilteredItems.value.filter((item) => milestoneMatches(item, id)).length;
  }

  return {
    baseFilteredItems,
    issueCount,
    milestoneCountTotal,
    milestoneFilterOptions,
    pullCount,
    visibleGroups,
    visibleItems,
  };
}

export function isOpenRepoMilestonesBoardItem(item: RepoMilestonesBoardItem) {
  return item.kind === "pull" ? item.state === "open" && !item.merged : item.state === "open";
}

export function repoMilestonesBoardItemStateText(item: RepoMilestonesBoardItem) {
  if (item.merged) return "merged";
  if (item.draft) return "draft";
  return item.state;
}

function milestoneIssue(issue: GitHubIssue): RepoMilestonesBoardItem {
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
    milestone: issue.milestone ?? null,
    updatedAt: issue.updatedAt,
    searchText: searchText([
      issue.title,
      issue.author,
      issue.state,
      issue.milestone?.title,
      ...(issue.labels ?? []),
      ...(issue.assignees ?? []),
    ]),
    issue,
  };
}

function milestonePull(pull: GitHubPullRequest): RepoMilestonesBoardItem {
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
    milestone: pull.milestone ?? null,
    updatedAt: pull.updatedAt,
    searchText: searchText([
      pull.title,
      pull.author,
      pull.state,
      pull.milestone?.title,
      ...(pull.labels ?? []),
      ...(pull.assignees ?? []),
    ]),
    pull,
  };
}

function milestoneMatches(item: RepoMilestonesBoardItem, id: RepoMilestonesBoardMilestoneFilter) {
  if (id === ALL_MILESTONES_ID) return true;
  if (id === NO_MILESTONE_ID) return item.milestone == null;
  return item.milestone ? milestoneId(item.milestone.number) === id : false;
}

function milestoneId(number: number) {
  return `milestone:${number}`;
}

function compareMilestones(left: GitHubIssueMilestone, right: GitHubIssueMilestone) {
  return milestoneStateRank(left.state) - milestoneStateRank(right.state) ||
    left.title.localeCompare(right.title);
}

function compareGroups(left: RepoMilestonesBoardGroup, right: RepoMilestonesBoardGroup) {
  if (left.id === NO_MILESTONE_ID) return 1;
  if (right.id === NO_MILESTONE_ID) return -1;
  return milestoneStateRank(left.state) - milestoneStateRank(right.state) ||
    left.title.localeCompare(right.title);
}

function milestoneStateRank(state: string | null | undefined) {
  return state === "closed" ? 1 : 0;
}

function searchText(parts: readonly (string | null | undefined)[]) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function dateValue(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

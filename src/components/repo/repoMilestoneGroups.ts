export type RepoMilestone = {
  number: number;
  title: string;
  state?: string | null;
};

export type RepoMilestoneGroupedItem = {
  milestone?: RepoMilestone | null;
};

export type RepoMilestoneGroup<T> = {
  id: string;
  title: string;
  state: string | null;
  milestoneNumber: number | null;
  items: T[];
  totalCount: number;
  hiddenCount: number;
};

export type RepoMilestoneGrouping<T> = {
  groups: RepoMilestoneGroup<T>[];
  totalCount: number;
  visibleCount: number;
  hiddenCount: number;
};

const NO_MILESTONE_ID = "no-milestone";

export function groupRepoItemsByMilestone<T extends RepoMilestoneGroupedItem>(
  items: readonly T[],
  visibleLimit: number,
): RepoMilestoneGrouping<T> {
  const limit = Number.isFinite(visibleLimit) ? Math.max(0, Math.trunc(visibleLimit)) : 0;
  const visibleItems = items.slice(0, limit);
  const totals = countGroups(items);
  const visibleGroups = new Map<string, RepoMilestoneGroup<T>>();

  for (const item of visibleItems) {
    const descriptor = milestoneDescriptor(item.milestone);
    const group = visibleGroups.get(descriptor.id) ?? {
      ...descriptor,
      items: [],
      totalCount: totals.get(descriptor.id) ?? 0,
      hiddenCount: 0,
    };
    group.items.push(item);
    visibleGroups.set(descriptor.id, group);
  }

  const groups = [...visibleGroups.values()]
    .map((group) => ({
      ...group,
      hiddenCount: Math.max(0, group.totalCount - group.items.length),
    }))
    .sort(compareGroups);
  const visibleCount = visibleItems.length;

  return {
    groups,
    totalCount: items.length,
    visibleCount,
    hiddenCount: Math.max(0, items.length - visibleCount),
  };
}

export function repoMilestoneGroupAgentSuffix(group: Pick<RepoMilestoneGroup<unknown>, "milestoneNumber">) {
  return group.milestoneNumber == null ? "none" : `milestone.${group.milestoneNumber}`;
}

function countGroups<T extends RepoMilestoneGroupedItem>(items: readonly T[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const id = milestoneDescriptor(item.milestone).id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function milestoneDescriptor(milestone: RepoMilestone | null | undefined) {
  if (!milestone) {
    return {
      id: NO_MILESTONE_ID,
      title: "无里程碑",
      state: null,
      milestoneNumber: null,
    };
  }
  return {
    id: `milestone:${milestone.number}`,
    title: milestone.title,
    state: milestone.state ?? null,
    milestoneNumber: milestone.number,
  };
}

function compareGroups<T>(left: RepoMilestoneGroup<T>, right: RepoMilestoneGroup<T>) {
  if (left.milestoneNumber == null && right.milestoneNumber == null) return 0;
  if (left.milestoneNumber == null) return 1;
  if (right.milestoneNumber == null) return -1;
  return stateRank(left.state) - stateRank(right.state) ||
    left.title.localeCompare(right.title) ||
    left.milestoneNumber - right.milestoneNumber;
}

function stateRank(state: string | null) {
  return state === "closed" ? 1 : 0;
}

export type RepoSortKey = "updated" | "name" | "created";
export type SortDirection = "asc" | "desc";

export type RepoSortState<K extends RepoSortKey = RepoSortKey> = {
  sort: K;
  direction: SortDirection;
};

export type RepoSortOption<K extends RepoSortKey = RepoSortKey> = {
  value: K;
  label: string;
  defaultDirection: SortDirection;
};

export const DEFAULT_REPO_SORT = {
  sort: "updated",
  direction: "desc",
} as const satisfies RepoSortState;

type RepoSortSelectors<T> = {
  name: (item: T) => string;
  updatedAt: (item: T) => number | string | null | undefined;
  createdAt?: (item: T) => number | string | null | undefined;
  index?: (item: T) => number | null | undefined;
};

export function readRepoSort<K extends RepoSortKey>(
  storageKey: string,
  options: readonly RepoSortOption<K>[],
  defaultSort: RepoSortState<K>,
): RepoSortState<K> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...defaultSort };
    const parsed = JSON.parse(raw) as Partial<RepoSortState>;
    const option = options.find((item) => item.value === parsed.sort);
    if (option && isSortDirection(parsed.direction)) {
      return { sort: option.value, direction: parsed.direction };
    }
  } catch {
  }
  return { ...defaultSort };
}

export function writeRepoSort<K extends RepoSortKey>(storageKey: string, value: RepoSortState<K>) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
  }
}

export function nextRepoSort<K extends RepoSortKey>(
  current: RepoSortState<K>,
  option: RepoSortOption<K>,
): RepoSortState<K> {
  const direction = current.sort === option.value
    ? current.direction === "asc" ? "desc" : "asc"
    : option.defaultDirection;
  return { sort: option.value, direction };
}

export function compareRepoSortItems<T, K extends RepoSortKey>(
  left: T,
  right: T,
  state: RepoSortState<K>,
  selectors: RepoSortSelectors<T>,
) {
  const directionFactor = state.direction === "asc" ? 1 : -1;
  let valueCompare = 0;
  if (state.sort === "name") {
    valueCompare = selectors.name(left).localeCompare(selectors.name(right)) * directionFactor;
  } else {
    const timestampSelector = state.sort === "created" ? selectors.createdAt : selectors.updatedAt;
    valueCompare = compareNullableTimestamp(
      timestampSelector?.(left),
      timestampSelector?.(right),
      directionFactor,
    );
  }

  return valueCompare
    || selectors.name(left).localeCompare(selectors.name(right))
    || compareIndex(selectors.index?.(left), selectors.index?.(right));
}

function isSortDirection(value: unknown): value is SortDirection {
  return value === "asc" || value === "desc";
}

function timestampValue(value: number | string | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  return null;
}

function compareNullableTimestamp(
  leftValue: number | string | null | undefined,
  rightValue: number | string | null | undefined,
  directionFactor: 1 | -1,
) {
  const left = timestampValue(leftValue);
  const right = timestampValue(rightValue);
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return (left - right) * directionFactor;
}

function compareIndex(left: number | null | undefined, right: number | null | undefined) {
  const leftValue = typeof left === "number" && Number.isFinite(left) ? left : 0;
  const rightValue = typeof right === "number" && Number.isFinite(right) ? right : 0;
  return leftValue - rightValue;
}

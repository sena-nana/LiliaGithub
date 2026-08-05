import type {
  LocationQuery,
  LocationQueryRaw,
  RouteLocationNormalizedLoaded,
  Router,
} from "vue-router";
import {
  normalizeRepoProjectCreateFlow,
  normalizeRepoProjectTab,
  repoCommitRoute,
  repoRoute,
  repoRouteTabFromRoute,
  type RepoProjectCreateFlow,
  type RepoProjectTab,
  type RepoRouteTab,
} from "./repoRoutes";

const PROJECT_FILTER_KEYS = {
  issues: [
    "issueState", "issueQ", "issueCreator", "issueAssignee", "issueLabels",
    "issueMilestone", "issueProject", "issueSort", "issueDirection",
  ],
  pulls: [
    "pullState", "pullQ", "pullCreator", "pullAssignee", "pullLabels",
    "pullMilestone", "pullProject", "pullSort", "pullDirection", "pullReview",
  ],
  discussions: [
    "discussionState", "discussionCategory", "discussionAnswered",
    "discussionSort", "discussionDirection",
  ],
  actions: [
    "actionState", "actionQ", "actionWorkflow", "actionBranch", "actionEvent",
    "actionActor", "actionStatus", "actionSort", "actionDirection",
  ],
} as const;

const PROJECT_TARGET_KEYS = {
  issues: "issue",
  pulls: "pr",
  discussions: "discussion",
  actions: "run",
} as const;

const PROJECT_TRANSIENT_KEYS = [
  "issue", "pr", "discussion", "run", "job", "releaseTag", "releaseType", "create",
  ...Object.values(PROJECT_FILTER_KEYS).flat(),
] as const;

export type RepoReleaseType = "all" | "stable" | "latest" | "prerelease" | "draft";
export type RepoIssueState = "open" | "closed" | "all";
export type RepoPullRequestState = "open" | "closed" | "merged";
export type RepoActionState = "all" | "active" | "completed";
export type RepoListSort = "number" | "created" | "updated" | "comments";
export type RepoActionSort = "updated" | "created" | "run-number";
export type RepoSortDirection = "asc" | "desc";
export type RepoPullRequestReview = "none" | "required" | "approved" | "changes_requested" | null;

export interface RepoSharedListFilters {
  creator: string | null;
  assignee: string | null;
  labels: string[];
  milestone: string | number | null;
  project: string | null;
  sort: RepoListSort;
  direction: RepoSortDirection;
  query: string;
}

export type RepoIssueFilters = RepoSharedListFilters;

export interface RepoPullRequestFilters extends RepoSharedListFilters {
  review: RepoPullRequestReview;
}

export interface RepoActionFilters {
  workflow: string | null;
  branch: string | null;
  event: string | null;
  actor: string | null;
  status: string | null;
  sort: RepoActionSort;
  direction: RepoSortDirection;
  query: string;
}

export interface RepoProjectRouteDefaults {
  issues: Pick<RepoProjectRouteFilters["issues"], "state"> & Pick<RepoIssueFilters, "sort" | "direction">;
  pulls: Pick<RepoProjectRouteFilters["pulls"], "state"> & Pick<RepoPullRequestFilters, "sort" | "direction">;
  actions: Pick<RepoProjectRouteFilters["actions"], "state"> & Pick<RepoActionFilters, "sort" | "direction">;
}

export interface RepoProjectRouteFilters {
  issues: { state: RepoIssueState; filters: RepoIssueFilters };
  pulls: { state: RepoPullRequestState; filters: RepoPullRequestFilters };
  actions: { state: RepoActionState; filters: RepoActionFilters };
}

const DEFAULT_PROJECT_ROUTE_DEFAULTS: RepoProjectRouteDefaults = {
  issues: { state: "open", sort: "number", direction: "desc" },
  pulls: { state: "open", sort: "number", direction: "desc" },
  actions: { state: "all", sort: "updated", direction: "desc" },
};

export interface RepoRouteState {
  repoId: string;
  tab: RepoRouteTab;
  projectTab: RepoProjectTab;
  create: RepoProjectCreateFlow | null;
  issue: number | null;
  pull: number | null;
  discussion: number | null;
  run: number | null;
  job: number | null;
  releaseTag: string | null;
  releaseType: RepoReleaseType;
  filters: RepoProjectRouteFilters;
}

type RepoRouteLike = Pick<RouteLocationNormalizedLoaded, "meta" | "params" | "path" | "query">;

export const RepoRouteStateCodec = {
  projectTab(query: LocationQuery | LocationQueryRaw): RepoProjectTab | null {
    return normalizeRepoProjectTab(query.projectTab);
  },

  fileTarget(query: LocationQuery | LocationQueryRaw): { path: string | null; hash: string | null } {
    return { path: firstString(query.file), hash: firstString(query.hash) };
  },

  patchFileTarget(
    query: LocationQuery | LocationQueryRaw,
    path: string | null,
    hash: string | null = null,
  ): LocationQueryRaw {
    const next: LocationQueryRaw = { ...query };
    setString(next, "file", path);
    setString(next, "hash", path ? hash : null);
    return next;
  },

  parse(
    route: RepoRouteLike,
    defaults: RepoProjectRouteDefaults = DEFAULT_PROJECT_ROUTE_DEFAULTS,
  ): RepoRouteState | null {
    const repoId = firstString(route.params.repoId);
    if (!repoId || !route.path.startsWith("/repos/")) return null;

    const tab = repoRouteTabFromRoute(route);
    const projectTab = tab === "repo"
      ? normalizeRepoProjectTab(route.query.projectTab) ?? "readme"
      : "readme";
    const create = normalizeCreateFlow(route.query.create, projectTab);

    return {
      repoId,
      tab,
      projectTab,
      create,
      issue: projectTab === "issues" ? positiveInteger(route.query.issue) : null,
      pull: projectTab === "pulls" ? positiveInteger(route.query.pr) : null,
      discussion: projectTab === "discussions" ? positiveInteger(route.query.discussion) : null,
      run: projectTab === "actions" ? positiveInteger(route.query.run) : null,
      job: projectTab === "actions" ? positiveInteger(route.query.job) : null,
      releaseTag: projectTab === "release" ? firstString(route.query.releaseTag) : null,
      releaseType: projectTab === "release"
        ? enumValue(route.query.releaseType, ["all", "stable", "latest", "prerelease", "draft"]) ?? "all"
        : "all",
      filters: parseProjectFilters(route.query, defaults),
    };
  },

  patch(query: LocationQuery | LocationQueryRaw, patch: {
    projectTab?: RepoProjectTab;
    create?: RepoProjectCreateFlow | null;
    issue?: number | null;
    pull?: number | null;
    discussion?: number | null;
    run?: number | null;
    job?: number | null;
    releaseTag?: string | null;
    releaseType?: RepoReleaseType | null;
  }): LocationQueryRaw {
    const next: LocationQueryRaw = { ...query };
    if (patch.projectTab !== undefined) {
      for (const key of PROJECT_TRANSIENT_KEYS) delete next[key];
      if (patch.projectTab === "readme") delete next.projectTab;
      else next.projectTab = patch.projectTab;
    }

    setString(next, "create", patch.create);
    setPositiveInteger(next, "issue", patch.issue);
    setPositiveInteger(next, "pr", patch.pull);
    setPositiveInteger(next, "discussion", patch.discussion);
    setPositiveInteger(next, "run", patch.run);
    setPositiveInteger(next, "job", patch.job);
    setString(next, "releaseTag", patch.releaseTag);
    setString(next, "releaseType", patch.releaseType === "all" ? null : patch.releaseType);
    return next;
  },

  projectQuery(
    query: LocationQuery | LocationQueryRaw,
    projectTab: RepoProjectTab,
    state: Partial<RepoProjectRouteFilters> & {
      create?: RepoProjectCreateFlow | null;
      issue?: number | null;
      pull?: number | null;
      discussion?: number | null;
      run?: number | null;
      job?: number | null;
      releaseTag?: string | null;
      releaseType?: RepoReleaseType;
    },
    defaults: RepoProjectRouteDefaults = DEFAULT_PROJECT_ROUTE_DEFAULTS,
  ): LocationQueryRaw {
    const next = this.patch(query, { projectTab });
    if (projectTab === "issues" && state.issues) {
      writeSharedFilters(next, PROJECT_FILTER_KEYS.issues, state.issues.state, defaults.issues.state, state.issues.filters, defaults.issues);
      setPositiveInteger(next, "issue", state.issue);
    } else if (projectTab === "pulls" && state.pulls) {
      writeSharedFilters(next, PROJECT_FILTER_KEYS.pulls, state.pulls.state, defaults.pulls.state, state.pulls.filters, defaults.pulls);
      setString(next, "pullReview", state.pulls.filters.review);
      setPositiveInteger(next, "pr", state.pull);
    } else if (projectTab === "discussions") {
      setPositiveInteger(next, "discussion", state.discussion);
      setString(next, "create", state.create === "discussion" ? state.create : null);
    } else if (projectTab === "actions" && state.actions) {
      writeActionFilters(next, state.actions, defaults.actions);
      setPositiveInteger(next, "run", state.run);
      setPositiveInteger(next, "job", state.job);
    } else if (projectTab === "release") {
      setString(next, "releaseTag", state.releaseTag);
      setString(next, "releaseType", state.releaseType === "all" ? null : state.releaseType);
      setString(next, "create", state.create === "release" ? state.create : null);
    } else {
      setString(next, "create", state.create);
    }
    return next;
  },

  without(query: LocationQuery | LocationQueryRaw, ...keys: string[]): LocationQueryRaw {
    const next: LocationQueryRaw = { ...query };
    for (const key of keys) delete next[key];
    return next;
  },

  sameQuery(left: LocationQuery | LocationQueryRaw, right: LocationQuery | LocationQueryRaw): boolean {
    return normalizedQuery(left) === normalizedQuery(right);
  },

  recentContextRoute(router: Router, route: RepoRouteLike): string | null {
    const parsed = this.parse(route);
    if (!parsed) return null;

    const hash = firstString(route.params.hash);
    if (hash) return router.resolve(repoCommitRoute(parsed.repoId, hash)).fullPath;

    const path = repoRoute(parsed.repoId, parsed.tab);
    const query: LocationQueryRaw = {};
    if (parsed.tab === "files") {
      copyStrings(route.query, query, "ref");
      if (copyStrings(route.query, query, "file")) copyStrings(route.query, query, "hash");
    } else if (parsed.tab === "changes") {
      copyStrings(route.query, query, "change");
    } else if (parsed.tab === "repo" && parsed.projectTab !== "readme") {
      query.projectTab = parsed.projectTab;
      if (parsed.projectTab in PROJECT_FILTER_KEYS) {
        const projectTab = parsed.projectTab as keyof typeof PROJECT_FILTER_KEYS;
        const targetKey = PROJECT_TARGET_KEYS[projectTab];
        const hasTarget = copyPositiveInteger(route.query, query, targetKey);
        if (projectTab === "actions" && hasTarget) copyPositiveInteger(route.query, query, "job");
        for (const key of PROJECT_FILTER_KEYS[projectTab]) copyStrings(route.query, query, key);
      } else if (parsed.projectTab === "release") {
        copyStrings(route.query, query, "releaseTag");
        if (parsed.releaseType !== "all") query.releaseType = parsed.releaseType;
      }
    }
    return router.resolve({ path, query }).fullPath;
  },
};

function parseProjectFilters(
  query: LocationQuery,
  defaults: RepoProjectRouteDefaults,
): RepoProjectRouteFilters {
  return {
    issues: {
      state: enumValue(query.issueState, ["open", "closed", "all"]) ?? defaults.issues.state,
      filters: parseSharedFilters(query, PROJECT_FILTER_KEYS.issues, defaults.issues),
    },
    pulls: {
      state: enumValue(query.pullState, ["open", "closed", "merged"]) ?? defaults.pulls.state,
      filters: {
        ...parseSharedFilters(query, PROJECT_FILTER_KEYS.pulls, defaults.pulls),
        review: enumValue(query.pullReview, ["none", "required", "approved", "changes_requested"]),
      },
    },
    actions: {
      state: enumValue(query.actionState, ["all", "active", "completed"]) ?? defaults.actions.state,
      filters: {
        workflow: firstString(query.actionWorkflow),
        branch: firstString(query.actionBranch),
        event: firstString(query.actionEvent),
        actor: firstString(query.actionActor),
        status: firstString(query.actionStatus),
        sort: enumValue(query.actionSort, ["updated", "created", "run-number"]) ?? defaults.actions.sort,
        direction: enumValue(query.actionDirection, ["asc", "desc"]) ?? defaults.actions.direction,
        query: firstString(query.actionQ) ?? "",
      },
    },
  };
}

function parseSharedFilters(
  query: LocationQuery,
  keys: readonly string[],
  defaults: Pick<RepoSharedListFilters, "sort" | "direction">,
): RepoSharedListFilters {
  const [stateKey, queryKey, creatorKey, assigneeKey, labelsKey, milestoneKey, projectKey, sortKey, directionKey] = keys;
  void stateKey;
  return {
    creator: firstString(query[creatorKey]),
    assignee: firstString(query[assigneeKey]),
    labels: stringList(query[labelsKey]),
    milestone: firstString(query[milestoneKey]),
    project: firstString(query[projectKey]),
    sort: enumValue(query[sortKey], ["number", "created", "updated", "comments"]) ?? defaults.sort,
    direction: enumValue(query[directionKey], ["asc", "desc"]) ?? defaults.direction,
    query: firstString(query[queryKey]) ?? "",
  };
}

function writeSharedFilters(
  query: LocationQueryRaw,
  keys: readonly string[],
  state: string,
  defaultState: string,
  filters: RepoSharedListFilters,
  defaults: Pick<RepoSharedListFilters, "sort" | "direction">,
) {
  const [stateKey, queryKey, creatorKey, assigneeKey, labelsKey, milestoneKey, projectKey, sortKey, directionKey] = keys;
  setString(query, stateKey, state === defaultState ? null : state);
  setString(query, queryKey, filters.query);
  setString(query, creatorKey, filters.creator);
  setString(query, assigneeKey, filters.assignee);
  setStringList(query, labelsKey, filters.labels);
  setString(query, milestoneKey, filters.milestone == null ? null : String(filters.milestone));
  setString(query, projectKey, filters.project);
  setString(query, sortKey, filters.sort === defaults.sort ? null : filters.sort);
  setString(query, directionKey, filters.direction === defaults.direction ? null : filters.direction);
}

function writeActionFilters(
  query: LocationQueryRaw,
  state: RepoProjectRouteFilters["actions"],
  defaults: RepoProjectRouteDefaults["actions"],
) {
  setString(query, "actionState", state.state === defaults.state ? null : state.state);
  setString(query, "actionQ", state.filters.query);
  setString(query, "actionWorkflow", state.filters.workflow);
  setString(query, "actionBranch", state.filters.branch);
  setString(query, "actionEvent", state.filters.event);
  setString(query, "actionActor", state.filters.actor);
  setString(query, "actionStatus", state.filters.status);
  setString(query, "actionSort", state.filters.sort === defaults.sort ? null : state.filters.sort);
  setString(query, "actionDirection", state.filters.direction === defaults.direction ? null : state.filters.direction);
}

export function firstString(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim() ? first.trim() : null;
}

export function stringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
}

export function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const candidate = firstString(value);
  return candidate && (allowed as readonly string[]).includes(candidate) ? candidate as T : null;
}

export function positiveInteger(value: unknown): number | null {
  const candidate = firstString(value);
  if (!candidate || !/^\d+$/.test(candidate)) return null;
  const number = Number(candidate);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeCreateFlow(value: unknown, projectTab: RepoProjectTab): RepoProjectCreateFlow | null {
  const create = normalizeRepoProjectCreateFlow(value);
  if (create === "issue" && projectTab === "issues") return create;
  if (create === "pull" && projectTab === "pulls") return create;
  if (create === "discussion" && projectTab === "discussions") return create;
  if (create === "release" && projectTab === "release") return create;
  return null;
}

function setString(query: LocationQueryRaw, key: string, value: string | null | undefined) {
  if (value === undefined) return;
  const candidate = value?.trim();
  if (candidate) query[key] = candidate;
  else delete query[key];
}

function setPositiveInteger(query: LocationQueryRaw, key: string, value: number | null | undefined) {
  if (value === undefined) return;
  if (value != null && Number.isSafeInteger(value) && value > 0) query[key] = String(value);
  else delete query[key];
}

function setStringList(query: LocationQueryRaw, key: string, values: readonly string[]) {
  const next = values.map((value) => value.trim()).filter(Boolean);
  if (next.length) query[key] = next;
  else delete query[key];
}

function copyStrings(source: LocationQuery, target: LocationQueryRaw, key: string): boolean {
  const values = (Array.isArray(source[key]) ? source[key] : [source[key]])
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim());
  if (!values.length) return false;
  target[key] = values.length === 1 ? values[0] : values;
  return true;
}

function copyPositiveInteger(source: LocationQuery, target: LocationQueryRaw, key: string): boolean {
  const value = positiveInteger(source[key]);
  if (value == null) return false;
  target[key] = String(value);
  return true;
}

function normalizedQuery(query: LocationQuery | LocationQueryRaw): string {
  return JSON.stringify(
    Object.entries(query)
      .flatMap(([key, value]) => {
        if (value == null) return [];
        const values = Array.isArray(value) ? value : [value];
        return values
          .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
          .map((item) => [key, String(item)] as const);
      })
      .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
      ),
  );
}

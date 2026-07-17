import type { RouteLocationNormalizedLoaded } from "vue-router";
import { repoRoute } from "../../utils/repoRoutes";
import type { RepoSummary, WorkspaceTask } from "../workspace/types";
import type { ContinueContext, ContinueContextKind, ContinueContextSnapshot, KeyValueStorage } from "./types";

const STORAGE_KEY = "lilia-github.control-center.continue.v1";
const CONTEXT_LIMIT = 12;

export function readContinueContexts(storage: KeyValueStorage | null = browserStorage()): ContinueContextSnapshot {
  if (!storage) return emptySnapshot();
  try {
    return normalizeSnapshot(JSON.parse(storage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return emptySnapshot();
  }
}

export function recordContinueContext(
  context: ContinueContext,
  storage: KeyValueStorage | null = browserStorage(),
) {
  const snapshot = readContinueContexts(storage);
  const items = [context, ...snapshot.items.filter((item) => item.id !== context.id && item.route !== context.route)]
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .slice(0, CONTEXT_LIMIT);
  const next: ContinueContextSnapshot = { version: 1, items };
  storage?.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function removeContinueContext(id: string, storage: KeyValueStorage | null = browserStorage()) {
  const snapshot = readContinueContexts(storage);
  const next: ContinueContextSnapshot = { version: 1, items: snapshot.items.filter((item) => item.id !== id) };
  storage?.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function continueContextFromRoute(
  route: Pick<RouteLocationNormalizedLoaded, "path" | "fullPath" | "query">,
  now = Date.now(),
): ContinueContext | null {
  const commitMatch = route.path.match(/^\/repos\/(.+)\/commits\/([^/]+)$/);
  if (commitMatch) {
    const repositoryId = decode(commitMatch[1]);
    const hash = decode(commitMatch[2]);
    return context("commit", repositoryId, hash, `提交 ${shortHash(hash)}`, repositoryId, route.fullPath, now);
  }
  const repoMatch = route.path.match(/^\/repos\/(.+?)(?:\/(files|changes|history|stash|branches|run))?$/);
  if (!repoMatch) return null;
  const repositoryId = decode(repoMatch[1]);
  const projectTab = queryValue(route.query.projectTab);
  const file = queryValue(route.query.file);
  const branch = queryValue(route.query.branch);
  const issue = queryValue(route.query.issue);
  const pull = queryValue(route.query.pr);
  const run = queryValue(route.query.run);
  const job = queryValue(route.query.job);

  if (projectTab === "issues" && issue) return context("issue", repositoryId, issue, `Issue #${issue}`, repositoryId, route.fullPath, now);
  if (projectTab === "pulls" && pull) return context("pull_request", repositoryId, pull, `Pull Request #${pull}`, repositoryId, route.fullPath, now);
  if (projectTab === "actions" && run) {
    const objectId = job ? `${run}:${job}` : run;
    return context("actions_job", repositoryId, objectId, job ? `Actions Job ${job}` : `Actions Run ${run}`, repositoryId, route.fullPath, now);
  }
  if (file) return context("file", repositoryId, file, file, repositoryId, route.fullPath, now);
  if (branch) return context("branch", repositoryId, branch, branch, repositoryId, route.fullPath, now, branch);
  const tab = repoMatch[2] ?? projectTab ?? "repo";
  if (tab === "run") return context("task", repositoryId, "run", "运行任务", repositoryId, route.fullPath, now);
  return context("repository", repositoryId, tab, repositoryLabel(tab), repositoryId, route.fullPath, now);
}

export function recordContinueContextFromRoute(route: Pick<RouteLocationNormalizedLoaded, "path" | "fullPath" | "query">) {
  const context = continueContextFromRoute(route);
  if (context) recordContinueContext(context);
}

export function recordRepositoryBranchContext(repository: RepoSummary, route: string, now = Date.now()) {
  if (!repository.currentBranch) return null;
  return recordContinueContext(context(
    "branch",
    repository.id,
    repository.currentBranch,
    repository.currentBranch,
    repository.githubFullName || repository.name,
    route,
    now,
    repository.currentBranch,
  ));
}

export function continueContextsFromTasks(
  tasks: readonly WorkspaceTask[],
  repositories: readonly RepoSummary[],
): ContinueContext[] {
  const repos = new Map(repositories.map((repo) => [repo.id, repo]));
  return tasks.flatMap((task) => {
    if (task.status !== "pending" && task.status !== "running") return [];
    const repo = task.repoId ? repos.get(task.repoId) : null;
    if (!repo) return [];
    return [{
      id: `task:${task.id}`,
      kind: "task" as const,
      title: task.title,
      detail: task.message || repo.githubFullName || repo.name,
      route: repoRoute(repo.id, task.kind === "launch" ? "run" : "repo"),
      repositoryId: repo.id,
      branch: repo.currentBranch,
      objectId: task.id,
      updatedAt: task.updatedAt,
    }];
  });
}

function context(
  kind: ContinueContextKind,
  repositoryId: string,
  objectId: string,
  title: string,
  detail: string,
  route: string,
  updatedAt: number,
  branch: string | null = null,
): ContinueContext {
  return {
    id: `${kind}:${repositoryId}:${objectId}`,
    kind,
    title,
    detail,
    route,
    repositoryId,
    branch,
    objectId,
    updatedAt,
  };
}

function repositoryLabel(tab: string) {
  return {
    files: "文件",
    changes: "本地改动",
    history: "提交历史",
    stash: "Stash",
    branches: "分支",
    run: "运行任务",
    issues: "Issues",
    pulls: "Pull Requests",
    actions: "Actions",
    release: "Releases",
    repo: "仓库概览",
  }[tab] ?? "仓库上下文";
}

function normalizeSnapshot(value: unknown): ContinueContextSnapshot {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.items)) return emptySnapshot();
  const items = value.items.flatMap((entry): ContinueContext[] => {
    if (!isRecord(entry) || !isKind(entry.kind) || typeof entry.id !== "string" || typeof entry.route !== "string") return [];
    if (!entry.route.startsWith("/repos/")) return [];
    return [{
      id: entry.id,
      kind: entry.kind,
      title: stringValue(entry.title),
      detail: stringValue(entry.detail),
      route: entry.route,
      repositoryId: nullableString(entry.repositoryId),
      branch: nullableString(entry.branch),
      objectId: nullableString(entry.objectId),
      updatedAt: numberValue(entry.updatedAt),
    }];
  });
  return { version: 1, items: items.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).slice(0, CONTEXT_LIMIT) };
}

function emptySnapshot(): ContinueContextSnapshot {
  return { version: 1, items: [] };
}

function browserStorage(): KeyValueStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function queryValue(value: unknown) {
  const current = Array.isArray(value) ? value[0] : value;
  return typeof current === "string" && current.trim() ? current : null;
}

function decode(value: string | undefined) {
  if (!value) return "";
  try { return decodeURIComponent(value); } catch { return value; }
}

function shortHash(value: string) {
  return value.slice(0, 8);
}

function isKind(value: unknown): value is ContinueContextKind {
  return value === "repository" || value === "branch" || value === "file" || value === "commit" ||
    value === "issue" || value === "pull_request" || value === "actions_job" || value === "task";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

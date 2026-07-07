import { computed, reactive } from "vue";
import type { WorkspaceTask, WorkspaceTaskPriority } from "../services/workspace";
import { state } from "./workspace/state";

export type BackgroundTaskKind =
  | "git"
  | "sync"
  | "github"
  | "launch"
  | "workspace"
  | "system";

export type BackgroundTaskDescriptor = {
  kind: BackgroundTaskKind;
  title: string;
  repoId?: string | null;
  repoName?: string | null;
  detail?: string | null;
  priority?: WorkspaceTaskPriority;
};

export type ActiveBackgroundTask = {
  id: string;
  source: "frontend" | "workspace";
  kind: BackgroundTaskKind | WorkspaceTask["kind"];
  title: string;
  repoId: string | null;
  repoName: string | null;
  detail: string | null;
  priority: WorkspaceTaskPriority;
  status: "pending" | "running" | "success" | "failed";
  startedAt: number;
};

const activeFrontendTasks = reactive<Record<string, ActiveBackgroundTask>>({});
const frontendTaskTimers = new Map<string, ReturnType<typeof setTimeout>>();
const frontendTaskRemovalListeners = new Map<string, Set<() => void>>();
let nextTaskIndex = 1;
const SUCCESS_TASK_TTL_MS = 1600;
const FAILED_TASK_TTL_MS = 9000;
type FrontendTaskTerminalStatus = "success" | "failed";

const priorityRank: Record<WorkspaceTaskPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

const workspaceKindTitles: Record<WorkspaceTask["kind"], string> = {
  repoStatus: "刷新仓库状态",
  repoDetail: "读取仓库详情",
  discoverRepos: "发现工作区仓库",
  languageStats: "更新代码统计",
  contributions: "更新贡献统计",
};

function normalizePriority(priority: WorkspaceTaskPriority | undefined): WorkspaceTaskPriority {
  return priority ?? "normal";
}

function repoNameForTask(repoId: string | null | undefined) {
  if (!repoId) return null;
  const repo = state.repos.find((item) => item.id === repoId);
  return repo?.name || repo?.relativePath || repoId;
}

function activeWorkspaceTasks(): ActiveBackgroundTask[] {
  return state.tasks
    .filter((task) => task.status === "pending" || task.status === "running")
    .map((task) => ({
      id: `workspace:${task.id}`,
      source: "workspace" as const,
      kind: task.kind,
      title: workspaceKindTitles[task.kind] ?? "后台任务",
      repoId: task.repoId,
      repoName: repoNameForTask(task.repoId),
      detail: task.message,
      priority: task.priority,
      status: task.status === "pending" ? "pending" : "running",
      startedAt: task.updatedAt,
    }));
}

function sortedTasks(tasks: ActiveBackgroundTask[]) {
  return [...tasks].sort((left, right) =>
    priorityRank[left.priority] - priorityRank[right.priority] ||
    left.startedAt - right.startedAt ||
    left.title.localeCompare(right.title)
  );
}

export function beginBackgroundTask(descriptor: BackgroundTaskDescriptor) {
  const id = `frontend:${Date.now()}:${nextTaskIndex++}`;
  activeFrontendTasks[id] = {
    id,
    source: "frontend",
    kind: descriptor.kind,
    title: descriptor.title,
    repoId: descriptor.repoId ?? null,
    repoName: descriptor.repoName ?? repoNameForTask(descriptor.repoId),
    detail: descriptor.detail ?? null,
    priority: normalizePriority(descriptor.priority),
    status: "running",
    startedAt: Date.now(),
  };
  return id;
}

export function finishBackgroundTask(taskId: string | null | undefined) {
  if (!taskId) return;
  const timer = frontendTaskTimers.get(taskId);
  if (timer) {
    clearTimeout(timer);
    frontendTaskTimers.delete(taskId);
  }
  const listeners = frontendTaskRemovalListeners.get(taskId);
  if (listeners) {
    frontendTaskRemovalListeners.delete(taskId);
    for (const listener of listeners) listener();
  }
  delete activeFrontendTasks[taskId];
}

export function onBackgroundTaskRemoved(taskId: string, listener: () => void) {
  let listeners = frontendTaskRemovalListeners.get(taskId);
  if (!listeners) {
    listeners = new Set();
    frontendTaskRemovalListeners.set(taskId, listeners);
  }
  listeners.add(listener);
  return () => {
    const current = frontendTaskRemovalListeners.get(taskId);
    if (!current) return;
    current.delete(listener);
    if (!current.size) frontendTaskRemovalListeners.delete(taskId);
  };
}

function scheduleTaskRemoval(taskId: string, delay: number) {
  const currentTimer = frontendTaskTimers.get(taskId);
  if (currentTimer) clearTimeout(currentTimer);
  frontendTaskTimers.set(taskId, setTimeout(() => {
    frontendTaskTimers.delete(taskId);
    finishBackgroundTask(taskId);
  }, delay));
}

function markFrontendTask(
  taskId: string | null | undefined,
  status: FrontendTaskTerminalStatus,
  detail: string,
) {
  if (!taskId) return;
  const task = activeFrontendTasks[taskId];
  if (!task) return;
  task.status = status;
  task.detail = detail;
  scheduleTaskRemoval(taskId, status === "success" ? SUCCESS_TASK_TTL_MS : FAILED_TASK_TTL_MS);
}

export function completeBackgroundTask(taskId: string | null | undefined, detail = "已完成") {
  markFrontendTask(taskId, "success", detail);
}

export function failBackgroundTask(taskId: string | null | undefined, message: string) {
  markFrontendTask(taskId, "failed", message ? `已回滚：${message}` : "已回滚");
}

export async function runBackgroundTask<T>(
  descriptor: BackgroundTaskDescriptor | undefined,
  task: () => Promise<T>,
) {
  const taskId = descriptor ? beginBackgroundTask(descriptor) : null;
  try {
    const result = await task();
    completeBackgroundTask(taskId);
    return result;
  } catch (err) {
    failBackgroundTask(taskId, String(err));
    throw err;
  }
}

export function useBackgroundTasks() {
  const tasks = computed(() => sortedTasks([
    ...Object.values(activeFrontendTasks),
    ...activeWorkspaceTasks(),
  ]));
  const runningTaskCount = computed(() => tasks.value.length);

  return {
    tasks,
    runningTaskCount,
  };
}

export function clearFrontendBackgroundTasksForTests() {
  for (const id of Object.keys(activeFrontendTasks)) {
    finishBackgroundTask(id);
  }
}

import type { WorkspaceTask } from "../../services/workspace";
import { state } from "./state";

const taskWaiters = new Map<string, Set<{
  resolve: () => void;
  reject: (error: Error) => void;
}>>();

export function waitForWorkspaceTask(taskId: string) {
  const current = state.tasks.find((task) => task.id === taskId);
  if (current && isTerminalTask(current)) return terminalTaskResult(current);
  return new Promise<void>((resolve, reject) => {
    const waiters = taskWaiters.get(taskId) ?? new Set();
    waiters.add({ resolve, reject });
    taskWaiters.set(taskId, waiters);
  });
}

export function settleWorkspaceTaskWaiters(task: WorkspaceTask) {
  if (!isTerminalTask(task)) return;
  const waiters = taskWaiters.get(task.id);
  if (!waiters) return;
  taskWaiters.delete(task.id);
  for (const waiter of waiters) {
    if (task.status === "success") waiter.resolve();
    else waiter.reject(terminalTaskError(task));
  }
}

export function resetWorkspaceTaskWaitersForTests() {
  for (const waiters of taskWaiters.values()) {
    for (const waiter of waiters) waiter.reject(new Error("任务监听已重置"));
  }
  taskWaiters.clear();
}

function isTerminalTask(task: WorkspaceTask) {
  return task.status === "success" || task.status === "error" || task.status === "cancelled";
}

function terminalTaskResult(task: WorkspaceTask): Promise<void> {
  if (task.status === "success") return Promise.resolve();
  return Promise.reject(terminalTaskError(task));
}

function terminalTaskError(task: WorkspaceTask) {
  return new Error(task.message || (task.status === "cancelled" ? "任务已取消" : "后台任务失败"));
}

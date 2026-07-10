import type { WorkspaceTask } from "./types";

const WORKSPACE_TASK_LIMIT = 200;

export function normalizeWorkspaceTasks(tasks: readonly WorkspaceTask[]) {
  const latestById = new Map<string, WorkspaceTask>();
  for (const task of tasks) {
    const current = latestById.get(task.id);
    if (!current || task.updatedAt >= current.updatedAt) {
      latestById.set(task.id, task);
    }
  }

  const sorted = [...latestById.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  const protectedCount = sorted.filter((task) => !isTerminalWorkspaceTask(task)).length;
  let terminalBudget = Math.max(0, WORKSPACE_TASK_LIMIT - protectedCount);
  return sorted.filter((task) => {
    if (!isTerminalWorkspaceTask(task)) return true;
    if (terminalBudget === 0) return false;
    terminalBudget -= 1;
    return true;
  });
}

function isTerminalWorkspaceTask(task: WorkspaceTask) {
  return task.status === "success" || task.status === "error" || task.status === "cancelled";
}

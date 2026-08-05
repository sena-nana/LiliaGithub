import { computed } from "vue";
import type { WorkspaceTaskPriority } from "../services/workspace";
import { useWorkspace } from "./useWorkspace";

export type ActiveBackgroundTask = {
  id: string;
  title: string;
  repoName: string | null;
  priority: WorkspaceTaskPriority;
  status: "pending" | "running";
  startedAt: number;
};

const priorityRank: Record<WorkspaceTaskPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

function sortedTasks(tasks: ActiveBackgroundTask[]) {
  return [...tasks].sort((left, right) =>
    priorityRank[left.priority] - priorityRank[right.priority] ||
    left.startedAt - right.startedAt ||
    left.title.localeCompare(right.title)
  );
}

export function useBackgroundTasks() {
  const workspace = useWorkspace();
  const repoNameForTask = (repoId: string | null | undefined) => {
    if (!repoId) return null;
    const repo = workspace.state.repos.find((item) => item.id === repoId);
    return repo?.name || repo?.relativePath || repoId;
  };
  const tasks = computed(() => sortedTasks(
    workspace.state.tasks
      .filter((task) => task.status === "pending" || task.status === "running")
      .map((task) => ({
        id: `workspace:${task.id}`,
        title: task.title,
        repoName: repoNameForTask(task.repoId),
        priority: task.priority,
        status: task.status === "pending" ? "pending" : "running",
        startedAt: task.createdAt,
      })),
  ));
  return { tasks };
}

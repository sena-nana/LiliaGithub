import { computed, ref } from "vue";
import {
  beginBackgroundTask,
  finishBackgroundTask,
  type BackgroundTaskDescriptor,
} from "./useBackgroundTasks";

export function createPendingTaskTracker() {
  const pendingCount = ref(0);
  const running = computed(() => pendingCount.value > 0);
  const taskIds = new Set<string>();
  let generation = 0;

  function reset() {
    generation += 1;
    pendingCount.value = 0;
    for (const taskId of taskIds) {
      finishBackgroundTask(taskId);
    }
    taskIds.clear();
  }

  async function run<T>(task: () => Promise<T>, descriptor?: BackgroundTaskDescriptor) {
    const runGeneration = generation;
    const taskId = descriptor ? beginBackgroundTask(descriptor) : null;
    if (taskId) taskIds.add(taskId);
    pendingCount.value += 1;
    try {
      return await task();
    } finally {
      if (taskId) {
        taskIds.delete(taskId);
        finishBackgroundTask(taskId);
      }
      if (runGeneration === generation) {
        pendingCount.value = Math.max(0, pendingCount.value - 1);
      }
    }
  }

  return {
    reset,
    run,
    running,
  };
}

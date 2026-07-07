import { computed, ref } from "vue";
import {
  beginBackgroundTask,
  completeBackgroundTask,
  failBackgroundTask,
  finishBackgroundTask,
  onBackgroundTaskRemoved,
  type BackgroundTaskDescriptor,
} from "./useBackgroundTasks";

export function createPendingTaskTracker() {
  const pendingCount = ref(0);
  const running = computed(() => pendingCount.value > 0);
  const taskIds = new Set<string>();
  const taskIdCleanups = new Map<string, () => void>();
  let generation = 0;

  function reset() {
    generation += 1;
    pendingCount.value = 0;
    for (const cleanup of taskIdCleanups.values()) cleanup();
    taskIdCleanups.clear();
    for (const taskId of taskIds) {
      finishBackgroundTask(taskId);
    }
    taskIds.clear();
  }

  async function run<T>(task: () => Promise<T>, descriptor?: BackgroundTaskDescriptor) {
    const runGeneration = generation;
    const taskId = descriptor ? beginBackgroundTask(descriptor) : null;
    if (taskId) {
      taskIds.add(taskId);
      taskIdCleanups.set(taskId, onBackgroundTaskRemoved(taskId, () => {
        taskIds.delete(taskId);
        taskIdCleanups.delete(taskId);
      }));
    }
    pendingCount.value += 1;
    try {
      const result = await task();
      completeBackgroundTask(taskId);
      return result;
    } catch (err) {
      failBackgroundTask(taskId, String(err));
      throw err;
    } finally {
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

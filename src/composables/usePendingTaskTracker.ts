import { computed, ref } from "vue";

export function createPendingTaskTracker() {
  const pendingCount = ref(0);
  const running = computed(() => pendingCount.value > 0);
  let generation = 0;

  function reset() {
    generation += 1;
    pendingCount.value = 0;
  }

  async function run<T>(task: () => Promise<T>) {
    const runGeneration = generation;
    pendingCount.value += 1;
    try {
      return await task();
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

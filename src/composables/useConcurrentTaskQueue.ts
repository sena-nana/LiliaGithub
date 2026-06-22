import type { Ref } from "vue";

export type ConcurrentTaskQueueOptions<TTask> = {
  concurrency: number;
  key: (task: TTask) => string;
  loading: Ref<boolean>;
  pendingCount: Ref<number>;
  canRun: () => boolean;
  isCurrent: (task: TTask) => boolean;
  worker: (task: TTask) => Promise<void>;
};

export function createConcurrentTaskQueue<TTask>(options: ConcurrentTaskQueueOptions<TTask>) {
  let queue: TTask[] = [];
  let inFlightCount = 0;
  let pendingKeys = new Set<string>();

  function syncLoading() {
    options.loading.value = options.pendingCount.value > 0;
  }

  function enqueue(tasks: readonly TTask[]) {
    let queuedCount = 0;
    for (const task of tasks) {
      const key = options.key(task);
      if (pendingKeys.has(key)) continue;
      pendingKeys.add(key);
      queue.push(task);
      queuedCount += 1;
    }
    if (!queuedCount) return;
    options.pendingCount.value += queuedCount;
    syncLoading();
  }

  function drain() {
    while (options.canRun() && inFlightCount < options.concurrency && queue.length) {
      const task = queue.shift();
      if (!task) return;
      const key = options.key(task);
      inFlightCount += 1;
      void (async () => {
        try {
          await options.worker(task);
        } catch {
          // Individual task workers normalize expected failures; keep queued work moving.
        } finally {
          if (!options.isCurrent(task)) return;
          pendingKeys.delete(key);
          inFlightCount = Math.max(0, inFlightCount - 1);
          options.pendingCount.value = Math.max(0, options.pendingCount.value - 1);
          syncLoading();
          drain();
        }
      })();
    }
  }

  function reset() {
    queue = [];
    pendingKeys = new Set<string>();
    inFlightCount = 0;
    options.pendingCount.value = 0;
    syncLoading();
  }

  return {
    drain,
    enqueue,
    reset,
  };
}

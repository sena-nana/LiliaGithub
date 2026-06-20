import { ref } from "vue";
import { describe, expect, it } from "vitest";
import { createConcurrentTaskQueue } from "../src/composables/useConcurrentTaskQueue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("createConcurrentTaskQueue", () => {
  it("按 key 去重并按并发数启动任务", async () => {
    const pendingCount = ref(0);
    const loading = ref(false);
    const first = deferred();
    const started: string[] = [];
    const queue = createConcurrentTaskQueue({
      concurrency: 2,
      key: (task: { key: string }) => task.key,
      pendingCount,
      loading,
      canRun: () => true,
      isCurrent: () => true,
      worker: async (task) => {
        started.push(task.key);
        if (task.key === "a") await first.promise;
      },
    });

    queue.enqueue([{ key: "a" }, { key: "a" }, { key: "b" }, { key: "c" }]);
    queue.drain();

    expect(started).toEqual(["a", "b"]);
    expect(pendingCount.value).toBe(3);
    expect(loading.value).toBe(true);

    first.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(started).toEqual(["a", "b", "c"]);
    expect(pendingCount.value).toBe(0);
    expect(loading.value).toBe(false);
  });

  it("运行中的同 key 任务保持去重直到完成", async () => {
    const pendingCount = ref(0);
    const loading = ref(false);
    const first = deferred();
    const started: string[] = [];
    const queue = createConcurrentTaskQueue({
      concurrency: 1,
      key: (task: { key: string }) => task.key,
      pendingCount,
      loading,
      canRun: () => true,
      isCurrent: () => true,
      worker: async (task) => {
        started.push(task.key);
        if (task.key === "a") await first.promise;
      },
    });

    queue.enqueue([{ key: "a" }]);
    queue.drain();
    queue.enqueue([{ key: "a" }, { key: "b" }]);

    expect(started).toEqual(["a"]);
    expect(pendingCount.value).toBe(2);

    first.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(started).toEqual(["a", "b"]);
    expect(pendingCount.value).toBe(0);
    expect(loading.value).toBe(false);
  });

  it("reset 后旧任务完成不会影响新的 pending 状态", async () => {
    const pendingCount = ref(0);
    const loading = ref(false);
    const oldTask = deferred();
    let generation = 1;
    const queue = createConcurrentTaskQueue({
      concurrency: 1,
      key: (task: { key: string }) => task.key,
      pendingCount,
      loading,
      canRun: () => true,
      isCurrent: (task: { generation: number }) => task.generation === generation,
      worker: async (task) => {
        if (task.generation === 1) await oldTask.promise;
      },
    });

    queue.enqueue([{ key: "old", generation: 1 }]);
    queue.drain();
    expect(pendingCount.value).toBe(1);

    generation = 2;
    queue.reset();
    queue.enqueue([{ key: "new", generation: 2 }]);
    expect(pendingCount.value).toBe(1);

    oldTask.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pendingCount.value).toBe(1);
    expect(loading.value).toBe(true);

    queue.drain();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pendingCount.value).toBe(0);
    expect(loading.value).toBe(false);
  });
});

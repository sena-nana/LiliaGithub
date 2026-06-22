import { describe, expect, it } from "vitest";
import { createPendingTaskTracker } from "../src/composables/usePendingTaskTracker";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("createPendingTaskTracker", () => {
  it("多个任务重叠时直到最后一个完成才结束 running", async () => {
    const tracker = createPendingTaskTracker();
    const first = deferred();
    const second = deferred();

    const firstRun = tracker.run(() => first.promise);
    const secondRun = tracker.run(() => second.promise);

    expect(tracker.running.value).toBe(true);

    first.resolve();
    await firstRun;

    expect(tracker.running.value).toBe(true);

    second.resolve();
    await secondRun;

    expect(tracker.running.value).toBe(false);
  });

  it("reset 后旧任务完成不会清掉新的 running 状态", async () => {
    const tracker = createPendingTaskTracker();
    const oldTask = deferred();
    const newTask = deferred();

    const oldRun = tracker.run(() => oldTask.promise);
    expect(tracker.running.value).toBe(true);

    tracker.reset();
    const newRun = tracker.run(() => newTask.promise);
    expect(tracker.running.value).toBe(true);

    oldTask.resolve();
    await oldRun;

    expect(tracker.running.value).toBe(true);

    newTask.resolve();
    await newRun;

    expect(tracker.running.value).toBe(false);
  });
});

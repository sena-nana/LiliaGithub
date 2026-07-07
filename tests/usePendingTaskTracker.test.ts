import { afterEach, describe, expect, it, vi } from "vitest";
import { useBackgroundTasks } from "../src/composables/useBackgroundTasks";
import { createPendingTaskTracker } from "../src/composables/usePendingTaskTracker";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("createPendingTaskTracker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("带任务描述运行时进入后台任务列表并在完成后移除", async () => {
    vi.useFakeTimers();
    const tracker = createPendingTaskTracker();
    const pending = deferred();
    const backgroundTasks = useBackgroundTasks();

    const run = tracker.run(() => pending.promise, {
      kind: "git",
      title: "推送当前分支",
      repoId: "repo-1",
      repoName: "LiliaGithub",
      priority: "high",
    });

    expect(backgroundTasks.runningTaskCount.value).toBe(1);
    expect(backgroundTasks.tasks.value[0]).toMatchObject({
      title: "推送当前分支",
      repoName: "LiliaGithub",
      status: "running",
    });

    pending.resolve();
    await run;

    expect(tracker.running.value).toBe(false);
    expect(backgroundTasks.runningTaskCount.value).toBe(1);
    expect(backgroundTasks.tasks.value[0]).toMatchObject({
      title: "推送当前分支",
      repoName: "LiliaGithub",
      status: "success",
      detail: "已完成",
    });

    await vi.advanceTimersByTimeAsync(1600);
    expect(backgroundTasks.runningTaskCount.value).toBe(0);
  });

  it("任务失败时保留失败状态并记录失败原因", async () => {
    vi.useFakeTimers();
    const tracker = createPendingTaskTracker();
    const backgroundTasks = useBackgroundTasks();

    await expect(tracker.run(() => Promise.reject(new Error("推送失败")), {
      kind: "git",
      title: "推送当前分支",
      repoName: "LiliaGithub",
      priority: "high",
    })).rejects.toThrow("推送失败");

    expect(tracker.running.value).toBe(false);
    expect(backgroundTasks.runningTaskCount.value).toBe(1);
    expect(backgroundTasks.tasks.value[0]).toMatchObject({
      title: "推送当前分支",
      status: "failed",
      detail: "失败：Error: 推送失败",
    });

    await vi.advanceTimersByTimeAsync(9000);
    expect(backgroundTasks.runningTaskCount.value).toBe(0);
  });

  it("reset 会清理当前 tracker 创建的后台任务", async () => {
    vi.useFakeTimers();
    const tracker = createPendingTaskTracker();
    const oldTask = deferred();
    const newTask = deferred();
    const backgroundTasks = useBackgroundTasks();

    const oldRun = tracker.run(() => oldTask.promise, {
      kind: "git",
      title: "旧任务",
      repoName: "Repo",
    });
    expect(backgroundTasks.tasks.value.map((task) => task.title)).toEqual(["旧任务"]);

    tracker.reset();
    expect(backgroundTasks.runningTaskCount.value).toBe(0);

    const newRun = tracker.run(() => newTask.promise, {
      kind: "git",
      title: "新任务",
      repoName: "Repo",
    });

    oldTask.resolve();
    await oldRun;

    expect(backgroundTasks.tasks.value.map((task) => task.title)).toEqual(["新任务"]);

    newTask.resolve();
    await newRun;
  });
});

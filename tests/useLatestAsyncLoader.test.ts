import { describe, expect, it } from "vitest";
import { invalidateSessionContextSnapshot, resetSessionContextForTests } from "../src/composables/sessionContext";
import { createComponentEpoch } from "../src/composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../src/composables/useLatestAsyncLoader";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("createLatestAsyncLoader", () => {
  it("显式开启时同 key 请求复用当前 pending 任务", async () => {
    const loader = createLatestAsyncLoader();
    const first = deferred();
    let runs = 0;

    const running = loader.run("open", async () => {
      runs += 1;
      await first.promise;
    }, { reusePending: true });
    const joined = loader.run("open", async () => {
      runs += 1;
    }, { reusePending: true });

    expect(loader.isPending("open")).toBe(true);
    expect(runs).toBe(1);

    first.resolve();
    await Promise.all([running, joined]);
    expect(loader.isPending("open")).toBe(false);
    expect(runs).toBe(1);
  });

  it("默认让同 key 新任务覆盖旧任务", async () => {
    const loader = createLatestAsyncLoader();
    const first = deferred();
    const second = deferred();
    const currentStates: boolean[] = [];

    const firstRun = loader.run("open", async (runId) => {
      await first.promise;
      currentStates.push(loader.isCurrent(runId));
    });
    const secondRun = loader.run("closed", async (runId) => {
      await second.promise;
      currentStates.push(loader.isCurrent(runId));
    });

    first.resolve();
    second.resolve();
    await Promise.all([firstRun, secondRun]);

    expect(currentStates).toEqual([false, true]);
  });

  it("invalidate 会清掉 pending 并使旧 runId 失效", async () => {
    const loader = createLatestAsyncLoader();
    const first = deferred();
    let currentAfterInvalidate = true;

    const running = loader.run(null, async (runId) => {
      await first.promise;
      currentAfterInvalidate = loader.isCurrent(runId);
    });

    expect(loader.isPending()).toBe(true);
    loader.invalidate();
    expect(loader.isPending()).toBe(false);

    first.resolve();
    await running;
    expect(currentAfterInvalidate).toBe(false);
  });

  it("任务同步抛错时也会清理 pending", async () => {
    const loader = createLatestAsyncLoader();

    await expect(loader.run("open", () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");

    expect(loader.isPending()).toBe(false);
  });

  it("绑定 componentEpoch 后组件失活会让当前任务不可更新", async () => {
    const componentEpoch = createComponentEpoch();
    const loader = createLatestAsyncLoader({ componentEpoch });
    const first = deferred();
    let currentAfterDispose = true;

    const running = loader.run("repo", async (runId) => {
      await first.promise;
      currentAfterDispose = loader.isCurrent(runId);
    });

    expect(loader.isPending("repo")).toBe(true);
    componentEpoch.dispose();
    first.resolve();
    await running;

    expect(currentAfterDispose).toBe(false);
    expect(loader.isPending()).toBe(false);
  });

  it("会话上下文失效后当前任务不可更新", async () => {
    resetSessionContextForTests();
    const loader = createLatestAsyncLoader();
    const first = deferred();
    let currentAfterInvalidation = true;

    const running = loader.run("repo", async (runId) => {
      await first.promise;
      currentAfterInvalidation = loader.isCurrent(runId);
    });

    expect(loader.isPending("repo")).toBe(true);
    invalidateSessionContextSnapshot();
    first.resolve();
    await running;

    expect(currentAfterInvalidation).toBe(false);
    expect(loader.isPending()).toBe(false);
  });

  it("关闭会话上下文跟踪后当前任务不受会话失效影响", async () => {
    resetSessionContextForTests();
    const loader = createLatestAsyncLoader({ trackSessionContext: false });
    const first = deferred();
    let currentAfterInvalidation = false;

    const running = loader.run("repo", async (runId) => {
      await first.promise;
      currentAfterInvalidation = loader.isCurrent(runId);
    });

    expect(loader.isPending("repo")).toBe(true);
    invalidateSessionContextSnapshot();
    first.resolve();
    await running;

    expect(currentAfterInvalidation).toBe(true);
    expect(loader.isPending()).toBe(false);
  });
});

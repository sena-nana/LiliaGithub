export type AsyncLoaderKey = string | number | null | undefined;

export interface LatestAsyncLoaderRunOptions {
  reusePending?: boolean;
}

export function createLatestAsyncLoader() {
  let currentRunId = 0;
  let pendingKey: AsyncLoaderKey = null;
  let pending: Promise<void> | null = null;

  function isCurrent(runId: number) {
    return runId === currentRunId;
  }

  function isPending(key?: AsyncLoaderKey) {
    if (!pending) return false;
    return arguments.length === 0 || Object.is(pendingKey, key);
  }

  async function waitPending(key?: AsyncLoaderKey) {
    const activePending = pending;
    if (!activePending) return;
    if (arguments.length > 0 && !Object.is(pendingKey, key)) return;
    await activePending;
  }

  async function run(
    key: AsyncLoaderKey,
    task: (runId: number) => Promise<void>,
    options: LatestAsyncLoaderRunOptions = {},
  ) {
    if (options.reusePending && isPending(key)) {
      await waitPending(key);
      return;
    }
    const runId = ++currentRunId;
    pendingKey = key;
    let taskResult: Promise<void>;
    try {
      taskResult = task(runId);
    } catch (err) {
      taskResult = Promise.reject(err);
    }
    const next = taskResult.finally(() => {
      if (isCurrent(runId)) {
        pending = null;
        pendingKey = null;
      }
    });
    pending = next;
    await next;
  }

  function invalidate() {
    currentRunId += 1;
    pending = null;
    pendingKey = null;
  }

  return {
    invalidate,
    isCurrent,
    isPending,
    run,
    waitPending,
  };
}

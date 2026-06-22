import type { ComponentEpoch } from "./useComponentEpoch";
import { getSessionContextVersion, isSessionContextVersionCurrent } from "./sessionContext";

export type AsyncLoaderKey = string | number | null | undefined;

export interface LatestAsyncLoaderRunOptions {
  reusePending?: boolean;
}

export interface LatestAsyncLoaderOptions {
  componentEpoch?: Pick<ComponentEpoch, "assertAlive">;
}

export function createLatestAsyncLoader(options: LatestAsyncLoaderOptions = {}) {
  let currentRunId = 0;
  let pendingKey: AsyncLoaderKey = null;
  let pending: Promise<void> | null = null;
  let currentRunSessionContextVersion = getSessionContextVersion();

  function isLatestRun(runId: number) {
    return runId === currentRunId;
  }

  function isCurrent(runId: number) {
    return isLatestRun(runId) &&
      (options.componentEpoch?.assertAlive() ?? true) &&
      isSessionContextVersionCurrent(currentRunSessionContextVersion);
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
    currentRunSessionContextVersion = getSessionContextVersion();
    pendingKey = key;
    let taskResult: Promise<void>;
    try {
      taskResult = task(runId);
    } catch (err) {
      taskResult = Promise.reject(err);
    }
    const next = taskResult.finally(() => {
      if (isLatestRun(runId)) {
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
    currentRunSessionContextVersion = getSessionContextVersion();
  }

  return {
    invalidate,
    isCurrent,
    isPending,
    run,
    waitPending,
  };
}

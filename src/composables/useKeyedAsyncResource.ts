import { readonly, shallowRef, type ShallowRef } from "vue";
import type { ComponentEpoch } from "./useComponentEpoch";
import { resolveSessionContext, type SessionContext } from "./sessionContext";

export type AsyncResourceStatus = "idle" | "loading" | "ready" | "error";

export interface AsyncResourceSnapshot<TKey, TValue> {
  key: TKey | null;
  status: AsyncResourceStatus;
  data: TValue | null;
  error: unknown | null;
  refreshing: boolean;
}

export interface KeyedAsyncResourceOptions<TKey> {
  componentEpoch?: Pick<ComponentEpoch, "assertAlive">;
  trackSessionContext?: boolean;
  sessionContext?: SessionContext;
  equal?: (left: TKey, right: TKey) => boolean;
}

export interface AsyncResourceLoadOptions {
  preserveData?: boolean;
  reusePending?: boolean;
}

/**
 * Owns the complete state transition for one keyed asynchronous resource.
 * A result can only commit while its generation, key, component and session
 * context are all still current.
 */
export function createKeyedAsyncResource<TKey, TValue>(options: KeyedAsyncResourceOptions<TKey> = {}) {
  const sessionContext = options.trackSessionContext === false
    ? null
    : resolveSessionContext(options.sessionContext);
  const equal = options.equal ?? Object.is;
  const state = shallowRef<AsyncResourceSnapshot<TKey, TValue>>({
    key: null,
    status: "idle",
    data: null,
    error: null,
    refreshing: false,
  });
  const publicState = readonly(state) as Readonly<ShallowRef<AsyncResourceSnapshot<TKey, TValue>>>;
  let generation = 0;
  let pending: { key: TKey; promise: Promise<TValue | null> } | null = null;

  function isCurrent(runGeneration: number, key: TKey, sessionVersion: number) {
    return runGeneration === generation &&
      state.value.key !== null &&
      equal(state.value.key, key) &&
      (options.componentEpoch?.assertAlive() ?? true) &&
      (sessionContext?.isCurrent(sessionVersion) ?? true);
  }

  async function load(
    key: TKey,
    loader: () => Promise<TValue>,
    loadOptions: AsyncResourceLoadOptions = {},
  ): Promise<TValue | null> {
    if (loadOptions.reusePending && pending && equal(pending.key, key)) return pending.promise;

    const runGeneration = ++generation;
    const sessionVersion = sessionContext?.capture() ?? 0;
    const previous = state.value;
    const preserveData = loadOptions.preserveData !== false &&
      previous.key !== null && equal(previous.key, key);
    state.value = {
      key,
      status: preserveData && previous.data !== null ? previous.status : "loading",
      data: preserveData ? previous.data : null,
      error: null,
      refreshing: preserveData && previous.data !== null,
    };

    const promise = (async () => {
      try {
        const data = await loader();
        if (!isCurrent(runGeneration, key, sessionVersion)) return null;
        state.value = { key, status: "ready", data, error: null, refreshing: false };
        return data;
      } catch (error) {
        if (!isCurrent(runGeneration, key, sessionVersion)) return null;
        const currentData = state.value.data;
        state.value = { key, status: "error", data: currentData, error, refreshing: false };
        return null;
      }
    })();
    pending = { key, promise };
    void promise.finally(() => {
      if (pending?.promise === promise) pending = null;
    });
    return promise;
  }

  function invalidate() {
    generation += 1;
    pending = null;
    state.value = { key: null, status: "idle", data: null, error: null, refreshing: false };
  }

  function update(key: TKey, updater: (current: TValue | null) => TValue) {
    if (state.value.key === null || !equal(state.value.key, key)) return false;
    state.value = {
      ...state.value,
      data: updater(state.value.data),
      status: "ready",
      error: null,
    };
    return true;
  }

  function set(key: TKey, data: TValue) {
    generation += 1;
    pending = null;
    state.value = { key, status: "ready", data, error: null, refreshing: false };
  }

  return {
    state: publicState,
    load,
    invalidate,
    set,
    update,
  };
}

export interface AsyncModuleLoadState {
  loaded: boolean;
  loading: boolean;
  attempts: number;
  retryCount: number;
  error: string | null;
}

export interface CachedAsyncModule<T> {
  readonly state: Readonly<AsyncModuleLoadState>;
  load: () => Promise<T>;
}

export function createCachedAsyncModule<T>(
  loader: () => Promise<T>,
): CachedAsyncModule<T> {
  const state: AsyncModuleLoadState = {
    loaded: false,
    loading: false,
    attempts: 0,
    retryCount: 0,
    error: null,
  };
  let loadedModule: T | null = null;
  let pendingModule: Promise<T> | null = null;

  async function load() {
    if (state.loaded) return loadedModule as T;
    if (pendingModule) return pendingModule;

    state.loading = true;
    state.attempts += 1;
    pendingModule = loader()
      .then((module) => {
        loadedModule = module;
        state.loaded = true;
        state.error = null;
        return module;
      })
      .catch((err) => {
        state.retryCount += 1;
        state.error = String(err);
        throw err;
      })
      .finally(() => {
        state.loading = false;
        pendingModule = null;
      });
    return pendingModule;
  }

  return {
    state,
    load,
  };
}

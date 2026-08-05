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
  let attempts = 0;
  let retryCount = 0;
  const lazy = createLazyLoadState(async () => {
    attempts += 1;
    try {
      return await loader();
    } catch (error) {
      retryCount += 1;
      throw error;
    }
  });
  const state: AsyncModuleLoadState = {
    get loaded() { return lazy.loaded.value; },
    get loading() { return lazy.loading.value; },
    get attempts() { return attempts; },
    get retryCount() { return retryCount; },
    get error() { return lazy.error.value === null ? null : String(lazy.error.value); },
  };

  return {
    state,
    load: lazy.load,
  };
}
import { createLazyLoadState } from "@lilia/ui/utils/lazyLoadState";

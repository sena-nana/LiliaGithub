import { defineAsyncComponent, type Component } from "vue";
import { createCachedAsyncModule, type AsyncModuleLoadState } from "./asyncModule";

export interface CachedAsyncComponent<T extends Component = Component> {
  component: T;
  load: () => Promise<T | { default: T }>;
  state: Readonly<AsyncModuleLoadState>;
}

export function createCachedAsyncComponent<T extends Component>(
  loader: () => Promise<T | { default: T }>,
): CachedAsyncComponent<T> {
  const module = createCachedAsyncModule(loader);

  return {
    component: defineAsyncComponent(module.load) as T,
    load: module.load,
    state: module.state,
  };
}

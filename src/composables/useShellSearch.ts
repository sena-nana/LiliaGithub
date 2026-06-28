import { inject, provide, type InjectionKey, type Ref } from "vue";

export interface ShellSearchControls {
  searchOpen: Ref<boolean>;
  toggleSearch: () => void | Promise<void>;
}

const shellSearchKey: InjectionKey<ShellSearchControls> = Symbol("shellSearch");

export function provideShellSearch(controls: ShellSearchControls) {
  provide(shellSearchKey, controls);
}

export function useShellSearch() {
  return inject(shellSearchKey, null);
}

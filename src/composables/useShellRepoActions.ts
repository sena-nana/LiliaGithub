import { inject, provide, type InjectionKey, type Ref } from "vue";

export interface ShellRepoActions {
  searchOpen: Ref<boolean>;
  openCloneDialog: () => void;
  toggleSearch: () => void | Promise<void>;
}

const shellRepoActionsKey: InjectionKey<ShellRepoActions> = Symbol("shellRepoActions");

export function provideShellRepoActions(actions: ShellRepoActions) {
  provide(shellRepoActionsKey, actions);
}

export function useShellRepoActions() {
  return inject(shellRepoActionsKey, null);
}

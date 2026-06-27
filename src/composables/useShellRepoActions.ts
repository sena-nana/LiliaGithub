import { inject, provide, type Component, type InjectionKey, type Ref } from "vue";

export type ShellPaletteCommand = {
  id: string;
  label: string;
  detail: string;
  keywords: string;
  icon: Component;
  run: () => unknown | Promise<unknown>;
  disabled?: boolean;
};

export interface ShellRepoActions {
  searchOpen: Ref<boolean>;
  toggleSearch: () => void | Promise<void>;
  homeRepoCreateCommands: Ref<readonly ShellPaletteCommand[]>;
}

const shellRepoActionsKey: InjectionKey<ShellRepoActions> = Symbol("shellRepoActions");

export function provideShellRepoActions(actions: ShellRepoActions) {
  provide(shellRepoActionsKey, actions);
}

export function useShellRepoActions() {
  return inject(shellRepoActionsKey, null);
}

import { computed } from "vue";
import type { AccountPreferences, GitHubRepositoryScope } from "../services/workspace";
import { useWorkspace } from "./useWorkspace";

export const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = {
  defaultWorkspaceRoot: null,
  repositoryScope: { kind: "all" },
  repositorySort: { key: "updated", direction: "desc" },
  issues: { state: "open", sort: "created", direction: "desc" },
  pullRequests: { state: "open", sort: "updated", direction: "desc" },
  actions: { state: "all", sort: "updated", direction: "desc" },
};

export function cloneAccountPreferences(value: AccountPreferences): AccountPreferences {
  return {
    defaultWorkspaceRoot: value.defaultWorkspaceRoot,
    repositoryScope: { ...value.repositoryScope } as GitHubRepositoryScope,
    repositorySort: { ...value.repositorySort },
    issues: { ...value.issues },
    pullRequests: { ...value.pullRequests },
    actions: { ...value.actions },
  };
}

export function useAccountPreferences() {
  const workspace = useWorkspace();
  return computed(() => workspace.state.settings?.accountPreferences ?? DEFAULT_ACCOUNT_PREFERENCES);
}

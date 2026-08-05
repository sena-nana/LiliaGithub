import { useWorkspaceStore } from "./workspace/store";

/**
 * Compatibility facade while page controllers migrate to feature slices.
 * It only resolves the app-provided store and owns no state or runtime work.
 */
export function useWorkspace() {
  return useWorkspaceStore();
}

import { computed, ref } from "vue";
import type { WorkspaceStore } from "../workspace/store";

export function useHomeSetupController(workspace: WorkspaceStore) {
  const activeWorkspace = computed(() => workspace.activeWorkspace.value);
  const hasAvailableWorkspaceRoot = computed(() => workspace.hasAvailableWorkspaceRoot.value);
  const createOpen = ref(false);
  const createName = ref("");
  const createRoot = ref("");
  const createBusy = ref(false);
  const choosingRoot = ref(false);

  async function chooseRoot() {
    if (choosingRoot.value) return;
    choosingRoot.value = true;
    try {
      const root = await workspace.pickWorkspaceRoot();
      if (!root) return;
      const active = activeWorkspace.value;
      if (active) {
        await workspace.addWorkspaceRoot(active.id, root);
        return;
      }
      createRoot.value = root;
      const segments = root.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
      createName.value = segments[segments.length - 1] ?? "默认工作区";
      createOpen.value = true;
    } catch {
      // Workspace lifecycle owns and exposes the user-facing failure state.
    } finally {
      choosingRoot.value = false;
    }
  }

  async function createInitialWorkspace() {
    const name = createName.value.trim();
    if (!name || createBusy.value) return;
    createBusy.value = true;
    try {
      await workspace.createWorkspace(name, createRoot.value);
      createOpen.value = false;
    } finally {
      createBusy.value = false;
    }
  }

  return {
    activeWorkspace,
    hasAvailableWorkspaceRoot,
    createOpen,
    createName,
    createRoot,
    createBusy,
    choosingRoot,
    chooseRoot,
    createInitialWorkspace,
  };
}

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useWorkspace } from "../composables/useWorkspace";
import { useWorkspaceRecentContext } from "../composables/useWorkspaceRecentContext";

const workspaceRecentContext = useWorkspaceRecentContext();
const workspace = useWorkspace();

let cleanupEffects: (() => void) | null = null;
let disposed = false;

onMounted(async () => {
  await workspaceRecentContext.initialize();
  if (disposed) return;
  const [cleanupFocus, cleanupLaunch, cleanupRepoRefresh] = await Promise.all([
    workspace.installWorkspaceFocusRefresh(),
    workspace.installLaunchStatusEvents(),
    workspace.installRepoRefreshEvents(),
  ]);
  const cleanup = () => {
    cleanupFocus();
    cleanupLaunch();
    cleanupRepoRefresh();
  };
  if (disposed) {
    cleanup();
    return;
  }
  cleanupEffects = cleanup;
});

onUnmounted(() => {
  disposed = true;
  workspaceRecentContext.dispose();
  cleanupEffects?.();
  cleanupEffects = null;
});
</script>

<template></template>

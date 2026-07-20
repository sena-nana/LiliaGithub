<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { installLiliaGithubAgentDebugCompat } from "../agentDebug/compat";
import { installWorkspaceFocusRefresh } from "../composables/workspace/lifecycle";
import { installLaunchStatusEvents } from "../composables/workspace/launchEvents";
import { installRepoRefreshEvents } from "../composables/workspace/repoRefreshEvents";
import { useWorkspaceRecentContext } from "../composables/useWorkspaceRecentContext";

const workspaceRecentContext = useWorkspaceRecentContext();

let cleanupEffects: (() => void) | null = null;
let cleanupDebug: (() => void) | null = null;
let disposed = false;

onMounted(async () => {
  cleanupDebug = installLiliaGithubAgentDebugCompat();
  await workspaceRecentContext.initialize();
  if (disposed) return;
  const [cleanupFocus, cleanupLaunch, cleanupRepoRefresh] = await Promise.all([
    installWorkspaceFocusRefresh(),
    installLaunchStatusEvents(),
    installRepoRefreshEvents(),
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
  cleanupDebug?.();
  cleanupDebug = null;
  cleanupEffects?.();
  cleanupEffects = null;
});
</script>

<template></template>

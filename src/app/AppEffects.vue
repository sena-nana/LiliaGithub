<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { installLiliaGithubAgentDebugCompat } from "../agentDebug/compat";
import { useWorkspace } from "../composables/useWorkspace";
import { installWorkspaceFocusRefresh } from "../composables/workspace/lifecycle";
import { installLaunchStatusEvents } from "../composables/workspace/launchEvents";
import { installRepoRefreshEvents } from "../composables/workspace/repoRefreshEvents";

const workspace = useWorkspace();
if (!workspace.isReady.value && !workspace.state.loading) {
  void workspace.initialize();
}

let cleanupEffects: (() => void) | null = null;
let disposed = false;

onMounted(async () => {
  const cleanupDebug = installLiliaGithubAgentDebugCompat();
  const [cleanupFocus, cleanupLaunch, cleanupRepoRefresh] = await Promise.all([
    installWorkspaceFocusRefresh(),
    installLaunchStatusEvents(),
    installRepoRefreshEvents(),
  ]);
  const cleanup = () => {
    cleanupDebug();
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
  cleanupEffects?.();
  cleanupEffects = null;
});
</script>

<template></template>

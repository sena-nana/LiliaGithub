<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { installLiliaGithubAgentDebugCompat } from "../agentDebug/compat";
import { useWorkspace } from "../composables/useWorkspace";
import { installWorkspaceFocusRefresh } from "../composables/workspace/lifecycle";
import { installLaunchStatusEvents } from "../composables/workspace/launchEvents";
import { installRepoChangedEvents } from "../composables/workspace/repoChangedEvents";

const workspace = useWorkspace();
if (!workspace.isReady.value && !workspace.state.loading) {
  void workspace.initialize();
}

let cleanupEffects: (() => void) | null = null;
let disposed = false;

onMounted(async () => {
  const cleanupDebug = installLiliaGithubAgentDebugCompat();
  const [cleanupFocus, cleanupLaunch, cleanupRepoChanged] = await Promise.all([
    installWorkspaceFocusRefresh(),
    installLaunchStatusEvents(),
    installRepoChangedEvents(),
  ]);
  const cleanup = () => {
    cleanupDebug();
    cleanupFocus();
    cleanupLaunch();
    cleanupRepoChanged();
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

<script setup lang="ts">
import { useContextMenu } from "@lilia/ui/composables/useContextMenu";
import { computed, defineAsyncComponent } from "vue";
import { RouterView } from "vue-router";
import AppEffects from "./AppEffects.vue";

const ContextMenuHost = defineAsyncComponent(
  () => import("@lilia/ui/components/ContextMenuHost"),
);
const { state: contextMenuState } = useContextMenu();
const shouldMountContextMenuHost = computed(() => contextMenuState.openSeq > 0);
</script>

<template>
  <RouterView />
  <ContextMenuHost v-if="shouldMountContextMenuHost" />
  <AppEffects />
</template>

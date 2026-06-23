<script setup lang="ts">
import { RouterView } from "vue-router";
import { createCachedAsyncComponent } from "./utils/asyncComponent";

const contextMenuHostModule = createCachedAsyncComponent(() => import("./components/ContextMenuHost.vue"));
const ContextMenuHost = contextMenuHostModule.component;
</script>

<template>
  <RouterView />
  <ContextMenuHost />
</template>

<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import { RouterView } from "vue-router";

const ContextMenuHost = defineAsyncComponent(() => import("./components/ContextMenuHost.vue"));
</script>

<template>
  <RouterView />
  <ContextMenuHost />
</template>

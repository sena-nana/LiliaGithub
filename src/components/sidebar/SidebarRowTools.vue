<script setup lang="ts">
import type { SidebarActionItem } from "../../config/appShell";

defineProps<{
  tools: SidebarActionItem[];
}>();
</script>

<template>
  <div class="sb-tree__hover-tools" @click.stop>
    <button
      v-for="tool in tools"
      :key="tool.key"
      type="button"
      class="sb-icon-btn"
      :title="tool.label"
      :aria-label="tool.label"
      :disabled="tool.disabled"
    >
      <component :is="tool.icon" :size="13" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.sb-tree__hover-tools {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.sb-icon-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.sb-icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
  filter: none;
}
</style>

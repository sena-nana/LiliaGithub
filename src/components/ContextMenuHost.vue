<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import {
  isContextMenuItemPending,
  selectContextMenuItem,
  useContextMenu,
  type ContextMenuItem,
} from "../composables/useContextMenu";

const { state } = useContextMenu();

const menuEl = ref<HTMLElement | null>(null);
const pos = ref({ x: 0, y: 0 });

function displayLabel(item: ContextMenuItem) {
  return isContextMenuItemPending(item) ? item.confirmLabel : item.label;
}

function isDanger(item: ContextMenuItem) {
  return item.danger || isContextMenuItemPending(item);
}

watch(
  () => state.open,
  async (open) => {
    if (!open) return;
    pos.value = { x: state.x, y: state.y };
    await nextTick();
    const element = menuEl.value;
    if (!element) return;
    const x = Math.max(4, Math.min(state.x, window.innerWidth - element.offsetWidth - 4));
    const y = Math.max(4, Math.min(state.y, window.innerHeight - element.offsetHeight - 4));
    pos.value = { x, y };
  },
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.open"
      ref="menuEl"
      class="ctx-menu"
      role="menu"
      :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
    >
      <button
        v-for="(item, index) in state.items"
        :key="item.id ?? index"
        type="button"
        class="ctx-menu__item"
        :class="{
          'ctx-menu__item--danger': isDanger(item),
          'ctx-menu__item--pending': isContextMenuItemPending(item),
        }"
        :disabled="item.disabled"
        role="menuitem"
        @click="selectContextMenuItem(item)"
      >
        <component v-if="item.icon" :is="item.icon" :size="13" aria-hidden="true" />
        <span class="ctx-menu__label">{{ displayLabel(item) }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 2000;
  min-width: 180px;
  max-width: min(320px, calc(100vw - 8px));
  padding: 4px;
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  box-shadow: 0 10px 28px -10px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  gap: 1px;
  user-select: none;
}

.ctx-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 28px;
  min-width: 0;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.ctx-menu__item:hover:not(:disabled) {
  background: var(--bg-hover);
  filter: none;
}

.ctx-menu__item:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.ctx-menu__item:disabled:hover {
  background: transparent;
}

.ctx-menu__item--danger {
  color: var(--err);
}

.ctx-menu__item--danger:hover:not(:disabled) {
  background: var(--err-soft);
}

.ctx-menu__item--pending {
  background: var(--err-soft);
  font-weight: 600;
}

.ctx-menu__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

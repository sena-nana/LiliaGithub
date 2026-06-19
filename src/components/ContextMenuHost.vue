<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import {
  finalizeClosedContextMenu,
  isContextMenuItemPending,
  selectContextMenuItem,
  useContextMenu,
  type ContextMenuItem,
} from "../composables/useContextMenu";
import {
  clampAnchoredMenuPosition,
  createAnchoredMenuPosition,
  resolveMenuTransformOrigin,
  SB_MENU_POP_TRANSITION_MS,
} from "../composables/menuMotion";

const { state } = useContextMenu();

const menuEl = ref<HTMLElement | null>(null);
const rendered = ref(false);
const pos = ref(createAnchoredMenuPosition(0, 0));
const origin = ref({ x: 0, y: 0 });
const activeSubmenuIndex = ref<number | null>(null);

function displayLabel(item: ContextMenuItem) {
  return isContextMenuItemPending(item) ? item.confirmLabel : item.label;
}

function isDanger(item: ContextMenuItem) {
  return item.danger || isContextMenuItemPending(item);
}

function hasChildren(item: ContextMenuItem) {
  return Boolean(item.children?.length);
}

function activateSubmenu(item: ContextMenuItem, index: number) {
  activeSubmenuIndex.value = hasChildren(item) && !item.disabled ? index : null;
}

function clearSubmenu() {
  activeSubmenuIndex.value = null;
}

function isSubmenuActive(index: number) {
  return activeSubmenuIndex.value === index;
}

function selectMenuItem(item: ContextMenuItem) {
  if (hasChildren(item)) return;
  void selectContextMenuItem(item);
}

async function updateGeometry() {
  const initialPos = createAnchoredMenuPosition(
    state.x,
    state.y,
    state.anchorX,
    state.anchorY,
  );
  pos.value = initialPos;
  origin.value = resolveMenuTransformOrigin(initialPos);
  await nextTick();
  const element = menuEl.value;
  if (!element) return;
  const clampedPos = clampAnchoredMenuPosition(
    initialPos,
    element.offsetWidth,
    element.offsetHeight,
  );
  pos.value = clampedPos;
  origin.value = resolveMenuTransformOrigin(
    clampedPos,
    element.offsetWidth,
    element.offsetHeight,
  );
}

function onAfterLeave() {
  finalizeClosedContextMenu();
}

watch(
  () => [state.openSeq, state.open] as const,
  ([, open]) => {
    if (!open) {
      rendered.value = false;
      clearSubmenu();
      return;
    }
    rendered.value = true;
    clearSubmenu();
    void updateGeometry();
  },
  { immediate: true },
);
</script>

<template>
  <Teleport to="body">
    <Transition
      name="sb-menu-pop"
      :duration="SB_MENU_POP_TRANSITION_MS"
      @after-leave="onAfterLeave"
    >
      <div
        v-if="rendered"
        ref="menuEl"
        class="ctx-menu"
        role="menu"
        :style="{
          left: `${pos.x}px`,
          top: `${pos.y}px`,
          '--sb-menu-origin-x': `${origin.x}px`,
          '--sb-menu-origin-y': `${origin.y}px`,
        }"
        @mouseleave="clearSubmenu"
      >
        <div
          v-for="(item, index) in state.items"
          :key="item.id ?? index"
          class="ctx-menu__entry"
        >
          <button
            type="button"
            class="ctx-menu__item"
            :class="{
              'ctx-menu__item--danger': isDanger(item),
              'ctx-menu__item--pending': isContextMenuItemPending(item),
              'ctx-menu__item--has-children': hasChildren(item),
              'ctx-menu__item--submenu-active': isSubmenuActive(index),
            }"
            :disabled="item.disabled"
            role="menuitem"
            :aria-haspopup="hasChildren(item) ? 'menu' : undefined"
            :aria-expanded="hasChildren(item) ? isSubmenuActive(index) : undefined"
            @mouseenter="activateSubmenu(item, index)"
            @focus="activateSubmenu(item, index)"
            @click="selectMenuItem(item)"
          >
            <component v-if="item.icon" :is="item.icon" :size="13" aria-hidden="true" />
            <span class="ctx-menu__label">{{ displayLabel(item) }}</span>
            <span v-if="hasChildren(item)" class="ctx-menu__arrow" aria-hidden="true">&gt;</span>
          </button>
          <div
            v-if="hasChildren(item) && isSubmenuActive(index)"
            class="ctx-menu__submenu"
            role="menu"
          >
            <button
              v-for="(child, childIndex) in item.children"
              :key="child.id ?? childIndex"
              type="button"
              class="ctx-menu__item"
              :class="{
                'ctx-menu__item--danger': isDanger(child),
                'ctx-menu__item--pending': isContextMenuItemPending(child),
              }"
              :disabled="child.disabled"
              role="menuitem"
              @click="selectMenuItem(child)"
            >
              <component v-if="child.icon" :is="child.icon" :size="13" aria-hidden="true" />
              <span class="ctx-menu__label">{{ displayLabel(child) }}</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 2000;
  min-width: 132px;
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
  transform-origin: var(--sb-menu-origin-x, 0px) var(--sb-menu-origin-y, 0px);
  will-change: transform, opacity;
}

.ctx-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
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

.ctx-menu__entry {
  position: relative;
  display: flex;
}

.ctx-menu__item--submenu-active:not(:disabled) {
  background: var(--bg-hover);
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

.ctx-menu__arrow {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-size: 12px;
}

.ctx-menu__submenu {
  position: absolute;
  left: calc(100% + 5px);
  top: -4px;
  z-index: 1;
  min-width: 132px;
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
}
</style>

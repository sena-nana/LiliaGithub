<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import {
  Copy,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Square,
  X,
} from "@lucide/vue";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Props {
  title?: string;
  leftSidebarCollapsed?: boolean;
  sidebarTogglesDisabled?: boolean;
}

withDefaults(defineProps<Props>(), { title: "LiliaGithub" });

defineEmits<{
  toggleLeftSidebar: [];
}>();

const isMaximized = ref(false);
const appWindow = safeCurrentWindow();
const DRAG_THRESHOLD = 4;
let unlistenResize: (() => void) | null = null;
let pendingDrag: {
  pointerId: number;
  startX: number;
  startY: number;
  target: HTMLElement | null;
} | null = null;

function safeCurrentWindow(): ReturnType<typeof getCurrentWindow> | null {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

async function syncMaximized() {
  if (!appWindow) return;
  try {
    isMaximized.value = await appWindow.isMaximized();
  } catch {
    isMaximized.value = false;
  }
}

onMounted(async () => {
  await syncMaximized();
  if (!appWindow) return;
  unlistenResize = await appWindow.onResized(() => {
    void syncMaximized();
  });
});

onUnmounted(() => {
  unlistenResize?.();
  clearPendingDrag();
});

async function onMinimize() {
  if (!appWindow) return;
  await appWindow.minimize();
}

async function onToggleMaximize() {
  if (!appWindow) return;
  await appWindow.toggleMaximize();
  await syncMaximized();
}

async function onClose() {
  if (!appWindow) return;
  await appWindow.close();
}

function isTitlebarControl(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(target.closest("button, a, input, textarea, select, [contenteditable='true']"))
  );
}

async function startNativeDrag() {
  if (!appWindow || typeof appWindow.startDragging !== "function") return;
  try {
    await appWindow.startDragging();
  } catch {
    return;
  }
}

function clearPendingDrag() {
  if (pendingDrag?.target?.hasPointerCapture?.(pendingDrag.pointerId)) {
    pendingDrag.target.releasePointerCapture(pendingDrag.pointerId);
  }
  pendingDrag = null;
}

function trackDrag(event: PointerEvent) {
  clearPendingDrag();
  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  target?.setPointerCapture?.(event.pointerId);
  pendingDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    target,
  };
}

function onTitlebarPointerMove(event: PointerEvent) {
  if (!pendingDrag || event.pointerId !== pendingDrag.pointerId) return;
  const deltaX = event.clientX - pendingDrag.startX;
  const deltaY = event.clientY - pendingDrag.startY;
  if (Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;
  clearPendingDrag();
  void startNativeDrag();
}

function onTitlebarPointerDown(event: PointerEvent) {
  if (event.button !== 0 || (event.pointerType && event.pointerType !== "mouse")) return;
  if (isTitlebarControl(event.target)) return;
  trackDrag(event);
}
</script>

<template>
  <header
    class="titlebar"
    data-agent-id="titlebar"
    @pointerdown="onTitlebarPointerDown"
    @pointermove="onTitlebarPointerMove"
    @pointerup="clearPendingDrag"
    @pointercancel="clearPendingDrag"
  >
    <div class="titlebar__left-controls">
      <button
        type="button"
        class="titlebar__btn titlebar__left-sidebar-btn"
        data-agent-id="titlebar.sidebar.toggle"
        :aria-label="leftSidebarCollapsed ? '展开左侧栏' : '折叠左侧栏'"
        :title="leftSidebarCollapsed ? '展开左侧栏' : '折叠左侧栏'"
        :aria-pressed="leftSidebarCollapsed"
        :disabled="sidebarTogglesDisabled"
        @click="$emit('toggleLeftSidebar')"
      >
        <PanelLeftOpen
          v-if="leftSidebarCollapsed"
          :size="15"
          aria-hidden="true"
        />
        <PanelLeftClose
          v-else
          :size="15"
          aria-hidden="true"
        />
      </button>
    </div>
    <div class="titlebar__brand">{{ title }}</div>
    <div class="titlebar__controls">
      <button
        type="button"
        class="titlebar__btn"
        data-agent-id="titlebar.window.minimize"
        aria-label="最小化"
        @click="onMinimize"
      >
        <Minus :size="14" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="titlebar__btn"
        data-agent-id="titlebar.window.maximize"
        :aria-label="isMaximized ? '还原' : '最大化'"
        @click="onToggleMaximize"
      >
        <Copy v-if="isMaximized" :size="13" aria-hidden="true" />
        <Square v-else :size="13" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="titlebar__btn titlebar__btn--danger"
        data-agent-id="titlebar.window.close"
        aria-label="关闭"
        @click="onClose"
      >
        <X :size="15" aria-hidden="true" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: stretch;
  height: 36px;
  background: var(--bg-elev);
  user-select: none;
  -webkit-user-select: none;
}

.titlebar__left-controls {
  display: flex;
  align-items: center;
  justify-self: start;
  gap: 2px;
  padding: 0 6px;
  -webkit-app-region: no-drag;
}

.titlebar__brand {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  min-width: 0;
  max-width: min(420px, 44vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: var(--text);
}

.titlebar__controls {
  display: flex;
  align-items: center;
  justify-self: end;
  gap: 2px;
  padding: 0 6px;
  -webkit-app-region: no-drag;
}

.titlebar__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.titlebar__btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.titlebar__btn--danger:hover {
  background: var(--err-soft);
  color: var(--err);
}
</style>

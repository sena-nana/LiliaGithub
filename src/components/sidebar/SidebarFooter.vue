<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Clock3, ListChecks, LoaderCircle, Settings } from "@lucide/vue";
import { RouterLink } from "vue-router";
import {
  SB_MENU_POP_TRANSITION_MS,
  useAnchoredMenuMotion,
  type LiliaSidebarConfigInput,
} from "../../ui";
import { useBackgroundTasks } from "../../composables/useBackgroundTasks";

type SidebarFooterStatus = NonNullable<LiliaSidebarConfigInput["footerStatuses"]>[number];

defineProps<{
  status: SidebarFooterStatus;
}>();

const { tasks } = useBackgroundTasks();
const tasksOpen = ref(false);
const placement = computed(() => "top" as const);
const menuMotion = useAnchoredMenuMotion(tasksOpen, placement);
const menuStyle = computed(() => menuMotion.overlayStyle.value);
let closeTimer: number | null = null;

const taskStatusDisplay = {
  pending: { label: "等待中", icon: Clock3 },
  running: { label: "进行中", icon: LoaderCircle },
};

function taskAgentId(taskId: string) {
  return `sidebar.footer.tasks.item.${taskId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function clearCloseTimer() {
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function openTasks(event?: MouseEvent) {
  clearCloseTimer();
  if (event) menuMotion.captureAnchor(event);
  tasksOpen.value = true;
}

function scheduleClose() {
  clearCloseTimer();
  closeTimer = window.setTimeout(() => {
    tasksOpen.value = false;
  }, 120);
}

function closeTasks() {
  clearCloseTimer();
  tasksOpen.value = false;
}

function onTaskKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  closeTasks();
  event.stopPropagation();
}

watch(tasksOpen, async (open) => {
  if (open) {
    await menuMotion.updatePosition();
    document.addEventListener("keydown", onTaskKeydown);
  } else {
    menuMotion.clearAnchor();
    document.removeEventListener("keydown", onTaskKeydown);
  }
});

watch(
  () => tasks.value.length,
  () => {
    if (!tasksOpen.value) return;
    void menuMotion.updatePosition();
  },
);

onBeforeUnmount(() => {
  clearCloseTimer();
  document.removeEventListener("keydown", onTaskKeydown);
});
</script>

<template>
  <div class="sb-footer">
    <RouterLink
      to="/settings"
      class="sb-footer__btn"
      data-agent-id="sidebar.footer.settings"
      active-class="is-active"
      title="设置"
      aria-label="设置"
    >
      <Settings :size="14" aria-hidden="true" />
    </RouterLink>

    <div
      class="sb-tasks"
      @mouseenter="openTasks($event)"
      @mouseleave="scheduleClose"
      @focusin="openTasks()"
      @focusout="scheduleClose"
    >
      <button
        :ref="menuMotion.triggerEl"
        type="button"
        class="sb-footer__btn sb-tasks__btn"
        data-agent-id="sidebar.footer.tasks"
        title="后台任务"
        aria-label="后台任务"
        :aria-expanded="tasksOpen"
        aria-haspopup="menu"
        @mouseenter="openTasks($event)"
        @click="openTasks($event)"
      >
        <ListChecks class="sb-tasks__icon" :size="14" aria-hidden="true" />
        <span
          v-if="tasks.length"
          class="sb-tasks__badge"
          aria-hidden="true"
        >
          {{ tasks.length }}
        </span>
      </button>

      <Teleport to="body">
        <Transition name="sb-menu-pop" :duration="SB_MENU_POP_TRANSITION_MS">
          <div
            v-if="tasksOpen"
            :ref="menuMotion.menuEl"
            class="sb-tasks__menu"
            role="menu"
            aria-label="后台任务"
            data-agent-id="sidebar.footer.tasks.menu"
            :style="menuStyle"
            @mouseenter="clearCloseTimer"
            @mouseleave="scheduleClose"
          >
            <div v-if="!tasks.length" class="sb-tasks__empty">
              暂无后台任务
            </div>
            <template v-else>
              <div
                v-for="task in tasks"
                :key="task.id"
                class="sb-tasks__item"
                :class="`sb-tasks__item--${task.status}`"
                role="menuitem"
                :data-agent-id="taskAgentId(task.id)"
              >
                <strong class="sb-tasks__title">{{ task.title }}</strong>
                <span class="sb-tasks__source">{{ task.repoName || "工作区" }}</span>
                <span
                  class="sb-tasks__status"
                  :title="taskStatusDisplay[task.status].label"
                  :aria-label="taskStatusDisplay[task.status].label"
                  role="img"
                >
                  <component
                    :is="taskStatusDisplay[task.status].icon"
                    :size="13"
                    aria-hidden="true"
                    :class="{ 'sb-spin': task.status === 'running' }"
                  />
                </span>
              </div>
            </template>
          </div>
        </Transition>
      </Teleport>
    </div>

    <RouterLink
      :to="status.to"
      class="sb-conn"
      data-agent-id="sidebar.footer.connection"
      :class="`sb-conn--${status.tone}`"
      :title="status.title"
      :aria-label="status.title"
    >
      <component :is="status.icon" :size="12" aria-hidden="true" />
      <span class="sb-conn__label">{{ status.label }}</span>
    </RouterLink>
  </div>
</template>

<style scoped>
.sb-footer {
  padding: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  width: max-content;
  max-width: 100%;
}

.sb-footer__btn {
  position: relative;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  opacity: 0.44;
  transition: opacity 0.35s ease, background-color 0.12s ease, color 0.12s ease;
  flex-shrink: 0;
}

.sb-footer__btn:hover {
  background: var(--bg-hover);
  color: var(--text);
  filter: none;
}

.sb-footer:hover .sb-footer__btn,
.sb-footer:focus-within .sb-footer__btn,
.sb-footer__btn.is-active {
  opacity: 1;
}

.sb-footer__btn.is-active {
  background: var(--accent-soft);
  color: var(--accent);
}

.sb-tasks {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.sb-tasks__icon {
  flex: 0 0 auto;
}

.sb-tasks__badge {
  position: absolute;
  top: -3px;
  right: -5px;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  min-width: 13px;
  height: 13px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  pointer-events: none;
}

.sb-tasks__menu {
  position: fixed;
  left: 0;
  top: 0;
  z-index: var(--z-dropdown, 1900);
  width: 280px;
  max-width: min(280px, calc(100vw - 16px));
  max-height: min(360px, calc(100vh - 24px));
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.5);
  contain: layout paint style;
  transform-origin: var(--sb-menu-origin-x, 0) var(--sb-menu-origin-y, 100%);
  will-change: transform, opacity;
}

.sb-tasks__empty {
  padding: 7px 8px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}

.sb-tasks__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(42px, max-content) 16px;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 29px;
  padding: 5px 6px 5px 8px;
  border-bottom: 1px solid var(--border-soft);
  transition: background-color 0.12s ease;
}

.sb-tasks__item:last-child {
  border-bottom-color: transparent;
}

.sb-tasks__item:hover {
  background: var(--bg-hover);
}

.sb-tasks__title {
  overflow: hidden;
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-tasks__source {
  min-width: 0;
  max-width: 104px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-tasks__status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--text-faint);
}

.sb-tasks__item--running .sb-tasks__status {
  color: var(--accent);
}

.sb-spin {
  animation: sb-spin 0.9s linear infinite;
}

@keyframes sb-spin {
  to {
    transform: rotate(360deg);
  }
}

.sb-conn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 7px;
  margin-left: 4px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;
  text-decoration: none;
  min-width: 0;
  opacity: 0.62;
  transition: opacity 0.35s ease, background-color 0.12s ease, color 0.12s ease;
}

.sb-footer:hover .sb-conn,
.sb-footer:focus-within .sb-conn {
  opacity: 1;
}

.sb-conn--ok {
  background: var(--accent-soft);
  color: var(--accent);
}

.sb-conn--warn {
  background: var(--warn-soft);
  color: var(--warn);
  opacity: 0.82;
}

.sb-conn--error {
  background: var(--err-soft);
  color: var(--err);
  opacity: 0.9;
}

.sb-conn__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

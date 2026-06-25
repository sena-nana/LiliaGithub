<script setup lang="ts">
import { Settings } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { REPO_SETTINGS_MANIFEST } from "../../config/repoSettingsManifest";
import { SB_MENU_POP_TRANSITION_MS } from "../../composables/menuMotion";
import { useAnchoredMenuMotion } from "../../composables/useAnchoredMenuMotion";

const props = defineProps<{
  autoSync: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:autoSync": [value: boolean];
}>();

const open = ref(false);
const placement = computed(() => "bottom" as const);
const menuMotion = useAnchoredMenuMotion(placement);
const origin = menuMotion.origin;
const autoSyncSetting = REPO_SETTINGS_MANIFEST.autoSync;

function toggle(event: MouseEvent) {
  if (props.disabled) return;
  menuMotion.captureAnchor(event);
  open.value = !open.value;
}

function close() {
  open.value = false;
}

function onDocPointer(event: PointerEvent) {
  const root = menuMotion.rootEl.value;
  if (!root) return;
  if (!root.contains(event.target as Node)) close();
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape" && open.value) {
    close();
    event.stopPropagation();
  }
}

function updateAutoSync(event: Event) {
  const input = event.target as HTMLInputElement;
  emit("update:autoSync", input.checked);
}

watch(open, async (value) => {
  if (value) {
    menuMotion.resolveInitialOrigin();
    await menuMotion.updateOrigin();
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onKey);
  } else {
    document.removeEventListener("pointerdown", onDocPointer, true);
    document.removeEventListener("keydown", onKey);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointer, true);
  document.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div :ref="menuMotion.rootEl" class="repo-toolbar-settings">
    <button
      :ref="menuMotion.triggerEl"
      type="button"
      class="repo-toolbar__btn repo-toolbar-settings__button"
      :class="{ 'is-open': open }"
      title="设置"
      aria-label="设置"
      data-agent-id="repo.toolbar.settings"
      :aria-expanded="open"
      aria-haspopup="menu"
      :disabled="disabled"
      @click="toggle"
    >
      <Settings :size="17" aria-hidden="true" />
    </button>

    <Transition name="sb-menu-pop" :duration="SB_MENU_POP_TRANSITION_MS">
      <div
        v-if="open"
        :ref="menuMotion.menuEl"
        class="repo-toolbar-settings__menu"
        role="menu"
        aria-label="项目设置"
        :style="{
          '--sb-menu-origin-x': `${origin.x}px`,
          '--sb-menu-origin-y': `${origin.y}px`,
        }"
      >
        <label class="repo-toolbar-settings__item ui-switch">
          <span class="repo-toolbar-settings__content">
            <strong>{{ autoSyncSetting.label }}</strong>
            <em>{{ autoSyncSetting.description }}</em>
          </span>
          <input
            class="ui-switch__input"
            type="checkbox"
            :checked="autoSync"
            :disabled="disabled"
            :aria-label="autoSyncSetting.label"
            data-agent-id="repo.toolbar.settings.auto-sync"
            @change="updateAutoSync"
          />
          <span class="ui-switch__track" aria-hidden="true"></span>
        </label>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.repo-toolbar-settings {
  position: relative;
  display: inline-flex;
  min-width: 0;
}

.repo-toolbar-settings__button.is-open {
  background: var(--bg-hover);
  color: var(--text);
}

.repo-toolbar-settings__menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  display: grid;
  gap: 3px;
  width: 240px;
  max-width: min(240px, calc(100vw - 16px));
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.5);
  transform-origin: var(--sb-menu-origin-x, 100%) var(--sb-menu-origin-y, 0);
  will-change: transform, opacity;
}

.repo-toolbar-settings__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 42px;
  padding: 6px 7px;
  border-radius: var(--radius-sm);
  color: var(--text);
}

.repo-toolbar-settings__item:hover {
  background: var(--bg-hover);
}

.repo-toolbar-settings__content {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.repo-toolbar-settings__content strong {
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
}

.repo-toolbar-settings__content em {
  overflow: hidden;
  color: var(--text-faint);
  font-size: 11px;
  font-style: normal;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

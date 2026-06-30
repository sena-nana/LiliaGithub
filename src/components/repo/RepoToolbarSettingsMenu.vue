<script setup lang="ts">
import { Settings } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { SB_MENU_POP_TRANSITION_MS, useAnchoredMenuMotion } from "@lilia/ui";
import { REPO_SETTING_ITEMS, type RepoSettingKey } from "../../config/repoSettingsManifest";

const props = defineProps<{
  values: Record<RepoSettingKey, boolean>;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:setting": [key: RepoSettingKey, value: boolean];
}>();

const open = ref(false);
const placement = computed(() => "bottom" as const);
const menuMotion = useAnchoredMenuMotion(open, placement);
const menuStyle = computed(() => menuMotion.overlayStyle.value);
const settings = REPO_SETTING_ITEMS;

function toggle(event: MouseEvent) {
  if (props.disabled) return;
  menuMotion.captureAnchor(event);
  open.value = !open.value;
}

function close() {
  open.value = false;
}

function onDocPointer(event: PointerEvent) {
  if (!menuMotion.containsTarget(event.target)) close();
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape" && open.value) {
    close();
    event.stopPropagation();
  }
}

function updateSetting(key: RepoSettingKey, event: Event) {
  const input = event.target as HTMLInputElement;
  emit("update:setting", key, input.checked);
}

function settingAgentId(key: RepoSettingKey) {
  return `repo.toolbar.settings.${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

watch(open, async (value) => {
  if (value) {
    await menuMotion.updatePosition();
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onKey);
  } else {
    menuMotion.clearAnchor();
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
  <div class="repo-toolbar-settings">
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
        :style="menuStyle"
      >
        <label
          v-for="setting in settings"
          :key="setting.key"
          class="repo-toolbar-settings__item ui-switch"
        >
          <span class="repo-toolbar-settings__content">
            <strong>{{ setting.label }}</strong>
            <em>{{ setting.description }}</em>
          </span>
          <input
            class="ui-switch__input"
            type="checkbox"
            :checked="values[setting.key]"
            :disabled="disabled"
            :aria-label="setting.label"
            :data-agent-id="settingAgentId(setting.key)"
            @change="updateSetting(setting.key, $event)"
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
  position: fixed;
  z-index: var(--z-dropdown, 1900);
  display: grid;
  gap: 3px;
  width: 260px;
  max-width: min(260px, calc(100vw - 16px));
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

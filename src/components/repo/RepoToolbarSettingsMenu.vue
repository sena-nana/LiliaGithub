<script setup lang="ts">
import { Settings } from "@lucide/vue";
import { AnchoredActionMenu } from "@lilia/ui/overlay";
import { useAnchoredActionMenu } from "@lilia/ui/composables/useAnchoredActionMenu";
import { createAnchoredMenuPosition } from "@lilia/ui/composables/menuMotion";
import { UiSwitch } from "@lilia/ui";
import { REPO_SETTING_ITEMS, type RepoSettingKey } from "../../config/repoSettingsManifest";

const props = defineProps<{
  values: Record<RepoSettingKey, boolean>;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:setting": [key: RepoSettingKey, value: boolean];
  openRemoteSyncSettings: [];
}>();

const { open, position, close } = useAnchoredActionMenu();
const settings = REPO_SETTING_ITEMS;

function toggle(event: MouseEvent) {
  if (props.disabled) return;
  if (open.value) {
    close();
    return;
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  position.value = createAnchoredMenuPosition(rect.right, rect.bottom, rect.right, rect.bottom);
  open.value = true;
}

function settingAgentId(key: RepoSettingKey) {
  return `repo.toolbar.settings.${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}
</script>

<template>
  <div class="repo-toolbar-settings">
    <button
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

    <AnchoredActionMenu
      :open="open"
      :position="position"
      preferred-placement="bottom-end"
      :offset="4"
      aria-label="项目设置"
    >
      <div class="repo-toolbar-settings__menu">
        <button
          type="button"
          class="repo-toolbar-settings__item"
          role="menuitem"
          data-agent-id="repo.toolbar.remote-sync.settings"
          :disabled="disabled"
          @click="close(); emit('openRemoteSyncSettings')"
        >
          <span class="repo-toolbar-settings__content">
            <strong>远端同步设置</strong>
            <em>配置拉取与推送远端</em>
          </span>
        </button>
        <UiSwitch
          v-for="setting in settings"
          :key="setting.key"
          class="repo-toolbar-settings__item"
          control-position="end"
          block
          :model-value="values[setting.key]"
          :disabled="disabled"
          :aria-label="setting.label"
          :agent-id="settingAgentId(setting.key)"
          @update:model-value="emit('update:setting', setting.key, $event)"
        >
          <span class="repo-toolbar-settings__content">
            <strong>{{ setting.label }}</strong>
            <em>{{ setting.description }}</em>
          </span>
        </UiSwitch>
      </div>
    </AnchoredActionMenu>
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
  display: grid;
  gap: 3px;
  width: 250px;
}

.repo-toolbar-settings__item {
  gap: 12px;
  min-height: 42px;
  padding: 6px 7px;
  border-radius: var(--radius-sm);
  color: var(--text);
}

button.repo-toolbar-settings__item {
  width: 100%;
  border: 0;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  text-align: left;
}

button.repo-toolbar-settings__item:disabled {
  cursor: default;
  opacity: 0.55;
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

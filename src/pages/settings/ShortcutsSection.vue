<script setup lang="ts">
import { nextTick, ref, computed } from "vue";
import type { KeyboardShortcutBinding } from "../../services/workspace";
import { useWorkspace } from "../../composables/useWorkspace";
import {
  COMMAND_PALETTE_SHORTCUT_ACTION,
  captureShortcutBinding,
  formatCommandPaletteShortcut,
  resolveKeyboardShortcut,
} from "../../utils/keyboardShortcuts";

const workspace = useWorkspace();
const recording = ref(false);
const saving = ref(false);
const notice = ref("");
const recordButtonRef = ref<HTMLButtonElement | null>(null);

const commandPaletteShortcut = computed(() =>
  resolveKeyboardShortcut(
    workspace.state.settings?.keyboardShortcuts,
    COMMAND_PALETTE_SHORTCUT_ACTION,
  )
);
const shortcutLabel = computed(() => formatCommandPaletteShortcut(commandPaletteShortcut.value));
const isDefaultShortcut = computed(() => !commandPaletteShortcut.value);

async function startRecording() {
  recording.value = true;
  notice.value = "";
  await nextTick();
  recordButtonRef.value?.focus();
}

async function onRecordKeydown(event: KeyboardEvent) {
  if (!recording.value) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    recording.value = false;
    return;
  }
  const result = captureShortcutBinding(event);
  if (result.error) {
    notice.value = result.error;
    return;
  }
  if (result.shortcut) {
    await saveShortcut(result.shortcut);
  }
}

async function saveShortcut(shortcut: KeyboardShortcutBinding | null) {
  saving.value = true;
  notice.value = "";
  try {
    await workspace.setKeyboardShortcut(COMMAND_PALETTE_SHORTCUT_ACTION, shortcut);
    notice.value = shortcut ? "已保存" : "已恢复默认";
    recording.value = false;
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="card shortcuts-settings" data-agent-id="settings.shortcuts">
    <h2>快捷键</h2>
    <div class="settings-row shortcuts-settings__row">
      <div class="settings-row__label">
        <div>打开命令面板</div>
        <div class="settings-row__hint">命令入口的全局打开快捷键。</div>
      </div>
      <div class="settings-row__control shortcuts-settings__control">
        <kbd
          class="shortcut-key"
          data-agent-id="settings.shortcuts.command-palette.value"
        >
          {{ shortcutLabel }}
        </kbd>
        <button
          ref="recordButtonRef"
          type="button"
          class="ghost"
          data-agent-id="settings.shortcuts.command-palette.record"
          :class="{ 'is-recording': recording }"
          :disabled="saving"
          @click="startRecording"
          @keydown="onRecordKeydown"
        >
          {{ recording ? "录制中" : "录制" }}
        </button>
        <button
          type="button"
          class="ghost"
          data-agent-id="settings.shortcuts.command-palette.reset"
          :disabled="saving || isDefaultShortcut"
          @click="saveShortcut(null)"
        >
          恢复默认
        </button>
      </div>
    </div>
    <p
      v-if="notice"
      class="shortcuts-settings__notice"
      aria-live="polite"
    >
      {{ notice }}
    </p>
  </div>
</template>

<style scoped>
.shortcuts-settings__row {
  align-items: center;
}

.shortcuts-settings__control {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.shortcut-key {
  min-width: 96px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
  color: var(--text);
  font-family: var(--font-mono, "JetBrains Mono", "Consolas", monospace);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
}

.shortcuts-settings__control .ghost {
  min-height: 30px;
}

.shortcuts-settings__control .ghost.is-recording {
  border-color: var(--accent);
  color: var(--accent);
}

.shortcuts-settings__notice {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 12px;
}
</style>

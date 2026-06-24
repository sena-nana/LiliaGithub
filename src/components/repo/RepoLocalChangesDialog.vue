<script setup lang="ts">
import { Archive, Trash2, X } from "@lucide/vue";
import type { RepoPullLocalChangesMode } from "../../services/workspace";

defineProps<{
  open: boolean;
  title: string;
  repoName: string;
  dirtyCount: number;
}>();

const emit = defineEmits<{
  cancel: [];
  select: [mode: Exclude<RepoPullLocalChangesMode, "reject">];
}>();
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="local-changes-dialog" role="presentation">
      <div class="local-changes-dialog__panel" role="dialog" aria-modal="true" :aria-label="title">
        <header class="local-changes-dialog__header">
          <div>
            <h2>{{ title }}</h2>
            <p>{{ repoName }} 有 {{ dirtyCount }} 项本地修改。</p>
          </div>
          <button type="button" class="local-changes-dialog__icon" aria-label="取消" @click="emit('cancel')">
            <X :size="16" aria-hidden="true" />
          </button>
        </header>

        <div class="local-changes-dialog__actions">
          <button type="button" class="local-changes-dialog__choice" @click="emit('select', 'stash')">
            <Archive :size="16" aria-hidden="true" />
            <span>
              <strong>暂存后拉取</strong>
              <small>保存本地修改，拉取完成后自动还原。</small>
            </span>
          </button>
          <button type="button" class="local-changes-dialog__choice is-danger" @click="emit('select', 'discard')">
            <Trash2 :size="16" aria-hidden="true" />
            <span>
              <strong>删除后拉取</strong>
              <small>删除已暂存、未暂存和未跟踪修改。</small>
            </span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.local-changes-dialog {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgb(15 23 42 / 42%);
}

.local-changes-dialog__panel {
  width: min(420px, 100%);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel);
  box-shadow: var(--shadow-lg);
}

.local-changes-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 10px;
  border-bottom: 1px solid var(--border-soft);
}

.local-changes-dialog__header h2 {
  margin: 0;
  font-size: 15px;
  line-height: 1.3;
}

.local-changes-dialog__header p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.local-changes-dialog__icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--muted);
}

.local-changes-dialog__actions {
  display: grid;
  gap: 8px;
  padding: 12px;
}

.local-changes-dialog__choice {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 58px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--text);
  text-align: left;
}

.local-changes-dialog__choice:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.local-changes-dialog__choice.is-danger:hover {
  border-color: var(--err);
  background: var(--err-soft);
}

.local-changes-dialog__choice span {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.local-changes-dialog__choice strong {
  font-size: 13px;
  line-height: 1.2;
}

.local-changes-dialog__choice small {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.3;
}
</style>

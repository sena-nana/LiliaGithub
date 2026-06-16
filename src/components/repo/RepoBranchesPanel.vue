<script setup lang="ts">
import { computed, ref } from "vue";
import { Check, GitBranch, Trash2 } from "@lucide/vue";
import ConfirmDialog from "../ConfirmDialog.vue";
import type { BranchSummary } from "../../services/workspace";

const props = withDefaults(defineProps<{
  branches: readonly BranchSummary[];
  remoteMode?: boolean;
  loading?: boolean;
  error?: string | null;
  actionRunning?: boolean;
  defaultBranch?: string | null;
}>(), {
  remoteMode: false,
  loading: false,
  error: null,
  actionRunning: false,
  defaultBranch: null,
});

const emit = defineEmits<{
  checkout: [branchName: string];
  setDefault: [branchName: string];
  deleteRemoteBranch: [branchName: string];
}>();

const deleteTarget = ref<BranchSummary | null>(null);
const deleteConfirmInput = ref("");
const deleteConfirmMatches = computed(() => {
  const target = deleteTarget.value;
  return Boolean(target) && deleteConfirmInput.value.trim() === target?.name;
});

function openDeleteDialog(branch: BranchSummary) {
  deleteTarget.value = branch;
  deleteConfirmInput.value = "";
}

function closeDeleteDialog() {
  if (props.actionRunning) return;
  deleteTarget.value = null;
  deleteConfirmInput.value = "";
}

function confirmDelete() {
  if (!deleteTarget.value || !deleteConfirmMatches.value) return;
  emit("deleteRemoteBranch", deleteTarget.value.name);
  closeDeleteDialog();
}

function isDefaultBranch(branch: BranchSummary) {
  return props.remoteMode && Boolean(props.defaultBranch) && branch.name === props.defaultBranch;
}
</script>

<template>
  <section class="repo-panel">
    <div class="section-toolbar section-toolbar--compact">
      <div class="repo-panel__title">
        <h2>分支</h2>
        <p class="muted">巡检当前和远端分支状态</p>
      </div>
    </div>
    <p v-if="error" class="error-line">{{ error }}</p>
    <p v-else-if="loading" class="muted repo-empty">正在读取分支。</p>
    <p v-else-if="!branches.length" class="muted repo-empty">没有分支信息。</p>
    <div v-else class="repo-list-panel">
      <div v-for="branch in branches" :key="`${branch.remote}:${branch.name}`" class="branch-row">
        <GitBranch :size="14" aria-hidden="true" />
        <div class="branch-row__main">
          <strong>{{ branch.name }}</strong>
          <span v-if="branch.current" class="branch-row__label">当前</span>
          <span v-if="branch.protected" class="branch-row__label">protected</span>
          <span v-if="!remoteMode" class="branch-row__meta">↑{{ branch.ahead }} / ↓{{ branch.behind }}</span>
        </div>
        <button
          v-if="!remoteMode"
          type="button"
          class="ghost"
          :disabled="branch.current || branch.remote"
          @click="emit('checkout', branch.name)"
        >
          <Check :size="14" aria-hidden="true" />
          Checkout
        </button>
        <div v-else class="branch-row__actions">
          <button
            type="button"
            class="ghost"
            :disabled="actionRunning || isDefaultBranch(branch)"
            @click="emit('setDefault', branch.name)"
          >
            <Check :size="14" aria-hidden="true" />
            设为默认
          </button>
          <button
            type="button"
            class="ghost danger"
            :disabled="actionRunning || isDefaultBranch(branch) || branch.protected"
            @click="openDeleteDialog(branch)"
          >
            <Trash2 :size="14" aria-hidden="true" />
            删除
          </button>
        </div>
      </div>
    </div>
    <ConfirmDialog
      :open="Boolean(deleteTarget)"
      title="删除远程分支"
      :message="deleteTarget ? `这会删除远程分支 ${deleteTarget.name}。` : ''"
      v-model="deleteConfirmInput"
      :required-text="deleteTarget?.name"
      input-label="输入完整分支名以确认"
      :input-placeholder="deleteTarget?.name"
      confirm-text="确认删除"
      danger
      :busy="actionRunning"
      @cancel="closeDeleteDialog"
      @confirm="confirmDelete"
    />
  </section>
</template>

<style scoped>
.branch-row {
  grid-template-columns: 18px minmax(0, 1fr) auto;
  gap: 8px;
  min-height: 34px;
  padding: 6px 0;
}

.branch-row__main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.branch-row__main strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-row__label,
.branch-row__meta {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  font-size: 12px;
  line-height: 18px;
  color: var(--text-muted);
}

.branch-row__label {
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-subtle);
}

.branch-row__actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.branch-row__actions {
  justify-content: flex-end;
  flex-wrap: wrap;
}
</style>

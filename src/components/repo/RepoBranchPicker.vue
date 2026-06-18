<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  Check,
  FolderGit2,
  GitBranch,
  GitBranchPlus,
  GitMerge,
  Pencil,
  Search,
  Trash2,
} from "@lucide/vue";
import type { ContextMenuItem } from "../../composables/useContextMenu";

type RepoBranchPickerItem = {
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  protected: boolean;
  tipTimestamp: number | null;
  checkedOutWorktreePaths: string[];
  section: "current" | "local" | "remote";
  relativeTime: string;
  checkedOutInWorktree: boolean;
  worktreePathsLabel: string;
  searchText: string;
};

const props = defineProps<{
  branches: readonly RepoBranchPickerItem[];
  displayLabel: string;
  disabled?: boolean;
  actionRunning?: boolean;
  buttonClass?: string;
}>();

const emit = defineEmits<{
  checkout: [branch: string];
  "update-current": [];
  "create-branch": [payload: { name: string; fromRef: string; checkoutAfter: boolean }];
  "rename-branch": [payload: { oldName: string; newName: string }];
  "merge-branch": [branch: string];
  "delete-branch": [branch: string];
}>();

const open = ref(false);
const search = ref("");
const root = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);

const createDialogOpen = ref(false);
const createSourceBranch = ref<RepoBranchPickerItem | null>(null);
const createBranchName = ref("");
const createCheckoutAfter = ref(true);

const renameDialogOpen = ref(false);
const renameTargetBranch = ref<RepoBranchPickerItem | null>(null);
const renameBranchName = ref("");

const sections = [
  { key: "current", label: "当前分支" },
  { key: "local", label: "本地分支" },
  { key: "remote", label: "远程分支" },
] as const;

const filteredGroups = computed(() => {
  const query = search.value.trim().toLowerCase();
  const filtered = props.branches.filter((branch) => {
    if (!query) return true;
    return branch.searchText.includes(query);
  });
  return sections
    .map((section) => ({
      ...section,
      items: filtered.filter((branch) => branch.section === section.key),
    }))
    .filter((section) => section.items.length > 0);
});

function localBranchShortName(remoteBranch: string) {
  return remoteBranch.split("/").slice(1).join("/") || remoteBranch;
}

function toggle() {
  if (props.disabled || props.actionRunning) return;
  open.value = !open.value;
}

function closePicker() {
  open.value = false;
}

function onDocPointer(event: PointerEvent) {
  if (!root.value) return;
  if (!root.value.contains(event.target as Node)) closePicker();
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape" && open.value) {
    closePicker();
    event.stopPropagation();
  }
}

watch(open, async (value) => {
  if (value) {
    await nextTick();
    searchInput.value?.focus();
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onKey);
  } else {
    search.value = "";
    document.removeEventListener("pointerdown", onDocPointer, true);
    document.removeEventListener("keydown", onKey);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointer, true);
  document.removeEventListener("keydown", onKey);
});

function pickBranch(branch: RepoBranchPickerItem) {
  if (props.disabled || props.actionRunning || branch.current) return;
  closePicker();
  emit("checkout", branch.name);
}

function openCreateDialog(branch: RepoBranchPickerItem) {
  closePicker();
  createSourceBranch.value = branch;
  createBranchName.value = branch.remote ? localBranchShortName(branch.name) : "";
  createCheckoutAfter.value = true;
  createDialogOpen.value = true;
}

function closeCreateDialog() {
  createDialogOpen.value = false;
  createSourceBranch.value = null;
  createBranchName.value = "";
  createCheckoutAfter.value = true;
}

function submitCreateDialog() {
  if (!createSourceBranch.value || !createBranchName.value.trim()) return;
  emit("create-branch", {
    name: createBranchName.value.trim(),
    fromRef: createSourceBranch.value.name,
    checkoutAfter: createCheckoutAfter.value,
  });
  closeCreateDialog();
}

function openRenameDialog(branch: RepoBranchPickerItem) {
  closePicker();
  renameTargetBranch.value = branch;
  renameBranchName.value = branch.name;
  renameDialogOpen.value = true;
}

function closeRenameDialog() {
  renameDialogOpen.value = false;
  renameTargetBranch.value = null;
  renameBranchName.value = "";
}

function submitRenameDialog() {
  if (!renameTargetBranch.value || !renameBranchName.value.trim()) return;
  emit("rename-branch", {
    oldName: renameTargetBranch.value.name,
    newName: renameBranchName.value.trim(),
  });
  closeRenameDialog();
}

function branchMenuItem(
  id: string,
  label: string,
  icon: ContextMenuItem["icon"],
  onSelect: () => void,
  extra: Partial<ContextMenuItem> = {},
): ContextMenuItem {
  return { id, label, icon, onSelect, ...extra };
}

function branchMenu(branch: RepoBranchPickerItem) {
  return (): ContextMenuItem[] => {
    if (props.disabled || props.actionRunning) return [];
    if (!branch.remote && branch.current) {
      return [
        branchMenuItem(`update:${branch.name}`, "更新", GitMerge, () => emit("update-current")),
        branchMenuItem(`create:${branch.name}`, "创建分支…", GitBranchPlus, () => openCreateDialog(branch)),
        branchMenuItem(`rename:${branch.name}`, "重命名…", Pencil, () => openRenameDialog(branch)),
      ];
    }
    if (!branch.remote) {
      return [
        branchMenuItem(`checkout:${branch.name}`, "检出", GitBranch, () => pickBranch(branch)),
        branchMenuItem(`merge:${branch.name}`, "合并到当前分支", GitMerge, () => emit("merge-branch", branch.name)),
        branchMenuItem(`create:${branch.name}`, "创建分支…", GitBranchPlus, () => openCreateDialog(branch)),
        branchMenuItem(`rename:${branch.name}`, "重命名…", Pencil, () => openRenameDialog(branch)),
        branchMenuItem(`delete:${branch.name}`, "删除", Trash2, () => emit("delete-branch", branch.name), {
          danger: true,
          confirmLabel: "确认删除？再点一次",
        }),
      ];
    }
    return [
      branchMenuItem(`checkout:${branch.name}`, "检出", GitBranch, () => pickBranch(branch)),
      branchMenuItem(`create:${branch.name}`, "基于此创建本地分支…", GitBranchPlus, () => openCreateDialog(branch)),
    ];
  };
}

function branchTitle(branch: RepoBranchPickerItem) {
  return [
    branch.name,
    branch.upstream ? `upstream: ${branch.upstream}` : "",
    branch.worktreePathsLabel ? `worktree:\n${branch.worktreePathsLabel}` : "",
  ].filter(Boolean).join("\n");
}
</script>

<template>
  <div ref="root" class="branch-picker">
    <button
      type="button"
      class="branch-picker__trigger"
      :class="[buttonClass, { 'is-open': open }]"
      :disabled="disabled || actionRunning"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-label="displayLabel"
      @click="toggle"
    >
      <GitBranch :size="13" aria-hidden="true" />
      <span class="branch-picker__trigger-label">{{ displayLabel }}</span>
    </button>

    <div v-if="open" class="branch-picker__panel" role="dialog" aria-label="分支选择器">
      <label class="branch-picker__search">
        <Search :size="14" aria-hidden="true" />
        <input
          ref="searchInput"
          v-model="search"
          type="text"
          placeholder="搜索分支"
          aria-label="搜索分支"
        />
      </label>

      <div class="branch-picker__list" role="listbox" aria-label="分支候选">
        <template v-for="group in filteredGroups" :key="group.key">
          <div class="branch-picker__section">{{ group.label }}</div>
          <button
            v-for="branch in group.items"
            :key="`${branch.remote ? 'remote' : 'local'}:${branch.name}`"
            v-context-menu="branchMenu(branch)"
            type="button"
            class="branch-picker__row"
            :class="{
              'is-current': branch.current,
              'is-remote': branch.remote,
            }"
            :aria-selected="branch.current"
            :aria-label="branch.name"
            :title="branchTitle(branch)"
            @click="pickBranch(branch)"
          >
            <span class="branch-picker__row-icon">
              <Check v-if="branch.current" :size="14" aria-hidden="true" />
              <GitBranch v-else :size="14" aria-hidden="true" />
            </span>
            <span class="branch-picker__row-name">{{ branch.name }}</span>
            <span class="branch-picker__row-time">{{ branch.relativeTime }}</span>
            <span
              v-if="branch.checkedOutInWorktree && !branch.remote"
              class="branch-picker__row-worktree"
              :title="branch.worktreePathsLabel"
            >
              <FolderGit2 :size="13" aria-hidden="true" />
            </span>
            <span v-else class="branch-picker__row-worktree branch-picker__row-worktree--empty" aria-hidden="true"></span>
          </button>
        </template>

        <p v-if="!filteredGroups.length" class="branch-picker__empty">没有匹配的分支</p>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="createDialogOpen"
          class="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="创建分支"
          @click.self="closeCreateDialog"
        >
          <div class="modal-card branch-dialog">
            <div class="branch-dialog__header">
              <strong>创建分支</strong>
            </div>
            <div class="branch-dialog__body">
              <label class="branch-dialog__field">
                <span>基准分支</span>
                <input :value="createSourceBranch?.name ?? ''" type="text" readonly />
              </label>
              <label class="branch-dialog__field">
                <span>新分支名</span>
                <input v-model="createBranchName" type="text" placeholder="feature/new-branch" />
              </label>
              <label class="branch-dialog__toggle">
                <input v-model="createCheckoutAfter" type="checkbox" />
                <span>创建后立即检出</span>
              </label>
            </div>
            <div class="branch-dialog__actions">
              <button type="button" class="ghost" :disabled="actionRunning" @click="closeCreateDialog">取消</button>
              <button
                type="button"
                class="primary"
                :disabled="actionRunning || !createBranchName.trim()"
                @click="submitCreateDialog"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="renameDialogOpen"
          class="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="重命名分支"
          @click.self="closeRenameDialog"
        >
          <div class="modal-card branch-dialog">
            <div class="branch-dialog__header">
              <strong>重命名分支</strong>
            </div>
            <div class="branch-dialog__body">
              <label class="branch-dialog__field">
                <span>当前分支</span>
                <input :value="renameTargetBranch?.name ?? ''" type="text" readonly />
              </label>
              <label class="branch-dialog__field">
                <span>新分支名</span>
                <input v-model="renameBranchName" type="text" placeholder="feature/renamed-branch" />
              </label>
            </div>
            <div class="branch-dialog__actions">
              <button type="button" class="ghost" :disabled="actionRunning" @click="closeRenameDialog">取消</button>
              <button
                type="button"
                class="primary"
                :disabled="actionRunning || !renameBranchName.trim()"
                @click="submitRenameDialog"
              >
                重命名
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.branch-picker {
  position: relative;
  display: inline-flex;
  min-width: 0;
  --branch-picker-row-height: 26px;
}

.branch-picker__trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  width: auto;
  min-width: 32px;
  max-width: 160px;
  padding: 0 7px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
}

.branch-picker__trigger:hover:not(:disabled),
.branch-picker__trigger.is-open {
  background: var(--bg-hover);
  color: var(--text);
}

.branch-picker__trigger:disabled {
  cursor: default;
  color: var(--text-faint);
}

.branch-picker__trigger-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}

.branch-picker__panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 30;
  width: 320px;
  max-width: min(92vw, 320px);
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
  box-shadow: 0 10px 28px -10px rgba(0, 0, 0, 0.5);
  display: grid;
  gap: 8px;
}

.branch-picker__search {
  display: flex;
  align-items: center;
  gap: 6px;
  height: var(--branch-picker-row-height);
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text-muted);
  box-sizing: border-box;
  font-size: 12px;
  line-height: 1.45;
}

.branch-picker__search input {
  flex: 1 1 auto;
  height: 100%;
  min-width: 0;
  min-height: 0;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
}

.branch-picker__search input:focus {
  outline: none;
}

.branch-picker__list {
  max-height: min(52vh, 420px);
  overflow: auto;
  display: grid;
  align-content: start;
}

.branch-picker__section {
  padding: 4px 4px 1px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
}

.branch-picker__section:first-child {
  padding-top: 0;
}

.branch-picker__row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto 16px;
  align-items: center;
  gap: 6px;
  height: auto;
  min-height: var(--branch-picker-row-height);
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.45;
}

.branch-picker__row:hover,
.branch-picker__row.is-current {
  background: var(--bg-hover);
}

.branch-picker__row-icon,
.branch-picker__row-worktree {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.branch-picker__row.is-current .branch-picker__row-icon {
  color: var(--text);
}

.branch-picker__row.is-remote .branch-picker__row-icon {
  color: var(--text-muted);
}

.branch-picker__row-name {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  line-height: inherit;
}

.branch-picker__row-time {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
  line-height: inherit;
  white-space: nowrap;
}

.branch-picker__row-worktree {
  color: var(--warn);
}

.branch-picker__row-worktree--empty {
  visibility: hidden;
}

.branch-picker__empty {
  margin: 0;
  padding: 12px 6px 4px;
  color: var(--text-muted);
  font-size: 12px;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1800;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
}

.modal-card {
  width: min(420px, 92vw);
  background: var(--bg-elev);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.16s ease;
}

.modal-enter-active .modal-card,
.modal-leave-active .modal-card {
  transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.16s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-card,
.modal-leave-to .modal-card {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}

.branch-dialog {
  display: grid;
}

.branch-dialog__header {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-soft);
}

.branch-dialog__body {
  display: grid;
  gap: 12px;
  padding: 14px;
}

.branch-dialog__field {
  display: grid;
  gap: 5px;
  color: var(--text-muted);
  font-size: 12px;
}

.branch-dialog__field input {
  width: 100%;
}

.branch-dialog__toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  font-size: 13px;
}

.branch-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px 14px;
}
</style>

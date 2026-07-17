<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  Check,
  CloudUpload,
  FolderGit2,
  GitBranch,
  GitBranchPlus,
  GitMerge,
  Link2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from "@lucide/vue";
import { UiDialog, UiPopover, openContextMenuAt, type ContextMenuItem } from "../../ui";

type RepoBranchPickerItem = {
  name: string;
  canonicalName: string;
  displayName: string;
  sourceLabel: string;
  defaultBranch?: boolean;
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
  allowRemoteCheckout?: boolean;
  allowRemoteCreate?: boolean;
  allowRemoteDelete?: boolean;
  showRepositoryActions?: boolean;
  agentId?: string;
}>();

const emit = defineEmits<{
  checkout: [branch: string];
  "update-current": [];
  "create-branch": [payload: { name: string; fromRef: string; checkoutAfter: boolean }];
  "rename-branch": [payload: { oldName: string; newName: string }];
  "merge-branch": [branch: string];
  "delete-branch": [branch: string];
  "refresh-branches": [];
  opened: [];
  "push-with-upstream": [];
  "set-upstream": [];
}>();

const open = ref(false);
const search = ref("");

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

const remoteCheckoutEnabled = computed(() => props.allowRemoteCheckout !== false);
const remoteCreateEnabled = computed(() => props.allowRemoteCreate !== false);
const remoteDeleteEnabled = computed(() => props.allowRemoteDelete === true);

function branchDisplayLabel(branch: RepoBranchPickerItem) {
  if (!branch.remote) return branch.displayName;
  return branch.sourceLabel ? `${branch.displayName} (${branch.sourceLabel})` : branch.displayName;
}

function branchAriaLabel(branch: RepoBranchPickerItem) {
  return branch.defaultBranch ? `${branchDisplayLabel(branch)}（默认分支）` : branchDisplayLabel(branch);
}

function closePicker() {
  open.value = false;
}

watch(open, (value, previous) => {
  if (value) {
    if (!previous) emit("opened");
  } else {
    search.value = "";
  }
});

function pickBranch(branch: RepoBranchPickerItem) {
  if (
    props.disabled ||
    props.actionRunning ||
    branch.current ||
    (branch.remote && !remoteCheckoutEnabled.value)
  ) return;
  closePicker();
  emit("checkout", branch.canonicalName);
}

function openCreateDialog(branch: RepoBranchPickerItem) {
  closePicker();
  createSourceBranch.value = branch;
  createBranchName.value = branch.remote ? branch.displayName : "";
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
    fromRef: createSourceBranch.value.canonicalName,
    checkoutAfter: createCheckoutAfter.value,
  });
  closeCreateDialog();
}

function openRenameDialog(branch: RepoBranchPickerItem) {
  closePicker();
  renameTargetBranch.value = branch;
  renameBranchName.value = branch.canonicalName;
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
    oldName: renameTargetBranch.value.canonicalName,
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

function openRepositoryActions(event: MouseEvent) {
  if (!props.showRepositoryActions || props.disabled || props.actionRunning) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  openContextMenuAt(rect.right, rect.bottom + 4, [
    branchMenuItem("refresh-branches", "刷新并抓取", RefreshCw, () => {
      closePicker();
      emit("refresh-branches");
    }),
    branchMenuItem("push-with-upstream", "推送并建立 upstream", CloudUpload, () => {
      closePicker();
      emit("push-with-upstream");
    }),
    branchMenuItem("set-upstream", "设置 upstream", Link2, () => {
      closePicker();
      emit("set-upstream");
    }),
  ]);
}

function branchMenu(branch: RepoBranchPickerItem) {
  return (): ContextMenuItem[] => {
    if (props.disabled || props.actionRunning) return [];
    if (!branch.remote && branch.current) {
      return [
        branchMenuItem(`update:${branch.canonicalName}`, "更新", GitMerge, () => emit("update-current")),
        branchMenuItem(`create:${branch.canonicalName}`, "创建分支…", GitBranchPlus, () => openCreateDialog(branch)),
        branchMenuItem(`rename:${branch.canonicalName}`, "重命名…", Pencil, () => openRenameDialog(branch)),
      ];
    }
    if (!branch.remote) {
      return [
        branchMenuItem(`checkout:${branch.canonicalName}`, "检出", GitBranch, () => pickBranch(branch)),
        branchMenuItem(`merge:${branch.canonicalName}`, "合并到当前分支", GitMerge, () => emit("merge-branch", branch.canonicalName)),
        branchMenuItem(`create:${branch.canonicalName}`, "创建分支…", GitBranchPlus, () => openCreateDialog(branch)),
        branchMenuItem(`rename:${branch.canonicalName}`, "重命名…", Pencil, () => openRenameDialog(branch)),
        branchMenuItem(`delete:${branch.canonicalName}`, "删除", Trash2, () => emit("delete-branch", branch.canonicalName), {
          danger: true,
          confirmLabel: "确认删除？再点一次",
        }),
      ];
    }
    const items: ContextMenuItem[] = [];
    if (remoteCheckoutEnabled.value) {
      items.push(branchMenuItem(`checkout:${branch.canonicalName}`, "检出", GitBranch, () => pickBranch(branch)));
    }
    if (remoteCreateEnabled.value) {
      items.push(
        branchMenuItem(
          `create:${branch.canonicalName}`,
          "基于此创建本地分支…",
          GitBranchPlus,
          () => openCreateDialog(branch),
        ),
      );
    }
    if (remoteDeleteEnabled.value) {
      items.push(
        branchMenuItem(`delete:${branch.canonicalName}`, "删除", Trash2, () => emit("delete-branch", branch.canonicalName), {
          danger: true,
          disabled: branch.defaultBranch || branch.protected,
          confirmLabel: "确认删除远程分支？再点一次",
        }),
      );
    }
    return items;
  };
}

function branchTitle(branch: RepoBranchPickerItem) {
  return [
    branchDisplayLabel(branch),
    branch.defaultBranch ? "默认分支" : "",
    branch.remote ? `ref: ${branch.canonicalName}` : "",
    branch.upstream ? `upstream: ${branch.upstream}` : "",
    branch.worktreePathsLabel ? `worktree:\n${branch.worktreePathsLabel}` : "",
  ].filter(Boolean).join("\n");
}
</script>

<template>
  <div class="branch-picker">
    <UiPopover
      v-model:open="open"
      aria-label="分支选择器"
      placement="bottom"
    >
      <template #trigger>
        <button
          type="button"
          class="branch-picker__trigger"
          :class="[buttonClass, { 'is-open': open }]"
          :data-agent-id="agentId"
          :disabled="disabled || actionRunning"
          aria-haspopup="dialog"
          :aria-expanded="open"
          :aria-label="displayLabel"
        >
          <GitBranch :size="13" aria-hidden="true" />
          <span class="branch-picker__trigger-label">{{ displayLabel }}</span>
        </button>
      </template>

      <div class="branch-picker__panel">
        <div class="branch-picker__search-row">
          <label class="branch-picker__search">
            <Search :size="14" aria-hidden="true" />
            <input
              v-model="search"
              type="text"
              placeholder="搜索分支"
              aria-label="搜索分支"
              :data-agent-id="agentId ? `${agentId}.search` : undefined"
            />
          </label>
          <button
            v-if="showRepositoryActions"
            type="button"
            class="branch-picker__actions-button"
            :data-agent-id="agentId ? `${agentId}.actions` : undefined"
            title="更多分支操作"
            aria-label="更多分支操作"
            :disabled="disabled || actionRunning"
            @click.stop="openRepositoryActions"
          >
            <MoreHorizontal :size="15" aria-hidden="true" />
          </button>
        </div>

        <div class="branch-picker__list" role="listbox" aria-label="分支候选">
          <template v-for="group in filteredGroups" :key="group.key">
            <div class="branch-picker__section">{{ group.label }}</div>
            <button
              v-for="branch in group.items"
              :key="`${branch.remote ? 'remote' : 'local'}:${branch.name}`"
              v-context-menu="branchMenu(branch)"
              type="button"
              class="branch-picker__row"
              :data-agent-id="agentId ? `${agentId}.branch.${branch.canonicalName}` : undefined"
              :class="{
                'is-current': branch.current,
                'is-remote': branch.remote,
                'is-passive': branch.remote && !remoteCheckoutEnabled,
              }"
              :aria-selected="branch.current"
              :aria-label="branchAriaLabel(branch)"
              :title="branchTitle(branch)"
              @click="pickBranch(branch)"
            >
              <span class="branch-picker__row-icon">
                <Check v-if="branch.current" :size="14" aria-hidden="true" />
                <GitBranch v-else :size="14" aria-hidden="true" />
              </span>
              <span class="branch-picker__row-name">{{ branch.displayName }}</span>
              <span
                v-if="(branch.remote && branch.sourceLabel) || branch.defaultBranch"
                class="branch-picker__row-tags"
              >
                <span v-if="branch.remote && branch.sourceLabel" class="branch-picker__row-source">
                  {{ branch.sourceLabel }}
                </span>
                <span
                  v-if="branch.defaultBranch"
                  class="branch-picker__row-source branch-picker__row-source--default"
                >
                  默认
                </span>
              </span>
              <span class="branch-picker__row-time">{{ branch.relativeTime }}</span>
              <span
                v-if="branch.checkedOutInWorktree && !branch.remote"
                class="branch-picker__row-worktree"
                :title="branch.worktreePathsLabel"
              >
                <FolderGit2 :size="13" aria-hidden="true" />
              </span>
              <span
                v-else
                class="branch-picker__row-worktree branch-picker__row-worktree--empty"
                aria-hidden="true"
              ></span>
            </button>
          </template>

          <p v-if="!filteredGroups.length" class="branch-picker__empty">没有匹配的分支</p>
        </div>
      </div>
    </UiPopover>

    <UiDialog
      v-model:open="createDialogOpen"
      title="创建分支"
      size="compact"
      :close-disabled="actionRunning"
      @close="closeCreateDialog"
    >
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
            <template #actions>
              <button type="button" class="ghost" :disabled="actionRunning" @click="closeCreateDialog">取消</button>
              <button
                type="button"
                class="primary"
                :disabled="actionRunning || !createBranchName.trim()"
                @click="submitCreateDialog"
              >
                创建
              </button>
            </template>
    </UiDialog>

    <UiDialog
      v-model:open="renameDialogOpen"
      title="重命名分支"
      size="compact"
      :close-disabled="actionRunning"
      @close="closeRenameDialog"
    >
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
            <template #actions>
              <button type="button" class="ghost" :disabled="actionRunning" @click="closeRenameDialog">取消</button>
              <button
                type="button"
                class="primary"
                :disabled="actionRunning || !renameBranchName.trim()"
                @click="submitRenameDialog"
              >
                重命名
              </button>
            </template>
    </UiDialog>
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
  width: 320px;
  max-width: min(92vw, 320px);
  display: grid;
  gap: 8px;
}

.branch-picker__search-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.branch-picker__search {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
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

.branch-picker__actions-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 var(--branch-picker-row-height);
  width: var(--branch-picker-row-height);
  height: var(--branch-picker-row-height);
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text-muted);
}

.branch-picker__actions-button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.branch-picker__actions-button:disabled {
  cursor: default;
  color: var(--text-faint);
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
  grid-template-columns: 18px minmax(0, 1fr) auto auto 16px;
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

.branch-picker__row.is-passive {
  cursor: default;
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
  grid-column: 2;
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  line-height: inherit;
}

.branch-picker__row-tags {
  grid-column: 3;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.branch-picker__row-source {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.4;
  white-space: nowrap;
}

.branch-picker__row-source--default {
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  color: var(--accent);
}

.branch-picker__row-time {
  grid-column: 4;
  display: block;
  color: var(--text-muted);
  font-size: 11px;
  line-height: inherit;
  white-space: nowrap;
  justify-self: end;
}

.branch-picker__row-worktree {
  grid-column: 5;
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

.branch-dialog__body {
  display: grid;
  gap: 12px;
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

</style>

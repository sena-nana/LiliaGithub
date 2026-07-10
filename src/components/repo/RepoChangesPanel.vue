<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  Copy,
  GitCommitHorizontal,
  ListPlus,
  CloudUpload,
  RotateCcw,
} from "@lucide/vue";
import type { ContextMenuItem } from "@lilia/ui";
import type { RepoChange } from "../../services/workspace";
import { changeStatusLetter, changeStatusText, changeStatusTone } from "../../utils/repoDisplay";
import RepoDiffWorkspace from "./RepoDiffWorkspace.vue";
import { parseRepoDiffHunks, type RepoDiffWorkspaceFile, type RepoDiffWorkspaceMode } from "./repoDiffWorkspace";

const props = defineProps<{
  changes: readonly RepoChange[];
  discardingChangePaths: readonly string[];
  hasConflicts: boolean;
  canCommit: boolean;
  needsPublish: boolean;
  actionRunning: boolean;
  previewChange: RepoChange | null;
  commitMessage: string;
  detailLoading?: boolean;
  detailError?: string | null;
}>();

const emit = defineEmits<{
  "update:commitMessage": [value: string];
  stageUnstagedChanges: [paths?: string[]];
  unstageStagedChanges: [paths?: string[]];
  changeAction: [
    action: "stage" | "unstage" | "discard" | "gitignore" | "copyPath",
    change: RepoChange,
    paths?: string[],
  ];
  focusChange: [path: string];
  commit: [pushAfter: boolean];
}>();

type ChangeGroupKey = "staged" | "unstaged";
type ChangeGroupBase = {
  key: ChangeGroupKey;
  changes: readonly RepoChange[];
};
type ActionChangeGroup = ChangeGroupBase & {
  action: "stageUnstagedChanges" | "unstageStagedChanges";
};

const diffMode = ref<RepoDiffWorkspaceMode>("hunks");
const selectedChangePaths = ref<Set<string>>(new Set());
const selectedChangeGroup = ref<ChangeGroupKey | null>(null);
const selectionAnchor = ref<{ group: ChangeGroupKey; path: string } | null>(null);
const discardingChangePathSet = computed(() => new Set(props.discardingChangePaths));
const changesUnavailableText = computed(() => {
  if (props.detailLoading) return "正在读取本地变更。";
  if (props.detailError) return "变更读取失败。";
  return null;
});
const emptyFileText = computed(() => changesUnavailableText.value ?? "没有本地变更。");

function changeKey(change: RepoChange, group: "staged" | "unstaged") {
  return `${group}:${change.oldPath ?? ""}:${change.path}`;
}

function changeTitle(change: RepoChange) {
  return change.oldPath ? `${change.oldPath} -> ${change.path}` : change.path;
}

const unstagedChanges = computed(() =>
  props.changes.filter((change) => change.unstaged || change.untracked || change.conflicted),
);

const stagedChanges = computed(() => props.changes.filter((change) => change.staged));
const changeGroups = computed(() => [
  {
    key: "unstaged" as const,
    label: "未暂存变更",
    emptyText: changesUnavailableText.value ?? "没有未暂存变更。",
    actionLabel: "暂存全部未暂存变更",
    action: "stageUnstagedChanges" as const,
    icon: ArrowDownToLine,
    changes: unstagedChanges.value,
  },
  {
    key: "staged" as const,
    label: "已暂存变更",
    emptyText: changesUnavailableText.value ?? "没有已暂存变更。",
    actionLabel: "取消暂存全部已暂存变更",
    action: "unstageStagedChanges" as const,
    icon: ArrowUpFromLine,
    changes: stagedChanges.value,
  },
]);

const workspaceFiles = computed<RepoDiffWorkspaceFile[]>(() =>
  props.changes.map((change) => ({
    key: `${change.oldPath ?? ""}:${change.path}`,
    path: change.path,
    oldPath: change.oldPath,
    statusLabel: changeStatusText(change),
    statusClass: changeStatusTone(change),
    statusLetter: changeStatusLetter(change),
    statText: changeStatusText(change),
    patch: change.diff,
    hunks: parseRepoDiffHunks(change.diff),
  })),
);

const activeWorkspaceFile = computed(() =>
  workspaceFiles.value.find((file) => file.path === props.previewChange?.path) ?? null,
);

watch(
  () => props.changes,
  (changes) => {
    const currentPaths = new Set(changes.map((change) => change.path));
    selectedChangePaths.value = new Set([...selectedChangePaths.value].filter((path) => currentPaths.has(path)));
    if (!selectedChangePaths.value.size) {
      selectedChangeGroup.value = null;
    }
    if (selectionAnchor.value && !currentPaths.has(selectionAnchor.value.path)) {
      selectionAnchor.value = null;
    }
  },
);

function selectFile(file: RepoDiffWorkspaceFile) {
  emit("focusChange", file.path);
}

function isSelectedChange(change: RepoChange, group: ChangeGroupKey) {
  return selectedChangeGroup.value === group && selectedChangePaths.value.has(change.path);
}

function isDiscardingChange(change: RepoChange, group: ChangeGroupKey) {
  return group === "unstaged" && discardingChangePathSet.value.has(change.path);
}

function selectedGroupChanges(group: ChangeGroupBase) {
  if (selectedChangeGroup.value !== group.key) return [];
  return group.changes.filter((change) => selectedChangePaths.value.has(change.path));
}

function selectedGroupPaths(group: ChangeGroupBase) {
  return selectedGroupChanges(group).map((change) => change.path);
}

function replaceSelectedPaths(group: ChangeGroupKey, paths: readonly string[]) {
  selectedChangePaths.value = new Set(paths);
  selectedChangeGroup.value = paths.length ? group : null;
}

function clearSelectedPaths(paths: readonly string[]) {
  const next = new Set(selectedChangePaths.value);
  for (const path of paths) next.delete(path);
  selectedChangePaths.value = next;
  if (!next.size) {
    selectedChangeGroup.value = null;
    selectionAnchor.value = null;
  }
}

function toggleSelectedPath(group: ChangeGroupKey, path: string) {
  const next = selectedChangeGroup.value === group ? new Set(selectedChangePaths.value) : new Set<string>();
  if (next.has(path)) next.delete(path);
  else next.add(path);
  selectedChangePaths.value = next;
  selectedChangeGroup.value = next.size ? group : null;
}

function selectChange(change: RepoChange, group: ChangeGroupBase, event: MouseEvent) {
  if (isDiscardingChange(change, group.key)) return;
  emit("focusChange", change.path);

  if (event.shiftKey && selectionAnchor.value?.group === group.key) {
    const anchorIndex = group.changes.findIndex((item) => item.path === selectionAnchor.value?.path);
    const currentIndex = group.changes.findIndex((item) => item.path === change.path);
    if (anchorIndex >= 0 && currentIndex >= 0) {
      const [start, end] = anchorIndex < currentIndex ? [anchorIndex, currentIndex] : [currentIndex, anchorIndex];
      replaceSelectedPaths(group.key, group.changes.slice(start, end + 1).map((item) => item.path));
      return;
    }
  }

  if (event.ctrlKey || event.metaKey) {
    toggleSelectedPath(group.key, change.path);
    selectionAnchor.value = { group: group.key, path: change.path };
    return;
  }

  replaceSelectedPaths(group.key, [change.path]);
  selectionAnchor.value = { group: group.key, path: change.path };
}

function changeContextMenu(change: RepoChange, group: ChangeGroupBase): ContextMenuItem[] {
  if (isDiscardingChange(change, group.key)) return [];
  const staged = group.key === "staged";
  const targets = isSelectedChange(change, group.key) ? selectedGroupChanges(group) : [];
  const actionTargets = targets.length ? targets : [change];
  const paths = actionTargets.map((item) => item.path);
  const hasUntrackedTarget = actionTargets.some((item) => item.untracked);
  return [
    {
      id: `${group.key}-stage-${change.path}`,
      label: staged ? "移出暂存" : "暂存",
      icon: staged ? ArrowUpFromLine : ArrowDownToLine,
      onSelect: () => {
        emit("changeAction", staged ? "unstage" : "stage", change, paths);
        clearSelectedPaths(paths);
      },
    },
    {
      id: `${group.key}-discard-${change.path}`,
      label: "放弃更改",
      icon: RotateCcw,
      danger: true,
      disabled: props.actionRunning || staged,
      confirmLabel: "确认放弃？再点一次",
      onSelect: () => {
        emit("changeAction", "discard", change, paths);
        clearSelectedPaths(paths);
      },
    },
    {
      id: `${group.key}-gitignore-${change.path}`,
      label: "添加到 gitignore",
      icon: ListPlus,
      disabled: props.actionRunning || !hasUntrackedTarget,
      onSelect: () => {
        emit("changeAction", "gitignore", change, paths);
        clearSelectedPaths(paths);
      },
    },
    {
      id: `${group.key}-copy-path-${change.path}`,
      label: "复制文件路径",
      icon: Copy,
      onSelect: () => emit("changeAction", "copyPath", change),
    },
  ];
}

function runGroupAction(group: ActionChangeGroup) {
  const paths = selectedGroupPaths(group);
  if (group.action === "stageUnstagedChanges") emit("stageUnstagedChanges", paths.length ? paths : undefined);
  else emit("unstageStagedChanges", paths.length ? paths : undefined);
  if (paths.length) clearSelectedPaths(paths);
}

function toggleDiffMode() {
  diffMode.value = diffMode.value === "hunks" ? "raw" : "hunks";
}

function submitCommit(pushAfter: boolean) {
  emit("commit", pushAfter);
}
</script>

<template>
  <section class="repo-panel">
    <RepoDiffWorkspace
      :files="workspaceFiles"
      :active-file="activeWorkspaceFile"
      :file-count-label="`${changes.length} 个文件`"
      diff-panel-label="变更预览"
      :empty-file-text="emptyFileText"
      empty-diff-text="当前没有可展示的差异内容。"
      :mode="diffMode"
      fill
      splitter
      @select-file="selectFile"
    >
      <template #sidebar>
        <div class="changes-sidebar" aria-label="工作区变更操作">
          <section
            v-for="group in changeGroups"
            :key="group.key"
            class="changes-group"
            :class="`changes-group--${group.key}`"
            :aria-label="group.label"
          >
            <header class="changes-group__header">
              <div class="changes-group__title">
                <h3>{{ group.label }}</h3>
                <span>{{ group.changes.length }} 个文件</span>
              </div>
              <button
                type="button"
                class="changes-group__arrow"
                :data-agent-id="`repo.changes.group.${group.key}.action`"
                :disabled="!group.changes.length"
                :aria-label="group.actionLabel"
                :title="group.actionLabel"
                @click="runGroupAction(group)"
              >
                <component :is="group.icon" :size="15" aria-hidden="true" />
              </button>
            </header>
            <p v-if="!group.changes.length" class="muted changes-group__empty">{{ group.emptyText }}</p>
            <div v-else class="changes-group__list" role="list">
              <button
                v-for="change in group.changes"
                :key="changeKey(change, group.key)"
                type="button"
                class="changes-group__item"
                :class="{
                  'is-active': previewChange?.path === change.path,
                  'is-selected': isSelectedChange(change, group.key),
                  'is-discarding': isDiscardingChange(change, group.key),
                }"
                :disabled="isDiscardingChange(change, group.key)"
                :data-agent-id="`repo.changes.${group.key}.${change.path}`"
                :aria-busy="isDiscardingChange(change, group.key) || undefined"
                :aria-pressed="isSelectedChange(change, group.key)"
                :title="changeTitle(change)"
                v-context-menu="changeContextMenu(change, group)"
                @click="selectChange(change, group, $event)"
              >
                <span class="changes-group__status" :class="changeStatusTone(change)" :title="changeStatusText(change)">
                  {{ changeStatusLetter(change) }}
                </span>
                <span class="changes-group__path">
                  <template v-if="change.oldPath">{{ change.oldPath }} -> </template>{{ change.path }}
                </span>
              </button>
            </div>
          </section>

          <section class="commit-box" aria-label="提交操作">
            <input
              :value="commitMessage"
              type="text"
              placeholder="提交说明"
              data-agent-id="repo.changes.commit.message"
              @input="$emit('update:commitMessage', ($event.target as HTMLInputElement).value)"
            />
            <div class="commit-box__actions">
              <button
                type="button"
                class="primary commit-box__submit commit-box__submit--push"
                data-agent-id="repo.changes.commit.push"
                :disabled="!canCommit || hasConflicts"
                @click="submitCommit(true)"
              >
                <CloudUpload :size="14" aria-hidden="true" />
                {{ needsPublish ? "提交并发布" : "提交并推送" }}
              </button>
              <button
                type="button"
                class="commit-box__submit commit-box__submit--commit"
                data-agent-id="repo.changes.commit.only"
                :disabled="!canCommit || hasConflicts"
                @click="submitCommit(false)"
              >
                <GitCommitHorizontal :size="14" aria-hidden="true" />
                仅提交
              </button>
            </div>
          </section>
        </div>
      </template>

      <template #diff-actions="{ file, mode }">
        <button
          v-if="file?.patch"
          type="button"
          class="commit-file-diff__action commit-file-diff__toggle"
          data-agent-id="repo.changes.diff.toggle"
          :class="{ 'is-active': mode === 'hunks' }"
          aria-label="折叠 diff"
          :aria-pressed="mode === 'hunks'"
          :title="mode === 'hunks' ? '显示原始 diff' : '显示结构化 diff'"
          @click="toggleDiffMode"
        >
          <ChevronDown :size="13" aria-hidden="true" />
        </button>
      </template>
    </RepoDiffWorkspace>
  </section>
</template>

<style scoped>
.repo-panel {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 0;
}

.changes-sidebar {
  display: grid;
  grid-template-rows: minmax(120px, 1fr) minmax(120px, 1fr) auto;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.changes-group,
.commit-box {
  min-width: 0;
  border-bottom: 1px solid var(--border-soft);
}

.changes-group {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  padding: 10px;
}

.changes-group__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.changes-group__title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.changes-group__title h3 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 1.35;
}

.changes-group__title span {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 11px;
}

.changes-group__arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  color: var(--text-muted);
  background: transparent;
}

.changes-group__arrow:not(:disabled):hover {
  color: var(--accent);
  background: var(--accent-soft);
}

.changes-group__list {
  display: grid;
  align-content: start;
  min-height: 0;
  margin-top: 6px;
  overflow-y: auto;
  overflow-x: hidden;
}

.changes-group__item {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 0 5px;
  border: 0;
  border-top: 1px solid var(--border-soft);
  border-radius: 6px;
  text-align: left;
  color: var(--text);
  background: transparent;
}

.changes-group__item:first-child {
  border-top: 0;
}

.changes-group__item:hover,
.changes-group__item.is-active {
  background: var(--bg-hover);
}

.changes-group__item.is-selected {
  background: var(--accent-soft);
}

.changes-group__item.is-active {
  background: var(--bg-active);
}

.changes-group__item.is-discarding,
.changes-group__item.is-discarding:hover,
.changes-group__item.is-discarding.is-active,
.changes-group__item.is-discarding.is-selected {
  color: var(--text-muted);
  background: var(--bg-subtle);
  cursor: wait;
  opacity: 0.68;
}

.changes-group__item.is-discarding .changes-group__status {
  color: var(--text-muted);
  background: var(--bg-subtle);
}

.changes-group__item:focus-visible,
.changes-group__arrow:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.changes-group__status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
}

.changes-group__status.change-badge--ok {
  color: var(--ok);
  background: color-mix(in srgb, var(--ok) 12%, transparent);
}

.changes-group__status.change-badge--err {
  color: var(--err);
  background: color-mix(in srgb, var(--err) 12%, transparent);
}

.changes-group__status.change-badge--accent {
  color: var(--accent);
  background: var(--accent-soft);
}

.changes-group__status.change-badge--warn {
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 12%, transparent);
}

.changes-group__status.change-badge--muted {
  color: var(--text-muted);
  background: var(--bg-subtle);
}

.changes-group__path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 11px;
}

.changes-group__empty {
  margin: 8px 5px 0;
  font-size: 12px;
}

.commit-box {
  display: grid;
  gap: 8px;
  padding: 10px;
  border-bottom: 0;
}

.commit-box input[type="text"] {
  width: 100%;
}

.commit-box__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.commit-box__submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  white-space: nowrap;
}

.commit-box__submit--push {
  flex: 2 1 0;
}

.commit-box__submit--commit {
  flex: 1 1 0;
}

@media (max-width: 1180px) {
  .repo-panel {
    overflow: auto;
  }
}
</style>

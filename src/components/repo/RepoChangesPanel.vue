<script setup lang="ts">
import { computed } from "vue";
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, GitCommitHorizontal } from "@lucide/vue";
import type { RepoChange } from "../../services/workspace";
import { changeStatusText, changeStatusTone } from "../../utils/repoDisplay";
import RepoDiffWorkspace from "./RepoDiffWorkspace.vue";
import { parseRepoDiffHunks, type RepoDiffWorkspaceFile } from "./repoDiffWorkspace";

const props = defineProps<{
  changes: readonly RepoChange[];
  hasConflicts: boolean;
  canCommit: boolean;
  actionRunning: boolean;
  previewChange: RepoChange | null;
  commitMessage: string;
  pushAfter: boolean;
}>();

const emit = defineEmits<{
  "update:commitMessage": [value: string];
  "update:pushAfter": [value: boolean];
  stageUnstagedChanges: [];
  unstageStagedChanges: [];
  focusChange: [path: string];
  commit: [];
}>();

function changeStatusLetter(change: RepoChange) {
  if (change.conflicted) return "!";
  if (change.untracked) return "U";
  if (change.staged && change.unstaged) return "M";
  if (change.staged) return "S";
  return "W";
}

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
    emptyText: "没有未暂存变更。",
    actionLabel: "暂存全部未暂存变更",
    action: "stageUnstagedChanges" as const,
    icon: ArrowDownToLine,
    changes: unstagedChanges.value,
  },
  {
    key: "staged" as const,
    label: "已暂存变更",
    emptyText: "没有已暂存变更。",
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

function selectFile(file: RepoDiffWorkspaceFile) {
  emit("focusChange", file.path);
}

function runGroupAction(action: "stageUnstagedChanges" | "unstageStagedChanges") {
  if (action === "stageUnstagedChanges") emit("stageUnstagedChanges");
  else emit("unstageStagedChanges");
}
</script>

<template>
  <section class="repo-panel">
    <RepoDiffWorkspace
      :files="workspaceFiles"
      :active-file="activeWorkspaceFile"
      :file-count-label="`${changes.length} 个文件`"
      diff-panel-label="变更预览"
      empty-file-text="没有本地变更。"
      empty-diff-text="当前没有可展示的差异内容。"
      mode="hunks"
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
                :disabled="!group.changes.length || actionRunning"
                :aria-label="group.actionLabel"
                :title="group.actionLabel"
                @click="runGroupAction(group.action)"
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
                :class="{ 'is-active': previewChange?.path === change.path }"
                :title="changeTitle(change)"
                @click="$emit('focusChange', change.path)"
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

          <section class="commit-box" aria-label="提交内容">
            <header class="commit-box__header">
              <h3>提交内容</h3>
              <span>{{ stagedChanges.length }} 个已暂存文件</span>
            </header>
            <p v-if="hasConflicts" class="muted">当前存在冲突，先完成冲突处理再提交。</p>
            <p v-else-if="!stagedChanges.length" class="muted">先暂存需要提交的文件。</p>
            <input
              :value="commitMessage"
              type="text"
              placeholder="提交说明"
              @input="$emit('update:commitMessage', ($event.target as HTMLInputElement).value)"
            />
            <label class="checkbox-line">
              <input
                :checked="pushAfter"
                type="checkbox"
                @change="$emit('update:pushAfter', ($event.target as HTMLInputElement).checked)"
              />
              <span>提交后立即 push</span>
            </label>
            <button type="button" class="primary" :disabled="!canCommit || actionRunning || hasConflicts" @click="$emit('commit')">
              <GitCommitHorizontal :size="14" aria-hidden="true" />
              提交
            </button>
          </section>
        </div>
      </template>

      <template #diff-actions="{ file }">
        <button
          v-if="file?.patch"
          type="button"
          class="commit-file-diff__action commit-file-diff__toggle is-active"
          aria-label="结构化 diff"
          aria-pressed="true"
          title="结构化 diff"
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

.changes-group__header,
.commit-box__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.changes-group__title,
.commit-box__header {
  min-width: 0;
}

.changes-group__title h3,
.commit-box__header h3 {
  margin: 0;
  font-size: 13px;
  line-height: 1.35;
}

.changes-group__title span,
.commit-box__header span {
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
  background: var(--bg);
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

.changes-group__item.is-active {
  background: var(--bg-active);
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

.commit-box p {
  margin: 0;
  font-size: 12px;
}

.commit-box input[type="text"] {
  width: 100%;
}

.commit-box > button.primary {
  justify-self: stretch;
}

.checkbox-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.checkbox-line input {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  padding: 0;
}

@media (max-width: 1180px) {
  .repo-panel {
    overflow: auto;
  }
}
</style>

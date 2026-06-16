<script setup lang="ts">
import { computed } from "vue";
import { ChevronDown, GitCommitHorizontal } from "@lucide/vue";
import type { RepoChange } from "../../services/workspace";
import { changeStatusText, changeStatusTone } from "../../utils/repoDisplay";
import RepoDiffWorkspace from "./RepoDiffWorkspace.vue";
import { parseRepoDiffHunks, type RepoDiffWorkspaceFile } from "./repoDiffWorkspace";

const props = defineProps<{
  changes: readonly RepoChange[];
  selectedFiles: ReadonlySet<string>;
  selectedSummaryText: string;
  selectedFilePreview: string[];
  selectedFileCount: number;
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
  selectAll: [];
  stageSelected: [];
  unstageSelected: [];
  focusChange: [path: string];
  toggleFile: [path: string];
  commit: [];
}>();

function changeStatusLetter(change: RepoChange) {
  if (change.conflicted) return "!";
  if (change.untracked) return "U";
  if (change.staged && change.unstaged) return "M";
  if (change.staged) return "S";
  return "W";
}

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
      @select-file="selectFile"
    >
      <template #meta>
        <section class="commit-detail-meta" aria-label="工作区变更操作">
          <p class="commit-detail-meta__repo">工作区变更</p>
          <h3>{{ selectedSummaryText }}</h3>
          <div class="commit-change-summary">
            <span>{{ changes.length }} 文件</span>
            <span>已选 {{ selectedFileCount }}</span>
            <span v-if="hasConflicts">存在冲突</span>
          </div>
          <div class="change-edit-actions" aria-label="文件操作">
            <button type="button" class="ghost" :disabled="!changes.length" @click="$emit('selectAll')">全选</button>
            <button type="button" class="ghost" :disabled="!selectedFiles.size" @click="$emit('stageSelected')">暂存</button>
            <button type="button" class="ghost" :disabled="!selectedFiles.size" @click="$emit('unstageSelected')">取消暂存</button>
          </div>
          <div class="commit-summary">
            <p v-if="hasConflicts" class="muted">当前存在冲突，先完成冲突处理再提交。</p>
            <p v-if="selectedFilePreview.length" class="muted">
              {{ selectedFilePreview.join(" · ") }}<template v-if="selectedFileCount > selectedFilePreview.length"> 等 {{ selectedFileCount }} 个</template>
            </p>
            <p v-else class="muted">先在下方勾选需要提交的文件。</p>
          </div>
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
      </template>

      <template #header-stat>已选 {{ selectedFileCount }}</template>

      <template #file-prefix="{ file }">
        <span class="repo-change-file-picker__select" @click.stop>
          <input
            type="checkbox"
            :checked="selectedFiles.has(file.path)"
            :aria-label="`选择 ${file.path}`"
            @change="emit('toggleFile', file.path)"
          />
        </span>
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

.repo-panel h2,
.commit-detail-meta__repo,
.commit-detail-meta h3 {
  margin: 0;
}

.commit-detail-meta {
  display: grid;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border-soft);
}

.commit-detail-meta__repo {
  max-width: calc(100% - 36px);
  overflow: hidden;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.commit-detail-meta h3 {
  max-width: calc(100% - 36px);
  overflow-wrap: anywhere;
  font-size: 15px;
  line-height: 1.35;
}

.commit-change-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.repo-change-file-picker__select {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.repo-change-file-picker__select input,
.checkbox-line input {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  padding: 0;
}

.commit-summary p {
  margin: 4px 0 0;
  font-size: 12px;
}

.change-edit-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.commit-detail-meta input[type="text"] {
  width: 100%;
}

.commit-detail-meta > button.primary {
  justify-self: stretch;
}

.checkbox-line {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 1px;
  min-width: 0;
}

@media (max-width: 1180px) {
  .repo-panel {
    overflow: auto;
  }
}
</style>

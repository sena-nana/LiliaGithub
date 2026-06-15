<script setup lang="ts">
import { GitCommitHorizontal } from "@lucide/vue";
import type { RepoChange } from "../../services/workspace";
import { changeStatusText, changeStatusTone } from "../../utils/repoDisplay";

defineProps<{
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

defineEmits<{
  "update:commitMessage": [value: string];
  "update:pushAfter": [value: boolean];
  selectAll: [];
  stageSelected: [];
  unstageSelected: [];
  focusChange: [path: string];
  toggleFile: [path: string];
  commit: [];
}>();
</script>

<template>
  <section class="repo-panel">
    <div class="section-toolbar section-toolbar--compact">
      <div class="repo-panel__title">
        <h2>工作区变更</h2>
        <p class="muted">共 {{ changes.length }} 个文件，{{ selectedSummaryText }}</p>
      </div>
      <div class="toolbar">
        <button type="button" class="ghost" :disabled="!changes.length" @click="$emit('selectAll')">全选</button>
        <button type="button" class="ghost" :disabled="!selectedFiles.size" @click="$emit('stageSelected')">暂存</button>
        <button type="button" class="ghost" :disabled="!selectedFiles.size" @click="$emit('unstageSelected')">取消暂存</button>
      </div>
    </div>

    <div class="change-workspace">
      <div class="change-workspace__primary">
        <p v-if="!changes.length" class="muted repo-empty">没有本地变更。</p>
        <div v-else class="change-list" role="list" aria-label="工作区变更列表">
          <div
            v-for="change in changes"
            :key="change.path"
            class="change-row"
            :class="{ 'is-focused': previewChange?.path === change.path }"
            role="button"
            tabindex="0"
            @click="$emit('focusChange', change.path)"
            @keydown.enter.prevent="$emit('focusChange', change.path)"
            @keydown.space.prevent="$emit('focusChange', change.path)"
          >
            <span class="change-row__select" @click.stop>
              <input
                type="checkbox"
                :checked="selectedFiles.has(change.path)"
                @change="$emit('toggleFile', change.path)"
              />
            </span>
            <span class="change-row__file" :title="change.oldPath ? `${change.oldPath} -> ${change.path}` : change.path">
              <span class="change-row__path">{{ change.path }}</span>
              <small v-if="change.oldPath">来自 {{ change.oldPath }}</small>
            </span>
            <span class="change-badge" :class="changeStatusTone(change)">{{ changeStatusText(change) }}</span>
          </div>
        </div>

        <section class="commit-panel" aria-label="提交并推送">
          <div class="section-toolbar section-toolbar--compact">
            <div class="repo-panel__title">
              <h2>提交并推送</h2>
              <p class="muted">从变更列表选择文件后执行提交</p>
            </div>
          </div>
          <div class="commit-summary">
            <strong>{{ selectedSummaryText }}</strong>
            <p v-if="hasConflicts" class="muted">当前存在冲突，先完成冲突处理再提交。</p>
            <p v-if="selectedFilePreview.length" class="muted">
              {{ selectedFilePreview.join(" · ") }}<template v-if="selectedFileCount > selectedFilePreview.length"> 等 {{ selectedFileCount }} 个</template>
            </p>
            <p v-else class="muted">先在上方勾选需要提交的文件。</p>
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
      </div>

      <section class="diff-preview" aria-label="变更预览">
        <div class="section-toolbar section-toolbar--compact">
          <div class="repo-panel__title">
            <h2>差异预览</h2>
            <p class="muted">{{ previewChange?.path ?? "选择一个文件查看差异" }}</p>
          </div>
        </div>
        <div v-if="previewChange?.diff" class="diff-preview__body">
          <pre><code>{{ previewChange.diff }}</code></pre>
        </div>
        <p v-else class="muted diff-preview__empty">当前没有可展示的差异内容。</p>
      </section>
    </div>
  </section>
</template>

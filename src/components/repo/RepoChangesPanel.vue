<script setup lang="ts">
import type { RepoChange } from "../../services/workspace";
import { changeStatusText, changeStatusTone } from "../../utils/repoDisplay";

defineProps<{
  changes: readonly RepoChange[];
  selectedFiles: ReadonlySet<string>;
  selectedSummaryText: string;
  previewChange: RepoChange | null;
}>();

defineEmits<{
  selectAll: [];
  stageSelected: [];
  unstageSelected: [];
  focusChange: [path: string];
  toggleFile: [path: string];
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

    <p v-if="!changes.length" class="muted repo-empty">没有本地变更。</p>
    <div v-else class="change-workspace">
      <div class="change-list" role="list" aria-label="工作区变更列表">
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

<script setup lang="ts">
import { GitCommitHorizontal } from "@lucide/vue";

defineProps<{
  selectedSummaryText: string;
  selectedFilePreview: string[];
  selectedFileCount: number;
  hasConflicts: boolean;
  canCommit: boolean;
  actionRunning: boolean;
  commitMessage: string;
  pushAfter: boolean;
}>();

defineEmits<{
  "update:commitMessage": [value: string];
  "update:pushAfter": [value: boolean];
  commit: [];
}>();
</script>

<template>
  <section class="card commit-panel" aria-label="提交并推送">
    <div class="section-toolbar section-toolbar--compact">
      <div class="repo-panel__title">
        <h2>提交并推送</h2>
        <p class="muted">从左侧变更列表选择文件后执行提交</p>
      </div>
    </div>
    <div class="commit-summary">
      <strong>{{ selectedSummaryText }}</strong>
      <p v-if="hasConflicts" class="muted">当前存在冲突，先完成冲突处理再提交。</p>
      <p v-if="selectedFilePreview.length" class="muted">
        {{ selectedFilePreview.join(" · ") }}<template v-if="selectedFileCount > selectedFilePreview.length"> 等 {{ selectedFileCount }} 个</template>
      </p>
      <p v-else class="muted">先在左侧勾选需要提交的文件。</p>
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

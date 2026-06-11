<script setup lang="ts">
import { Check, GitBranch } from "@lucide/vue";
import type { BranchSummary } from "../../services/workspace";

defineProps<{
  branches: readonly BranchSummary[];
}>();

defineEmits<{
  checkout: [branchName: string];
}>();
</script>

<template>
  <section class="repo-panel">
    <div class="section-toolbar section-toolbar--compact">
      <div class="repo-panel__title">
        <h2>分支</h2>
        <p class="muted">巡检当前和远端分支状态</p>
      </div>
    </div>
    <p v-if="!branches.length" class="muted repo-empty">没有分支信息。</p>
    <div v-else class="repo-list-panel">
      <div v-for="branch in branches" :key="`${branch.remote}:${branch.name}`" class="branch-row">
        <GitBranch :size="14" aria-hidden="true" />
        <div>
          <strong>{{ branch.name }}</strong>
          <span>{{ branch.remote ? "远端" : "本地" }} · ↑{{ branch.ahead }} / ↓{{ branch.behind }}</span>
        </div>
        <button
          type="button"
          class="ghost"
          :disabled="branch.current || branch.remote"
          @click="$emit('checkout', branch.name)"
        >
          <Check :size="14" aria-hidden="true" />
          Checkout
        </button>
      </div>
    </div>
  </section>
</template>

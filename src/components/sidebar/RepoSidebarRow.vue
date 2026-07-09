<script setup lang="ts">
import { AlertCircle, LoaderCircle, RotateCw } from "@lucide/vue";
import type { Component } from "vue";

interface RepoSidebarIssue {
  label: string;
  message: string;
  retryable: boolean;
  retrying: boolean;
}

defineProps<{
  id: string;
  name: string;
  title: string;
  href: string;
  icon: Component;
  iconClass: string;
  active: boolean;
  dirtyCount: number;
  ahead: number;
  behind: number;
  issue: RepoSidebarIssue | null;
  syncing: boolean;
  refreshing: boolean;
  launchRunning: boolean;
}>();

defineEmits<{
  navigate: [event: MouseEvent];
  retry: [];
}>();
</script>

<template>
  <a
    :href="href"
    class="sb-tree__row sb-tree__row--project"
    :class="{ 'is-active': active }"
    :data-agent-id="`sidebar.repo.${id}`"
    :data-sidebar-repo-id="id"
    :title="title"
    @click="$emit('navigate', $event)"
  >
    <component
      :is="icon"
      :size="14"
      aria-hidden="true"
      class="sb-tree__repo-icon"
      :class="iconClass"
    />
    <span class="sb-tree__name">{{ name }}</span>
    <span
      v-if="syncing"
      class="sb-badge"
      title="正在同步"
      aria-label="正在同步"
    >
      <LoaderCircle :size="11" aria-hidden="true" class="sb-spin" />
    </span>
    <span
      v-else-if="issue"
      class="sb-issue"
      :title="issue.message"
      :aria-label="issue.label"
    >
      <AlertCircle :size="11" aria-hidden="true" />
    </span>
    <button
      v-if="issue?.retryable"
      type="button"
      class="sb-retry"
      :data-agent-id="`sidebar.repo.${id}.retry`"
      :title="issue.retrying ? '正在重试' : '重试'"
      :aria-label="issue.retrying ? '正在重试' : '重试最近同步失败'"
      :disabled="issue.retrying"
      @click.prevent.stop="$emit('retry')"
    >
      <LoaderCircle v-if="issue.retrying" :size="11" aria-hidden="true" class="sb-spin" />
      <RotateCw v-else :size="11" aria-hidden="true" />
    </button>
    <span v-if="launchRunning" class="sb-badge sb-badge--ok">RUN</span>
    <span v-if="dirtyCount" class="sb-badge sb-badge--warn">{{ dirtyCount }}</span>
    <span v-if="ahead" class="sb-badge">↑{{ ahead }}</span>
    <span v-if="behind" class="sb-badge">↓{{ behind }}</span>
    <span
      v-if="refreshing"
      class="sb-row-loader"
      title="正在刷新仓库"
      aria-label="正在刷新仓库"
    >
      <LoaderCircle :size="11" aria-hidden="true" class="sb-spin" />
    </span>
  </a>
</template>

<style scoped>
.sb-row-loader {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.sb-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  line-height: 17px;
  text-align: center;
}

.sb-badge--warn {
  background: var(--warn-soft);
  color: var(--warn);
}

.sb-badge--ok {
  background: var(--ok-soft);
  color: var(--ok);
}

.sb-issue,
.sb-retry {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--err-soft);
  color: var(--err);
}

.sb-retry {
  padding: 0;
  border: 0;
  cursor: pointer;
}

.sb-retry:hover {
  background: color-mix(in srgb, var(--err-soft) 72%, var(--bg-hover));
}

.sb-retry:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.sb-spin {
  animation: sb-spin 0.9s linear infinite;
}

@keyframes sb-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

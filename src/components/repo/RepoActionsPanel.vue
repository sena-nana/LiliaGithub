<script setup lang="ts">
import {
  CheckCircle2,
  CircleDot,
  XCircle,
} from "@lucide/vue";
import { computed, ref, watch } from "vue";
import type { GitHubWorkflowRun } from "../../services/workspace/types";
import { workflowRunStatusText, workflowRunStatusTone } from "../../utils/repoDisplay";
import { actionRunMetaText, actionStatusIconKind } from "./actionsDisplay";

const props = defineProps<{
  runs: readonly GitHubWorkflowRun[];
  loading: boolean;
  focusedRunId?: number | null;
}>();

const emit = defineEmits<{
  focusRun: [runId: number | null];
}>();

const RUN_RENDER_PAGE_SIZE = 50;
const visibleRunCount = ref(RUN_RENDER_PAGE_SIZE);

const visibleRuns = computed(() => props.runs.slice(0, visibleRunCount.value));
const hiddenRunCount = computed(() => Math.max(0, props.runs.length - visibleRuns.value.length));

watch(
  () => [
    props.runs.length,
    props.runs.map((run) => run.id).join(","),
  ],
  () => {
    visibleRunCount.value = RUN_RENDER_PAGE_SIZE;
  },
);

function showMoreRuns() {
  visibleRunCount.value += RUN_RENDER_PAGE_SIZE;
}

function runToneClass(run: GitHubWorkflowRun) {
  return `actions-status--${workflowRunStatusTone(run)}`;
}

</script>

<template>
  <div class="actions-panel">
    <h3 class="actions-panel__sr-title">Actions</h3>
    <div class="actions-panel__runs" role="list" aria-label="Actions 运行列表">
      <div class="actions-panel__runs-head">
        <div>
          <strong>运行</strong>
          <span>{{ runs.length }} 条运行</span>
        </div>
      </div>

      <p v-if="loading && !runs.length" class="muted actions-empty">正在读取 GitHub Actions。</p>
      <button
        v-for="run in visibleRuns"
        :key="run.id"
        type="button"
        class="actions-run repo-list-row"
        :class="{ 'is-active': focusedRunId === run.id }"
        :data-run-id="run.id"
        :data-agent-id="`repo.actions.run.${run.id}`"
        @click="emit('focusRun', focusedRunId === run.id ? null : run.id)"
      >
        <span class="actions-status repo-list-row__status" :class="runToneClass(run)" :title="workflowRunStatusText(run)" :aria-label="workflowRunStatusText(run)">
          <XCircle v-if="actionStatusIconKind(run) === 'error'" :size="15" aria-hidden="true" />
          <CheckCircle2 v-else-if="actionStatusIconKind(run) === 'ok'" :size="15" aria-hidden="true" />
          <CircleDot v-else :size="15" aria-hidden="true" />
        </span>
        <span class="actions-run__body repo-list-row__body">
          <strong class="repo-list-row__title">{{ run.displayTitle }}</strong>
          <span class="actions-run__meta repo-list-row__meta">{{ actionRunMetaText(run) }}</span>
        </span>
      </button>
      <p v-if="!runs.length && !loading" class="muted actions-empty">没有匹配的 GitHub Actions 运行记录。</p>
      <button
        v-if="hiddenRunCount > 0"
        type="button"
        class="actions-list__more"
        data-agent-id="repo.actions.show-more"
        @click="showMoreRuns"
      >
        显示更多 {{ hiddenRunCount }} 个
      </button>
    </div>
  </div>
</template>

<style scoped>
.actions-panel {
  display: grid;
  gap: 10px;
  min-width: 0;
  height: 100%;
}

.actions-panel__sr-title {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.actions-panel__runs {
  display: grid;
  align-content: start;
  min-width: 0;
}

.actions-panel__runs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  min-height: 34px;
  padding: 0 2px 6px;
  border-bottom: 1px solid var(--border-soft);
}

.actions-panel__runs-head div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.actions-panel__runs-head strong {
  color: var(--text);
  font-size: 13px;
}

.actions-panel__runs-head span {
  color: var(--text-muted);
  font-size: 11px;
}

.actions-run {
  min-height: 44px;
  padding: 7px 8px;
  border-bottom: 1px solid var(--border-soft);
  cursor: pointer;
}

.actions-run:last-of-type {
  border-bottom: 0;
}

.actions-run__meta {
  min-width: max-content;
}

.actions-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.actions-status--ok {
  color: var(--ok);
}

.actions-status--error {
  color: var(--err);
}

.actions-status--warn {
  color: var(--warn);
}

.actions-status--muted {
  color: var(--text-muted);
}

.actions-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
}

.actions-empty {
  margin: 0;
  padding: 10px;
}

.actions-list__more {
  width: 100%;
  min-height: 34px;
  border: 0;
  border-top: 1px solid var(--border-soft);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.actions-list__more:hover,
.actions-list__more:focus-visible {
  background: var(--bg-subtle);
  color: var(--text);
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

<script setup lang="ts">
import { LoaderCircle, RefreshCw } from "@lucide/vue";

defineProps<{
  loading: boolean;
  error: string | null;
  totalContributions: number;
  skippedRepoCount: number;
  hasContributionDays: boolean;
  chartHtml: string;
}>();

defineEmits<{
  retry: [];
}>();
</script>

<template>
  <div class="card contribution-card">
    <div class="card-heading">
      <div>
        <h2>
          最近工作结果
          <LoaderCircle
            v-if="loading"
            :size="13"
            aria-hidden="true"
            class="card-title-loader"
          />
        </h2>
        <p class="contribution-total">{{ totalContributions }} 次提交，最近一年</p>
        <p v-if="skippedRepoCount > 0" class="contribution-notice">
          已跳过 {{ skippedRepoCount }} 个不可读取仓库
        </p>
      </div>
      <button
        v-if="error"
        type="button"
        class="ghost contribution-retry"
        :disabled="loading"
        @click="$emit('retry')"
      >
        <RefreshCw :size="13" aria-hidden="true" />
        重试
      </button>
    </div>
    <p v-if="error" class="contribution-error">
      {{ error }}
    </p>
    <div
      v-if="loading && !hasContributionDays"
      class="contribution-loading"
      aria-label="本地提交加载中"
    >
      <span v-for="index in 84" :key="index" />
    </div>
    <p
      v-else-if="!loading && totalContributions <= 0 && !error"
      class="contribution-empty"
    >
      暂无本地提交
    </p>
    <div v-else class="contribution-chart" aria-label="本地提交贡献图">
      <div class="contribution-week-labels" aria-hidden="true">
        <span class="contribution-month-spacer" />
        <span />
        <span>Mon</span>
        <span />
        <span>Wed</span>
        <span />
        <span>Fri</span>
        <span />
      </div>
      <div class="contribution-window" v-html="chartHtml" />
    </div>
  </div>
</template>

<style scoped>
.contribution-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 760px;
  contain: layout paint style;
  content-visibility: auto;
  contain-intrinsic-size: 180px;
}

.card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.card-heading h2 {
  margin: 0;
}

.contribution-total {
  margin: 3px 0 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.contribution-notice {
  margin: 2px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.contribution-retry {
  height: 26px;
  padding: 0 7px;
  color: var(--ok);
}

.contribution-error,
.contribution-empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.contribution-error {
  color: var(--err);
  margin-bottom: 8px;
}

.contribution-chart {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 8px;
  padding-bottom: 2px;
  min-width: 0;
  contain: layout paint;
}

.contribution-week-labels {
  display: grid;
  grid-template-rows: 14px repeat(7, 11px);
  gap: 3px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 11px;
}

.contribution-month-spacer {
  height: 14px;
}

.contribution-window {
  display: flex;
  justify-content: flex-end;
  min-width: 0;
  overflow: hidden;
  contain: layout paint style;
}

.contribution-window :deep(.contribution-grid) {
  min-width: max-content;
  contain: layout paint style;
}

.contribution-window :deep(.contribution-months) {
  display: flex;
  gap: 3px;
  min-width: max-content;
  margin-bottom: 3px;
}

.contribution-window :deep(.contribution-month) {
  width: 11px;
  height: 14px;
  overflow: visible;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 14px;
  white-space: nowrap;
}

.contribution-window :deep(.contribution-weeks) {
  display: flex;
  gap: 3px;
  min-width: max-content;
  contain: layout paint style;
}

.contribution-window :deep(.contribution-week) {
  display: grid;
  grid-template-rows: repeat(7, 11px);
  gap: 3px;
  contain: layout paint style;
}

.contribution-window :deep(.contribution-day) {
  display: block;
  width: 11px;
  height: 11px;
  border-radius: 2px;
  background: var(--bg-subtle);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bg) 20%, transparent);
  contain: strict;
}

.contribution-window :deep(.contribution-day--1) {
  background: color-mix(in srgb, var(--ok) 30%, var(--bg-subtle));
}

.contribution-window :deep(.contribution-day--2) {
  background: color-mix(in srgb, var(--ok) 55%, var(--bg-subtle));
}

.contribution-window :deep(.contribution-day--3) {
  background: color-mix(in srgb, var(--ok) 78%, var(--bg-subtle));
}

.contribution-window :deep(.contribution-day--4) {
  background: #3fb950;
}

.contribution-loading {
  display: grid;
  grid-template-columns: repeat(21, 11px);
  gap: 3px;
  min-height: 98px;
}

.contribution-loading span {
  width: 11px;
  height: 11px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--ok) 14%, var(--bg-subtle));
}
</style>

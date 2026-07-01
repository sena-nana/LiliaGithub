<script setup lang="ts">
import { LoaderCircle, RefreshCw } from "@lucide/vue";
import type { ContributionChartModel } from "../../utils/contributionChart";

defineProps<{
  loading: boolean;
  error: string | null;
  totalContributions: number;
  skippedRepoCount: number;
  hasContributionDays: boolean;
  chartModel: ContributionChartModel;
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
    <div v-else class="contribution-chart">
      <div class="contribution-window">
        <span
          v-for="cell in chartModel.activeCells"
          :key="cell.date"
          class="contribution-cell-label"
          :aria-label="cell.title"
        />
        <svg
          class="contribution-svg"
          role="img"
          aria-label="本地提交贡献图"
          :viewBox="chartModel.viewBox"
          :width="chartModel.width"
          :height="chartModel.height"
        >
          <text
            v-for="label in chartModel.dayLabels"
            :key="label.label"
            class="contribution-day-label"
            :x="label.x"
            :y="label.y"
          >
            {{ label.label }}
          </text>
          <text
            v-for="month in chartModel.monthLabels"
            :key="month.key"
            class="contribution-month"
            :x="month.x"
            y="10"
          >
            {{ month.label }}
          </text>
          <path
            v-for="path in chartModel.levelPaths"
            :key="path.level"
            class="contribution-level"
            :class="`contribution-level--${path.level}`"
            :d="path.d"
          />
        </svg>
      </div>
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
  display: flex;
  padding-bottom: 2px;
  min-width: 0;
  contain: layout paint;
}

.contribution-window {
  position: relative;
  display: flex;
  justify-content: flex-end;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  contain: layout paint style;
}

.contribution-cell-label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.contribution-svg {
  display: block;
  flex: 0 0 auto;
  min-width: max-content;
  contain: layout paint style;
}

.contribution-month,
.contribution-day-label {
  color: var(--text-muted);
  fill: currentColor;
  font-family: inherit;
}

.contribution-month {
  font-size: 10px;
}

.contribution-day-label {
  font-size: 11px;
}

.contribution-level {
  stroke: color-mix(in srgb, var(--bg) 20%, transparent);
  stroke-width: 1;
}

.contribution-level--0 {
  fill: var(--bg-subtle);
}

.contribution-level--1 {
  fill: color-mix(in srgb, var(--ok) 30%, var(--bg-subtle));
}

.contribution-level--2 {
  fill: color-mix(in srgb, var(--ok) 55%, var(--bg-subtle));
}

.contribution-level--3 {
  fill: color-mix(in srgb, var(--ok) 78%, var(--bg-subtle));
}

.contribution-level--4 {
  fill: #3fb950;
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

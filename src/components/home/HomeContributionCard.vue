<script setup lang="ts">
import { LoaderCircle, RefreshCw } from "@lucide/vue";
import { ContributionHeatmap, type ContributionHeatmapModel } from "@lilia/ui";
import { RouterLink, type RouteLocationRaw } from "vue-router";

defineProps<{
  loading: boolean;
  error: string | null;
  totalContributions: number;
  skippedRepoCount: number;
  skippedRepoActionTo?: RouteLocationRaw;
  hasContributionDays: boolean;
  chartModel: ContributionHeatmapModel;
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
          <template v-if="skippedRepoActionTo">
            <span aria-hidden="true"> · </span>
            <RouterLink
              class="contribution-notice__action"
              :to="skippedRepoActionTo"
            >
              处理
            </RouterLink>
          </template>
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
        <ContributionHeatmap
          :model="chartModel"
          aria-label="本地提交贡献图"
        />
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

.contribution-notice__action {
  color: var(--accent);
  font-weight: 600;
  text-decoration: none;
}

.contribution-notice__action:hover {
  color: var(--accent-strong);
  text-decoration: underline;
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

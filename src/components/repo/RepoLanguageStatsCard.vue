<script setup lang="ts">
import { computed } from "vue";
import { LoaderCircle } from "@lucide/vue";
import type { RepoSummary } from "../../services/workspace";
import {
  buildLanguageOverviewFromStats,
  formatLines,
  formatPercent,
} from "../../utils/languageStats";

const props = defineProps<{
  repo: RepoSummary | null;
  showLineCounts: boolean;
  loading: boolean;
}>();

const REPO_LANGUAGE_SLICE_LIMIT = 4;
const stats = computed(() => props.repo?.languageStats ?? []);
const overview = computed(() => buildLanguageOverviewFromStats(stats.value, REPO_LANGUAGE_SLICE_LIMIT));
const hasLanguageStats = computed(() => overview.value.slices.length > 0);
</script>

<template>
  <section class="repo-language-card" aria-label="代码统计">
    <div v-if="loading" class="repo-language-card__head">
      <LoaderCircle v-if="loading" :size="13" aria-hidden="true" class="sb-spin" />
    </div>

    <p v-if="!hasLanguageStats" class="repo-language-card__empty">暂无语言数据</p>

    <template v-else>
      <div class="repo-language-card__bar" aria-label="代码语言占比">
        <span
          v-for="slice in overview.slices"
          :key="slice.language"
          class="repo-language-card__bar-segment"
          :style="{
            background: slice.color,
            flex: `${slice.percent} 1 0%`,
          }"
          :title="`${slice.language} ${formatPercent(slice.percent)}`"
          :aria-label="`${slice.language} ${formatPercent(slice.percent)}`"
        />
      </div>

      <ul class="repo-language-card__list">
        <li v-for="slice in overview.slices" :key="slice.language">
          <span class="repo-language-card__dot" :style="{ background: slice.color }" aria-hidden="true" />
          <span class="repo-language-card__name">{{ slice.language }}</span>
          <strong>
            <span v-if="showLineCounts">{{ formatLines(slice.lines) }} · </span>
            {{ formatPercent(slice.percent) }}
          </strong>
        </li>

        <li v-if="showLineCounts && overview.totalLines > 0">
          <span class="repo-language-card__dot" :style="{ background: 'var(--text-muted)' }" aria-hidden="true" />
          <span class="repo-language-card__name">总代码行数</span>
          <strong>{{ formatLines(overview.totalLines) }}</strong>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.repo-language-card {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
}

.repo-language-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.repo-language-card__empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.repo-language-card__bar {
  display: flex;
  width: 100%;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--bg-subtle);
}

.repo-language-card__bar-segment {
  min-width: 3px;
  height: 100%;
}

.repo-language-card__bar-segment + .repo-language-card__bar-segment {
  box-shadow: inset 1px 0 0 var(--bg-subtle);
}

.repo-language-card__list {
  display: grid;
  gap: 7px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.repo-language-card__list li {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) max-content;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.repo-language-card__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.repo-language-card__name {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-language-card__list strong {
  color: var(--text-muted);
  font-weight: 600;
}

</style>

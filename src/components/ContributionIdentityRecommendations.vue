<script setup lang="ts">
import { LoaderCircle } from "@lucide/vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";
import type {
  ContributionIdentityRecommendation,
  ContributionIdentityRecommendationConfidence,
  ContributionIdentityRecommendationResult,
} from "../services/workspace";
import { contributionIdentityKey } from "../utils/contributionIdentities";

withDefaults(defineProps<{
  result: ContributionIdentityRecommendationResult | null;
  loading: boolean;
  savingKey?: string | null;
  error?: string | null;
  settingsTo?: RouteLocationRaw | null;
}>(), {
  savingKey: null,
  error: null,
  settingsTo: null,
});

defineEmits<{
  adopt: [recommendation: ContributionIdentityRecommendation];
}>();

const CONFIDENCE_TEXT: Record<ContributionIdentityRecommendationConfidence, string> = {
  gitConfig: "高",
  relatedAuthor: "中",
  singleAuthor: "低",
};

function identityText(recommendation: ContributionIdentityRecommendation) {
  const { name, email } = recommendation.identity;
  if (name && email) return `${name} <${email}>`;
  return name ?? email ?? "未命名身份";
}

function recommendationSummary(recommendation: ContributionIdentityRecommendation) {
  if (recommendation.missedCommitCount > 0) {
    return `可补回 ${recommendation.missedCommitCount} 次提交，涉及 ${recommendation.repoCount} 个仓库`;
  }
  return `出现在 ${recommendation.repoCount} 个仓库配置`;
}

function repoEvidenceText(recommendation: ContributionIdentityRecommendation) {
  const names = recommendation.repos.map((repo) => repo.repoName).filter(Boolean);
  const compact = names.slice(0, 2).join("、");
  if (!compact) return "";
  const extra = names.length > 2 ? ` 等 ${names.length} 个仓库` : "";
  return `${compact}${extra}`;
}

function isSaving(recommendation: ContributionIdentityRecommendation, savingKey: string | null | undefined) {
  return savingKey === contributionIdentityKey(recommendation.identity);
}
</script>

<template>
  <section class="identity-recommendations" aria-label="贡献身份推荐">
    <div class="identity-recommendations__heading">
      <div>
        <h3>贡献身份推荐</h3>
        <p v-if="result">
          已扫描 {{ result.scannedRepoCount }} 个仓库
        </p>
      </div>
    </div>

    <p v-if="error" class="identity-recommendations__error">
      {{ error }}
    </p>

    <div v-else-if="loading && !result" class="identity-recommendations__loading">
      <LoaderCircle :size="14" aria-hidden="true" class="spin" />
      正在扫描贡献身份
    </div>

    <div
      v-else-if="result && result.recommendations.length > 0"
      class="identity-recommendations__list"
    >
      <article
        v-for="recommendation in result.recommendations"
        :key="contributionIdentityKey(recommendation.identity)"
        class="identity-recommendations__item"
      >
        <div class="identity-recommendations__body">
          <div class="identity-recommendations__identity">
            <strong>{{ identityText(recommendation) }}</strong>
            <span>置信度 {{ CONFIDENCE_TEXT[recommendation.confidence] }}</span>
          </div>
          <p>{{ recommendationSummary(recommendation) }}</p>
          <p v-if="repoEvidenceText(recommendation)" class="identity-recommendations__repo">
            {{ repoEvidenceText(recommendation) }}
          </p>
        </div>
        <button
          type="button"
          class="primary identity-recommendations__adopt"
          :disabled="loading || Boolean(savingKey)"
          @click="$emit('adopt', recommendation)"
        >
          <LoaderCircle
            v-if="isSaving(recommendation, savingKey)"
            :size="14"
            aria-hidden="true"
            class="spin"
          />
          采纳
        </button>
      </article>
    </div>

    <p v-else-if="result" class="identity-recommendations__empty">
      暂无可推荐身份
      <template v-if="settingsTo">
        <span aria-hidden="true"> · </span>
        <RouterLink :to="settingsTo">手动编辑</RouterLink>
      </template>
    </p>
  </section>
</template>

<style scoped>
.identity-recommendations {
  display: grid;
  gap: 8px;
  width: 100%;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-subtle) 86%, transparent);
}

.identity-recommendations__heading,
.identity-recommendations__item,
.identity-recommendations__identity {
  display: flex;
  align-items: center;
}

.identity-recommendations__heading,
.identity-recommendations__item {
  justify-content: space-between;
  gap: 10px;
}

.identity-recommendations__heading h3 {
  margin: 0;
  font-size: 13px;
}

.identity-recommendations__heading p,
.identity-recommendations__body p,
.identity-recommendations__empty,
.identity-recommendations__loading,
.identity-recommendations__error {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.identity-recommendations__adopt {
  height: 28px;
  padding: 0 9px;
  white-space: nowrap;
}

.identity-recommendations__list {
  display: grid;
  gap: 6px;
}

.identity-recommendations__item {
  padding: 8px;
  border-radius: 6px;
  background: var(--bg);
}

.identity-recommendations__body {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.identity-recommendations__identity {
  min-width: 0;
  gap: 7px;
}

.identity-recommendations__identity strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.identity-recommendations__identity span {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 11px;
}

.identity-recommendations__repo {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.identity-recommendations__loading {
  display: flex;
  align-items: center;
  gap: 6px;
}

.identity-recommendations__error {
  color: var(--err);
}

.identity-recommendations__empty a {
  color: var(--accent);
  font-weight: 600;
  text-decoration: none;
}

.identity-recommendations__empty a:hover {
  color: var(--accent-strong);
  text-decoration: underline;
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .identity-recommendations__item {
    align-items: stretch;
    flex-direction: column;
  }

  .identity-recommendations__adopt {
    width: 100%;
  }
}
</style>

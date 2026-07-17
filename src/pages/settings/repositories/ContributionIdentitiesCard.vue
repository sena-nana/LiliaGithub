<script setup lang="ts">
import { ref, watch } from "vue";
import { UiButton, UiCard } from "../../../ui";
import ContributionIdentityRecommendations from "../../../components/ContributionIdentityRecommendations.vue";
import { useComponentEpoch } from "../../../composables/useComponentEpoch";
import { useWorkspace } from "../../../composables/useWorkspace";
import type {
  ContributionIdentity,
  ContributionIdentityRecommendation,
  ContributionIdentityRecommendationResult,
} from "../../../services/workspace";
import {
  contributionIdentityKey,
  mergeContributionIdentity,
  normalizeContributionIdentities,
} from "../../../utils/contributionIdentities";

const workspace = useWorkspace();
const componentEpoch = useComponentEpoch();
const contributionIdentityDraft = ref<ContributionIdentity[]>([]);
const editingContributionIdentityIndex = ref<number | null>(null);
const savingContributionIdentities = ref(false);
const contributionIdentitySaved = ref(false);
const contributionIdentityRecommendations = ref<ContributionIdentityRecommendationResult | null>(null);
const scanningContributionIdentities = ref(false);
const adoptingContributionIdentityKey = ref<string | null>(null);
const contributionRecommendationError = ref<string | null>(null);
const error = ref<string | null>(null);

function cloneContributionIdentities(identities: readonly ContributionIdentity[] | undefined) {
  return (identities ?? []).map((identity) => ({
    name: identity.name ?? "",
    email: identity.email ?? "",
  }));
}

function normalizeContributionIdentityDraft() {
  return normalizeContributionIdentities(contributionIdentityDraft.value);
}

function isContributionIdentityEditing(index: number) {
  return editingContributionIdentityIndex.value === index;
}

function canSaveContributionIdentity(index: number) {
  const identity = contributionIdentityDraft.value[index];
  return Boolean(identity?.name?.trim() || identity?.email?.trim());
}

function addContributionIdentity() {
  contributionIdentityDraft.value.push({ name: "", email: "" });
  editingContributionIdentityIndex.value = contributionIdentityDraft.value.length - 1;
  contributionIdentitySaved.value = false;
}

function removeContributionIdentity(index: number) {
  contributionIdentityDraft.value.splice(index, 1);
  if (editingContributionIdentityIndex.value === index) {
    editingContributionIdentityIndex.value = null;
  } else if (editingContributionIdentityIndex.value !== null && editingContributionIdentityIndex.value > index) {
    editingContributionIdentityIndex.value -= 1;
  }
  contributionIdentitySaved.value = false;
}

function markContributionIdentityChanged() {
  contributionIdentitySaved.value = false;
}

async function saveContributionIdentities() {
  savingContributionIdentities.value = true;
  contributionIdentitySaved.value = false;
  error.value = null;
  try {
    await workspace.setContributionIdentities(normalizeContributionIdentityDraft());
    if (!componentEpoch.assertAlive()) return;
    contributionIdentitySaved.value = true;
    return true;
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    error.value = String(err);
    return false;
  } finally {
    if (componentEpoch.assertAlive()) savingContributionIdentities.value = false;
  }
}

async function saveContributionIdentity(index: number) {
  if (!canSaveContributionIdentity(index)) return;
  if (await saveContributionIdentities()) {
    editingContributionIdentityIndex.value = null;
  }
}

async function scanContributionIdentities() {
  if (scanningContributionIdentities.value || savingContributionIdentities.value) return;
  scanningContributionIdentities.value = true;
  contributionRecommendationError.value = null;
  try {
    const result = await workspace.scanContributionIdentities();
    if (!componentEpoch.assertAlive()) return;
    contributionIdentityRecommendations.value = result;
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    contributionRecommendationError.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) scanningContributionIdentities.value = false;
  }
}

async function adoptContributionIdentityRecommendation(recommendation: ContributionIdentityRecommendation) {
  const key = contributionIdentityKey(recommendation.identity);
  if (scanningContributionIdentities.value || savingContributionIdentities.value || adoptingContributionIdentityKey.value) {
    return;
  }
  adoptingContributionIdentityKey.value = key;
  savingContributionIdentities.value = true;
  contributionIdentitySaved.value = false;
  contributionRecommendationError.value = null;
  try {
    const identities = mergeContributionIdentity(normalizeContributionIdentityDraft(), recommendation.identity);
    const settings = await workspace.setContributionIdentities(identities);
    if (!componentEpoch.assertAlive()) return;
    contributionIdentityDraft.value = cloneContributionIdentities(settings.contributionIdentities);
    contributionIdentitySaved.value = true;
    contributionIdentityRecommendations.value = contributionIdentityRecommendations.value
      ? {
        ...contributionIdentityRecommendations.value,
        recommendations: contributionIdentityRecommendations.value.recommendations.filter(
          (item) => contributionIdentityKey(item.identity) !== key,
        ),
      }
      : null;
    void workspace.refreshRepoContributions();
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    contributionRecommendationError.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) {
      adoptingContributionIdentityKey.value = null;
      savingContributionIdentities.value = false;
    }
  }
}

watch(
  () => workspace.state.settings?.contributionIdentities,
  (identities) => {
    contributionIdentityDraft.value = cloneContributionIdentities(identities);
    contributionIdentitySaved.value = false;
  },
  { immediate: true },
);
</script>

<template>
  <UiCard
    class="contribution-identities-card"
    agent-id="settings.repositories.contribution-identities"
    aria-labelledby="contribution-identity-list-title"
  >
    <template #title>
      <span
        id="contribution-identity-list-title"
        tabindex="-1"
        data-agent-id="settings.repositories.contribution-identities.title"
      >
        贡献身份
      </span>
    </template>

    <div class="contribution-identity-list__head">
      <p>热度图只统计这些名称或邮箱对应的本地提交。</p>
      <div class="contribution-identity-list__head-actions">
        <UiButton
          size="sm"
          agent-id="settings.repositories.contribution-identities.scan"
          :disabled="scanningContributionIdentities || savingContributionIdentities || Boolean(adoptingContributionIdentityKey)"
          :busy="scanningContributionIdentities"
          @click="scanContributionIdentities"
        >
          {{ scanningContributionIdentities ? "扫描中" : "扫描推荐" }}
        </UiButton>
        <UiButton
          size="sm"
          agent-id="settings.repositories.contribution-identities.add"
          @click="addContributionIdentity"
        >
          添加身份
        </UiButton>
      </div>
    </div>

    <ContributionIdentityRecommendations
      v-if="contributionIdentityRecommendations || scanningContributionIdentities || contributionRecommendationError"
      :result="contributionIdentityRecommendations"
      :loading="scanningContributionIdentities"
      :saving-key="adoptingContributionIdentityKey"
      :error="contributionRecommendationError"
      @adopt="adoptContributionIdentityRecommendation"
    />

    <div class="contribution-identity-list__rows">
      <div
        v-for="(identity, index) in contributionIdentityDraft"
        :key="index"
        class="contribution-identity-list__row"
        :class="{ 'is-preview': !isContributionIdentityEditing(index) }"
      >
        <template v-if="isContributionIdentityEditing(index)">
          <label>
            <span>名称</span>
            <input
              v-model="identity.name"
              type="text"
              :data-agent-id="`settings.repositories.contribution-identities.${index}.name`"
              @input="markContributionIdentityChanged"
            />
          </label>
          <label>
            <span>邮箱</span>
            <input
              v-model="identity.email"
              type="email"
              :data-agent-id="`settings.repositories.contribution-identities.${index}.email`"
              @input="markContributionIdentityChanged"
            />
          </label>
        </template>
        <template v-else>
          <div class="contribution-identity-list__preview-field">
            <span>名称</span>
            <strong>{{ identity.name || "未命名" }}</strong>
          </div>
          <div class="contribution-identity-list__preview-field">
            <span>邮箱</span>
            <strong>{{ identity.email || "未填写" }}</strong>
          </div>
        </template>
        <div class="contribution-identity-list__row-actions">
          <UiButton
            v-if="isContributionIdentityEditing(index)"
            size="sm"
            :agent-id="`settings.repositories.contribution-identities.${index}.save`"
            :disabled="savingContributionIdentities || !canSaveContributionIdentity(index)"
            :busy="savingContributionIdentities"
            @click="saveContributionIdentity(index)"
          >
            {{ savingContributionIdentities ? "保存中" : "保存" }}
          </UiButton>
          <UiButton
            v-else
            size="sm"
            :agent-id="`settings.repositories.contribution-identities.${index}.edit`"
            @click="editingContributionIdentityIndex = index"
          >
            编辑
          </UiButton>
          <UiButton
            variant="danger"
            size="sm"
            :agent-id="`settings.repositories.contribution-identities.${index}.remove`"
            :aria-label="`删除贡献身份 ${index + 1}`"
            @click="removeContributionIdentity(index)"
          >
            删除
          </UiButton>
        </div>
      </div>
      <p v-if="!contributionIdentityDraft.length" class="muted">未添加身份时使用仓库用户配置。</p>
    </div>

    <p v-if="error" class="contribution-identity-list__error" role="alert">{{ error }}</p>

    <div class="contribution-identity-list__footer">
      <UiButton
        variant="primary"
        size="sm"
        agent-id="settings.repositories.contribution-identities.save"
        :busy="savingContributionIdentities"
        @click="saveContributionIdentities"
      >
        {{ savingContributionIdentities ? "保存中" : "保存贡献身份" }}
      </UiButton>
      <span v-if="contributionIdentitySaved">已保存</span>
    </div>
  </UiCard>
</template>

<style scoped>
.contribution-identities-card {
  display: grid;
  gap: 10px;
}

.contribution-identity-list__head,
.contribution-identity-list__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.contribution-identity-list__head > p {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.contribution-identity-list__head-actions {
  display: inline-flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.contribution-identity-list__rows {
  display: grid;
  gap: 8px;
}

.contribution-identity-list__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) auto;
  gap: 8px;
  align-items: end;
}

.contribution-identity-list__row.is-preview {
  align-items: center;
}

.contribution-identity-list__row label,
.contribution-identity-list__preview-field {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.contribution-identity-list__row span {
  color: var(--text-muted);
  font-size: 11px;
}

.contribution-identity-list__row input {
  min-width: 0;
}

.contribution-identity-list__preview-field strong {
  min-width: 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.contribution-identity-list__row-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.contribution-identity-list__footer {
  justify-content: flex-start;
}

.contribution-identity-list__footer span {
  color: var(--ok);
  font-size: 12px;
}

.contribution-identity-list__error {
  margin: 0;
  color: var(--err);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.muted {
  margin: 4px 0;
}

@media (max-width: 700px) {
  .contribution-identity-list__head,
  .contribution-identity-list__footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .contribution-identity-list__row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .contribution-identity-list__row label {
    grid-column: 1 / -1;
  }
}
</style>

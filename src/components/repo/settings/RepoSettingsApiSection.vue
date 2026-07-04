<script setup lang="ts">
import { ref, watch } from "vue";
import { AlertCircle, LoaderCircle, RotateCw } from "@lucide/vue";
import { getGitHubRepoSettingsSection } from "../../../services/workspace/client";
import type {
  GitHubRepoSettingsEndpointItem,
  GitHubRepoSettingsSection,
  GitHubRepoSettingsSectionKey,
} from "../../../services/workspace/types";

const props = defineProps<{
  repoFullName: string;
  section: GitHubRepoSettingsSectionKey;
  title: string;
  active: boolean;
}>();

const sectionState = ref<GitHubRepoSettingsSection | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

watch(
  () => [props.active, props.repoFullName, props.section] as const,
  ([active]) => {
    if (active && !sectionState.value && !loading.value) void loadSection();
  },
  { immediate: true },
);

async function loadSection(forceRefresh = false) {
  loading.value = true;
  error.value = null;
  try {
    sectionState.value = await getGitHubRepoSettingsSection(props.repoFullName, props.section, { forceRefresh });
  } catch (err) {
    error.value = String(err);
  } finally {
    loading.value = false;
  }
}

function formatValue(item: GitHubRepoSettingsEndpointItem) {
  if (item.value === null || item.value === undefined) return "";
  return JSON.stringify(item.value, null, 2);
}
</script>

<template>
  <section class="repo-settings-api-section" :data-agent-id="`repo.settings.api.${section}`">
    <div class="repo-settings-api-section__head">
      <div>
        <h4>{{ title }}</h4>
        <span v-if="sectionState">{{ new Date(sectionState.fetchedAt).toLocaleTimeString() }}</span>
      </div>
      <button
        type="button"
        class="ghost project-icon-action"
        :disabled="loading"
        aria-label="刷新"
        title="刷新"
        @click="loadSection(true)"
      >
        <LoaderCircle v-if="loading" :size="14" class="sb-spin" aria-hidden="true" />
        <RotateCw v-else :size="14" aria-hidden="true" />
      </button>
    </div>

    <p v-if="error" class="repo-settings-api-section__error">
      <AlertCircle :size="14" aria-hidden="true" />
      <span>{{ error }}</span>
    </p>
    <p v-else-if="loading && !sectionState" class="muted repo-empty project-empty">加载中</p>

    <div v-if="sectionState" class="repo-settings-api-section__items">
      <article v-for="item in sectionState.items" :key="item.key" class="repo-settings-api-item">
        <div class="repo-settings-api-item__head">
          <strong>{{ item.label }}</strong>
          <span>{{ item.method }} /repos/{owner}/{repo}/{{ item.path }}</span>
        </div>
        <p v-if="item.error" class="repo-settings-api-item__error">{{ item.error }}</p>
        <pre v-else>{{ formatValue(item) }}</pre>
      </article>
    </div>
  </section>
</template>

<style scoped>
.repo-settings-api-section {
  display: grid;
  gap: 12px;
}

.repo-settings-api-section__head,
.repo-settings-api-item__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.repo-settings-api-section__head h4 {
  margin: 0;
}

.repo-settings-api-section__head span,
.repo-settings-api-item__head span {
  color: var(--text-muted);
  font-size: 12px;
}

.repo-settings-api-section__error,
.repo-settings-api-item__error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--err);
  font-size: 12px;
}

.repo-settings-api-section__items {
  display: grid;
  gap: 10px;
}

.repo-settings-api-item {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
}

.repo-settings-api-item pre {
  max-height: 220px;
  margin: 0;
  overflow: auto;
  white-space: pre-wrap;
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
}
</style>

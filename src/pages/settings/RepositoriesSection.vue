<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RotateCcw } from "@lucide/vue";
import { useWorkspace } from "../../composables/useWorkspace";
import type { HiddenRepo } from "../../services/workspace";

const workspace = useWorkspace();
const hiddenRepos = ref<HiddenRepo[]>([]);
const loading = ref(false);
const restoringRepoId = ref<string | null>(null);
const error = ref<string | null>(null);

async function loadHiddenRepos() {
  loading.value = true;
  error.value = null;
  try {
    hiddenRepos.value = await workspace.listHiddenRepos();
  } catch (err) {
    error.value = String(err);
  } finally {
    loading.value = false;
  }
}

async function restoreRepo(repoId: string) {
  restoringRepoId.value = repoId;
  error.value = null;
  try {
    await workspace.unhideRepo(repoId);
    await loadHiddenRepos();
  } catch (err) {
    error.value = String(err);
  } finally {
    restoringRepoId.value = null;
  }
}

onMounted(loadHiddenRepos);
</script>

<template>
  <div class="card">
    <h2>仓库</h2>
    <div class="repo-settings">
      <p v-if="loading" class="muted">正在读取隐藏仓库...</p>
      <p v-else-if="!hiddenRepos.length" class="muted">没有隐藏仓库。</p>
      <ul v-else class="hidden-repo-list">
        <li v-for="repo in hiddenRepos" :key="repo.id" class="hidden-repo-list__item">
          <div class="hidden-repo-list__meta">
            <span class="hidden-repo-list__name">{{ repo.name }}</span>
            <span class="hidden-repo-list__id">{{ repo.id }}</span>
          </div>
          <button
            type="button"
            class="ghost"
            :disabled="restoringRepoId === repo.id"
            @click="restoreRepo(repo.id)"
          >
            <RotateCcw :size="14" aria-hidden="true" />
            恢复管理
          </button>
        </li>
      </ul>
      <p v-if="error" class="repo-settings__error">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.repo-settings {
  min-height: 40px;
}

.repo-settings .muted {
  margin: 4px 0;
}

.hidden-repo-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.hidden-repo-list__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-soft);
}

.hidden-repo-list__item:first-child {
  padding-top: 4px;
}

.hidden-repo-list__item:last-child {
  border-bottom: 0;
  padding-bottom: 4px;
}

.hidden-repo-list__meta {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.hidden-repo-list__name {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hidden-repo-list__id {
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.hidden-repo-list__item .ghost {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.repo-settings__error {
  margin: 10px 0 0;
  color: var(--err);
  font-size: 12px;
}

@media (max-width: 700px) {
  .hidden-repo-list__item {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>

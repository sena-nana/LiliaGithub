<script setup lang="ts">
import { computed, ref } from "vue";
import { UiButton, UiCard } from "@lilia/ui";
import { useComponentEpoch } from "../../../composables/useComponentEpoch";
import { useWorkspace } from "../../../composables/useWorkspace";

const workspace = useWorkspace();
const componentEpoch = useComponentEpoch();
const resettingSystemGitRepoId = ref<string | null>(null);
const error = ref<string | null>(null);

const systemGitRepos = computed(() => {
  const reposById = new Map(workspace.state.repos.map((repo) => [repo.id, repo]));
  return (workspace.state.settings?.systemGitRepoIds ?? []).map((id) => {
    const repo = reposById.get(id);
    return {
      id,
      name: repo?.name ?? id,
      path: repo?.relativePath ?? repo?.path ?? id,
    };
  });
});

async function useDefaultTokenAuth(repoId: string) {
  if (resettingSystemGitRepoId.value) return;
  resettingSystemGitRepoId.value = repoId;
  error.value = null;
  try {
    await workspace.useDefaultTokenAuthForRepo(repoId);
    if (!componentEpoch.assertAlive()) return;
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    error.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) resettingSystemGitRepoId.value = null;
  }
}
</script>

<template>
  <UiCard
    v-if="systemGitRepos.length"
    class="system-git-card"
    title="系统 git 凭证"
    aria-label="系统 git 凭证"
    agent-id="settings.repositories.system-git"
  >
    <p class="system-git-card__hint">这些仓库 push 时会优先使用本机 Git 凭证。</p>
    <ul class="system-git-list">
      <li v-for="repo in systemGitRepos" :key="repo.id" class="system-git-list__item">
        <div class="system-git-list__meta">
          <span class="system-git-list__name">{{ repo.name }}</span>
          <span v-if="repo.path !== repo.name" class="system-git-list__id">{{ repo.path }}</span>
        </div>
        <UiButton
          size="sm"
          :agent-id="`settings.repositories.system-git.restore.${repo.id}`"
          :disabled="Boolean(resettingSystemGitRepoId)"
          :busy="resettingSystemGitRepoId === repo.id"
          @click="useDefaultTokenAuth(repo.id)"
        >
          {{ resettingSystemGitRepoId === repo.id ? "恢复中" : "恢复默认 token" }}
        </UiButton>
      </li>
    </ul>
    <p v-if="error" class="system-git-card__error" role="alert">{{ error }}</p>
  </UiCard>
</template>

<style scoped>
.system-git-card {
  display: grid;
  gap: 8px;
}

.system-git-card__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.system-git-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.system-git-list__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid var(--border-soft);
}

.system-git-list__meta {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.system-git-list__name {
  min-width: 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.system-git-list__id {
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.system-git-card__error {
  margin: 0;
  color: var(--err);
  font-size: 12px;
  overflow-wrap: anywhere;
}

@media (max-width: 700px) {
  .system-git-list__item {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>

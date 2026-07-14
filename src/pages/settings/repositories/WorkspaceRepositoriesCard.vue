<script setup lang="ts">
import { SettingsRow, UiButton, UiCard } from "@lilia/ui";
import { onMounted, onUnmounted, ref } from "vue";
import { useComponentEpoch } from "../../../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../../../composables/useLatestAsyncLoader";
import { useWorkspace } from "../../../composables/useWorkspace";
import type { HiddenRepo } from "../../../services/workspace";

const workspace = useWorkspace();
const hiddenRepos = ref<HiddenRepo[]>([]);
const loadingHiddenRepos = ref(false);
const restoringRepoId = ref<string | null>(null);
const addingRepo = ref(false);
const error = ref<string | null>(null);
const componentEpoch = useComponentEpoch();
const hiddenReposLoader = createLatestAsyncLoader({ componentEpoch });

function shouldShowRepoId(repo: HiddenRepo) {
  return repo.id !== repo.name;
}

async function loadHiddenRepos() {
  await hiddenReposLoader.run("hidden-repos", async (runId) => {
    loadingHiddenRepos.value = true;
    error.value = null;
    try {
      const repos = await workspace.listHiddenRepos();
      if (!hiddenReposLoader.isCurrent(runId)) return;
      hiddenRepos.value = repos;
    } catch (err) {
      if (!hiddenReposLoader.isCurrent(runId)) return;
      error.value = String(err);
    } finally {
      if (hiddenReposLoader.isCurrent(runId)) {
        loadingHiddenRepos.value = false;
      }
    }
  });
}

async function chooseWorkspaceRoot() {
  error.value = null;
  try {
    await workspace.chooseWorkspaceRoot();
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    error.value = String(err);
  }
}

async function addLocalRepo() {
  if (addingRepo.value) return;
  addingRepo.value = true;
  error.value = null;
  try {
    await workspace.addLocalRepo();
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    error.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) addingRepo.value = false;
  }
}

async function restoreRepo(repoId: string) {
  if (restoringRepoId.value) return;
  restoringRepoId.value = repoId;
  error.value = null;
  try {
    await workspace.unhideRepo(repoId);
    if (!componentEpoch.assertAlive()) return;
    await loadHiddenRepos();
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    error.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) restoringRepoId.value = null;
  }
}

onMounted(() => {
  void loadHiddenRepos();
});

onUnmounted(() => {
  hiddenReposLoader.invalidate();
});
</script>

<template>
  <UiCard
    title="工作区与仓库"
    aria-label="工作区与仓库"
    :loading="loadingHiddenRepos"
    agent-id="settings.repositories.workspace"
  >
    <SettingsRow
      class="workspace-card__row"
      label="工作区"
      hint="应用会扫描该文件夹下的 Git 仓库。"
      divided
      loose
    >
      <div class="workspace-card__control">
        <span class="workspace-card__path" :title="workspace.workspaceRoot.value ?? undefined">
          {{ workspace.workspaceRoot.value ?? "尚未选择工作区" }}
        </span>
        <UiButton
          size="sm"
          agent-id="settings.repositories.workspace-root.change"
          :busy="workspace.choosingWorkspaceRoot.value"
          @click="chooseWorkspaceRoot"
        >
          {{ workspace.choosingWorkspaceRoot.value ? "更换中" : "更换工作区" }}
        </UiButton>
      </div>
    </SettingsRow>

    <SettingsRow
      class="workspace-card__row"
      label="本地仓库"
      hint="添加已有的本地 Git 仓库。"
      divided
    >
      <UiButton
        size="sm"
        agent-id="settings.repositories.add-local"
        :busy="addingRepo"
        @click="addLocalRepo"
      >
        {{ addingRepo ? "添加中" : "添加本地仓库" }}
      </UiButton>
    </SettingsRow>

    <section
      v-if="hiddenRepos.length"
      class="workspace-card__hidden"
      aria-labelledby="workspace-hidden-repositories-title"
    >
      <h3 id="workspace-hidden-repositories-title">隐藏仓库</h3>
      <SettingsRow
        v-for="(repo, index) in hiddenRepos"
        :key="repo.id"
        class="workspace-card__hidden-row"
        :divided="index < hiddenRepos.length - 1"
      >
        <template #label>
          <span class="workspace-card__repo-name">{{ repo.name }}</span>
          <span v-if="shouldShowRepoId(repo)" class="workspace-card__repo-id">{{ repo.id }}</span>
        </template>
        <UiButton
          size="sm"
          :agent-id="`settings.repositories.hidden.restore.${repo.id}`"
          :disabled="restoringRepoId !== null"
          :busy="restoringRepoId === repo.id"
          @click="restoreRepo(repo.id)"
        >
          {{ restoringRepoId === repo.id ? "恢复中" : "恢复管理" }}
        </UiButton>
      </SettingsRow>
    </section>

    <p v-if="error" class="workspace-card__error" role="alert">{{ error }}</p>
  </UiCard>
</template>

<style scoped>
.workspace-card__control {
  min-width: 0;
  display: flex;
  flex: 1 1 420px;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.workspace-card__path {
  min-width: 0;
  color: var(--text);
  font-size: 12px;
  overflow-wrap: anywhere;
  text-align: right;
}

.workspace-card__hidden {
  display: grid;
  margin-top: 4px;
  padding-top: 10px;
}

.workspace-card__hidden h3 {
  margin: 0 0 4px;
  font-size: 13px;
}

.workspace-card__repo-name,
.workspace-card__repo-id {
  display: block;
  min-width: 0;
  overflow-wrap: anywhere;
}

.workspace-card__repo-name {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.workspace-card__repo-id {
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 400;
}

.workspace-card__error {
  margin: 6px 0 0;
  font-size: 12px;
}

.workspace-card__error {
  color: var(--err);
}

:deep(.workspace-card__row .settings-row__control),
:deep(.workspace-card__hidden-row .settings-row__control) {
  min-width: 0;
}

:deep(.workspace-card__row .settings-row__control) {
  flex: 1 1 420px;
}

:deep(.workspace-card__hidden-row .settings-row__label) {
  min-width: 0;
  white-space: normal;
}

@media (max-width: 900px) {
  :deep(.workspace-card__row .settings-row__control),
  :deep(.workspace-card__hidden-row .settings-row__control) {
    width: 100%;
  }

  .workspace-card__control {
    width: 100%;
    flex: 1 1 auto;
    align-items: flex-start;
    flex-direction: column;
  }

  .workspace-card__path {
    text-align: left;
  }
}
</style>

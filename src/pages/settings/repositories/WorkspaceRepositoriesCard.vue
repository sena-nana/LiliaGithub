<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useComponentEpoch } from "../../../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../../../composables/useLatestAsyncLoader";
import { useWorkspace } from "../../../composables/useWorkspace";
import type { HiddenRepo, WorkspaceRoot } from "../../../services/workspace";
import { Dropdown, SettingsRow, UiButton, UiCard, UiDialog } from "../../../ui";

const workspace = useWorkspace();
const router = useRouter();
const componentEpoch = useComponentEpoch();
const hiddenReposLoader = createLatestAsyncLoader({ componentEpoch });
const hiddenRepos = ref<HiddenRepo[]>([]);
const loadingHiddenRepos = ref(false);
const restoringRepoId = ref<string | null>(null);
const addingRepo = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

const createDialogOpen = ref(false);
const createName = ref("");
const createRootPath = ref("");
const renameDialogOpen = ref(false);
const renameName = ref("");
const deleteDialogOpen = ref(false);
const rootToRemove = ref<WorkspaceRoot | null>(null);

const activeWorkspace = computed(() => workspace.activeWorkspace.value);
const catalogOptions = computed(() => workspace.workspaceCatalog.value.map((item) => ({
  value: item.id,
  label: item.name,
  hint: `${item.roots.length} 个根目录`,
  agentId: `settings.repositories.workspace.option.${item.id}`,
})));
const selectedWorkspaceId = computed({
  get: () => activeWorkspace.value?.id ?? "",
  set: (workspaceId: string) => {
    if (workspaceId && workspaceId !== activeWorkspace.value?.id) void switchWorkspace(workspaceId);
  },
});

function cleanError(nextError: unknown) {
  return String(nextError).replace(/^Error:\s*/, "");
}

function workspaceNameFromPath(path: string) {
  const segments = path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? "默认工作区";
}

async function loadHiddenRepos() {
  if (!activeWorkspace.value) {
    hiddenRepos.value = [];
    return;
  }
  await hiddenReposLoader.run(`hidden-repos:${activeWorkspace.value.id}`, async (runId) => {
    loadingHiddenRepos.value = true;
    try {
      const repos = await workspace.listHiddenRepos();
      if (hiddenReposLoader.isCurrent(runId)) hiddenRepos.value = repos;
    } catch (nextError) {
      if (hiddenReposLoader.isCurrent(runId)) error.value = cleanError(nextError);
    } finally {
      if (hiddenReposLoader.isCurrent(runId)) loadingHiddenRepos.value = false;
    }
  });
}

async function switchWorkspace(workspaceId: string) {
  error.value = null;
  notice.value = null;
  try {
    await workspace.switchWorkspace(workspaceId);
    await router.push("/");
  } catch (nextError) {
    error.value = cleanError(nextError);
  }
}

async function prepareCreateWorkspace() {
  error.value = null;
  const rootPath = await workspace.pickWorkspaceRoot();
  if (!rootPath || !componentEpoch.assertAlive()) return;
  createRootPath.value = rootPath;
  createName.value = workspaceNameFromPath(rootPath);
  createDialogOpen.value = true;
}

async function createWorkspace() {
  const name = createName.value.trim();
  if (!name || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await workspace.createWorkspace(name, createRootPath.value);
    createDialogOpen.value = false;
    await router.push("/");
  } catch (nextError) {
    error.value = cleanError(nextError);
  } finally {
    busy.value = false;
  }
}

function prepareRenameWorkspace() {
  if (!activeWorkspace.value) return;
  renameName.value = activeWorkspace.value.name;
  renameDialogOpen.value = true;
}

async function renameWorkspace() {
  const current = activeWorkspace.value;
  const name = renameName.value.trim();
  if (!current || !name || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await workspace.renameWorkspace(current.id, name);
    renameDialogOpen.value = false;
    notice.value = "工作区已重命名。";
  } catch (nextError) {
    error.value = cleanError(nextError);
  } finally {
    busy.value = false;
  }
}

async function deleteWorkspace() {
  const current = activeWorkspace.value;
  if (!current || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await workspace.deleteWorkspace(current.id);
    deleteDialogOpen.value = false;
    await router.push("/");
  } catch (nextError) {
    error.value = cleanError(nextError);
  } finally {
    busy.value = false;
  }
}

async function addRoot() {
  const current = activeWorkspace.value;
  if (!current || busy.value) return;
  const rootPath = await workspace.pickWorkspaceRoot();
  if (!rootPath || !componentEpoch.assertAlive()) return;
  busy.value = true;
  error.value = null;
  try {
    await workspace.addWorkspaceRoot(current.id, rootPath);
    notice.value = "根目录已添加。";
  } catch (nextError) {
    error.value = cleanError(nextError);
  } finally {
    busy.value = false;
  }
}

async function setPrimaryRoot(rootId: string) {
  const current = activeWorkspace.value;
  if (!current || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await workspace.setPrimaryWorkspaceRoot(current.id, rootId);
    notice.value = "主根目录已更新。";
  } catch (nextError) {
    error.value = cleanError(nextError);
  } finally {
    busy.value = false;
  }
}

async function removeRoot() {
  const current = activeWorkspace.value;
  const root = rootToRemove.value;
  if (!current || !root || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await workspace.removeWorkspaceRoot(current.id, root.id);
    rootToRemove.value = null;
    await router.push("/");
  } catch (nextError) {
    error.value = cleanError(nextError);
  } finally {
    busy.value = false;
  }
}

async function addLocalRepo() {
  if (addingRepo.value) return;
  addingRepo.value = true;
  error.value = null;
  try {
    await workspace.addLocalRepo();
  } catch (nextError) {
    error.value = cleanError(nextError);
  } finally {
    addingRepo.value = false;
  }
}

async function restoreRepo(repoId: string) {
  if (restoringRepoId.value) return;
  restoringRepoId.value = repoId;
  error.value = null;
  try {
    await workspace.unhideRepo(repoId);
    await loadHiddenRepos();
  } catch (nextError) {
    error.value = cleanError(nextError);
  } finally {
    restoringRepoId.value = null;
  }
}

watch(() => activeWorkspace.value?.id, () => void loadHiddenRepos(), { immediate: true });

onUnmounted(() => hiddenReposLoader.invalidate());
</script>

<template>
  <UiCard
    title="工作区与仓库"
    aria-label="工作区与仓库"
    :loading="loadingHiddenRepos"
    agent-id="settings.repositories.workspace"
  >
    <SettingsRow label="当前工作区" hint="切换后会返回项目总览。" divided loose>
      <div class="workspace-card__actions">
        <Dropdown
          v-if="catalogOptions.length"
          v-model="selectedWorkspaceId"
          :options="catalogOptions"
          :disabled="workspace.switchingWorkspace.value || busy"
          placement="bottom"
          menu-label="选择工作区"
          menu-width="280px"
          agent-id="settings.repositories.workspace.switch"
        />
        <span v-else class="workspace-card__muted">尚未创建工作区</span>
        <UiButton size="sm" agent-id="settings.repositories.workspace.create" :disabled="busy" @click="prepareCreateWorkspace">新建</UiButton>
        <UiButton v-if="activeWorkspace" size="sm" agent-id="settings.repositories.workspace.rename" :disabled="busy" @click="prepareRenameWorkspace">重命名</UiButton>
        <UiButton v-if="activeWorkspace" size="sm" agent-id="settings.repositories.workspace.delete" :disabled="busy" @click="deleteDialogOpen = true">删除</UiButton>
      </div>
    </SettingsRow>

    <section v-if="activeWorkspace" class="workspace-card__roots" aria-label="工作区根目录">
      <div class="workspace-card__section-title">
        <h3>根目录</h3>
        <UiButton size="sm" agent-id="settings.repositories.root.add" :disabled="busy" @click="addRoot">添加根目录</UiButton>
      </div>
      <p v-if="!activeWorkspace.roots.length" class="workspace-card__muted">当前工作区没有根目录，可添加目录后继续使用。</p>
      <SettingsRow
        v-for="root in activeWorkspace.roots"
        :key="root.id"
        class="workspace-card__root-row"
        :divided="true"
      >
        <template #label>
          <span class="workspace-card__repo-name">
            {{ root.path }}
            <small v-if="root.id === activeWorkspace.primaryRootId">主 root</small>
            <small v-if="!root.available" class="is-warning">不可用</small>
          </span>
          <span v-if="root.unavailableReason" class="workspace-card__repo-id">{{ root.unavailableReason }}</span>
        </template>
        <div class="workspace-card__actions">
          <UiButton
            v-if="root.id !== activeWorkspace.primaryRootId"
            size="sm"
            :agent-id="`settings.repositories.root.${root.id}.primary`"
            :disabled="busy || !root.available"
            @click="setPrimaryRoot(root.id)"
          >设为主 root</UiButton>
          <UiButton
            size="sm"
            :agent-id="`settings.repositories.root.${root.id}.remove`"
            :disabled="busy"
            @click="rootToRemove = root"
          >移除</UiButton>
        </div>
      </SettingsRow>
    </section>

    <SettingsRow v-if="activeWorkspace" label="本地仓库" hint="添加位于任一工作区 root 内的 Git 仓库。" divided>
      <UiButton size="sm" agent-id="settings.repositories.add-local" :busy="addingRepo" :disabled="busy" @click="addLocalRepo">
        {{ addingRepo ? "添加中" : "添加本地仓库" }}
      </UiButton>
    </SettingsRow>

    <section v-if="hiddenRepos.length" class="workspace-card__hidden" aria-labelledby="workspace-hidden-repositories-title">
      <h3 id="workspace-hidden-repositories-title">隐藏仓库</h3>
      <SettingsRow v-for="repo in hiddenRepos" :key="repo.id" class="workspace-card__hidden-row" divided>
        <template #label>
          <span class="workspace-card__repo-name">{{ repo.name }}</span>
          <span v-if="repo.id !== repo.name" class="workspace-card__repo-id">{{ repo.id }}</span>
        </template>
        <UiButton size="sm" :agent-id="`settings.repositories.hidden.restore.${repo.id}`" :disabled="restoringRepoId !== null" :busy="restoringRepoId === repo.id" @click="restoreRepo(repo.id)">
          {{ restoringRepoId === repo.id ? "恢复中" : "恢复管理" }}
        </UiButton>
      </SettingsRow>
    </section>

    <p v-if="error" class="workspace-card__error" role="alert">{{ error }}</p>
    <p v-else-if="notice" class="workspace-card__notice" role="status">{{ notice }}</p>
  </UiCard>

  <UiDialog :open="createDialogOpen" title="新建工作区" :close-disabled="busy" @close="createDialogOpen = false">
    <form class="workspace-card__dialog" @submit.prevent="createWorkspace">
      <label>名称<input v-model="createName" maxlength="64" autofocus data-agent-id="settings.repositories.workspace.create.name" /></label>
      <label>首个根目录<input :value="createRootPath" readonly /></label>
      <div class="workspace-card__dialog-actions">
        <UiButton size="sm" :disabled="busy" @click="createDialogOpen = false">取消</UiButton>
        <UiButton variant="primary" size="sm" agent-id="settings.repositories.workspace.create.confirm" :busy="busy" :disabled="!createName.trim()" @click="createWorkspace">创建</UiButton>
      </div>
    </form>
  </UiDialog>

  <UiDialog :open="renameDialogOpen" title="重命名工作区" :close-disabled="busy" @close="renameDialogOpen = false">
    <form class="workspace-card__dialog" @submit.prevent="renameWorkspace">
      <label>名称<input v-model="renameName" maxlength="64" autofocus data-agent-id="settings.repositories.workspace.rename.name" /></label>
      <div class="workspace-card__dialog-actions">
        <UiButton size="sm" :disabled="busy" @click="renameDialogOpen = false">取消</UiButton>
        <UiButton variant="primary" size="sm" agent-id="settings.repositories.workspace.rename.confirm" :busy="busy" :disabled="!renameName.trim()" @click="renameWorkspace">保存</UiButton>
      </div>
    </form>
  </UiDialog>

  <UiDialog :open="deleteDialogOpen" title="删除工作区" :close-disabled="busy" @close="deleteDialogOpen = false">
    <div class="workspace-card__dialog">
      <p>删除“{{ activeWorkspace?.name }}”及其工作区偏好？本地目录和仓库不会被删除。</p>
      <div class="workspace-card__dialog-actions">
        <UiButton size="sm" :disabled="busy" @click="deleteDialogOpen = false">取消</UiButton>
        <UiButton size="sm" agent-id="settings.repositories.workspace.delete.confirm" :busy="busy" @click="deleteWorkspace">删除工作区</UiButton>
      </div>
    </div>
  </UiDialog>

  <UiDialog :open="Boolean(rootToRemove)" title="移除根目录" :close-disabled="busy" @close="rootToRemove = null">
    <div class="workspace-card__dialog">
      <p>从当前工作区移除“{{ rootToRemove?.path }}”？目录和仓库文件不会被删除。</p>
      <div class="workspace-card__dialog-actions">
        <UiButton size="sm" :disabled="busy" @click="rootToRemove = null">取消</UiButton>
        <UiButton size="sm" agent-id="settings.repositories.root.remove.confirm" :busy="busy" @click="removeRoot">移除</UiButton>
      </div>
    </div>
  </UiDialog>
</template>

<style scoped>
.workspace-card__actions,
.workspace-card__section-title,
.workspace-card__dialog-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.workspace-card__section-title {
  justify-content: space-between;
}

.workspace-card__section-title h3,
.workspace-card__hidden h3 {
  margin: 0;
  font-size: 13px;
}

.workspace-card__roots,
.workspace-card__hidden {
  display: grid;
  gap: 4px;
  padding: 10px 0 4px;
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

.workspace-card__repo-name small {
  margin-left: 6px;
  color: var(--accent);
  font-size: 11px;
  font-weight: 500;
}

.workspace-card__repo-name small.is-warning {
  color: var(--warn);
}

.workspace-card__repo-id,
.workspace-card__muted {
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 12px;
}

.workspace-card__error,
.workspace-card__notice {
  margin: 8px 0 0;
  font-size: 12px;
}

.workspace-card__error { color: var(--err); }
.workspace-card__notice { color: var(--ok); }

.workspace-card__dialog {
  display: grid;
  gap: 14px;
}

.workspace-card__dialog label {
  display: grid;
  gap: 6px;
  color: var(--text-muted);
  font-size: 13px;
}

.workspace-card__dialog p { margin: 0; }
.workspace-card__dialog-actions { justify-content: flex-end; }

@media (max-width: 760px) {
  .workspace-card__actions { width: 100%; justify-content: flex-start; }
}
</style>

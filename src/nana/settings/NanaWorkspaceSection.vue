<script setup lang="ts">
/**
 * Nana Settings · Workspace (repositories tab) — real workspace-bound panel.
 */
import { computed, ref, watch } from "vue";
import {
  NanaButton,
  NanaInput,
  NanaSettingsCard,
  NanaSettingsRow,
} from "@nanaui/nanavue-components";
import { useComponentEpoch } from "../../composables/useComponentEpoch";
import { useWorkspace } from "../../composables/useWorkspace";

const workspace = useWorkspace();
const componentEpoch = useComponentEpoch();
const busy = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const renameOpen = ref(false);
const renameName = ref("");
type IdentityDraft = { name: string; email: string };
const identityDraft = ref<IdentityDraft[]>([]);
const savingIdentities = ref(false);

const activeWorkspace = computed(() => workspace.activeWorkspace.value);
const catalog = computed(() => workspace.workspaceCatalog.value);
const roots = computed(() => activeWorkspace.value?.roots ?? []);
const repos = computed(() => (Array.isArray(workspace.state.repos) ? workspace.state.repos : []));
const identities = computed(
  () => workspace.state.settings?.contributionIdentities ?? [],
);
const systemGitCount = computed(
  () => workspace.state.settings?.systemGitRepoIds?.length ?? 0,
);
const cancellableTasks = computed(() =>
  (workspace.state.tasks ?? []).filter(
    (task) => task.status === "pending" && task.cancellable,
  ),
);

watch(
  identities,
  (next) => {
    identityDraft.value = (next ?? []).map((item) => ({
      name: item.name ?? "",
      email: item.email ?? "",
    }));
  },
  { immediate: true, deep: true },
);

function cleanError(next: unknown) {
  return next instanceof Error ? next.message : String(next);
}

async function switchWorkspace(workspaceId: string) {
  if (!workspaceId || workspaceId === activeWorkspace.value?.id || busy.value) return;
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    await workspace.switchWorkspace(workspaceId);
    if (componentEpoch.assertAlive()) notice.value = "已切换工作区。";
  } catch (err) {
    if (componentEpoch.assertAlive()) error.value = cleanError(err);
  } finally {
    if (componentEpoch.assertAlive()) busy.value = false;
  }
}

function prepareRename() {
  renameName.value = activeWorkspace.value?.name ?? "";
  renameOpen.value = true;
  error.value = null;
  notice.value = null;
}

async function renameWorkspace() {
  const id = activeWorkspace.value?.id;
  const name = renameName.value.trim();
  if (!id || !name || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await workspace.renameWorkspace(id, name);
    if (!componentEpoch.assertAlive()) return;
    renameOpen.value = false;
    notice.value = "工作区已重命名。";
  } catch (err) {
    if (componentEpoch.assertAlive()) error.value = cleanError(err);
  } finally {
    if (componentEpoch.assertAlive()) busy.value = false;
  }
}

async function refreshRepos() {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await workspace.refreshRepos();
    if (componentEpoch.assertAlive()) notice.value = "仓库列表已刷新。";
  } catch (err) {
    if (componentEpoch.assertAlive()) error.value = cleanError(err);
  } finally {
    if (componentEpoch.assertAlive()) busy.value = false;
  }
}

function addIdentity() {
  identityDraft.value.push({ name: "", email: "" });
}

function removeIdentity(index: number) {
  identityDraft.value.splice(index, 1);
}

async function saveIdentities() {
  if (savingIdentities.value) return;
  savingIdentities.value = true;
  error.value = null;
  notice.value = null;
  try {
    const next = identityDraft.value
      .map((item) => ({
        name: item.name.trim(),
        email: item.email.trim(),
      }))
      .filter((item) => item.name || item.email);
    await workspace.setContributionIdentities(next);
    if (componentEpoch.assertAlive()) notice.value = "贡献身份已保存。";
  } catch (err) {
    if (componentEpoch.assertAlive()) error.value = cleanError(err);
  } finally {
    if (componentEpoch.assertAlive()) savingIdentities.value = false;
  }
}

async function cancelTask(taskId: string) {
  error.value = null;
  try {
    await workspace.cancelWorkspaceTask(taskId);
    if (componentEpoch.assertAlive()) notice.value = "已取消任务。";
  } catch (err) {
    if (componentEpoch.assertAlive()) error.value = cleanError(err);
  }
}
</script>

<template>
  <div data-agent-id="settings.repositories.page" class="nana-workspace-section">
    <NanaSettingsCard title="工作区" agent-id="settings.repositories.workspace">
      <NanaSettingsRow
        label="当前工作区"
        :hint="activeWorkspace ? `${activeWorkspace.id} · ${roots.length} 个根目录` : '尚未创建工作区'"
        divided
        first-in-group
        agent-id="settings.repositories.workspace.current"
      >
        <strong>{{ activeWorkspace?.name ?? "—" }}</strong>
      </NanaSettingsRow>

      <NanaSettingsRow
        v-if="catalog.length > 1"
        label="切换工作区"
        hint="在已保存的工作区目录间切换。"
        divided
        agent-id="settings.repositories.workspace.switch.row"
      >
        <div class="nana-workspace-section__actions">
          <NanaButton
            v-for="item in catalog"
            :key="item.id"
            size="small"
            :kind="item.id === activeWorkspace?.id ? 'primary' : 'ghost'"
            :disabled="busy || item.id === activeWorkspace?.id"
            :data-agent-id="`settings.repositories.workspace.option.${item.id}`"
            @press="switchWorkspace(item.id)"
          >
            {{ item.name }}
          </NanaButton>
        </div>
      </NanaSettingsRow>

      <NanaSettingsRow
        label="操作"
        hint="重命名当前工作区。"
        :last-in-group="!renameOpen"
        agent-id="settings.repositories.workspace.actions"
      >
        <NanaButton
          size="small"
          :disabled="busy || !activeWorkspace"
          data-agent-id="settings.repositories.workspace.rename"
          @press="prepareRename"
        >
          重命名
        </NanaButton>
      </NanaSettingsRow>

      <NanaSettingsRow
        v-if="renameOpen"
        label="新名称"
        last-in-group
        agent-id="settings.repositories.workspace.rename.editor"
      >
        <NanaInput
          v-model="renameName"
          placeholder="工作区名称"
          data-agent-id="settings.repositories.workspace.rename.name"
        />
        <NanaButton
          kind="primary"
          size="small"
          :loading="busy"
          :disabled="!renameName.trim()"
          data-agent-id="settings.repositories.workspace.rename.confirm"
          @press="renameWorkspace"
        >
          保存
        </NanaButton>
        <NanaButton
          size="small"
          :disabled="busy"
          data-agent-id="settings.repositories.workspace.rename.cancel"
          @press="renameOpen = false"
        >
          取消
        </NanaButton>
      </NanaSettingsRow>
    </NanaSettingsCard>

    <NanaSettingsCard title="根目录" agent-id="settings.repositories.roots">
      <NanaSettingsRow
        v-if="!roots.length"
        label="无根目录"
        hint="完成工作区创建后会显示根路径。"
        first-in-group
        last-in-group
        agent-id="settings.repositories.roots.empty"
      />
      <NanaSettingsRow
        v-for="(root, index) in roots"
        :key="root.id"
        :label="root.path"
        :hint="root.available ? '可用' : root.unavailableReason || '不可用'"
        :divided="index < roots.length - 1"
        :first-in-group="index === 0"
        :last-in-group="index === roots.length - 1"
        :agent-id="`settings.repositories.root.${root.id}`"
      >
        <span v-if="activeWorkspace?.primaryRootId === root.id">主根</span>
      </NanaSettingsRow>
    </NanaSettingsCard>

    <NanaSettingsCard title="本地仓库" agent-id="settings.repositories.local">
      <NanaSettingsRow
        label="仓库列表"
        :hint="repos.length ? `共 ${repos.length} 个` : '暂无本地仓库'"
        divided
        first-in-group
        agent-id="settings.repositories.local.summary"
      >
        <NanaButton
          size="small"
          :loading="busy"
          data-agent-id="settings.repositories.local.refresh"
          @press="refreshRepos"
        >
          刷新
        </NanaButton>
      </NanaSettingsRow>
      <NanaSettingsRow
        v-for="(repo, index) in repos"
        :key="repo.id"
        :label="repo.name"
        :hint="repo.path || repo.fullName || repo.id"
        :divided="index < repos.length - 1"
        :last-in-group="index === repos.length - 1"
        :agent-id="`settings.repositories.local.${repo.id}`"
      >
        <span v-if="repo.isFavorite">收藏</span>
      </NanaSettingsRow>
      <NanaSettingsRow
        v-if="!repos.length"
        label="空"
        hint="绑定 GitHub 并扫描后会显示仓库。"
        last-in-group
        agent-id="settings.repositories.local.empty"
      />
    </NanaSettingsCard>

    <NanaSettingsCard
      title="贡献身份"
      agent-id="settings.repositories.contribution-identities"
    >
      <NanaSettingsRow
        label="身份列表"
        hint="用于本地提交与贡献统计匹配。"
        divided
        first-in-group
        agent-id="settings.repositories.contribution-identities.title"
      >
        <NanaButton
          size="small"
          data-agent-id="settings.repositories.contribution-identities.add"
          @press="addIdentity"
        >
          添加
        </NanaButton>
        <NanaButton
          kind="primary"
          size="small"
          :loading="savingIdentities"
          data-agent-id="settings.repositories.contribution-identities.save"
          @press="saveIdentities"
        >
          保存
        </NanaButton>
      </NanaSettingsRow>
      <NanaSettingsRow
        v-for="(identity, index) in identityDraft"
        :key="`identity-${index}`"
        :label="`身份 ${index + 1}`"
        :divided="index < identityDraft.length - 1"
        :last-in-group="index === identityDraft.length - 1 && identityDraft.length > 0"
        :agent-id="`settings.repositories.contribution-identities.${index}`"
      >
        <NanaInput
          v-model="identity.name"
          placeholder="Name"
          :data-agent-id="`settings.repositories.contribution-identities.${index}.name`"
        />
        <NanaInput
          v-model="identity.email"
          placeholder="Email"
          :data-agent-id="`settings.repositories.contribution-identities.${index}.email`"
        />
        <NanaButton
          size="small"
          :data-agent-id="`settings.repositories.contribution-identities.${index}.remove`"
          @press="removeIdentity(index)"
        >
          移除
        </NanaButton>
      </NanaSettingsRow>
      <NanaSettingsRow
        v-if="!identityDraft.length"
        label="未配置"
        hint="可添加 Name / Email 用于贡献匹配。"
        last-in-group
        agent-id="settings.repositories.contribution-identities.empty"
      />
    </NanaSettingsCard>

    <NanaSettingsCard
      v-if="systemGitCount > 0"
      title="系统 git 凭证"
      agent-id="settings.repositories.system-git"
    >
      <NanaSettingsRow
        label="使用本机凭证的仓库"
        :hint="`共 ${systemGitCount} 个`"
        first-in-group
        last-in-group
        agent-id="settings.repositories.system-git.summary"
      />
    </NanaSettingsCard>

    <NanaSettingsCard
      v-if="cancellableTasks.length"
      title="后台任务"
      agent-id="settings.repositories.tasks"
    >
      <NanaSettingsRow
        v-for="(task, index) in cancellableTasks"
        :key="task.id"
        :label="task.message || task.id"
        :hint="task.status"
        :divided="index < cancellableTasks.length - 1"
        :first-in-group="index === 0"
        :last-in-group="index === cancellableTasks.length - 1"
        :agent-id="`settings.repositories.task.${task.id}`"
      >
        <NanaButton
          size="small"
          :data-agent-id="`settings.repositories.task.cancel.${task.id}`"
          @press="cancelTask(task.id)"
        >
          取消
        </NanaButton>
      </NanaSettingsRow>
    </NanaSettingsCard>

    <p v-if="notice" class="nana-workspace-section__notice" role="status">{{ notice }}</p>
    <p v-if="error" class="nana-workspace-section__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.nana-workspace-section {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.nana-workspace-section__actions {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.nana-workspace-section__notice,
.nana-workspace-section__error {
  margin: 0;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.nana-workspace-section__notice {
  color: var(--accent, #4991d7);
}

.nana-workspace-section__error {
  color: var(--err, #c44);
}
</style>

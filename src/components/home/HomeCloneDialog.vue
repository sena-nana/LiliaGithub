<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { FolderInput, LoaderCircle, Lock, Search, Sparkles, X } from "@lucide/vue";
import { Dropdown } from "@lilia/ui";
import type {
  GitHubBindingStatus,
  GitHubRepoOwner,
  GitHubRepoSummary,
  GitHubRepositoryScope,
} from "../../services/workspace";
import GitHubRepositoryScopeControl from "../github/GitHubRepositoryScopeControl.vue";
import GitHubRepositoryStateNotice from "../github/GitHubRepositoryStateNotice.vue";
import { githubRepositoryPermissionLabel } from "../../utils/githubRepositoryScope";
import { githubRepositoryIdentityKey } from "../../utils/remoteRepo";

type RepoCloneGroup = {
  readonly id: string;
  readonly name: string;
  readonly repoIds: readonly string[];
};

const UNGROUPED_REPO_GROUP_VALUE = "__ungrouped__";

const props = defineProps<{
  busy: boolean;
  canSubmit: boolean;
  error: string | null;
  bindingExpired: boolean;
  gitHubBound: boolean;
  bindingStatus: GitHubBindingStatus | null;
  remoteUrl: string;
  directoryName: string;
  repoDropdownOpen: boolean;
  filteredRepos: readonly GitHubRepoSummary[];
  repoLoading: boolean;
  repoLoadingMore: boolean;
  repoLoadError: string | null;
  nextRepoPage: number | null;
  selectedRepo: GitHubRepoSummary | null;
  directRepo: string | null;
  repositoryScope: GitHubRepositoryScope;
  personalLogin: string;
  organizations: readonly GitHubRepoOwner[];
  ownersLoading: boolean;
  ownersError: string | null;
  organizationAccessLimited: boolean;
  organizationAccessMessage: string;
  organizationRecoveryUrl: string | null;
  localRepoFullNames: readonly string[];
  repoLoaded: boolean;
  repoGroups: readonly RepoCloneGroup[];
  selectedGroupId: string | null;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
  openSettings: [];
  openOrganizationAuthorization: [];
  loadMore: [];
  openRepoDropdown: [];
  handleRepoInput: [];
  selectRepo: [repo: GitHubRepoSummary];
  updateRemoteUrl: [value: string];
  updateDirectoryName: [value: string];
  updateSelectedGroup: [groupId: string | null];
  markDirectoryTouched: [];
  clearSelectedRepo: [];
  updateRepositoryScope: [scope: GitHubRepositoryScope];
  retryOwners: [];
  retryRepos: [];
}>();

const cloneInput = ref<HTMLInputElement | null>(null);
const repoGroupOptions = computed(() => [
  {
    value: UNGROUPED_REPO_GROUP_VALUE,
    label: "未分组仓库",
    hint: "默认",
    agentId: "clone-repo.group.option.ungrouped",
  },
  ...props.repoGroups.map((group) => ({
    value: group.id,
    label: group.name,
    hint: `${group.repoIds.length} 个仓库`,
    agentId: `clone-repo.group.option.${group.id}`,
  })),
]);
const selectedGroupValue = computed({
  get: () => props.selectedGroupId ?? UNGROUPED_REPO_GROUP_VALUE,
  set: (value: string) => {
    emit("updateSelectedGroup", value === UNGROUPED_REPO_GROUP_VALUE ? null : value);
  },
});
const localRepoIdentityKeys = computed(() => new Set(props.localRepoFullNames.map(githubRepositoryIdentityKey)));

function repoIsLocal(repo: GitHubRepoSummary) {
  return localRepoIdentityKeys.value.has(githubRepositoryIdentityKey(repo.fullName));
}

function focusCloneInput() {
  void nextTick(() => cloneInput.value?.focus());
}

function updateRemoteUrl(event: Event) {
  emit("updateRemoteUrl", (event.target as HTMLInputElement).value);
}

function updateDirectoryName(event: Event) {
  emit("updateDirectoryName", (event.target as HTMLInputElement).value);
  emit("markDirectoryTouched");
}

function handleRepoInput(event: Event) {
  updateRemoteUrl(event);
  emit("handleRepoInput");
}

onMounted(focusCloneInput);

watch(() => props.gitHubBound, focusCloneInput);
</script>

<template>
  <div class="modal-backdrop modal-backdrop--top" role="presentation">
    <form class="clone-dialog" role="dialog" aria-modal="true" aria-label="克隆仓库" @submit.prevent="emit('submit')">
      <div class="clone-dialog__header">
        <h2>克隆仓库</h2>
        <button type="button" class="repo-icon-btn" aria-label="关闭" title="关闭" :disabled="busy" @click="emit('close')">
          <X :size="14" aria-hidden="true" />
        </button>
      </div>
      <label v-if="!gitHubBound">
        <span>远端 URL</span>
        <input
          ref="cloneInput"
          :value="remoteUrl"
          type="text"
          placeholder="https://github.com/user/repo.git"
          autofocus
          @input="updateRemoteUrl"
        />
      </label>
      <div v-else class="clone-field">
        <span>GitHub 仓库</span>
        <GitHubRepositoryScopeControl
          :model-value="repositoryScope"
          :personal-login="personalLogin"
          :organizations="organizations"
          :loading="ownersLoading"
          :disabled="busy"
          compact
          @update:model-value="emit('updateRepositoryScope', $event)"
        />
        <GitHubRepositoryStateNotice
          v-if="ownersError"
          state="error"
          compact
          retryable
          :message="ownersError"
          @retry="emit('retryOwners')"
        />
        <GitHubRepositoryStateNotice
          v-if="organizationAccessLimited"
          state="limited"
          compact
          :message="organizationAccessMessage"
          :action-label="organizationRecoveryUrl ? '在 GitHub 授权' : '补充组织权限'"
          @authorize="emit('openOrganizationAuthorization')"
        />
        <div class="clone-repo-picker">
          <Search :size="13" aria-hidden="true" />
          <input
            ref="cloneInput"
            :value="remoteUrl"
            type="text"
            placeholder="搜索仓库，或直接输入 owner/repo"
            autocomplete="off"
            spellcheck="false"
            autofocus
            @focus="emit('openRepoDropdown')"
            @input="handleRepoInput"
            @keydown.down.prevent="emit('openRepoDropdown')"
          />
          <div v-if="repoDropdownOpen" class="clone-repo-menu" role="listbox">
            <button
              v-for="repo in filteredRepos"
              :key="repo.id"
              type="button"
              class="clone-repo-item"
              :class="{ 'is-active': selectedRepo?.id === repo.id }"
              role="option"
              :aria-selected="selectedRepo?.id === repo.id"
              @click="emit('selectRepo', repo)"
            >
              <span class="clone-repo-item__name">{{ repo.fullName }}</span>
              <span class="clone-repo-item__meta">
                <Lock v-if="repo.private" :size="11" aria-hidden="true" />
                {{ repo.private ? "私有" : "公开" }}
                <span v-if="repo.archived">· 已归档</span>
                <span v-if="repoIsLocal(repo)">· 已在本地</span>
                <span v-if="githubRepositoryPermissionLabel(repo.permissions)">
                  · {{ githubRepositoryPermissionLabel(repo.permissions) }}
                </span>
              </span>
            </button>
            <button
              v-if="nextRepoPage && !remoteUrl.trim()"
              type="button"
              class="clone-repo-more"
              :disabled="repoLoadingMore"
              @click="emit('loadMore')"
            >
              <LoaderCircle v-if="repoLoadingMore" :size="12" aria-hidden="true" class="sb-spin" />
              加载更多
            </button>
            <button
              v-else-if="directRepo"
              type="button"
              class="clone-repo-item"
              role="option"
              :aria-selected="selectedRepo == null"
              @click="emit('clearSelectedRepo')"
            >
              <span class="clone-repo-item__name">直接克隆 {{ directRepo }}</span>
              <span class="clone-repo-item__meta">
                <Sparkles :size="11" aria-hidden="true" />
                手动输入
              </span>
            </button>
            <GitHubRepositoryStateNotice
              v-else-if="repoLoadError"
              state="error"
              compact
              retryable
              :message="repoLoadError"
              @retry="emit('retryRepos')"
            />
            <p v-else-if="repoLoading" class="clone-repo-empty">正在加载仓库...</p>
            <p
              v-else-if="repoLoaded && !filteredRepos.length && !directRepo && !nextRepoPage"
              class="clone-repo-empty"
            >
              没有匹配仓库
            </p>
          </div>
        </div>
        <p v-if="bindingStatus?.binding" class="clone-dialog__hint">
          当前绑定账号：<code>{{ bindingStatus.binding.login }}</code>
        </p>
      </div>
      <label>
        <span>目录名（可选）</span>
        <input :value="directoryName" type="text" placeholder="默认从 URL 推导" @input="updateDirectoryName" />
      </label>
      <div class="clone-field">
        <span>目标分组</span>
        <Dropdown
          v-model="selectedGroupValue"
          :options="repoGroupOptions"
          :icon="FolderInput"
          placement="bottom"
          button-class="clone-group-picker"
          agent-id="clone-repo.group.trigger"
          menu-label="选择仓库分组"
          menu-width="240px"
          :disabled="busy"
        />
      </div>
      <div v-if="error" class="clone-dialog__error-row">
        <p class="clone-dialog__error">{{ error }}</p>
        <button
          v-if="bindingExpired"
          type="button"
          class="ghost"
          :disabled="busy"
          @click="emit('openSettings')"
        >
          重新绑定 GitHub
        </button>
      </div>
      <div class="clone-dialog__actions">
        <button type="button" class="ghost" :disabled="busy" @click="emit('close')">取消</button>
        <button type="submit" class="primary" :disabled="!canSubmit">
          <LoaderCircle v-if="busy" :size="14" aria-hidden="true" class="sb-spin" />
          克隆
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.clone-dialog {
  width: min(460px, calc(100vw - 32px));
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-elev);
  box-shadow: var(--shadow-lg);
}

.clone-dialog__header,
.clone-dialog__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.clone-dialog h2 {
  margin: 0;
  font-size: 16px;
}

.clone-dialog label {
  display: grid;
  gap: 6px;
  color: var(--text-muted);
  font-size: 13px;
}

.clone-field {
  display: grid;
  gap: 6px;
  color: var(--text-muted);
  font-size: 13px;
}

.clone-dialog input {
  min-width: 0;
}

.clone-repo-picker {
  position: relative;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
}

.clone-repo-picker input {
  padding: 10px 0;
  border: 0;
  background: transparent;
}

.clone-repo-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 12;
  display: grid;
  gap: 2px;
  max-height: 280px;
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
  box-shadow: var(--shadow-lg);
}

.clone-repo-item,
.clone-repo-more {
  width: 100%;
  min-width: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  text-align: left;
}

.clone-repo-item {
  display: grid;
  gap: 2px;
  padding: 8px 10px;
  cursor: pointer;
}

.clone-repo-item:hover,
.clone-repo-item.is-active,
.clone-repo-more:hover {
  background: var(--bg-hover);
}

.clone-repo-item__name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clone-repo-item__meta {
  display: flex;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.clone-repo-empty {
  margin: 0;
  padding: 10px;
  color: var(--text-muted);
  font-size: 12px;
}

.clone-repo-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  cursor: pointer;
}

:deep(.clone-group-picker) {
  width: 100%;
  height: 34px;
  justify-content: flex-start;
  padding: 0 9px;
  border-color: var(--border-soft);
}

:deep(.clone-group-picker .chat-chip__label) {
  max-width: none;
}

.clone-dialog__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.clone-dialog__error {
  margin: 0;
  color: var(--err);
}

.clone-dialog__error-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.clone-dialog__error-row .ghost {
  flex: 0 0 auto;
}

.clone-dialog__actions {
  justify-content: flex-end;
}
</style>

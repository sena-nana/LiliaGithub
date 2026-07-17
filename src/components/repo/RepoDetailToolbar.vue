<script setup lang="ts">
import {
  Archive,
  CloudDownload,
  CloudUpload,
  Code2,
  FolderOpen,
  GitCompare,
  History,
  LoaderCircle,
  Monitor,
  Play,
  RotateCw,
  RotateCcw,
  ScrollText,
  Square,
  SquareTerminal,
  TriangleAlert,
} from "@lucide/vue";
import { Dropdown } from "../../ui";
import { computed, ref, watch } from "vue";
import RepoBranchPicker from "./RepoBranchPicker.vue";
import type { RepoSettingKey } from "../../config/repoSettingsManifest";
import { createCachedAsyncComponent } from "../../utils/asyncComponent";
import type { RepoContext } from "../../utils/repoContext";
import { repoRoute, type RepoRouteTab } from "../../utils/repoRoutes";

type RepoToolbarTab = Extract<RepoRouteTab, "files" | "repo" | "changes" | "history" | "stash">;
type DropdownOption<T extends string = string> = {
  value: T;
  label: string;
  command?: string;
  hint?: string;
  disabled?: boolean;
};
type RepoBranchPickerItem = {
  name: string;
  canonicalName: string;
  displayName: string;
  sourceLabel: string;
  defaultBranch?: boolean;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  protected: boolean;
  tipTimestamp: number | null;
  checkedOutWorktreePaths: string[];
  section: "current" | "local" | "remote";
  relativeTime: string;
  checkedOutInWorktree: boolean;
  worktreePathsLabel: string;
  searchText: string;
};

const repoToolbarSettingsMenuModule = createCachedAsyncComponent(() => import("./RepoToolbarSettingsMenu.vue"));
const RepoToolbarSettingsMenu = repoToolbarSettingsMenuModule.component;

const props = defineProps<{
  activeTab: RepoRouteTab;
  repoId: string;
  repoTitle: string;
  repoContext: RepoContext;
  changesCount: number;
  toolbarTabs: readonly { key: RepoToolbarTab; title: string }[];
  branchItems: readonly RepoBranchPickerItem[];
  branchActionRunning: boolean;
  activeBranchName: string;
  actionRunning: boolean;
  launchRunning: boolean;
  launchCommandOptions: readonly DropdownOption[];
  activeLaunchValue: string;
  repoSettingValues: Record<RepoSettingKey, boolean>;
  activeOpenTargetValue: string;
  activePullStrategyValue: string;
  openTargetOptions: readonly DropdownOption[];
  pullStrategyOptions: readonly DropdownOption[];
  openTargetLabel: string;
  summaryPath?: string | null;
  hasConflicts: boolean;
  needsPublish: boolean;
  aheadCount: number;
  behindCount: number;
  remotesNeedingPull: number;
  remotesNeedingPush: number;
  pullRemoteCount: number;
  pushRemoteNames: readonly string[];
  remoteSyncUnavailableReason: string | null;
  launchCommand?: string | null;
  refreshingCurrentPage: boolean;
  currentPageRefreshAvailable: boolean;
}>();

const emit = defineEmits<{
  checkout: [branch: string];
  updateCurrentBranch: [];
  createBranch: [payload: { name: string; fromRef: string; checkoutAfter: boolean }];
  renameBranch: [payload: { oldName: string; newName: string }];
  mergeBranch: [branch: string];
  deleteBranch: [branch: string];
  refreshBranches: [];
  requestBranches: [];
  pushWithUpstream: [];
  setUpstream: [];
  selectLaunchCandidate: [value: string];
  runLaunchCommand: [command: string];
  stopLaunch: [];
  refreshCurrentPage: [];
  updateSetting: [key: RepoSettingKey, value: boolean];
  useDefaultTokenAuth: [];
  openSelectedTarget: [];
  selectOpenTarget: [value: string];
  runSelectedPullStrategy: [];
  selectPullStrategy: [value: string];
  push: [];
  openRemoteSyncSettings: [];
  openConflicts: [];
}>();

const launchPickerRef = ref<HTMLElement | null>(null);
const launchCommandDraft = ref("");
const launchPickerOpen = ref(false);

const launchCommandDisabled = computed(() => props.actionRunning || props.launchRunning);
const usesMultiplePullRemotes = computed(() => props.pullRemoteCount > 1);
const pushTargetLabel = computed(() => {
  if (props.remoteSyncUnavailableReason) return props.remoteSyncUnavailableReason;
  if (!props.pushRemoteNames.length) return "未配置推送目标";
  return `推送至 ${props.pushRemoteNames.join("、")}`;
});
const launchCommandRunnable = computed(() => launchCommandDraft.value.trim().length > 0);
const filteredLaunchCommandOptions = computed(() => {
  const query = launchCommandDraft.value.trim().toLowerCase();
  if (!query) return props.launchCommandOptions;
  return props.launchCommandOptions.filter((option) =>
    [option.command, option.label, option.hint]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
});

watch(
  () => [props.repoId, props.launchCommand] as const,
  () => {
    launchCommandDraft.value = props.launchCommand?.trim() ?? "";
    launchPickerOpen.value = false;
  },
  { immediate: true },
);

function openLaunchPicker() {
  if (launchCommandDisabled.value) return;
  launchPickerOpen.value = true;
}

function closeLaunchPicker() {
  launchPickerOpen.value = false;
}

function launchCandidateAgentId(value: string) {
  return `repo.toolbar.launch.candidate.${encodeURIComponent(value)}`;
}

function selectLaunchCommandOption(option: DropdownOption) {
  if (launchCommandDisabled.value || option.disabled) return;
  launchCommandDraft.value = option.command?.trim() || option.label;
  closeLaunchPicker();
  emit("selectLaunchCandidate", option.value);
}

function runLaunchCommandDraft() {
  if (props.launchRunning) {
    emit("stopLaunch");
    return;
  }
  if (props.actionRunning) return;
  const command = launchCommandDraft.value.trim();
  if (!command) return;
  closeLaunchPicker();
  emit("runLaunchCommand", command);
}

function handleLaunchCommandKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    runLaunchCommandDraft();
  } else if (event.key === "Escape") {
    closeLaunchPicker();
  } else if (event.key === "ArrowDown") {
    openLaunchPicker();
  }
}

function handleLaunchPickerFocusout(event: FocusEvent) {
  const nextTarget = event.relatedTarget;
  if (nextTarget instanceof Node && launchPickerRef.value?.contains(nextTarget)) return;
  closeLaunchPicker();
}
</script>

<template>
  <header class="repo-header">
    <div class="repo-header__tabs-wrap">
      <h1 class="repo-header__sr-title">{{ repoTitle }}</h1>
      <div class="repo-toolbar" aria-label="仓库页面工具条">
        <nav class="repo-toolbar__group repo-toolbar__views" role="tablist" aria-label="仓库页面">
          <RouterLink
            v-for="tab in toolbarTabs"
            :key="tab.key"
            class="repo-toolbar__btn"
            :class="{
              'is-active': activeTab === tab.key,
              'repo-toolbar__btn--counted': tab.key === 'changes' && changesCount,
            }"
            role="tab"
            :data-agent-id="`repo.toolbar.tab.${tab.key}`"
            :aria-selected="activeTab === tab.key"
            :to="repoRoute(repoId, tab.key)"
            :title="tab.title"
            :aria-label="tab.title"
          >
            <Monitor v-if="tab.key === 'repo'" :size="17" aria-hidden="true" />
            <FolderOpen v-else-if="tab.key === 'files'" :size="17" aria-hidden="true" />
            <GitCompare v-else-if="tab.key === 'changes'" :size="17" aria-hidden="true" />
            <History v-else-if="tab.key === 'history'" :size="17" aria-hidden="true" />
            <Archive v-else :size="17" aria-hidden="true" />
            <span v-if="tab.key === 'changes' && changesCount" class="repo-toolbar__badge repo-toolbar__badge--warn">
              {{ changesCount }}
            </span>
          </RouterLink>
          <RepoBranchPicker
            v-if="branchItems.length || repoContext.capabilities.branchBrowse.provider === 'github'"
            :display-label="activeBranchName"
            :branches="branchItems"
            button-class="repo-toolbar__btn repo-toolbar__branch-select"
            agent-id="repo.toolbar.branch.select"
            :disabled="branchActionRunning"
            :action-running="branchActionRunning"
            :allow-remote-checkout="true"
            :allow-remote-create="repoContext.capabilities.branch.available"
            :allow-remote-delete="repoContext.capabilities.deleteRemote.available"
            :show-repository-actions="repoContext.capabilities.branch.available"
            @checkout="emit('checkout', $event)"
            @update-current="emit('updateCurrentBranch')"
            @create-branch="emit('createBranch', $event)"
            @rename-branch="emit('renameBranch', $event)"
            @merge-branch="emit('mergeBranch', $event)"
            @delete-branch="emit('deleteBranch', $event)"
            @refresh-branches="emit('refreshBranches')"
            @opened="emit('requestBranches')"
            @push-with-upstream="emit('pushWithUpstream')"
            @set-upstream="emit('setUpstream')"
          />
        </nav>

        <div v-if="repoContext.capabilities.launch.available" class="repo-toolbar__group repo-toolbar__launch" role="group" aria-label="命令执行">
          <div
            ref="launchPickerRef"
            class="repo-toolbar__command-picker"
            :class="{ 'is-open': launchPickerOpen, 'is-disabled': launchCommandDisabled }"
            @focusout="handleLaunchPickerFocusout"
          >
            <SquareTerminal :size="15" aria-hidden="true" />
            <input
              v-model="launchCommandDraft"
              class="repo-toolbar__command-input"
              role="combobox"
              aria-label="启动命令"
              aria-controls="repo-toolbar-launch-options"
              :aria-expanded="launchPickerOpen"
              aria-autocomplete="list"
              placeholder="输入或选择启动指令"
              autocomplete="off"
              spellcheck="false"
              data-agent-id="repo.toolbar.launch.input"
              :disabled="launchCommandDisabled"
              @focus="openLaunchPicker"
              @input="openLaunchPicker"
              @keydown="handleLaunchCommandKeydown"
            />
            <div
              v-if="launchPickerOpen"
              id="repo-toolbar-launch-options"
              class="repo-toolbar__command-menu"
              role="listbox"
              aria-label="启动指令候选"
            >
              <button
                v-for="option in filteredLaunchCommandOptions"
                :key="option.value"
                type="button"
                class="repo-toolbar__command-option"
                :class="{ 'is-active': option.value === activeLaunchValue }"
                role="option"
                :aria-selected="option.value === activeLaunchValue"
                :disabled="option.disabled"
                :data-agent-id="launchCandidateAgentId(option.value)"
                @click="selectLaunchCommandOption(option)"
              >
                <span class="repo-toolbar__command-option-label">{{ option.label }}</span>
                <span v-if="option.hint" class="repo-toolbar__command-option-hint">{{ option.hint }}</span>
              </button>
              <p v-if="!filteredLaunchCommandOptions.length" class="repo-toolbar__command-empty">无匹配命令</p>
            </div>
          </div>
          <button
            type="button"
            class="repo-toolbar__btn"
            :aria-label="launchRunning ? '停止' : '运行'"
            data-agent-id="repo.toolbar.launch.toggle"
            :title="launchRunning ? '停止' : '运行'"
            :disabled="!launchRunning && (actionRunning || !launchCommandRunnable)"
            @click="runLaunchCommandDraft"
          >
            <Square v-if="launchRunning" :size="17" aria-hidden="true" />
            <Play v-else :size="17" aria-hidden="true" />
          </button>
          <RouterLink
            class="repo-toolbar__btn"
            :class="{ 'is-active': activeTab === 'run' }"
            :to="repoRoute(repoId, 'run')"
            data-agent-id="repo.toolbar.tab.run"
            title="日志"
            aria-label="日志"
          >
            <ScrollText :size="17" aria-hidden="true" />
          </RouterLink>
        </div>

        <div class="repo-toolbar__group repo-toolbar__refresh-group">
          <button
            type="button"
            class="repo-toolbar__btn"
            :title="refreshingCurrentPage ? '正在刷新当前页' : '刷新当前页'"
            :aria-label="refreshingCurrentPage ? '正在刷新当前页' : '刷新当前页'"
            data-agent-id="repo.toolbar.refresh-page"
            :disabled="actionRunning || refreshingCurrentPage || !currentPageRefreshAvailable"
            @click="emit('refreshCurrentPage')"
          >
            <LoaderCircle v-if="refreshingCurrentPage" :size="17" aria-hidden="true" class="sb-spin" />
            <RotateCw v-else :size="17" aria-hidden="true" />
          </button>
        </div>

        <div class="repo-toolbar__group repo-toolbar__actions" role="group" aria-label="项目操作">
          <template v-if="repoContext.capabilities.open.available">
          <RepoToolbarSettingsMenu
            :values="repoSettingValues"
            :disabled="actionRunning"
            @update:setting="(key, value) => emit('updateSetting', key, value)"
            @open-remote-sync-settings="emit('openRemoteSyncSettings')"
          />
          <button
            v-if="repoContext.tags.includes('system-git')"
            type="button"
            class="repo-toolbar__btn"
            data-agent-id="repo.toolbar.auth.default-token"
            title="恢复默认 token 推送"
            aria-label="恢复默认 token 推送"
            :disabled="actionRunning"
            @click="emit('useDefaultTokenAuth')"
          >
            <RotateCcw :size="17" aria-hidden="true" />
          </button>
          <div class="repo-toolbar__open-group">
            <button
              type="button"
              class="repo-toolbar__btn repo-toolbar__open-main"
              :title="openTargetLabel"
              :aria-label="openTargetLabel"
              data-agent-id="repo.toolbar.open.selected"
              :disabled="actionRunning || !summaryPath"
              @click="emit('openSelectedTarget')"
            >
              <FolderOpen v-if="activeOpenTargetValue === 'folder'" :size="17" aria-hidden="true" />
              <SquareTerminal v-else-if="activeOpenTargetValue === 'terminal'" :size="17" aria-hidden="true" />
              <Code2 v-else :size="17" aria-hidden="true" />
            </button>
            <Dropdown
              :model-value="activeOpenTargetValue"
              :options="openTargetOptions"
              placement="bottom"
              button-class="repo-toolbar__btn repo-toolbar__open-target-toggle"
              agent-id="repo.toolbar.open.target"
              menu-width="132px"
              menu-label="打开目标"
              hide-button-label
              :disabled="actionRunning || !summaryPath"
              @update:model-value="emit('selectOpenTarget', $event)"
            />
          </div>
          <div class="repo-toolbar__pull-group">
            <button
              type="button"
              class="repo-toolbar__btn repo-toolbar__pull-main"
              :class="{ 'repo-toolbar__btn--counted': behindCount || remotesNeedingPull }"
              :title="remoteSyncUnavailableReason || (usesMultiplePullRemotes ? `合并 ${pullRemoteCount} 个远端` : '拉取')"
              :aria-label="remoteSyncUnavailableReason || (usesMultiplePullRemotes ? '合并多个远端' : '拉取')"
              data-agent-id="repo.toolbar.pull.selected"
              :disabled="actionRunning || hasConflicts || Boolean(remoteSyncUnavailableReason)"
              @click="emit('runSelectedPullStrategy')"
            >
              <CloudDownload :size="17" aria-hidden="true" />
              <span v-if="usesMultiplePullRemotes" class="repo-toolbar__sync-label">合并多个远端</span>
              <span v-if="usesMultiplePullRemotes && remotesNeedingPull" class="repo-toolbar__badge">{{ remotesNeedingPull }}</span>
              <span v-else-if="behindCount" class="repo-toolbar__badge">{{ behindCount }}</span>
            </button>
            <Dropdown
              v-if="!usesMultiplePullRemotes"
              :model-value="activePullStrategyValue"
              :options="pullStrategyOptions"
              placement="bottom"
              button-class="repo-toolbar__btn repo-toolbar__pull-strategy-toggle"
              agent-id="repo.toolbar.pull.strategy"
              menu-width="144px"
              menu-label="拉取策略"
              hide-button-label
              :disabled="actionRunning || hasConflicts || Boolean(remoteSyncUnavailableReason)"
              @update:model-value="emit('selectPullStrategy', $event)"
            />
          </div>
          <button
            v-if="hasConflicts"
            type="button"
            class="repo-toolbar__btn repo-toolbar__btn--status"
            title="处理未解决冲突"
            aria-label="处理冲突"
            data-agent-id="repo.toolbar.conflict.resolve"
            :disabled="actionRunning"
            @click="emit('openConflicts')"
          >
            <TriangleAlert :size="17" aria-hidden="true" />
            <span class="repo-toolbar__sync-label">处理冲突</span>
          </button>
          <button
            v-else
            type="button"
            class="repo-toolbar__btn"
            :class="{
              'repo-toolbar__btn--counted': aheadCount || remotesNeedingPush,
              'repo-toolbar__btn--push-ready': pushRemoteNames.length && (aheadCount || remotesNeedingPush || needsPublish),
            }"
            :title="pushTargetLabel"
            aria-label="推送"
            data-agent-id="repo.toolbar.push"
            :disabled="Boolean(remoteSyncUnavailableReason) || !pushRemoteNames.length || (!aheadCount && !remotesNeedingPush && !needsPublish)"
            @click="emit('push')"
          >
            <CloudUpload :size="17" aria-hidden="true" />
            <span v-if="pushRemoteNames.length" class="repo-toolbar__sync-label">
              {{ pushRemoteNames.length === 1 ? pushRemoteNames[0] : `${pushRemoteNames.length} 个远端` }}
            </span>
            <span v-if="pushRemoteNames.length > 1 && remotesNeedingPush" class="repo-toolbar__badge">{{ remotesNeedingPush }}</span>
            <span v-else-if="aheadCount" class="repo-toolbar__badge">{{ aheadCount }}</span>
          </button>
          </template>
        </div>
      </div>
    </div>
  </header>
</template>

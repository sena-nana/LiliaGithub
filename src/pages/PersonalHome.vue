<script setup lang="ts">
import { FolderOpen, LoaderCircle, RefreshCw, ShieldCheck } from "@lucide/vue";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import ControlCenterBoard from "../components/control-center/ControlCenterBoard.vue";
import { useDiscoveryRepositories } from "../composables/discovery/useDiscoveryRepositories";
import { useDiscoveryScan } from "../composables/discovery/useDiscoveryScan";
import { useWorkspace } from "../composables/useWorkspace";
import { listAssignedWork } from "../services/personalHome";
import type { GitHubAccountIssueItem } from "../services/workspace";

const workspace = useWorkspace();
const setupError = ref<string | null>(null);
const discovery = useDiscoveryRepositories();
const scan = useDiscoveryScan(discovery.repositories, discovery.refreshToken);
const accountItems = ref<GitHubAccountIssueItem[]>([]);
const accountItemsLoading = ref(false);
const accountItemsError = ref<string | null>(null);
const controlScope = computed(() => workspace.githubBinding.value?.login || "anonymous");
let disposed = false;

async function loadAccountItems(forceRefresh = false) {
  accountItemsLoading.value = true;
  accountItemsError.value = null;
  try {
    const items = await listAssignedWork(50, { forceRefresh });
    if (!disposed) accountItems.value = items;
  } catch {
    if (!disposed) accountItemsError.value = "暂时无法读取分配给你的工作，请重试。";
  } finally {
    if (!disposed) accountItemsLoading.value = false;
  }
}

async function refreshControlCenter() {
  await Promise.all([discovery.refresh(), loadAccountItems(true)]);
}

onMounted(() => void loadAccountItems());
onUnmounted(() => { disposed = true; });

async function chooseWorkspace() {
  setupError.value = null;
  try {
    await workspace.chooseWorkspaceRoot();
  } catch {
    setupError.value = "无法选择工作区，请重试。";
  }
}

async function bindGitHub() {
  setupError.value = null;
  try {
    await workspace.startAuthFlow();
  } catch {
    setupError.value = "无法开始 GitHub 授权，请重试。";
  }
}
</script>

<template>
  <section class="personal-home" data-agent-id="personal-home.page">
    <header class="page-header personal-home__header">
      <div>
        <h1>个人首页</h1>
        <p>{{ workspace.githubBinding.value?.login ? `@${workspace.githubBinding.value.login}` : "你的 GitHub 工作与工作区" }}</p>
      </div>
      <RouterLink v-if="workspace.isReady.value" to="/overview" class="ghost personal-home__overview-link" data-agent-id="personal-home.overview">
        项目总览
      </RouterLink>
      <button
        v-if="workspace.isReady.value"
        type="button"
        class="ghost personal-home__refresh"
        data-agent-id="personal-home.refresh"
        :disabled="discovery.loading.value || accountItemsLoading"
        @click="refreshControlCenter"
      >
        <RefreshCw :size="13" aria-hidden="true" :class="{ 'sb-spin': discovery.loading.value || accountItemsLoading }" />
        刷新
      </button>
    </header>

    <div v-if="!workspace.isReady.value" class="personal-home-setup card" data-agent-id="personal-home.setup">
      <div>
        <h2>完成个人工作区设置</h2>
        <p>选择本地工作区并绑定 GitHub 后即可查看分配工作与通知。</p>
      </div>
      <div class="personal-home-setup__actions">
        <button type="button" :disabled="workspace.choosingWorkspaceRoot.value" @click="chooseWorkspace">
          <LoaderCircle v-if="workspace.choosingWorkspaceRoot.value" :size="14" aria-hidden="true" class="sb-spin" />
          <FolderOpen v-else :size="14" aria-hidden="true" />
          {{ workspace.workspaceRoot.value ? "更换工作区" : "选择工作区" }}
        </button>
        <button type="button" class="primary" :disabled="workspace.state.authLoading" @click="bindGitHub">
          <LoaderCircle v-if="workspace.state.authLoading" :size="14" aria-hidden="true" class="sb-spin" />
          <ShieldCheck v-else :size="14" aria-hidden="true" />
          {{ workspace.githubBinding.value ? "重新绑定 GitHub" : "绑定 GitHub" }}
        </button>
      </div>
      <p v-if="setupError || workspace.state.error" class="personal-home-setup__error" role="alert">
        {{ setupError || workspace.state.error }}
      </p>
    </div>

    <ControlCenterBoard
      v-else
      :repositories="discovery.repositories.value"
      :local-repositories="workspace.state.repos"
      :scan="scan.result.value"
      :account-items="accountItems"
      :tasks="workspace.state.tasks"
      :loading="scan.loading.value || discovery.loading.value || accountItemsLoading"
      :error="scan.error.value || accountItemsError"
      :scope="controlScope"
    />
  </section>
</template>

<style scoped>
.personal-home { display: grid; align-content: start; gap: 12px; width: min(1180px, 100%); margin: 0 auto; }
.personal-home__header { margin-bottom: 0; }
.personal-home__header h1, .personal-home__header p { margin: 0; }
.personal-home__header h1 { font-size: 18px; font-weight: 600; }
.personal-home__header p { margin-top: 3px; color: var(--text-muted); font-size: 12px; }
.personal-home__overview-link, .personal-home__refresh { display: inline-flex; min-height: 28px; align-items: center; gap: 5px; padding: 0 9px; text-decoration: none; }
.personal-home__overview-link { margin-left: auto; }
.personal-home-setup { display: grid; gap: 14px; padding: 18px; }
.personal-home-setup h2, .personal-home-setup p { margin: 0; }
.personal-home-setup h2 { font-size: 14px; }
.personal-home-setup p { margin-top: 4px; color: var(--text-muted); font-size: 12px; }
.personal-home-setup__actions { display: flex; flex-wrap: wrap; gap: 7px; }
.personal-home-setup__actions button { display: inline-flex; min-height: 30px; align-items: center; gap: 6px; }
.personal-home-setup__error { color: var(--err) !important; }
</style>

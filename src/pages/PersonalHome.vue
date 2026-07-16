<script setup lang="ts">
import { FolderOpen, LoaderCircle, ShieldCheck } from "@lucide/vue";
import { ref } from "vue";
import { RouterLink } from "vue-router";
import { useWorkspace } from "../composables/useWorkspace";
import { createCachedAsyncComponent } from "../utils/asyncComponent";

const workspace = useWorkspace();
const setupError = ref<string | null>(null);
const assignedWork = createCachedAsyncComponent(() => import("../components/home/personal/HomeAssignedWorkCard.vue"));
const recentRepositories = createCachedAsyncComponent(() => import("../components/home/personal/HomeRecentRepositoriesCard.vue"));
const savedWorkspace = createCachedAsyncComponent(() => import("../components/home/personal/HomeSavedWorkspaceCard.vue"));
const notifications = createCachedAsyncComponent(() => import("../components/home/personal/HomeNotificationSummaryCard.vue"));
const activity = createCachedAsyncComponent(() => import("../components/home/personal/HomeActivityEntryCard.vue"));

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
      <RouterLink v-if="workspace.isReady.value" to="/overview" class="ghost personal-home__overview-link">
        项目总览
      </RouterLink>
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

    <div v-else class="personal-home__grid">
      <div class="personal-home__primary">
        <Suspense>
          <component :is="assignedWork.component" />
          <template #fallback><div class="card personal-home__placeholder" aria-label="正在加载分配给我的工作" /></template>
        </Suspense>
        <Suspense>
          <component :is="recentRepositories.component" />
          <template #fallback><div class="card personal-home__placeholder" aria-label="正在加载最近仓库" /></template>
        </Suspense>
      </div>
      <div class="personal-home__secondary">
        <Suspense>
          <component :is="savedWorkspace.component" />
          <template #fallback><div class="card personal-home__placeholder personal-home__placeholder--small" aria-label="正在加载已保存工作区" /></template>
        </Suspense>
        <Suspense>
          <component :is="notifications.component" />
          <template #fallback><div class="card personal-home__placeholder personal-home__placeholder--small" aria-label="正在加载通知摘要" /></template>
        </Suspense>
        <Suspense>
          <component :is="activity.component" />
          <template #fallback><div class="card personal-home__placeholder personal-home__placeholder--small" aria-label="正在加载活动入口" /></template>
        </Suspense>
      </div>
    </div>
  </section>
</template>

<style scoped>
.personal-home { display: grid; align-content: start; gap: 12px; width: min(1180px, 100%); margin: 0 auto; }
.personal-home__header { margin-bottom: 0; }
.personal-home__header h1, .personal-home__header p { margin: 0; }
.personal-home__header h1 { font-size: 18px; font-weight: 600; }
.personal-home__header p { margin-top: 3px; color: var(--text-muted); font-size: 12px; }
.personal-home__overview-link { display: inline-flex; min-height: 28px; align-items: center; padding: 0 9px; text-decoration: none; }
.personal-home__grid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(240px, 0.8fr); gap: 12px; align-items: start; }
.personal-home__primary, .personal-home__secondary { display: grid; gap: 12px; min-width: 0; }
.personal-home__placeholder { min-height: 220px; background: var(--bg-subtle); }
.personal-home__placeholder--small { min-height: 120px; }
.personal-home-setup { display: grid; gap: 14px; padding: 18px; }
.personal-home-setup h2, .personal-home-setup p { margin: 0; }
.personal-home-setup h2 { font-size: 14px; }
.personal-home-setup p { margin-top: 4px; color: var(--text-muted); font-size: 12px; }
.personal-home-setup__actions { display: flex; flex-wrap: wrap; gap: 7px; }
.personal-home-setup__actions button { display: inline-flex; min-height: 30px; align-items: center; gap: 6px; }
.personal-home-setup__error { color: var(--err) !important; }
@media (max-width: 760px) { .personal-home__grid { grid-template-columns: minmax(0, 1fr); } }
</style>

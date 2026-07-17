<script setup lang="ts">
import { LoaderCircle, RefreshCw } from "@lucide/vue";
import { RouterLink } from "vue-router";
import DiscoveryRepositoryScopeControl from "../components/discovery/DiscoveryRepositoryScopeControl.vue";
import DiscoveryPanel from "../components/discovery/DiscoveryPanel.vue";
import { useDiscoveryRepositories } from "../composables/discovery/useDiscoveryRepositories";
import { useDiscoveryScan } from "../composables/discovery/useDiscoveryScan";
import { createCachedAsyncComponent } from "../utils/asyncComponent";

const pendingPullRequests = createCachedAsyncComponent(() => import("../components/discovery/PendingPullRequestsPanel.vue"));
const assignedIssues = createCachedAsyncComponent(() => import("../components/discovery/AssignedIssuesPanel.vue"));
const failedWorkflows = createCachedAsyncComponent(() => import("../components/discovery/FailedWorkflowsPanel.vue"));
const recentReleases = createCachedAsyncComponent(() => import("../components/discovery/RecentReleasesPanel.vue"));
const repositoryStatus = createCachedAsyncComponent(() => import("../components/discovery/RepositoryStatusPanel.vue"));

const discovery = useDiscoveryRepositories();
const scan = useDiscoveryScan(discovery.repositories, discovery.refreshToken);
const refreshScan = () => scan.load(true);
</script>

<template>
  <main class="discovery-page" data-agent-id="discovery.page">
    <header class="page-header discovery-header">
      <div>
        <h1>跨仓库</h1>
        <p>集中处理当前仓库批次中需要关注的工作。</p>
      </div>
      <button type="button" class="ghost discovery-refresh" data-agent-id="discovery.refresh" :disabled="discovery.loading.value" @click="discovery.refresh">
        <RefreshCw :size="14" aria-hidden="true" :class="{ 'sb-spin': discovery.loading.value }" />
        <span>刷新</span>
      </button>
    </header>

    <section v-if="!discovery.login.value" class="card discovery-account" aria-label="GitHub 账户状态">
      <div><strong>连接 GitHub 后查看跨仓库工作</strong><span>绑定账户后会按你可见的仓库范围聚合内容。</span></div>
      <RouterLink class="primary" :to="{ path: '/settings', query: { tab: 'account' } }" data-agent-id="discovery.account.open">前往账户设置</RouterLink>
    </section>

    <template v-else>
      <section class="card discovery-controls" aria-label="仓库范围和批次">
        <DiscoveryRepositoryScopeControl
          :model-value="discovery.scope.value"
          :personal-login="discovery.login.value"
          :organizations="discovery.organizations.value"
          :disabled="discovery.loading.value || discovery.loadingMore.value"
          @update:model-value="discovery.setScope"
        />
        <div class="discovery-batch" role="status">
          <LoaderCircle v-if="discovery.loading.value" :size="14" aria-hidden="true" class="sb-spin" />
          <span v-if="discovery.loading.value">正在加载仓库...</span>
          <span v-else>当前批次 {{ discovery.repositories.value.length }} 个仓库</span>
        </div>
      </section>

      <div v-if="discovery.error.value" class="discovery-repository-error" role="alert">
        <span>{{ discovery.error.value }}</span>
        <button type="button" class="ghost" data-agent-id="discovery.repositories.retry" @click="discovery.refresh">重试</button>
      </div>

      <div class="discovery-grid">
        <Suspense>
          <component :is="pendingPullRequests.component" :result="scan.result.value?.pendingPullRequests ?? null" :loading="scan.loading.value" :error="scan.error.value" :refresh="refreshScan" />
          <template #fallback><DiscoveryPanel title="待处理 Pull Requests" agent-id="discovery.pr" loading empty-message="" /></template>
        </Suspense>
        <Suspense>
          <component :is="assignedIssues.component" :result="scan.result.value?.assignedIssues ?? null" :loading="scan.loading.value" :error="scan.error.value" :refresh="refreshScan" />
          <template #fallback><DiscoveryPanel title="被分配的 Issues" agent-id="discovery.issue" loading empty-message="" /></template>
        </Suspense>
        <Suspense>
          <component :is="failedWorkflows.component" :result="scan.result.value?.failedWorkflows ?? null" :loading="scan.loading.value" :error="scan.error.value" :refresh="refreshScan" />
          <template #fallback><DiscoveryPanel title="失败的 Workflows" agent-id="discovery.workflow" loading empty-message="" /></template>
        </Suspense>
        <Suspense>
          <component :is="recentReleases.component" :result="scan.result.value?.recentReleases ?? null" :loading="scan.loading.value" :error="scan.error.value" :refresh="refreshScan" />
          <template #fallback><DiscoveryPanel title="近期 Releases" agent-id="discovery.release" loading empty-message="" /></template>
        </Suspense>
        <Suspense>
          <component :is="repositoryStatus.component" :repositories="discovery.repositories.value" :result="scan.result.value?.repositoryStatuses ?? null" :loading="scan.loading.value" :error="scan.error.value" :refresh="refreshScan" />
          <template #fallback><DiscoveryPanel title="仓库状态" agent-id="discovery.repository" loading empty-message="" /></template>
        </Suspense>
      </div>

      <div v-if="discovery.hasMore.value" class="discovery-more">
        <button type="button" class="ghost" data-agent-id="discovery.repositories.more" :disabled="discovery.loadingMore.value" @click="discovery.loadMore">
          <LoaderCircle v-if="discovery.loadingMore.value" :size="13" aria-hidden="true" class="sb-spin" />
          <span>{{ discovery.loadingMore.value ? "正在加载..." : "显示更多仓库" }}</span>
        </button>
      </div>
    </template>
  </main>
</template>

<style scoped>
.discovery-page { height: 100%; min-width: 0; overflow: auto; padding: 20px; }
.discovery-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.discovery-header h1 { margin: 0; color: var(--text); font-size: 18px; font-weight: 600; }
.discovery-header p { margin: 4px 0 0; color: var(--text-muted); font-size: 13px; }
.discovery-refresh { min-height: 30px; display: inline-flex; align-items: center; gap: 6px; padding: 0 9px; }
.discovery-account { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px; }
.discovery-account > div { min-width: 0; display: grid; gap: 3px; }
.discovery-account strong { color: var(--text); font-size: 13px; }
.discovery-account span { color: var(--text-muted); font-size: 12px; }
.discovery-account .primary { min-height: 30px; display: inline-flex; align-items: center; padding: 0 10px; border-radius: 7px; text-decoration: none; white-space: nowrap; }
.discovery-controls { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; padding: 10px 12px; }
.discovery-batch { display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 11px; white-space: nowrap; }
.discovery-repository-error { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; padding: 9px 11px; border-radius: 7px; color: var(--err); background: var(--err-soft); font-size: 12px; }
.discovery-repository-error .ghost { margin-left: auto; }
.discovery-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 12px; }
.discovery-more { display: flex; justify-content: center; padding: 14px 0 4px; }
.discovery-more button { min-height: 30px; display: inline-flex; align-items: center; gap: 6px; }
@media (max-width: 860px) { .discovery-page { padding: 14px; } .discovery-controls { align-items: stretch; flex-direction: column; } .discovery-batch { justify-content: flex-end; } .discovery-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 520px) { .discovery-account { align-items: stretch; flex-direction: column; } .discovery-account .primary { justify-content: center; } }
</style>

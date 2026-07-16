<script setup lang="ts">
import { CircleDot, GitPullRequest } from "@lucide/vue";
import { onMounted, onUnmounted, ref } from "vue";
import { useComponentEpoch } from "../../../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../../../composables/useLatestAsyncLoader";
import { useWorkspace } from "../../../composables/useWorkspace";
import { listAssignedWork } from "../../../services/personalHome";
import type { GitHubAccountIssueItem } from "../../../services/workspace";
import { formatPersonalHomeTime } from "../../../utils/personalHome";
import HomePanelShell from "./HomePanelShell.vue";

const workspace = useWorkspace();
const componentEpoch = useComponentEpoch();
const loader = createLatestAsyncLoader({ componentEpoch });
const items = ref<GitHubAccountIssueItem[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function load(forceRefresh = false) {
  await loader.run(forceRefresh ? "assigned:refresh" : "assigned", async (runId) => {
    loading.value = true;
    error.value = null;
    try {
      const result = await listAssignedWork(50, { forceRefresh });
      if (loader.isCurrent(runId)) items.value = result;
    } catch {
      if (loader.isCurrent(runId)) error.value = "暂时无法读取分配给你的工作，请重试。";
    } finally {
      if (loader.isCurrent(runId)) loading.value = false;
    }
  });
}

async function openItem(event: MouseEvent, item: GitHubAccountIssueItem) {
  if (event.defaultPrevented) return;
  event.preventDefault();
  error.value = null;
  try {
    await workspace.openUrl(item.issue.htmlUrl);
  } catch {
    if (componentEpoch.assertAlive()) error.value = "无法打开该工作项，请重试。";
  }
}

onMounted(() => void load());
onUnmounted(loader.invalidate);
</script>

<template>
  <HomePanelShell
    title="分配给我"
    agent-id="personal-home.assigned-work"
    :loading="loading"
    :error="error"
    refreshable
    @refresh="load(true)"
  >
    <p v-if="loading && !items.length" class="home-panel-empty">正在加载...</p>
    <p v-else-if="!items.length" class="home-panel-empty">暂无分配给你的工作</p>
    <ol v-else class="home-work-list" aria-label="分配给我的工作">
      <li v-for="item in items.slice(0, 8)" :key="`${item.repoFullName}:${item.issue.number}`">
        <a :href="item.issue.htmlUrl" @click="openItem($event, item)">
          <component :is="item.pullRequest ? GitPullRequest : CircleDot" :size="14" aria-hidden="true" />
          <span class="home-work-list__main">
            <strong>{{ item.issue.title }}</strong>
            <small>{{ item.repoFullName }} #{{ item.issue.number }}</small>
          </span>
          <time :datetime="item.issue.updatedAt">{{ formatPersonalHomeTime(item.issue.updatedAt) }}</time>
        </a>
      </li>
    </ol>
  </HomePanelShell>
</template>

<style scoped>
.home-panel-empty { margin: 0; color: var(--text-muted); font-size: 12px; }
.home-work-list { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
.home-work-list a { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; align-items: center; gap: 7px; min-height: 38px; padding: 3px 5px; border-radius: 5px; color: var(--text-muted); text-decoration: none; }
.home-work-list a:hover { background: var(--bg-hover); color: var(--text); }
.home-work-list__main { display: grid; min-width: 0; }
.home-work-list strong { overflow: hidden; color: var(--text); font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.home-work-list small, .home-work-list time { color: var(--text-muted); font-size: 11px; }
.home-work-list time { white-space: nowrap; }
</style>

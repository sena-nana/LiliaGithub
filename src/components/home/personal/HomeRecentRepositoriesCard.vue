<script setup lang="ts">
import { FolderGit2 } from "@lucide/vue";
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useWorkspace } from "../../../composables/useWorkspace";
import { formatPersonalHomeTime, personalHomeRecentRepositories } from "../../../utils/personalHome";
import HomePanelShell from "./HomePanelShell.vue";

const workspace = useWorkspace();
const repositories = computed(() => personalHomeRecentRepositories(
  workspace.state.settings,
  workspace.state.repos,
));
</script>

<template>
  <HomePanelShell title="最近仓库" agent-id="personal-home.recent-repositories">
    <p v-if="!repositories.length" class="home-panel-empty">打开仓库后会在这里显示</p>
    <ol v-else class="recent-repositories" aria-label="最近处理仓库">
      <li v-for="repo in repositories" :key="repo.key">
        <RouterLink :to="repo.to" :data-agent-id="`personal-home.recent.${repo.key}`">
          <FolderGit2 :size="14" aria-hidden="true" />
          <span><strong>{{ repo.name }}</strong><small>{{ repo.detail }}</small></span>
          <time :datetime="new Date(repo.openedAt).toISOString()">{{ formatPersonalHomeTime(repo.openedAt) }}</time>
        </RouterLink>
      </li>
    </ol>
  </HomePanelShell>
</template>

<style scoped>
.home-panel-empty { margin: 0; color: var(--text-muted); font-size: 12px; }
.recent-repositories { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
.recent-repositories a { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; align-items: center; gap: 7px; min-height: 38px; padding: 3px 5px; border-radius: 5px; color: var(--text-muted); text-decoration: none; }
.recent-repositories a:hover { background: var(--bg-hover); color: var(--text); }
.recent-repositories span { display: grid; min-width: 0; }
.recent-repositories strong { overflow: hidden; color: var(--text); font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.recent-repositories small, .recent-repositories time { color: var(--text-muted); font-size: 11px; }
.recent-repositories small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent-repositories time { white-space: nowrap; }
</style>

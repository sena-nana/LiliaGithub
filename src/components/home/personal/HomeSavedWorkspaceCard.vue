<script setup lang="ts">
import { FolderOpen, Pin } from "@lucide/vue";
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import { useWorkspace } from "../../../composables/useWorkspace";
import { favoriteRepositories } from "../../../utils/repoFavorites";
import HomePanelShell from "./HomePanelShell.vue";

const workspace = useWorkspace();
const error = ref<string | null>(null);
const favorites = computed(() => favoriteRepositories(
  workspace.state.settings,
  workspace.state.repos,
).slice(0, 5));

async function openWorkspace() {
  const root = workspace.workspaceRoot.value;
  if (!root) return;
  error.value = null;
  try {
    await workspace.openPath(root);
  } catch {
    error.value = "无法打开工作区文件夹，请重试。";
  }
}
</script>

<template>
  <HomePanelShell title="已保存工作区" agent-id="personal-home.saved-workspace" :error="error">
    <button
      v-if="workspace.workspaceRoot.value"
      type="button"
      class="workspace-root"
      data-agent-id="personal-home.saved-workspace.open"
      :title="workspace.workspaceRoot.value"
      @click="openWorkspace"
    >
      <FolderOpen :size="15" aria-hidden="true" />
      <span><strong>当前工作区</strong><small>{{ workspace.workspaceRoot.value }}</small></span>
    </button>
    <p v-else class="home-panel-empty">尚未选择工作区</p>
    <ul v-if="favorites.length" class="saved-repositories" aria-label="置顶仓库">
      <li v-for="favorite in favorites" :key="favorite.key">
        <Pin :size="12" aria-hidden="true" />
        <span>{{ favorite.name }}</span>
      </li>
    </ul>
    <RouterLink
      class="home-panel-link"
      :to="{ path: '/settings', query: { tab: 'repositories' } }"
      data-agent-id="personal-home.saved-workspace.manage"
    >
      管理工作区
    </RouterLink>
  </HomePanelShell>
</template>

<style scoped>
.home-panel-empty { margin: 0; color: var(--text-muted); font-size: 12px; }
.workspace-root { display: grid; width: 100%; grid-template-columns: 18px minmax(0, 1fr); align-items: center; gap: 7px; padding: 6px; border: 0; border-radius: 5px; background: var(--bg-subtle); color: var(--text-muted); text-align: left; }
.workspace-root:hover { background: var(--bg-hover); color: var(--text); }
.workspace-root span { display: grid; min-width: 0; }
.workspace-root strong { color: var(--text); font-size: 12px; font-weight: 600; }
.workspace-root small { overflow: hidden; color: var(--text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.saved-repositories { display: grid; gap: 5px; margin: 9px 0 0; padding: 0; color: var(--text-muted); font-size: 11px; list-style: none; }
.saved-repositories li { display: flex; align-items: center; gap: 5px; min-width: 0; }
.saved-repositories span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-panel-link { display: inline-block; margin-top: 10px; color: var(--accent); font-size: 12px; text-decoration: none; }
.home-panel-link:hover { color: var(--accent-strong); text-decoration: underline; }
</style>

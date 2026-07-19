<script setup lang="ts">
import { Settings } from "@lucide/vue";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useWorkspace } from "../../composables/useWorkspace";
import { Dropdown, UiIconButton } from "../../ui";

const workspace = useWorkspace();
const router = useRouter();
const error = ref<string | null>(null);

const options = computed(() => workspace.workspaceCatalog.value.map((item) => {
  const availableRoots = item.roots.filter((root) => root.available).length;
  const rootHint = item.roots.length === 0
    ? "无根目录"
    : availableRoots === item.roots.length
      ? `${item.roots.length} 个根目录`
      : `${availableRoots}/${item.roots.length} 个根目录可用`;
  return {
    value: item.id,
    label: item.name,
    hint: rootHint,
    agentId: `sidebar.workspace.option.${item.id}`,
  };
}));

const activeWorkspaceId = computed({
  get: () => workspace.activeWorkspace.value?.id ?? "",
  set: (workspaceId: string) => {
    if (!workspaceId || workspaceId === workspace.activeWorkspace.value?.id) return;
    void switchWorkspace(workspaceId);
  },
});

async function switchWorkspace(workspaceId: string) {
  error.value = null;
  try {
    await workspace.switchWorkspace(workspaceId);
    await router.push("/");
  } catch (nextError) {
    error.value = String(nextError).replace(/^Error:\s*/, "");
  }
}

function openWorkspaceSettings() {
  void router.push({ path: "/settings", query: { tab: "repositories" } });
}
</script>

<template>
  <div class="workspace-switcher" data-agent-id="sidebar.workspace.switcher">
    <Dropdown
      v-if="options.length"
      v-model="activeWorkspaceId"
      class="workspace-switcher__dropdown"
      :options="options"
      :disabled="workspace.switchingWorkspace.value"
      placement="bottom"
      menu-label="切换工作区"
      menu-width="260px"
      agent-id="sidebar.workspace.switch"
    />
    <span v-else class="workspace-switcher__empty">尚未创建工作区</span>
    <UiIconButton
      :icon="Settings"
      label="管理工作区"
      agent-id="sidebar.workspace.manage"
      :disabled="workspace.switchingWorkspace.value"
      @click="openWorkspaceSettings"
    />
    <p v-if="error" class="workspace-switcher__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.workspace-switcher {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 5px;
  padding: 0 7px 6px;
}

.workspace-switcher__dropdown {
  min-width: 0;
}

:deep(.workspace-switcher__dropdown > button) {
  width: 100%;
  min-width: 0;
  justify-content: flex-start;
}

.workspace-switcher__empty {
  align-self: center;
  padding-left: 7px;
  color: var(--text-faint);
  font-size: 12px;
}

.workspace-switcher__error {
  grid-column: 1 / -1;
  margin: 0 2px;
  color: var(--err);
  font-size: 11px;
  line-height: 1.35;
}
</style>

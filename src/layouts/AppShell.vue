<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { RouterView } from "vue-router";
import { APP_TITLE, SETTINGS_TABS, normalizeSettingsTab } from "../config/appShell";
import { useRouteReturnTarget } from "../composables/useRouteReturnTarget";
import { useShellSidebar } from "../composables/useShellSidebar";
import { provideShellRepoActions } from "../composables/useShellRepoActions";
import { useWorkspace } from "../composables/useWorkspace";
import { installWorkspaceFocusRefresh } from "../composables/workspace/lifecycle";
import TitleBar from "../components/TitleBar.vue";
import SecondaryPanel from "./SecondaryPanel.vue";
import SettingsSidebar from "./SettingsSidebar.vue";
import "../styles/shell.css";

const { route, returnTo } = useRouteReturnTarget();
const sidebarLocked = computed(() => route.meta.lockSidebar === true);
const sidebarVariant = computed(() => route.meta.sidebar ?? "main");
const isSettingsMode = computed(() => sidebarVariant.value === "settings");
const activeSettingsTab = computed(() => normalizeSettingsTab(route.query.tab));
const sidebar = useShellSidebar(sidebarLocked);
const workspace = useWorkspace();
const searchOpen = ref(false);
const searchQuery = ref("");
void workspace.initialize();
let cleanupFocusRefresh: (() => void) | null = null;
let focusRefreshDisposed = false;

onMounted(async () => {
  const cleanup = await installWorkspaceFocusRefresh();
  if (focusRefreshDisposed) {
    cleanup();
    return;
  }
  cleanupFocusRefresh = cleanup;
});

onUnmounted(() => {
  focusRefreshDisposed = true;
  cleanupFocusRefresh?.();
  cleanupFocusRefresh = null;
});

const isSetupOverlay = computed(() => route.path === "/" && !workspace.isReady.value);

async function toggleSearch() {
  searchOpen.value = !searchOpen.value;
  if (searchOpen.value) {
    if (sidebar.effectiveCollapsed.value) sidebar.toggleCollapsed();
    await nextTick();
  } else {
    searchQuery.value = "";
  }
}

provideShellRepoActions({
  searchOpen,
  toggleSearch,
});
</script>

<template>
  <div
    class="shell"
    :class="{
      'is-resizing': sidebar.isResizing.value,
      'is-sidebar-collapsed': sidebar.effectiveCollapsed.value,
      'is-settings-mode': isSettingsMode,
      'is-setup-overlay': isSetupOverlay,
    }"
    :style="{ '--sidebar-width': sidebar.widthStyle.value }"
  >
    <TitleBar
      :title="APP_TITLE"
      :left-sidebar-collapsed="sidebar.effectiveCollapsed.value"
      :sidebar-toggles-disabled="sidebarLocked || isSetupOverlay"
      @toggle-left-sidebar="sidebar.toggleCollapsed"
    />
    <SettingsSidebar
      v-if="isSettingsMode && !isSetupOverlay"
      :tabs="SETTINGS_TABS"
      :active-key="activeSettingsTab"
      :return-to="returnTo"
    />
    <SecondaryPanel
      v-else-if="!isSetupOverlay"
      v-model:search-open="searchOpen"
      v-model:search-query="searchQuery"
    />
    <div
      v-if="!isSetupOverlay"
      class="shell__resizer"
      role="separator"
      aria-orientation="vertical"
      :aria-disabled="sidebar.effectiveCollapsed.value ? 'true' : undefined"
      :aria-valuenow="sidebar.width.value"
      :aria-valuemin="sidebar.minWidth"
      :aria-valuemax="sidebar.maxWidth"
      title="拖动调整侧栏宽度（双击恢复默认）"
      @pointerdown="sidebar.startResize"
      @dblclick="sidebar.resetWidth"
    />
    <main class="shell__main">
      <RouterView />
    </main>
  </div>
</template>

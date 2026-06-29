<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { RouterView } from "vue-router";
import { APP_TITLE, SETTINGS_TABS, normalizeSettingsTab } from "../config/appShell";
import { useRouteReturnTarget } from "../composables/useRouteReturnTarget";
import { useShellSidebar } from "../composables/useShellSidebar";
import { useWorkspace } from "../composables/useWorkspace";
import { installWorkspaceFocusRefresh } from "../composables/workspace/lifecycle";
import { installLaunchStatusEvents } from "../composables/workspace/launchEvents";
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
void workspace.initialize();
let cleanupShellEffects: (() => void) | null = null;
let focusRefreshDisposed = false;

onMounted(async () => {
  const [cleanupFocus, cleanupLaunch] = await Promise.all([
    installWorkspaceFocusRefresh(),
    installLaunchStatusEvents(),
  ]);
  const cleanup = () => {
    cleanupFocus();
    cleanupLaunch();
  };
  if (focusRefreshDisposed) {
    cleanup();
    return;
  }
  cleanupShellEffects = cleanup;
});

onUnmounted(() => {
  focusRefreshDisposed = true;
  cleanupShellEffects?.();
  cleanupShellEffects = null;
});

const isSetupOverlay = computed(() => route.path === "/" && !workspace.isReady.value);
</script>

<template>
  <div
    class="shell"
    data-agent-id="app.shell"
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
    <SecondaryPanel v-else-if="!isSetupOverlay" />
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

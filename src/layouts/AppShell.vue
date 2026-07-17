<script setup lang="ts">
import { PanelLeftClose, PanelLeftOpen } from "@lucide/vue";
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { RouterView, useRoute } from "vue-router";
import {
  LiliaAppShell,
  LiliaPrimaryContent,
  LiliaResourcePanel,
  LiliaSettingsSidebar,
  LiliaWorkspace,
  UiIconButton,
  useContextMenu,
  useNativeAppearance,
  usePersistentBoolean,
  usePersistentNumber,
} from "../ui";
import {
  APP_TITLE,
  LILIA_SETTINGS_MODEL,
  SETTINGS_TABS,
  SIDEBAR_CONFIG,
  normalizeSettingsTab,
} from "../config/appShell";
import { useWorkspace } from "../composables/useWorkspace";
import SecondaryPanel from "./SecondaryPanel.vue";

const ContextMenuHost = defineAsyncComponent(() => import("../ui/contextMenuHost"));
const route = useRoute();
const workspace = useWorkspace();
const appearance = useNativeAppearance();
const { state: contextMenuState } = useContextMenu();
const sidebarWidth = usePersistentNumber({
  key: SIDEBAR_CONFIG.widthStorageKey,
  defaultValue: SIDEBAR_CONFIG.defaultWidth,
  min: SIDEBAR_CONFIG.minWidth,
  max: SIDEBAR_CONFIG.maxWidth,
});
const sidebarCollapsed = usePersistentBoolean(
  SIDEBAR_CONFIG.collapsedStorageKey,
  false,
);
const returnTo = ref("/");

const isSettingsMode = computed(() => route.path === LILIA_SETTINGS_MODEL.path);
const isSetupMode = computed(() => route.path === "/" && !workspace.isReady.value);
const sidebarDisabled = computed(() => isSettingsMode.value || isSetupMode.value);
const effectiveSidebarCollapsed = computed(() => {
  if (isSetupMode.value) return true;
  if (isSettingsMode.value) return false;
  return sidebarCollapsed.value;
});
const activeSettingsTab = computed(() => normalizeSettingsTab(route.query.tab));
const shellTranslucent = computed(() => appearance.backdropMode.value !== "solid");
const sidebarTranslucent = computed(() => (
  shellTranslucent.value && appearance.backdropTarget.value === "sidebar"
));
const mainTranslucent = computed(() => (
  shellTranslucent.value && appearance.backdropTarget.value === "main"
));
const workspaceTranslucent = computed(() => sidebarTranslucent.value || mainTranslucent.value);
const shouldMountContextMenuHost = computed(() => contextMenuState.openSeq > 0);
const sidebarToggleLabel = computed(() => (
  effectiveSidebarCollapsed.value ? "展开左侧栏" : "折叠左侧栏"
));
const sidebarToggleIcon = computed(() => (
  effectiveSidebarCollapsed.value ? PanelLeftOpen : PanelLeftClose
));

watch(
  () => route.fullPath,
  (_nextPath, previousPath) => {
    if (
      route.path === LILIA_SETTINGS_MODEL.path
      && previousPath
      && !previousPath.startsWith(LILIA_SETTINGS_MODEL.path)
    ) {
      returnTo.value = previousPath;
    }
  },
  { flush: "sync" },
);

function toggleSidebar() {
  if (sidebarDisabled.value) return;
  sidebarCollapsed.value = !sidebarCollapsed.value;
}
</script>

<template>
  <LiliaAppShell :title="APP_TITLE">
    <template #titlebar-leading>
      <UiIconButton
        class="app-shell__sidebar-toggle"
        :icon="sidebarToggleIcon"
        :label="sidebarToggleLabel"
        :active="effectiveSidebarCollapsed"
        :disabled="sidebarDisabled"
        agent-id="titlebar.left-sidebar.toggle"
        @click="toggleSidebar"
      />
    </template>

    <LiliaWorkspace
      agent-id="app.workspace"
      :surface-mode="workspaceTranslucent ? 'translucent' : 'solid'"
      surface-level="base"
      surface-boundary
    >
      <LiliaResourcePanel
        v-if="!isSetupMode"
        id="sidebar"
        :size="sidebarWidth"
        :default-size="SIDEBAR_CONFIG.defaultWidth"
        :min-size="SIDEBAR_CONFIG.minWidth"
        :max-size="SIDEBAR_CONFIG.maxWidth"
        :collapsed="effectiveSidebarCollapsed"
        collapsible
        :resizable="!sidebarDisabled"
        :disabled="sidebarDisabled"
        resize-label="调整左侧栏宽度"
        :surface-mode="sidebarTranslucent ? 'translucent' : 'solid'"
        backdrop-effect="none"
        surface-level="base"
        surface-boundary
        @update:size="sidebarWidth = $event"
      >
        <LiliaSettingsSidebar
          v-if="isSettingsMode"
          :tabs="SETTINGS_TABS"
          :active-key="activeSettingsTab"
          :return-to="returnTo"
          :surface-mode="sidebarTranslucent ? 'translucent' : 'solid'"
          backdrop-effect="none"
          surface-level="base"
          surface-boundary
        />
        <SecondaryPanel
          v-else
          :surface-mode="sidebarTranslucent ? 'translucent' : 'solid'"
          backdrop-effect="none"
          surface-level="base"
          surface-boundary
        />
      </LiliaResourcePanel>

      <LiliaPrimaryContent
        id="main"
        :surface-mode="mainTranslucent ? 'translucent' : 'solid'"
        backdrop-effect="none"
        surface-level="base"
        surface-boundary
      >
        <RouterView />
      </LiliaPrimaryContent>
    </LiliaWorkspace>

    <template #overlays>
      <ContextMenuHost v-if="shouldMountContextMenuHost" />
    </template>
  </LiliaAppShell>
</template>

<style scoped>
.app-shell__sidebar-toggle.ui-button {
  width: 28px;
  height: 28px;
}
</style>

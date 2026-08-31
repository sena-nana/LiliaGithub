<script setup lang="ts">
/**
 * Nana AppRoot — real @lilia/ui workspace + SecondaryPanel (P1b).
 * Mirrors AppShell sidebar tree; NanaContextMenuHost replaces Lilia
 * ContextMenuHost (Teleport + CSS fixed → Nana Overlay).
 *
 * Titlebar contract: Nana host (`nana-tauri-demo` AppTitleBar / DesktopShell)
 * owns the single chrome strip. Do not mount Lilia TitleBar here — that
 * stacked a second 36px row on home/settings (dual titlebar).
 */
import { computed, ref, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { resolveBackdropSurfaces } from "@lilia/ui/composables/resolveBackdropSurfaces";
import {
  closeContextMenu,
  useContextMenu,
} from "@lilia/ui/composables/useContextMenu";
import {
  LiliaPrimaryContent,
  LiliaResourcePanel,
  LiliaWorkspace,
} from "@lilia/ui/layouts";
import {
  useNativeAppearance,
  usePersistentBoolean,
  usePersistentNumber,
} from "@lilia/ui/composables";
import { createNanaContextMenuHost } from "@nanaui/nanavue-components";
import {
  LILIA_SETTINGS_MODEL,
  SETTINGS_TABS,
  SIDEBAR_CONFIG,
  normalizeSettingsTab,
} from "../config/appShell";
import { useWorkspace } from "../composables/useWorkspace";
import SecondaryPanel from "../layouts/SecondaryPanel.vue";
import NanaOverlayEvidence from "./NanaOverlayEvidence.vue";
import NanaSettingsSidebar from "./NanaSettingsSidebar.vue";

const route = useRoute();
const router = useRouter();
const workspace = useWorkspace();
const appearance = useNativeAppearance();
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
const surfaces = computed(() =>
  resolveBackdropSurfaces(appearance.backdropMode.value, appearance.backdropTarget.value),
);
const workspaceContextKey = computed(() =>
  `${workspace.activeWorkspace.value?.id ?? "none"}:${workspace.contextRevision.value}`,
);
const shellTranslucent = computed(() => appearance.backdropMode.value !== "solid");

/** Lilia store open/close; paint via Nana Overlay (no CSS fixed Teleport). */
const NanaOverlayContextMenu = createNanaContextMenuHost({
  useState: () => useContextMenu().state,
  close: closeContextMenu,
});

watch(
  () => route.fullPath,
  (_next, previousPath) => {
    if (
      route.path === LILIA_SETTINGS_MODEL.path &&
      previousPath &&
      !previousPath.startsWith(LILIA_SETTINGS_MODEL.path)
    ) {
      returnTo.value = previousPath;
    }
  },
  { flush: "sync" },
);

// Keep router referenced so tree-shaking does not drop navigation helpers used by panels.
void router;
</script>

<template>
  <div
    class="nana-root-paint"
    data-agent-id="nana.root"
    data-nana-host-chrome="true"
    style="display: flex; flex-direction: column; width: 100%; height: 100%; background: var(--bg); color: var(--text); font-size: 14px;"
  >
  <div
    class="lilia-app-shell"
    data-agent-id="app-shell"
    data-nana-host-chrome="true"
    :data-lilia-surface-mode="shellTranslucent ? 'translucent' : 'solid'"
    :data-lilia-backdrop="shellTranslucent ? 'native' : 'none'"
    :data-lilia-backdrop-target="shellTranslucent ? appearance.backdropTarget.value : undefined"
    data-lilia-surface-level="base"
    data-lilia-surface-boundary
  >
    <div class="lilia-app-shell__content" data-agent-id="app-shell.content">
    <LiliaWorkspace
      agent-id="app.workspace"
      class="lilia-workspace flex-row nana-workspace-shell__body"
      style="display: flex; flex-direction: row; flex: 1; width: 100%; height: 100%; background: var(--bg);"
      :surface-mode="surfaces.workspace"
      surface-level="base"
      surface-boundary
    >
      <LiliaResourcePanel
        v-if="!isSetupMode"
        id="sidebar"
        class="secondary-panel"
        :size="sidebarWidth"
        :default-size="SIDEBAR_CONFIG.defaultWidth"
        :min-size="SIDEBAR_CONFIG.minWidth"
        :max-size="SIDEBAR_CONFIG.maxWidth"
        :collapsed="effectiveSidebarCollapsed"
        collapsible
        :resizable="!sidebarDisabled"
        :disabled="sidebarDisabled"
        resize-label="调整左侧栏宽度"
        :surface-mode="surfaces.sidebar"
        backdrop-effect="none"
        surface-level="base"
        surface-boundary
        style="display: flex; flex-direction: column; width: 260px; height: 100%; min-height: 100%; background: var(--bg-elev); padding: 10px; color: var(--text);"
        @update:size="sidebarWidth = $event"
      >
        <NanaSettingsSidebar
          v-if="isSettingsMode"
          :tabs="SETTINGS_TABS"
          :active-key="activeSettingsTab"
          :return-to="returnTo"
        />
        <SecondaryPanel
          v-else
          :key="workspaceContextKey"
          :surface-mode="surfaces.sidebar"
          backdrop-effect="none"
          surface-level="base"
          surface-boundary
        />
      </LiliaResourcePanel>

      <LiliaPrimaryContent
        id="main"
        :surface-mode="surfaces.main"
        backdrop-effect="none"
        surface-level="base"
        surface-boundary
        style="display: flex; flex-direction: column; flex: 1; width: 100%; min-height: 100%; height: 100%; background: var(--bg); padding: 16px; color: var(--text);"
      >
        <RouterView v-slot="{ Component }">
          <component :is="Component" :key="workspaceContextKey" />
        </RouterView>
      </LiliaPrimaryContent>
    </LiliaWorkspace>
    </div>
  </div>
  <NanaOverlayContextMenu />
  <!-- Phase E / X3: Dialog·Drawer·Dropdown evidence (ContextMenu via host above). -->
  <NanaOverlayEvidence />
  </div>
</template>

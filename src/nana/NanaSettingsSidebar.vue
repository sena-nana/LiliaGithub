<script setup lang="ts">
/**
 * Nana Settings sidebar adapter — Lilia settings tab contract → NanaSidebarFrame/Nav.
 * Replaces LiliaSettingsSidebar chrome only; router tab keys unchanged.
 */
import { computed } from "vue";
import { useRouter } from "vue-router";
import {
  NanaSidebarFrame,
  NanaSidebarNav,
  NanaSidebarRow,
} from "@nanaui/nanavue-components";
import type { SettingsTab, SettingsTabKey } from "../config/appShell";

const props = withDefaults(
  defineProps<{
    tabs: readonly SettingsTab[];
    activeKey: SettingsTabKey;
    returnTo?: string | null;
  }>(),
  {
    returnTo: "/",
  },
);

const router = useRouter();

const navItems = computed(() =>
  props.tabs.map((tab) => ({
    key: tab.key,
    label: tab.label,
    agentId: `settings.tab.${tab.key}`,
  })),
);

function goBack() {
  router.push(props.returnTo || "/");
}

function onSelectTab(item: { key?: string }) {
  const key = String(item?.key || "");
  const tab = props.tabs.find((t) => t.key === key);
  if (tab) router.push(tab.to);
}
</script>

<template>
  <NanaSidebarFrame
    class="settings-sidebar nana-settings-sidebar"
    aria-label="设置分类"
    agent-id="settings.sidebar"
    :default-footer="false"
  >
    <template #top>
      <div class="settings-sidebar__head">
        <NanaSidebarRow
          label="返回"
          agent-id="settings.sidebar.back"
          class="settings-sidebar__back"
          @select="goBack"
        />
      </div>
    </template>
    <template #body>
      <NanaSidebarNav
        class="settings-sidebar__tabs"
        aria-label="设置分类"
        data-agent-id="settings.sidebar.tabs"
        :items="navItems"
        :active-key="activeKey"
        @select="onSelectTab"
      />
    </template>
  </NanaSidebarFrame>
</template>

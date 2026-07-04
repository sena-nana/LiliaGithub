<script setup lang="ts">
import { computed, nextTick, watch } from "vue";
import { useRoute } from "vue-router";
import {
  SETTINGS_TABS,
  SETTINGS_SECTIONS,
  normalizeSettingsTab,
} from "../config/appShell";

const route = useRoute();
const activeTab = computed(() => normalizeSettingsTab(route.query.tab));
const activeTabSection = computed(() => SETTINGS_SECTIONS[activeTab.value]);
const activeTabLabel = computed(
  () => SETTINGS_TABS.find((tab) => tab.key === activeTab.value)?.label ?? "设置",
);

async function focusRouteHashTarget() {
  const id = route.hash ? decodeURIComponent(route.hash.slice(1)) : "";
  if (!id) return;

  await nextTick();
  const target = document.getElementById(id);
  if (target) {
    target.scrollIntoView?.({ block: "start" });
    target.focus({ preventScroll: true });
  }
}

watch(
  () => route.fullPath,
  () => {
    void focusRouteHashTarget();
  },
  { immediate: true, flush: "post" },
);
</script>

<template>
  <section class="settings-page">
    <div class="page-header">
      <div>
        <h1>{{ activeTabLabel }}</h1>
        <p>这里只保留模板级偏好，业务配置由具体项目添加。</p>
      </div>
    </div>

    <component :is="activeTabSection" @vue:mounted="focusRouteHashTarget" />
  </section>
</template>

<script setup lang="ts">
import { RouterLink } from "vue-router";
import { ArrowLeft } from "lucide-vue-next";
import type { SettingsTab, SettingsTabKey } from "../config/appShell";

defineProps<{
  tabs: SettingsTab[];
  activeKey: SettingsTabKey;
  returnTo?: string | null;
}>();
</script>

<template>
  <aside class="secondary-panel settings-sidebar" aria-label="设置分类">
    <div class="settings-sidebar__head">
      <RouterLink
        :to="returnTo || '/'"
        custom
        v-slot="{ navigate }"
      >
        <button
          type="button"
          class="settings-sidebar__back"
          aria-label="返回"
          title="返回"
          @click="navigate"
        >
          <ArrowLeft :size="15" aria-hidden="true" />
          <span>返回</span>
        </button>
      </RouterLink>
    </div>

    <nav class="settings-sidebar__tabs" aria-label="设置分类">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.key"
        :to="tab.to"
        custom
        v-slot="{ navigate }"
      >
        <button
          type="button"
          class="settings-sidebar__tab"
          :class="{ 'is-active': activeKey === tab.key }"
          :aria-current="activeKey === tab.key ? 'page' : undefined"
          @click="navigate"
        >
          <component
            :is="tab.icon"
            class="settings-sidebar__tab-icon"
            :size="15"
            aria-hidden="true"
          />
          <span class="settings-sidebar__tab-label">{{ tab.label }}</span>
        </button>
      </RouterLink>
    </nav>
  </aside>
</template>

<style scoped>
.settings-sidebar {
  gap: 12px;
}

.settings-sidebar__head {
  padding: 2px 2px 0;
}

.settings-sidebar__back {
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 0 10px 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.settings-sidebar__back:hover {
  background: var(--bg-hover);
  filter: none;
}

.settings-sidebar__tabs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
}

.settings-sidebar__tab {
  width: 100%;
  min-width: 0;
  height: 34px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  text-align: left;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.settings-sidebar__tab:hover {
  background: var(--bg-hover);
  color: var(--text);
  filter: none;
}

.settings-sidebar__tab.is-active {
  background: var(--bg-active);
  color: var(--accent);
}

.settings-sidebar__tab-icon {
  justify-self: center;
}

.settings-sidebar__tab-label {
  color: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

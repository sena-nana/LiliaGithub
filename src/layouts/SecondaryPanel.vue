<script setup lang="ts">
import { RouterLink } from "vue-router";
import { Plus } from "lucide-vue-next";
import {
  SIDEBAR_FOOTER_LINKS,
  SIDEBAR_FOOTER_STATUS,
  SIDEBAR_GLOBAL_ACTIONS,
  SIDEBAR_GROUPS,
  SIDEBAR_NAV,
} from "../config/appShell";
import SidebarFooter from "../components/sidebar/SidebarFooter.vue";
import SidebarRowTools from "../components/sidebar/SidebarRowTools.vue";
</script>

<template>
  <aside class="secondary-panel">
    <div class="sb-section sb-section--actions">
      <button
        v-for="action in SIDEBAR_GLOBAL_ACTIONS"
        :key="action.key"
        type="button"
        class="sb-action"
        :title="action.label"
        :aria-label="action.label"
        :disabled="action.disabled"
      >
        <component :is="action.icon" :size="16" aria-hidden="true" />
      </button>
    </div>

    <div class="sb-section">
      <div class="sb-section__header">
        <span class="sb-section__title">工作区</span>
        <div class="sb-section__tools">
          <button type="button" class="sb-icon-btn" title="添加" aria-label="添加" disabled>
            <Plus :size="14" aria-hidden="true" />
          </button>
        </div>
      </div>
      <nav class="sb-tree" aria-label="主导航">
        <RouterLink
          v-for="item in SIDEBAR_NAV"
          :key="item.label"
          :to="item.to ?? '/'"
          class="sb-tree__row"
          active-class="is-active"
          :aria-disabled="item.disabled ? 'true' : undefined"
        >
          <component :is="item.icon" :size="14" aria-hidden="true" />
          <span class="sb-tree__name">{{ item.label }}</span>
          <SidebarRowTools v-if="item.tools?.length" :tools="item.tools" />
        </RouterLink>
      </nav>
    </div>

    <div
      v-for="group in SIDEBAR_GROUPS"
      :key="group.title"
      class="sb-section"
    >
      <div class="sb-section__header">
        <span class="sb-section__title">{{ group.title }}</span>
        <div v-if="group.tools?.length" class="sb-section__tools">
          <button
            v-for="tool in group.tools"
            :key="tool.key"
            type="button"
            class="sb-icon-btn"
            :title="tool.label"
            :aria-label="tool.label"
            :disabled="tool.disabled"
          >
            <component :is="tool.icon" :size="14" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div class="sb-tree">
        <div
          v-for="item in group.items"
          :key="item.label"
          class="sb-tree__row sb-tree__row--project"
          :aria-disabled="item.disabled ? 'true' : undefined"
        >
          <component :is="item.icon" :size="14" aria-hidden="true" />
          <span class="sb-tree__name">{{ item.label }}</span>
          <SidebarRowTools v-if="item.tools?.length" :tools="item.tools" />
        </div>
        <p v-if="group.emptyText" class="sb-tree__empty">{{ group.emptyText }}</p>
      </div>
    </div>

    <SidebarFooter
      :links="SIDEBAR_FOOTER_LINKS"
      :status="SIDEBAR_FOOTER_STATUS"
    />
  </aside>
</template>

<style scoped>
.sb-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
}

.sb-section--actions {
  flex-direction: row;
  align-items: center;
  gap: 4px;
  padding: 2px 2px 0;
}

.sb-section__header {
  display: flex;
  align-items: center;
  height: 24px;
  padding: 0 6px 0 8px;
  color: var(--text-faint);
}

.sb-section__title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
}

.sb-section__tools {
  margin-left: auto;
  display: inline-flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.sb-section__header:hover .sb-section__tools,
.sb-section__header:focus-within .sb-section__tools {
  opacity: 1;
}

.sb-action,
.sb-icon-btn {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.sb-action {
  flex: 1;
  height: 30px;
  padding: 0;
  border-radius: 6px;
}

.sb-icon-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 4px;
}

.sb-action:hover,
.sb-icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
  filter: none;
}

.sb-tree {
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow-y: auto;
  min-height: 0;
}

.sb-tree__empty {
  margin: 6px 8px;
  color: var(--text-faint);
  font-size: 12px;
}

.sb-tree__row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  color: var(--text);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  min-width: 0;
}

.sb-tree__row:hover {
  background: var(--bg-hover);
}

.sb-tree__row.is-active {
  background: var(--bg-active);
  color: var(--accent);
}

.sb-tree__row:hover .sb-tree__hover-tools,
.sb-tree__row:focus-within .sb-tree__hover-tools,
.sb-tree__row.is-active .sb-tree__hover-tools {
  opacity: 1;
  pointer-events: auto;
}

.sb-tree__row--project {
  color: var(--text-muted);
}

.sb-tree__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

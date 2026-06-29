<script setup lang="ts">
import { LoaderCircle, Search } from "@lucide/vue";
import type { Component } from "vue";
import Dropdown from "../Dropdown.vue";

type SidebarControlOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SidebarFilterControl = {
  key: string;
  label: string;
  value: string | string[];
  options: SidebarControlOption[];
  agentId: string;
  menuLabel: string;
  buttonClass: string;
  multiple?: boolean;
  displayLabel?: string;
  placeholder?: string;
  disabled?: boolean;
};

defineProps<{
  title: string;
  panelLabel: string;
  icon: Component;
  createIcon: Component;
  createLabel: string;
  createAgentId: string;
  createDisabled?: boolean;
  creating?: boolean;
  states: readonly SidebarControlOption[];
  state: string;
  stateAriaLabel: string;
  stateAgentPrefix: string;
  searchLabel: string;
  searchPlaceholder: string;
  searchAgentId: string;
  query: string;
  filters: readonly SidebarFilterControl[];
  sortValue: string;
  sortOptions: readonly SidebarControlOption[];
  sortAgentId: string;
  sortButtonClass: string;
}>();

const emit = defineEmits<{
  create: [];
  state: [value: string];
  query: [value: string];
  filter: [key: string, value: string | string[]];
  sort: [value: string];
}>();
</script>

<template>
  <section class="project-sidebar-filter-card" :aria-label="panelLabel">
    <div class="project-sidebar-filter-card__head">
      <div class="project-sidebar-filter-card__title">
        <component :is="icon" :size="14" aria-hidden="true" />
        <strong>{{ title }}</strong>
      </div>
      <button
        type="button"
        class="primary project-sidebar-filter-card__create"
        :data-agent-id="createAgentId"
        :disabled="createDisabled"
        @click="emit('create')"
      >
        <LoaderCircle v-if="creating" :size="14" aria-hidden="true" class="sb-spin" />
        <component :is="createIcon" v-else :size="14" aria-hidden="true" />
        {{ createLabel }}
      </button>
    </div>

    <div class="project-sidebar-filter-card__states" role="group" :aria-label="stateAriaLabel">
      <button
        v-for="filter in states"
        :key="filter.value"
        type="button"
        :data-agent-id="`${stateAgentPrefix}.${filter.value}`"
        :class="{ 'is-active': state === filter.value }"
        :aria-pressed="state === filter.value"
        @click="emit('state', filter.value)"
      >
        {{ filter.label }}
      </button>
    </div>

    <label class="project-sidebar-filter-card__search">
      <Search :size="15" aria-hidden="true" />
      <input
        :value="query"
        type="search"
        :placeholder="searchPlaceholder"
        :aria-label="searchLabel"
        :data-agent-id="searchAgentId"
        @input="emit('query', ($event.target as HTMLInputElement).value)"
      />
    </label>

    <div class="project-sidebar-filter-card__filters">
      <div
        v-for="filter in filters"
        :key="filter.key"
        class="project-sidebar-filter-card__filter"
      >
        <span>{{ filter.label }}</span>
        <Dropdown
          :model-value="filter.value"
          :multiple="filter.multiple"
          :options="filter.options"
          :display-label="filter.displayLabel"
          :placeholder="filter.placeholder"
          :disabled="filter.disabled"
          :button-class="filter.buttonClass"
          menu-width="260px"
          :menu-label="filter.menuLabel"
          placement="bottom"
          :agent-id="filter.agentId"
          @update:model-value="(value) => emit('filter', filter.key, value)"
        />
      </div>
      <div class="project-sidebar-filter-card__filter">
        <span>排序</span>
        <Dropdown
          :model-value="sortValue"
          :options="sortOptions"
          :button-class="sortButtonClass"
          menu-width="260px"
          menu-label="排序"
          placement="bottom"
          :agent-id="sortAgentId"
          @update:model-value="emit('sort', $event)"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.project-sidebar-filter-card {
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
}

.project-sidebar-filter-card__head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.project-sidebar-filter-card__title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--text);
}

.project-sidebar-filter-card__title strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 700;
}

.project-sidebar-filter-card__create {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  height: 30px;
  padding: 0 9px;
  font-size: 12px;
  white-space: nowrap;
}

.project-sidebar-filter-card__states {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 3px;
  min-width: 0;
  padding: 3px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
}

.project-sidebar-filter-card__states button {
  min-width: 0;
  height: 28px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.project-sidebar-filter-card__states button:hover,
.project-sidebar-filter-card__states button:focus-visible {
  background: var(--bg-hover);
  color: var(--text);
}

.project-sidebar-filter-card__states button.is-active {
  background: var(--bg-active);
  color: var(--text);
}

.project-sidebar-filter-card__search {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text-muted);
}

.project-sidebar-filter-card__search input {
  min-width: 0;
  height: 30px;
  padding: 0;
  border: 0;
  background: transparent;
}

.project-sidebar-filter-card__filters,
.project-sidebar-filter-card__filter {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.project-sidebar-filter-card__filter {
  gap: 5px;
}

.project-sidebar-filter-card__filter > span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.project-sidebar-filter-card__filter :deep(.dd) {
  width: 100%;
  min-width: 0;
}

.project-sidebar-filter-card__filter :deep(.issue-filter-dropdown),
.project-sidebar-filter-card__filter :deep(.pull-filter-dropdown) {
  width: 100%;
  min-width: 0;
  height: 30px;
  justify-content: space-between;
  border-color: var(--border);
  color: var(--text);
}

.project-sidebar-filter-card__filter :deep(.issue-filter-dropdown span),
.project-sidebar-filter-card__filter :deep(.pull-filter-dropdown span) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-spin {
  animation: sb-spin 0.9s linear infinite;
}

@keyframes sb-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

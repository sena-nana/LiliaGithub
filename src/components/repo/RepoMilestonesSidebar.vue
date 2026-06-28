<script setup lang="ts">
import {
  ListFilter,
  LoaderCircle,
  RotateCw,
} from "@lucide/vue";
import {
  ALL_MILESTONES_ID,
  type RepoMilestonesBoardMilestoneFilter,
  type RepoMilestonesBoardStateFilter,
  type RepoMilestonesBoardTypeFilter,
} from "./useRepoMilestonesBoard";

const typeFilters: readonly { value: RepoMilestonesBoardTypeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "issue", label: "Issues" },
  { value: "pull", label: "PRs" },
];
const stateFilters: readonly { value: RepoMilestonesBoardStateFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

defineProps<{
  typeFilter: RepoMilestonesBoardTypeFilter;
  stateFilter: RepoMilestonesBoardStateFilter;
  milestoneFilter: RepoMilestonesBoardMilestoneFilter;
  milestoneFilterOptions: readonly { id: string; title: string; state: string | null; count: number }[];
  baseItemCount: number;
  visibleItemCount: number;
  issueCount: number;
  pullCount: number;
  milestoneCountTotal: number;
  loading: boolean;
  metadataLoading: boolean;
}>();

const emit = defineEmits<{
  "update:typeFilter": [value: RepoMilestonesBoardTypeFilter];
  "update:stateFilter": [value: RepoMilestonesBoardStateFilter];
  "update:milestoneFilter": [value: RepoMilestonesBoardMilestoneFilter];
  refresh: [];
}>();
</script>

<template>
  <div class="milestones-sidebar" aria-label="Milestones filters">
    <section
      class="milestones-sidebar-card milestones-sidebar-card--summary"
      aria-label="Milestones 摘要"
      :title="`${visibleItemCount} items · ${issueCount} issues · ${pullCount} PRs · ${milestoneCountTotal} milestones`"
    >
      <div class="milestones-sidebar-card__head">
        <ListFilter :size="14" aria-hidden="true" />
        <strong>Overview</strong>
        <em>{{ visibleItemCount }}</em>
      </div>
      <button
        type="button"
        class="ghost milestones-sidebar__refresh"
        :disabled="loading || metadataLoading"
        aria-label="刷新 Milestones"
        data-agent-id="repo.milestones.refresh"
        @click="emit('refresh')"
      >
        <LoaderCircle v-if="loading || metadataLoading" :size="14" aria-hidden="true" class="sb-spin" />
        <RotateCw v-else :size="14" aria-hidden="true" />
      </button>
    </section>

    <section class="milestones-sidebar-card" aria-label="事项类型">
      <div class="milestones-sidebar-card__head">
        <strong>Type</strong>
      </div>
      <div class="milestones-sidebar__segments" role="group" aria-label="事项类型">
        <button
          v-for="filter in typeFilters"
          :key="filter.value"
          type="button"
          :data-agent-id="`repo.milestones.filters.type.${filter.value}`"
          :class="{ 'is-active': typeFilter === filter.value }"
          :aria-pressed="typeFilter === filter.value"
          @click="emit('update:typeFilter', filter.value)"
        >
          {{ filter.label }}
        </button>
      </div>
    </section>

    <section class="milestones-sidebar-card" aria-label="事项状态">
      <div class="milestones-sidebar-card__head">
        <strong>Status</strong>
      </div>
      <div class="milestones-sidebar__segments" role="group" aria-label="事项状态">
        <button
          v-for="filter in stateFilters"
          :key="filter.value"
          type="button"
          :data-agent-id="`repo.milestones.filters.state.${filter.value}`"
          :class="{ 'is-active': stateFilter === filter.value }"
          :aria-pressed="stateFilter === filter.value"
          @click="emit('update:stateFilter', filter.value)"
        >
          {{ filter.label }}
        </button>
      </div>
    </section>

    <section class="milestones-sidebar-card" aria-label="Milestone filters">
      <div class="milestones-sidebar-card__head">
        <strong>Milestones</strong>
      </div>
      <nav class="milestones-sidebar__milestone-list" aria-label="Milestone filters">
        <button
          type="button"
          data-agent-id="repo.milestones.filters.milestone.all"
          :class="{ 'is-active': milestoneFilter === ALL_MILESTONES_ID }"
          @click="emit('update:milestoneFilter', ALL_MILESTONES_ID)"
        >
          <span>All milestones</span>
          <em>{{ baseItemCount }}</em>
        </button>
        <button
          v-for="milestone in milestoneFilterOptions"
          :key="milestone.id"
          type="button"
          :data-agent-id="`repo.milestones.filters.milestone.${milestone.id}`"
          :class="{ 'is-active': milestoneFilter === milestone.id }"
          @click="emit('update:milestoneFilter', milestone.id)"
        >
          <span>{{ milestone.title }}</span>
          <em>{{ milestone.count }}</em>
        </button>
      </nav>
    </section>
  </div>
</template>

<style scoped>
.milestones-sidebar {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
}

.milestones-sidebar-card {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
}

.milestones-sidebar-card--summary {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.milestones-sidebar-card__head {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--text);
  font-size: 12px;
}

.milestones-sidebar-card__head strong {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.milestones-sidebar-card__head em {
  min-width: 22px;
  height: 19px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--text);
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
  line-height: 19px;
  text-align: center;
}

.milestones-sidebar__refresh {
  justify-self: end;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 12px;
}

.milestones-sidebar__segments {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px;
  min-width: 0;
  padding: 2px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
}

.milestones-sidebar__segments button {
  height: 28px;
  min-width: 0;
  padding: 0 6px;
  overflow: hidden;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.milestones-sidebar__segments button.is-active {
  background: var(--bg-elev);
  color: var(--text);
}

.milestones-sidebar__milestone-list {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.milestones-sidebar__milestone-list button {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 30px;
  padding: 0 7px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 12px;
  text-align: left;
}

.milestones-sidebar__milestone-list button:hover,
.milestones-sidebar__milestone-list button:focus-visible,
.milestones-sidebar__milestone-list button.is-active {
  background: var(--bg-hover);
  color: var(--text);
  filter: none;
}

.milestones-sidebar__milestone-list span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.milestones-sidebar__milestone-list em {
  min-width: 20px;
  height: 19px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
  line-height: 19px;
  text-align: center;
}
</style>

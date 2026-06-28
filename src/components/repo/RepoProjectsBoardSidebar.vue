<script setup lang="ts">
import {
  ListFilter,
  LoaderCircle,
  RotateCw,
} from "@lucide/vue";
import {
  ALL_PROJECTS_ID,
  type RepoProjectsBoardProjectFilter,
  type RepoProjectsBoardStateFilter,
  type RepoProjectsBoardTypeFilter,
} from "./useRepoProjectsBoard";

const typeFilters: readonly { value: RepoProjectsBoardTypeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "issue", label: "Issues" },
  { value: "pull", label: "PRs" },
];
const stateFilters: readonly { value: RepoProjectsBoardStateFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

defineProps<{
  typeFilter: RepoProjectsBoardTypeFilter;
  stateFilter: RepoProjectsBoardStateFilter;
  projectFilter: RepoProjectsBoardProjectFilter;
  projectFilterOptions: readonly { id: string; title: string; count: number }[];
  baseItemCount: number;
  visibleItemCount: number;
  issueCount: number;
  pullCount: number;
  projectCountTotal: number;
  loading: boolean;
  metadataLoading: boolean;
}>();

const emit = defineEmits<{
  "update:typeFilter": [value: RepoProjectsBoardTypeFilter];
  "update:stateFilter": [value: RepoProjectsBoardStateFilter];
  "update:projectFilter": [value: RepoProjectsBoardProjectFilter];
  refresh: [];
}>();
</script>

<template>
  <div class="projects-board-sidebar" aria-label="Projects filters">
    <section
      class="projects-board-sidebar-card projects-board-sidebar-card--summary"
      aria-label="Projects 摘要"
      :title="`${visibleItemCount} items · ${issueCount} issues · ${pullCount} PRs · ${projectCountTotal} projects`"
    >
      <div class="projects-board-sidebar-card__head">
        <ListFilter :size="14" aria-hidden="true" />
        <strong>Overview</strong>
        <em>{{ visibleItemCount }}</em>
      </div>
      <button
        type="button"
        class="ghost projects-board__refresh"
        :disabled="loading || metadataLoading"
        aria-label="刷新 Projects"
        data-agent-id="repo.projects.refresh"
        @click="emit('refresh')"
      >
        <LoaderCircle v-if="loading || metadataLoading" :size="14" aria-hidden="true" class="sb-spin" />
        <RotateCw v-else :size="14" aria-hidden="true" />
      </button>
    </section>

    <section class="projects-board-sidebar-card" aria-label="事项类型">
      <div class="projects-board-sidebar-card__head">
        <strong>Type</strong>
      </div>
      <div class="projects-board__segments" role="group" aria-label="事项类型">
        <button
          v-for="filter in typeFilters"
          :key="filter.value"
          type="button"
          :data-agent-id="`repo.projects.filters.type.${filter.value}`"
          :class="{ 'is-active': typeFilter === filter.value }"
          :aria-pressed="typeFilter === filter.value"
          @click="emit('update:typeFilter', filter.value)"
        >
          {{ filter.label }}
        </button>
      </div>
    </section>

    <section class="projects-board-sidebar-card" aria-label="事项状态">
      <div class="projects-board-sidebar-card__head">
        <strong>Status</strong>
      </div>
      <div class="projects-board__segments" role="group" aria-label="事项状态">
        <button
          v-for="filter in stateFilters"
          :key="filter.value"
          type="button"
          :data-agent-id="`repo.projects.filters.state.${filter.value}`"
          :class="{ 'is-active': stateFilter === filter.value }"
          :aria-pressed="stateFilter === filter.value"
          @click="emit('update:stateFilter', filter.value)"
        >
          {{ filter.label }}
        </button>
      </div>
    </section>

    <section class="projects-board-sidebar-card" aria-label="Project filters">
      <div class="projects-board-sidebar-card__head">
        <strong>Projects</strong>
      </div>
      <nav class="projects-board__project-list" aria-label="Project filters">
        <button
          type="button"
          data-agent-id="repo.projects.filters.project.all"
          :class="{ 'is-active': projectFilter === ALL_PROJECTS_ID }"
          @click="emit('update:projectFilter', ALL_PROJECTS_ID)"
        >
          <span>All projects</span>
          <em>{{ baseItemCount }}</em>
        </button>
        <button
          v-for="project in projectFilterOptions"
          :key="project.id"
          type="button"
          :data-agent-id="`repo.projects.filters.project.${project.id}`"
          :class="{ 'is-active': projectFilter === project.id }"
          @click="emit('update:projectFilter', project.id)"
        >
          <span>{{ project.title }}</span>
          <em>{{ project.count }}</em>
        </button>
      </nav>
    </section>
  </div>
</template>

<style scoped>
.projects-board-sidebar {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
}

.projects-board-sidebar-card {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
}

.projects-board-sidebar-card--summary {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.projects-board-sidebar-card__head {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--text);
  font-size: 12px;
}

.projects-board-sidebar-card__head strong {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.projects-board-sidebar-card__head em {
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

.projects-board__refresh {
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

.projects-board__segments {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px;
  min-width: 0;
  padding: 2px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
}

.projects-board__segments button {
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

.projects-board__segments button.is-active {
  background: var(--bg-elev);
  color: var(--text);
}

.projects-board__project-list {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.projects-board__project-list button {
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

.projects-board__project-list button:hover,
.projects-board__project-list button:focus-visible,
.projects-board__project-list button.is-active {
  background: var(--bg-hover);
  color: var(--text);
  filter: none;
}

.projects-board__project-list span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.projects-board__project-list em {
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

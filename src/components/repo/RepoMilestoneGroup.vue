<script setup lang="ts">
defineProps<{
  title: string;
  state: string | null;
  visibleCount: number;
  totalCount: number;
  itemLabel: string;
  agentId: string;
}>();
</script>

<template>
  <section
    class="repo-milestone-group"
    role="listitem"
    :aria-label="`${title} ${itemLabel}`"
    :data-agent-id="agentId"
  >
    <header class="repo-milestone-group__head">
      <div>
        <h4>{{ title }}</h4>
        <span v-if="state">{{ state }}</span>
      </div>
      <em :aria-label="`${visibleCount} / ${totalCount} ${itemLabel}`">
        {{ visibleCount < totalCount ? `${visibleCount} / ${totalCount}` : totalCount }}
      </em>
    </header>
    <div class="repo-milestone-group__items" role="list" :aria-label="`${title} ${itemLabel}列表`">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.repo-milestone-group {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
}

.repo-milestone-group__head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg);
}

.repo-milestone-group__head div {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.repo-milestone-group__head h4 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-milestone-group__head span,
.repo-milestone-group__head em {
  color: var(--text-muted);
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
}

.repo-milestone-group__head em {
  min-width: 24px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--text);
  line-height: 20px;
  text-align: center;
}

.repo-milestone-group__items {
  display: grid;
  min-width: 0;
}

.repo-milestone-group__items :deep(> :last-child) {
  border-bottom: 0;
}
</style>

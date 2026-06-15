<script lang="ts">
import type { Component } from "vue";

export type TimelineNodeLink = {
  kind: "external";
  href: string;
} | {
  kind: "route";
  to: string;
} | {
  kind: "none";
};

export type TimelineDisplayNode = {
  id: string;
  icon: Component;
  title: string;
  detail: string;
  summary: string;
  timestamp: number;
  link: TimelineNodeLink;
  tone?: "error" | "warn" | "ok" | "muted";
};
</script>

<script setup lang="ts">
import { RouterLink } from "vue-router";

defineProps<{
  nodes: readonly TimelineDisplayNode[];
  formatTime: (timestamp: number) => string;
}>();
</script>

<template>
  <ol class="github-timeline-list" aria-label="GitHub 时间线列表">
    <li
      v-for="node in nodes"
      :key="node.id"
      class="github-timeline-row"
    >
      <span class="github-timeline-row__rail" aria-hidden="true">
        <span class="github-timeline-row__node" :class="node.tone ? `is-${node.tone}` : null">
          <component :is="node.icon" :size="14" aria-hidden="true" />
        </span>
      </span>
      <div class="github-timeline-row__body">
        <div class="github-timeline-row__head">
          <a
            v-if="node.link.kind === 'external'"
            class="github-timeline-row__title"
            :href="node.link.href"
            target="_blank"
            rel="noreferrer"
          >
            {{ node.title }}
          </a>
          <RouterLink v-else-if="node.link.kind === 'route'" class="github-timeline-row__title" :to="node.link.to">
            {{ node.title }}
          </RouterLink>
          <strong v-else class="github-timeline-row__title">{{ node.title }}</strong>
          <span class="github-timeline-row__detail">{{ node.detail }}</span>
          <time :datetime="new Date(node.timestamp).toISOString()">{{ formatTime(node.timestamp) }}</time>
        </div>
        <p>{{ node.summary }}</p>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.github-timeline-list {
  position: relative;
  display: grid;
  gap: 0;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.github-timeline-row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 8px;
  min-height: 56px;
  padding: 0 4px;
  border-radius: 6px;
  font-size: 13px;
}

.github-timeline-row:hover {
  background: var(--bg-hover);
}

.github-timeline-row__rail {
  position: relative;
  display: flex;
  justify-content: center;
  padding-top: 9px;
}

.github-timeline-row__rail::before {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  content: "";
  background: color-mix(in srgb, var(--text-muted) 55%, transparent);
}

.github-timeline-row:first-child .github-timeline-row__rail::before {
  top: 10px;
}

.github-timeline-row:last-child .github-timeline-row__rail::before {
  bottom: calc(100% - 10px);
}

.github-timeline-row__node {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--accent);
  background: var(--bg-elev);
  border-radius: 4px;
}

.github-timeline-row:hover .github-timeline-row__node {
  background: var(--bg-hover);
}

.github-timeline-row__node,
.github-timeline-row__title {
  color: var(--accent);
}

.github-timeline-row__node.is-error {
  color: var(--err);
}

.github-timeline-row__node.is-warn {
  color: var(--warn);
}

.github-timeline-row__node.is-ok {
  color: var(--ok);
}

.github-timeline-row__node.is-muted {
  color: var(--text-muted);
}

.github-timeline-row__body {
  min-width: 0;
  padding: 7px 0 8px;
  border-bottom: 1px solid var(--border-soft);
}

.github-timeline-row:last-child .github-timeline-row__body {
  border-bottom: 0;
}

.github-timeline-row__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.github-timeline-row__title {
  flex: 0 0 auto;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.github-timeline-row__title:hover,
.github-timeline-row__title:focus-visible {
  color: var(--accent);
}

.github-timeline-row__detail {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.github-timeline-row__head time {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.github-timeline-row__body p {
  min-width: 0;
  margin: 3px 0 2px;
  overflow: hidden;
  color: var(--text);
  font-size: 12px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

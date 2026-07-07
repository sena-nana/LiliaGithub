<script lang="ts">
import type { Component } from "vue";

export type TimelineNodeLink = {
  kind: "external";
  href: string;
} | {
  kind: "route";
  to: string;
  preload?: () => Promise<unknown>;
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
  datetime: string;
  timeLabel: string;
  link: TimelineNodeLink;
  tone?: "error" | "warn" | "ok" | "muted";
};
</script>

<script setup lang="ts">
import { useRouter } from "vue-router";

defineProps<{
  nodes: readonly TimelineDisplayNode[];
  ariaLabel?: string;
}>();

const router = useRouter();

async function openRouteLink(event: MouseEvent, link: TimelineNodeLink) {
  if (link.kind !== "route" || event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  await link.preload?.();
  await router.push(link.to);
}

function timelineNodeHref(link: TimelineNodeLink) {
  if (link.kind === "external") return link.href;
  if (link.kind === "route") return router.resolve(link.to).href;
  return undefined;
}
</script>

<template>
  <ol class="github-timeline-list" :aria-label="ariaLabel ?? 'GitHub 时间线列表'">
    <li
      v-for="node in nodes"
      :key="node.id"
      class="github-timeline-row"
      :class="{ 'is-link': node.link.kind !== 'none' }"
    >
      <component
        :is="node.link.kind === 'none' ? 'div' : 'a'"
        class="github-timeline-row__content"
        :data-agent-id="node.link.kind === 'none' ? undefined : `github.timeline.${node.id}`"
        :href="timelineNodeHref(node.link)"
        :target="node.link.kind === 'external' ? '_blank' : undefined"
        :rel="node.link.kind === 'external' ? 'noreferrer' : undefined"
        @click="openRouteLink($event, node.link)"
      >
        <span class="github-timeline-row__rail" aria-hidden="true">
          <span class="github-timeline-row__node" :class="node.tone ? `is-${node.tone}` : null">
            <component :is="node.icon" :size="14" aria-hidden="true" />
          </span>
        </span>
        <span class="github-timeline-row__body">
          <span class="github-timeline-row__head">
            <component :is="node.link.kind === 'none' ? 'strong' : 'span'" class="github-timeline-row__title">
              {{ node.title }}
            </component>
            <span class="github-timeline-row__detail">{{ node.detail }}</span>
            <time :datetime="node.datetime">{{ node.timeLabel }}</time>
          </span>
          <component :is="node.link.kind === 'none' ? 'p' : 'span'" class="github-timeline-row__summary">
            {{ node.summary }}
          </component>
        </span>
      </component>
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
  min-height: 56px;
  font-size: 13px;
}

.github-timeline-row__content {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 8px;
  min-height: 56px;
  padding: 0 4px;
  border-radius: 6px;
  color: inherit;
  text-decoration: none;
}

.github-timeline-row.is-link .github-timeline-row__content {
  cursor: pointer;
}

.github-timeline-row.is-link .github-timeline-row__content:hover,
.github-timeline-row.is-link .github-timeline-row__content:focus-visible {
  background: var(--bg-hover);
}

.github-timeline-row.is-link .github-timeline-row__content:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
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

.github-timeline-row.is-link .github-timeline-row__content:hover .github-timeline-row__node,
.github-timeline-row.is-link .github-timeline-row__content:focus-visible .github-timeline-row__node {
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
  text-align: left;
  text-decoration: none;
  white-space: nowrap;
}

.github-timeline-row.is-link .github-timeline-row__content:hover .github-timeline-row__title,
.github-timeline-row.is-link .github-timeline-row__content:focus-visible .github-timeline-row__title {
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

.github-timeline-row__summary {
  display: block;
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

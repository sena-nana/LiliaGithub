<script setup lang="ts">
import { ExternalLink } from "@lucide/vue";
import { RouterLink } from "vue-router";

withDefaults(defineProps<{
  title: string;
  repository: string;
  meta?: string | null;
  to?: string | null;
  href?: string | null;
  agentId: string;
  tone?: "normal" | "warn" | "error";
}>(), { meta: null, to: null, href: null, tone: "normal" });
</script>

<template>
  <article class="discovery-row" :class="`is-${tone}`" :data-agent-id="agentId">
    <div class="discovery-row__main">
      <RouterLink v-if="to" class="discovery-row__title" :to="to" :data-agent-id="`${agentId}.open`">{{ title }}</RouterLink>
      <a v-else-if="href" class="discovery-row__title" :href="href" target="_blank" rel="noreferrer" :data-agent-id="`${agentId}.open`">
        {{ title }} <ExternalLink :size="11" aria-hidden="true" />
      </a>
      <strong v-else class="discovery-row__title">{{ title }}</strong>
      <span class="discovery-row__repo">{{ repository }}</span>
      <span v-if="meta" class="discovery-row__meta">{{ meta }}</span>
    </div>
    <div v-if="$slots.badges" class="discovery-row__badges"><slot name="badges" /></div>
    <div v-if="$slots.actions" class="discovery-row__actions"><slot name="actions" /></div>
    <div v-if="$slots.message" class="discovery-row__message"><slot name="message" /></div>
  </article>
</template>

<style scoped>
.discovery-row { position: relative; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px 12px; padding: 10px 12px; border-bottom: 1px solid var(--border-soft); transition: background 0.12s; }
.discovery-row:last-child { border-bottom: 0; }
.discovery-row:hover, .discovery-row:focus-within { background: var(--bg-hover); }
.discovery-row__main { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 8px; align-items: baseline; }
.discovery-row__title { min-width: 0; grid-column: 1 / -1; display: inline-flex; align-items: center; gap: 4px; overflow: hidden; color: var(--text); font-size: 12px; font-weight: 600; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
.discovery-row__title:hover { color: var(--accent-strong); }
.discovery-row__repo, .discovery-row__meta { overflow: hidden; color: var(--text-faint); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.discovery-row__meta { text-align: right; }
.discovery-row__badges { display: flex; align-items: flex-start; justify-content: flex-end; flex-wrap: wrap; gap: 4px; }
.discovery-row__actions { grid-column: 1 / -1; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.discovery-row__actions :deep(button), .discovery-row__actions :deep(a) { min-height: 25px; padding: 0 7px; font-size: 11px; }
.discovery-row__message { grid-column: 1 / -1; color: var(--err); font-size: 11px; }
.discovery-row.is-error { box-shadow: inset 2px 0 var(--err); }
@media (max-width: 560px) { .discovery-row { grid-template-columns: minmax(0, 1fr); } .discovery-row__badges { justify-content: flex-start; } }
@media (prefers-reduced-motion: reduce) { .discovery-row { transition: none; } }
</style>

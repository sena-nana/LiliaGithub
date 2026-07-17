<script setup lang="ts">
import { RouterLink } from "vue-router";
import type { ContinueContext } from "../../services/controlCenter";

defineProps<{ items: readonly ContinueContext[] }>();
const emit = defineEmits<{ remove: [context: ContinueContext] }>();
function agentKey(context: ContinueContext) {
  return context.id.toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}
</script>

<template>
  <section class="control-section" aria-labelledby="control-continue-title" data-agent-id="control-center.continue">
    <header><div><h2 id="control-continue-title">Continue</h2><p>恢复到最近中断的精确上下文</p></div><span>{{ items.length }}</span></header>
    <p v-if="!items.length" class="empty">打开仓库、文件、Issue、PR 或 Actions 后会在这里保留可恢复入口。</p>
    <ol v-else>
      <li v-for="context in items" :key="context.id" :data-agent-id="`control-center.continue.${agentKey(context)}`">
        <RouterLink :to="context.route" :data-agent-id="`control-center.continue.${agentKey(context)}.open`"><strong>{{ context.title }}</strong><span>{{ context.detail }}</span></RouterLink>
        <button type="button" class="ghost" aria-label="移除恢复入口" :data-agent-id="`control-center.continue.${agentKey(context)}.remove`" @click="emit('remove', context)">移除</button>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.control-section { min-width: 0; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-elev); overflow: hidden; }.control-section > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 12px; border-bottom: 1px solid var(--border-soft); }
h2, p { margin: 0; }h2 { font-size: 13px; }header p { margin-top: 2px; color: var(--text-muted); font-size: 11px; }header > span { color: var(--text-muted); font-size: 11px; }.empty { padding: 18px 12px; color: var(--text-muted); font-size: 12px; }
ol { display: grid; margin: 0; padding: 0; list-style: none; }li { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 46px; padding: 5px 10px 5px 12px; border-top: 1px solid var(--border-soft); }li:first-child { border-top: 0; }
a { display: grid; gap: 2px; min-width: 0; color: var(--text); text-decoration: none; }strong, a span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }strong { font-size: 12px; }a span { color: var(--text-muted); font-size: 10px; }button { min-height: 27px; padding: 0 7px; font-size: 11px; }
</style>

<script setup lang="ts">
import { RouterLink } from "vue-router";
import type { ProjectMomentum, ProjectMomentumState } from "../../services/controlCenter";

defineProps<{ items: readonly ProjectMomentum[] }>();
function label(state: ProjectMomentumState) {
  return { healthy: "健康", attention: "需关注", blocked: "受阻", inactive: "暂未活跃" }[state];
}
function agentKey(item: ProjectMomentum) {
  return item.repoId.toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}
</script>

<template>
  <section class="control-section" aria-labelledby="control-momentum-title" data-agent-id="control-center.momentum">
    <header><div><h2 id="control-momentum-title">Project Momentum</h2><p>根据工作区和 GitHub 真值解释项目状态</p></div><span>{{ items.length }}</span></header>
    <p v-if="!items.length" class="empty">当前范围没有可计算状态的仓库。</p>
    <ol v-else>
      <li v-for="project in items" :key="project.repoId" :data-agent-id="`control-center.momentum.${agentKey(project)}`">
        <div><strong>{{ project.repository }}</strong><span class="state" :class="`is-${project.state}`">{{ label(project.state) }}</span></div>
        <p>{{ project.reasons.map((reason) => reason.label).join(" · ") }}</p>
        <RouterLink class="ghost" :to="project.nextAction.route" :data-agent-id="`control-center.momentum.${agentKey(project)}.open`">{{ project.nextAction.label }}</RouterLink>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.control-section { min-width: 0; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-elev); overflow: hidden; }.control-section > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 12px; border-bottom: 1px solid var(--border-soft); }
h2, p { margin: 0; }h2 { font-size: 13px; }header p { margin-top: 2px; color: var(--text-muted); font-size: 11px; }header > span { color: var(--text-muted); font-size: 11px; }.empty { padding: 18px 12px; color: var(--text-muted); font-size: 12px; }
ol { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 0; padding: 0; list-style: none; }li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 8px; padding: 10px 12px; border-top: 1px solid var(--border-soft); }li:nth-child(-n + 2) { border-top: 0; }li:nth-child(even) { border-left: 1px solid var(--border-soft); }
li div { display: flex; align-items: center; gap: 6px; min-width: 0; }strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }li p { grid-column: 1; color: var(--text-muted); font-size: 10px; }a { grid-column: 2; grid-row: 1 / span 2; align-self: center; min-height: 27px; padding: 0 7px; font-size: 11px; text-decoration: none; }
.state { padding: 2px 5px; border-radius: 5px; font-size: 10px; white-space: nowrap; }.state.is-blocked { color: var(--err); background: var(--err-soft); }.state.is-attention { color: var(--warn); background: var(--warn-soft); }.state.is-healthy { color: var(--ok); background: var(--ok-soft); }.state.is-inactive { color: var(--text-muted); background: var(--bg-subtle); }
@media (max-width: 760px) { ol { grid-template-columns: minmax(0, 1fr); }li:nth-child(n), li:nth-child(even) { border-top: 1px solid var(--border-soft); border-left: 0; }li:first-child { border-top: 0; } }
</style>

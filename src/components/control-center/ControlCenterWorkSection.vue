<script setup lang="ts">
import { RouterLink } from "vue-router";
import type { WorkItem, WorkItemDispositionState } from "../../services/controlCenter";

const props = defineProps<{
  id: string;
  title: string;
  description: string;
  emptyText: string;
  items: readonly WorkItem[];
  loading: boolean;
  handoffAvailable: (item: WorkItem) => boolean;
  handoffStates: Readonly<Record<string, {
    pending: boolean;
    message: string | null;
    error: string | null;
    handoffId?: string | null;
    resultAvailable?: boolean;
    openingResult?: boolean;
    resultOpened?: boolean;
    resultError?: string | null;
  } | undefined>>;
}>();

const emit = defineEmits<{
  disposition: [item: WorkItem, state: WorkItemDispositionState];
  pin: [item: WorkItem];
  handoff: [item: WorkItem];
  openHandoffResult: [item: WorkItem];
}>();

function kindLabel(kind: WorkItem["kind"]) {
  return {
    pull_request: "Pull Request",
    issue: "Issue",
    review: "Review",
    workflow: "Workflow",
    release: "Release",
    sync_conflict: "同步冲突",
    local_changes: "本地工作",
  }[kind];
}

function agentKey(item: WorkItem) {
  return item.id.toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function agentPrefix(item: WorkItem) {
  return `control-center.${titleKey()}.${agentKey(item)}`;
}

function titleKey() {
  return props.title.toLocaleLowerCase();
}
</script>

<template>
  <section class="control-section" :aria-labelledby="id" :data-agent-id="`control-center.${title.toLocaleLowerCase()}`">
    <header>
      <div><h2 :id="id">{{ title }}</h2><p>{{ description }}</p></div>
      <span>{{ items.length }}</span>
    </header>
    <p v-if="loading && !items.length" class="empty">正在整理工作...</p>
    <p v-else-if="!items.length" class="empty">{{ emptyText }}</p>
    <ol v-else class="work-list">
      <li v-for="item in items" :key="item.id" :data-agent-id="agentPrefix(item)">
        <div class="work-main">
          <div class="work-heading"><span class="kind">{{ kindLabel(item.kind) }}</span><strong>{{ item.title }}</strong></div>
          <p>{{ item.reason }}</p>
          <small>{{ item.repository }} · {{ item.prioritySource }}</small>
        </div>
        <div class="work-actions">
          <RouterLink class="primary" :to="item.nextAction.route" :data-agent-id="`${agentPrefix(item)}.open`">{{ item.nextAction.label }}</RouterLink>
          <button
            v-if="handoffAvailable(item)"
            type="button"
            class="ghost"
            :disabled="handoffStates[item.id]?.pending"
            :data-agent-id="`${agentPrefix(item)}.handoff`"
            @click="emit('handoff', item)"
          >{{ handoffStates[item.id]?.pending ? "正在交接..." : handoffStates[item.id]?.error ? "重试交接" : "交给 LiliaCode" }}</button>
          <button
            v-if="handoffStates[item.id]?.resultAvailable"
            type="button"
            class="ghost"
            :disabled="handoffStates[item.id]?.openingResult"
            :data-agent-id="`${agentPrefix(item)}.handoff-result`"
            @click="emit('openHandoffResult', item)"
          >{{ handoffStates[item.id]?.openingResult ? "正在打开..." : "在 LiliaCode 查看任务" }}</button>
          <button type="button" class="ghost" :aria-pressed="item.pinned" :data-agent-id="`${agentPrefix(item)}.pin`" @click="emit('pin', item)">{{ item.pinned ? "取消置顶" : "置顶" }}</button>
          <button type="button" class="ghost" :data-agent-id="`${agentPrefix(item)}.snooze`" @click="emit('disposition', item, 'snoozed')">稍后</button>
          <button type="button" class="ghost" :data-agent-id="`${agentPrefix(item)}.complete`" @click="emit('disposition', item, 'completed')">完成</button>
          <button type="button" class="ghost" :data-agent-id="`${agentPrefix(item)}.ignore`" @click="emit('disposition', item, 'ignored')">忽略</button>
        </div>
        <p v-if="handoffStates[item.id]?.message" class="handoff-message" role="status" :data-agent-id="`${agentPrefix(item)}.handoff.status`">{{ handoffStates[item.id]?.message }}</p>
        <p v-if="handoffStates[item.id]?.error" class="handoff-error" role="alert" :data-agent-id="`${agentPrefix(item)}.handoff.error`">{{ handoffStates[item.id]?.error }}</p>
        <p v-if="handoffStates[item.id]?.resultOpened" class="handoff-message" role="status" :data-agent-id="`${agentPrefix(item)}.handoff-result.status`">已在 LiliaCode 打开任务。</p>
        <p v-if="handoffStates[item.id]?.resultError" class="handoff-error" role="alert" :data-agent-id="`${agentPrefix(item)}.handoff-result.error`">{{ handoffStates[item.id]?.resultError }}</p>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.control-section { min-width: 0; padding: 0; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-elev); overflow: hidden; }
.control-section > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 12px; border-bottom: 1px solid var(--border-soft); }
.control-section h2, .control-section p { margin: 0; }.control-section h2 { color: var(--text); font-size: 13px; font-weight: 700; }
.control-section header p { margin-top: 2px; color: var(--text-muted); font-size: 11px; }.control-section header > span { min-width: 24px; color: var(--text-muted); font-size: 11px; text-align: right; }
.empty { padding: 18px 12px; color: var(--text-muted); font-size: 12px; }.work-list { display: grid; margin: 0; padding: 0; list-style: none; }
.work-list > li { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; min-height: 72px; padding: 10px 12px; border-top: 1px solid var(--border-soft); }.work-list > li:first-child { border-top: 0; }
.work-main { display: grid; gap: 3px; min-width: 0; }.work-heading { display: flex; align-items: center; gap: 7px; min-width: 0; }.work-heading strong { overflow: hidden; color: var(--text); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.kind { flex: 0 0 auto; padding: 2px 5px; border-radius: 5px; color: var(--text-muted); background: var(--bg-subtle); font-size: 10px; }.work-main p { color: var(--text-muted); font-size: 11px; }.work-main small { color: var(--text-faint); font-size: 10px; }
.work-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; }.work-actions a, .work-actions button { min-height: 27px; padding: 0 7px; font-size: 11px; text-decoration: none; }
.handoff-message, .handoff-error { grid-column: 1 / -1; margin: -3px 0 0; font-size: 11px; }.handoff-message { color: var(--ok); }.handoff-error { color: var(--err); }
@media (max-width: 760px) { .work-list > li { grid-template-columns: minmax(0, 1fr); }.work-actions { justify-content: flex-start; } }
</style>

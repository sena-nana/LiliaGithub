<script setup lang="ts">
import { computed, ref } from "vue";
import { rerunFailedGitHubWorkflowRun } from "../../services/workspace/client";
import { workflowRerunErrorMessage, workflowRunRerunAvailability } from "../repo/workflowRerun";
import type { DiscoveryAggregateResult, DiscoveryFailedWorkflowRun } from "../../services/discovery/types";
import DiscoveryItemRow from "./DiscoveryItemRow.vue";
import DiscoveryPanel from "./DiscoveryPanel.vue";
import { discoveryDate, discoveryProjectRoute } from "./display";

const props = defineProps<{
  result: DiscoveryAggregateResult<DiscoveryFailedWorkflowRun> | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}>();
type WorkflowItem = DiscoveryFailedWorkflowRun;
const items = computed(() => props.result?.items ?? []);
const pendingKey = ref<string | null>(null);
const actionErrors = ref<Record<string, string | undefined>>({});
function key(item: WorkflowItem) { return `${item.repoFullName}:${item.run.id}`; }
async function rerun(item: WorkflowItem) {
  if (!workflowRunRerunAvailability(item.run).available) return;
  pendingKey.value = key(item);
  actionErrors.value = { ...actionErrors.value, [key(item)]: undefined };
  try {
    await rerunFailedGitHubWorkflowRun(item.repoFullName, item.run.id);
    await props.refresh();
  } catch (error) { actionErrors.value = { ...actionErrors.value, [key(item)]: workflowRerunErrorMessage(error) }; }
  finally { pendingKey.value = null; }
}
</script>

<template>
  <DiscoveryPanel title="失败的 Workflows" agent-id="discovery.workflow" :loading="loading" :error="error" :item-count="items.length" :failure-count="result?.failures.length ?? 0" :truncated-count="result?.truncated ? 1 : 0" empty-message="近 30 天没有失败的 Workflow。" @retry="refresh">
    <DiscoveryItemRow v-for="item in items" :key="key(item)" :title="item.run.displayTitle || item.run.name" :repository="item.repoFullName" :meta="`${item.run.conclusion ?? '失败'} · ${discoveryDate(item.run.updatedAt)}`" :to="discoveryProjectRoute(item.repoFullName, 'actions', item.run.id)" :agent-id="`discovery.workflow.row.${key(item)}`" :tone="actionErrors[key(item)] ? 'error' : 'warn'">
      <template #badges><span class="failure">{{ item.run.conclusion }}</span></template>
      <template #actions><button type="button" class="ghost" :disabled="pendingKey !== null || !workflowRunRerunAvailability(item.run).available" :title="workflowRunRerunAvailability(item.run).reason ?? '重跑失败任务'" :data-agent-id="`discovery.workflow.row.${key(item)}.rerun`" @click="rerun(item)">{{ pendingKey === key(item) ? "正在重跑..." : "重跑失败任务" }}</button></template>
      <template v-if="actionErrors[key(item)]" #message>{{ actionErrors[key(item)] }}</template>
    </DiscoveryItemRow>
  </DiscoveryPanel>
</template>

<style scoped>.failure { padding: 2px 5px; border-radius: 5px; color: var(--err); background: var(--err-soft); font-size: 10px; }</style>

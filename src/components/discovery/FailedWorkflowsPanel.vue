<script setup lang="ts">
import { computed, ref } from "vue";
import { loadDiscoveryFailedWorkflowRuns } from "../../services/discovery";
import { rerunFailedGitHubWorkflowRun } from "../../services/workspace";
import { useDiscoverySection } from "../../composables/discovery/useDiscoverySection";
import { workflowRerunErrorMessage, workflowRunRerunAvailability } from "../repo/workflowRerun";
import type { DiscoveryRepositoryInput } from "./types";
import DiscoveryItemRow from "./DiscoveryItemRow.vue";
import DiscoveryPanel from "./DiscoveryPanel.vue";
import { discoveryDate, discoveryProjectRoute } from "./display";

const props = withDefaults(defineProps<{ repositories: readonly DiscoveryRepositoryInput[]; refreshToken?: number }>(), { refreshToken: 0 });
type WorkflowItem = Awaited<ReturnType<typeof loadDiscoveryFailedWorkflowRuns>>["items"][number];
const section = useDiscoverySection(props, (forceRefresh) =>
  loadDiscoveryFailedWorkflowRuns(props.repositories.map((repo) => repo.fullName), { forceRefresh }));
const items = computed(() => section.result.value?.items ?? []);
const pendingKey = ref<string | null>(null);
const actionErrors = ref<Record<string, string | undefined>>({});
function key(item: WorkflowItem) { return `${item.repoFullName}:${item.run.id}`; }
async function rerun(item: WorkflowItem) {
  if (!workflowRunRerunAvailability(item.run).available) return;
  pendingKey.value = key(item);
  actionErrors.value = { ...actionErrors.value, [key(item)]: undefined };
  try {
    await rerunFailedGitHubWorkflowRun(item.repoFullName, item.run.id);
    await section.load(true);
  } catch (error) { actionErrors.value = { ...actionErrors.value, [key(item)]: workflowRerunErrorMessage(error) }; }
  finally { pendingKey.value = null; }
}
</script>

<template>
  <DiscoveryPanel title="失败的 Workflows" agent-id="discovery.workflow" :loading="section.loading.value" :error="section.error.value" :item-count="items.length" :failure-count="section.result.value?.failures.length ?? 0" :truncated-count="section.result.value?.truncated ? 1 : 0" empty-message="近 30 天没有失败的 Workflow。" @retry="section.load(true)">
    <DiscoveryItemRow v-for="item in items" :key="key(item)" :title="item.run.displayTitle || item.run.name" :repository="item.repoFullName" :meta="`${item.run.conclusion ?? '失败'} · ${discoveryDate(item.run.updatedAt)}`" :to="discoveryProjectRoute(item.repoFullName, 'actions', item.run.id)" :agent-id="`discovery.workflow.row.${key(item)}`" :tone="actionErrors[key(item)] ? 'error' : 'warn'">
      <template #badges><span class="failure">{{ item.run.conclusion }}</span></template>
      <template #actions><button type="button" class="ghost" :disabled="pendingKey !== null || !workflowRunRerunAvailability(item.run).available" :title="workflowRunRerunAvailability(item.run).reason ?? '重跑失败任务'" :data-agent-id="`discovery.workflow.row.${key(item)}.rerun`" @click="rerun(item)">{{ pendingKey === key(item) ? "正在重跑..." : "重跑失败任务" }}</button></template>
      <template v-if="actionErrors[key(item)]" #message>{{ actionErrors[key(item)] }}</template>
    </DiscoveryItemRow>
  </DiscoveryPanel>
</template>

<style scoped>.failure { padding: 2px 5px; border-radius: 5px; color: var(--err); background: var(--err-soft); font-size: 10px; }</style>

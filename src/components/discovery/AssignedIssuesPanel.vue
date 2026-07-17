<script setup lang="ts">
import { computed, ref } from "vue";
import { loadDiscoveryAssignedIssues } from "../../services/discovery";
import { updateGitHubIssue } from "../../services/workspace";
import { useDiscoverySection } from "../../composables/discovery/useDiscoverySection";
import type { DiscoveryRepositoryInput } from "./types";
import DiscoveryConfirmDialog from "./DiscoveryConfirmDialog.vue";
import DiscoveryItemRow from "./DiscoveryItemRow.vue";
import DiscoveryPanel from "./DiscoveryPanel.vue";
import { cleanDiscoveryError, discoveryDate, discoveryProjectRoute } from "./display";

const props = withDefaults(defineProps<{ repositories: readonly DiscoveryRepositoryInput[]; refreshToken?: number }>(), { refreshToken: 0 });
type IssueItem = Awaited<ReturnType<typeof loadDiscoveryAssignedIssues>>["items"][number];
const section = useDiscoverySection(props, (forceRefresh) =>
  loadDiscoveryAssignedIssues(props.repositories.map((repo) => repo.fullName), { forceRefresh }));
const items = computed(() => section.result.value?.items ?? []);
const target = ref<{ item: IssueItem; reason: "completed" | "not_planned" } | null>(null);
const pendingKey = ref<string | null>(null);
const actionErrors = ref<Record<string, string | undefined>>({});
function key(item: IssueItem) { return `${item.repoFullName}#${item.issue.number}`; }

async function confirmClose() {
  if (!target.value) return;
  const { item, reason } = target.value;
  pendingKey.value = key(item);
  actionErrors.value = { ...actionErrors.value, [key(item)]: undefined };
  try {
    await updateGitHubIssue(item.repoFullName, item.issue.number, { state: "closed", stateReason: reason });
    target.value = null;
    await section.load(true);
  } catch (error) {
    actionErrors.value = { ...actionErrors.value, [key(item)]: cleanDiscoveryError(error) };
  } finally { pendingKey.value = null; }
}
</script>

<template>
  <DiscoveryPanel title="被分配的 Issues" agent-id="discovery.issue" :loading="section.loading.value" :error="section.error.value" :item-count="items.length" :failure-count="section.result.value?.failures.length ?? 0" :truncated-count="section.result.value?.truncated ? 1 : 0" empty-message="当前批次没有分配给你的 Issue。" @retry="section.load(true)">
    <DiscoveryItemRow v-for="item in items" :key="key(item)" :title="`#${item.issue.number} ${item.issue.title}`" :repository="item.repoFullName" :meta="discoveryDate(item.issue.updatedAt)" :to="discoveryProjectRoute(item.repoFullName, 'issues', item.issue.number)" :agent-id="`discovery.issue.row.${key(item)}`" :tone="actionErrors[key(item)] ? 'error' : 'normal'">
      <template #actions>
        <button type="button" class="ghost" :disabled="pendingKey !== null" :data-agent-id="`discovery.issue.row.${key(item)}.complete`" @click="target = { item, reason: 'completed' }">完成</button>
        <button type="button" class="ghost" :disabled="pendingKey !== null" :data-agent-id="`discovery.issue.row.${key(item)}.not-planned`" @click="target = { item, reason: 'not_planned' }">不做</button>
      </template>
      <template v-if="actionErrors[key(item)]" #message>{{ actionErrors[key(item)] }}</template>
    </DiscoveryItemRow>
  </DiscoveryPanel>
  <DiscoveryConfirmDialog :open="Boolean(target)" :title="target?.reason === 'completed' ? '完成 Issue' : '关闭为不做'" :description="target?.item.issue.title ?? ''" :confirm-label="target?.reason === 'completed' ? '确认完成' : '确认不做'" agent-id="discovery.issue.confirm" :busy="pendingKey !== null" :danger="target?.reason === 'not_planned'" @cancel="target = null" @confirm="confirmClose" />
</template>

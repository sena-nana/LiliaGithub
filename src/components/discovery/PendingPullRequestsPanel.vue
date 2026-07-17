<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import { updateGitHubPullRequest } from "../../services/workspace/client";
import type { DiscoveryAggregateResult, DiscoveryPendingPullRequest } from "../../services/discovery/types";
import DiscoveryConfirmDialog from "./DiscoveryConfirmDialog.vue";
import DiscoveryItemRow from "./DiscoveryItemRow.vue";
import DiscoveryPanel from "./DiscoveryPanel.vue";
import { cleanDiscoveryError, discoveryDate, discoveryProjectRoute } from "./display";

const props = defineProps<{
  result: DiscoveryAggregateResult<DiscoveryPendingPullRequest> | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}>();

type PendingItem = DiscoveryPendingPullRequest;
const items = computed(() => props.result?.items ?? []);
const confirmTarget = ref<PendingItem | null>(null);
const pendingKey = ref<string | null>(null);
const actionErrors = ref<Record<string, string | undefined>>({});

function key(item: PendingItem) { return `${item.repoFullName}#${item.pullRequest.number}`; }
function reasonLabel(reason: PendingItem["reasons"][number]) {
  return reason === "review_requested" ? "请求审查" : "被分配";
}
function setError(item: PendingItem, error?: unknown) {
  actionErrors.value = { ...actionErrors.value, [key(item)]: error ? cleanDiscoveryError(error) : undefined };
}

async function confirmAction() {
  const item = confirmTarget.value;
  if (!item) return;
  pendingKey.value = key(item);
  setError(item);
  try {
    await updateGitHubPullRequest(item.repoFullName, item.pullRequest.number, { state: "closed" });
    confirmTarget.value = null;
    await props.refresh();
  } catch (error) { setError(item, error); }
  finally { pendingKey.value = null; }
}
</script>

<template>
  <DiscoveryPanel
    title="待处理 Pull Requests"
    agent-id="discovery.pr"
    :loading="loading"
    :error="error"
    :item-count="items.length"
    :failure-count="result?.failures.length ?? 0"
    :truncated-count="result?.truncated ? 1 : 0"
    empty-message="当前批次没有需要你处理的 Pull Request。"
    @retry="refresh"
  >
    <DiscoveryItemRow
      v-for="item in items"
      :key="key(item)"
      :title="`#${item.pullRequest.number} ${item.pullRequest.title}`"
      :repository="item.repoFullName"
      :meta="discoveryDate(item.pullRequest.updatedAt)"
      :to="discoveryProjectRoute(item.repoFullName, 'pulls', item.pullRequest.number)"
      :agent-id="`discovery.pr.row.${key(item)}`"
      :tone="actionErrors[key(item)] ? 'error' : 'normal'"
    >
      <template #badges><span class="reason">{{ item.reasons.map(reasonLabel).join(" · ") }}</span></template>
      <template #actions>
        <RouterLink class="ghost" :to="discoveryProjectRoute(item.repoFullName, 'pulls', item.pullRequest.number)" :data-agent-id="`discovery.pr.row.${key(item)}.review`">进入完整审查</RouterLink>
        <button type="button" class="ghost" :disabled="pendingKey !== null" :data-agent-id="`discovery.pr.row.${key(item)}.close`" @click="confirmTarget = item">关闭</button>
      </template>
      <template v-if="actionErrors[key(item)]" #message>{{ actionErrors[key(item)] }}</template>
    </DiscoveryItemRow>
  </DiscoveryPanel>

  <DiscoveryConfirmDialog
    :open="Boolean(confirmTarget)"
    title="关闭 Pull Request"
    :description="confirmTarget?.pullRequest.title ?? ''"
    confirm-label="确认关闭"
    agent-id="discovery.pr.confirm"
    :busy="pendingKey !== null"
    danger
    @cancel="confirmTarget = null"
    @confirm="confirmAction"
  />
</template>

<style scoped>
.reason { padding: 2px 5px; border-radius: 5px; color: var(--accent-text); background: var(--accent-soft); font-size: 10px; }
</style>

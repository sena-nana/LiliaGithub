<script setup lang="ts">
import { computed, ref } from "vue";
import {
  getGitHubDiscoveryRepositoryStatus,
  loadDiscoveryPendingPullRequests,
  submitGitHubDiscoveryPullRequestReview,
} from "../../services/discovery";
import { mergeGitHubPullRequest, updateGitHubPullRequest } from "../../services/workspace";
import { useDiscoverySection } from "../../composables/discovery/useDiscoverySection";
import type { DiscoveryRepositoryInput } from "./types";
import DiscoveryConfirmDialog from "./DiscoveryConfirmDialog.vue";
import DiscoveryItemRow from "./DiscoveryItemRow.vue";
import DiscoveryPanel from "./DiscoveryPanel.vue";
import PullRequestReviewDialog, { type DiscoveryReviewEvent } from "./PullRequestReviewDialog.vue";
import { cleanDiscoveryError, discoveryDate, discoveryProjectRoute } from "./display";

const props = withDefaults(defineProps<{
  repositories: readonly DiscoveryRepositoryInput[];
  refreshToken?: number;
}>(), { refreshToken: 0 });

type PendingItem = Awaited<ReturnType<typeof loadDiscoveryPendingPullRequests>>["items"][number];
type MergeMethod = "merge" | "squash" | "rebase";
const section = useDiscoverySection(props, (forceRefresh) =>
  loadDiscoveryPendingPullRequests(props.repositories.map((repo) => repo.fullName), { forceRefresh }));
const items = computed(() => section.result.value?.items ?? []);
const reviewTarget = ref<PendingItem | null>(null);
const confirmTarget = ref<{ item: PendingItem; action: "merge" | "close" } | null>(null);
const mergeMethods = ref<MergeMethod[]>([]);
const mergeMethod = ref<MergeMethod>("merge");
const pendingKey = ref<string | null>(null);
const actionErrors = ref<Record<string, string | undefined>>({});

function key(item: PendingItem) { return `${item.repoFullName}#${item.pullRequest.number}`; }
function reasonLabel(reason: PendingItem["reasons"][number]) {
  return reason === "review_requested" ? "请求审查" : "被分配";
}
function setError(item: PendingItem, error?: unknown) {
  actionErrors.value = { ...actionErrors.value, [key(item)]: error ? cleanDiscoveryError(error) : undefined };
}

async function openMerge(item: PendingItem) {
  const itemKey = key(item);
  if (pendingKey.value) return;
  pendingKey.value = itemKey;
  setError(item);
  try {
    const status = await getGitHubDiscoveryRepositoryStatus(item.repoFullName);
    const methods: MergeMethod[] = [];
    if (status.allowMergeCommit) methods.push("merge");
    if (status.allowSquashMerge) methods.push("squash");
    if (status.allowRebaseMerge) methods.push("rebase");
    if (!methods.length) throw new Error("仓库当前没有可用的合并方式。");
    mergeMethods.value = methods;
    mergeMethod.value = methods[0];
    confirmTarget.value = { item, action: "merge" };
  } catch (error) { setError(item, error); }
  finally { pendingKey.value = null; }
}

async function submitReview(request: { event: DiscoveryReviewEvent; body?: string }) {
  const item = reviewTarget.value;
  if (!item) return;
  pendingKey.value = key(item);
  setError(item);
  try {
    await submitGitHubDiscoveryPullRequestReview(item.repoFullName, item.pullRequest.number, request);
    reviewTarget.value = null;
    await section.load(true);
  } catch (error) { setError(item, error); }
  finally { pendingKey.value = null; }
}

async function confirmAction() {
  const target = confirmTarget.value;
  if (!target) return;
  const item = target.item;
  pendingKey.value = key(item);
  setError(item);
  try {
    if (target.action === "merge") {
      await mergeGitHubPullRequest(item.repoFullName, item.pullRequest.number, { method: mergeMethod.value });
    } else {
      await updateGitHubPullRequest(item.repoFullName, item.pullRequest.number, { state: "closed" });
    }
    confirmTarget.value = null;
    await section.load(true);
  } catch (error) { setError(item, error); }
  finally { pendingKey.value = null; }
}
</script>

<template>
  <DiscoveryPanel
    title="待处理 Pull Requests"
    agent-id="discovery.pr"
    :loading="section.loading.value"
    :error="section.error.value"
    :item-count="items.length"
    :failure-count="section.result.value?.failures.length ?? 0"
    :truncated-count="section.result.value?.truncated ? 1 : 0"
    empty-message="当前批次没有需要你处理的 Pull Request。"
    @retry="section.load(true)"
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
        <button type="button" class="ghost" :disabled="pendingKey !== null" :data-agent-id="`discovery.pr.row.${key(item)}.review`" @click="reviewTarget = item">审查</button>
        <button type="button" class="ghost" :disabled="pendingKey !== null" :data-agent-id="`discovery.pr.row.${key(item)}.merge`" @click="openMerge(item)">合并</button>
        <button type="button" class="ghost" :disabled="pendingKey !== null" :data-agent-id="`discovery.pr.row.${key(item)}.close`" @click="confirmTarget = { item, action: 'close' }">关闭</button>
      </template>
      <template v-if="actionErrors[key(item)]" #message>{{ actionErrors[key(item)] }}</template>
    </DiscoveryItemRow>
  </DiscoveryPanel>

  <PullRequestReviewDialog :open="Boolean(reviewTarget)" :pull-title="reviewTarget?.pullRequest.title" :busy="pendingKey !== null" @cancel="reviewTarget = null" @submit="submitReview" />
  <DiscoveryConfirmDialog
    :open="Boolean(confirmTarget)"
    :title="confirmTarget?.action === 'merge' ? '合并 Pull Request' : '关闭 Pull Request'"
    :description="confirmTarget?.item.pullRequest.title ?? ''"
    :confirm-label="confirmTarget?.action === 'merge' ? '确认合并' : '确认关闭'"
    agent-id="discovery.pr.confirm"
    :busy="pendingKey !== null"
    :danger="confirmTarget?.action === 'close'"
    @cancel="confirmTarget = null"
    @confirm="confirmAction"
  >
    <label v-if="confirmTarget?.action === 'merge'" class="merge-method">
      <span>合并方式</span>
      <select v-model="mergeMethod" data-agent-id="discovery.pr.confirm.method">
        <option v-for="method in mergeMethods" :key="method" :value="method">{{ method === "merge" ? "创建合并提交" : method === "squash" ? "压缩合并" : "变基合并" }}</option>
      </select>
    </label>
  </DiscoveryConfirmDialog>
</template>

<style scoped>
.reason { padding: 2px 5px; border-radius: 5px; color: var(--accent-text); background: var(--accent-soft); font-size: 10px; }
.merge-method { display: grid; gap: 5px; color: var(--text-muted); font-size: 12px; }
.merge-method select { min-height: 32px; padding: 0 8px; border: 1px solid var(--border); border-radius: 7px; color: var(--text); background: var(--bg); }
</style>

<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import { useWorkspace } from "../../composables/useWorkspace";
import { githubRepositoryPermissionLabel } from "../../utils/githubRepositoryScope";
import { remoteRepoRoute } from "../../utils/remoteRepo";
import { repoConflictRoute, repoRoute } from "../../utils/repoRoutes";
import type {
  DiscoveryAggregateResult,
  DiscoveryRepositoryInput,
  DiscoveryRepositoryStatus,
  DiscoveryRepositoryStatusItem,
} from "../../services/discovery/types";
import DiscoveryItemRow from "./DiscoveryItemRow.vue";
import DiscoveryPanel from "./DiscoveryPanel.vue";
import { cleanDiscoveryError, discoveryDate } from "./display";

const props = defineProps<{
  repositories: readonly DiscoveryRepositoryInput[];
  result: DiscoveryAggregateResult<DiscoveryRepositoryStatusItem> | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}>();
type RepositoryStatus = DiscoveryRepositoryStatus;
type StatusItem = { repository: DiscoveryRepositoryInput; status: RepositoryStatus };
const workspace = useWorkspace();
const items = computed<StatusItem[]>(() => {
  const repositories = new Map(props.repositories.map((repository) => [repository.fullName.toLocaleLowerCase(), repository]));
  return props.result?.items.flatMap(({ repoFullName, status }) => {
      const repository = repositories.get(repoFullName.toLocaleLowerCase());
      return repository ? [{ repository, status }] : [];
    }) ?? [];
});
const syncing = ref<string | null>(null);
const actionErrors = ref<Record<string, string | undefined>>({});

function repositoryState(item: StatusItem) {
  const local = item.repository.localRepo;
  if (!local) return "仅远端";
  const dirty = local.stagedCount + local.unstagedCount + local.untrackedCount;
  const parts = [
    dirty ? `${dirty} 项改动` : "工作区干净",
    local.conflictCount ? `${local.conflictCount} 个冲突` : null,
    local.ahead ? `领先 ${local.ahead}` : null,
    local.behind ? `落后 ${local.behind}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function mergePolicy(status: RepositoryStatus) {
  const methods = [status.allowMergeCommit && "Merge", status.allowSquashMerge && "Squash", status.allowRebaseMerge && "Rebase"].filter(Boolean);
  return methods.length ? methods.join(" / ") : "不可合并";
}

async function sync(item: StatusItem) {
  const local = item.repository.localRepo;
  if (!local || syncing.value) return;
  syncing.value = item.repository.fullName;
  actionErrors.value = { ...actionErrors.value, [item.repository.fullName]: undefined };
  try {
    await workspace.mergePull(local.id, "stash");
    await props.refresh();
  } catch (error) {
    actionErrors.value = { ...actionErrors.value, [item.repository.fullName]: cleanDiscoveryError(error) };
  } finally { syncing.value = null; }
}
</script>

<template>
  <DiscoveryPanel title="仓库状态" agent-id="discovery.repository" :loading="loading" :error="error" :item-count="items.length" :failure-count="result?.failures.length ?? 0" empty-message="当前批次没有可显示的仓库。" @retry="refresh">
    <DiscoveryItemRow v-for="item in items" :key="item.repository.fullName" :title="item.repository.fullName" :repository="repositoryState(item)" :meta="discoveryDate(item.status.updatedAt)" :to="item.repository.localRepo ? repoRoute(item.repository.localRepo.id) : remoteRepoRoute(item.repository.fullName)" :agent-id="`discovery.repository.row.${item.repository.fullName}`" :tone="item.repository.localRepo?.conflictCount || actionErrors[item.repository.fullName] ? 'error' : 'normal'">
      <template #badges>
        <span v-if="item.status.private" class="badge">私有</span>
        <span v-if="item.status.archived" class="badge is-warn">已归档</span>
        <span v-if="item.status.disabled" class="badge is-error">已禁用</span>
        <span class="badge">{{ githubRepositoryPermissionLabel(item.status.permissions) ?? "权限未知" }}</span>
        <span class="badge">{{ mergePolicy(item.status) }}</span>
      </template>
      <template v-if="item.repository.localRepo" #actions>
        <RouterLink v-if="item.repository.localRepo.conflictCount" class="ghost" :to="repoConflictRoute(item.repository.localRepo.id)" :data-agent-id="`discovery.repository.row.${item.repository.fullName}.conflicts`">处理冲突</RouterLink>
        <button v-else type="button" class="ghost" :disabled="syncing !== null || item.status.archived || item.status.disabled" :data-agent-id="`discovery.repository.row.${item.repository.fullName}.sync`" @click="sync(item)">{{ syncing === item.repository.fullName ? "正在同步..." : "同步" }}</button>
      </template>
      <template v-if="actionErrors[item.repository.fullName]" #message>{{ actionErrors[item.repository.fullName] }}</template>
    </DiscoveryItemRow>
  </DiscoveryPanel>
</template>

<style scoped>
.badge { padding: 2px 5px; border-radius: 5px; color: var(--text-muted); background: var(--bg-subtle); font-size: 10px; }
.badge.is-warn { color: var(--warn); background: var(--warn-soft); }
.badge.is-error { color: var(--err); background: var(--err-soft); }
</style>

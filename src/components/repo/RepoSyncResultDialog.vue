<script setup lang="ts">
import { computed } from "vue";
import { AlertCircle, CheckCircle2, GitMerge, LoaderCircle, XCircle } from "@lucide/vue";
import type { RepoRemoteOperationStep, RepoSyncOperationResult } from "../../services/workspace";
import RepoSyncDialogShell from "./RepoSyncDialogShell.vue";

const props = defineProps<{
  result: RepoSyncOperationResult | null;
  retrying: boolean;
}>();

const emit = defineEmits<{
  close: [];
  retryPush: [remoteNames: string[]];
  resolveConflicts: [];
}>();

const failedPushRemotes = computed(() =>
  [...new Set(
    (props.result?.steps ?? [])
      .filter((step) => step.operation === "push" && step.status === "error")
      .map((step) => step.remote),
  )],
);

const title = computed(() => {
  if (props.result?.status === "conflicts") return "同步遇到冲突";
  if (props.result?.status === "partial") return "部分远端同步失败";
  return "远端同步失败";
});

function operationLabel(operation: RepoRemoteOperationStep["operation"]) {
  if (operation === "fetch") return "抓取";
  if (operation === "merge") return "合并";
  if (operation === "restore") return "还原";
  return "推送";
}

function statusLabel(status: RepoRemoteOperationStep["status"]) {
  if (status === "success") return "完成";
  if (status === "skipped") return "已跳过";
  if (status === "conflicts") return "有冲突";
  return "失败";
}

function stepAgentId(step: RepoRemoteOperationStep) {
  return `repo.remote-sync.result.${step.operation}.${encodeURIComponent(step.remote || "local")}`;
}
</script>

<template>
  <RepoSyncDialogShell
    :open="Boolean(result)"
    :title="title"
    :description="result?.message || (result?.status === 'conflicts' ? '解决冲突后再继续同步。' : '成功的远端不会重复执行。')"
    agent-id="repo.remote-sync.result-dialog"
    size="medium"
    :close-disabled="retrying"
    @close="emit('close')"
  >
    <template v-if="result">
          <div class="sync-result-dialog__steps" role="list" aria-label="远端操作结果">
            <div
              v-for="(step, index) in result.steps"
              :key="`${step.operation}:${step.remote}:${index}`"
              class="sync-result-dialog__step"
              role="listitem"
              :data-agent-id="stepAgentId(step)"
            >
              <CheckCircle2 v-if="step.status === 'success'" :size="17" class="is-success" aria-hidden="true" />
              <AlertCircle v-else-if="step.status === 'skipped' || step.status === 'conflicts'" :size="17" class="is-skipped" aria-hidden="true" />
              <XCircle v-else :size="17" class="is-error" aria-hidden="true" />
              <span class="sync-result-dialog__step-main">
                <strong>{{ step.remote || "本地修改" }}</strong>
                <small>
                  {{ operationLabel(step.operation) }}
                  <template v-if="step.targetBranch"> · {{ step.targetBranch }}</template>
                </small>
              </span>
              <span class="sync-result-dialog__step-result">
                <strong>{{ statusLabel(step.status) }}</strong>
                <small v-if="step.message" :title="step.message">{{ step.message }}</small>
              </span>
            </div>
          </div>

    </template>
          <template #actions>
            <template v-if="result">
            <button type="button" class="ghost" data-agent-id="repo.remote-sync.result.close" :disabled="retrying" @click="emit('close')">关闭</button>
            <button
              v-if="failedPushRemotes.length"
              type="button"
              class="primary"
              data-agent-id="repo.remote-sync.retry-failed-push"
              :disabled="retrying"
              @click="emit('retryPush', failedPushRemotes)"
            >
              <LoaderCircle v-if="retrying" class="sync-result-dialog__spinner" :size="15" aria-hidden="true" />
              {{ retrying ? "重试中…" : `重试失败推送（${failedPushRemotes.length}）` }}
            </button>
            <button
              v-if="result.status === 'conflicts'"
              type="button"
              class="primary"
              data-agent-id="repo.remote-sync.resolve-conflicts"
              :disabled="retrying"
              @click="emit('resolveConflicts')"
            >
              <GitMerge :size="15" aria-hidden="true" />
              处理冲突
            </button>
            </template>
          </template>
  </RepoSyncDialogShell>
</template>

<style scoped>
.sync-result-dialog__steps {
  display: grid;
  padding: 0;
}

.sync-result-dialog__step {
  display: grid;
  grid-template-columns: 18px minmax(100px, 0.55fr) minmax(120px, 1fr);
  align-items: center;
  gap: 9px;
  min-height: 50px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-soft);
}

.sync-result-dialog__step:last-child { border-bottom: 0; }
.sync-result-dialog__step .is-success { color: var(--ok); }
.sync-result-dialog__step .is-skipped { color: var(--text-faint); }
.sync-result-dialog__step .is-error { color: var(--err); }

.sync-result-dialog__step-main,
.sync-result-dialog__step-result {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.sync-result-dialog__step-main strong,
.sync-result-dialog__step-result strong { font-size: 12px; }
.sync-result-dialog__step-main small,
.sync-result-dialog__step-result small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}

.primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sync-result-dialog__spinner {
  animation: sync-result-spin 0.8s linear infinite;
}

@keyframes sync-result-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .sync-result-dialog__spinner { animation: none; }
}
</style>

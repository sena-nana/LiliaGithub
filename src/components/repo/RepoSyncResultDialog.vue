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
    title-id="repo-sync-result-title"
    agent-id="repo.remote-sync.result-dialog"
    card-class="sync-result-dialog"
    :close-disabled="retrying"
    @close="emit('close')"
  >
    <template v-if="result">
          <header class="sync-result-dialog__header">
            <span class="sync-result-dialog__status" :class="`is-${result.status}`">
              <GitMerge v-if="result.status === 'conflicts'" :size="19" aria-hidden="true" />
              <AlertCircle v-else-if="result.status === 'partial'" :size="19" aria-hidden="true" />
              <XCircle v-else :size="19" aria-hidden="true" />
            </span>
            <div>
              <h2 id="repo-sync-result-title">{{ title }}</h2>
              <p>{{ result.message || (result.status === 'conflicts' ? '解决冲突后再继续同步。' : '成功的远端不会重复执行。') }}</p>
            </div>
          </header>

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

          <footer class="sync-result-dialog__actions">
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
          </footer>
    </template>
  </RepoSyncDialogShell>
</template>

<style scoped>
:deep(.sync-result-dialog) {
  width: min(600px, calc(100vw - 32px));
  max-height: min(720px, calc(100vh - 32px));
  overflow: auto;
}

.sync-result-dialog__header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--border-soft);
}

.sync-result-dialog__header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
}

.sync-result-dialog__header p {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.sync-result-dialog__status.is-conflicts,
.sync-result-dialog__status.is-partial { color: var(--warn); }
.sync-result-dialog__status.is-error { color: var(--err); }

.sync-result-dialog__steps {
  display: grid;
  padding: 6px 10px;
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

.sync-result-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px 16px;
  border-top: 1px solid var(--border-soft);
}

.sync-result-dialog__actions .primary {
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
  .modal-enter-active,
  .modal-leave-active,
  .modal-enter-active .modal-card,
  .modal-leave-active .modal-card { transition: none; }
}
</style>

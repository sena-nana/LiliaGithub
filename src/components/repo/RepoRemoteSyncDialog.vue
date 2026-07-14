<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AlertCircle, LoaderCircle } from "@lucide/vue";
import { UiSwitch } from "@lilia/ui";
import type {
  RepoRemoteSyncConfig,
  RepoRemoteSyncPolicy,
} from "../../services/workspace";
import RepoSyncDialogShell from "./RepoSyncDialogShell.vue";

const props = defineProps<{
  open: boolean;
  config: RepoRemoteSyncConfig | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  close: [];
  retry: [];
  save: [policy: RepoRemoteSyncPolicy];
}>();

const primaryRemote = ref("");
const pullRemotes = ref<string[]>([]);
const pushRemotes = ref<string[]>([]);

const remotes = computed(() => props.config?.remotes ?? []);
const draftMatchesLoadedPolicy = computed(() => {
  const policy = props.config?.policy ?? props.config?.resolvedPolicy;
  if (!policy) return false;
  return (
    primaryRemote.value === policy.primaryRemote &&
    JSON.stringify([...pullRemotes.value].sort()) === JSON.stringify([...policy.pullRemotes].sort()) &&
    JSON.stringify([...pushRemotes.value].sort()) === JSON.stringify([...policy.pushRemotes].sort())
  );
});
const validationErrors = computed(() => {
  if (!props.config) return [];
  const errors = draftMatchesLoadedPolicy.value ? [...(props.config.validationErrors ?? [])] : [];
  if (!remotes.value.length) errors.push("仓库尚未配置 Git 远端。");
  if (!primaryRemote.value) errors.push("请选择主远端。");
  return [...new Set(errors)];
});
const canSave = computed(() =>
  Boolean(props.config) && !props.loading && !props.saving && validationErrors.value.length === 0
);

watch(
  () => [props.open, props.config] as const,
  ([open, config]) => {
    if (!open || !config) return;
    const policy = config.policy ?? config.resolvedPolicy;
    const available = new Set(config.remotes.map((remote) => remote.name));
    const primary = available.has(policy.primaryRemote) ? policy.primaryRemote : config.remotes[0]?.name ?? "";
    primaryRemote.value = primary;
    pullRemotes.value = [...new Set(policy.pullRemotes.filter((remote) => available.has(remote)).concat(primary || []))];
    pushRemotes.value = policy.pushRemotes.filter((remote) => available.has(remote));
  },
  { immediate: true },
);

function choosePrimary(name: string) {
  primaryRemote.value = name;
  if (!pullRemotes.value.includes(name)) pullRemotes.value = [...pullRemotes.value, name];
}

function toggleRemote(collection: "pull" | "push", name: string, enabled: boolean) {
  if (collection === "pull" && name === primaryRemote.value && !enabled) return;
  const current = collection === "pull" ? pullRemotes.value : pushRemotes.value;
  const next = enabled
    ? [...new Set([...current, name])]
    : current.filter((remote) => remote !== name);
  if (collection === "pull") pullRemotes.value = next;
  else pushRemotes.value = next;
}

function submit() {
  if (!canSave.value) return;
  emit("save", {
    primaryRemote: primaryRemote.value,
    pullRemotes: [...pullRemotes.value],
    pushRemotes: [...pushRemotes.value],
  });
}

function remoteAgentId(name: string, role: string) {
  return `repo.remote-sync.remote.${encodeURIComponent(name)}.${role}`;
}
</script>

<template>
  <RepoSyncDialogShell
    :open="open"
    title-id="repo-remote-sync-title"
    agent-id="repo.remote-sync.dialog"
    card-class="remote-sync-dialog"
    :close-disabled="saving"
    @close="emit('close')"
  >
          <header class="remote-sync-dialog__header">
            <div>
              <h2 id="repo-remote-sync-title">远端同步设置</h2>
              <p>选择已有远端在拉取和推送中的角色。</p>
            </div>
            <button
              type="button"
              class="ghost"
              data-agent-id="repo.remote-sync.close"
              :disabled="saving"
              @click="emit('close')"
            >
              关闭
            </button>
          </header>

          <div v-if="loading" class="remote-sync-dialog__state" role="status" aria-live="polite" data-agent-id="repo.remote-sync.loading">
            <LoaderCircle class="remote-sync-dialog__spinner" :size="18" aria-hidden="true" />
            <span>正在读取远端配置…</span>
          </div>

          <div v-else-if="error && !config" class="remote-sync-dialog__state remote-sync-dialog__state--error">
            <AlertCircle :size="18" aria-hidden="true" />
            <span>{{ error }}</span>
            <button type="button" class="ghost" data-agent-id="repo.remote-sync.retry-load" @click="emit('retry')">
              重试
            </button>
          </div>

          <template v-else-if="config">
            <div class="remote-sync-dialog__columns" aria-label="远端同步角色">
              <span>远端</span>
              <span>主远端</span>
              <span>拉取</span>
              <span>推送</span>
            </div>
            <div v-if="remotes.length" class="remote-sync-dialog__remotes" role="radiogroup" aria-label="主远端">
              <div v-for="remote in remotes" :key="remote.name" class="remote-sync-dialog__remote">
                <span class="remote-sync-dialog__identity">
                  <strong>{{ remote.name }}</strong>
                  <small :title="remote.fetchUrl">{{ remote.fetchUrl }}</small>
                </span>
                <label class="remote-sync-dialog__primary">
                  <input
                    type="radio"
                    name="repo-primary-remote"
                    :value="remote.name"
                    :checked="primaryRemote === remote.name"
                    :aria-label="`${remote.name} 设为主远端`"
                    :data-agent-id="remoteAgentId(remote.name, 'primary')"
                    :disabled="saving"
                    @change="choosePrimary(remote.name)"
                  />
                  <span class="sr-only">{{ remote.name }} 设为主远端</span>
                </label>
                <UiSwitch
                  :model-value="pullRemotes.includes(remote.name)"
                  :disabled="saving || primaryRemote === remote.name"
                  :aria-label="`${remote.name} 用于拉取`"
                  :agent-id="remoteAgentId(remote.name, 'pull')"
                  @update:model-value="toggleRemote('pull', remote.name, $event)"
                />
                <UiSwitch
                  :model-value="pushRemotes.includes(remote.name)"
                  :disabled="saving || !remote.pushUrl"
                  :aria-label="`${remote.name} 用于推送`"
                  :agent-id="remoteAgentId(remote.name, 'push')"
                  @update:model-value="toggleRemote('push', remote.name, $event)"
                />
              </div>
            </div>

            <div v-if="validationErrors.length || error" class="remote-sync-dialog__errors" role="alert">
              <AlertCircle :size="17" aria-hidden="true" />
              <div>
                <p v-if="error">{{ error }}</p>
                <p v-for="message in validationErrors" :key="message">{{ message }}</p>
              </div>
            </div>

            <footer class="remote-sync-dialog__actions">
              <p v-if="!pushRemotes.length">未选择推送目标；拉取仍可使用，推送将不可用。</p>
              <button type="button" class="ghost" :disabled="saving" @click="emit('close')">取消</button>
              <button
                type="button"
                class="primary"
                data-agent-id="repo.remote-sync.save"
                :disabled="!canSave"
                @click="submit"
              >
                {{ saving ? "保存中…" : "保存" }}
              </button>
            </footer>
          </template>
  </RepoSyncDialogShell>
</template>

<style scoped>
:deep(.remote-sync-dialog) {
  width: min(680px, calc(100vw - 32px));
  max-height: min(720px, calc(100vh - 32px));
  overflow: auto;
}

.remote-sync-dialog__header,
.remote-sync-dialog__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
}

.remote-sync-dialog__header {
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--border-soft);
}

.remote-sync-dialog__header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
}

.remote-sync-dialog__header p,
.remote-sync-dialog__actions p {
  margin: 3px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.remote-sync-dialog__state {
  min-height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
}

.remote-sync-dialog__state--error,
.remote-sync-dialog__errors {
  color: var(--err);
}

.remote-sync-dialog__spinner {
  animation: remote-sync-spin 0.8s linear infinite;
}

.remote-sync-dialog__columns,
.remote-sync-dialog__remote {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 64px 56px 56px;
  align-items: center;
  gap: 12px;
}

.remote-sync-dialog__columns {
  padding: 12px 18px 6px;
  color: var(--text-faint);
  font-size: 11px;
  text-align: center;
}

.remote-sync-dialog__columns span:first-child {
  text-align: left;
}

.remote-sync-dialog__remotes {
  display: grid;
  padding: 0 10px;
}

.remote-sync-dialog__remote {
  min-height: 58px;
  padding: 6px 8px;
  border-top: 1px solid var(--border-soft);
}

.remote-sync-dialog__identity {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.remote-sync-dialog__identity strong {
  font-size: 13px;
}

.remote-sync-dialog__identity small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}

.remote-sync-dialog__primary {
  display: flex;
  justify-content: center;
}

.remote-sync-dialog__errors {
  display: flex;
  gap: 8px;
  margin: 12px 18px 0;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  background: var(--err-soft);
  font-size: 12px;
}

.remote-sync-dialog__errors p {
  margin: 0;
}

.remote-sync-dialog__errors p + p {
  margin-top: 3px;
}

.remote-sync-dialog__actions {
  justify-content: flex-end;
  padding: 14px 18px 16px;
}

.remote-sync-dialog__actions p {
  margin-right: auto;
}

@keyframes remote-sync-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 560px) {
  .remote-sync-dialog__columns,
  .remote-sync-dialog__remote {
    grid-template-columns: minmax(0, 1fr) 48px 44px 44px;
    gap: 6px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .remote-sync-dialog__spinner { animation: none; }
  .modal-enter-active,
  .modal-leave-active,
  .modal-enter-active .modal-card,
  .modal-leave-active .modal-card { transition: none; }
}
</style>

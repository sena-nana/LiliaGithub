<script setup lang="ts">
import { computed, ref, watch, type DeepReadonly } from "vue";
import {
  Check,
  FileWarning,
  LoaderCircle,
  TriangleAlert,
  X,
} from "@lucide/vue";
import type {
  RepoConflictChoice,
  RepoConflictFile,
  RepoConflictHunk,
  RepoConflictState,
} from "../../services/workspace";
import RepoSyncDialogShell from "./RepoSyncDialogShell.vue";

type ConflictSide = RepoConflictChoice["side"];
type OperationCopy = { title: string; continue: string; abort: string };
type Confirmation = { kind: "accept"; side: ConflictSide } | { kind: "abort" } | null;

const conflictSides = ["ours", "theirs"] as const;
const operationCopy: Partial<Record<RepoConflictState["operation"], OperationCopy>> = {
  merge: { title: "合并冲突", continue: "完成合并", abort: "终止合并" },
  rebase: { title: "Rebase 冲突", continue: "继续 rebase", abort: "终止 rebase" },
  "cherry-pick": {
    title: "Cherry-pick 冲突",
    continue: "继续 cherry-pick",
    abort: "终止 cherry-pick",
  },
};

const props = defineProps<{
  open: boolean;
  conflicts: DeepReadonly<RepoConflictState>;
  actionRunning: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  close: [];
  resolveFile: [payload: { path: string; choices: RepoConflictChoice[] }];
  acceptFile: [payload: { path: string; side: ConflictSide }];
  markResolved: [path: string];
  continue: [];
  abort: [];
}>();

const focusedPath = ref<string | null>(null);
const choicesByPath = ref<Record<string, Record<string, ConflictSide>>>({});
const confirmation = ref<Confirmation>(null);

const files = computed(() => props.conflicts.files);
const focusedFile = computed(() =>
  files.value.find((file) => file.path === focusedPath.value) ?? files.value[0] ?? null,
);
const focusedChoices = computed(() =>
  focusedFile.value ? choicesByPath.value[focusedFile.value.path] ?? {} : {},
);
const activeOperationCopy = computed(() => operationCopy[props.conflicts.operation] ?? null);
const operationSupported = computed(() => activeOperationCopy.value !== null);
const operationActive = computed(() => props.conflicts.operation !== "none");
const canContinue = computed(() => operationSupported.value && files.value.length === 0);
const canResolve = computed(() => {
  const file = focusedFile.value;
  if (!file || file.binary || !file.hunks.length) return false;
  return file.hunks.every((hunk) => Boolean(focusedChoices.value[hunk.id]));
});
const operationTitle = computed(() => activeOperationCopy.value?.title ?? "冲突处理");
const operationSummary = computed(() => {
  if (files.value.length) return `剩余 ${files.value.length} 个冲突文件`;
  if (operationActive.value) return "冲突文件已处理，可以继续当前操作";
  return "当前没有待处理冲突";
});
const continueLabel = computed(() => activeOperationCopy.value?.continue ?? "继续操作");
const abortLabel = computed(() => {
  const base = activeOperationCopy.value?.abort ?? "终止操作";
  return confirmation.value?.kind === "abort" ? `确认${base}` : base;
});

watch(
  files,
  (nextFiles) => {
    const nextChoices: Record<string, Record<string, ConflictSide>> = {};
    for (const file of nextFiles) {
      const current = choicesByPath.value[file.path] ?? {};
      nextChoices[file.path] = Object.fromEntries(
        file.hunks
          .filter((hunk) => Boolean(current[hunk.id]))
          .map((hunk) => [hunk.id, current[hunk.id]]),
      );
    }
    choicesByPath.value = nextChoices;
    if (!nextFiles.some((file) => file.path === focusedPath.value)) {
      focusedPath.value = nextFiles[0]?.path ?? null;
    }
    resetConfirmations();
  },
  { immediate: true },
);

watch(
  () => props.open,
  (open) => {
    if (open) return;
    focusedPath.value = null;
    choicesByPath.value = {};
    resetConfirmations();
  },
);

function resetConfirmations() {
  confirmation.value = null;
}

function focusFile(file: DeepReadonly<RepoConflictFile>) {
  if (props.actionRunning) return;
  focusedPath.value = file.path;
  resetConfirmations();
}

function pickHunk(hunkId: string, side: ConflictSide) {
  const file = focusedFile.value;
  if (!file || props.actionRunning) return;
  choicesByPath.value = {
    ...choicesByPath.value,
    [file.path]: {
      ...(choicesByPath.value[file.path] ?? {}),
      [hunkId]: side,
    },
  };
  confirmation.value = null;
}

function resolveFocusedFile() {
  const file = focusedFile.value;
  if (!file || !canResolve.value || props.actionRunning) return;
  emit("resolveFile", {
    path: file.path,
    choices: file.hunks.map((hunk) => ({
      hunkId: hunk.id,
      side: focusedChoices.value[hunk.id],
    })),
  });
}

function acceptFocusedFile(side: ConflictSide) {
  const file = focusedFile.value;
  if (!file || props.actionRunning) return;
  if (confirmation.value?.kind !== "accept" || confirmation.value.side !== side) {
    confirmation.value = { kind: "accept", side };
    return;
  }
  emit("acceptFile", { path: file.path, side });
  confirmation.value = null;
}

function markFocusedResolved() {
  const file = focusedFile.value;
  if (!file || props.actionRunning) return;
  emit("markResolved", file.path);
  resetConfirmations();
}

function requestAbort() {
  if (!operationSupported.value || props.actionRunning) return;
  if (confirmation.value?.kind !== "abort") {
    confirmation.value = { kind: "abort" };
    return;
  }
  emit("abort");
  confirmation.value = null;
}

function close() {
  if (!props.actionRunning) emit("close");
}

function fileAgentId(path: string) {
  return `repo.conflicts.file.${encodeURIComponent(path)}`;
}

function hunkAgentId(path: string, hunkId: string, side: ConflictSide) {
  return `repo.conflicts.hunk.${encodeURIComponent(path)}.${encodeURIComponent(hunkId)}.${side}`;
}

function wholeFileLabel(file: DeepReadonly<RepoConflictFile>, side: ConflictSide) {
  const hunk = file.hunks[0];
  const label = side === "ours" ? hunk?.oursLabel : hunk?.theirsLabel;
  return label || side;
}

function sideLabel(hunk: DeepReadonly<RepoConflictHunk>, side: ConflictSide) {
  return side === "ours" ? hunk.oursLabel : hunk.theirsLabel;
}

function sideLines(hunk: DeepReadonly<RepoConflictHunk>, side: ConflictSide) {
  return side === "ours" ? hunk.oursLines : hunk.theirsLines;
}
</script>

<template>
  <RepoSyncDialogShell
    :open="open"
    title-id="repo-conflicts-title"
    agent-id="repo.conflicts.dialog"
    card-class="repo-conflicts-dialog"
    :close-disabled="actionRunning"
    @close="close"
  >
    <header class="conflicts-dialog__header">
      <span class="conflicts-dialog__icon" aria-hidden="true">
        <TriangleAlert :size="20" />
      </span>
      <div class="conflicts-dialog__heading">
        <h2 id="repo-conflicts-title">{{ operationTitle }}</h2>
        <p>{{ operationSummary }}</p>
      </div>
      <button
        type="button"
        class="ghost conflicts-dialog__close"
        aria-label="关闭冲突处理"
        data-agent-id="repo.conflicts.close"
        :disabled="actionRunning"
        @click="close"
      >
        <X :size="16" aria-hidden="true" />
      </button>
    </header>

    <p v-if="error" class="conflicts-dialog__error" role="alert">
      <TriangleAlert :size="15" aria-hidden="true" />
      <span>{{ error }}</span>
    </p>

    <div v-if="files.length" class="conflicts-dialog__workspace">
      <aside class="conflicts-dialog__files" aria-label="冲突文件">
        <div class="conflicts-dialog__section-title">
          <strong>冲突文件</strong>
          <span>{{ files.length }}</span>
        </div>
        <div class="conflicts-dialog__file-list" role="list">
          <button
            v-for="file in files"
            :key="file.path"
            type="button"
            class="conflicts-dialog__file"
            :class="{ 'is-active': focusedFile?.path === file.path }"
            :aria-current="focusedFile?.path === file.path ? 'true' : undefined"
            :data-agent-id="fileAgentId(file.path)"
            :disabled="actionRunning"
            @click="focusFile(file)"
          >
            <span>{{ file.path }}</span>
            <small>{{ file.status }} · {{ file.binary ? "文件级处理" : `${file.hunks.length} 个冲突块` }}</small>
          </button>
        </div>
      </aside>

      <section v-if="focusedFile" class="conflicts-dialog__editor" aria-label="冲突内容">
        <div class="conflicts-dialog__file-head">
          <div>
            <strong>{{ focusedFile.path }}</strong>
            <span v-if="focusedFile.binary">该文件无法作为文本读取，请使用整文件操作或在外部处理。</span>
            <span v-else-if="!focusedFile.hunks.length">未找到可分段处理的冲突标记，请使用整文件操作或在外部处理。</span>
            <span v-else>为每个冲突块选择要保留的版本。</span>
          </div>
          <span class="conflicts-dialog__file-status">{{ focusedFile.status }}</span>
        </div>

        <div v-if="focusedFile.hunks.length && !focusedFile.binary" class="conflicts-dialog__hunks">
          <article v-for="hunk in focusedFile.hunks" :key="hunk.id" class="conflicts-dialog__hunk">
            <header>
              <strong>{{ hunk.id }}</strong>
              <span>第 {{ hunk.startLine }}–{{ hunk.endLine }} 行</span>
            </header>
            <div class="conflicts-dialog__sides">
              <section
                v-for="side in conflictSides"
                :key="side"
                class="conflicts-dialog__side"
                :class="{ 'is-selected': focusedChoices[hunk.id] === side }"
              >
                <div class="conflicts-dialog__side-head">
                  <strong :title="sideLabel(hunk, side)">{{ sideLabel(hunk, side) }}</strong>
                  <button
                    type="button"
                    class="ghost"
                    :aria-pressed="focusedChoices[hunk.id] === side"
                    :data-agent-id="hunkAgentId(focusedFile.path, hunk.id, side)"
                    :disabled="actionRunning"
                    @click="pickHunk(hunk.id, side)"
                  >
                    {{ focusedChoices[hunk.id] === side ? "已选择" : "采用此版本" }}
                  </button>
                </div>
                <pre><code>{{ sideLines(hunk, side).join("\n") || " " }}</code></pre>
              </section>
            </div>
          </article>
        </div>

        <div v-else class="conflicts-dialog__file-only">
          <FileWarning :size="24" aria-hidden="true" />
          <p>此文件需要采用一侧的完整版本，或在外部编辑完成后标记为已解决。</p>
        </div>

        <div class="conflicts-dialog__file-actions">
          <button
            v-if="focusedFile.hunks.length && !focusedFile.binary"
            type="button"
            class="primary"
            data-agent-id="repo.conflicts.resolve"
            :disabled="actionRunning || !canResolve"
            @click="resolveFocusedFile"
          >
            <Check :size="14" aria-hidden="true" />
            解决并暂存
          </button>
          <button
            v-for="side in conflictSides"
            :key="side"
            type="button"
            class="ghost"
            :data-agent-id="`repo.conflicts.accept.${side}`"
            :disabled="actionRunning"
            @click="acceptFocusedFile(side)"
          >
            {{ confirmation?.kind === "accept" && confirmation.side === side ? "确认采用" : "整文件采用" }}
            {{ wholeFileLabel(focusedFile, side) }}
          </button>
          <button
            type="button"
            class="ghost"
            data-agent-id="repo.conflicts.mark-resolved"
            :disabled="actionRunning"
            @click="markFocusedResolved"
          >
            已在外部处理，标记解决
          </button>
        </div>
      </section>
    </div>

    <div v-else class="conflicts-dialog__resolved">
      <Check :size="28" aria-hidden="true" />
      <div>
        <strong>{{ operationActive ? "冲突文件已全部处理" : "没有待处理冲突" }}</strong>
        <p v-if="operationActive">继续当前 Git 操作以完成冲突处理。</p>
        <p v-else>可以关闭此卡片。</p>
      </div>
    </div>

    <footer class="conflicts-dialog__footer">
      <button
        v-if="operationActive"
        type="button"
        class="ghost danger"
        data-agent-id="repo.conflicts.abort"
        :title="operationSupported ? undefined : `不支持终止 ${conflicts.operation} 操作`"
        :disabled="actionRunning || !operationSupported"
        @click="requestAbort"
      >
        <TriangleAlert :size="14" aria-hidden="true" />
        {{ abortLabel }}
      </button>
      <button
        type="button"
        class="ghost conflicts-dialog__footer-close"
        data-agent-id="repo.conflicts.footer.close"
        :disabled="actionRunning"
        @click="close"
      >
        关闭
      </button>
      <button
        v-if="operationActive"
        type="button"
        class="primary"
        data-agent-id="repo.conflicts.continue"
        :title="operationSupported ? undefined : `不支持继续 ${conflicts.operation} 操作`"
        :disabled="actionRunning || !canContinue"
        @click="emit('continue')"
      >
        <LoaderCircle v-if="actionRunning" class="conflicts-dialog__spinner" :size="14" aria-hidden="true" />
        <Check v-else :size="14" aria-hidden="true" />
        {{ continueLabel }}
      </button>
    </footer>
  </RepoSyncDialogShell>
</template>

<style scoped>
:deep(.repo-conflicts-dialog) {
  display: flex;
  flex-direction: column;
  width: min(1080px, calc(100vw - 32px));
  max-height: min(780px, calc(100vh - 32px));
  overflow: hidden;
}

.conflicts-dialog__header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-soft);
}

.conflicts-dialog__icon {
  display: grid;
  place-items: center;
  color: var(--warn);
}

.conflicts-dialog__heading,
.conflicts-dialog__file-head > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.conflicts-dialog__heading h2,
.conflicts-dialog__heading p,
.conflicts-dialog__file-head strong,
.conflicts-dialog__file-head span,
.conflicts-dialog__resolved p {
  margin: 0;
}

.conflicts-dialog__heading h2 {
  font-size: 16px;
  font-weight: 650;
}

.conflicts-dialog__heading p,
.conflicts-dialog__file-head span,
.conflicts-dialog__resolved p {
  color: var(--text-muted);
  font-size: 12px;
}

.conflicts-dialog__close {
  display: grid;
  width: 30px;
  min-width: 30px;
  padding: 0;
  place-items: center;
}

.conflicts-dialog__error {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 8px;
  margin: 10px 12px 0;
  padding: 9px 10px;
  border: 1px solid var(--err-soft);
  border-radius: var(--radius-sm);
  background: var(--err-soft);
  color: var(--err);
  font-size: 12px;
}

.conflicts-dialog__workspace {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: minmax(190px, 240px) minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
}

.conflicts-dialog__files,
.conflicts-dialog__editor {
  min-height: 0;
  overflow: auto;
}

.conflicts-dialog__files {
  padding: 12px;
  border-right: 1px solid var(--border-soft);
  background: var(--bg-subtle);
}

.conflicts-dialog__section-title,
.conflicts-dialog__file-head,
.conflicts-dialog__hunk > header,
.conflicts-dialog__side-head,
.conflicts-dialog__file-actions,
.conflicts-dialog__footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.conflicts-dialog__section-title {
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
}

.conflicts-dialog__section-title span,
.conflicts-dialog__file-status {
  color: var(--text-muted);
  font-size: 11px;
}

.conflicts-dialog__file-list,
.conflicts-dialog__hunks {
  display: grid;
  gap: 8px;
}

.conflicts-dialog__file {
  display: grid;
  gap: 3px;
  width: 100%;
  min-height: 48px;
  padding: 8px 9px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  text-align: left;
  transition: border-color 0.12s ease, background-color 0.12s ease;
}

.conflicts-dialog__file:hover:not(:disabled) {
  background: var(--bg-hover);
}

.conflicts-dialog__file.is-active {
  border-color: var(--border-strong);
  background: var(--bg-active);
}

.conflicts-dialog__file span,
.conflicts-dialog__file small {
  overflow-wrap: anywhere;
}

.conflicts-dialog__file span {
  font-size: 12px;
  font-weight: 600;
}

.conflicts-dialog__file small {
  color: var(--text-muted);
  font-size: 11px;
}

.conflicts-dialog__editor {
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 14px;
}

.conflicts-dialog__file-head,
.conflicts-dialog__hunk > header,
.conflicts-dialog__side-head {
  justify-content: space-between;
  min-width: 0;
}

.conflicts-dialog__file-head strong {
  overflow-wrap: anywhere;
  font-size: 13px;
}

.conflicts-dialog__hunk {
  display: grid;
  gap: 9px;
  padding: 10px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
}

.conflicts-dialog__hunk > header {
  font-size: 12px;
}

.conflicts-dialog__hunk > header span {
  color: var(--text-muted);
  font-size: 11px;
}

.conflicts-dialog__sides {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.conflicts-dialog__side {
  display: grid;
  grid-template-rows: auto minmax(80px, auto);
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg);
  transition: border-color 0.12s ease, background-color 0.12s ease;
}

.conflicts-dialog__side.is-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.conflicts-dialog__side-head strong {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conflicts-dialog__side pre {
  min-width: 0;
  max-height: 240px;
  margin: 8px 0 0;
  padding: 8px;
  overflow: auto;
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
  color: var(--text);
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre;
}

.conflicts-dialog__file-only,
.conflicts-dialog__resolved {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 180px;
  color: var(--text-muted);
  text-align: center;
}

.conflicts-dialog__file-only p,
.conflicts-dialog__resolved strong {
  margin: 0;
}

.conflicts-dialog__file-only p {
  max-width: 420px;
  font-size: 12px;
}

.conflicts-dialog__resolved {
  flex: 1 1 auto;
  padding: 32px 18px;
  color: var(--ok);
}

.conflicts-dialog__resolved > div {
  display: grid;
  gap: 4px;
  color: var(--text);
  text-align: left;
}

.conflicts-dialog__file-actions {
  flex-wrap: wrap;
  padding-top: 2px;
}

.conflicts-dialog__file-actions button,
.conflicts-dialog__footer button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.conflicts-dialog__footer {
  padding: 11px 14px;
  border-top: 1px solid var(--border-soft);
}

.conflicts-dialog__footer-close {
  margin-left: auto;
}

.conflicts-dialog__footer .danger {
  color: var(--err);
}

.conflicts-dialog__footer .danger:hover:not(:disabled) {
  border-color: var(--err);
  background: var(--err-soft);
  color: var(--err);
}

.conflicts-dialog__spinner {
  animation: conflicts-dialog-spin 0.8s linear infinite;
}

@keyframes conflicts-dialog-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 820px) {
  :deep(.repo-conflicts-dialog) {
    max-height: calc(100vh - 16px);
  }

  .conflicts-dialog__workspace {
    grid-template-columns: 1fr;
    overflow: auto;
  }

  .conflicts-dialog__files {
    max-height: 180px;
    border-right: 0;
    border-bottom: 1px solid var(--border-soft);
  }

  .conflicts-dialog__editor {
    overflow: visible;
  }

  .conflicts-dialog__sides {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .conflicts-dialog__file,
  .conflicts-dialog__side {
    transition: none;
  }

  .conflicts-dialog__spinner {
    animation: none;
  }
}
</style>

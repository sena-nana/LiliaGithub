<script setup lang="ts">
import { computed, ref, watch, type DeepReadonly } from "vue";
import {
  Check,
  FileWarning,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
} from "@lucide/vue";
import type {
  CommitDiffHunk,
  RepoConflictChoice,
  RepoConflictFile,
  RepoConflictHunk,
  RepoConflictState,
  RepoFilePreview,
} from "../../services/workspace";
import { applyConflictChoices, conflictMarkerCount } from "./conflictEditor";
import DiffCodeRenderer from "./DiffCodeRenderer.vue";
import RepoSyncDialogShell from "./RepoSyncDialogShell.vue";

type ConflictSide = RepoConflictChoice["side"];
type ConflictViewMode = "diff" | "editor";
type OperationCopy = { title: string; continue: string; abort: string };
type Confirmation =
  | { kind: "accept"; side: ConflictSide }
  | { kind: "abort" }
  | { kind: "reload"; path: string }
  | null;
type EditSession = {
  expectedContent: string;
  draft: string;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  unavailableReason: string | null;
  manual: boolean;
};

const MAX_EDITABLE_FILE_SIZE = 1024 * 1024;

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
  loadFileContent: (path: string) => Promise<RepoFilePreview>;
}>();

const emit = defineEmits<{
  close: [];
  resolveFile: [payload: { path: string; choices: RepoConflictChoice[] }];
  acceptFile: [payload: { path: string; side: ConflictSide }];
  saveFile: [payload: { path: string; content: string; expectedContent: string }];
  markResolved: [path: string];
  continue: [];
  abort: [];
}>();

const focusedPath = ref<string | null>(null);
const choicesByPath = ref<Record<string, Record<string, ConflictSide>>>({});
const editSessions = ref<Record<string, EditSession>>({});
const viewMode = ref<ConflictViewMode>("diff");
const confirmation = ref<Confirmation>(null);
const confirmClose = ref(false);
const loadRequestIds = new Map<string, number>();

const files = computed(() => props.conflicts.files);
const focusedFile = computed(() =>
  files.value.find((file) => file.path === focusedPath.value) ?? files.value[0] ?? null,
);
const focusedChoices = computed(() =>
  focusedFile.value ? choicesByPath.value[focusedFile.value.path] ?? {} : {},
);
const focusedSession = computed(() =>
  focusedFile.value ? editSessions.value[focusedFile.value.path] ?? null : null,
);
const focusedMarkerCount = computed(() => conflictMarkerCount(focusedSession.value?.draft ?? ""));
const activeOperationCopy = computed(() => operationCopy[props.conflicts.operation] ?? null);
const operationSupported = computed(() => activeOperationCopy.value !== null);
const operationActive = computed(() => props.conflicts.operation !== "none");
const canContinue = computed(() => operationSupported.value && files.value.length === 0);
const canResolve = computed(() => {
  const file = focusedFile.value;
  if (!file || file.binary || !file.hunks.length || focusedSession.value?.manual) return false;
  return file.hunks.every((hunk) => Boolean(focusedChoices.value[hunk.id]));
});
const canSaveEditor = computed(() => {
  const session = focusedSession.value;
  return Boolean(
    session?.loaded
      && !session.loading
      && !session.error
      && !session.unavailableReason
      && focusedMarkerCount.value === 0
      && !props.actionRunning,
  );
});
const hasDirtyDrafts = computed(() =>
  Object.values(editSessions.value).some((session) =>
    session.loaded && !session.unavailableReason && session.draft !== session.expectedContent
  ),
);
const operationTitle = computed(() => activeOperationCopy.value?.title ?? "冲突处理");
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
    editSessions.value = Object.fromEntries(
      Object.entries(editSessions.value).filter(([path]) => nextFiles.some((file) => file.path === path)),
    );
    if (!nextFiles.some((file) => file.path === focusedPath.value)) {
      const nextFocusedFile = nextFiles[0] ?? null;
      focusedPath.value = nextFocusedFile?.path ?? null;
      alignViewMode(nextFocusedFile);
    }
    if (!hasDirtyDrafts.value) confirmClose.value = false;
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
    editSessions.value = {};
    viewMode.value = "diff";
    confirmClose.value = false;
    loadRequestIds.clear();
    resetConfirmations();
  },
);

watch(
  () => [props.open, viewMode.value, focusedFile.value?.path] as const,
  ([open, mode]) => {
    if (!open || mode !== "editor" || !focusedFile.value) return;
    void ensureEditSession(focusedFile.value);
  },
  { immediate: true },
);

function resetConfirmations() {
  confirmation.value = null;
}

function focusFile(file: DeepReadonly<RepoConflictFile>) {
  if (props.actionRunning) return;
  focusedPath.value = file.path;
  alignViewMode(file);
  resetConfirmations();
}

function alignViewMode(file: DeepReadonly<RepoConflictFile> | null) {
  if (file?.binary) viewMode.value = "diff";
  else if (file && !file.hunks.length) viewMode.value = "editor";
}

function pickHunk(hunkId: string, side: ConflictSide) {
  const file = focusedFile.value;
  if (!file || props.actionRunning || focusedSession.value?.manual) return;
  choicesByPath.value = {
    ...choicesByPath.value,
    [file.path]: {
      ...(choicesByPath.value[file.path] ?? {}),
      [hunkId]: side,
    },
  };
  regenerateDraft(file);
  confirmation.value = null;
}

function setViewMode(mode: ConflictViewMode) {
  if (props.actionRunning || mode === viewMode.value) return;
  if (mode === "diff" && focusedSession.value?.manual) return;
  if (mode === "editor" && focusedFile.value?.binary) return;
  viewMode.value = mode;
  confirmClose.value = false;
  resetConfirmations();
}

async function ensureEditSession(file: DeepReadonly<RepoConflictFile>, force = false) {
  const currentSession = editSessions.value[file.path];
  if (file.binary || (!force && (currentSession?.loaded || currentSession?.loading))) return;
  const requestId = (loadRequestIds.get(file.path) ?? 0) + 1;
  loadRequestIds.set(file.path, requestId);
  const previous = editSessions.value[file.path];
  setEditSession(file.path, {
    expectedContent: previous?.expectedContent ?? "",
    draft: previous?.draft ?? "",
    loaded: previous?.loaded ?? false,
    loading: true,
    error: null,
    unavailableReason: previous?.unavailableReason ?? null,
    manual: previous?.manual ?? false,
  });
  try {
    const preview = await props.loadFileContent(file.path);
    if (!isFileLoadCurrent(file.path, requestId)) return;
    const unavailableReason = previewUnavailableReason(preview);
    const expectedContent = preview.content ?? "";
    setEditSession(file.path, {
      expectedContent,
      draft: unavailableReason
        ? expectedContent
        : applyConflictChoices(expectedContent, file.hunks, choicesByPath.value[file.path] ?? {}),
      loaded: true,
      loading: false,
      error: null,
      unavailableReason,
      manual: false,
    });
  } catch (reason) {
    if (!isFileLoadCurrent(file.path, requestId)) return;
    setEditSession(file.path, {
      ...editSessions.value[file.path],
      loading: false,
      error: String(reason).replace(/^Error:\s*/, ""),
    });
  }
}

function isFileLoadCurrent(path: string, requestId: number) {
  return loadRequestIds.get(path) === requestId
    && props.open
    && files.value.some((file) => file.path === path);
}

function previewUnavailableReason(preview: RepoFilePreview) {
  if (preview.previewKind === "tooLarge" || preview.truncated || preview.size > MAX_EDITABLE_FILE_SIZE) {
    return "文件超过 1 MiB，无法在应用内编辑";
  }
  if (preview.previewKind !== "text" && preview.previewKind !== "markdown") {
    return "该文件不是可编辑文本";
  }
  if (typeof preview.content !== "string") return "无法读取完整文本内容";
  return null;
}

function setEditSession(path: string, session: EditSession) {
  editSessions.value = { ...editSessions.value, [path]: session };
}

function regenerateDraft(file: DeepReadonly<RepoConflictFile>) {
  const session = editSessions.value[file.path];
  if (!session?.loaded || session.manual || session.unavailableReason) return;
  setEditSession(file.path, {
    ...session,
    draft: applyConflictChoices(session.expectedContent, file.hunks, choicesByPath.value[file.path] ?? {}),
  });
}

function updateDraft(content: string) {
  const file = focusedFile.value;
  const session = focusedSession.value;
  if (!file || !session?.loaded || session.unavailableReason || props.actionRunning) return;
  setEditSession(file.path, { ...session, draft: content, manual: true });
  confirmClose.value = false;
  resetConfirmations();
}

function updateDraftFromEvent(event: Event) {
  updateDraft((event.target as HTMLTextAreaElement).value);
}

function discardDraft() {
  const file = focusedFile.value;
  const session = focusedSession.value;
  if (!file || !session?.loaded || props.actionRunning) return;
  setEditSession(file.path, {
    ...session,
    draft: applyConflictChoices(session.expectedContent, file.hunks, choicesByPath.value[file.path] ?? {}),
    manual: false,
    error: null,
  });
  confirmClose.value = false;
}

function reloadDraft() {
  const file = focusedFile.value;
  const session = focusedSession.value;
  if (!file || !session || props.actionRunning) return;
  if (
    session.draft !== session.expectedContent
    && (confirmation.value?.kind !== "reload" || confirmation.value.path !== file.path)
  ) {
    confirmation.value = { kind: "reload", path: file.path };
    return;
  }
  confirmClose.value = false;
  resetConfirmations();
  void ensureEditSession(file, true);
}

function saveDraft() {
  const file = focusedFile.value;
  const session = focusedSession.value;
  if (!file || !session || !canSaveEditor.value) return;
  emit("saveFile", {
    path: file.path,
    content: session.draft,
    expectedContent: session.expectedContent,
  });
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
  if (props.actionRunning) return;
  if (hasDirtyDrafts.value) {
    confirmClose.value = true;
    return;
  }
  emit("close");
}

function discardAndClose() {
  if (props.actionRunning) return;
  editSessions.value = {};
  choicesByPath.value = {};
  confirmClose.value = false;
  emit("close");
}

function fileAgentId(path: string) {
  return `repo.conflicts.file.${encodeURIComponent(path)}`;
}

function fileConflictLabel(file: DeepReadonly<RepoConflictFile>) {
  return file.binary ? "二进制" : `${file.hunks.length} 处`;
}

function fileAriaLabel(file: DeepReadonly<RepoConflictFile>) {
  return `${file.path}，${file.status}，${file.binary ? "二进制冲突" : `${file.hunks.length} 个冲突块`}`;
}

function hunkAgentId(path: string, hunkId: string, side: ConflictSide) {
  return `repo.conflicts.hunk.${encodeURIComponent(path)}.${encodeURIComponent(hunkId)}.${side}`;
}

function sideLabel(side: ConflictSide, hunk?: DeepReadonly<RepoConflictHunk>) {
  return (side === "ours" ? hunk?.oursLabel : hunk?.theirsLabel) || side;
}

function conflictDiffHunk(hunk: DeepReadonly<RepoConflictHunk>): CommitDiffHunk {
  return {
    header: "",
    oldStart: hunk.startLine,
    oldLines: hunk.oursLines.length,
    newStart: hunk.startLine,
    newLines: hunk.theirsLines.length,
    lines: [
      ...hunk.oursLines.map((content, index) => ({
        kind: "deleted" as const,
        content,
        oldLine: hunk.startLine + index,
        newLine: null,
      })),
      ...hunk.theirsLines.map((content, index) => ({
        kind: "added" as const,
        content,
        oldLine: null,
        newLine: hunk.startLine + index,
      })),
    ],
  };
}
</script>

<template>
  <RepoSyncDialogShell
    :open="open"
    :title="operationTitle"
    agent-id="repo.conflicts.dialog"
    close-agent-id="repo.conflicts.close"
    close-label="关闭冲突处理"
    size="workspace"
    :close-disabled="actionRunning"
    @close="close"
  >
    <div class="repo-conflicts-dialog">
    <p v-if="error" class="conflicts-dialog__error" role="alert">
      <TriangleAlert :size="15" aria-hidden="true" />
      <span>{{ error }}</span>
    </p>

    <div v-if="files.length" class="conflicts-dialog__workspace">
      <aside class="conflicts-dialog__files" aria-label="冲突文件">
        <div class="conflicts-dialog__file-list" role="list">
          <button
            v-for="file in files"
            :key="file.path"
            type="button"
            class="conflicts-dialog__file"
            :class="{ 'is-active': focusedFile?.path === file.path }"
            :aria-current="focusedFile?.path === file.path ? 'true' : undefined"
            :aria-label="fileAriaLabel(file)"
            :title="file.path"
            :data-agent-id="fileAgentId(file.path)"
            :disabled="actionRunning"
            @click="focusFile(file)"
          >
            <span class="conflicts-dialog__file-status" aria-hidden="true">{{ file.status }}</span>
            <span class="conflicts-dialog__file-path">{{ file.path }}</span>
            <span class="conflicts-dialog__file-meta" aria-hidden="true">{{ fileConflictLabel(file) }}</span>
          </button>
        </div>
      </aside>

      <section v-if="focusedFile" class="conflicts-dialog__editor" aria-label="冲突内容">
        <div class="conflicts-dialog__file-head">
          <strong :title="focusedFile.path">{{ focusedFile.path }}</strong>
          <div class="conflicts-dialog__head-actions">
            <span
              v-if="viewMode === 'editor' && focusedMarkerCount"
              class="conflicts-dialog__marker-count"
            >{{ focusedMarkerCount }} 处未解决</span>
            <div class="conflicts-dialog__mode" aria-label="冲突文件视图">
              <button
                type="button"
                :class="{ 'is-active': viewMode === 'diff' }"
                :aria-pressed="viewMode === 'diff'"
                data-agent-id="repo.conflicts.mode.diff"
                :disabled="actionRunning || Boolean(focusedSession?.manual)"
                @click="setViewMode('diff')"
              >差异</button>
              <button
                type="button"
                :class="{ 'is-active': viewMode === 'editor' }"
                :aria-pressed="viewMode === 'editor'"
                data-agent-id="repo.conflicts.mode.edit"
                :disabled="actionRunning || focusedFile.binary"
                @click="setViewMode('editor')"
              >编辑结果</button>
            </div>
          </div>
        </div>

        <div
          v-if="viewMode === 'diff' && focusedFile.hunks.length && !focusedFile.binary"
          class="conflicts-dialog__hunks"
        >
          <article v-for="hunk in focusedFile.hunks" :key="hunk.id" class="conflicts-dialog__hunk">
            <header>
              <span>第 {{ hunk.startLine }}–{{ hunk.endLine }} 行</span>
              <div class="conflicts-dialog__hunk-actions">
                <button
                  v-for="side in conflictSides"
                  :key="side"
                  type="button"
                  class="ghost"
                  :class="{ 'is-selected': focusedChoices[hunk.id] === side }"
                  :aria-pressed="focusedChoices[hunk.id] === side"
                  :data-agent-id="hunkAgentId(focusedFile.path, hunk.id, side)"
                  :disabled="actionRunning || focusedSession?.manual"
                  @click="pickHunk(hunk.id, side)"
                >
                  {{ focusedChoices[hunk.id] === side ? "已采用" : "采用" }} {{ sideLabel(side, hunk) }}
                </button>
              </div>
            </header>
            <div class="conflicts-dialog__diff-code">
              <DiffCodeRenderer
                :file-path="focusedFile.path"
                :hunks="[conflictDiffHunk(hunk)]"
                mode="hunks"
              />
            </div>
          </article>
        </div>

        <div v-else-if="viewMode === 'diff'" class="conflicts-dialog__file-only">
          <FileWarning :size="24" aria-hidden="true" />
          <p>{{ focusedFile.binary ? "二进制文件不可预览" : "没有可显示的冲突块" }}</p>
        </div>

        <div v-else class="conflicts-dialog__edit-result">
          <p v-if="focusedSession?.loading" class="conflicts-dialog__editor-notice" role="status">
            <LoaderCircle class="conflicts-dialog__spinner" :size="14" aria-hidden="true" />
            正在读取最新文件内容…
          </p>
          <p v-if="focusedSession?.error" class="conflicts-dialog__editor-notice is-error" role="alert">
            <TriangleAlert :size="14" aria-hidden="true" />
            {{ focusedSession.error }}
          </p>
          <div v-if="focusedSession?.unavailableReason" class="conflicts-dialog__file-only">
            <FileWarning :size="24" aria-hidden="true" />
            <p>{{ focusedSession.unavailableReason }}</p>
          </div>
          <textarea
            v-else-if="focusedSession?.loaded"
            class="conflicts-dialog__textarea is-selectable"
            :value="focusedSession.draft"
            aria-label="冲突文件编辑结果"
            data-agent-id="repo.conflicts.editor"
            :disabled="actionRunning || focusedSession.loading"
            :spellcheck="false"
            wrap="off"
            @input="updateDraftFromEvent"
          />
        </div>

        <div class="conflicts-dialog__file-actions">
          <button
            v-if="viewMode === 'diff' && focusedFile.hunks.length && !focusedFile.binary"
            type="button"
            class="primary"
            data-agent-id="repo.conflicts.resolve"
            :disabled="actionRunning || !canResolve"
            @click="resolveFocusedFile"
          >
            <Check :size="14" aria-hidden="true" />
            解决并暂存
          </button>
          <template v-if="viewMode === 'editor'">
            <button
              type="button"
              class="primary"
              data-agent-id="repo.conflicts.editor.save"
              :disabled="!canSaveEditor"
              @click="saveDraft"
            >
              <LoaderCircle v-if="actionRunning" class="conflicts-dialog__spinner" :size="14" aria-hidden="true" />
              <Check v-else :size="14" aria-hidden="true" />
              保存并暂存
            </button>
            <button
              type="button"
              class="ghost"
              data-agent-id="repo.conflicts.editor.discard"
              :disabled="actionRunning || !focusedSession?.manual"
              @click="discardDraft"
            >放弃编辑</button>
            <button
              type="button"
              class="ghost"
              data-agent-id="repo.conflicts.editor.reload"
              :disabled="actionRunning || focusedSession?.loading"
              @click="reloadDraft"
            >
              <RefreshCw :size="14" aria-hidden="true" />
              {{ confirmation?.kind === "reload" && confirmation.path === focusedFile.path ? "确认重新读取" : "重新读取" }}
            </button>
          </template>
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
            {{ sideLabel(side, focusedFile.hunks[0]) }}
          </button>
          <button
            type="button"
            class="ghost"
            data-agent-id="repo.conflicts.mark-resolved"
            :disabled="actionRunning || Boolean(focusedSession?.loaded && focusedSession.draft !== focusedSession.expectedContent)"
            @click="markFocusedResolved"
          >
            标记已解决
          </button>
        </div>
      </section>
    </div>

    <div v-else class="conflicts-dialog__resolved">
      <Check :size="28" aria-hidden="true" />
      <strong>{{ operationActive ? "冲突文件已全部处理" : "没有待处理冲突" }}</strong>
    </div>
    </div>

    <template #actions>
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
        v-if="confirmClose"
        type="button"
        class="ghost"
        @click="confirmClose = false"
      >继续编辑</button>
      <button
        v-if="confirmClose"
        type="button"
        class="ghost danger"
        data-agent-id="repo.conflicts.discard-close"
        @click="discardAndClose"
      >放弃并关闭</button>
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
    </template>
  </RepoSyncDialogShell>
</template>

<style scoped>
.repo-conflicts-dialog {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: min(620px, calc(100vh - 180px));
  overflow: hidden;
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

.conflicts-dialog__files {
  min-height: 0;
  overflow: auto;
  padding: 8px;
  border-right: 1px solid var(--border-soft);
  background: var(--bg-subtle);
}

.conflicts-dialog__file-head,
.conflicts-dialog__hunk > header,
.conflicts-dialog__file-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.conflicts-dialog__file-list,
.conflicts-dialog__hunks {
  display: grid;
  align-content: start;
}

.conflicts-dialog__file {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 28px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  text-align: left;
  transition: background-color 0.12s ease;
}

.conflicts-dialog__file:hover:not(:disabled) {
  background: var(--bg-hover);
}

.conflicts-dialog__file.is-active {
  background: var(--bg-active);
}

.conflicts-dialog__file.is-active .conflicts-dialog__file-path {
  font-weight: 600;
}

.conflicts-dialog__file-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 16px;
  border-radius: 3px;
  background: var(--warn-soft);
  color: var(--warn);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
}

.conflicts-dialog__file-path {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conflicts-dialog__file-meta {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.conflicts-dialog__editor {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 12px;
  padding: 12px;
  min-height: 0;
  overflow: hidden;
}

.conflicts-dialog__hunks {
  gap: 8px;
  min-height: 0;
  overflow: auto;
}

.conflicts-dialog__file-head,
.conflicts-dialog__hunk > header {
  justify-content: space-between;
  min-width: 0;
}

.conflicts-dialog__head-actions,
.conflicts-dialog__mode,
.conflicts-dialog__hunk-actions,
.conflicts-dialog__editor-notice {
  display: flex;
  align-items: center;
  gap: 7px;
}

.conflicts-dialog__head-actions {
  flex: 0 0 auto;
}

.conflicts-dialog__marker-count {
  color: var(--warn);
  font-size: 11px;
  white-space: nowrap;
}

.conflicts-dialog__mode {
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
}

.conflicts-dialog__mode button {
  min-height: 26px;
  padding: 3px 9px;
  border: 0;
  border-radius: calc(var(--radius-sm) - 2px);
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
}

.conflicts-dialog__mode button.is-active {
  background: var(--bg-active);
  color: var(--text);
}

.conflicts-dialog__file-head strong {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conflicts-dialog__hunk {
  display: grid;
  gap: 0;
  overflow: hidden;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
}

.conflicts-dialog__hunk > header {
  padding: 8px 10px;
  background: var(--bg-subtle);
  font-size: 12px;
}

.conflicts-dialog__hunk > header span {
  color: var(--text-muted);
  font-size: 11px;
}

.conflicts-dialog__hunk-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.conflicts-dialog__hunk-actions button.is-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.conflicts-dialog__diff-code {
  min-width: 0;
  border-top: 1px solid var(--border-soft);
  background: var(--bg-elev);
}

.conflicts-dialog__edit-result {
  display: grid;
  gap: 8px;
  min-width: 0;
  min-height: 0;
}

.conflicts-dialog__textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 240px;
  margin: 0;
  padding: 9px 10px;
  resize: none;
  overflow: auto;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  outline: none;
  background: var(--bg-elev);
  color: var(--text);
  font: 12px/1.5 var(--font-mono);
  tab-size: 2;
  white-space: pre;
}

.conflicts-dialog__textarea:focus-visible {
  border-color: var(--accent);
}

.conflicts-dialog__textarea:disabled {
  background: var(--bg-subtle);
  color: var(--text-muted);
  cursor: not-allowed;
}

.conflicts-dialog__editor-notice {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.conflicts-dialog__editor-notice.is-error {
  color: var(--err);
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

.conflicts-dialog__file-only p {
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

.conflicts-dialog__resolved strong {
  margin: 0;
  color: var(--text);
}

.conflicts-dialog__file-actions {
  flex-wrap: wrap;
  padding-top: 2px;
}

.conflicts-dialog__file-actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.conflicts-dialog__spinner {
  animation: conflicts-dialog-spin 0.8s linear infinite;
}

@keyframes conflicts-dialog-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 820px) {
  .repo-conflicts-dialog {
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

  .conflicts-dialog__hunks {
    overflow: visible;
  }

  .conflicts-dialog__file-head {
    flex-wrap: wrap;
  }

  .conflicts-dialog__head-actions {
    margin-left: auto;
  }

  .conflicts-dialog__hunk > header {
    align-items: flex-start;
    flex-direction: column;
  }

  .conflicts-dialog__hunk-actions {
    justify-content: flex-start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .conflicts-dialog__file {
    transition: none;
  }

  .conflicts-dialog__spinner {
    animation: none;
  }
}
</style>

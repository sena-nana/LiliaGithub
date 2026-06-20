<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { Archive, ArchiveRestore, LoaderCircle, Plus, Trash2 } from "@lucide/vue";
import { createLatestAsyncLoader } from "../../composables/useLatestAsyncLoader";
import { createPendingTaskTracker } from "../../composables/usePendingTaskTracker";
import { useWorkspace } from "../../composables/useWorkspace";
import { getRepoStashDetail, type CommitFileChange, type RepoStashDetail, type RepoStashEntry } from "../../services/workspace";
import { commitFileStatusText } from "../../utils/repoDisplay";
import RepoDiffWorkspace from "./RepoDiffWorkspace.vue";
import type { RepoDiffWorkspaceFile, RepoDiffWorkspaceMode } from "./repoDiffWorkspace";

const props = defineProps<{
  repoId: string;
  remoteOnly: boolean;
  hasConflicts: boolean;
}>();

const workspace = useWorkspace();
const stashes = ref<RepoStashEntry[]>([]);
const selectedStashId = ref<string | null>(null);
const detail = ref<RepoStashDetail | null>(null);
const activeFilePath = ref<string | null>(null);
const loading = ref(false);
const detailLoading = ref(false);
const error = ref<string | null>(null);
const diffMode = ref<RepoDiffWorkspaceMode>("hunks");
const dropConfirmStashId = ref<string | null>(null);
const stashesLoader = createLatestAsyncLoader();
const stashDetailLoader = createLatestAsyncLoader();
const actionTracker = createPendingTaskTracker();
const actionRunning = actionTracker.running;
let actionGeneration = 0;

const selectedStash = computed(() =>
  stashes.value.find((stash) => stash.id === selectedStashId.value) ?? null,
);
const canMutate = computed(() => !props.remoteOnly && !props.hasConflicts && !actionRunning.value);
const workspaceFiles = computed<RepoDiffWorkspaceFile[]>(() =>
  (detail.value?.files ?? []).map((file) => ({
    key: `${file.oldPath ?? ""}:${file.path}`,
    path: file.path,
    oldPath: file.oldPath,
    statusLabel: commitFileStatusText(file.status),
    statusClass: `is-${file.status}`,
    statusLetter: fileStatusLetter(file.status),
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch,
    hunks: file.hunks,
  })),
);
const activeWorkspaceFile = computed(() =>
  workspaceFiles.value.find((file) => file.path === activeFilePath.value) ?? workspaceFiles.value[0] ?? null,
);
const fileCountLabel = computed(() => `${workspaceFiles.value.length} 个文件`);
const totalAdditions = computed(() =>
  detail.value?.files.reduce((sum, file) => sum + file.additions, 0) ?? 0,
);
const totalDeletions = computed(() =>
  detail.value?.files.reduce((sum, file) => sum + file.deletions, 0) ?? 0,
);

onMounted(() => {
  void loadStashes();
});

onUnmounted(() => {
  stashesLoader.invalidate();
  stashDetailLoader.invalidate();
  invalidateActions();
});

watch(() => [props.repoId, props.remoteOnly] as const, () => {
  resetStashState();
  void loadStashes();
});

watch(() => detail.value?.files, (files) => {
  activeFilePath.value = files?.[0]?.path ?? null;
});

function resetStashState() {
  stashesLoader.invalidate();
  stashDetailLoader.invalidate();
  invalidateActions();
  stashes.value = [];
  selectedStashId.value = null;
  detail.value = null;
  activeFilePath.value = null;
  dropConfirmStashId.value = null;
  error.value = null;
}

async function loadStashes() {
  if (props.remoteOnly || !props.repoId) {
    resetStashState();
    return;
  }
  const repoId = props.repoId;
  await stashesLoader.run(repoId, async (runId) => {
    loading.value = true;
    error.value = null;
    try {
      const nextStashes = await workspace.listStashes(repoId);
      if (!stashesLoader.isCurrent(runId) || repoId !== props.repoId || props.remoteOnly) return;
      stashes.value = nextStashes;
      const nextStashId = nextStashes.some((stash) => stash.id === selectedStashId.value)
        ? selectedStashId.value
        : nextStashes[0]?.id ?? null;
      selectedStashId.value = nextStashId;
      if (nextStashId) await loadStashDetail(nextStashId);
      else detail.value = null;
    } catch (err) {
      if (!stashesLoader.isCurrent(runId)) return;
      error.value = String(err);
    } finally {
      if (stashesLoader.isCurrent(runId)) {
        loading.value = false;
      }
    }
  });
}

async function loadStashDetail(stashId: string) {
  if (!props.repoId) return;
  const repoId = props.repoId;
  await stashDetailLoader.run(`${repoId}:${stashId}`, async (runId) => {
    detailLoading.value = true;
    error.value = null;
    try {
      const nextDetail = await getRepoStashDetail(repoId, stashId);
      if (
        !stashDetailLoader.isCurrent(runId) ||
        repoId !== props.repoId ||
        stashId !== selectedStashId.value
      ) return;
      detail.value = nextDetail;
    } catch (err) {
      if (!stashDetailLoader.isCurrent(runId)) return;
      error.value = String(err);
      detail.value = null;
    } finally {
      if (stashDetailLoader.isCurrent(runId)) {
        detailLoading.value = false;
      }
    }
  });
}

function invalidateActions() {
  actionGeneration += 1;
  actionTracker.reset();
}

function isActionCurrent(generation: number, repoId: string) {
  return generation === actionGeneration && repoId === props.repoId && !props.remoteOnly;
}

async function runStashAction(repoId: string, action: () => Promise<unknown>) {
  if (!repoId || props.remoteOnly) return;
  const generation = actionGeneration;
  error.value = null;
  try {
    await actionTracker.run(action);
    if (!isActionCurrent(generation, repoId)) return;
    await loadStashes();
    if (!isActionCurrent(generation, repoId)) return;
    await workspace.loadRepoDetail(repoId).catch(() => undefined);
  } catch (err) {
    if (isActionCurrent(generation, repoId)) {
      error.value = String(err);
    }
  }
}

function saveStash() {
  const message = window.prompt("stash 说明（可选）", "");
  if (message === null) return;
  const repoId = props.repoId;
  void runStashAction(repoId, () => workspace.saveStash(repoId, message));
}

function applySelectedStash() {
  const stash = selectedStash.value;
  if (!stash) return;
  const repoId = props.repoId;
  const stashId = stash.id;
  void runStashAction(repoId, () => workspace.applyStash(repoId, stashId));
}

function popSelectedStash() {
  const stash = selectedStash.value;
  if (!stash) return;
  const repoId = props.repoId;
  const stashId = stash.id;
  void runStashAction(repoId, () => workspace.popStash(repoId, stashId));
}

function dropSelectedStash() {
  const stash = selectedStash.value;
  if (!stash) return;
  if (dropConfirmStashId.value !== stash.id) {
    dropConfirmStashId.value = stash.id;
    return;
  }
  const repoId = props.repoId;
  const stashId = stash.id;
  void runStashAction(repoId, () => workspace.dropStash(repoId, stashId));
}

function selectStash(stash: RepoStashEntry) {
  if (selectedStashId.value === stash.id) return;
  selectedStashId.value = stash.id;
  dropConfirmStashId.value = null;
  activeFilePath.value = null;
  void loadStashDetail(stash.id);
}

function selectFile(file: RepoDiffWorkspaceFile) {
  activeFilePath.value = file.path;
}

function fileStatusLetter(status: CommitFileChange["status"]) {
  if (status === "renamed") return "R";
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  if (status === "copied") return "C";
  return "M";
}
</script>

<template>
  <section class="repo-stash-panel">
    <p v-if="remoteOnly" class="muted repo-empty repo-stash-panel__empty">stash 仅支持本地仓库。</p>
    <div v-else class="repo-stash-panel__shell">
      <aside class="repo-stash-panel__list" aria-label="Stash 列表">
        <header class="repo-stash-panel__head">
          <div class="repo-stash-panel__head-meta">
            <h2>Stash</h2>
            <span class="repo-stash-panel__head-count muted">{{ loading ? "正在读取" : `${stashes.length} 条` }}</span>
          </div>
          <button
            type="button"
            class="ghost button-compact"
            title="保存 stash"
            aria-label="保存 stash"
            :disabled="!canMutate"
            @click="saveStash"
          >
            <LoaderCircle v-if="actionRunning" :size="15" aria-hidden="true" class="sb-spin" />
            <Plus v-else :size="15" aria-hidden="true" />
          </button>
        </header>

        <p v-if="error" class="error-line repo-stash-panel__error">{{ error }}</p>
        <p v-if="hasConflicts" class="muted repo-stash-panel__notice">存在冲突时暂不执行 stash 操作。</p>
        <p v-if="!loading && !stashes.length" class="muted repo-stash-panel__empty">当前没有 stash。</p>
        <div v-else class="repo-stash-panel__items" role="list">
          <button
            v-for="stash in stashes"
            :key="stash.id"
            type="button"
            class="repo-stash-panel__item"
            :class="{ 'is-active': stash.id === selectedStashId }"
            :title="stash.message"
            @click="selectStash(stash)"
          >
            <span class="repo-stash-panel__item-id">{{ stash.id }}</span>
            <strong>{{ stash.message }}</strong>
            <span>{{ stash.branch || "detached" }}</span>
          </button>
        </div>
      </aside>

      <section class="repo-stash-panel__detail" aria-label="Stash 内容">
        <p v-if="detailLoading" class="muted repo-empty repo-stash-panel__empty repo-stash-panel__detail-empty">正在读取 stash 内容。</p>
        <p v-else-if="!selectedStash" class="muted repo-empty repo-stash-panel__empty repo-stash-panel__detail-empty">选择一个 stash 查看内容。</p>
        <RepoDiffWorkspace
          v-else
          :files="workspaceFiles"
          :active-file="activeWorkspaceFile"
          :file-count-label="fileCountLabel"
          file-list-label="stash 变更"
          diff-panel-label="stash diff"
          empty-file-text="这个 stash 没有可显示的文件变更。"
          empty-diff-text="这个文件没有可显示的 diff。"
          :mode="diffMode"
          fill
          show-stats
          splitter
          @select-file="selectFile"
        >
          <template #meta>
            <section class="repo-stash-panel__meta">
              <span class="repo-stash-panel__meta-id">{{ selectedStash.id }}</span>
              <h3>{{ selectedStash.message }}</h3>
              <p class="muted">{{ selectedStash.branch || "detached" }}</p>
              <p class="commit-file-picker__stat">
                <span class="commit-file-picker__stat--add">+{{ totalAdditions }}</span>
                <span class="commit-file-picker__stat--del">-{{ totalDeletions }}</span>
              </p>
            </section>
          </template>
          <template #diff-actions>
            <div class="repo-stash-panel__diff-actions">
              <div class="repo-stash-panel__mode" role="group" aria-label="diff 显示模式">
                <button
                  type="button"
                  :class="{ 'is-active': diffMode === 'hunks' }"
                  @click="diffMode = 'hunks'"
                >
                  变更
                </button>
                <button
                  type="button"
                  :class="{ 'is-active': diffMode === 'raw' }"
                  @click="diffMode = 'raw'"
                >
                  Raw diff
                </button>
              </div>
              <div class="repo-stash-panel__actions" role="group" aria-label="stash 操作">
                <button type="button" class="ghost" :disabled="!canMutate" @click="applySelectedStash">
                  <ArchiveRestore :size="14" aria-hidden="true" />
                  Apply
                </button>
                <button type="button" class="ghost" :disabled="!canMutate" @click="popSelectedStash">
                  <Archive :size="14" aria-hidden="true" />
                  Pop
                </button>
                <button type="button" class="ghost danger" :disabled="!canMutate" @click="dropSelectedStash">
                  <Trash2 :size="14" aria-hidden="true" />
                  {{ dropConfirmStashId === selectedStash.id ? "确认删除" : "Drop" }}
                </button>
              </div>
            </div>
          </template>
        </RepoDiffWorkspace>
      </section>
    </div>
  </section>
</template>

<style scoped>
.repo-stash-panel {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
}

.repo-stash-panel__shell {
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
}

.repo-stash-panel__list {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--border-soft);
}

.repo-stash-panel__head,
.repo-stash-panel__diff-actions,
.repo-stash-panel__actions,
.repo-stash-panel__mode {
  display: flex;
  align-items: center;
  gap: 8px;
}

.repo-stash-panel__head {
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-soft);
}

.repo-stash-panel__head-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.repo-stash-panel__head-count {
  font-size: 11px;
}

.repo-stash-panel__head h2,
.repo-stash-panel__meta h3 {
  margin: 0;
  font-size: 13px;
}

.repo-stash-panel__detail {
  min-width: 0;
  min-height: 0;
  display: grid;
}

.repo-stash-panel__detail-empty {
  margin: 0;
  justify-self: center;
  align-self: center;
}

.repo-stash-panel__items {
  display: grid;
  align-content: start;
  gap: 6px;
  min-height: 0;
  overflow: auto;
  padding: 10px;
}

.repo-stash-panel__item {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text);
  text-align: left;
  background: transparent;
}

.repo-stash-panel__item:hover,
.repo-stash-panel__item.is-active {
  border-color: var(--border);
  background: var(--bg-soft);
}

.repo-stash-panel__item strong,
.repo-stash-panel__item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-stash-panel__item-id,
.repo-stash-panel__meta-id {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}

.repo-stash-panel__detail {
  min-width: 0;
  min-height: 0;
}

.repo-stash-panel__meta {
  display: grid;
  gap: 5px;
  min-width: 0;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-soft);
}

.repo-stash-panel__meta h3,
.repo-stash-panel__meta p {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-stash-panel__diff-actions {
  justify-content: space-between;
  width: 100%;
  min-width: 0;
}

.repo-stash-panel__mode {
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
}

.repo-stash-panel__mode button {
  min-width: 68px;
  height: 26px;
  border: 0;
  border-radius: calc(var(--radius-sm) - 2px);
  color: var(--text-muted);
  background: transparent;
}

.repo-stash-panel__mode button.is-active {
  color: var(--text);
  background: var(--bg-soft);
}

.repo-stash-panel__actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.repo-stash-panel__actions button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.repo-stash-panel__error,
.repo-stash-panel__notice {
  margin: 10px 12px 0;
}

.repo-stash-panel__empty {
  align-self: center;
  justify-self: center;
}
</style>

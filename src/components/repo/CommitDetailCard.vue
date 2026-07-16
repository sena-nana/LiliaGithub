<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ChevronDown, Clock3, Copy, FileText, GitCommitHorizontal, X } from "@lucide/vue";
import { useComponentEpoch } from "../../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../../composables/useLatestAsyncLoader";
import { getRepoCommitDetail, type CommitDetail } from "../../services/workspace";
import { copyText } from "../../composables/workspace/system";
import RepoDiffWorkspace from "./RepoDiffWorkspace.vue";
import type { RepoDiffWorkspaceFile, RepoDiffWorkspaceMode } from "./repoDiffWorkspace";
import {
  commitFileStatusText,
  formatRepoTime,
} from "../../utils/repoDisplay";

const props = withDefaults(defineProps<{
  repoId: string;
  hash: string;
  repoTitle?: string;
  embedded?: boolean;
  closable?: boolean;
}>(), {
  repoTitle: "",
  embedded: false,
  closable: false,
});

const emit = defineEmits<{
  close: [];
}>();

const loading = ref(false);
const error = ref<string | null>(null);
const detail = ref<CommitDetail | null>(null);
const activeFilePath = ref<string | null>(null);
const copyNotice = ref<string | null>(null);
const diffCollapsed = ref(true);
const panelHeight = ref(460);
const componentEpoch = useComponentEpoch();
const detailLoader = createLatestAsyncLoader({ componentEpoch });
let resizeCleanup: (() => void) | null = null;
let copyNoticeTimer: number | null = null;

const totalAdditions = computed(() =>
  detail.value?.files.reduce((sum, file) => sum + file.additions, 0) ?? 0,
);
const totalDeletions = computed(() =>
  detail.value?.files.reduce((sum, file) => sum + file.deletions, 0) ?? 0,
);
const shortHash = computed(() => detail.value?.shortHash || props.hash.slice(0, 7));
const parentText = computed(() => {
  const parents = detail.value?.parents ?? [];
  if (!parents.length) return "Root";
  return parents.map((parent) => parent.slice(0, 7)).join(" · ");
});
const authorInitial = computed(() => {
  const name = detail.value?.author.trim() || "?";
  return name.slice(0, 1).toUpperCase();
});
const fileStatusSummary = computed(() => {
  const files = detail.value?.files ?? [];
  const counts = files.reduce<Record<string, number>>((summary, file) => {
    const label = commitFileStatusText(file.status);
    summary[label] = (summary[label] ?? 0) + 1;
    return summary;
  }, {});
  return Object.entries(counts)
    .map(([label, count]) => `${label} ${count}`)
    .join(" ");
});
const diffMode = computed<RepoDiffWorkspaceMode>(() => diffCollapsed.value ? "hunks" : "raw");
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
const cardStyle = computed(() => ({
  "--commit-detail-height": `${panelHeight.value}px`,
}));

onMounted(() => {
  void load();
});

watch(() => [props.repoId, props.hash] as const, () => {
  void load();
});

watch(() => detail.value?.files, (files) => {
  if (files?.some((file) => file.path === activeFilePath.value)) return;
  activeFilePath.value = files?.[0]?.path ?? null;
});

onUnmounted(() => {
  detailLoader.invalidate();
  stopResize();
  clearCopyNoticeTimer();
});

async function load(forceRefresh = false) {
  if (!props.repoId || !props.hash) return;
  const repoId = props.repoId;
  const hash = props.hash;
  await detailLoader.run(`${repoId}:${hash}`, async (runId) => {
    loading.value = true;
    error.value = null;
    try {
      const nextDetail = await getRepoCommitDetail(repoId, hash, { forceRefresh });
      if (!detailLoader.isCurrent(runId) || repoId !== props.repoId || hash !== props.hash) return;
      detail.value = nextDetail;
    } catch (err) {
      if (!detailLoader.isCurrent(runId)) return;
      error.value = String(err);
      detail.value = null;
    } finally {
      if (detailLoader.isCurrent(runId)) {
        loading.value = false;
      }
    }
  });
}

async function refresh() {
  await load(true);
}

function fileStatusLetter(status: string) {
  if (status === "renamed") return "R";
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  if (status === "copied") return "C";
  return "M";
}

function selectFile(file: RepoDiffWorkspaceFile) {
  activeFilePath.value = file.path;
}

function toggleDiffCollapsed() {
  diffCollapsed.value = !diffCollapsed.value;
}

async function copyHash() {
  if (!detail.value) return;
  try {
    await copyText(detail.value.hash);
    showCopyNotice("完整 hash 已复制");
  } catch {
    showCopyNotice("复制失败");
  }
}

function showCopyNotice(message: string) {
  copyNotice.value = message;
  clearCopyNoticeTimer();
  copyNoticeTimer = window.setTimeout(() => {
    copyNotice.value = null;
    copyNoticeTimer = null;
  }, 1800);
}

function clearCopyNoticeTimer() {
  if (copyNoticeTimer == null) return;
  window.clearTimeout(copyNoticeTimer);
  copyNoticeTimer = null;
}

function stopResize() {
  resizeCleanup?.();
  resizeCleanup = null;
}

function startHeightResize(event: PointerEvent) {
  if (!props.embedded) return;
  startResize(event, (start, current) => {
    panelHeight.value = clamp(start.height + start.y - current.clientY, 300, 760);
  });
}

function startResize(
  event: PointerEvent,
  apply: (start: { x: number; y: number; height: number }, current: PointerEvent) => void,
) {
  event.preventDefault();
  stopResize();
  const start = { x: event.clientX, y: event.clientY, height: panelHeight.value };
  const onMove = (moveEvent: PointerEvent) => apply(start, moveEvent);
  const onEnd = () => stopResize();
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onEnd, { once: true });
  window.addEventListener("pointercancel", onEnd, { once: true });
  resizeCleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
    window.removeEventListener("pointercancel", onEnd);
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

defineExpose({ refresh });
</script>

<template>
  <section
    class="commit-detail-card"
    :class="{ 'commit-detail-card--embedded': embedded }"
    :style="cardStyle"
    aria-label="提交详情卡片"
  >
    <div
      v-if="embedded"
      class="commit-detail-card__height-resizer"
      role="separator"
      aria-orientation="horizontal"
      @pointerdown="startHeightResize"
    />

    <p v-if="error" class="error-line commit-detail-card__state">{{ error }}</p>
    <p v-else-if="loading" class="muted commit-detail-card__state">正在读取提交详情...</p>

    <RepoDiffWorkspace
      v-else-if="detail"
      :files="workspaceFiles"
      :active-file="activeWorkspaceFile"
      :file-count-label="`${detail.files.length} 个文件`"
      empty-file-text="此提交没有可展示的文件改动。"
      empty-diff-text="仅文件元数据变更、二进制文件或无可展示的文本差异。"
      :mode="diffMode"
      :show-stats="true"
      :splitter="embedded"
      @select-file="selectFile"
    >
      <template #meta>
        <section class="commit-detail-meta" aria-label="提交元数据">
          <p class="commit-detail-meta__repo">{{ repoTitle || repoId }}</p>
          <h3>{{ detail.subject }}</h3>
          <div class="commit-detail-meta__hash">
            <button
              type="button"
              class="commit-detail-meta__hash-button"
              :aria-label="`复制完整 hash ${shortHash}`"
              :title="`复制完整 hash: ${detail.hash}`"
              @click="copyHash"
            >
              <GitCommitHorizontal :size="13" aria-hidden="true" />
              <span>{{ shortHash }}</span>
              <Copy :size="12" aria-hidden="true" />
            </button>
            <span v-if="copyNotice" class="commit-detail-meta__copy-tip" role="status">{{ copyNotice }}</span>
          </div>
          <p v-if="detail.body" class="commit-detail-meta__body">{{ detail.body }}</p>
          <div class="commit-author-card">
            <span class="commit-author-card__avatar" aria-hidden="true">{{ authorInitial }}</span>
            <div class="commit-author-card__identity">
              <strong>{{ detail.author }}</strong>
              <span><Clock3 :size="12" aria-hidden="true" />{{ formatRepoTime(detail.timestamp) }}</span>
            </div>
          </div>
          <div class="commit-meta-line">
            <span :title="detail.parents.join(' · ') || '根提交'">Parent: {{ parentText }}</span>
            <span v-if="detail.refs.length" class="commit-meta-line__refs" :title="detail.refs.join(' · ')">
              {{ detail.refs.join(" · ") }}
            </span>
          </div>
          <div class="commit-change-summary">
            <span><FileText :size="14" aria-hidden="true" />{{ detail.files.length }} 文件</span>
            <span v-if="fileStatusSummary">{{ fileStatusSummary }}</span>
            <strong class="commit-file-picker__stat--add">+{{ totalAdditions }}</strong>
            <strong class="commit-file-picker__stat--del">-{{ totalDeletions }}</strong>
          </div>
        </section>
      </template>

      <template #diff-actions="{ file }">
        <button
          v-if="file"
          type="button"
          class="commit-file-diff__action commit-file-diff__toggle"
          :class="{ 'is-active': diffCollapsed }"
          aria-label="折叠 diff"
          :aria-pressed="diffCollapsed"
          :title="diffCollapsed ? '显示原始 diff' : '折叠 diff'"
          @click="toggleDiffCollapsed"
        >
          <ChevronDown :size="13" aria-hidden="true" />
        </button>
        <button
          v-if="closable"
          type="button"
          class="commit-file-diff__action"
          aria-label="关闭提交详情"
          title="关闭提交详情"
          @click="emit('close')"
        >
          <X :size="13" aria-hidden="true" />
        </button>
      </template>
    </RepoDiffWorkspace>
  </section>
</template>

<style scoped>
.commit-detail-card {
  position: relative;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
  box-shadow: 0 18px 46px rgb(0 0 0 / 20%);
}

.commit-detail-card--embedded {
  grid-template-rows: minmax(0, 1fr);
  height: var(--commit-detail-height);
  min-height: 300px;
}

.commit-detail-meta__repo,
.commit-detail-meta h3,
.commit-detail-meta__body {
  margin: 0;
}

.commit-detail-card__state {
  margin: 0;
  padding: 14px;
}

.commit-detail-card__height-resizer {
  position: absolute;
  z-index: 2;
  top: 0;
  right: 0;
  left: 0;
  height: 6px;
  cursor: ns-resize;
  background: transparent;
}

.commit-detail-meta {
  display: grid;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border-soft);
}

.commit-detail-meta__repo {
  max-width: calc(100% - 36px);
  overflow: hidden;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.commit-detail-meta h3 {
  max-width: calc(100% - 36px);
  overflow-wrap: anywhere;
  font-size: 15px;
  line-height: 1.35;
}

.commit-detail-meta__hash {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.commit-detail-meta__hash-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 100%;
  padding: 0;
  border: 0;
  color: var(--text-muted);
  background: transparent;
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
}

.commit-detail-meta__hash-button:hover {
  color: var(--accent);
}

.commit-detail-meta__copy-tip {
  padding: 3px 7px;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  color: var(--text);
  background: var(--bg-elev);
  box-shadow: 0 10px 26px rgb(0 0 0 / 18%);
  font-size: 11px;
}

.commit-detail-meta__body {
  color: var(--text-muted);
  white-space: pre-wrap;
  font-size: 12px;
}

.commit-author-card {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-top: 2px;
}

.commit-author-card__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  color: var(--accent);
  background: var(--accent-soft);
  font-size: 15px;
  font-weight: 700;
}

.commit-author-card__identity {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.commit-author-card__identity strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.commit-author-card__identity span,
.commit-meta-line,
.commit-change-summary {
  color: var(--text-muted);
  font-size: 12px;
}

.commit-author-card__identity span,
.commit-change-summary span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.commit-meta-line,
.commit-change-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.commit-meta-line__refs {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-file-picker__stat--add {
  color: var(--ok);
}

.commit-file-picker__stat--del {
  color: var(--err);
}

.error-line {
  color: var(--err);
}

@media (max-width: 860px) {
  .commit-detail-card--embedded {
    height: min(var(--commit-detail-height), 78vh);
  }
}
</style>

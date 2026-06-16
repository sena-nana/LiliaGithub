<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ChevronDown, Clock3, Copy, FileText, GitCommitHorizontal, X } from "@lucide/vue";
import { getRepoCommitDetail, type CommitDetail, type CommitFileChange } from "../../services/workspace";
import { copyText } from "../../composables/workspace/system";
import DiffCodeRenderer from "./DiffCodeRenderer.vue";
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
const splitPercent = ref(38);
let resizeCleanup: (() => void) | null = null;
let copyNoticeTimer: number | null = null;

const totalAdditions = computed(() =>
  detail.value?.files.reduce((sum, file) => sum + file.additions, 0) ?? 0,
);
const totalDeletions = computed(() =>
  detail.value?.files.reduce((sum, file) => sum + file.deletions, 0) ?? 0,
);
const activeFile = computed(() => {
  const files = detail.value?.files ?? [];
  return files.find((file) => file.path === activeFilePath.value) ?? files[0] ?? null;
});
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
const cardStyle = computed(() => ({
  "--commit-detail-height": `${panelHeight.value}px`,
  "--commit-detail-left": `${splitPercent.value}%`,
}));

onMounted(() => {
  void load();
});

watch(() => [props.repoId, props.hash] as const, () => {
  void load();
});

watch(() => detail.value?.files, (files) => {
  activeFilePath.value = files?.[0]?.path ?? null;
});

onUnmounted(() => {
  stopResize();
  clearCopyNoticeTimer();
});

async function load() {
  if (!props.repoId || !props.hash) return;
  loading.value = true;
  error.value = null;
  try {
    detail.value = await getRepoCommitDetail(props.repoId, props.hash);
  } catch (err) {
    error.value = String(err);
    detail.value = null;
  } finally {
    loading.value = false;
  }
}

function fileKey(file: CommitFileChange) {
  return `${file.oldPath ?? ""}:${file.path}`;
}

function fileTitle(file: CommitFileChange) {
  return file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path;
}

function fileStatusLetter(status: string) {
  if (status === "renamed") return "R";
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  if (status === "copied") return "C";
  return "M";
}

function selectFile(file: CommitFileChange) {
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

function startSplitResize(event: PointerEvent) {
  if (!props.embedded) return;
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  const shell = target.closest(".commit-detail-card");
  if (!(shell instanceof HTMLElement)) return;
  const rect = shell.getBoundingClientRect();
  startResize(event, (_start, current) => {
    if (!rect.width) return;
    const next = ((current.clientX - rect.left) / rect.width) * 100;
    splitPercent.value = clamp(next, 28, 55);
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

    <div v-else-if="detail" class="commit-detail-card__content">
      <aside class="commit-detail-card__sidebar">
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

        <section class="commit-file-picker" aria-label="改动文件列表">
          <div class="commit-file-picker__header">
            <div class="commit-file-picker__header-title">
              <h3>改动文件</h3>
              <span class="muted">{{ detail.files.length }} 个文件</span>
            </div>
            <p class="commit-file-picker__stat commit-file-picker__header-stat">
              <span class="commit-file-picker__stat--add">+{{ totalAdditions }}</span>
              <span class="commit-file-picker__stat--del">-{{ totalDeletions }}</span>
            </p>
          </div>
          <p v-if="!detail.files.length" class="muted commit-file-picker__empty">此提交没有可展示的文件改动。</p>
          <div v-else class="commit-file-picker__list">
            <button
              v-for="file in detail.files"
              :key="fileKey(file)"
              type="button"
              class="commit-file-picker__item"
              :class="{ 'is-active': activeFile?.path === file.path }"
              :title="fileTitle(file)"
              @click="selectFile(file)"
            >
              <span
                class="commit-file-picker__status"
                :class="`is-${file.status}`"
                :title="commitFileStatusText(file.status)"
              >
                {{ fileStatusLetter(file.status) }}
              </span>
              <span class="commit-file-picker__path">
                <template v-if="file.oldPath">{{ file.oldPath }} -> </template>{{ file.path }}
              </span>
              <span class="commit-file-picker__stat">
                <span class="commit-file-picker__stat--add">+{{ file.additions }}</span>
                <span class="commit-file-picker__stat--del">-{{ file.deletions }}</span>
              </span>
            </button>
          </div>
        </section>
      </aside>

      <div
        v-if="embedded"
        class="commit-detail-card__splitter"
        role="separator"
        aria-orientation="vertical"
        @pointerdown="startSplitResize"
      />

      <section class="commit-diff-panel" aria-label="改动文件 diff">
        <header class="commit-file-diff__header">
          <button
            v-if="activeFile"
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
        </header>
        <template v-if="activeFile">
          <DiffCodeRenderer
            v-if="diffCollapsed && activeFile.hunks.length"
            :file-path="activeFile.path"
            :hunks="activeFile.hunks"
            :patch="activeFile.patch"
            mode="hunks"
          />
          <DiffCodeRenderer
            v-else-if="!diffCollapsed && activeFile.patch"
            :file-path="activeFile.path"
            :hunks="activeFile.hunks"
            :patch="activeFile.patch"
            mode="raw"
          />
          <p v-else class="muted commit-file-diff__empty">
            仅文件元数据变更、二进制文件或无可展示的文本差异。
          </p>
        </template>
        <p v-else class="muted commit-file-diff__empty">此提交没有可展示的文件改动。</p>
      </section>
    </div>
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

.commit-file-picker__header h3,
.commit-file-picker__header p,
.commit-detail-meta__repo,
.commit-detail-meta h3,
.commit-detail-meta__body {
  margin: 0;
}

.commit-detail-card__state {
  margin: 0;
  padding: 14px;
}

.commit-detail-card__content {
  position: relative;
  display: grid;
  grid-template-columns: minmax(280px, var(--commit-detail-left, 38%)) 2px minmax(360px, 1fr);
  min-height: 0;
}

.commit-detail-card:not(.commit-detail-card--embedded) .commit-detail-card__content {
  grid-template-columns: minmax(300px, 38%) minmax(360px, 1fr);
}

.commit-diff-panel {
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.commit-detail-card__sidebar {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-right: 1px solid var(--border-soft);
}

.commit-detail-card__splitter,
.commit-detail-card__height-resizer {
  background: var(--border-soft);
}

.commit-detail-card__splitter {
  cursor: col-resize;
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

.commit-file-picker {
  --commit-file-status-width: 16px;
  --commit-file-stat-width: 68px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  padding: 8px 10px 10px;
}

.commit-file-picker__header {
  display: grid;
  grid-template-columns: var(--commit-file-status-width) minmax(0, 1fr) var(--commit-file-stat-width);
  align-items: end;
  gap: 6px;
  margin-bottom: 4px;
  padding: 0 5px;
}

.commit-file-picker__header-title {
  grid-column: 1 / 3;
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.commit-file-picker__header h3 {
  font-size: 13px;
}

.commit-file-picker__header span,
.commit-file-picker__header p {
  font-size: 11px;
}

.commit-file-picker__header-stat {
  grid-column: 3;
  margin: 0;
}

.commit-file-picker__list {
  display: grid;
  align-content: start;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.commit-file-picker__item {
  display: grid;
  grid-template-columns: var(--commit-file-status-width) minmax(0, 1fr) var(--commit-file-stat-width);
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 0 5px;
  border: 0;
  border-top: 1px solid var(--border-soft);
  border-radius: 6px;
  text-align: left;
  color: var(--text);
  background: transparent;
}

.commit-file-picker__item:first-child {
  border-top: 0;
}

.commit-file-picker__item:hover,
.commit-file-picker__item.is-active {
  background: var(--bg-hover);
}

.commit-file-picker__item.is-active {
  background: var(--bg-active);
}

.commit-file-picker__item:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.commit-file-picker__status,
.commit-file-picker__stat {
  color: var(--text-muted);
  font-size: 11px;
}

.commit-file-picker__status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--commit-file-status-width);
  height: 16px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
}

.commit-file-picker__status.is-added {
  color: var(--ok);
  background: color-mix(in srgb, var(--ok) 12%, transparent);
}

.commit-file-picker__status.is-deleted {
  color: var(--err);
  background: color-mix(in srgb, var(--err) 12%, transparent);
}

.commit-file-picker__status.is-renamed,
.commit-file-picker__status.is-copied {
  color: var(--accent);
  background: var(--accent-soft);
}

.commit-file-picker__status.is-modified {
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 12%, transparent);
}

.commit-file-picker__path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 11px;
}

.commit-file-picker__stat {
  justify-self: end;
  font-variant-numeric: tabular-nums;
}

.commit-file-picker__stat {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  width: 100%;
  font-family: var(--font-mono);
  text-align: right;
}

.commit-file-picker__stat--add {
  color: var(--ok);
}

.commit-file-picker__stat--del {
  color: var(--err);
}

.commit-file-picker__empty {
  margin: 0;
}

.commit-diff-panel {
  background: var(--bg);
}

.commit-file-diff__header {
  position: sticky;
  z-index: 1;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-height: 32px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg-subtle);
}

.commit-file-diff__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}

.commit-file-diff__action:hover {
  color: var(--text);
  background: var(--bg-hover);
}

.commit-file-diff__toggle.is-active {
  color: var(--accent);
  background: var(--accent-soft);
}

.commit-file-diff__empty {
  margin: 0;
  padding: 12px 10px;
}

.error-line {
  color: var(--err);
}

@media (max-width: 860px) {
  .commit-detail-card--embedded {
    height: min(var(--commit-detail-height), 78vh);
  }

  .commit-detail-card__content,
  .commit-detail-card:not(.commit-detail-card--embedded) .commit-detail-card__content {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(220px, 38%) minmax(0, 1fr);
  }

  .commit-detail-card__sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--border-soft);
  }

  .commit-detail-card__splitter {
    display: none;
  }
}

@media (max-width: 640px) {
  .commit-file-diff__header {
    padding: 4px 8px;
  }

}
</style>

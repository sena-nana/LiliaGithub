<script setup lang="ts">
import { computed, useSlots } from "vue";
import {
  LiliaPrimaryContent,
  LiliaResourcePanel,
  LiliaWorkspace,
} from "../../ui";
import DiffCodeRenderer from "./DiffCodeRenderer.vue";
import type { RepoDiffWorkspaceFile, RepoDiffWorkspaceMode } from "./repoDiffWorkspace";

const props = withDefaults(defineProps<{
  files: readonly RepoDiffWorkspaceFile[];
  activeFile: RepoDiffWorkspaceFile | null;
  fileCountLabel: string;
  fileListLabel?: string;
  diffPanelLabel?: string;
  emptyFileText: string;
  emptyDiffText: string;
  mode: RepoDiffWorkspaceMode;
  fill?: boolean;
  showStats?: boolean;
}>(), {
  fileListLabel: "改动文件",
  diffPanelLabel: "改动文件 diff",
  fill: false,
  showStats: false,
});

defineEmits<{
  selectFile: [file: RepoDiffWorkspaceFile];
}>();

const slots = useSlots();
const hasFilePrefix = computed(() => Boolean(slots["file-prefix"]));
const hasHeaderStat = computed(() => props.showStats || props.files.some((file) => Boolean(file.statText)));
const hasDiffActions = computed(() => Boolean(slots["diff-actions"]));
const hasSidebar = computed(() => Boolean(slots.sidebar));
const totalAdditions = computed(() => props.files.reduce((sum, file) => sum + (file.additions ?? 0), 0));
const totalDeletions = computed(() => props.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0));
function fileTitle(file: RepoDiffWorkspaceFile) {
  return file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path;
}
</script>

<template>
  <LiliaWorkspace
    class="repo-diff-workspace commit-detail-card__content"
    :class="{
      'repo-diff-workspace--with-prefix': hasFilePrefix,
      'repo-diff-workspace--with-stats': hasHeaderStat,
      'repo-diff-workspace--fill': fill,
    }"
    aria-label="差异工作区"
  >
    <LiliaResourcePanel
      id="diff-files"
      :default-size="360"
      :min-size="280"
      :max-size="560"
      resizable
      resize-label="调整差异文件列表宽度"
      narrow-behavior="overlay"
      :collapse-below="860"
      overflow="hidden"
    >
      <div v-if="hasSidebar" class="commit-detail-card__sidebar commit-detail-card__sidebar--custom">
        <slot name="sidebar" />
      </div>

      <div v-else class="commit-detail-card__sidebar">
        <slot name="meta" />

        <section class="commit-file-picker" aria-label="改动文件列表">
        <div class="commit-file-picker__header">
          <div class="commit-file-picker__header-title">
            <h3>{{ fileListLabel }}</h3>
            <span class="muted">{{ fileCountLabel }}</span>
          </div>
          <p v-if="hasHeaderStat" class="commit-file-picker__stat commit-file-picker__header-stat">
            <slot name="header-stat">
              <template v-if="showStats">
                <span class="commit-file-picker__stat--add">+{{ totalAdditions }}</span>
                <span class="commit-file-picker__stat--del">-{{ totalDeletions }}</span>
              </template>
            </slot>
          </p>
        </div>

        <p v-if="!files.length" class="muted commit-file-picker__empty">{{ emptyFileText }}</p>
        <div v-else class="commit-file-picker__list" role="list">
          <button
            v-for="file in files"
            :key="file.key"
            type="button"
            class="commit-file-picker__item"
            data-lilia-interactive
            :data-lilia-selected="activeFile?.key === file.key ? 'true' : 'false'"
            :data-agent-id="`repo.diff.file.${file.key}`"
            :class="{ 'is-active': activeFile?.key === file.key }"
            :title="fileTitle(file)"
            @click="$emit('selectFile', file)"
          >
            <slot name="file-prefix" :file="file" />
            <span class="commit-file-picker__status" :class="file.statusClass" :title="file.statusLabel">
              {{ file.statusLetter }}
            </span>
            <span class="commit-file-picker__path">
              <template v-if="file.oldPath">{{ file.oldPath }} -> </template>{{ file.path }}
            </span>
            <span v-if="hasHeaderStat" class="commit-file-picker__stat">
              <slot name="file-stat" :file="file">
                <template v-if="showStats">
                  <span class="commit-file-picker__stat--add">+{{ file.additions ?? 0 }}</span>
                  <span class="commit-file-picker__stat--del">-{{ file.deletions ?? 0 }}</span>
                </template>
                <template v-else>{{ file.statText }}</template>
              </slot>
            </span>
          </button>
        </div>
        </section>
      </div>
    </LiliaResourcePanel>

    <LiliaPrimaryContent id="diff-content" overflow="hidden">
      <section class="commit-diff-panel" :aria-label="diffPanelLabel">
        <header v-if="hasDiffActions" class="commit-file-diff__header">
          <slot name="diff-actions" :file="activeFile" :mode="mode" />
        </header>
        <template v-if="activeFile">
          <DiffCodeRenderer
            v-if="mode === 'hunks' && activeFile.hunks?.length"
            :file-path="activeFile.path"
            :hunks="activeFile.hunks"
            :patch="activeFile.patch ?? ''"
            mode="hunks"
          />
          <DiffCodeRenderer
            v-else-if="activeFile.patch"
            :file-path="activeFile.path"
            :hunks="activeFile.hunks ?? []"
            :patch="activeFile.patch"
            mode="raw"
            :fill="fill"
          />
          <p v-else class="muted commit-file-diff__empty">{{ emptyDiffText }}</p>
        </template>
        <p v-else class="muted commit-file-diff__empty">{{ files.length ? emptyDiffText : emptyFileText }}</p>
      </section>
    </LiliaPrimaryContent>
  </LiliaWorkspace>
</template>

<style scoped>
.repo-diff-workspace {
  position: relative;
  min-width: 0;
  min-height: 0;
}

.repo-diff-workspace--fill {
  height: 100%;
  max-height: 100%;
}

.commit-detail-card__sidebar {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-right: 1px solid var(--border-soft);
}

.commit-detail-card__sidebar--custom {
  grid-template-rows: minmax(0, 1fr);
}

.commit-file-picker {
  --commit-file-prefix-width: 0px;
  --commit-file-status-width: 16px;
  --commit-file-stat-width: 68px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  padding: 8px 10px 10px;
}

.repo-diff-workspace--with-prefix .commit-file-picker {
  --commit-file-prefix-width: 18px;
}

.repo-diff-workspace--with-prefix.repo-diff-workspace--with-stats .commit-file-picker {
  --commit-file-stat-width: 76px;
}

.commit-file-picker__header {
  display: grid;
  grid-template-columns: var(--commit-file-prefix-width) var(--commit-file-status-width) minmax(0, 1fr) var(--commit-file-stat-width);
  align-items: end;
  gap: 6px;
  margin-bottom: 4px;
  padding: 0 5px;
}

.repo-diff-workspace:not(.repo-diff-workspace--with-prefix) .commit-file-picker__header {
  grid-template-columns: var(--commit-file-status-width) minmax(0, 1fr) var(--commit-file-stat-width);
}

.repo-diff-workspace:not(.repo-diff-workspace--with-stats) .commit-file-picker__header {
  grid-template-columns: var(--commit-file-prefix-width) var(--commit-file-status-width) minmax(0, 1fr);
}

.repo-diff-workspace:not(.repo-diff-workspace--with-prefix):not(.repo-diff-workspace--with-stats) .commit-file-picker__header {
  grid-template-columns: var(--commit-file-status-width) minmax(0, 1fr);
}

.commit-file-picker__header-title {
  grid-column: 1 / 3;
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.repo-diff-workspace--with-prefix .commit-file-picker__header-title {
  grid-column: 1 / 4;
}

.commit-file-picker__header h3,
.commit-file-picker__header p {
  margin: 0;
}

.commit-file-picker__header h3 {
  font-size: 13px;
}

.commit-file-picker__header span,
.commit-file-picker__header p {
  font-size: 11px;
}

.commit-file-picker__header-stat {
  grid-column: -2 / -1;
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

.repo-diff-workspace--with-prefix .commit-file-picker__item {
  grid-template-columns: var(--commit-file-prefix-width) var(--commit-file-status-width) minmax(0, 1fr) var(--commit-file-stat-width);
}

.repo-diff-workspace:not(.repo-diff-workspace--with-stats) .commit-file-picker__item {
  grid-template-columns: var(--commit-file-status-width) minmax(0, 1fr);
}

.repo-diff-workspace--with-prefix:not(.repo-diff-workspace--with-stats) .commit-file-picker__item {
  grid-template-columns: var(--commit-file-prefix-width) var(--commit-file-status-width) minmax(0, 1fr);
}

.commit-file-picker__item:first-child {
  border-top: 0;
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

.commit-file-picker__status.is-added,
.commit-file-picker__status.change-badge--ok {
  color: var(--ok);
  background: color-mix(in srgb, var(--ok) 12%, transparent);
}

.commit-file-picker__status.is-deleted,
.commit-file-picker__status.change-badge--err {
  color: var(--err);
  background: color-mix(in srgb, var(--err) 12%, transparent);
}

.commit-file-picker__status.is-renamed,
.commit-file-picker__status.is-copied,
.commit-file-picker__status.change-badge--accent {
  color: var(--accent);
  background: var(--accent-soft);
}

.commit-file-picker__status.is-modified,
.commit-file-picker__status.change-badge--warn {
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 12%, transparent);
}

.commit-file-picker__status.change-badge--muted {
  color: var(--text-muted);
  background: var(--bg-subtle);
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
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
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
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--bg);
}

.repo-diff-workspace--fill .commit-diff-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
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

:slotted(.commit-file-diff__action) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}

:slotted(.commit-file-diff__action):hover {
  color: var(--text);
  background: var(--bg-hover);
}

:slotted(.commit-file-diff__toggle.is-active) {
  color: var(--accent);
  background: var(--accent-soft);
}

.commit-file-diff__empty {
  margin: 0;
  padding: 12px 10px;
}

@media (max-width: 640px) {
  .repo-diff-workspace--with-prefix.repo-diff-workspace--with-stats .commit-file-picker {
    --commit-file-stat-width: 68px;
  }

  .commit-file-picker__header-stat,
  .commit-file-picker__stat {
    display: none;
  }

  .repo-diff-workspace--with-stats .commit-file-picker__header,
  .repo-diff-workspace--with-prefix.repo-diff-workspace--with-stats .commit-file-picker__header {
    grid-template-columns: var(--commit-file-prefix-width) var(--commit-file-status-width) minmax(0, 1fr);
  }

  .repo-diff-workspace--with-stats .commit-file-picker__item,
  .repo-diff-workspace--with-prefix.repo-diff-workspace--with-stats .commit-file-picker__item {
    grid-template-columns: var(--commit-file-prefix-width) var(--commit-file-status-width) minmax(0, 1fr);
  }

  .commit-file-diff__header {
    padding: 4px 8px;
  }
}
</style>

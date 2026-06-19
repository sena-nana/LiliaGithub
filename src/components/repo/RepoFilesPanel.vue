<script setup lang="ts">
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
} from "@lucide/vue";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  getRepoFilePreview,
  listRepoFiles,
  openPath,
  openUrl,
} from "../../services/workspace/client";
import type { RepoChange, RepoFilePreview, RepoFileTreeEntry } from "../../services/workspace/types";
import { inferDiffCodeLanguage, tokenizeDiffCodeLines } from "../../utils/diffCode";
import { changeStatusLetter, changeStatusText, changeStatusTone } from "../../utils/repoDisplay";
import type { ReadmeLinkTarget } from "../../utils/readmeLinks";
import MarkdownReadme from "./MarkdownReadme.vue";

const props = defineProps<{
  repoId: string;
  repoPath?: string | null;
  changes?: readonly RepoChange[];
  targetPath?: string | null;
  targetHash?: string | null;
}>();

const ROOT_KEY = "";
const markdownReadme = ref<InstanceType<typeof MarkdownReadme> | null>(null);
const directoryEntries = ref<Record<string, RepoFileTreeEntry[]>>({});
const expandedDirectories = ref<string[]>([]);
const directoryLoading = ref<string[]>([]);
const treeLoading = ref(false);
const treeError = ref<string | null>(null);
const selectedPath = ref<string | null>(null);
const preview = ref<RepoFilePreview | null>(null);
const previewLoading = ref(false);
const previewError = ref<string | null>(null);

const knownMarkdownPaths = computed(() =>
  Array.from(
    new Set(
      Object.values(directoryEntries.value)
        .flat()
        .filter((entry) => entry.kind === "file" && /\.(md|markdown)$/i.test(entry.name))
        .map((entry) => entry.path),
    ),
  ),
);
const textPreviewLanguage = computed(() =>
  preview.value?.previewKind === "text" ? inferDiffCodeLanguage(preview.value.path) : "text",
);
const textPreviewLines = computed(() =>
  preview.value?.previewKind === "text"
    ? tokenizeDiffCodeLines(preview.value.content ?? "", textPreviewLanguage.value)
    : [],
);
const fileChangeBadges = computed(() =>
  new Map(
    (props.changes ?? []).map((change) => [
      change.path,
      {
        className: changeStatusTone(change),
        label: changeStatusText(change),
        letter: changeStatusLetter(change),
      },
    ]),
  ),
);
const visibleEntries = computed(() => flattenEntries(ROOT_KEY, 0));

onMounted(() => {
  void initializePanel();
});

watch(
  () => props.repoId,
  () => {
    void initializePanel();
  },
);

watch(
  () => [props.targetPath, props.targetHash] as const,
  ([path, hash]) => {
    if (!path) return;
    void selectFile(path, hash);
  },
);

async function initializePanel() {
  directoryEntries.value = {};
  expandedDirectories.value = [];
  directoryLoading.value = [];
  treeLoading.value = true;
  treeError.value = null;
  selectedPath.value = null;
  preview.value = null;
  previewLoading.value = false;
  previewError.value = null;

  try {
    const rootEntries = await loadDirectory(null, { force: true });
    if (props.targetPath) {
      await selectFile(props.targetPath, props.targetHash);
    } else {
      const readme = rootEntries.find((entry) => entry.kind === "file" && entry.path === "README.md");
      if (readme) {
        await selectFile(readme.path);
      }
    }
  } catch (err) {
    treeError.value = String(err);
  } finally {
    treeLoading.value = false;
  }
}

function flattenEntries(
  parentPath: string,
  depth: number,
): Array<{ entry: RepoFileTreeEntry; depth: number; badge: ReturnType<typeof treeEntryBadge> }> {
  const entries = directoryEntries.value[parentPath] ?? [];
  const flattened: Array<{ entry: RepoFileTreeEntry; depth: number; badge: ReturnType<typeof treeEntryBadge> }> = [];
  for (const entry of entries) {
    flattened.push({ entry, depth, badge: treeEntryBadge(entry) });
    if (entry.kind === "dir" && expandedDirectories.value.includes(entry.path)) {
      flattened.push(...flattenEntries(entry.path, depth + 1));
    }
  }
  return flattened;
}

async function loadDirectory(parentPath: string | null, options: { force?: boolean } = {}) {
  const key = parentPath ?? ROOT_KEY;
  if (!options.force && key in directoryEntries.value) {
    return directoryEntries.value[key] ?? [];
  }
  if (directoryLoading.value.includes(key)) {
    return directoryEntries.value[key] ?? [];
  }
  directoryLoading.value = [...directoryLoading.value, key];
  try {
    const entries = await listRepoFiles(props.repoId, parentPath);
    directoryEntries.value = {
      ...directoryEntries.value,
      [key]: entries,
    };
    return entries;
  } finally {
    directoryLoading.value = directoryLoading.value.filter((item) => item !== key);
  }
}

async function toggleDirectory(entry: RepoFileTreeEntry) {
  if (entry.kind !== "dir") return;
  if (expandedDirectories.value.includes(entry.path)) {
    expandedDirectories.value = expandedDirectories.value.filter((path) => path !== entry.path);
    return;
  }
  expandedDirectories.value = [...expandedDirectories.value, entry.path];
  await loadDirectory(entry.path);
}

async function expandAncestors(filePath: string) {
  const segments = filePath.split("/").slice(0, -1);
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (!expandedDirectories.value.includes(current)) {
      expandedDirectories.value = [...expandedDirectories.value, current];
    }
    await loadDirectory(current);
  }
}

async function selectFile(path: string, hash?: string | null) {
  selectedPath.value = path;
  previewLoading.value = true;
  previewError.value = null;
  try {
    await expandAncestors(path);
    preview.value = await getRepoFilePreview(props.repoId, path);
    if (hash && preview.value.previewKind === "markdown") {
      await nextTick();
      markdownReadme.value?.scrollToAnchor(hash);
    }
  } catch (err) {
    preview.value = null;
    previewError.value = String(err);
  } finally {
    previewLoading.value = false;
  }
}

async function openPreviewLink(target: ReadmeLinkTarget) {
  if (target.kind === "external") {
    void openUrl(target.href);
    return;
  }
  if (target.kind === "anchor") {
    await nextTick();
    markdownReadme.value?.scrollToAnchor(target.hash);
    return;
  }
  if (target.kind === "readme") {
    await selectFile(target.path, target.hash);
    return;
  }
  await selectFile(target.relativePath, target.hash);
}

function isDirectoryExpanded(path: string) {
  return expandedDirectories.value.includes(path);
}

function isDirectoryLoading(path: string) {
  return directoryLoading.value.includes(path);
}

function isTreeItemActive(entry: RepoFileTreeEntry) {
  return entry.kind === "file" && selectedPath.value === entry.path;
}

function treeEntryBadge(entry: RepoFileTreeEntry) {
  if (entry.kind !== "file") return null;
  return fileChangeBadges.value.get(entry.path) ?? null;
}

function previewTitle() {
  if (preview.value) return preview.value.path;
  if (selectedPath.value) return selectedPath.value;
  return "文件预览";
}

function previewDescription() {
  if (!preview.value) return "";
  if (preview.value.previewKind === "tooLarge") return `文件过大，${formatFileSize(preview.value.size)}，无法预览`;
  if (preview.value.previewKind === "binary") return `二进制文件，${formatFileSize(preview.value.size)}，无法预览`;
  return `${preview.value.previewKind} · ${formatFileSize(preview.value.size)}`;
}

function absolutePreviewPath() {
  if (!preview.value || !props.repoPath) return null;
  const separator = props.repoPath.includes("\\") ? "\\" : "/";
  return `${props.repoPath.replace(/[\\/]+$/, "")}${separator}${preview.value.path.replace(/\//g, separator)}`;
}

function openPreviewFile() {
  const path = absolutePreviewPath();
  if (!path) return;
  void openPath(path);
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<template>
  <section class="files-panel">
    <div class="files-layout">
      <main class="files-main" :aria-label="previewTitle()">
        <div class="files-main__head">
          <div class="files-main__title-line">
            <strong>{{ previewTitle() }}</strong>
            <span v-if="previewDescription()" class="files-main__meta">{{ previewDescription() }}</span>
          </div>
          <button
            v-if="preview && absolutePreviewPath()"
            type="button"
            class="ghost files-main__open"
            aria-label="打开文件"
            title="打开文件"
            @click="openPreviewFile"
          >
            <ExternalLink :size="14" aria-hidden="true" />
          </button>
        </div>

        <p v-if="previewError" class="error-line files-main__empty">{{ previewError }}</p>
        <p v-else-if="previewLoading" class="muted files-main__empty">正在读取文件内容。</p>
        <p v-else-if="!preview" class="muted files-main__empty">选择一个文件查看内容。</p>
        <pre v-else-if="preview.previewKind === 'text'" class="files-main__code"><code><span
          v-for="line in textPreviewLines"
          :key="`${preview.path}:${line.index}`"
          class="files-main__code-line"
        ><span
            v-for="(token, tokenIndex) in line.tokens"
            :key="`${line.index}:${tokenIndex}:${token.type}:${token.text}`"
            class="diff-code__token"
            :class="`diff-code__token--${token.type}`"
          >{{ token.text }}</span>{{ line.index < textPreviewLines.length - 1 ? "\n" : "" }}</span></code></pre>
        <MarkdownReadme
          v-else-if="preview.previewKind === 'markdown' && preview.content"
          ref="markdownReadme"
          :content="preview.content"
          :images="preview.images"
          :repo-root-path="repoPath"
          :current-readme-path="preview.path"
          :readme-paths="knownMarkdownPaths"
          @open-link="openPreviewLink"
        />
        <div v-else-if="preview.previewKind === 'image' && preview.dataUrl" class="files-main__image-wrap">
          <img class="files-main__image" :src="preview.dataUrl" :alt="preview.name" />
        </div>
        <div v-else class="files-main__unsupported">
          <strong>{{ preview.previewKind === "tooLarge" ? "文件过大" : "暂不支持预览" }}</strong>
          <p>{{ preview.path }}</p>
        </div>
      </main>

      <aside class="files-sidebar" aria-label="仓库文件树">
        <div class="files-sidebar__card">
          <div class="files-sidebar__head">
            <strong>文件树</strong>
            <span v-if="repoPath" :title="repoPath">{{ repoPath }}</span>
          </div>
          <p v-if="treeError" class="error-line files-sidebar__empty">{{ treeError }}</p>
          <p v-else-if="treeLoading" class="muted files-sidebar__empty">正在读取文件树。</p>
          <p v-else-if="!visibleEntries.length" class="muted files-sidebar__empty">当前仓库没有可浏览文件。</p>
          <div v-else class="files-tree" role="tree">
            <button
              v-for="{ entry, depth, badge } in visibleEntries"
              :key="entry.path"
              type="button"
              class="files-tree__item"
              :class="{ 'is-active': isTreeItemActive(entry) }"
              :style="{ '--depth': depth }"
              :aria-expanded="entry.kind === 'dir' ? isDirectoryExpanded(entry.path) : undefined"
              :aria-selected="isTreeItemActive(entry)"
              @click="entry.kind === 'dir' ? toggleDirectory(entry) : selectFile(entry.path)"
            >
              <span class="files-tree__indent" aria-hidden="true" />
              <span class="files-tree__toggle" aria-hidden="true">
                <ChevronDown
                  v-if="entry.kind === 'dir' && isDirectoryExpanded(entry.path)"
                  :size="14"
                />
                <ChevronRight
                  v-else-if="entry.kind === 'dir' && entry.hasChildren"
                  :size="14"
                />
              </span>
              <FolderOpen
                v-if="entry.kind === 'dir' && isDirectoryExpanded(entry.path)"
                :size="14"
                aria-hidden="true"
              />
              <Folder v-else-if="entry.kind === 'dir'" :size="14" aria-hidden="true" />
              <FileImage
                v-else-if="/\.(png|jpe?g|gif|webp|svg)$/i.test(entry.name)"
                :size="14"
                aria-hidden="true"
              />
              <FileText v-else :size="14" aria-hidden="true" />
              <strong>{{ entry.name }}</strong>
              <span v-if="badge" class="files-tree__badge" :class="badge.className" :title="badge.label" aria-hidden="true">{{ badge.letter }}</span>
              <span v-if="entry.kind === 'dir' && isDirectoryLoading(entry.path)" class="files-tree__meta">加载中</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.files-panel {
  display: grid;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.files-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 280px);
  gap: 14px;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.files-main,
.files-sidebar__card {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
}

.files-main {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.files-main__head,
.files-sidebar__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--border-soft);
}

.files-main__head {
  align-items: center;
  padding: 8px 12px;
}

.files-sidebar__head {
  padding: 12px 14px;
}

.files-main__head strong,
.files-sidebar__head strong {
  display: block;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.files-main__title-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.files-main__meta {
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.files-sidebar__head span {
  margin: 3px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.files-main__open {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  line-height: 1;
}

.files-main__empty,
.files-main__unsupported {
  padding: 16px;
}

.files-main__unsupported strong {
  display: block;
  margin-bottom: 4px;
  color: var(--text);
}

.files-main__unsupported p {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.files-main__code {
  margin: 0;
  padding: 16px;
  overflow: auto;
  color: var(--text);
  font-size: 12px;
  line-height: 1.6;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.files-main__code code {
  font: inherit;
}

.files-main__code-line {
  display: block;
  min-width: 0;
}

.files-main :deep(.readme-render) {
  padding: 16px;
  overflow: auto;
  height: 100%;
}

.files-main__image-wrap {
  display: grid;
  place-items: start center;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  background: var(--bg-subtle);
}

.files-main__image {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  background: white;
}

.files-sidebar {
  min-width: 0;
  min-height: 0;
}

.files-sidebar__card {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.files-sidebar__empty {
  margin: 0;
  padding: 14px;
}

.files-tree {
  display: grid;
  align-content: start;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.files-tree__item {
  display: grid;
  grid-template-columns: calc(var(--depth, 0) * 14px) 14px 14px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  text-align: left;
  color: var(--text-muted);
}

.files-tree__item:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.files-tree__item.is-active {
  background: var(--bg-active);
  color: var(--text);
}

.files-tree__indent,
.files-tree__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
}

.files-tree__item strong,
.files-tree__meta,
.files-tree__badge {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.files-tree__item strong {
  font-size: 13px;
  font-weight: 500;
}

.files-tree__meta {
  color: var(--text-muted);
  font-size: 11px;
}

.files-tree__badge {
  justify-self: end;
  min-width: 20px;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
}

.files-tree__badge.change-badge--err {
  background: color-mix(in srgb, var(--err) 12%, transparent);
  color: var(--err);
}

.files-tree__badge.change-badge--warn {
  background: color-mix(in srgb, var(--warn) 12%, transparent);
  color: var(--warn);
}

.files-tree__badge.change-badge--accent {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
}

.files-tree__badge.change-badge--ok {
  background: color-mix(in srgb, var(--ok) 12%, transparent);
  color: var(--ok);
}

.files-tree__badge.change-badge--muted {
  background: var(--bg-subtle);
  color: var(--text-muted);
}

@media (max-width: 900px) {
  .files-layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .files-sidebar {
    order: -1;
  }

  .files-sidebar__card {
    max-height: 280px;
  }
}
</style>

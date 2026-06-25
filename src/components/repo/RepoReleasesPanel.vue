<script setup lang="ts">
import {
  Download,
  FileUp,
  LoaderCircle,
  Pencil,
  Save,
  Trash2,
  X,
} from "@lucide/vue";
import { computed, reactive, ref, watch } from "vue";
import { openContextMenuAt, type ContextMenuItem } from "../../composables/useContextMenu";
import type {
  GitHubCreateReleaseRequest,
  GitHubRelease,
  GitHubReleaseAsset,
  GitHubUpdateReleaseRequest,
} from "../../services/workspace/types";
import type { ReadmeLinkTarget } from "../../utils/readmeLinks";
import MarkdownReadme from "./MarkdownReadme.vue";

const props = defineProps<{
  repoFullName: string;
  releases: readonly GitHubRelease[];
  loading: boolean;
  mutating: boolean;
  focusedTag?: string | null;
  releaseTypeFilter?: ReleaseTypeFilter;
}>();

const emit = defineEmits<{
  create: [request: GitHubCreateReleaseRequest];
  update: [releaseId: number, request: GitHubUpdateReleaseRequest];
  delete: [release: GitHubRelease];
  uploadAssets: [release: GitHubRelease];
  deleteAsset: [release: GitHubRelease, asset: GitHubReleaseAsset];
  openUrl: [url: string];
}>();

type ReleaseForm = {
  tagName: string;
  targetCommitish: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  generateReleaseNotes: boolean;
};

type ReleaseTypeFilter = "all" | "stable" | "latest" | "prerelease" | "draft";
type ReleaseType = Exclude<ReleaseTypeFilter, "all">;

const ASSET_PREVIEW_LIMIT = 2;
const BODY_COLLAPSE_CHAR_LIMIT = 420;
const BODY_COLLAPSE_LINE_LIMIT = 8;
const RELEASE_TYPE_LABELS: Record<ReleaseType, string> = {
  stable: "Stable",
  latest: "Latest",
  prerelease: "Pre-release",
  draft: "Draft",
};

const createOpen = ref(false);
const editingReleaseId = ref<number | null>(null);
const expandedAssetReleaseIds = ref<Set<number>>(new Set());
const expandedBodyReleaseIds = ref<Set<number>>(new Set());
const form = reactive<ReleaseForm>(blankForm());

const sortedReleases = computed(() =>
  [...props.releases].sort((left, right) => releaseTimestamp(right) - releaseTimestamp(left)),
);
const filteredReleases = computed(() => {
  const tag = props.focusedTag?.trim();
  const type = props.releaseTypeFilter ?? "all";
  return sortedReleases.value.filter((release) => {
    if (tag && release.tagName !== tag) return false;
    return type === "all" || releaseType(release) === type;
  });
});

watch(() => props.repoFullName, () => {
  closeForm();
  expandedAssetReleaseIds.value = new Set();
  expandedBodyReleaseIds.value = new Set();
});

function blankForm(): ReleaseForm {
  return {
    tagName: "",
    targetCommitish: "",
    name: "",
    body: "",
    draft: false,
    prerelease: false,
    generateReleaseNotes: false,
  };
}

function releaseTimestamp(release: GitHubRelease) {
  const parsed = Date.parse(release.publishedAt ?? release.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function openCreate() {
  Object.assign(form, blankForm());
  editingReleaseId.value = null;
  createOpen.value = true;
}

function openEdit(release: GitHubRelease) {
  form.tagName = release.tagName;
  form.targetCommitish = release.targetCommitish;
  form.name = release.name ?? "";
  form.body = release.body ?? "";
  form.draft = release.draft;
  form.prerelease = release.prerelease;
  form.generateReleaseNotes = false;
  editingReleaseId.value = release.id;
  createOpen.value = false;
}

function openReleaseActions(release: GitHubRelease, event: MouseEvent) {
  if (props.mutating) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const items: ContextMenuItem[] = [
    { id: `edit-release:${release.id}`, label: "编辑 Release", icon: Pencil, onSelect: () => openEdit(release) },
    { id: `upload-assets:${release.id}`, label: "上传资产", icon: FileUp, onSelect: () => emit("uploadAssets", release) },
  ];
  if (release.assets.length) {
    items.push({
      id: `delete-assets:${release.id}`,
      label: "删除资产",
      icon: Trash2,
      danger: true,
      children: release.assets.map((asset) => ({
        id: `delete-asset:${release.id}:${asset.id}`,
        label: asset.name,
        icon: Trash2,
        onSelect: () => emit("deleteAsset", release, asset),
        danger: true,
        confirmLabel: "确认删除资产",
      })),
    });
  }
  items.push({
    id: `delete-release:${release.id}`,
    label: "删除 Release",
    icon: Trash2,
    onSelect: () => emit("delete", release),
    danger: true,
    confirmLabel: "确认删除 Release",
  });
  openContextMenuAt(rect.right, rect.bottom + 4, items);
}

function closeForm() {
  createOpen.value = false;
  editingReleaseId.value = null;
  Object.assign(form, blankForm());
}

function submitForm() {
  const request = releaseRequest();
  if (!request.tagName) return;
  if (editingReleaseId.value != null) {
    const updateRequest: GitHubUpdateReleaseRequest = {
      tagName: request.tagName,
      targetCommitish: request.targetCommitish,
      name: request.name,
      body: request.body,
      draft: request.draft,
      prerelease: request.prerelease,
    };
    emit("update", editingReleaseId.value, updateRequest);
  } else {
    emit("create", request);
  }
  closeForm();
}

function releaseRequest(): GitHubCreateReleaseRequest {
  return {
    tagName: form.tagName.trim(),
    targetCommitish: form.targetCommitish.trim() || null,
    name: form.name.trim() || null,
    body: form.body.trim() || null,
    draft: form.draft,
    prerelease: form.prerelease,
    generateReleaseNotes: form.generateReleaseNotes,
  };
}

function releaseTitle(release: GitHubRelease) {
  return release.name?.trim() || release.tagName;
}

function releaseType(release: GitHubRelease): ReleaseType {
  if (release.draft) return "draft";
  if (release.prerelease) return "prerelease";
  if (release.makeLatest === "true") return "latest";
  return "stable";
}

function releaseTypeLabel(release: GitHubRelease) {
  return RELEASE_TYPE_LABELS[releaseType(release)];
}

function releaseTimelineLabel(release: GitHubRelease) {
  const details = [releaseTypeLabel(release), release.tagName];
  if (release.targetCommitish) details.push(`Target ${release.targetCommitish}`);
  return details.join(" · ");
}

function releaseDate(release: GitHubRelease) {
  const value = release.publishedAt ?? release.createdAt;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function sizeText(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function isReleaseAssetsExpanded(release: GitHubRelease) {
  return expandedAssetReleaseIds.value.has(release.id);
}

function visibleReleaseAssets(release: GitHubRelease) {
  if (isReleaseAssetsExpanded(release)) return release.assets;
  return release.assets.slice(0, ASSET_PREVIEW_LIMIT);
}

function releaseHiddenAssetCount(release: GitHubRelease) {
  return Math.max(0, release.assets.length - ASSET_PREVIEW_LIMIT);
}

function toggleIdSet(current: Set<number>, id: number) {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function toggleReleaseAssets(release: GitHubRelease) {
  expandedAssetReleaseIds.value = toggleIdSet(expandedAssetReleaseIds.value, release.id);
}

function isReleaseBodyLong(release: GitHubRelease) {
  const body = release.body?.trim() ?? "";
  if (!body) return false;
  return body.length > BODY_COLLAPSE_CHAR_LIMIT || body.split(/\r\n?|\n/).length > BODY_COLLAPSE_LINE_LIMIT;
}

function isReleaseBodyExpanded(release: GitHubRelease) {
  return expandedBodyReleaseIds.value.has(release.id);
}

function isReleaseBodyCollapsed(release: GitHubRelease) {
  return isReleaseBodyLong(release) && !isReleaseBodyExpanded(release);
}

function toggleReleaseBody(release: GitHubRelease) {
  expandedBodyReleaseIds.value = toggleIdSet(expandedBodyReleaseIds.value, release.id);
}

function openMarkdownLink(target: ReadmeLinkTarget) {
  if (target.kind === "external") emit("openUrl", target.href);
}

defineExpose({
  openCreate,
});
</script>

<template>
  <div class="repo-releases-panel">
    <form
      v-if="createOpen || editingReleaseId != null"
      class="release-form"
      aria-label="Release 表单"
      data-agent-id="repo.release.form"
      @submit.prevent="submitForm"
    >
      <div class="release-form__head">
        <strong>{{ editingReleaseId == null ? "New release" : "Edit release" }}</strong>
        <button
          type="button"
          class="ghost project-icon-action"
          data-agent-id="repo.release.form.close"
          aria-label="关闭表单"
          title="关闭"
          @click="closeForm"
        >
          <X :size="14" aria-hidden="true" />
        </button>
      </div>
      <div class="release-form__grid">
        <label>
          <span>Tag</span>
          <input v-model="form.tagName" required type="text" placeholder="v1.0.0" data-agent-id="repo.release.form.tag" />
        </label>
        <label>
          <span>Target</span>
          <input v-model="form.targetCommitish" type="text" placeholder="main" data-agent-id="repo.release.form.target" />
        </label>
        <label class="release-form__wide">
          <span>Title</span>
          <input v-model="form.name" type="text" placeholder="Release title" data-agent-id="repo.release.form.title" />
        </label>
      </div>
      <label>
        <span>Notes</span>
        <textarea v-model="form.body" rows="7" placeholder="Describe this release" data-agent-id="repo.release.form.notes"></textarea>
      </label>
      <div class="release-form__checks">
        <label><input v-model="form.draft" type="checkbox" data-agent-id="repo.release.form.draft" /> Draft</label>
        <label><input v-model="form.prerelease" type="checkbox" data-agent-id="repo.release.form.prerelease" /> Pre-release</label>
        <label v-if="editingReleaseId == null"><input v-model="form.generateReleaseNotes" type="checkbox" data-agent-id="repo.release.form.generate-notes" /> Generate notes</label>
      </div>
      <div class="release-form__actions">
        <button type="button" class="ghost" data-agent-id="repo.release.form.cancel" :disabled="mutating" @click="closeForm">取消</button>
        <button type="submit" class="primary" data-agent-id="repo.release.form.save" :disabled="mutating || !form.tagName.trim()">
          <LoaderCircle v-if="mutating" :size="14" aria-hidden="true" class="sb-spin" />
          <Save v-else :size="14" aria-hidden="true" />
          保存
        </button>
      </div>
    </form>

    <p v-if="loading && !releases.length" class="repo-empty muted">正在读取 releases。</p>
    <p v-else-if="!releases.length" class="repo-empty muted">暂无 releases。</p>
    <p v-else-if="!filteredReleases.length" class="repo-empty muted">没有匹配的 releases。</p>

    <ol v-else class="release-list release-timeline" aria-label="Release 列表">
      <li
        v-for="release in filteredReleases"
        :key="release.id"
        class="release-card"
        :class="[`is-${releaseType(release)}`, { 'is-focused': focusedTag === release.tagName }]"
        :data-release-tag="release.tagName"
      >
        <span class="release-card__rail">
          <span
            class="release-card__rail-hit"
            :aria-label="releaseTimelineLabel(release)"
            :data-tooltip="releaseTimelineLabel(release)"
            :data-agent-id="`repo.release.${release.id}.timeline`"
            tabindex="0"
          >
            <span class="release-card__node"></span>
          </span>
        </span>
        <article class="release-card__content">
          <div class="release-card__main">
            <header class="release-card__head">
              <div class="release-card__title">
                <div class="release-card__title-line">
                  <h4>{{ releaseTitle(release) }}</h4>
                  <span v-if="releaseType(release) !== 'prerelease'" class="release-badge">{{ releaseTypeLabel(release) }}</span>
                </div>
                <p class="release-card__meta">
                  <span class="release-card__tag">{{ release.tagName }}</span>
                  <span>{{ release.author || "unknown" }}</span>
                  <time :datetime="release.publishedAt ?? release.createdAt">{{ releaseDate(release) }}</time>
                </p>
              </div>
              <div class="release-card__tools">
                <button
                  type="button"
                  class="ghost project-icon-action"
                  :data-agent-id="`repo.release.${release.id}.actions`"
                  :disabled="mutating"
                  aria-label="编辑 Release 菜单"
                  title="编辑 Release"
                  aria-haspopup="menu"
                  @click="openReleaseActions(release, $event)"
                >
                  <Pencil :size="14" aria-hidden="true" />
                </button>
              </div>
            </header>
            <div
              v-if="release.body"
              class="release-card__markdown"
              :class="{
                'is-collapsible': isReleaseBodyLong(release),
                'is-collapsed': isReleaseBodyCollapsed(release),
              }"
            >
              <div class="release-card__markdown-body">
                <MarkdownReadme :content="release.body" :link-base-url="release.htmlUrl" @open-link="openMarkdownLink" />
              </div>
              <button
                v-if="isReleaseBodyLong(release)"
                type="button"
                class="release-card__markdown-toggle"
                :data-agent-id="`repo.release.${release.id}.body.toggle`"
                :aria-expanded="isReleaseBodyExpanded(release)"
                @click="toggleReleaseBody(release)"
              >
                {{ isReleaseBodyExpanded(release) ? "收起" : "展开" }}
              </button>
            </div>
            <p v-else class="release-card__empty muted">No release notes.</p>
          </div>
          <div v-if="release.assets.length" class="release-assets__list">
            <div v-for="asset in visibleReleaseAssets(release)" :key="asset.id" class="release-asset">
              <button
                type="button"
                class="release-asset__name"
                :data-agent-id="`repo.release.${release.id}.asset.${asset.id}`"
                @click="emit('openUrl', asset.browserDownloadUrl)"
              >
                <span>{{ asset.name }}</span>
              </button>
              <span class="release-asset__meta">
                <span class="release-asset__downloads">
                  <Download :size="13" aria-hidden="true" />
                  {{ asset.downloadCount }}
                </span>
                <span>{{ sizeText(asset.size) }}</span>
              </span>
            </div>
            <button
              v-if="releaseHiddenAssetCount(release)"
              type="button"
              class="release-assets__more"
              :data-agent-id="`repo.release.${release.id}.assets.more`"
              @click="toggleReleaseAssets(release)"
            >
              {{ isReleaseAssetsExpanded(release) ? "收起" : `更多 ${releaseHiddenAssetCount(release)}` }}
            </button>
          </div>
        </article>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.repo-releases-panel,
.release-list,
.release-card__content,
.release-card__main {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.release-card__head,
.release-card__tools,
.release-form__head,
.release-form__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.release-card__title h4 {
  margin: 0;
}

.release-card__meta,
.release-card__empty {
  color: var(--text-muted);
  font-size: 12px;
}

.release-card__tools {
  justify-content: flex-end;
  flex-shrink: 0;
}

.release-form {
  display: grid;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
}

.release-form__head,
.release-form__actions {
  justify-content: space-between;
}

.release-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.release-form__wide {
  grid-column: 1 / -1;
}

.release-form__checks {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: var(--text-muted);
  font-size: 12px;
}

.release-form__checks label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.release-list {
  gap: 0;
  margin: 0;
  padding: 12px 14px;
  overflow: visible;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--border-soft) 55%, transparent);
  list-style: none;
}

.release-card {
  --release-tone: var(--ok);
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 12px;
  min-width: 0;
  padding: 0;
}

.release-card.is-latest {
  --release-tone: var(--accent);
}

.release-card.is-prerelease {
  --release-tone: var(--warn);
}

.release-card.is-draft {
  --release-tone: var(--text-muted);
}

.release-card.is-focused .release-card__content {
  background: color-mix(in srgb, var(--accent-soft) 28%, transparent);
}

.release-card__rail {
  position: relative;
  display: flex;
  justify-content: center;
  min-height: 100%;
  padding-top: 18px;
}

.release-card__rail::before {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  content: "";
  background: color-mix(in srgb, var(--release-tone) 58%, transparent);
}

.release-card:first-child .release-card__rail::before {
  top: 20px;
}

.release-card__rail-hit {
  position: relative;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  outline: none;
}

.release-card__rail-hit:hover::after,
.release-card__rail-hit:focus-visible::after {
  position: absolute;
  top: 50%;
  left: calc(100% + 8px);
  z-index: 5;
  width: max-content;
  min-width: 180px;
  max-width: min(320px, 52vw);
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
  box-shadow: 0 8px 22px color-mix(in srgb, var(--shadow, #000) 14%, transparent);
  color: var(--text);
  content: attr(data-tooltip);
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: break-word;
  pointer-events: none;
  transform: translateY(-50%);
  white-space: normal;
}

.release-card__rail-hit:focus-visible {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--release-tone) 22%, transparent);
}

.release-card__node {
  position: relative;
  z-index: 1;
  display: block;
  width: 13px;
  height: 13px;
  border: 2px solid var(--bg-elev);
  border-radius: 50%;
  background: var(--release-tone);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--release-tone) 22%, transparent);
}

.release-card__content {
  gap: 10px;
  padding: 14px 4px 18px 0;
  border-bottom: 1px solid var(--border-soft);
}

.release-card:last-child .release-card__content {
  border-bottom: 0;
}

.release-card__head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.release-card__title {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.release-card__title-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.release-card__title h4 {
  overflow-wrap: anywhere;
  color: var(--text);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.35;
}

.release-card__tag {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}

.release-badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 7px;
  border: 1px solid color-mix(in srgb, var(--release-tone) 34%, var(--border));
  border-radius: var(--radius-sm);
  color: var(--release-tone);
  font-size: 11px;
  font-weight: 700;
}

.release-card__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  white-space: nowrap;
}

.release-card__meta span,
.release-card__meta time {
  color: var(--text-muted);
  font-size: 12px;
}

.release-card__meta span::after {
  margin-left: 6px;
  content: "·";
  color: var(--text-muted);
}

.release-card__markdown {
  position: relative;
  display: grid;
  gap: 4px;
  min-width: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.release-card__markdown-body {
  position: relative;
  min-width: 0;
}

.release-card__markdown.is-collapsed .release-card__markdown-body {
  max-height: 128px;
  overflow: hidden;
}

.release-card__markdown.is-collapsed .release-card__markdown-body::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 34px;
  content: "";
  pointer-events: none;
  background: linear-gradient(to bottom, transparent, var(--bg-elev));
}

.release-card__markdown :deep(.markdown-readme) {
  padding: 0;
  border: 0;
  color: var(--text-muted);
  font-size: inherit;
  line-height: inherit;
  background: transparent;
}

.release-card__markdown :deep(.markdown-readme h1),
.release-card__markdown :deep(.markdown-readme h2),
.release-card__markdown :deep(.markdown-readme h3),
.release-card__markdown :deep(.markdown-readme h4),
.release-card__markdown :deep(.markdown-readme h5),
.release-card__markdown :deep(.markdown-readme h6) {
  margin: 6px 0 4px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.35;
}

.release-card__markdown :deep(.markdown-readme p),
.release-card__markdown :deep(.markdown-readme ul),
.release-card__markdown :deep(.markdown-readme ol),
.release-card__markdown :deep(.markdown-readme blockquote),
.release-card__markdown :deep(.markdown-readme pre) {
  margin: 5px 0;
}

.release-card__markdown :deep(.markdown-readme li) {
  margin: 2px 0;
}

.release-card__markdown :deep(.markdown-readme code) {
  font-size: 11px;
}

.release-card__markdown-toggle {
  justify-self: start;
  min-height: 22px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
}

.release-card__markdown-toggle:hover {
  text-decoration: underline;
}

.release-assets__list {
  display: grid;
  overflow: hidden;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
}

.release-asset {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  min-height: 24px;
  padding: 3px 8px;
  border-bottom: 1px solid var(--border-soft);
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
}

.release-asset:last-child {
  border-bottom: 0;
}

.release-asset__name {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  min-width: 0;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-weight: 600;
  text-align: left;
}

.release-asset__name span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.release-assets__more {
  min-height: 24px;
  padding: 3px 8px;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  text-align: left;
}

.release-assets__more:hover {
  background: var(--bg-hover);
}

.release-asset__meta,
.release-asset__downloads {
  display: inline-flex;
  align-items: center;
}

.release-asset__meta {
  justify-content: flex-end;
  gap: 10px;
  white-space: nowrap;
}

.release-asset__downloads {
  gap: 4px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 760px) {
  .release-form__grid,
  .release-card__head,
  .release-asset {
    grid-template-columns: minmax(0, 1fr);
  }

  .release-card {
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 10px;
  }

  .release-card__rail {
    padding-top: 18px;
  }

  .release-card__node {
    width: 11px;
    height: 11px;
  }

  .release-card__tools {
    justify-content: flex-start;
  }
}
</style>

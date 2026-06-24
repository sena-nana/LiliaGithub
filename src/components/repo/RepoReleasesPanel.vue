<script setup lang="ts">
import {
  Download,
  ExternalLink,
  FileUp,
  LoaderCircle,
  Package,
  Pencil,
  Save,
  Tag,
  Trash2,
  X,
} from "@lucide/vue";
import { computed, reactive, ref, watch } from "vue";
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
}>();

const emit = defineEmits<{
  focusTag: [tagName: string | null];
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

const createOpen = ref(false);
const editingReleaseId = ref<number | null>(null);
const deleteReleaseId = ref<number | null>(null);
const deleteAssetId = ref<number | null>(null);
const form = reactive<ReleaseForm>(blankForm());

const sortedReleases = computed(() =>
  [...props.releases].sort((left, right) => releaseTimestamp(right) - releaseTimestamp(left)),
);

watch(() => props.repoFullName, () => {
  closeForm();
  deleteReleaseId.value = null;
  deleteAssetId.value = null;
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

function openMarkdownLink(target: ReadmeLinkTarget) {
  if (target.kind === "external") emit("openUrl", target.href);
}

defineExpose({
  openCreate,
});
</script>

<template>
  <div class="repo-releases-panel">
    <form v-if="createOpen || editingReleaseId != null" class="release-form" aria-label="Release 表单" @submit.prevent="submitForm">
      <div class="release-form__head">
        <strong>{{ editingReleaseId == null ? "New release" : "Edit release" }}</strong>
        <button type="button" class="ghost project-icon-action" aria-label="关闭表单" title="关闭" @click="closeForm">
          <X :size="14" aria-hidden="true" />
        </button>
      </div>
      <div class="release-form__grid">
        <label>
          <span>Tag</span>
          <input v-model="form.tagName" required type="text" placeholder="v1.0.0" />
        </label>
        <label>
          <span>Target</span>
          <input v-model="form.targetCommitish" type="text" placeholder="main" />
        </label>
        <label class="release-form__wide">
          <span>Title</span>
          <input v-model="form.name" type="text" placeholder="Release title" />
        </label>
      </div>
      <label>
        <span>Notes</span>
        <textarea v-model="form.body" rows="7" placeholder="Describe this release"></textarea>
      </label>
      <div class="release-form__checks">
        <label><input v-model="form.draft" type="checkbox" /> Draft</label>
        <label><input v-model="form.prerelease" type="checkbox" /> Pre-release</label>
        <label v-if="editingReleaseId == null"><input v-model="form.generateReleaseNotes" type="checkbox" /> Generate notes</label>
      </div>
      <div class="release-form__actions">
        <button type="button" class="ghost" :disabled="mutating" @click="closeForm">取消</button>
        <button type="submit" class="primary" :disabled="mutating || !form.tagName.trim()">
          <LoaderCircle v-if="mutating" :size="14" aria-hidden="true" class="sb-spin" />
          <Save v-else :size="14" aria-hidden="true" />
          保存
        </button>
      </div>
    </form>

    <p v-if="loading && !releases.length" class="repo-empty muted">正在读取 releases。</p>
    <p v-else-if="!releases.length" class="repo-empty muted">暂无 releases。</p>

    <ol v-else class="release-list release-timeline" aria-label="Release 列表">
      <li
        v-for="release in sortedReleases"
        :key="release.id"
        class="release-card"
        :class="{ 'is-focused': focusedTag === release.tagName }"
        :data-release-tag="release.tagName"
      >
        <span class="release-card__rail" aria-hidden="true">
          <span class="release-card__node">
            <Tag :size="15" aria-hidden="true" />
          </span>
        </span>
        <article class="release-card__body">
          <header class="release-card__head">
            <div class="release-card__title">
              <h4>{{ releaseTitle(release) }}</h4>
              <button type="button" class="release-card__tag" @click="emit('focusTag', release.tagName)">
                {{ release.tagName }}
              </button>
            </div>
            <div class="release-card__tools">
              <span v-if="release.makeLatest === 'true'" class="release-badge">Latest</span>
              <span v-if="release.draft" class="release-badge">Draft</span>
              <span v-else-if="release.prerelease" class="release-badge">Pre-release</span>
              <button type="button" class="ghost project-icon-action" aria-label="打开 Release" title="打开" @click="emit('openUrl', release.htmlUrl)">
                <ExternalLink :size="14" aria-hidden="true" />
              </button>
              <button type="button" class="ghost project-icon-action" :disabled="mutating" aria-label="编辑 Release" title="编辑" @click="openEdit(release)">
                <Pencil :size="14" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="ghost danger project-icon-action"
                :disabled="mutating"
                :aria-label="deleteReleaseId === release.id ? '确认删除 Release' : '删除 Release'"
                :title="deleteReleaseId === release.id ? '再次点击确认删除' : '删除'"
                @click="deleteReleaseId === release.id ? emit('delete', release) : deleteReleaseId = release.id"
              >
                <Trash2 :size="14" aria-hidden="true" />
              </button>
            </div>
          </header>
          <p class="release-card__meta">
            <Package :size="13" aria-hidden="true" />
            <span>{{ release.author || "unknown" }} 发布于 {{ releaseDate(release) }}</span>
            <span v-if="release.targetCommitish">Target {{ release.targetCommitish }}</span>
          </p>
          <div v-if="release.body" class="release-card__markdown">
            <MarkdownReadme :content="release.body" :link-base-url="release.htmlUrl" @open-link="openMarkdownLink" />
          </div>
          <p v-else class="release-card__empty muted">No release notes.</p>
          <section class="release-assets" aria-label="Release assets">
            <div class="release-assets__head">
              <strong>Assets</strong>
              <button type="button" class="ghost" :disabled="mutating" @click="emit('uploadAssets', release)">
                <FileUp :size="14" aria-hidden="true" />
                上传
              </button>
            </div>
            <p v-if="!release.assets.length" class="release-card__empty muted">No assets.</p>
            <div v-else class="release-assets__list">
              <div v-for="asset in release.assets" :key="asset.id" class="release-asset">
                <button type="button" class="release-asset__name" @click="emit('openUrl', asset.browserDownloadUrl)">
                  <Download :size="14" aria-hidden="true" />
                  <span>{{ asset.name }}</span>
                </button>
                <span>{{ sizeText(asset.size) }}</span>
                <span>{{ asset.downloadCount }} downloads</span>
                <button
                  type="button"
                  class="ghost danger project-icon-action"
                  :disabled="mutating"
                  :aria-label="deleteAssetId === asset.id ? '确认删除资产' : '删除资产'"
                  :title="deleteAssetId === asset.id ? '再次点击确认删除' : '删除资产'"
                  @click="deleteAssetId === asset.id ? emit('deleteAsset', release, asset) : deleteAssetId = asset.id"
                >
                  <Trash2 :size="14" aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>
        </article>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.repo-releases-panel,
.release-list,
.release-card__body,
.release-assets {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.release-card__head,
.release-card__tools,
.release-assets__head,
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
.release-form__actions,
.release-assets__head {
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
  margin: 0;
  padding: 0;
  list-style: none;
}

.release-card {
  position: relative;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 14px;
  min-width: 0;
  padding: 0;
}

.release-card__body {
  gap: 14px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--border-soft) 55%, transparent);
}

.release-card.is-focused .release-card__body {
  border-color: color-mix(in srgb, var(--accent) 72%, var(--border));
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--accent) 38%, transparent),
    0 1px 0 color-mix(in srgb, var(--border-soft) 55%, transparent);
}

.release-card__rail {
  position: relative;
  display: flex;
  justify-content: center;
  min-height: 100%;
  padding-top: 12px;
}

.release-card__rail::before {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  content: "";
  background: color-mix(in srgb, var(--text-muted) 44%, transparent);
}

.release-card:first-child .release-card__rail::before {
  top: 24px;
}

.release-card:last-child .release-card__rail::before {
  bottom: calc(100% - 24px);
}

.release-card__node {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 50%;
  color: var(--accent);
  background: var(--bg-elev);
}

.release-card__head {
  justify-content: space-between;
  align-items: flex-start;
  min-width: 0;
}

.release-card__title {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.release-card__title h4 {
  overflow-wrap: anywhere;
  font-size: 18px;
  font-weight: 700;
}

.release-card__tag {
  justify-self: start;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 13px;
  font-weight: 600;
}

.release-badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.release-card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.release-card__markdown {
  min-width: 0;
}

.release-card__markdown :deep(.markdown-readme) {
  padding: 0;
  border: 0;
  background: transparent;
}

.release-assets {
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border-soft);
}

.release-assets__head strong {
  font-size: 13px;
}

.release-assets__head .ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.release-assets__list {
  display: grid;
  overflow: hidden;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
}

.release-asset {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg);
  color: var(--text-muted);
  font-size: 12px;
}

.release-asset:last-child {
  border-bottom: 0;
}

.release-asset__name {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-weight: 600;
}

.release-asset__name span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 760px) {
  .release-form__grid,
  .release-asset {
    grid-template-columns: minmax(0, 1fr);
  }

  .release-card {
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 10px;
  }

  .release-card__rail {
    padding-top: 10px;
  }

  .release-card__node {
    width: 22px;
    height: 22px;
  }

  .release-card__head {
    display: grid;
  }
}
</style>

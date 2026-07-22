<script setup lang="ts">
import {
  CheckCircle2,
  CircleDot,
  ExternalLink,
  FileArchive,
  Package,
  Upload,
  XCircle,
} from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { createLatestAsyncLoader } from "../../composables/useLatestAsyncLoader";
import { useComponentEpoch } from "../../composables/useComponentEpoch";
import {
  getGitHubWorkflowArtifactFilePreview,
  getGitHubWorkflowRunDetail,
  listGitHubWorkflowArtifactFiles,
  openUrl,
} from "../../services/workspace/client";
import type {
  GitHubAttachWorkflowArtifactAssetRequest,
  GitHubRelease,
  GitHubWorkflowArtifact,
  GitHubWorkflowArtifactEntry,
  GitHubWorkflowRun,
  GitHubWorkflowRunDetail,
  RepoFilePreview,
} from "../../services/workspace/types";
import { workflowRunStatusText, workflowRunStatusTone } from "../../utils/repoDisplay";
import {
  actionDurationText,
  actionRelativeTime,
  actionStatusIconKind,
  formatActionBytes,
  formatActionTime,
  workflowEventText,
  workflowStateText,
} from "./actionsDisplay";
import MarkdownReadme from "./MarkdownReadme.vue";
import RepoWorkflowRunDiagnostics from "./RepoWorkflowRunDiagnostics.vue";

const props = defineProps<{
  repoFullName: string;
  runs: readonly GitHubWorkflowRun[];
  focusedRunId?: number | null;
  focusedJobId?: number | null;
  draftReleases?: readonly GitHubRelease[];
  attachAssetMutating?: boolean;
}>();

const emit = defineEmits<{
  attachArtifactAsset: [request: GitHubAttachWorkflowArtifactAssetRequest];
  focusJob: [jobId: number | null];
}>();

const selectedArtifactId = ref<number | null>(null);
const selectedArtifactPath = ref<string | null>(null);
const detail = ref<GitHubWorkflowRunDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);
const artifactEntries = ref<Record<number, GitHubWorkflowArtifactEntry[] | undefined>>({});
const artifactLoading = ref<Record<number, boolean | undefined>>({});
const artifactErrors = ref<Record<number, string | undefined>>({});
const artifactPreview = ref<RepoFilePreview | null>(null);
const artifactPreviewLoading = ref(false);
const artifactPreviewError = ref<string | null>(null);
const selectedDraftReleaseId = ref<number | null>(null);
const componentEpoch = useComponentEpoch();
const detailLoader = createLatestAsyncLoader({ componentEpoch });
const artifactPreviewLoader = createLatestAsyncLoader({ componentEpoch });

const selectedRun = computed(() =>
  props.focusedRunId == null ? null : props.runs.find((run) => run.id === props.focusedRunId) ?? null,
);
const detailRun = computed(() => detail.value?.run ?? selectedRun.value);
const selectedArtifact = computed(() =>
  detail.value?.artifacts.find((artifact) => artifact.id === selectedArtifactId.value) ?? null,
);
const selectedArtifactEntries = computed(() =>
  selectedArtifactId.value == null ? [] : artifactEntries.value[selectedArtifactId.value] ?? [],
);
const totalDuration = computed(() => actionDurationText(detailRun.value?.runStartedAt ?? detailRun.value?.createdAt, detailRun.value?.updatedAt));
const totalArtifacts = computed(() => detail.value?.artifacts.length ?? 0);
const draftReleaseTargets = computed(() => props.draftReleases ?? []);
const selectedDraftRelease = computed(() =>
  draftReleaseTargets.value.find((release) => release.id === selectedDraftReleaseId.value) ??
  draftReleaseTargets.value[0] ??
  null,
);

watch(() => props.focusedRunId, (runId) => {
  resetArtifactSelection();
  if (runId == null) {
    clearRunDetail();
    return;
  }
  void loadDetail(runId);
}, { immediate: true });

watch(draftReleaseTargets, (targets) => {
  if (!targets.length) {
    selectedDraftReleaseId.value = null;
    return;
  }
  if (!targets.some((release) => release.id === selectedDraftReleaseId.value)) {
    selectedDraftReleaseId.value = targets[0].id;
  }
}, { immediate: true });

onBeforeUnmount(() => {
  detailLoader.invalidate();
  artifactPreviewLoader.invalidate();
});

function clearRunDetail() {
  detail.value = null;
  detailError.value = null;
  detailLoading.value = false;
  detailLoader.invalidate();
  artifactPreviewLoader.invalidate();
}

function resetArtifactSelection() {
  selectedArtifactId.value = null;
  selectedArtifactPath.value = null;
  artifactPreview.value = null;
  artifactPreviewError.value = null;
}

async function loadDetail(runId: number, force = false) {
  await detailLoader.run(runId, async (loaderRunId) => {
    detailLoading.value = true;
    detailError.value = null;
    try {
      const nextDetail = await getGitHubWorkflowRunDetail(props.repoFullName, runId, { forceRefresh: force });
      if (!detailLoader.isCurrent(loaderRunId) || props.focusedRunId !== runId) return;
      detail.value = nextDetail;
    } catch (err) {
      if (!detailLoader.isCurrent(loaderRunId)) return;
      detail.value = null;
      detailError.value = String(err);
    } finally {
      if (detailLoader.isCurrent(loaderRunId)) detailLoading.value = false;
    }
  }, { reusePending: !force });
}

function refreshDiagnostics() {
  if (detailRun.value) void loadDetail(detailRun.value.id, true);
}

async function refreshCurrentRun() {
  if (props.focusedRunId == null) return;
  await loadDetail(props.focusedRunId, true);
}

defineExpose({ refreshCurrentRun });

async function selectArtifact(artifact: GitHubWorkflowArtifact) {
  if (artifact.expired) return;
  selectedArtifactId.value = selectedArtifactId.value === artifact.id ? null : artifact.id;
  selectedArtifactPath.value = null;
  artifactPreview.value = null;
  artifactPreviewError.value = null;
  if (selectedArtifactId.value == null) return;
  await loadArtifactEntries(artifact.id);
}

async function loadArtifactEntries(artifactId: number, force = false) {
  if (!force && artifactEntries.value[artifactId]) return;
  artifactLoading.value = { ...artifactLoading.value, [artifactId]: true };
  artifactErrors.value = { ...artifactErrors.value, [artifactId]: undefined };
  try {
    const entries = await listGitHubWorkflowArtifactFiles(props.repoFullName, artifactId, { forceRefresh: force });
    artifactEntries.value = { ...artifactEntries.value, [artifactId]: entries };
    const firstFile = entries.find((entry) => entry.kind === "file");
    if (firstFile) await selectArtifactFile(firstFile);
  } catch (err) {
    artifactErrors.value = { ...artifactErrors.value, [artifactId]: String(err) };
  } finally {
    artifactLoading.value = { ...artifactLoading.value, [artifactId]: false };
  }
}

async function selectArtifactFile(entry: GitHubWorkflowArtifactEntry) {
  if (entry.kind !== "file" || selectedArtifactId.value == null) return;
  const artifactId = selectedArtifactId.value;
  selectedArtifactPath.value = entry.path;
  await artifactPreviewLoader.run(`${artifactId}:${entry.path}`, async (runId) => {
    artifactPreviewLoading.value = true;
    artifactPreviewError.value = null;
    try {
      const preview = await getGitHubWorkflowArtifactFilePreview(props.repoFullName, artifactId, entry.path);
      if (!artifactPreviewLoader.isCurrent(runId) || selectedArtifactId.value !== artifactId || selectedArtifactPath.value !== entry.path) return;
      artifactPreview.value = preview;
    } catch (err) {
      if (!artifactPreviewLoader.isCurrent(runId)) return;
      artifactPreview.value = null;
      artifactPreviewError.value = String(err);
    } finally {
      if (artifactPreviewLoader.isCurrent(runId)) artifactPreviewLoading.value = false;
    }
  });
}

function isWindowsInstallerArtifact(entry: GitHubWorkflowArtifactEntry) {
  return entry.kind === "file" && /\.(exe|msi|msix|msixbundle|appx|appxbundle|zip)$/i.test(entry.name || entry.path);
}

function hasAttachableArtifact(entries: readonly GitHubWorkflowArtifactEntry[]) {
  return entries.some(isWindowsInstallerArtifact);
}

function releaseOptionLabel(release: GitHubRelease) {
  return `${release.tagName}${release.name ? ` · ${release.name}` : ""}`;
}

function attachArtifactFile(entry: GitHubWorkflowArtifactEntry) {
  if (!detailRun.value || !selectedArtifact.value || !selectedDraftRelease.value) return;
  emit("attachArtifactAsset", {
    runId: detailRun.value.id,
    artifactId: selectedArtifact.value.id,
    artifactName: selectedArtifact.value.name,
    artifactPath: entry.path,
    releaseId: selectedDraftRelease.value.id,
    expectedTagName: selectedDraftRelease.value.tagName,
    label: "Windows",
  });
}
</script>

<template>
  <section class="card actions-info-card" aria-label="Actions 信息">
    <p v-if="!focusedRunId" class="muted actions-empty">选择一个 run 查看摘要和产物。</p>
    <p v-else-if="!detailRun && !detailLoading" class="muted actions-empty">选择的 run 不在当前筛选结果中。</p>
    <template v-else>
      <header class="actions-info-head">
        <div class="actions-info-title">
          <span
            class="actions-status"
            :class="detailRun ? `actions-status--${workflowRunStatusTone(detailRun)}` : ''"
            :aria-label="detailRun ? workflowRunStatusText(detailRun) : 'Actions 状态'"
            :title="detailRun ? workflowRunStatusText(detailRun) : 'Actions 状态'"
          >
            <XCircle v-if="detailRun && actionStatusIconKind(detailRun) === 'error'" :size="16" aria-hidden="true" />
            <CheckCircle2 v-else-if="detailRun && actionStatusIconKind(detailRun) === 'ok'" :size="16" aria-hidden="true" />
            <CircleDot v-else :size="16" aria-hidden="true" />
          </span>
          <div>
            <h3>{{ detailRun?.displayTitle ?? "Actions" }}</h3>
            <span>Run #{{ detailRun?.runNumber ?? detailRun?.id }}</span>
          </div>
        </div>
        <button v-if="detailRun?.htmlUrl" type="button" class="ghost actions-icon-btn" data-agent-id="repo.actions.detail.open-github" aria-label="打开 GitHub" title="打开 GitHub" @click="openUrl(detailRun.htmlUrl)">
          <ExternalLink :size="14" aria-hidden="true" />
        </button>
      </header>

      <p v-if="detailLoading" class="muted actions-empty">正在读取 run 详情。</p>
      <p v-if="detailError" class="repo-error">{{ detailError }}</p>

      <dl class="actions-summary">
        <div>
          <dt>工作流</dt>
          <dd>{{ detailRun?.name ?? "-" }}</dd>
        </div>
        <div>
          <dt>分支</dt>
          <dd>{{ detailRun?.branch ?? "-" }}</dd>
        </div>
        <div>
          <dt>触发者</dt>
          <dd>{{ detailRun?.actor ?? detailRun?.event ?? "-" }}</dd>
        </div>
        <div>
          <dt>事件</dt>
          <dd>{{ workflowEventText(detailRun?.event) }}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{{ detailRun ? workflowRunStatusText(detailRun) : "-" }}</dd>
        </div>
        <div>
          <dt>结论</dt>
          <dd>{{ workflowStateText(detailRun?.conclusion ?? detailRun?.status) }}</dd>
        </div>
        <div>
          <dt>耗时</dt>
          <dd>{{ totalDuration }}</dd>
        </div>
        <div>
          <dt>更新</dt>
          <dd>{{ actionRelativeTime(detailRun?.updatedAt) }}</dd>
        </div>
      </dl>

      <RepoWorkflowRunDiagnostics
        v-if="detail"
        :repo-full-name="repoFullName"
        :detail="detail"
        :focused-job-id="focusedJobId"
        :refreshing="detailLoading"
        @focus-job="emit('focusJob', $event)"
        @refresh="refreshDiagnostics"
      />

      <section class="actions-artifacts" aria-label="Artifacts">
        <div class="actions-section-head">
          <strong>产物</strong>
          <span>{{ totalArtifacts }} 项</span>
        </div>
        <p v-if="!detail && detailLoading" class="muted actions-empty">正在读取产物。</p>
        <p v-else-if="detail && !detail.artifacts.length" class="muted actions-empty">没有产物。</p>
        <button
          v-for="artifact in detail?.artifacts ?? []"
          :key="artifact.id"
          type="button"
          class="actions-artifact"
          :class="{ 'is-active': selectedArtifactId === artifact.id }"
          :disabled="artifact.expired"
          :data-agent-id="`repo.actions.artifact.${artifact.id}`"
          :title="artifact.expired ? 'Artifact 已过期，无法读取' : `查看 ${artifact.name}`"
          @click="selectArtifact(artifact)"
        >
          <Package :size="15" aria-hidden="true" />
          <span>
            <strong>{{ artifact.name }}</strong>
            <small>{{ formatActionBytes(artifact.sizeInBytes) }} · {{ artifact.expired ? "已过期" : `过期 ${formatActionTime(artifact.expiresAt)}` }}</small>
          </span>
        </button>
        <div v-if="selectedArtifact" class="actions-artifact-detail">
          <p v-if="artifactLoading[selectedArtifact.id]" class="muted actions-empty">正在下载并读取 artifact。</p>
          <p v-if="artifactErrors[selectedArtifact.id]" class="repo-error">{{ artifactErrors[selectedArtifact.id] }}</p>
          <div v-if="selectedArtifactEntries.length" class="actions-artifact-browser">
            <div class="actions-artifact-files">
              <div
                v-for="entry in selectedArtifactEntries"
                :key="entry.path"
                class="actions-artifact-file-row"
                :class="{ 'is-active': selectedArtifactPath === entry.path }"
              >
                <button
                  type="button"
                  class="actions-artifact-file-select"
                  :disabled="entry.kind !== 'file'"
                  :data-agent-id="`repo.actions.artifact.file.${entry.path}`"
                  @click="selectArtifactFile(entry)"
                >
                  <FileArchive :size="14" aria-hidden="true" />
                  <span>{{ entry.path }}</span>
                  <small>{{ entry.kind === "file" ? formatActionBytes(entry.size) : "目录" }}</small>
                </button>
                <button
                  v-if="isWindowsInstallerArtifact(entry)"
                  type="button"
                  class="ghost actions-artifact-attach"
                  :disabled="!selectedDraftRelease || attachAssetMutating"
                  :data-agent-id="`repo.actions.artifact.attach.${entry.name}`"
                  :aria-label="`附加 ${entry.name} 到 draft release`"
                  :title="selectedDraftRelease ? `附加到 ${selectedDraftRelease.tagName}` : '没有 draft release'"
                  @click="attachArtifactFile(entry)"
                >
                  <Upload :size="13" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div class="actions-artifact-preview">
              <div v-if="hasAttachableArtifact(selectedArtifactEntries)" class="actions-artifact-release-target">
                <label>
                  <span>Draft Release</span>
                  <select v-model.number="selectedDraftReleaseId" data-agent-id="repo.actions.artifact.release-target" :disabled="!draftReleaseTargets.length || attachAssetMutating">
                    <option v-for="release in draftReleaseTargets" :key="release.id" :value="release.id">
                      {{ releaseOptionLabel(release) }}
                    </option>
                  </select>
                </label>
              </div>
              <p v-if="artifactPreviewLoading" class="muted actions-empty">正在预览文件。</p>
              <p v-else-if="artifactPreviewError" class="repo-error">{{ artifactPreviewError }}</p>
              <MarkdownReadme
                v-else-if="artifactPreview?.previewKind === 'markdown'"
                :content="artifactPreview.content ?? ''"
                :images="{}"
              />
              <img v-else-if="artifactPreview?.previewKind === 'image' && artifactPreview.dataUrl" :src="artifactPreview.dataUrl" :alt="artifactPreview.name" />
              <pre v-else-if="artifactPreview?.previewKind === 'text'">{{ artifactPreview.content }}</pre>
              <p v-else-if="artifactPreview?.previewKind === 'tooLarge'" class="muted actions-empty">文件超过 1 MB，已跳过内置预览。</p>
              <p v-else-if="artifactPreview" class="muted actions-empty">二进制文件不可预览。</p>
              <p v-else class="muted actions-empty">选择 artifact 文件预览内容。</p>
            </div>
          </div>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.actions-info-card,
.actions-artifacts,
.actions-artifact-detail {
  display: grid;
  gap: var(--repo-sidebar-card-gap);
  min-width: 0;
}

.actions-info-card {
  margin: 0;
  padding: var(--repo-sidebar-card-padding);
}

.actions-info-head,
.actions-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  min-height: var(--repo-sidebar-header-height);
}

.actions-info-title {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.actions-info-title div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.actions-info-title h3 {
  margin: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions-info-title span,
.actions-section-head span {
  color: var(--text-muted);
  font-size: 11px;
}

.actions-section-head strong {
  color: var(--text);
  font-size: 12px;
}

.actions-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--repo-sidebar-card-gap);
  margin: 0;
  padding: var(--repo-sidebar-card-padding) 0;
  border-block: 1px solid var(--border-soft);
}

.actions-summary div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.actions-summary dt {
  color: var(--text-muted);
  font-size: 11px;
}

.actions-summary dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions-artifact,
.actions-artifact-file-select {
  display: grid;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  text-align: left;
}

.actions-artifact {
  grid-template-columns: 18px minmax(0, 1fr);
  min-height: 44px;
  padding: var(--repo-sidebar-list-gap) 8px;
}

.actions-artifact:hover,
.actions-artifact-file-select:hover:not(:disabled),
.actions-artifact-attach:hover:not(:disabled) {
  background: var(--bg-hover);
}

.actions-artifact:disabled {
  cursor: default;
  opacity: 0.58;
}

.actions-artifact.is-active,
.actions-artifact-file-row.is-active .actions-artifact-file-select {
  background: var(--accent-soft);
}

.actions-artifact span {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.actions-artifact strong,
.actions-artifact small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions-artifact strong {
  font-size: 13px;
  font-weight: 600;
}

.actions-artifact small {
  color: var(--text-muted);
  font-size: 11px;
}

.actions-artifact-detail {
  margin: 0;
  padding: var(--repo-sidebar-card-padding) 0 0;
  border-top: 1px solid var(--border-soft);
}

.actions-artifact-browser {
  display: grid;
  gap: var(--repo-sidebar-card-gap);
  min-width: 0;
}

.actions-artifact-files {
  display: grid;
  align-content: start;
  gap: var(--repo-sidebar-list-gap);
  min-width: 0;
  max-height: 220px;
  overflow: auto;
}

.actions-artifact-file-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--repo-sidebar-icon-button-size);
  gap: var(--repo-sidebar-list-gap);
  min-width: 0;
}

.actions-artifact-file-select {
  grid-template-columns: 16px minmax(0, 1fr);
  min-height: var(--repo-sidebar-control-height);
  padding: 0 7px;
}

.actions-artifact-file-select:disabled {
  cursor: default;
  opacity: 0.58;
}

.actions-artifact-files span,
.actions-artifact-files small {
  grid-column: 2;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions-artifact-files small {
  color: var(--text-muted);
  font-size: 11px;
}

.actions-artifact-attach {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--repo-sidebar-icon-button-size);
  min-width: var(--repo-sidebar-icon-button-size);
  height: var(--repo-sidebar-icon-button-size);
  padding: 0;
}

.actions-artifact-release-target {
  padding: 0 0 var(--repo-sidebar-card-padding);
  border-bottom: 1px solid var(--border-soft);
}

.actions-artifact-release-target label {
  display: grid;
  gap: 5px;
  color: var(--text-muted);
  font-size: 11px;
}

.actions-artifact-release-target select {
  width: 100%;
  min-width: 0;
  height: var(--repo-sidebar-control-height);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
  color: var(--text);
  font-size: 12px;
}

.actions-artifact-preview {
  min-width: 0;
  max-height: 360px;
  overflow: auto;
}

.actions-artifact-preview pre {
  max-height: 300px;
  margin: 0;
  overflow: auto;
  padding: 10px;
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.actions-artifact-preview img {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
  padding: 10px;
}

.actions-artifact-preview :deep(.readme-render) {
  padding: 10px;
}

.actions-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.actions-status--ok {
  color: var(--ok);
}

.actions-status--error {
  color: var(--err);
}

.actions-status--warn {
  color: var(--warn);
}

.actions-status--muted {
  color: var(--text-muted);
}

.actions-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--repo-sidebar-icon-button-size);
  height: var(--repo-sidebar-icon-button-size);
  padding: 0;
}

.actions-empty {
  margin: 0;
  padding: 8px 0;
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { ArrowLeft, GitCommitHorizontal } from "@lucide/vue";
import { useWorkspace } from "../composables/useWorkspace";
import { getRepoCommitDetail, type CommitDetail } from "../services/workspace";
import { repoDisplayName } from "../utils/repoDisplay";
import "../styles/page.css";

const route = useRoute();
const workspace = useWorkspace();
const loading = ref(false);
const error = ref<string | null>(null);
const detail = ref<CommitDetail | null>(null);

const repoId = computed(() => String(route.params.repoId ?? ""));
const hash = computed(() => String(route.params.hash ?? ""));
const summary = computed(() => workspace.repoById(repoId.value));
const repoTitle = computed(() => repoDisplayName(summary.value) || repoId.value);
const totalAdditions = computed(() =>
  detail.value?.files.reduce((sum, file) => sum + file.additions, 0) ?? 0,
);
const totalDeletions = computed(() =>
  detail.value?.files.reduce((sum, file) => sum + file.deletions, 0) ?? 0,
);

onMounted(() => {
  void load();
});

watch([repoId, hash], () => {
  void load();
});

async function load() {
  if (!repoId.value || !hash.value) return;
  loading.value = true;
  error.value = null;
  try {
    detail.value = await getRepoCommitDetail(repoId.value, hash.value);
  } catch (err) {
    error.value = String(err);
  } finally {
    loading.value = false;
  }
}

function formatTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString();
}

function fileStatusText(status: string) {
  if (status === "renamed") return "重命名";
  if (status === "added") return "新增";
  if (status === "deleted") return "删除";
  return "修改";
}
</script>

<template>
  <section class="commit-detail-page">
    <header class="commit-detail-header">
      <RouterLink class="ghost commit-detail-back" :to="`/repos/${repoId}?tab=history`">
        <ArrowLeft :size="14" aria-hidden="true" />
        返回历史
      </RouterLink>
      <div class="commit-detail-header__identity">
        <p>{{ repoTitle }}</p>
        <h1>{{ detail?.subject ?? "提交详情" }}</h1>
      </div>
    </header>

    <p v-if="error" class="error-line">{{ error }}</p>
    <p v-else-if="loading" class="muted">正在读取提交详情...</p>

    <template v-else-if="detail">
      <section class="card commit-hero" aria-label="提交元数据">
        <div class="commit-hero__icon">
          <GitCommitHorizontal :size="18" aria-hidden="true" />
        </div>
        <div class="commit-hero__body">
          <h2>{{ detail.subject }}</h2>
          <p v-if="detail.body">{{ detail.body }}</p>
          <dl class="commit-meta-grid">
            <div>
              <dt>Hash</dt>
              <dd>{{ detail.hash }}</dd>
            </div>
            <div>
              <dt>作者</dt>
              <dd>{{ detail.authorEmail ? `${detail.author} <${detail.authorEmail}>` : detail.author }}</dd>
            </div>
            <div>
              <dt>提交者</dt>
              <dd>{{ detail.committerEmail ? `${detail.committer} <${detail.committerEmail}>` : detail.committer }}</dd>
            </div>
            <div>
              <dt>时间</dt>
              <dd>{{ formatTime(detail.timestamp) }}</dd>
            </div>
            <div>
              <dt>父提交</dt>
              <dd>{{ detail.parents.length ? detail.parents.join(" · ") : "根提交" }}</dd>
            </div>
            <div>
              <dt>引用</dt>
              <dd>{{ detail.refs.length ? detail.refs.join(" · ") : "无" }}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section class="card commit-files" aria-label="改动文件列表">
        <div class="commit-files__header">
          <div>
            <h2>改动文件</h2>
            <p class="muted">
              {{ detail.files.length }} 个文件 · +{{ totalAdditions }} / -{{ totalDeletions }}
            </p>
          </div>
        </div>
        <p v-if="!detail.files.length" class="muted">此提交没有可展示的文件改动。</p>
        <div v-else class="commit-file-list">
          <div v-for="file in detail.files" :key="`${file.oldPath ?? ''}:${file.path}`" class="commit-file-row">
            <span class="commit-file-row__status">{{ fileStatusText(file.status) }}</span>
            <span class="commit-file-row__path" :title="file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path">
              <template v-if="file.oldPath">{{ file.oldPath }} -> </template>{{ file.path }}
            </span>
            <span class="commit-file-row__stat commit-file-row__stat--add">+{{ file.additions }}</span>
            <span class="commit-file-row__stat commit-file-row__stat--del">-{{ file.deletions }}</span>
          </div>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.commit-detail-page {
  display: grid;
  gap: 14px;
}

.commit-detail-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-soft);
}

.commit-detail-back {
  flex: 0 0 auto;
  text-decoration: none;
}

.commit-detail-header__identity {
  min-width: 0;
}

.commit-detail-header__identity p {
  margin: 0 0 4px;
  color: var(--text-muted);
  font-size: 12px;
}

.commit-detail-header__identity h1 {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 18px;
  font-weight: 600;
}

.commit-hero {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 12px;
}

.commit-hero__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  color: var(--accent);
  background: var(--accent-soft);
}

.commit-hero__body {
  min-width: 0;
}

.commit-hero h2 {
  color: var(--text);
  text-transform: none;
  letter-spacing: 0;
}

.commit-hero p {
  margin: 0 0 12px;
  color: var(--text-muted);
  white-space: pre-wrap;
}

.commit-meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
  margin: 0;
}

.commit-meta-grid div {
  min-width: 0;
  padding: 8px 0;
  border-top: 1px solid var(--border-soft);
}

.commit-meta-grid dt {
  color: var(--text-muted);
  font-size: 12px;
}

.commit-meta-grid dd {
  margin: 3px 0 0;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.commit-files__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.commit-files__header p {
  margin: 0;
}

.commit-file-list {
  display: grid;
}

.commit-file-row {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr) 56px 56px;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  border-top: 1px solid var(--border-soft);
}

.commit-file-row:first-child {
  border-top: 0;
}

.commit-file-row__status {
  color: var(--text-muted);
  font-size: 12px;
}

.commit-file-row__path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-file-row__stat {
  justify-self: end;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.commit-file-row__stat--add {
  color: var(--ok);
}

.commit-file-row__stat--del {
  color: var(--err);
}

.error-line {
  margin: 0;
  color: var(--err);
}

@media (max-width: 760px) {
  .commit-detail-header,
  .commit-hero,
  .commit-meta-grid {
    grid-template-columns: 1fr;
  }

  .commit-detail-header {
    display: grid;
  }

  .commit-file-row {
    grid-template-columns: 1fr 56px 56px;
    padding: 8px 0;
  }

  .commit-file-row__status {
    grid-column: 1 / -1;
  }
}
</style>

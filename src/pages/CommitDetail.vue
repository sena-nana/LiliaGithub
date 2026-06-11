<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { ArrowLeft, GitCommitHorizontal } from "@lucide/vue";
import { useWorkspace } from "../composables/useWorkspace";
import { getRepoCommitDetail, type CommitDetail } from "../services/workspace";
import {
  commitDiffLineMark,
  commitFileStatusText,
  formatRepoTime,
  repoDisplayName,
} from "../utils/repoDisplay";
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
              <dd>{{ formatRepoTime(detail.timestamp) }}</dd>
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

      <section class="card commit-files" aria-label="改动文件 diff">
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
          <article v-for="file in detail.files" :key="`${file.oldPath ?? ''}:${file.path}`" class="commit-file-diff">
            <header class="commit-file-diff__header">
              <span class="commit-file-diff__status">{{ commitFileStatusText(file.status) }}</span>
              <span class="commit-file-diff__path" :title="file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path">
                <template v-if="file.oldPath">{{ file.oldPath }} -> </template>{{ file.path }}
              </span>
              <span class="commit-file-diff__stat commit-file-diff__stat--add">+{{ file.additions }}</span>
              <span class="commit-file-diff__stat commit-file-diff__stat--del">-{{ file.deletions }}</span>
            </header>
            <div v-if="file.hunks.length" class="commit-diff-table">
              <template v-for="hunk in file.hunks" :key="`${file.path}:${hunk.header}`">
                <div class="commit-diff-hunk" role="row">
                  <span class="commit-diff-hunk__header">{{ hunk.header }}</span>
                </div>
                <div
                  v-for="(line, index) in hunk.lines"
                  :key="`${file.path}:${hunk.header}:${index}`"
                  class="commit-diff-line"
                  :class="`is-${line.kind}`"
                  role="row"
                >
                  <span class="commit-diff-line__number">{{ line.oldLine ?? "" }}</span>
                  <span class="commit-diff-line__number">{{ line.newLine ?? "" }}</span>
                  <span class="commit-diff-line__mark">{{ commitDiffLineMark(line.kind) }}</span>
                  <code class="commit-diff-line__content">{{ line.content || " " }}</code>
                </div>
              </template>
            </div>
            <p v-else class="muted commit-file-diff__empty">
              仅文件元数据变更、二进制文件或无可展示的文本差异。
            </p>
          </article>
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
  gap: 12px;
}

.commit-file-diff {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: var(--bg-elev);
}

.commit-file-diff__header {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr) 56px 56px;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg-subtle);
}

.commit-file-diff__status {
  color: var(--text-muted);
  font-size: 12px;
}

.commit-file-diff__path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 12px;
}

.commit-file-diff__stat {
  justify-self: end;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.commit-file-diff__stat--add {
  color: var(--ok);
}

.commit-file-diff__stat--del {
  color: var(--err);
}

.commit-diff-table {
  display: grid;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 12px;
}

.commit-diff-hunk,
.commit-diff-line {
  display: grid;
  grid-template-columns: 48px 48px 22px minmax(420px, 1fr);
  min-height: 24px;
}

.commit-diff-hunk {
  align-items: center;
  color: var(--accent);
  background: var(--accent-soft);
  border-top: 1px solid var(--border-soft);
}

.commit-diff-hunk:first-child {
  border-top: 0;
}

.commit-diff-hunk__header {
  grid-column: 1 / -1;
  padding: 4px 10px;
  white-space: pre;
}

.commit-diff-line {
  line-height: 1.45;
  white-space: pre;
}

.commit-diff-line.is-added {
  background: color-mix(in srgb, var(--ok) 10%, transparent);
}

.commit-diff-line.is-deleted {
  background: color-mix(in srgb, var(--err) 10%, transparent);
}

.commit-diff-line.is-meta {
  color: var(--text-muted);
}

.commit-diff-line__number,
.commit-diff-line__mark {
  padding: 3px 8px;
  color: var(--text-muted);
  text-align: right;
  user-select: none;
  border-right: 1px solid var(--border-soft);
}

.commit-diff-line__mark {
  text-align: center;
}

.commit-diff-line__content {
  min-width: 0;
  padding: 3px 10px;
  color: var(--text);
  font-family: inherit;
}

.commit-file-diff__empty {
  margin: 0;
  padding: 12px 10px;
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

  .commit-file-diff__header {
    grid-template-columns: 1fr 56px 56px;
    padding: 8px 0;
  }

  .commit-file-diff__status {
    grid-column: 1 / -1;
    padding: 0 10px;
  }

  .commit-file-diff__path {
    padding-left: 10px;
  }

  .commit-diff-hunk,
  .commit-diff-line {
    grid-template-columns: 40px 40px 20px minmax(320px, 1fr);
  }
}
</style>

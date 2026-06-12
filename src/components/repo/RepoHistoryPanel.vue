<script setup lang="ts">
import type { CommitSummary } from "../../services/workspace";
import { formatCompactRepoTime, formatRepoTime } from "../../utils/repoDisplay";

defineProps<{
  commits: readonly CommitSummary[];
  commitMetaTitle: (commit: CommitSummary) => string;
}>();

defineEmits<{
  openCommit: [commit: CommitSummary];
}>();
</script>

<template>
  <section class="repo-panel">
    <p v-if="!commits.length" class="muted repo-empty">没有提交历史。</p>
    <div v-else class="history-list" aria-label="提交历史密集列表">
      <button
        v-for="(commit, index) in commits"
        :key="commit.hash"
        type="button"
        class="history-row"
        :title="commitMetaTitle(commit)"
        @click="$emit('openCommit', commit)"
      >
        <span class="history-graph" aria-label="提交图谱">
          <span class="history-graph__line" :class="{ 'is-first': index === 0, 'is-last': index === commits.length - 1 }" />
          <span class="history-graph__node" />
        </span>
        <span class="history-row__body">
          <span class="history-row__main">
            <strong>{{ commit.subject }}</strong>
            <span class="history-row__refs" v-if="commit.refs.length">
              <span v-for="ref in commit.refs.slice(0, 3)" :key="ref">{{ ref }}</span>
            </span>
          </span>
        </span>
        <span class="history-row__tail">
          <span class="history-row__author">{{ commit.author }}</span>
          <time class="history-row__time" :datetime="new Date(commit.timestamp * 1000).toISOString()">
            {{ formatCompactRepoTime(commit.timestamp) }}
          </time>
        </span>
        <span class="history-popover" role="tooltip">
          <strong>{{ commit.subject }}</strong>
          <span>{{ commit.hash }}</span>
          <span>{{ commit.authorEmail ? `${commit.author} <${commit.authorEmail}>` : commit.author }}</span>
          <span>{{ formatRepoTime(commit.timestamp) }}</span>
          <span>{{ commit.parents.length ? `父提交 ${commit.parents.join(", ")}` : "根提交" }}</span>
          <span v-if="commit.refs.length">引用 {{ commit.refs.join(", ") }}</span>
        </span>
      </button>
    </div>
  </section>
</template>

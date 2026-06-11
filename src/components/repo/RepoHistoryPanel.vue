<script setup lang="ts">
import { GitBranch, GitCommitHorizontal } from "@lucide/vue";
import type { BranchSummary, CommitSummary } from "../../services/workspace";
import { formatCompactRepoTime, formatRepoTime } from "../../utils/repoDisplay";

defineProps<{
  commits: readonly CommitSummary[];
  branches: {
    local: readonly BranchSummary[];
    remote: readonly BranchSummary[];
  };
  refNames: readonly string[];
  commitMetaTitle: (commit: CommitSummary) => string;
}>();

defineEmits<{
  openCommit: [commit: CommitSummary];
}>();
</script>

<template>
  <section class="repo-panel">
    <div class="section-toolbar section-toolbar--compact">
      <div class="repo-panel__title">
        <h2>提交历史</h2>
        <p class="muted">按时间倒序展示最近提交</p>
      </div>
    </div>
    <p v-if="!commits.length" class="muted repo-empty">没有提交历史。</p>
    <div v-else class="history-workspace" aria-label="提交历史和分支树">
      <aside class="history-tree" aria-label="历史和分支树">
        <section>
          <h3>本地分支</h3>
          <p v-if="!branches.local.length" class="muted">无本地分支</p>
          <div v-for="branch in branches.local" :key="branch.name" class="history-tree__item">
            <GitBranch :size="13" aria-hidden="true" />
            <span :title="branch.name">{{ branch.name }}</span>
            <em v-if="branch.current">当前</em>
          </div>
        </section>
        <section>
          <h3>远端分支</h3>
          <p v-if="!branches.remote.length" class="muted">无远端分支</p>
          <div v-for="branch in branches.remote" :key="branch.name" class="history-tree__item">
            <GitBranch :size="13" aria-hidden="true" />
            <span :title="branch.name">{{ branch.name }}</span>
          </div>
        </section>
        <section v-if="refNames.length">
          <h3>历史引用</h3>
          <div v-for="refName in refNames" :key="refName" class="history-tree__item history-tree__item--ref">
            <GitCommitHorizontal :size="13" aria-hidden="true" />
            <span :title="refName">{{ refName }}</span>
          </div>
        </section>
      </aside>
      <div class="history-list" aria-label="提交历史密集列表">
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
            <span class="history-row__meta">
              <span>{{ commit.shortHash }}</span>
              <span>{{ commit.author }}</span>
            </span>
          </span>
          <time class="history-row__time" :datetime="new Date(commit.timestamp * 1000).toISOString()">
            {{ formatCompactRepoTime(commit.timestamp) }}
          </time>
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
    </div>
  </section>
</template>

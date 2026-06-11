<script setup lang="ts">
import type { CommitSummary, ProjectLaunchConfig, ProjectLaunchStatus, RepoSummary } from "../../services/workspace";
import {
  lastCommitText as repoLastCommitText,
  launchStatusText,
  syncStatusText,
  syncStatusTone,
} from "../../utils/repoDisplay";

defineProps<{
  commits: readonly CommitSummary[];
  summary: RepoSummary;
  launchStatus: ProjectLaunchStatus | null;
  launchConfig: ProjectLaunchConfig | null;
  launchRunning: boolean;
  launchState: string;
  dirtyCount: (summary?: RepoSummary | null) => number;
}>();
</script>

<template>
  <section class="repo-status-strip" aria-label="仓库状态条">
    <div class="repo-status-strip__item">
      <span>分支</span>
      <strong>{{ summary.currentBranch ?? "detached" }}</strong>
    </div>
    <div class="repo-status-strip__item">
      <span>同步</span>
      <strong :class="syncStatusTone(summary)">{{ syncStatusText(summary) }}</strong>
    </div>
    <div class="repo-status-strip__item">
      <span>冲突</span>
      <strong :class="{ 'repo-status-strip__value--err': summary.conflictCount > 0 }">{{ summary.conflictCount }}</strong>
    </div>
    <div class="repo-status-strip__item">
      <span>变更</span>
      <strong :class="{ 'repo-status-strip__value--warn': dirtyCount(summary) > 0 }">{{ dirtyCount(summary) }}</strong>
    </div>
    <div class="repo-status-strip__item">
      <span>最近提交</span>
      <strong :title="repoLastCommitText(commits, summary)">{{ repoLastCommitText(commits, summary) }}</strong>
    </div>
    <div class="repo-status-strip__item">
      <span>启动</span>
      <strong :class="{ 'repo-status-strip__value--accent': launchRunning, 'repo-status-strip__value--warn': launchState === 'error' }">
        {{ launchConfig?.command.trim() ? launchStatusText(launchStatus) : "未配置" }}
      </strong>
    </div>
    <div class="repo-status-strip__item">
      <span>远端</span>
      <strong>{{ summary.githubFullName ?? "未识别 GitHub" }}</strong>
    </div>
  </section>
</template>

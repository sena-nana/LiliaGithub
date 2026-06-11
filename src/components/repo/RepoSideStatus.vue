<script setup lang="ts">
import { Play, Settings, Square, Terminal } from "@lucide/vue";
import type { ProjectLaunchConfig, ProjectLaunchStatus, RepoSummary } from "../../services/workspace";
import {
  launchSourceText,
  launchStatusText,
  syncStatusText,
  syncStatusTone,
} from "../../utils/repoDisplay";

defineProps<{
  summary: RepoSummary;
  launchConfig: ProjectLaunchConfig | null;
  launchStatus: ProjectLaunchStatus | null;
  actionRunning: boolean;
  launchRunning: boolean;
  hasLaunchCommand: boolean;
  dirtyCount: (summary?: RepoSummary | null) => number;
}>();

defineEmits<{
  start: [];
  stop: [];
  toggleTerminal: [];
  editConfig: [];
}>();
</script>

<template>
  <section class="card repo-side-status" aria-label="仓库健康与执行状态">
    <div class="section-toolbar section-toolbar--compact">
      <div class="repo-panel__title">
        <h2>仓库健康</h2>
        <p class="muted">当前仓库的关键巡检信号</p>
      </div>
    </div>
    <dl class="side-kv">
      <div>
        <dt>当前分支</dt>
        <dd>{{ summary.currentBranch ?? "detached" }}</dd>
      </div>
      <div>
        <dt>同步状态</dt>
        <dd :class="syncStatusTone(summary)">{{ syncStatusText(summary) }}</dd>
      </div>
      <div>
        <dt>冲突数量</dt>
        <dd :class="{ 'repo-status-strip__value--err': summary.conflictCount > 0 }">{{ summary.conflictCount }}</dd>
      </div>
      <div>
        <dt>工作区变更</dt>
        <dd :class="{ 'repo-status-strip__value--warn': dirtyCount(summary) > 0 }">{{ dirtyCount(summary) }}</dd>
      </div>
      <div>
        <dt>启动状态</dt>
        <dd>{{ hasLaunchCommand ? launchStatusText(launchStatus) : "未配置" }}</dd>
      </div>
      <div>
        <dt>启动来源</dt>
        <dd>{{ hasLaunchCommand ? launchSourceText(launchConfig) : "无" }}</dd>
      </div>
    </dl>
    <div class="repo-side-status__actions">
      <button type="button" class="primary" :disabled="actionRunning || !hasLaunchCommand || launchRunning" @click="$emit('start')">
        <Play :size="14" aria-hidden="true" />
        运行
      </button>
      <button type="button" class="ghost" :disabled="actionRunning || !launchRunning" @click="$emit('stop')">
        <Square :size="14" aria-hidden="true" />
        停止
      </button>
      <button type="button" class="ghost" @click="$emit('toggleTerminal')">
        <Terminal :size="14" aria-hidden="true" />
        终端
      </button>
      <button type="button" class="ghost" @click="$emit('editConfig')">
        <Settings :size="14" aria-hidden="true" />
        启动配置
      </button>
    </div>
  </section>
</template>

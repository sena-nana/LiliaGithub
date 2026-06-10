<script setup lang="ts">
import { computed } from "vue";
import {
  CheckCircle2,
  FolderOpen,
  GitPullRequestArrow,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
} from "@lucide/vue";
import { useWorkspace } from "../composables/useWorkspace";
import "../styles/page.css";

const workspace = useWorkspace();

const sortedDirtyRepos = computed(() =>
  [...workspace.state.repos]
    .sort((a, b) =>
      (b.stagedCount + b.unstagedCount + b.untrackedCount) -
      (a.stagedCount + a.unstagedCount + a.untrackedCount)
    )
    .slice(0, 6),
);

function dirtyCount(repo: { stagedCount: number; unstagedCount: number; untrackedCount: number }) {
  return repo.stagedCount + repo.unstagedCount + repo.untrackedCount;
}

function formatTime(timestamp: number | null) {
  if (!timestamp) return "无提交";
  return new Date(timestamp * 1000).toLocaleString();
}
</script>

<template>
  <section :class="{ 'setup-page': !workspace.isReady.value }">
    <div v-if="!workspace.isReady.value" class="setup-screen">
      <div class="page-header">
        <div>
          <h1>LiliaGithub 初始化</h1>
          <p>选择本地工作区并完成 GitHub 授权后进入仓库工作台。</p>
        </div>
      </div>

      <div class="setup-list">
        <div class="setup-step" :class="{ 'is-done': workspace.workspaceRoot.value }">
          <div class="setup-step__icon">
            <FolderOpen :size="18" aria-hidden="true" />
          </div>
          <div class="setup-step__content">
            <h2>工作区文件夹</h2>
            <p class="muted">
              {{ workspace.workspaceRoot.value ?? "尚未选择。本应用会扫描该文件夹下的 Git 仓库。" }}
            </p>
          </div>
          <div class="setup-step__action">
            <button type="button" class="primary" @click="workspace.chooseWorkspaceRoot">
              <FolderOpen :size="14" aria-hidden="true" />
              选择工作区
            </button>
          </div>
        </div>

        <div class="setup-step" :class="{ 'is-done': workspace.isAuthorized.value }">
          <div class="setup-step__icon">
            <ShieldCheck :size="18" aria-hidden="true" />
          </div>
          <div class="setup-step__content">
            <h2>GitHub 授权</h2>
            <p class="muted">
              <template v-if="workspace.githubBinding.value">
                已识别共享凭证：{{ workspace.githubBinding.value.login }}
              </template>
              <template v-else>
                复用 LiliaCode 的 GitHub 设备码授权和系统钥匙串凭证。
              </template>
            </p>
            <p v-if="workspace.deviceFlow.value" class="setup-code">
              设备码 <code>{{ workspace.deviceFlow.value.userCode }}</code>
            </p>
          </div>
          <div class="setup-step__action">
            <div class="setup-actions">
              <button
                type="button"
                class="primary"
                :disabled="workspace.state.authLoading"
                @click="workspace.startAuthFlow"
              >
                <ShieldCheck :size="14" aria-hidden="true" />
                绑定 GitHub
              </button>
              <button
                v-if="workspace.deviceFlow.value"
                type="button"
                class="ghost"
                :disabled="workspace.state.authLoading"
                @click="workspace.pollAuthFlow"
              >
                检查授权
              </button>
            </div>
          </div>
        </div>
      </div>

      <p v-if="workspace.state.error" class="error-line">{{ workspace.state.error }}</p>
    </div>

    <template v-else>
      <div class="page-header">
        <div>
          <h1>项目总览</h1>
          <p>{{ workspace.workspaceRoot.value }} · {{ workspace.githubBinding.value?.login }}</p>
        </div>
        <div class="toolbar">
          <button type="button" class="ghost" :disabled="workspace.state.scanning" @click="workspace.refreshRepos">
            <RefreshCw :size="14" aria-hidden="true" />
            刷新
          </button>
          <button type="button" class="ghost" @click="workspace.previewBulk('pull')">
            <GitPullRequestArrow :size="14" aria-hidden="true" />
            一键拉取
          </button>
          <button type="button" class="primary" @click="workspace.previewBulk('push')">
            <Upload :size="14" aria-hidden="true" />
            一键推送
          </button>
        </div>
      </div>

      <div class="metric-grid">
        <div class="card metric">
          <span>仓库</span>
          <strong>{{ workspace.overviewStats.value.totalRepos }}</strong>
        </div>
        <div class="card metric">
          <span>存在变更</span>
          <strong>{{ workspace.overviewStats.value.dirtyRepos }}</strong>
        </div>
        <div class="card metric">
          <span>可拉取</span>
          <strong>{{ workspace.overviewStats.value.pullable }}</strong>
        </div>
        <div class="card metric">
          <span>待推送</span>
          <strong>{{ workspace.overviewStats.value.pushable }}</strong>
        </div>
      </div>

      <div class="overview-grid">
        <div class="card">
          <h2>最近工作结果</h2>
          <div class="chart-row">
            <div
              v-for="point in workspace.overviewStats.value.commitsByDay"
              :key="point.day"
              class="chart-bar"
            >
              <div class="chart-bar__track">
                <span :style="{ height: `${Math.max(10, point.count * 22)}px` }" />
              </div>
              <small>{{ point.day }}</small>
            </div>
          </div>
        </div>

        <div class="card">
          <h2>变更量排行</h2>
          <ul class="repo-list">
            <li v-for="repo in sortedDirtyRepos" :key="repo.id">
              <span>{{ repo.name }}</span>
              <strong>{{ dirtyCount(repo) }}</strong>
            </li>
          </ul>
        </div>
      </div>

      <div class="card">
        <h2>仓库状态</h2>
        <table class="repo-table">
          <thead>
            <tr>
              <th>仓库</th>
              <th>分支</th>
              <th>变更</th>
              <th>同步</th>
              <th>最近提交</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="repo in workspace.state.repos" :key="repo.id">
              <td>{{ repo.name }}</td>
              <td>{{ repo.currentBranch ?? "detached" }}</td>
              <td>{{ dirtyCount(repo) }}</td>
              <td>↑{{ repo.ahead }} / ↓{{ repo.behind }}</td>
              <td>{{ formatTime(repo.lastCommitAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <div v-if="workspace.state.bulkPreview" class="modal-backdrop" role="presentation">
      <div class="modal" role="dialog" aria-modal="true" aria-label="批量同步预检">
        <div class="modal__header">
          <div>
            <h2>{{ workspace.state.bulkPreview.operation === "pull" ? "一键拉取预检" : "一键推送预检" }}</h2>
            <p class="muted">确认后按队列逐仓库执行，错误不会中断后续仓库。</p>
          </div>
          <button type="button" class="ghost" aria-label="关闭" @click="workspace.closeBulkPreview">
            <X :size="14" aria-hidden="true" />
          </button>
        </div>

        <div class="sync-columns">
          <div>
            <h3>可执行</h3>
            <p v-if="!workspace.state.bulkPreview.eligible.length" class="muted">没有可执行仓库。</p>
            <ul>
              <li v-for="item in workspace.state.bulkPreview.eligible" :key="item.repo.id">
                <CheckCircle2 :size="13" aria-hidden="true" />
                <span>{{ item.repo.name }}</span>
                <em>{{ item.reason }}</em>
              </li>
            </ul>
          </div>
          <div>
            <h3>阻止</h3>
            <p v-if="!workspace.state.bulkPreview.blocked.length" class="muted">没有阻止项。</p>
            <ul>
              <li v-for="item in workspace.state.bulkPreview.blocked" :key="item.repo.id">
                <X :size="13" aria-hidden="true" />
                <span>{{ item.repo.name }}</span>
                <em>{{ item.reason }}</em>
              </li>
            </ul>
          </div>
        </div>

        <div v-if="workspace.state.bulkResults.length" class="sync-results">
          <h3>执行结果</h3>
          <p v-for="result in workspace.state.bulkResults" :key="result.repoId">
            {{ result.repoId }} · {{ result.status }} · {{ result.message }}
          </p>
        </div>

        <div class="modal__footer">
          <button type="button" class="ghost" @click="workspace.closeBulkPreview">取消</button>
          <button
            type="button"
            class="primary"
            :disabled="workspace.state.bulkRunning || !workspace.state.bulkPreview.eligible.length"
            @click="workspace.executeBulk"
          >
            确认执行
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.overview-grid,
.metric-grid {
  display: grid;
  gap: 12px;
}

.setup-screen {
  width: min(920px, 100%);
  min-height: 100%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.setup-page {
  min-height: 100%;
}

.setup-screen .page-header {
  margin-bottom: 24px;
}

.setup-list {
  border-top: 1px solid var(--border-soft);
  border-bottom: 1px solid var(--border-soft);
}

.overview-grid {
  grid-template-columns: 1.3fr 1fr;
}

.metric-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.setup-step {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  min-height: 96px;
  padding: 18px 0;
  border-bottom: 1px solid var(--border-soft);
}

.setup-step:last-child {
  border-bottom: 0;
}

.setup-step__icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.setup-step.is-done .setup-step__icon {
  background: var(--ok-soft);
  color: var(--ok);
}

.setup-step__content {
  min-width: 0;
}

.setup-step__content h2 {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
}

.setup-step__content p {
  margin: 0;
  overflow-wrap: anywhere;
}

.setup-step__action {
  display: flex;
  justify-content: flex-end;
}

.setup-actions,
.toolbar {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.setup-code,
.error-line {
  margin: 10px 0 0;
}

.error-line {
  color: var(--err);
}

.metric {
  margin: 0;
}

.metric span {
  color: var(--text-muted);
  font-size: 12px;
}

.metric strong {
  display: block;
  margin-top: 4px;
  font-size: 24px;
  line-height: 1;
}

.chart-row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
  align-items: end;
  min-height: 150px;
}

.chart-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.chart-bar__track {
  width: 100%;
  height: 110px;
  display: flex;
  align-items: end;
  justify-content: center;
  border-bottom: 1px solid var(--border-soft);
}

.chart-bar__track span {
  width: 60%;
  max-width: 34px;
  border-radius: 4px 4px 0 0;
  background: var(--accent);
}

.chart-bar small {
  color: var(--text-faint);
  font-size: 11px;
}

.repo-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.repo-list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border-soft);
}

.repo-list li:last-child {
  border-bottom: 0;
}

.repo-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.repo-table th,
.repo-table td {
  padding: 8px 6px;
  text-align: left;
  border-bottom: 1px solid var(--border-soft);
}

.repo-table th {
  color: var(--text-muted);
  font-weight: 600;
}

.modal-backdrop {
  position: fixed;
  inset: 36px 0 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
}

.modal {
  width: min(760px, calc(100vw - 48px));
  max-height: calc(100vh - 88px);
  overflow: auto;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
}

.modal__header,
.modal__footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.modal__header {
  align-items: flex-start;
  margin-bottom: 14px;
}

.modal__header h2,
.sync-columns h3,
.sync-results h3 {
  margin: 0 0 4px;
  font-size: 13px;
}

.modal__footer {
  justify-content: flex-end;
  margin-top: 16px;
}

.sync-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.sync-columns ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.sync-columns li {
  display: grid;
  grid-template-columns: 16px 1fr;
  gap: 4px 6px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border-soft);
}

.sync-columns em {
  grid-column: 2;
  color: var(--text-muted);
  font-size: 12px;
  font-style: normal;
}

.sync-results {
  margin-top: 14px;
}

.sync-results p {
  margin: 4px 0;
  color: var(--text-muted);
}

@media (max-width: 900px) {
  .overview-grid,
  .metric-grid,
  .sync-columns {
    grid-template-columns: 1fr;
  }

  .setup-step {
    grid-template-columns: 34px minmax(0, 1fr);
  }

  .setup-step__action {
    grid-column: 2;
    justify-content: flex-start;
  }
}
</style>

<script setup lang="ts">
import { computed } from "vue";
import {
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  FolderOpen,
  GitPullRequestArrow,
  Info,
  LoaderCircle,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Upload,
  X,
} from "@lucide/vue";
import type { RepoSummary } from "../services/workspace";
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

const authStatusText = computed(() => {
  switch (workspace.state.authFlowStatus) {
    case "pending":
      return "等待 GitHub 授权确认";
    case "expired":
      return "设备码已过期";
    case "error":
      return "授权检查失败";
    default:
      return null;
  }
});

const authRemainingText = computed(() => {
  const seconds = workspace.state.authRemainingSeconds;
  if (seconds == null) return null;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
});

const commitChartMax = computed(() =>
  Math.max(1, ...workspace.overviewStats.value.commitsByDay.map((point) => point.count)),
);

const recentPushIssueRows = computed(() => {
  const recent = workspace.state.recentPush;
  if (!recent) return [];
  const repos = new Map<string, RepoSummary>();
  for (const repo of workspace.state.repos) repos.set(repo.id, repo);
  for (const item of [...recent.preview.eligible, ...recent.preview.blocked, ...recent.preview.warnings]) {
    repos.set(item.repo.id, item.repo);
  }
  const rows = recent.results
    .filter((result) => result.status === "error")
    .map((result) => ({
      repoId: result.repoId,
      repoName: repos.get(result.repoId)?.name ?? result.repoId,
      reason: result.message,
      source: "执行失败",
      retrying: recent.retryingRepoIds.includes(result.repoId),
    }));
  for (const item of recent.preview.blocked) {
    if (rows.some((row) => row.repoId === item.repo.id)) continue;
    rows.push({
      repoId: item.repo.id,
      repoName: repos.get(item.repo.id)?.name ?? item.repo.name,
      reason: item.reason,
      source: "预检阻止",
      retrying: recent.retryingRepoIds.includes(item.repo.id),
    });
  }
  return rows;
});

function dirtyCount(repo: { stagedCount: number; unstagedCount: number; untrackedCount: number }) {
  return repo.stagedCount + repo.unstagedCount + repo.untrackedCount;
}

function formatTime(timestamp: number | null) {
  if (!timestamp) return "无提交";
  return new Date(timestamp * 1000).toLocaleString();
}

function bulkResultTone(result: { status: string }) {
  return result.status === "success" ? "sync-results__item--success" : "sync-results__item--error";
}

async function retryRecentPush(repoId: string) {
  try {
    await workspace.push(repoId);
  } catch {
  }
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
            <div v-if="workspace.deviceFlow.value" class="auth-flow">
              <p class="setup-code">
                设备码 <code>{{ workspace.deviceFlow.value.userCode }}</code>
              </p>
              <p
                class="auth-flow__status"
                :class="{
                  'is-error': workspace.state.authFlowStatus === 'error',
                  'is-expired': workspace.state.authFlowStatus === 'expired',
                }"
              >
                <span>{{ authStatusText }}</span>
                <span v-if="authRemainingText">剩余 {{ authRemainingText }}</span>
              </p>
            </div>
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
                {{ workspace.deviceFlow.value ? "重新绑定 GitHub" : "绑定 GitHub" }}
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
          <button type="button" class="primary" :disabled="workspace.state.bulkRunning" @click="workspace.pushAll">
            <LoaderCircle
              v-if="workspace.state.bulkRunning && workspace.state.bulkPreview?.operation === 'push'"
              :size="14"
              aria-hidden="true"
              class="sb-spin"
            />
            <Upload v-else :size="14" aria-hidden="true" />
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

      <div v-if="recentPushIssueRows.length" class="card push-workflow" aria-label="最近推送失败">
        <div class="push-workflow__header">
          <div>
            <h2>最近推送失败</h2>
            <p>{{ recentPushIssueRows.length }} 个仓库需要处理</p>
          </div>
          <button type="button" class="ghost" :disabled="workspace.state.bulkRunning" @click="workspace.pushAll">
            <Upload :size="14" aria-hidden="true" />
            重新预检
          </button>
        </div>
        <ul class="push-workflow__list">
          <li v-for="row in recentPushIssueRows" :key="row.repoId">
            <AlertCircle :size="14" aria-hidden="true" />
            <div class="push-workflow__repo">
              <strong>{{ row.repoName }}</strong>
              <span>{{ row.source }} · {{ row.reason }}</span>
            </div>
            <RouterLink class="ghost push-workflow__action" :to="`/repos/${encodeURIComponent(row.repoId)}`">
              <ArrowRight :size="14" aria-hidden="true" />
              详情
            </RouterLink>
            <button
              type="button"
              class="primary push-workflow__action"
              :disabled="row.retrying"
              @click="retryRecentPush(row.repoId)"
            >
              <LoaderCircle v-if="row.retrying" :size="14" aria-hidden="true" class="sb-spin" />
              <RotateCw v-else :size="14" aria-hidden="true" />
              重试
            </button>
          </li>
        </ul>
      </div>

      <div class="overview-grid">
        <div class="card chart-card">
          <h2>最近工作结果</h2>
          <div class="chart-row">
            <div
              v-for="point in workspace.overviewStats.value.commitsByDay"
              :key="point.day"
              class="chart-bar"
            >
              <div class="chart-bar__track">
                <span :style="{ height: `${(point.count / commitChartMax) * 100}%` }" />
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
          <div>
            <h3>提示</h3>
            <p v-if="!workspace.state.bulkPreview.warnings.length" class="muted">没有提示项。</p>
            <ul>
              <li v-for="item in workspace.state.bulkPreview.warnings" :key="item.repo.id">
                <Info :size="13" aria-hidden="true" />
                <span>{{ item.repo.name }}</span>
                <em>{{ item.reason }}</em>
              </li>
            </ul>
          </div>
        </div>

        <div v-if="workspace.state.bulkResults.length" class="sync-results">
          <h3>执行结果</h3>
          <ul>
            <li
              v-for="result in workspace.state.bulkResults"
              :key="result.repoId"
              :class="bulkResultTone(result)"
              class="sync-results__item"
            >
              <CheckCircle2 v-if="result.status === 'success'" :size="13" aria-hidden="true" />
              <AlertCircle v-else :size="13" aria-hidden="true" />
              <span>{{ result.repoId }}</span>
              <em>{{ result.message }}</em>
            </li>
          </ul>
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

.auth-flow {
  display: grid;
  gap: 6px;
  margin-top: 10px;
}

.auth-flow .setup-code {
  margin: 0;
}

.auth-flow__status {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.auth-flow__status.is-expired,
.auth-flow__status.is-error {
  color: var(--err);
}

.error-line {
  color: var(--err);
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

.push-workflow__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.push-workflow__header h2 {
  margin-bottom: 4px;
}

.push-workflow__header p {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.push-workflow__list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.push-workflow__list li {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border-soft);
  color: var(--err);
}

.push-workflow__list li:last-child {
  border-bottom: 0;
}

.push-workflow__repo {
  min-width: 0;
  color: var(--text);
}

.push-workflow__repo strong,
.push-workflow__repo span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.push-workflow__repo strong {
  font-size: 13px;
}

.push-workflow__repo span {
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 12px;
}

.push-workflow__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 9px;
  border-radius: 6px;
  color: var(--text);
  font-size: 12px;
  text-decoration: none;
}

.push-workflow__action.ghost:hover {
  background: var(--bg-hover);
}

.chart-row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
  align-content: end;
  align-items: end;
  min-height: 150px;
}

.chart-card {
  display: flex;
  flex-direction: column;
}

.chart-card .chart-row {
  flex: 1;
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
  min-height: 10px;
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
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

.sync-results ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.sync-results__item {
  display: grid;
  grid-template-columns: 16px minmax(0, auto) 1fr;
  gap: 4px 6px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border-soft);
}

.sync-results__item:last-child {
  border-bottom: 0;
}

.sync-results__item em {
  color: var(--text-muted);
  font-size: 12px;
  font-style: normal;
}

.sync-results__item--success {
  color: var(--ok);
}

.sync-results__item--error {
  color: var(--err);
}

@media (max-width: 900px) {
  .overview-grid,
  .metric-grid,
  .sync-columns {
    grid-template-columns: 1fr;
  }

  .push-workflow__list li {
    grid-template-columns: 18px minmax(0, 1fr);
  }

  .push-workflow__action {
    grid-column: 2;
    justify-self: start;
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

<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import {
  CheckCircle2,
  AlertCircle,
  FolderOpen,
  GitPullRequestArrow,
  Info,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from "@lucide/vue";
import { useWorkspace } from "../composables/useWorkspace";
import { syncErrorByRepoId } from "../composables/workspace/state";
import type { GitHubContributionDay, RepoSummary } from "../services/workspace";
import { bulkResultTone, formatNullableRepoTime } from "../utils/repoDisplay";
import "../styles/page.css";

const workspace = useWorkspace();
const syncErrors = computed(() => syncErrorByRepoId());

type RepoAction = {
  status: string;
  label: string;
  tone: "error" | "warn";
  title: string;
  to: string;
};

type RepoStatusRow = {
  repo: RepoSummary;
  action: RepoAction | null;
};

type ContributionCell = GitHubContributionDay & {
  level: number;
};

const contributionWeeks = computed(() => buildContributionWeeks(workspace.state.githubContributions.days));

const totalContributions = computed(() =>
  workspace.state.githubContributions.days.reduce((total, day) => total + day.count, 0),
);

const sortedDirtyRepos = computed(() =>
  [...workspace.state.repos]
    .sort((a, b) =>
      (b.stagedCount + b.unstagedCount + b.untrackedCount) -
      (a.stagedCount + a.unstagedCount + a.untrackedCount)
    )
    .slice(0, 6),
);

const repoStatusRows = computed<RepoStatusRow[]>(() =>
  workspace.state.repos.map((repo) => ({
    repo,
    action: repoAction(repo),
  })),
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

function dirtyCount(repo: { stagedCount: number; unstagedCount: number; untrackedCount: number }) {
  return repo.stagedCount + repo.unstagedCount + repo.untrackedCount;
}

function repoDetailPath(repo: Pick<RepoSummary, "id">, tab?: "conflicts") {
  const path = `/repos/${encodeURIComponent(repo.id)}`;
  return tab ? `${path}?tab=${tab}` : path;
}

function repoAction(repo: RepoSummary): RepoAction | null {
  const syncError = syncErrors.value.get(repo.id);
  if (syncError) {
    return {
      status: "同步失败",
      label: "处理失败",
      tone: "error",
      title: syncError,
      to: repoDetailPath(repo),
    };
  }
  if (repo.conflictCount > 0) {
    return {
      status: "存在冲突",
      label: "处理冲突",
      tone: "error",
      title: `${repo.conflictCount} 个冲突待处理`,
      to: repoDetailPath(repo, "conflicts"),
    };
  }
  if (repo.behind > 0) {
    return {
      status: "待拉取",
      label: "继续处理",
      tone: "warn",
      title: `远端领先 ${repo.behind} 个提交`,
      to: repoDetailPath(repo),
    };
  }
  return null;
}

function buildContributionWeeks(days: readonly GitHubContributionDay[]) {
  if (!days.length) return [];
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const maxCount = Math.max(1, ...sorted.map((day) => day.count));
  const start = parseDateOnly(sorted[0].date);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = parseDateOnly(sorted[sorted.length - 1].date);
  end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));
  const byDate = new Map(sorted.map((day) => [day.date, day]));
  const weeks: ContributionCell[][] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
    const week: ContributionCell[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(cursor);
      date.setUTCDate(cursor.getUTCDate() + offset);
      const key = date.toISOString().slice(0, 10);
      const day = byDate.get(key) ?? { date: key, count: 0 };
      week.push({
        ...day,
        level: contributionLevel(day.count, maxCount),
      });
    }
    weeks.push(week);
  }
  return weeks;
}

function parseDateOnly(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

function contributionLevel(count: number, maxCount: number) {
  if (count <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / maxCount) * 4)));
}

function contributionTitle(day: GitHubContributionDay) {
  return `${day.date}：${day.count} 次提交`;
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
          <button type="button" class="primary" :disabled="workspace.state.bulkRunning" @click="workspace.syncAll">
            <LoaderCircle
              v-if="workspace.state.bulkRunning && workspace.state.bulkPreview?.operation === 'sync'"
              :size="14"
              aria-hidden="true"
              class="sb-spin"
            />
            <GitPullRequestArrow v-else :size="14" aria-hidden="true" />
            一键同步
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
        <div class="card contribution-card">
          <div class="card-heading">
            <div>
              <h2>最近工作结果</h2>
              <p class="contribution-total">{{ totalContributions }} 次提交，最近一年</p>
            </div>
            <button
              v-if="workspace.state.githubContributions.error"
              type="button"
              class="ghost contribution-retry"
              :disabled="workspace.state.githubContributions.loading"
              @click="workspace.refreshRepoContributions"
            >
              <RefreshCw :size="13" aria-hidden="true" />
              重试
            </button>
          </div>
          <p v-if="workspace.state.githubContributions.error" class="contribution-error">
            {{ workspace.state.githubContributions.error }}
          </p>
          <div
            v-if="workspace.state.githubContributions.loading"
            class="contribution-loading"
            aria-label="GitHub 提交贡献加载中"
          >
            <span v-for="index in 84" :key="index" />
          </div>
          <p
            v-else-if="!workspace.state.githubContributions.days.length && !workspace.state.githubContributions.error"
            class="contribution-empty"
          >
            暂无 GitHub 提交
          </p>
          <div v-else class="contribution-chart" aria-label="GitHub 提交贡献图">
            <div class="contribution-week-labels" aria-hidden="true">
              <span />
              <span>Mon</span>
              <span />
              <span>Wed</span>
              <span />
              <span>Fri</span>
              <span />
            </div>
            <div class="contribution-weeks">
              <div
                v-for="(week, weekIndex) in contributionWeeks"
                :key="weekIndex"
                class="contribution-week"
              >
                <span
                  v-for="day in week"
                  :key="day.date"
                  class="contribution-day"
                  :class="`contribution-day--${day.level}`"
                  :title="contributionTitle(day)"
                  :aria-label="contributionTitle(day)"
                />
              </div>
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
              <th>状态</th>
              <th>处理</th>
              <th>最近提交</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="{ repo, action } in repoStatusRows" :key="repo.id">
              <td>{{ repo.name }}</td>
              <td>{{ repo.currentBranch ?? "detached" }}</td>
              <td>{{ dirtyCount(repo) }}</td>
              <td>↑{{ repo.ahead }} / ↓{{ repo.behind }}</td>
              <td>
                <span
                  v-if="action"
                  class="repo-action-status"
                  :class="`repo-action-status--${action.tone}`"
                  :title="action.title"
                >
                  {{ action.status }}
                </span>
                <span v-else class="repo-action-status repo-action-status--muted">正常</span>
              </td>
              <td>
                <RouterLink
                  v-if="action"
                  class="repo-action-link"
                  :to="action.to"
                  :title="action.title"
                >
                  {{ action.label }}
                </RouterLink>
              </td>
              <td>{{ formatNullableRepoTime(repo.lastCommitAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <div v-if="workspace.state.bulkPreview?.operation === 'pull'" class="modal-backdrop" role="presentation">
      <div class="modal" role="dialog" aria-modal="true" aria-label="批量同步预检">
        <div class="modal__header">
          <div>
            <h2>一键拉取预检</h2>
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
            @click="workspace.executeBulk()"
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

.contribution-card {
  display: flex;
  flex-direction: column;
}

.card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.card-heading h2 {
  margin: 0;
}

.contribution-total {
  margin: 3px 0 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.contribution-retry {
  height: 26px;
  padding: 0 7px;
  color: var(--ok);
}

.contribution-error,
.contribution-empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.contribution-error {
  color: var(--err);
  margin-bottom: 8px;
}

.contribution-chart {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.contribution-week-labels {
  display: grid;
  grid-template-rows: repeat(7, 11px);
  gap: 3px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 11px;
}

.contribution-weeks {
  display: flex;
  gap: 3px;
  min-width: max-content;
}

.contribution-week {
  display: grid;
  grid-template-rows: repeat(7, 11px);
  gap: 3px;
}

.contribution-day {
  width: 11px;
  height: 11px;
  border-radius: 2px;
  border: 1px solid color-mix(in srgb, var(--bg) 20%, transparent);
  background: var(--bg-subtle);
}

.contribution-day--1 {
  background: color-mix(in srgb, var(--ok) 30%, var(--bg-subtle));
}

.contribution-day--2 {
  background: color-mix(in srgb, var(--ok) 55%, var(--bg-subtle));
}

.contribution-day--3 {
  background: color-mix(in srgb, var(--ok) 78%, var(--bg-subtle));
}

.contribution-day--4 {
  background: #3fb950;
}

.contribution-loading {
  display: grid;
  grid-template-columns: repeat(21, 11px);
  gap: 3px;
  min-height: 98px;
}

.contribution-loading span {
  width: 11px;
  height: 11px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--ok) 14%, var(--bg-subtle));
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

.repo-action-status {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.repo-action-status--error {
  color: var(--err);
  background: var(--err-soft);
}

.repo-action-status--warn {
  color: var(--warn);
  background: var(--warn-soft);
}

.repo-action-status--muted {
  color: var(--text-muted);
  background: var(--bg-subtle);
}

.repo-action-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 0 9px;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  color: var(--text);
  background: var(--bg-subtle);
  text-decoration: none;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.repo-action-link:hover,
.repo-action-link:focus-visible {
  border-color: var(--border);
  background: var(--bg-hover);
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

  .setup-step {
    grid-template-columns: 34px minmax(0, 1fr);
  }

  .setup-step__action {
    grid-column: 2;
    justify-content: flex-start;
  }
}
</style>

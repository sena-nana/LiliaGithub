<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  Check,
  ExternalLink,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  RefreshCw,
  Upload,
} from "@lucide/vue";
import { useWorkspace } from "../composables/useWorkspace";
import type { RepoChange } from "../services/workspace";
import "../styles/page.css";

type RepoTab = "changes" | "history" | "branches" | "commit";

const route = useRoute();
const workspace = useWorkspace();
const activeTab = ref<RepoTab>("changes");
const selectedFiles = ref<Set<string>>(new Set());
const commitMessage = ref("");
const pushAfter = ref(true);
const actionError = ref<string | null>(null);
const actionRunning = ref(false);

const repoId = computed(() => String(route.params.repoId ?? ""));
const detail = computed(() => workspace.state.repoDetails[repoId.value] ?? null);
const summary = computed(() => detail.value?.summary ?? workspace.repoById(repoId.value));
const changes = computed(() => detail.value?.changes ?? []);
const selectedFileList = computed(() => Array.from(selectedFiles.value));
const canCommit = computed(() => selectedFiles.value.size > 0 && commitMessage.value.trim().length > 0);

const tabs: Array<{ key: RepoTab; label: string }> = [
  { key: "changes", label: "变更" },
  { key: "history", label: "历史" },
  { key: "branches", label: "分支" },
  { key: "commit", label: "提交" },
];

onMounted(() => {
  void load();
});

watch(repoId, () => {
  selectedFiles.value = new Set();
  commitMessage.value = "";
  void load();
});

async function load() {
  if (!repoId.value) return;
  actionError.value = null;
  try {
    await workspace.loadRepoDetail(repoId.value);
  } catch (err) {
    actionError.value = String(err);
  }
}

function dirtyCount(changeSummary = summary.value) {
  if (!changeSummary) return 0;
  return changeSummary.stagedCount + changeSummary.unstagedCount + changeSummary.untrackedCount;
}

function toggleFile(path: string) {
  const next = new Set(selectedFiles.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  selectedFiles.value = next;
}

function selectAll() {
  selectedFiles.value = new Set(changes.value.map((change) => change.path));
}

async function runAction(action: () => Promise<unknown>) {
  actionRunning.value = true;
  actionError.value = null;
  try {
    await action();
  } catch (err) {
    actionError.value = String(err);
  } finally {
    actionRunning.value = false;
  }
}

function stageSelected() {
  void runAction(async () => {
    await workspace.stage(repoId.value, selectedFileList.value);
    selectedFiles.value = new Set();
  });
}

function unstageSelected() {
  void runAction(async () => {
    await workspace.unstage(repoId.value, selectedFileList.value);
    selectedFiles.value = new Set();
  });
}

function commitSelected() {
  void runAction(async () => {
    await workspace.commit(repoId.value, selectedFileList.value, commitMessage.value, pushAfter.value);
    selectedFiles.value = new Set();
    commitMessage.value = "";
  });
}

function pull() {
  void runAction(() => workspace.pull(repoId.value));
}

function push() {
  void runAction(() => workspace.push(repoId.value));
}

function checkout(branch: string) {
  void runAction(() => workspace.checkout(repoId.value, branch));
}

function openGitHub() {
  if (!summary.value?.githubFullName) return;
  void workspace.openUrl(`https://github.com/${summary.value.githubFullName}`);
}

function openFolder() {
  if (!summary.value?.path) return;
  void workspace.openPath(summary.value.path);
}

function statusText(change: RepoChange) {
  if (change.untracked) return "未跟踪";
  if (change.staged && change.unstaged) return "已暂存/有修改";
  if (change.staged) return "已暂存";
  return "未暂存";
}

function formatTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString();
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ summary?.name ?? "仓库" }}</h1>
        <p>{{ summary?.path ?? repoId }}</p>
      </div>
      <div class="toolbar">
        <button type="button" class="ghost" :disabled="actionRunning" @click="load">
          <RefreshCw :size="14" aria-hidden="true" />
          刷新
        </button>
        <button type="button" class="ghost" :disabled="actionRunning || dirtyCount() > 0" @click="pull">
          <GitPullRequestArrow :size="14" aria-hidden="true" />
          Pull
        </button>
        <button type="button" class="primary" :disabled="actionRunning || !summary?.ahead" @click="push">
          <Upload :size="14" aria-hidden="true" />
          Push
        </button>
        <button type="button" class="ghost" :disabled="!summary?.githubFullName" @click="openGitHub">
          <ExternalLink :size="14" aria-hidden="true" />
          GitHub
        </button>
        <button type="button" class="ghost" :disabled="!summary?.path" @click="openFolder">
          <FolderOpen :size="14" aria-hidden="true" />
          文件夹
        </button>
      </div>
    </div>

    <div v-if="summary" class="repo-status card">
      <div>
        <span>当前分支</span>
        <strong>{{ summary.currentBranch ?? "detached" }}</strong>
      </div>
      <div>
        <span>同步状态</span>
        <strong>↑{{ summary.ahead }} / ↓{{ summary.behind }}</strong>
      </div>
      <div>
        <span>变更</span>
        <strong>{{ dirtyCount(summary) }}</strong>
      </div>
      <div>
        <span>GitHub</span>
        <strong>{{ summary.githubFullName ?? "未识别" }}</strong>
      </div>
    </div>

    <p v-if="actionError" class="error-line">{{ actionError }}</p>

    <div class="repo-tabs" role="tablist" aria-label="仓库视图">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="repo-tabs__tab"
        :class="{ 'is-active': activeTab === tab.key }"
        role="tab"
        :aria-selected="activeTab === tab.key"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <div v-if="activeTab === 'changes'" class="card">
      <div class="section-toolbar">
        <h2>工作区变更</h2>
        <div class="toolbar">
          <button type="button" class="ghost" :disabled="!changes.length" @click="selectAll">全选</button>
          <button type="button" class="ghost" :disabled="!selectedFiles.size" @click="stageSelected">暂存</button>
          <button type="button" class="ghost" :disabled="!selectedFiles.size" @click="unstageSelected">取消暂存</button>
        </div>
      </div>
      <p v-if="!changes.length" class="muted">没有本地变更。</p>
      <div v-for="change in changes" :key="change.path" class="change-row">
        <label>
          <input
            type="checkbox"
            :checked="selectedFiles.has(change.path)"
            @change="toggleFile(change.path)"
          />
          <span>{{ change.path }}</span>
        </label>
        <em>{{ statusText(change) }}</em>
        <pre v-if="change.diff"><code>{{ change.diff }}</code></pre>
      </div>
    </div>

    <div v-else-if="activeTab === 'history'" class="card">
      <h2>提交历史</h2>
      <p v-if="!detail?.commits.length" class="muted">没有提交历史。</p>
      <div v-for="commit in detail?.commits" :key="commit.hash" class="commit-row">
        <GitCommitHorizontal :size="14" aria-hidden="true" />
        <div>
          <strong>{{ commit.subject }}</strong>
          <span>{{ commit.shortHash }} · {{ commit.author }} · {{ formatTime(commit.timestamp) }}</span>
        </div>
      </div>
    </div>

    <div v-else-if="activeTab === 'branches'" class="card">
      <h2>分支</h2>
      <p v-if="!detail?.branches.length" class="muted">没有分支信息。</p>
      <div v-for="branch in detail?.branches" :key="`${branch.remote}:${branch.name}`" class="branch-row">
        <GitBranch :size="14" aria-hidden="true" />
        <div>
          <strong>{{ branch.name }}</strong>
          <span>{{ branch.remote ? "远端" : "本地" }} · ↑{{ branch.ahead }} / ↓{{ branch.behind }}</span>
        </div>
        <button
          type="button"
          class="ghost"
          :disabled="branch.current || branch.remote"
          @click="checkout(branch.name)"
        >
          <Check :size="14" aria-hidden="true" />
          Checkout
        </button>
      </div>
    </div>

    <div v-else class="card commit-panel">
      <h2>提交并推送</h2>
      <p class="muted">选择文件、填写提交说明后创建提交。默认提交成功后立即推送当前分支。</p>
      <div class="commit-files">
        <label v-for="change in changes" :key="change.path">
          <input
            type="checkbox"
            :checked="selectedFiles.has(change.path)"
            @change="toggleFile(change.path)"
          />
          <span>{{ change.path }}</span>
        </label>
      </div>
      <input v-model="commitMessage" type="text" placeholder="提交说明" />
      <label class="checkbox-line">
        <input v-model="pushAfter" type="checkbox" />
        <span>提交后立即 push</span>
      </label>
      <button type="button" class="primary" :disabled="!canCommit || actionRunning" @click="commitSelected">
        <GitCommitHorizontal :size="14" aria-hidden="true" />
        提交
      </button>
    </div>
  </section>
</template>

<style scoped>
.toolbar,
.section-toolbar {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.section-toolbar {
  width: 100%;
  justify-content: space-between;
  margin-bottom: 10px;
}

.repo-status {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.repo-status span {
  display: block;
  color: var(--text-muted);
  font-size: 12px;
}

.repo-status strong {
  display: block;
  margin-top: 4px;
  overflow-wrap: anywhere;
}

.repo-tabs {
  display: flex;
  gap: 2px;
  margin: 0 0 12px;
  border-bottom: 1px solid var(--border);
}

.repo-tabs__tab {
  height: 34px;
  padding: 0 12px;
  border-bottom: 2px solid transparent;
  border-radius: 6px 6px 0 0;
  color: var(--text-muted);
}

.repo-tabs__tab.is-active {
  color: var(--text);
  border-bottom-color: var(--accent);
}

.change-row,
.commit-row,
.branch-row {
  border-top: 1px solid var(--border-soft);
  padding: 10px 0;
}

.change-row:first-of-type,
.commit-row:first-of-type,
.branch-row:first-of-type {
  border-top: 0;
}

.change-row label,
.commit-files label,
.checkbox-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.change-row input,
.commit-files input,
.checkbox-line input {
  width: 16px;
  height: 16px;
  padding: 0;
}

.change-row em {
  display: block;
  margin: 4px 0 8px 24px;
  color: var(--text-muted);
  font-size: 12px;
  font-style: normal;
}

.change-row pre {
  max-height: 260px;
  margin-left: 24px;
}

.commit-row,
.branch-row {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  align-items: center;
  gap: 8px;
}

.commit-row span,
.branch-row span {
  display: block;
  color: var(--text-muted);
  font-size: 12px;
}

.commit-panel {
  display: grid;
  gap: 12px;
  max-width: 720px;
}

.commit-files {
  display: grid;
  gap: 8px;
}

.error-line {
  color: var(--err);
}

@media (max-width: 900px) {
  .repo-status {
    grid-template-columns: 1fr 1fr;
  }
}
</style>

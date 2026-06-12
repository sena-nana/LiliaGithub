<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { GitBranchPlus, LoaderCircle, RefreshCw, Save, CircleDot, CircleOff } from "@lucide/vue";
import {
  createGitHubIssue,
  createGitHubRemoteBranch,
  getGitHubRepoManagement,
  listGitHubIssues,
  listGitHubRemoteBranches,
  updateGitHubIssue,
  updateGitHubRepoSettings,
  type GitHubIssue,
  type GitHubRemoteBranch,
  type GitHubRepoManagement,
  type GitHubUpdateRepoSettingsRequest,
} from "../../services/workspace";

const props = defineProps<{
  repoFullName: string | null | undefined;
}>();

const loading = ref(false);
const savingSettings = ref(false);
const creatingBranch = ref(false);
const creatingIssue = ref(false);
const error = ref<string | null>(null);
const settings = ref<GitHubRepoManagement | null>(null);
const branches = ref<GitHubRemoteBranch[]>([]);
const issues = ref<GitHubIssue[]>([]);
const issueState = ref<"open" | "closed" | "all">("open");
const branchName = ref("");
const sourceSha = ref("");
const issueTitle = ref("");
const issueBody = ref("");
const issueLabels = ref("");
const issueAssignees = ref("");

const settingsForm = reactive({
  description: "",
  homepage: "",
  private: false,
  defaultBranch: "",
  hasIssues: true,
  hasWiki: false,
  hasProjects: true,
  hasDiscussions: false,
  allowMergeCommit: true,
  allowSquashMerge: true,
  allowRebaseMerge: true,
  allowAutoMerge: false,
  deleteBranchOnMerge: false,
  allowForking: true,
  webCommitSignoffRequired: false,
});

const repoReady = computed(() => Boolean(props.repoFullName));
const sourceBranchOptions = computed(() => branches.value.filter((branch) => branch.sha));

onMounted(load);

watch(() => props.repoFullName, () => {
  void load();
});

watch(issueState, () => {
  void loadIssues();
});

function applySettingsForm(next: GitHubRepoManagement) {
  settingsForm.description = next.description ?? "";
  settingsForm.homepage = next.homepage ?? "";
  settingsForm.private = next.private;
  settingsForm.defaultBranch = next.defaultBranch;
  settingsForm.hasIssues = next.hasIssues;
  settingsForm.hasWiki = next.hasWiki;
  settingsForm.hasProjects = next.hasProjects;
  settingsForm.hasDiscussions = next.hasDiscussions;
  settingsForm.allowMergeCommit = next.allowMergeCommit;
  settingsForm.allowSquashMerge = next.allowSquashMerge;
  settingsForm.allowRebaseMerge = next.allowRebaseMerge;
  settingsForm.allowAutoMerge = next.allowAutoMerge;
  settingsForm.deleteBranchOnMerge = next.deleteBranchOnMerge;
  settingsForm.allowForking = next.allowForking;
  settingsForm.webCommitSignoffRequired = next.webCommitSignoffRequired;
}

async function load() {
  if (!props.repoFullName) return;
  loading.value = true;
  error.value = null;
  try {
    const [nextSettings, nextBranches, nextIssues] = await Promise.all([
      getGitHubRepoManagement(props.repoFullName),
      listGitHubRemoteBranches(props.repoFullName),
      listGitHubIssues(props.repoFullName, issueState.value),
    ]);
    settings.value = nextSettings;
    branches.value = nextBranches;
    issues.value = nextIssues;
    applySettingsForm(nextSettings);
    sourceSha.value = nextBranches[0]?.sha ?? "";
  } catch (err) {
    error.value = String(err);
  } finally {
    loading.value = false;
  }
}

async function loadIssues() {
  if (!props.repoFullName) return;
  error.value = null;
  try {
    issues.value = await listGitHubIssues(props.repoFullName, issueState.value);
  } catch (err) {
    error.value = String(err);
  }
}

async function saveSettings() {
  if (!props.repoFullName || !settings.value) return;
  const request = changedSettingsRequest(settings.value);
  if (!Object.keys(request).length) return;
  savingSettings.value = true;
  error.value = null;
  try {
    const next = await updateGitHubRepoSettings(props.repoFullName, request);
    settings.value = next;
    applySettingsForm(next);
  } catch (err) {
    error.value = String(err);
  } finally {
    savingSettings.value = false;
  }
}

function changedSettingsRequest(current: GitHubRepoManagement) {
  const request: GitHubUpdateRepoSettingsRequest = {};
  const maybeSet = <K extends keyof GitHubUpdateRepoSettingsRequest>(
    key: K,
    value: GitHubUpdateRepoSettingsRequest[K],
    previous: GitHubUpdateRepoSettingsRequest[K],
  ) => {
    if (value !== previous) request[key] = value;
  };
  maybeSet("description", settingsForm.description, current.description ?? "");
  maybeSet("homepage", settingsForm.homepage, current.homepage ?? "");
  maybeSet("private", settingsForm.private, current.private);
  maybeSet("defaultBranch", settingsForm.defaultBranch, current.defaultBranch);
  maybeSet("hasIssues", settingsForm.hasIssues, current.hasIssues);
  maybeSet("hasWiki", settingsForm.hasWiki, current.hasWiki);
  maybeSet("hasProjects", settingsForm.hasProjects, current.hasProjects);
  maybeSet("hasDiscussions", settingsForm.hasDiscussions, current.hasDiscussions);
  maybeSet("allowMergeCommit", settingsForm.allowMergeCommit, current.allowMergeCommit);
  maybeSet("allowSquashMerge", settingsForm.allowSquashMerge, current.allowSquashMerge);
  maybeSet("allowRebaseMerge", settingsForm.allowRebaseMerge, current.allowRebaseMerge);
  maybeSet("allowAutoMerge", settingsForm.allowAutoMerge, current.allowAutoMerge);
  maybeSet("deleteBranchOnMerge", settingsForm.deleteBranchOnMerge, current.deleteBranchOnMerge);
  maybeSet("allowForking", settingsForm.allowForking, current.allowForking);
  maybeSet("webCommitSignoffRequired", settingsForm.webCommitSignoffRequired, current.webCommitSignoffRequired);
  return request;
}

async function createBranch() {
  if (!props.repoFullName) return;
  creatingBranch.value = true;
  error.value = null;
  try {
    const branch = await createGitHubRemoteBranch(props.repoFullName, {
      name: branchName.value,
      sourceSha: sourceSha.value,
    });
    branches.value = [...branches.value.filter((item) => item.name !== branch.name), branch];
    branchName.value = "";
  } catch (err) {
    error.value = String(err);
  } finally {
    creatingBranch.value = false;
  }
}

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

async function createIssue() {
  if (!props.repoFullName) return;
  creatingIssue.value = true;
  error.value = null;
  try {
    const issue = await createGitHubIssue(props.repoFullName, {
      title: issueTitle.value,
      body: issueBody.value,
      labels: splitList(issueLabels.value),
      assignees: splitList(issueAssignees.value),
    });
    issues.value = [issue, ...issues.value];
    issueTitle.value = "";
    issueBody.value = "";
    issueLabels.value = "";
    issueAssignees.value = "";
  } catch (err) {
    error.value = String(err);
  } finally {
    creatingIssue.value = false;
  }
}

async function toggleIssue(issue: GitHubIssue) {
  if (!props.repoFullName) return;
  error.value = null;
  try {
    const updated = await updateGitHubIssue(props.repoFullName, issue.number, {
      state: issue.state === "open" ? "closed" : "open",
    });
    issues.value = issues.value.map((item) => item.number === updated.number ? updated : item);
  } catch (err) {
    error.value = String(err);
  }
}
</script>

<template>
  <section class="repo-panel github-panel">
    <div class="section-toolbar">
      <div class="repo-panel__title">
        <h2>GitHub 管理</h2>
        <p class="muted">{{ repoFullName ?? "当前仓库未识别 GitHub 远端" }}</p>
      </div>
      <button type="button" class="ghost" :disabled="!repoReady || loading" @click="load">
        <LoaderCircle v-if="loading" :size="14" aria-hidden="true" class="sb-spin" />
        <RefreshCw v-else :size="14" aria-hidden="true" />
        刷新
      </button>
    </div>

    <p v-if="!repoReady" class="muted repo-empty">当前仓库没有 GitHub 远端，无法执行远端管理操作。</p>
    <p v-else-if="error" class="error-line">{{ error }}</p>

    <div v-if="repoReady" class="github-grid">
      <form class="github-card github-settings" @submit.prevent="saveSettings">
        <div class="github-card__head">
          <h3>仓库设置</h3>
          <button type="submit" class="primary" :disabled="savingSettings || loading || !settings">
            <LoaderCircle v-if="savingSettings" :size="14" aria-hidden="true" class="sb-spin" />
            <Save v-else :size="14" aria-hidden="true" />
            保存
          </button>
        </div>
        <label>
          <span>描述</span>
          <input v-model="settingsForm.description" type="text" />
        </label>
        <label>
          <span>Homepage</span>
          <input v-model="settingsForm.homepage" type="url" />
        </label>
        <label>
          <span>默认分支</span>
          <input v-model="settingsForm.defaultBranch" type="text" />
        </label>
        <div class="github-switches">
          <label><input v-model="settingsForm.private" type="checkbox" /> Private</label>
          <label><input v-model="settingsForm.hasIssues" type="checkbox" /> Issues</label>
          <label><input v-model="settingsForm.hasWiki" type="checkbox" /> Wiki</label>
          <label><input v-model="settingsForm.hasProjects" type="checkbox" /> Projects</label>
          <label><input v-model="settingsForm.hasDiscussions" type="checkbox" /> Discussions</label>
          <label><input v-model="settingsForm.allowForking" type="checkbox" /> Forking</label>
          <label><input v-model="settingsForm.deleteBranchOnMerge" type="checkbox" /> 合并后删分支</label>
          <label><input v-model="settingsForm.webCommitSignoffRequired" type="checkbox" /> Web signoff</label>
          <label><input v-model="settingsForm.allowMergeCommit" type="checkbox" /> Merge commit</label>
          <label><input v-model="settingsForm.allowSquashMerge" type="checkbox" /> Squash</label>
          <label><input v-model="settingsForm.allowRebaseMerge" type="checkbox" /> Rebase</label>
          <label><input v-model="settingsForm.allowAutoMerge" type="checkbox" /> Auto merge</label>
        </div>
      </form>

      <section class="github-card">
        <div class="github-card__head">
          <h3>远端分支</h3>
          <span class="muted">{{ branches.length }} 个分支</span>
        </div>
        <form class="github-inline-form" @submit.prevent="createBranch">
          <input v-model="branchName" type="text" placeholder="new-branch" />
          <select v-model="sourceSha">
            <option v-for="branch in sourceBranchOptions" :key="branch.name" :value="branch.sha">
              {{ branch.name }}
            </option>
          </select>
          <button type="submit" class="ghost" :disabled="creatingBranch || !branchName.trim() || !sourceSha">
            <GitBranchPlus :size="14" aria-hidden="true" />
            创建
          </button>
        </form>
        <div class="github-list">
          <div v-for="branch in branches" :key="branch.name" class="github-row">
            <strong>{{ branch.name }}</strong>
            <span>{{ branch.sha.slice(0, 7) }} · {{ branch.protected ? "protected" : "open" }}</span>
          </div>
        </div>
      </section>

      <section class="github-card github-issues">
        <div class="github-card__head">
          <h3>Issues</h3>
          <select v-model="issueState">
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
        </div>
        <form class="github-issue-form" @submit.prevent="createIssue">
          <input v-model="issueTitle" type="text" placeholder="Issue 标题" />
          <textarea v-model="issueBody" rows="3" placeholder="Issue 内容"></textarea>
          <div class="github-inline-form">
            <input v-model="issueLabels" type="text" placeholder="labels, comma separated" />
            <input v-model="issueAssignees" type="text" placeholder="assignees" />
            <button type="submit" class="primary" :disabled="creatingIssue || !issueTitle.trim()">新建 Issue</button>
          </div>
        </form>
        <div class="github-list">
          <div v-for="issue in issues" :key="issue.number" class="github-row github-row--issue">
            <div>
              <strong>#{{ issue.number }} {{ issue.title }}</strong>
              <span>{{ issue.labels.join(", ") || "无标签" }} · {{ issue.assignees.join(", ") || "未分配" }}</span>
            </div>
            <button type="button" class="ghost" @click="toggleIssue(issue)">
              <CircleOff v-if="issue.state === 'open'" :size="14" aria-hidden="true" />
              <CircleDot v-else :size="14" aria-hidden="true" />
              {{ issue.state === "open" ? "关闭" : "重开" }}
            </button>
          </div>
          <p v-if="!issues.length" class="muted repo-empty">没有匹配的 Issue。</p>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.github-panel,
.github-grid,
.github-card,
.github-settings,
.github-issue-form,
.github-list {
  display: grid;
  gap: 12px;
}

.github-grid {
  grid-template-columns: minmax(280px, 0.9fr) minmax(300px, 1fr);
  align-items: start;
}

.github-card {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: var(--bg-subtle);
}

.github-issues {
  grid-column: 1 / -1;
}

.github-card__head,
.github-inline-form,
.github-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.github-card__head {
  justify-content: space-between;
}

.github-card h3 {
  margin: 0;
  font-size: 13px;
}

.github-card label {
  display: grid;
  gap: 5px;
  color: var(--text-muted);
  font-size: 12px;
}

.github-card input,
.github-card textarea,
.github-card select {
  width: 100%;
}

.github-switches {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.github-switches label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text);
}

.github-switches input {
  width: 14px;
  height: 14px;
  padding: 0;
}

.github-inline-form {
  flex-wrap: wrap;
}

.github-inline-form input,
.github-inline-form select {
  flex: 1 1 160px;
}

.github-list {
  gap: 0;
}

.github-row {
  justify-content: space-between;
  min-height: 42px;
  padding: 8px 0;
  border-top: 1px solid var(--border-soft);
}

.github-row:first-child {
  border-top: 0;
}

.github-row strong,
.github-row span {
  display: block;
  min-width: 0;
  overflow-wrap: anywhere;
}

.github-row span {
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 12px;
}

.github-row--issue {
  align-items: flex-start;
}

@media (max-width: 900px) {
  .github-grid,
  .github-switches {
    grid-template-columns: 1fr;
  }
}
</style>

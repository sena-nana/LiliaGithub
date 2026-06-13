<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  CircleDot,
  CircleOff,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Save,
} from "@lucide/vue";
import MarkdownReadme from "./MarkdownReadme.vue";
import {
  createGitHubIssue,
  getGitHubRepoManagement,
  getRepoReadme,
  listGitHubIssues,
  listGitHubWorkflowRuns,
  updateGitHubIssue,
  updateGitHubRepoSettings,
  openUrl,
} from "../../services/workspace/client";
import type {
  GitHubIssue,
  GitHubRepoManagement,
  GitHubUpdateRepoSettingsRequest,
  GitHubWorkflowRun,
  RepoReadme,
} from "../../services/workspace/types";

type ProjectTab = "readme" | "issues" | "actions" | "settings";

const props = defineProps<{
  repoId: string;
  repoFullName: string | null | undefined;
}>();

const activeTab = ref<ProjectTab>("readme");
const readme = ref<RepoReadme | null>(null);
const readmeLoading = ref(false);
const readmeError = ref<string | null>(null);
const githubLoading = ref(false);
const githubError = ref<string | null>(null);
const actionsLoading = ref(false);
const actionsError = ref<string | null>(null);
const savingSettings = ref(false);
const creatingIssue = ref(false);
const settings = ref<GitHubRepoManagement | null>(null);
const issues = ref<GitHubIssue[]>([]);
const workflowRuns = ref<GitHubWorkflowRun[]>([]);
const issueState = ref<"open" | "closed" | "all">("open");
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
const tabs: Array<{ key: ProjectTab; label: string }> = [
  { key: "readme", label: "README" },
  { key: "issues", label: "Issues" },
  { key: "actions", label: "Actions" },
  { key: "settings", label: "Settings" },
];

onMounted(() => {
  void loadReadme();
  void loadGitHub();
  void loadActions();
});

watch(() => props.repoId, () => {
  activeTab.value = "readme";
  void loadReadme();
});

watch(() => props.repoFullName, () => {
  void loadGitHub();
  void loadActions();
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

async function loadReadme() {
  if (!props.repoId) return;
  readmeLoading.value = true;
  readmeError.value = null;
  try {
    readme.value = await getRepoReadme(props.repoId);
  } catch (err) {
    readmeError.value = String(err);
  } finally {
    readmeLoading.value = false;
  }
}

async function loadGitHub() {
  if (!props.repoFullName) {
    settings.value = null;
    issues.value = [];
    githubError.value = null;
    return;
  }
  githubLoading.value = true;
  githubError.value = null;
  try {
    const [nextSettings, nextIssues] = await Promise.all([
      getGitHubRepoManagement(props.repoFullName),
      listGitHubIssues(props.repoFullName, issueState.value),
    ]);
    settings.value = nextSettings;
    issues.value = nextIssues;
    applySettingsForm(nextSettings);
  } catch (err) {
    githubError.value = String(err);
  } finally {
    githubLoading.value = false;
  }
}

async function loadIssues() {
  if (!props.repoFullName) return;
  githubError.value = null;
  try {
    issues.value = await listGitHubIssues(props.repoFullName, issueState.value);
  } catch (err) {
    githubError.value = String(err);
  }
}

async function loadActions() {
  if (!props.repoFullName) {
    workflowRuns.value = [];
    actionsError.value = null;
    return;
  }
  actionsLoading.value = true;
  actionsError.value = null;
  try {
    workflowRuns.value = await listGitHubWorkflowRuns(props.repoFullName, 20);
  } catch (err) {
    actionsError.value = String(err);
  } finally {
    actionsLoading.value = false;
  }
}

async function refreshActiveTab() {
  if (activeTab.value === "readme") await loadReadme();
  else if (activeTab.value === "actions") await loadActions();
  else await loadGitHub();
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

async function saveSettings() {
  if (!props.repoFullName || !settings.value) return;
  const request = changedSettingsRequest(settings.value);
  if (!Object.keys(request).length) return;
  savingSettings.value = true;
  githubError.value = null;
  try {
    const next = await updateGitHubRepoSettings(props.repoFullName, request);
    settings.value = next;
    applySettingsForm(next);
  } catch (err) {
    githubError.value = String(err);
  } finally {
    savingSettings.value = false;
  }
}

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

async function createIssue() {
  if (!props.repoFullName) return;
  creatingIssue.value = true;
  githubError.value = null;
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
    githubError.value = String(err);
  } finally {
    creatingIssue.value = false;
  }
}

async function toggleIssue(issue: GitHubIssue) {
  if (!props.repoFullName) return;
  githubError.value = null;
  try {
    const updated = await updateGitHubIssue(props.repoFullName, issue.number, {
      state: issue.state === "open" ? "closed" : "open",
    });
    issues.value = issues.value.map((item) => item.number === updated.number ? updated : item);
  } catch (err) {
    githubError.value = String(err);
  }
}

function openLink(href: string) {
  if (/^https?:\/\//i.test(href)) {
    void openUrl(href);
  }
}

function formatWorkflowState(run: GitHubWorkflowRun) {
  if (run.status === "completed") return run.conclusion ?? "completed";
  return run.status;
}
</script>

<template>
  <section class="project-panel">
    <div class="project-panel__header">
      <div>
        <h2>项目信息</h2>
        <p class="muted">{{ repoFullName ?? "本地仓库" }}</p>
      </div>
      <button type="button" class="ghost" @click="refreshActiveTab">
        <LoaderCircle v-if="readmeLoading || githubLoading || actionsLoading" :size="14" aria-hidden="true" class="sb-spin" />
        <RefreshCw v-else :size="14" aria-hidden="true" />
        刷新
      </button>
    </div>

    <div class="project-tabs" role="tablist" aria-label="项目信息视图">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="project-tabs__tab"
        :class="{ 'is-active': activeTab === tab.key }"
        role="tab"
        :aria-selected="activeTab === tab.key"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <div v-if="activeTab === 'readme'" class="project-readme">
      <div class="project-readme__bar">
        <strong>{{ readme?.path ?? "README" }}</strong>
        <span class="muted">{{ readme ? "本地文件" : "未找到" }}</span>
      </div>
      <p v-if="readmeError" class="error-line">{{ readmeError }}</p>
      <p v-else-if="readmeLoading" class="muted repo-empty">正在读取 README。</p>
      <p v-else-if="!readme" class="muted repo-empty">当前仓库没有本地 README。</p>
      <MarkdownReadme v-else :content="readme.content" :images="readme.images" @open-link="openLink" />
    </div>

    <template v-else-if="!repoReady">
      <p class="muted repo-empty project-empty">当前仓库没有 GitHub 远端，Issues、Actions 和 Settings 不可用。</p>
    </template>

    <section v-else-if="activeTab === 'issues'" class="project-section">
      <div class="project-section__head">
        <h3>Issues</h3>
        <select v-model="issueState">
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
      </div>
      <p v-if="githubError" class="error-line">{{ githubError }}</p>
      <form class="project-issue-form" @submit.prevent="createIssue">
        <input v-model="issueTitle" type="text" placeholder="Issue 标题" />
        <textarea v-model="issueBody" rows="3" placeholder="Issue 内容"></textarea>
        <div class="project-inline-form">
          <input v-model="issueLabels" type="text" placeholder="labels, comma separated" />
          <input v-model="issueAssignees" type="text" placeholder="assignees" />
          <button type="submit" class="primary" :disabled="creatingIssue || !issueTitle.trim()">新建 Issue</button>
        </div>
      </form>
      <div class="project-list">
        <div v-for="issue in issues" :key="issue.number" class="project-row project-row--issue">
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
        <p v-if="!issues.length && !githubLoading" class="muted repo-empty">没有匹配的 Issue。</p>
      </div>
    </section>

    <section v-else-if="activeTab === 'actions'" class="project-section">
      <div class="project-section__head">
        <h3>Actions</h3>
        <span class="muted">{{ workflowRuns.length }} 条运行记录</span>
      </div>
      <p v-if="actionsError" class="error-line">{{ actionsError }}</p>
      <p v-else-if="actionsLoading" class="muted repo-empty">正在读取 GitHub Actions。</p>
      <div class="project-list">
        <div v-for="run in workflowRuns" :key="run.id" class="project-row">
          <div>
            <strong>{{ run.displayTitle }}</strong>
            <span>{{ run.name }} · {{ run.branch }} · {{ run.event }} · {{ formatWorkflowState(run) }}</span>
          </div>
          <button type="button" class="ghost" @click="openLink(run.htmlUrl)">
            <ExternalLink :size="14" aria-hidden="true" />
            打开
          </button>
        </div>
        <p v-if="!workflowRuns.length && !actionsLoading" class="muted repo-empty">没有 GitHub Actions 运行记录。</p>
      </div>
    </section>

    <form v-else class="project-section project-settings" @submit.prevent="saveSettings">
      <div class="project-section__head">
        <h3>仓库设置</h3>
        <button type="submit" class="primary" :disabled="savingSettings || githubLoading || !settings">
          <LoaderCircle v-if="savingSettings" :size="14" aria-hidden="true" class="sb-spin" />
          <Save v-else :size="14" aria-hidden="true" />
          保存
        </button>
      </div>
      <p v-if="githubError" class="error-line">{{ githubError }}</p>
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
      <div class="project-switches">
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
  </section>
</template>

<style scoped>
.project-panel {
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 14px 16px 16px;
}

.project-panel__header,
.project-section__head,
.project-row,
.project-inline-form {
  display: flex;
  align-items: center;
  gap: 8px;
}

.project-panel__header,
.project-section__head,
.project-row {
  justify-content: space-between;
}

.project-panel h2,
.project-section h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.project-panel__header p {
  margin: 4px 0 0;
}

.project-tabs {
  display: flex;
  gap: 2px;
  min-width: 0;
  border-bottom: 1px solid var(--border);
}

.project-tabs__tab {
  height: 34px;
  padding: 0 12px;
  border-bottom: 2px solid transparent;
  border-radius: 6px 6px 0 0;
  color: var(--text-muted);
}

.project-tabs__tab.is-active {
  color: var(--text);
  border-bottom-color: var(--accent);
}

.project-readme,
.project-section,
.project-issue-form,
.project-list,
.project-settings {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.project-readme {
  padding-top: 2px;
}

.project-readme__bar {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  min-height: 32px;
  padding: 0 0 8px;
  border-bottom: 1px solid var(--border-soft);
}

.project-readme__bar strong,
.project-readme__bar span {
  overflow-wrap: anywhere;
}

.project-empty {
  padding: 18px 0;
}

.project-section label {
  display: grid;
  gap: 5px;
  color: var(--text-muted);
  font-size: 12px;
}

.project-section input,
.project-section textarea,
.project-section select {
  width: 100%;
}

.project-inline-form {
  flex-wrap: wrap;
}

.project-inline-form input {
  flex: 1 1 160px;
}

.project-list {
  gap: 0;
}

.project-row {
  min-height: 42px;
  padding: 9px 0;
  border-top: 1px solid var(--border-soft);
}

.project-row:first-child {
  border-top: 0;
}

.project-row strong,
.project-row span {
  display: block;
  min-width: 0;
  overflow-wrap: anywhere;
}

.project-row span {
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 12px;
}

.project-row--issue {
  align-items: flex-start;
}

.project-switches {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.project-switches label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text);
}

.project-switches input {
  width: 14px;
  height: 14px;
  padding: 0;
}

@media (max-width: 900px) {
  .project-switches {
    grid-template-columns: 1fr;
  }
}
</style>

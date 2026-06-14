<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import {
  CircleDot,
  CircleOff,
  ChevronDown,
  ExternalLink,
  LoaderCircle,
  Save,
  Square,
  Play,
  X,
} from "@lucide/vue";
import MarkdownReadme from "./MarkdownReadme.vue";
import RepoLaunchPanel from "./RepoLaunchPanel.vue";
import {
  createGitHubIssue,
  getGitHubRepoManagement,
  listRepoReadmes,
  listGitHubIssues,
  listGitHubWorkflowRuns,
  updateGitHubIssue,
  updateGitHubRepoSettings,
  openPath,
  openUrl,
} from "../../services/workspace/client";
import type {
  GitHubIssue,
  GitHubRepoManagement,
  GitHubUpdateRepoSettingsRequest,
  GitHubWorkflowRun,
  ProjectLaunchCandidate,
  ProjectLaunchConfig,
  ProjectLaunchLog,
  ProjectLaunchStatus,
  RepoReadme,
} from "../../services/workspace/types";
import { isWorkflowRunFailure, streamLabel, workflowRunStatusText, workflowRunStatusTone } from "../../utils/repoDisplay";
import type { ReadmeLinkTarget } from "../../utils/readmeLinks";

type ProjectTab = "readme" | "issues" | "actions" | "settings";
type MarkdownReadmeInstance = InstanceType<typeof MarkdownReadme>;

const props = defineProps<{
  repoId: string;
  repoFullName: string | null | undefined;
  repoPath: string | null | undefined;
  loading: boolean;
  launchConfig: ProjectLaunchConfig | null;
  launchStatus: ProjectLaunchStatus | null;
  launchCandidates: readonly ProjectLaunchCandidate[];
  launchLogs: readonly ProjectLaunchLog[];
  launchTerminalVisible: boolean;
  actionRunning: boolean;
  launchRunning: boolean;
}>();

const emit = defineEmits<{
  start: [];
  stop: [];
  openTerminal: [];
  hideTerminal: [];
  selectLaunchCandidate: [candidate: ProjectLaunchCandidate];
}>();

const activeTab = ref<ProjectTab>("readme");
const markdownReadme = ref<MarkdownReadmeInstance | null>(null);
const terminalBody = ref<HTMLElement | null>(null);
const launchMenuOpen = ref(false);
const readmes = ref<RepoReadme[]>([]);
const activeReadmePath = ref<string | null>(null);
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
const activeReadme = computed(() =>
  readmes.value.find((item) => item.path === activeReadmePath.value) ?? readmes.value[0] ?? null,
);
const readmePaths = computed(() => readmes.value.map((item) => item.path));
const tabs: Array<{ key: Exclude<ProjectTab, "readme">; label: string }> = [
  { key: "issues", label: "Issues" },
  { key: "actions", label: "Actions" },
  { key: "settings", label: "Settings" },
];
const launchCommandText = computed(() => props.launchConfig?.command?.trim() || "选择启动指令");
const launchCandidateOptions = computed(() => {
  const candidates = [...props.launchCandidates];
  const current = props.launchConfig?.command?.trim()
    ? candidates.find((item) => item.command === props.launchConfig?.command && item.cwd === props.launchConfig?.cwd)
    : null;
  if (current) return candidates;
  if (!props.launchConfig?.command.trim()) return candidates;
  return [{
    command: props.launchConfig.command,
    label: "当前指令",
    hint: props.launchConfig.cwd || null,
    kind: "current",
    cwd: props.launchConfig.cwd,
  }, ...candidates];
});
const launchMenuItems = computed(() =>
  launchCandidateOptions.value.map((candidate) => ({
    value: `${candidate.command}::${candidate.cwd ?? ""}`,
    label: candidate.label,
    hint: candidate.hint ?? candidate.cwd ?? undefined,
    candidate,
  })),
);
const activeLaunchValue = computed(() =>
  `${props.launchConfig?.command ?? ""}::${props.launchConfig?.cwd ?? ""}`,
);
const hasLaunchCommand = computed(() => Boolean(props.launchConfig?.command.trim()));
const launchButtonDisabled = computed(() => props.loading || props.actionRunning || props.launchRunning);

onMounted(() => {
  void loadReadme();
  void loadGitHub();
  void loadActions();
});

watch(() => props.repoId, () => {
  activeTab.value = "readme";
  activeReadmePath.value = null;
  closeLaunchMenu();
  void loadReadme();
});

watch(() => props.repoFullName, () => {
  void loadGitHub();
  void loadActions();
});

watch([() => props.launchLogs.length, () => props.launchRunning], () => {
  if (!props.launchTerminalVisible) return;
  void scrollTerminalToEnd();
});

watch(issueState, () => {
  void loadIssues();
});

watch(launchMenuOpen, async (open, _previous, onCleanup) => {
  if (!open) return;
  await nextTick();
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  document.addEventListener("keydown", onMenuKeydown);
  onCleanup(() => {
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("keydown", onMenuKeydown);
  });
});

function closeLaunchMenu() {
  launchMenuOpen.value = false;
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null;
  if (!target) return;
  const root = terminalBody.value?.closest(".project-terminal-card");
  if (!(root instanceof HTMLElement)) return;
  if (!root.contains(target)) closeLaunchMenu();
}

function onMenuKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  closeLaunchMenu();
  event.stopPropagation();
}

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
  const previousPath = activeReadmePath.value;
  try {
    const nextReadmes = await listRepoReadmes(props.repoId);
    readmes.value = nextReadmes;
    activeReadmePath.value = nextReadmes.some((item) => item.path === previousPath)
      ? previousPath
      : nextReadmes[0]?.path ?? null;
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

async function openReadmeLink(target: ReadmeLinkTarget) {
  if (target.kind === "external") {
    void openUrl(target.href);
    return;
  }

  if (target.kind === "readme") {
    selectReadme(target.path);
    if (target.hash) {
      await nextTick();
      markdownReadme.value?.scrollToAnchor(target.hash);
    }
    return;
  }

  if (target.kind === "file") {
    void openPath(target.absolutePath);
  }
}

async function scrollTerminalToEnd() {
  await nextTick();
  const body = terminalBody.value;
  if (!body) return;
  body.scrollTop = body.scrollHeight;
}

function activateProjectTab(tab: ProjectTab) {
  activeTab.value = tab;
  if (props.launchTerminalVisible) {
    closeLaunchMenu();
    emit("hideTerminal");
  }
}

function selectReadme(path: string) {
  activeReadmePath.value = path;
  activateProjectTab("readme");
}

function runLaunch() {
  closeLaunchMenu();
  emit("start");
}

function stopLaunch() {
  closeLaunchMenu();
  emit("stop");
}

function pickLaunchCandidate(candidate: ProjectLaunchCandidate) {
  closeLaunchMenu();
  emit("selectLaunchCandidate", candidate);
}

function launchButtonTitle(candidate: ProjectLaunchCandidate) {
  return [candidate.kind, candidate.hint, candidate.cwd].filter(Boolean).join(" · ");
}
</script>

<template>
  <section class="project-panel">
    <div class="project-layout">
      <main class="project-main">
        <section v-if="launchTerminalVisible" class="project-terminal-card">
          <div class="project-section__head">
            <div class="launch-head">
              <button
                type="button"
                class="launch-command-button"
                :class="{ 'is-open': launchMenuOpen }"
                :disabled="launchButtonDisabled"
                :aria-expanded="launchMenuOpen"
                aria-haspopup="true"
                @click="launchMenuOpen = !launchMenuOpen"
              >
                <strong>{{ launchCommandText }}</strong>
                <ChevronDown :size="12" aria-hidden="true" />
              </button>
              <div v-if="launchMenuOpen" class="launch-menu" role="listbox" aria-label="启动指令候选">
                <button
                  v-for="item in launchMenuItems"
                  :key="item.value"
                  type="button"
                  class="launch-menu__item"
                  :class="{ 'is-active': item.value === activeLaunchValue }"
                  role="option"
                  :aria-selected="item.value === activeLaunchValue"
                  @click="pickLaunchCandidate(item.candidate)"
                >
                  <span class="launch-menu__label">{{ item.label }}</span>
                  <span class="launch-menu__hint">{{ launchButtonTitle(item.candidate) }}</span>
                </button>
              </div>
            </div>
            <div class="launch-actions">
              <button
                type="button"
                class="primary launch-run-button"
                :aria-label="launchRunning ? '停止' : '运行'"
                :title="launchRunning ? '停止' : '运行'"
                :disabled="actionRunning || (!launchRunning && !hasLaunchCommand)"
                @click="launchRunning ? stopLaunch() : runLaunch()"
              >
                <Square v-if="launchRunning" :size="15" aria-hidden="true" />
                <Play v-else :size="15" aria-hidden="true" />
              </button>
              <button type="button" class="ghost" @click="emit('hideTerminal')">隐藏</button>
            </div>
          </div>
          <div ref="terminalBody" class="project-terminal__body" aria-label="启动终端">
            <div v-if="!launchRunning" class="project-terminal__empty">
              <p class="muted repo-empty project-empty">请选择一个启动指令并运行。</p>
              <p class="muted repo-empty project-empty">当前指令：{{ launchConfig?.command || "未配置" }}</p>
            </div>
            <p v-else-if="!launchLogs.length" class="muted repo-empty project-empty">暂无输出。</p>
            <pre v-else><code><span
              v-for="entry in launchLogs"
              :key="entry.index"
              :class="`launch-log launch-log--${entry.stream}`"
            >[{{ streamLabel(entry.stream) }}] {{ entry.line }}
</span></code></pre>
          </div>
        </section>

        <section v-else-if="activeTab === 'readme'" class="project-readme-card">
          <p v-if="readmeError" class="error-line">{{ readmeError }}</p>
          <p v-else-if="readmeLoading" class="muted repo-empty project-empty">正在读取 README。</p>
          <p v-else-if="!activeReadme" class="muted repo-empty project-empty">当前仓库没有本地 README。</p>
          <MarkdownReadme
            v-else
            ref="markdownReadme"
            :content="activeReadme.content"
            :images="activeReadme.images"
            :repo-root-path="repoPath"
            :current-readme-path="activeReadme.path"
            :readme-paths="readmePaths"
            @open-link="openReadmeLink"
          />
        </section>

        <section v-else-if="!repoReady" class="project-section">
          <p class="muted repo-empty project-empty">当前仓库没有 GitHub 远端，Issues、Actions 和 Settings 不可用。</p>
        </section>

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
            <div v-for="run in workflowRuns" :key="run.id" class="project-row project-row--action">
              <span
                class="project-action-status"
                :class="`project-action-status--${workflowRunStatusTone(run)}`"
                :title="workflowRunStatusText(run)"
                :aria-label="workflowRunStatusText(run)"
              >
                <X v-if="isWorkflowRunFailure(run)" :size="14" aria-hidden="true" />
                <CircleDot v-else :size="14" aria-hidden="true" />
              </span>
              <div>
                <strong>{{ run.displayTitle }}</strong>
                <span>{{ run.name }} · {{ run.branch }} · {{ run.event }}</span>
              </div>
              <button type="button" class="ghost" @click="openUrl(run.htmlUrl)">
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
      </main>

      <aside class="project-sidebar">
        <div class="project-sidebar__card" role="tablist" aria-label="README 列表">
          <button
            v-for="item in readmes"
            :key="item.path"
            type="button"
            class="project-sidebar__item"
            :class="{ 'is-active': !launchTerminalVisible && activeTab === 'readme' && activeReadmePath === item.path }"
            role="tab"
            :aria-selected="!launchTerminalVisible && activeTab === 'readme' && activeReadmePath === item.path"
            @click="selectReadme(item.path)"
          >
            <strong>{{ item.path }}</strong>
            <span aria-hidden="true">{{ item.format === "text" ? "text" : item.format }}</span>
          </button>
          <p v-if="!readmes.length && !readmeLoading" class="project-sidebar__empty">未找到 README</p>
        </div>

        <div class="project-sidebar__card" role="tablist" aria-label="项目信息视图">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            class="project-sidebar__item"
            :class="{ 'is-active': !launchTerminalVisible && activeTab === tab.key }"
            role="tab"
            :aria-selected="!launchTerminalVisible && activeTab === tab.key"
            @click="activateProjectTab(tab.key)"
          >
            <strong>{{ tab.label }}</strong>
          </button>
        </div>

        <div class="project-sidebar__launch">
          <RepoLaunchPanel
            :loading="loading"
            :launch-config="launchConfig"
            :launch-status="launchStatus"
            :action-running="actionRunning"
            :launch-running="launchRunning"
            :active="launchTerminalVisible"
            @start="emit('start')"
            @stop="emit('stop')"
            @open-terminal="emit('openTerminal')"
          />
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.project-panel {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  padding: 0;
}

.project-section__head,
.project-row,
.project-inline-form,
.launch-head,
.launch-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.project-section__head,
.project-row,
.launch-head {
  justify-content: space-between;
}

.project-section h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.project-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 260px);
  grid-template-rows: minmax(0, 1fr);
  gap: 14px;
  align-items: stretch;
  min-width: 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
}

.project-main {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  align-content: start;
  align-self: stretch;
  min-width: 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
}

.project-readme-card,
.project-section,
.project-issue-form,
.project-list,
.project-settings {
  display: grid;
  gap: 12px;
  min-width: 0;
  min-height: 0;
}

.project-readme-card,
.project-section {
  align-self: start;
  max-height: 100%;
  overflow: auto;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
}

.project-terminal-card {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  align-self: start;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  max-height: 100%;
  overflow: hidden;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
}

.launch-head {
  position: relative;
  min-width: 0;
  flex: 1 1 auto;
  max-width: min(520px, 100%);
}

.launch-command-button {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  min-height: 32px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-subtle);
  text-align: left;
  color: var(--text);
}

.launch-command-button strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}

.launch-command-button.is-open,
.launch-command-button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.launch-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  width: 100%;
  min-width: 0;
  max-width: none;
  max-height: 280px;
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.4);
}

.launch-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: auto;
  min-height: 30px;
  padding: 6px 8px;
  border-radius: 6px;
  text-align: left;
}

.launch-menu__item.is-active,
.launch-menu__item:hover {
  background: var(--bg-hover);
}

.launch-menu__label {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.launch-menu__hint {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.launch-actions {
  flex: 0 0 auto;
}

.launch-run-button {
  width: 34px;
  min-width: 34px;
  padding: 0;
  justify-content: center;
}

.project-terminal__body {
  min-height: 0;
  overflow: auto;
}

.project-terminal__body pre {
  max-height: none;
  margin: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
}

.launch-log {
  display: block;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.launch-log--stderr {
  color: var(--err);
}

.launch-log--system {
  color: var(--text-muted);
}

.project-terminal__empty {
  display: grid;
  gap: 4px;
}

.project-empty {
  padding: 12px 0;
}

.project-sidebar {
  display: grid;
  gap: 14px;
  min-width: 0;
  min-height: 0;
  align-content: start;
  align-self: start;
}

.project-sidebar__card {
  display: grid;
  gap: 6px;
  min-width: 0;
  max-height: min(420px, 100%);
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
}

.project-sidebar__launch {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.project-sidebar__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 7px 8px;
  border-radius: 6px;
  text-align: left;
  color: var(--text-muted);
}

.project-sidebar__item:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.project-sidebar__item.is-active {
  background: var(--bg-active);
  color: var(--text);
}

.project-sidebar__launch :deep(.launch-command-button.is-active) {
  background: var(--bg-active);
  color: var(--text);
}

.project-sidebar__item strong,
.project-sidebar__item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-sidebar__item strong {
  font-size: 13px;
  font-weight: 600;
}

.project-sidebar__item span {
  color: var(--text-muted);
  font-size: 11px;
}

.project-sidebar__empty {
  margin: 0;
  padding: 8px 4px;
  color: var(--text-muted);
  font-size: 12px;
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

.project-row--action {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
}

.project-action-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: var(--text-muted);
}

.project-action-status--error {
  color: var(--err);
}

.project-action-status--warn {
  color: var(--warn);
}

.project-action-status--ok {
  color: var(--ok);
}

.project-action-status--muted {
  color: var(--text-muted);
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
  .project-layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .project-sidebar {
    order: -1;
  }

  .project-switches {
    grid-template-columns: 1fr;
  }
}
</style>

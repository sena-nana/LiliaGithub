<script setup lang="ts">
import { AnsiUp } from "ansi_up";
import { computed, defineAsyncComponent, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Check,
  CircleDot,
  CircleOff,
  Eye,
  ExternalLink,
  GitFork,
  GitMerge,
  GitPullRequest,
  ListFilter,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Star,
  Trash2,
  X,
} from "@lucide/vue";
import CommitDetailCard from "./CommitDetailCard.vue";
import MarkdownReadme from "./MarkdownReadme.vue";
import RepoChangesPanel from "./RepoChangesPanel.vue";
import RepoGitHubUnavailableNotice from "./RepoGitHubUnavailableNotice.vue";
import RepoHistoryPanel from "./RepoHistoryPanel.vue";
import RepoTopicEditor from "./RepoTopicEditor.vue";
import { createLatestAsyncLoader } from "../../composables/useLatestAsyncLoader";
import { createPendingTaskTracker } from "../../composables/usePendingTaskTracker";
import { useWorkspace } from "../../composables/useWorkspace";
import { clearHomeGitHubOverviewSnapshot } from "../../pages/homeOverviewCache";
import {
  createGitHubIssue,
  createGitHubPullRequest,
  getGitHubRepoManagement,
  listGitHubRepoReadmes,
  listRepoReadmes,
  listGitHubIssues,
  listGitHubPullRequestChecks,
  listGitHubPullRequests,
  listGitHubWorkflowRuns,
  mergeGitHubPullRequest,
  updateGitHubIssue,
  updateGitHubPullRequest,
  updateGitHubRepoSettings,
  deleteGitHubRepo,
  openPath,
  openUrl,
  isGitHubBindingExpiredError,
} from "../../services/workspace/client";
import type {
  CommitSummary,
  GitHubIssue,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubRepoManagement,
  GitHubUpdateRepoSettingsRequest,
  GitHubWorkflowRun,
  ProjectLaunchConfig,
  ProjectLaunchLog,
  RepoChange,
  RepoConflictFile,
  RepoConflictState,
  RepoReadme,
  RepoSummary,
} from "../../services/workspace/types";
import { isWorkflowRunFailure, workflowRunStatusText, workflowRunStatusTone } from "../../utils/repoDisplay";
import { isLinkedWorktree } from "../../utils/repoWorktree";
import type { ReadmeLinkTarget } from "../../utils/readmeLinks";
import { parseRemoteRepoId, remoteRepoRoute } from "../../utils/remoteRepo";
import type { RepoRouteTab } from "../../utils/repoRoutes";

type GitTab = Exclude<RepoRouteTab, "repo" | "run">;
type ProjectTab = "readme" | "issues" | "pulls" | "actions" | "settings";
type ProjectContentMode = "launch" | ProjectTab | GitTab;
type ProjectSectionConfig = {
  key: Exclude<ProjectTab, "readme">;
  label: string;
};
type PendingTaskTracker = ReturnType<typeof createPendingTaskTracker>;
type GitHubMutationResult<T> = { ok: true; value: T } | { ok: false };
type GitHubAccessSection = "Issues" | "Pull Requests" | "Actions" | "Settings";
type GitHubAccessUnavailable = {
  title: string;
  reason: string;
};
type HistoryCommit = CommitSummary;
type DeleteTarget = "local" | "remote";
type MarkdownReadmeInstance = InstanceType<typeof MarkdownReadme>;

const RepoLanguageStatsCard = defineAsyncComponent(() => import("./RepoLanguageStatsCard.vue"));

const props = defineProps<{
  repoId: string;
  repoTitle?: string;
  repoFullName: string | null | undefined;
  repoPath: string | null | undefined;
  repoSummary?: RepoSummary | null;
  launchConfig: ProjectLaunchConfig | null;
  launchLogs: readonly ProjectLaunchLog[];
  launchError?: string | null;
  launchTerminalVisible: boolean;
  actionRunning: boolean;
  launchRunning: boolean;
  remoteOnly?: boolean;
  usingSystemGit?: boolean;
  activeGitTab: RepoRouteTab;
  changes: readonly RepoChange[];
  previewChange: RepoChange | null;
  commitMessage: string;
  hasConflicts: boolean;
  canCommit: boolean;
  statusCommits: readonly CommitSummary[];
  selectedCommitHash?: string | null;
  conflictOperationText: string;
  conflictSummaryText: string;
  conflictContinueText: string;
  conflictAbortText: string;
  conflictFiles: readonly RepoConflictFile[];
  conflictOperationActive: boolean;
  conflicts: RepoConflictState;
  focusedConflict: RepoConflictFile | null;
  conflictChoices: Record<string, "ours" | "theirs">;
  conflictSelectedCount: number;
  conflictAcceptConfirm: "ours" | "theirs" | null;
  canContinueConflictOperation: boolean;
  canResolveSelectedConflict: boolean;
  supportedConflictOperation: boolean;
  commitMetaTitle: (commit: CommitSummary) => string;
  projectTab?: ProjectTab;
  projectIssueNumber?: number | null;
  projectPullRequestNumber?: number | null;
  projectRunId?: number | null;
  projectRefreshToken?: number;
}>();

const emit = defineEmits<{
  hideTerminal: [];
  updateCommitMessage: [value: string];
  stageUnstagedChanges: [paths?: string[]];
  unstageStagedChanges: [paths?: string[]];
  changeAction: [
    action: "stage" | "unstage" | "discard" | "gitignore" | "copyPath",
    change: RepoChange,
    paths?: string[],
  ];
  focusChange: [path: string];
  commit: [pushAfter: boolean];
  openCommit: [commit: HistoryCommit];
  closeCommit: [];
  cherryPickCommit: [hash: string];
  revertCommit: [hash: string];
  resetCommit: [hash: string, mode: "soft" | "mixed" | "hard"];
  createBranchFromCommit: [hash: string];
  continueConflict: [];
  abortConflict: [];
  focusConflict: [path: string];
  pickConflictHunk: [hunkId: string, side: "ours" | "theirs"];
  resolveSelectedConflict: [];
  acceptConflict: [side: "ours" | "theirs"];
  markConflictResolved: [];
  openConflictFolder: [];
}>();
const workspace = useWorkspace();
const route = useRoute();
const router = useRouter();
const linkedWorktree = computed(() => isLinkedWorktree(workspace.repoById(props.repoId)));

const activeSection = ref<ProjectContentMode>(routeTabToSection(props.activeGitTab));
const markdownReadme = ref<MarkdownReadmeInstance | null>(null);
const terminalBody = ref<HTMLElement | null>(null);
const projectMainRef = ref<HTMLElement | null>(null);
const readmes = ref<RepoReadme[]>([]);
const activeReadmePath = ref<string | null>(null);
const readmesLoaded = ref(false);
const readmeLoading = ref(false);
const readmeError = ref<string | null>(null);
const githubLoading = ref(false);
const githubError = ref<string | null>(null);
const pulls = ref<GitHubPullRequest[]>([]);
const pullState = ref<"open" | "closed" | "all">("open");
const pullChecks = ref<Record<number, GitHubPullRequestCheck[]>>({});
const pullsLoading = ref(false);
const pullChecksLoading = ref(false);
const pullsLoadedState = ref<"open" | "closed" | "all" | null>(null);
const focusedPullRequestNumber = ref<number | null>(null);
const pullRequestTitle = ref("");
const pullRequestBody = ref("");
const pullRequestBase = ref("");
const pullRequestHead = ref("");
const pullRequestDraft = ref(false);
const pullRequestMergeMethod = ref<"merge" | "squash" | "rebase">("merge");
const actionsLoading = ref(false);
const actionsError = ref<string | null>(null);
const remoteDeleted = ref(false);
const deleteDialogTarget = ref<DeleteTarget | null>(null);
const deleteConfirmInput = ref("");
const deleteError = ref<string | null>(null);
const settings = ref<GitHubRepoManagement | null>(null);
const settingsLoaded = ref(false);
const issues = ref<GitHubIssue[]>([]);
const issuesLoadedState = ref<"open" | "closed" | "all" | null>(null);
const workflowRuns = ref<GitHubWorkflowRun[]>([]);
const actionsLoaded = ref(false);
const aboutEditing = ref(false);
const aboutTopicDraft = ref("");
const settingsTopicDraft = ref("");
const issueState = ref<"open" | "closed" | "all">("open");
const issueTitle = ref("");
const issueBody = ref("");
const issueLabels = ref("");
const issueAssignees = ref("");
const editingIssueNumber = ref<number | null>(null);
const editingIssueTitle = ref("");
const editingIssueBody = ref("");
const editingIssueLabels = ref("");
const editingIssueAssignees = ref("");
const focusedIssueNumber = ref<number | null>(null);
const focusedRunId = ref<number | null>(null);
let suppressIssueStateReload = false;
let suppressPullStateReload = false;
const readmeLoader = createLatestAsyncLoader();
const settingsLoader = createLatestAsyncLoader();
const issuesLoader = createLatestAsyncLoader();
const pullsLoader = createLatestAsyncLoader();
const pullChecksLoader = createLatestAsyncLoader();
const actionsLoader = createLatestAsyncLoader();
const settingsSaveTracker = createPendingTaskTracker();
const issueCreateTracker = createPendingTaskTracker();
const issueUpdateTracker = createPendingTaskTracker();
const pullCreateTracker = createPendingTaskTracker();
const pullUpdateTracker = createPendingTaskTracker();
const remoteDeleteTracker = createPendingTaskTracker();
const localDeleteTracker = createPendingTaskTracker();
const savingSettings = settingsSaveTracker.running;
const creatingIssue = issueCreateTracker.running;
const updatingIssue = issueUpdateTracker.running;
const creatingPullRequest = pullCreateTracker.running;
const updatingPullRequest = pullUpdateTracker.running;
const deletingRepo = remoteDeleteTracker.running;
const deletingLocalRepo = localDeleteTracker.running;
let repoMutationGeneration = 0;
let githubMutationGeneration = 0;

const settingsForm = reactive({
  description: "",
  homepage: "",
  topics: [] as string[],
  private: false,
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
type SettingsSwitchKey = keyof Pick<
  typeof settingsForm,
  | "private"
  | "hasIssues"
  | "hasWiki"
  | "hasProjects"
  | "hasDiscussions"
  | "allowForking"
  | "webCommitSignoffRequired"
  | "allowMergeCommit"
  | "allowSquashMerge"
  | "allowRebaseMerge"
  | "allowAutoMerge"
  | "deleteBranchOnMerge"
>;

const featureSettingSwitches: readonly { key: SettingsSwitchKey; label: string; hint: string }[] = [
  { key: "private", label: "Private", hint: "限制仓库访问范围。" },
  { key: "hasIssues", label: "Issues", hint: "启用问题跟踪。" },
  { key: "hasWiki", label: "Wiki", hint: "启用仓库 Wiki。" },
  { key: "hasProjects", label: "Projects", hint: "启用项目看板。" },
  { key: "hasDiscussions", label: "Discussions", hint: "启用社区讨论。" },
  { key: "allowForking", label: "Forking", hint: "允许其他用户 fork。" },
  { key: "webCommitSignoffRequired", label: "Web signoff", hint: "要求网页提交签署。" },
];

const mergeSettingSwitches: readonly { key: SettingsSwitchKey; label: string; hint: string }[] = [
  { key: "allowMergeCommit", label: "Merge commit", hint: "允许创建 merge commit。" },
  { key: "allowSquashMerge", label: "Squash", hint: "允许 squash 合并。" },
  { key: "allowRebaseMerge", label: "Rebase", hint: "允许 rebase 合并。" },
  { key: "allowAutoMerge", label: "Auto merge", hint: "允许满足条件后自动合并。" },
  { key: "deleteBranchOnMerge", label: "合并后删分支", hint: "合并 Pull Request 后删除来源分支。" },
];

const isSystemGitBlocked = computed(() => props.usingSystemGit === true && !props.remoteOnly);
const githubAuthLoading = computed(() => workspace.state.authLoading);

const githubUnavailableMessage = computed(() => {
  if (remoteDeleted.value) return "GitHub 远端仓库已删除，本地目录仍保留。";
  if (isSystemGitBlocked.value) return "系统 Git 下暂不获取 GitHub 权限内容。";
  if (!props.repoFullName) return "当前仓库没有 GitHub 远端，Issues、Actions 和 Settings 不可用。";
  return null;
});
const issuesAccessUnavailable = computed(() => githubAccessUnavailable("Issues", githubError.value));
const pullsAccessUnavailable = computed(() => githubAccessUnavailable("Pull Requests", githubError.value));
const actionsAccessUnavailable = computed(() => githubAccessUnavailable("Actions", actionsError.value));
const settingsAccessUnavailable = computed(() => githubAccessUnavailable("Settings", githubError.value));
const aboutDescription = computed(() => settings.value?.description?.trim() ?? "");
const aboutHomepage = computed(() => settings.value?.homepage?.trim() ?? "");
const aboutHomepageHref = computed(() => normalizedExternalUrl(aboutHomepage.value));
const aboutTopics = computed(() => settings.value?.topics ?? []);
const aboutStats = computed(() => {
  const repo = settings.value;
  if (!repo) return [];
  return [
    {
      key: "stars",
      label: repo.stargazersCount === 1 ? "star" : "stars",
      value: repo.stargazersCount,
      icon: Star,
    },
    { key: "watching", label: "watching", value: repo.watchersCount, icon: Eye },
    {
      key: "forks",
      label: repo.forksCount === 1 ? "fork" : "forks",
      value: repo.forksCount,
      icon: GitFork,
    },
  ].map((stat) => {
    const count = formatGitHubCount(stat.value);
    return { ...stat, count, text: `${count} ${stat.label}` };
  });
});
const deleteConfirmMatches = computed(() =>
  Boolean(deleteExpectedInput.value) && deleteConfirmInput.value.trim() === deleteExpectedInput.value,
);
const deleteExpectedInput = computed(() =>
  deleteDialogTarget.value === "remote" ? props.repoFullName : props.repoId,
);
const localDeleteTitle = computed(() => linkedWorktree.value ? "删除工作树" : "删除本地仓库");
const deleteDialogTitle = computed(() =>
  deleteDialogTarget.value === "remote" ? "删除 GitHub 仓库" : localDeleteTitle.value,
);
const deletingAnything = computed(() => deletingRepo.value || deletingLocalRepo.value);
const activeReadme = computed(() =>
  readmes.value.find((item) => item.path === activeReadmePath.value) ?? readmes.value[0] ?? null,
);
const languageStatsLoading = computed(() => workspace.state.languageStatsLoadingRepoIds.includes(props.repoId));
const currentBranchName = computed(() => workspace.repoById(props.repoId)?.currentBranch ?? "");
const readmePaths = computed(() => readmes.value.map((item) => item.path));
const projectSections: readonly ProjectSectionConfig[] = [
  { key: "issues", label: "Issues" },
  { key: "pulls", label: "Pull Requests" },
  { key: "actions", label: "Actions" },
  { key: "settings", label: "Settings" },
];
const githubStateFilters: readonly { value: "open" | "closed" | "all"; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];
const mergeMethodOptions: readonly { value: "merge" | "squash" | "rebase"; label: string }[] = [
  { value: "merge", label: "Merge" },
  { value: "squash", label: "Squash" },
  { value: "rebase", label: "Rebase" },
];
const canUseLaunchWorkflow = computed(() => !props.remoteOnly);
const showCommitDetail = computed(() =>
  activeSection.value === "history" && Boolean(props.selectedCommitHash),
);
const showProjectSidebar = computed(() =>
  activeSection.value === "readme" ||
  activeSection.value === "issues" ||
  activeSection.value === "pulls" ||
  activeSection.value === "actions" ||
  activeSection.value === "settings",
);
const terminalHtml = computed(() => renderTerminalHtml(props.launchLogs));
const focusedPullRequest = computed(() =>
  pulls.value.find((pull) => pull.number === focusedPullRequestNumber.value) ?? null,
);
const focusedPullChecks = computed(() =>
  focusedPullRequestNumber.value ? (pullChecks.value[focusedPullRequestNumber.value] ?? []) : [],
);

function isProjectSectionActive(section: ProjectContentMode, options?: { readmePath?: string }) {
  if (section === "readme") {
    return activeSection.value === "readme" && activeReadmePath.value === options?.readmePath;
  }
  return activeSection.value === section;
}
const projectTab = computed<ProjectTab>(() => normalizeProjectTab(props.projectTab) ?? "readme");
const routedProjectTab = computed(() => normalizeProjectTab(route.query.projectTab));
const routedProjectPullRequest = computed(() => normalizePositiveNumber(route.query.pr));

onMounted(() => {
  void applyProjectRouteState();
});

watch(() => props.repoId, () => {
  resetProjectSectionState();
  closeDeleteDialog();
  void applyProjectRouteState();
});

watch(() => props.repoFullName, () => {
  const currentSection = activeSection.value;
  remoteDeleted.value = false;
  resetGitHubSectionState();
  closeDeleteDialog();
  if (props.activeGitTab === "repo" && !routedProjectTab.value && isGitHubProjectSection(currentSection)) {
    activeSection.value = currentSection;
    void ensureSectionData(currentSection);
    return;
  }
  void applyProjectRouteState();
});

watch(() => props.usingSystemGit, (usingSystemGit) => {
  if (usingSystemGit && !props.remoteOnly) {
    clearBlockedGitHubState();
  }
});

watch([() => props.launchLogs.length, () => props.launchRunning], () => {
  if (!props.launchTerminalVisible) return;
  void scrollTerminalToEnd();
});

watch(issueState, () => {
  if (suppressIssueStateReload) {
    suppressIssueStateReload = false;
    return;
  }
  if (activeSection.value === "issues") {
    void loadIssues();
  }
});

watch(pullState, () => {
  if (suppressPullStateReload) {
    suppressPullStateReload = false;
    return;
  }
  if (activeSection.value === "pulls") {
    void loadPullRequests();
  }
});

watch(
  [routedProjectTab, () => props.projectIssueNumber, routedProjectPullRequest, () => props.projectRunId],
  () => {
    void applyProjectRouteState();
  },
);

watch(() => props.projectRefreshToken, () => {
  void refreshLoadedSectionData();
});

watch(() => props.activeGitTab, (tab) => {
  activeSection.value = routeTabToSection(tab);
  if (tab !== "repo" || !routedProjectTab.value) {
    void ensureSectionData(activeSection.value);
  }
});

function normalizeProjectTab(value: unknown): ProjectTab | null {
  if (value === "readme" || value === "issues" || value === "pulls" || value === "actions" || value === "settings") return value;
  return null;
}

function normalizePositiveNumber(value: unknown) {
  const next = Array.isArray(value) ? value[0] : value;
  if (typeof next !== "string") return null;
  const parsed = Number.parseInt(next, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

function routeTabToSection(tab: RepoRouteTab): ProjectContentMode {
  if (tab === "repo") return normalizeProjectTab(props.projectTab) ?? "readme";
  if (tab === "run") return "launch";
  return tab;
}

function isGitHubProjectSection(section: ProjectContentMode) {
  return section === "issues" || section === "pulls" || section === "actions" || section === "settings";
}

function hasIssue(issueNumber: number) {
  return issues.value.some((issue) => issue.number === issueNumber);
}

function hasPullRequest(pullNumber: number) {
  return pulls.value.some((pull) => pull.number === pullNumber);
}

function hasRun(runId: number) {
  return workflowRuns.value.some((run) => run.id === runId);
}

function clearProjectTargets() {
  focusedIssueNumber.value = null;
  focusedPullRequestNumber.value = null;
  focusedRunId.value = null;
  cancelEditIssue();
}

function renderTerminalHtml(logs: readonly ProjectLaunchLog[]) {
  const ansiUp = new AnsiUp();
  return logs
    .map((entry) => `<span class="launch-log launch-log--${entry.stream}">${ansiUp.ansi_to_html(entry.line)}</span>`)
    .join("\n");
}

const githubCountFormatter = new Intl.NumberFormat("en-US");

function formatGitHubCount(value: number) {
  return githubCountFormatter.format(Math.max(0, value));
}

function githubAccessUnavailable(section: GitHubAccessSection, error: string | null): GitHubAccessUnavailable | null {
  if (!error || !isGitHubBindingExpiredError(error)) return null;
  const lower = error.toLowerCase();
  const permissionDenied = error.includes("HTTP 403") ||
    lower.includes("forbidden") ||
    lower.includes("resource not accessible");
  return {
    title: `${section} 暂不可用`,
    reason: permissionDenied
      ? `当前 GitHub 授权权限不足，无法访问该仓库的 ${section}。请重新绑定 GitHub 并授予所需权限。`
      : "GitHub 绑定已失效或凭据不可用，请重新绑定 GitHub 后继续使用。",
  };
}

function rebindGitHub() {
  void workspace.startAuthFlow();
}

async function focusIssue(issueNumber: number | null | undefined) {
  focusedPullRequestNumber.value = null;
  focusedRunId.value = null;
  if (!issueNumber) {
    clearProjectTargets();
    await loadIssues();
    return;
  }
  if (issueState.value !== "all" && !hasIssue(issueNumber)) {
    suppressIssueStateReload = true;
    issueState.value = "all";
  }
  await loadIssues();
  if (!hasIssue(issueNumber)) {
    focusedIssueNumber.value = null;
    return;
  }
  focusedIssueNumber.value = issueNumber;
  await nextTick();
  const row = projectMainRef.value?.querySelector<HTMLElement>(
    `.project-row--issue[data-issue-number="${issueNumber}"]`,
  );
  row?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
}

async function focusRun(runId: number | null | undefined) {
  focusedIssueNumber.value = null;
  focusedPullRequestNumber.value = null;
  if (!runId) {
    clearProjectTargets();
    await loadActions();
    return;
  }
  if (!hasRun(runId)) {
    await loadActions(true);
  }
  if (!hasRun(runId)) {
    focusedRunId.value = null;
    return;
  }
  focusedRunId.value = runId;
  await nextTick();
  const row = projectMainRef.value?.querySelector<HTMLElement>(
    `.project-row--action[data-run-id="${runId}"]`,
  );
  row?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
}

async function focusPullRequest(pullNumber: number | null | undefined) {
  focusedIssueNumber.value = null;
  focusedRunId.value = null;
  if (!pullNumber) {
    await loadPullRequests();
    focusedPullRequestNumber.value = pulls.value[0]?.number ?? null;
    if (focusedPullRequestNumber.value) {
      await loadPullRequestChecks(focusedPullRequestNumber.value);
    }
    return;
  }
  if (pullState.value !== "all" && !hasPullRequest(pullNumber)) {
    suppressPullStateReload = true;
    pullState.value = "all";
  }
  await loadPullRequests();
  if (!hasPullRequest(pullNumber)) {
    focusedPullRequestNumber.value = null;
    return;
  }
  focusedPullRequestNumber.value = pullNumber;
  await loadPullRequestChecks(pullNumber);
  await nextTick();
  const row = projectMainRef.value?.querySelector<HTMLElement>(
    `.project-row--pull[data-pull-number="${pullNumber}"]`,
  );
  row?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
}

function isIssueRowFocused(issueNumber: number) {
  return focusedIssueNumber.value === issueNumber && activeSection.value === "issues";
}

function isRunRowFocused(runId: number) {
  return focusedRunId.value === runId && activeSection.value === "actions";
}

function isPullRequestRowFocused(pullNumber: number) {
  return focusedPullRequestNumber.value === pullNumber && activeSection.value === "pulls";
}

async function applyProjectRouteState() {
  activeSection.value = routeTabToSection(props.activeGitTab);
  if (props.activeGitTab !== "repo") {
    clearProjectTargets();
    return;
  }
  const targetTab = projectTab.value;
  await nextTick();
  clearProjectTargets();
  if (targetTab === "issues") {
    await focusIssue(props.projectIssueNumber);
    return;
  }
  if (targetTab === "pulls") {
    await focusPullRequest(props.projectPullRequestNumber ?? routedProjectPullRequest.value);
    return;
  }
  if (targetTab === "actions") {
    await focusRun(props.projectRunId);
    return;
  }
  await ensureSectionData(targetTab);
}

function applySettingsForm(next: GitHubRepoManagement) {
  settingsForm.description = next.description ?? "";
  settingsForm.homepage = next.homepage ?? "";
  settingsForm.topics = [...next.topics];
  settingsForm.private = next.private;
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

async function startEditAbout() {
  if (!settings.value) await loadSettings();
  if (!settings.value) return;
  applySettingsForm(settings.value);
  aboutTopicDraft.value = "";
  aboutEditing.value = true;
}

function cancelEditAbout() {
  if (settings.value) applySettingsForm(settings.value);
  aboutTopicDraft.value = "";
  aboutEditing.value = false;
}

async function loadReadme(force = false) {
  if (!props.repoId) return;
  if (!force && readmesLoaded.value) return;
  const repoId = props.repoId;
  const repoFullName = props.repoFullName;
  const remoteOnly = props.remoteOnly;
  await readmeLoader.run(null, async (runId) => {
    readmeLoading.value = true;
    readmeError.value = null;
    const previousPath = activeReadmePath.value;
    try {
      const nextReadmes = remoteOnly && repoFullName
        ? force
          ? await listGitHubRepoReadmes(repoFullName, { forceRefresh: true })
          : await listGitHubRepoReadmes(repoFullName)
        : await listRepoReadmes(repoId);
      if (
        !readmeLoader.isCurrent(runId) ||
        repoId !== props.repoId ||
        repoFullName !== props.repoFullName ||
        remoteOnly !== props.remoteOnly
      ) return;
      readmes.value = nextReadmes;
      activeReadmePath.value = nextReadmes.some((item) => item.path === previousPath)
        ? previousPath
        : nextReadmes[0]?.path ?? null;
      readmesLoaded.value = true;
    } catch (err) {
      readmeError.value = String(err);
    } finally {
      if (readmeLoader.isCurrent(runId)) {
        readmeLoading.value = false;
      }
    }
  }, { reusePending: !force });
}

async function loadSettings(force = false) {
  const repoFullName = props.repoFullName;
  if (isSystemGitBlocked.value) {
    clearBlockedGitHubState();
    return;
  }
  if (!repoFullName || remoteDeleted.value) {
    settings.value = null;
    githubError.value = null;
    return;
  }
  if (!force && settingsLoaded.value) return;
  await settingsLoader.run(null, async (runId) => {
    githubLoading.value = true;
    githubError.value = null;
    try {
      const nextSettings = force
        ? await getGitHubRepoManagement(repoFullName, { forceRefresh: true })
        : await getGitHubRepoManagement(repoFullName);
      if (!settingsLoader.isCurrent(runId) || repoFullName !== props.repoFullName || remoteDeleted.value) return;
      settings.value = nextSettings;
      applySettingsForm(nextSettings);
      preparePullRequestDefaults();
      settingsLoaded.value = true;
    } catch (err) {
      githubError.value = String(err);
    } finally {
      if (settingsLoader.isCurrent(runId)) {
        githubLoading.value = false;
      }
    }
  }, { reusePending: !force });
}

async function loadIssues(force = false) {
  const repoFullName = props.repoFullName;
  if (isSystemGitBlocked.value) {
    clearBlockedGitHubState();
    return;
  }
  if (!repoFullName || remoteDeleted.value) return;
  if (!force && issuesLoadedState.value === issueState.value) return;
  const stateKey = issueState.value;
  githubError.value = null;
  await issuesLoader.run(stateKey, async (runId) => {
    try {
      const nextIssues = force
        ? await listGitHubIssues(repoFullName, stateKey, { forceRefresh: true })
        : await listGitHubIssues(repoFullName, stateKey);
      if (!issuesLoader.isCurrent(runId) || repoFullName !== props.repoFullName || remoteDeleted.value) return;
      issues.value = nextIssues;
      issuesLoadedState.value = stateKey;
      syncEditingIssue();
    } catch (err) {
      githubError.value = String(err);
    }
  }, { reusePending: !force });
}

async function loadPullRequests(force = false) {
  const repoFullName = props.repoFullName;
  if (isSystemGitBlocked.value) {
    clearBlockedGitHubState();
    return;
  }
  if (!repoFullName || remoteDeleted.value) return;
  if (!force && pullsLoadedState.value === pullState.value) return;
  const stateKey = pullState.value;
  githubError.value = null;
  pullsLoading.value = true;
  await pullsLoader.run(stateKey, async (runId) => {
    try {
      const nextPulls = force
        ? await listGitHubPullRequests(repoFullName, stateKey, { forceRefresh: true })
        : await listGitHubPullRequests(repoFullName, stateKey);
      if (!pullsLoader.isCurrent(runId) || repoFullName !== props.repoFullName || remoteDeleted.value) return;
      pulls.value = nextPulls;
      pullsLoadedState.value = stateKey;
      const current = focusedPullRequestNumber.value;
      if (current && nextPulls.some((pull) => pull.number === current)) {
        await loadPullRequestChecks(current, force);
      } else {
        focusedPullRequestNumber.value = nextPulls[0]?.number ?? null;
        if (focusedPullRequestNumber.value) {
          await loadPullRequestChecks(focusedPullRequestNumber.value, force);
        }
      }
    } catch (err) {
      githubError.value = String(err);
    } finally {
      if (pullsLoader.isCurrent(runId)) {
        pullsLoading.value = false;
      }
    }
  }, { reusePending: !force });
}

async function loadPullRequestChecks(pullNumber: number, force = false) {
  const repoFullName = props.repoFullName;
  if (!repoFullName || remoteDeleted.value) return;
  if (!force && pullChecks.value[pullNumber]) return;
  pullChecksLoading.value = true;
  await pullChecksLoader.run(pullNumber, async (runId) => {
    try {
      const checks = force
        ? await listGitHubPullRequestChecks(repoFullName, pullNumber, { forceRefresh: true })
        : await listGitHubPullRequestChecks(repoFullName, pullNumber);
      if (!pullChecksLoader.isCurrent(runId) || repoFullName !== props.repoFullName || remoteDeleted.value) return;
      pullChecks.value = {
        ...pullChecks.value,
        [pullNumber]: checks,
      };
    } catch (err) {
      githubError.value = String(err);
    } finally {
      if (pullChecksLoader.isCurrent(runId)) {
        pullChecksLoading.value = false;
      }
    }
  });
}

async function loadActions(force = false) {
  const repoFullName = props.repoFullName;
  if (isSystemGitBlocked.value) {
    clearBlockedGitHubState();
    actionsLoading.value = false;
    return;
  }
  if (!repoFullName || remoteDeleted.value) {
    workflowRuns.value = [];
    actionsError.value = null;
    return;
  }
  if (!force && actionsLoaded.value) return;
  await actionsLoader.run(null, async (runId) => {
    actionsLoading.value = true;
    actionsError.value = null;
    try {
      const nextRuns = force
        ? await listGitHubWorkflowRuns(repoFullName, 20, { forceRefresh: true })
        : await listGitHubWorkflowRuns(repoFullName, 20);
      if (!actionsLoader.isCurrent(runId) || repoFullName !== props.repoFullName || remoteDeleted.value) return;
      workflowRuns.value = nextRuns;
      actionsLoaded.value = true;
    } catch (err) {
      actionsError.value = String(err);
    } finally {
      if (actionsLoader.isCurrent(runId)) {
        actionsLoading.value = false;
      }
    }
  }, { reusePending: !force });
}

async function ensureSectionData(section: ProjectContentMode) {
  if (section === "readme") {
    await Promise.all([loadReadme(), props.repoFullName ? loadSettings() : Promise.resolve()]);
    return;
  }
  if (section === "issues") {
    await loadIssues();
    return;
  }
  if (section === "pulls") {
    await loadPullRequests();
    return;
  }
  if (section === "actions") {
    await loadActions();
    return;
  }
  if (section === "settings") {
    await loadSettings();
  }
}

async function refreshLoadedSectionData() {
  if (activeSection.value === "readme") {
    if (readmesLoaded.value || settingsLoaded.value) {
      await Promise.all([
        readmesLoaded.value ? loadReadme(true) : Promise.resolve(),
        props.repoFullName && settingsLoaded.value ? loadSettings(true) : Promise.resolve(),
      ]);
    }
    return;
  }
  if (activeSection.value === "issues" && issuesLoadedState.value) {
    await loadIssues(true);
    return;
  }
  if (activeSection.value === "pulls" && pullsLoadedState.value) {
    await loadPullRequests(true);
    return;
  }
  if (activeSection.value === "actions" && actionsLoaded.value) {
    await loadActions(true);
    return;
  }
  if (activeSection.value === "settings" && settingsLoaded.value) {
    await loadSettings(true);
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
  if (!sameStringList(settingsForm.topics, current.topics)) request.topics = [...settingsForm.topics];
  maybeSet("private", settingsForm.private, current.private);
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

function clearBlockedGitHubState() {
  resetGitHubSectionState();
  githubLoading.value = false;
  actionsLoading.value = false;
}

function resetProjectSectionState() {
  activeSection.value = routeTabToSection(props.activeGitTab);
  readmeLoader.invalidate();
  invalidateRepoMutations();
  readmes.value = [];
  activeReadmePath.value = null;
  readmesLoaded.value = false;
  readmeLoading.value = false;
  readmeError.value = null;
  resetGitHubSectionState();
}

function resetGitHubSectionState() {
  settingsLoader.invalidate();
  issuesLoader.invalidate();
  pullsLoader.invalidate();
  pullChecksLoader.invalidate();
  actionsLoader.invalidate();
  invalidateGitHubMutations();
  settings.value = null;
  settingsLoaded.value = false;
  issues.value = [];
  issuesLoadedState.value = null;
  pulls.value = [];
  pullChecks.value = {};
  pullsLoadedState.value = null;
  pullsLoading.value = false;
  pullChecksLoading.value = false;
  focusedPullRequestNumber.value = null;
  pullRequestTitle.value = "";
  pullRequestBody.value = "";
  pullRequestBase.value = "";
  pullRequestHead.value = "";
  pullRequestDraft.value = false;
  pullRequestMergeMethod.value = "merge";
  workflowRuns.value = [];
  actionsLoaded.value = false;
  githubError.value = null;
  actionsError.value = null;
  aboutEditing.value = false;
  aboutTopicDraft.value = "";
  settingsTopicDraft.value = "";
  cancelEditIssue();
  focusedIssueNumber.value = null;
  focusedRunId.value = null;
}

function invalidateGitHubMutations() {
  githubMutationGeneration += 1;
  settingsSaveTracker.reset();
  issueCreateTracker.reset();
  issueUpdateTracker.reset();
  pullCreateTracker.reset();
  pullUpdateTracker.reset();
  remoteDeleteTracker.reset();
}

function invalidateRepoMutations() {
  repoMutationGeneration += 1;
  localDeleteTracker.reset();
}

function isGitHubMutationCurrent(generation: number, repoFullName: string) {
  return generation === githubMutationGeneration && props.repoFullName === repoFullName && !remoteDeleted.value;
}

function isRepoMutationCurrent(generation: number, repoId: string) {
  return generation === repoMutationGeneration && props.repoId === repoId;
}

async function runGitHubMutation<T>(
  repoFullName: string,
  tracker: PendingTaskTracker,
  task: () => Promise<T>,
): Promise<GitHubMutationResult<T>> {
  const generation = githubMutationGeneration;
  githubError.value = null;
  try {
    const value = await tracker.run(task);
    if (!isGitHubMutationCurrent(generation, repoFullName)) return { ok: false };
    return { ok: true, value };
  } catch (err) {
    if (isGitHubMutationCurrent(generation, repoFullName)) {
      githubError.value = String(err);
    }
    return { ok: false };
  }
}

async function saveSettings(closeAboutOnSuccess = false) {
  const repoFullName = props.repoFullName;
  if (!repoFullName || !settings.value) return;
  const request = changedSettingsRequest(settings.value);
  if (!Object.keys(request).length) {
    if (closeAboutOnSuccess) aboutEditing.value = false;
    return true;
  }
  const result = await runGitHubMutation(repoFullName, settingsSaveTracker, () =>
    updateGitHubRepoSettings(repoFullName, request)
  );
  if (!result.ok) return false;
  const next = result.value;
  settings.value = next;
  applySettingsForm(next);
  aboutTopicDraft.value = "";
  settingsTopicDraft.value = "";
  if (closeAboutOnSuccess) aboutEditing.value = false;
  clearHomeGitHubOverviewSnapshot();
  return true;
}

function normalizedExternalUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function sameStringList(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function openDeleteDialog(target: DeleteTarget) {
  if (target === "remote" && (!props.repoFullName || deletingRepo.value)) return;
  if (target === "local" && (props.remoteOnly || !props.repoPath || deletingLocalRepo.value)) return;
  deleteDialogTarget.value = target;
  deleteConfirmInput.value = "";
  deleteError.value = null;
}

function closeDeleteDialog() {
  if (deletingAnything.value) return;
  deleteDialogTarget.value = null;
  deleteConfirmInput.value = "";
  deleteError.value = null;
}

async function confirmDeleteDialog() {
  if (deleteDialogTarget.value === "local") {
    await confirmDeleteLocalRepo();
    return;
  }
  await confirmDeleteRepo();
}

async function confirmDeleteLocalRepo() {
  const repoId = props.repoId;
  if (!repoId || props.remoteOnly || !deleteConfirmMatches.value || deletingLocalRepo.value) return;
  const generation = repoMutationGeneration;
  deleteError.value = null;
  try {
    await localDeleteTracker.run(() => workspace.deleteLocalRepo(repoId));
    if (!isRepoMutationCurrent(generation, repoId)) return;
    deleteDialogTarget.value = null;
    deleteConfirmInput.value = "";
    workspace.refreshRepoStatusList();
    await router.push("/");
  } catch (err) {
    if (isRepoMutationCurrent(generation, repoId)) {
      deleteError.value = String(err);
    }
  }
}

async function confirmDeleteRepo() {
  const repoFullName = props.repoFullName;
  if (!repoFullName || !deleteConfirmMatches.value || deletingRepo.value) return;
  const generation = githubMutationGeneration;
  deleteError.value = null;
  githubError.value = null;
  try {
    await remoteDeleteTracker.run(async () => {
      await deleteGitHubRepo(repoFullName);
      await workspace.forgetRemoteRepo(repoFullName);
    });
    if (!isGitHubMutationCurrent(generation, repoFullName)) return;
    clearHomeGitHubOverviewSnapshot();
    workspace.refreshRepoStatusList();
    remoteDeleted.value = true;
    settings.value = null;
    issues.value = [];
    workflowRuns.value = [];
    deleteDialogTarget.value = null;
    deleteConfirmInput.value = "";
    const targetRoute = remoteRepoRoute(repoFullName);
    const currentRemoteFullName = parseRemoteRepoId(String(route.params.repoId ?? ""));
    if (
      props.remoteOnly &&
      currentRemoteFullName && repoFullName.toLowerCase() === currentRemoteFullName.toLowerCase()
      && route.fullPath.startsWith(targetRoute)
    ) {
      await router.push("/");
    }
  } catch (err) {
    if (isGitHubMutationCurrent(generation, repoFullName)) {
      deleteError.value = String(err);
    }
  }
}

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function isEditingIssue(issueNumber: number) {
  return editingIssueNumber.value === issueNumber;
}

function syncEditingIssue() {
  if (!hasIssue(editingIssueNumber.value ?? -1)) {
    cancelEditIssue();
  }
}

function startEditIssue(issue: GitHubIssue) {
  editingIssueNumber.value = issue.number;
  editingIssueTitle.value = issue.title;
  editingIssueBody.value = issue.body ?? "";
  editingIssueLabels.value = issue.labels.join(", ");
  editingIssueAssignees.value = issue.assignees.join(", ");
}

function cancelEditIssue() {
  editingIssueNumber.value = null;
  editingIssueTitle.value = "";
  editingIssueBody.value = "";
  editingIssueLabels.value = "";
  editingIssueAssignees.value = "";
}

async function saveIssueEdit(issue: GitHubIssue) {
  const repoFullName = props.repoFullName;
  if (!repoFullName || updatingIssue.value) return;
  const nextTitle = editingIssueTitle.value.trim();
  if (!nextTitle) return;
  const request = {
    title: nextTitle,
    body: editingIssueBody.value,
    labels: splitList(editingIssueLabels.value),
    assignees: splitList(editingIssueAssignees.value),
  };
  const result = await runGitHubMutation(repoFullName, issueUpdateTracker, () =>
    updateGitHubIssue(repoFullName, issue.number, request)
  );
  if (!result.ok) return;
  const updated = result.value;
  issues.value = issues.value.map((item) => item.number === updated.number ? updated : item);
  cancelEditIssue();
}

async function createIssue() {
  const repoFullName = props.repoFullName;
  if (!repoFullName || creatingIssue.value) return;
  const request = {
    title: issueTitle.value,
    body: issueBody.value,
    labels: splitList(issueLabels.value),
    assignees: splitList(issueAssignees.value),
  };
  const result = await runGitHubMutation(repoFullName, issueCreateTracker, () =>
    createGitHubIssue(repoFullName, request)
  );
  if (!result.ok) return;
  const issue = result.value;
  issues.value = [issue, ...issues.value];
  issueTitle.value = "";
  issueBody.value = "";
  issueLabels.value = "";
  issueAssignees.value = "";
}

async function toggleIssue(issue: GitHubIssue) {
  const repoFullName = props.repoFullName;
  if (!repoFullName) return;
  const result = await runGitHubMutation(repoFullName, issueUpdateTracker, () =>
    updateGitHubIssue(repoFullName, issue.number, {
      state: issue.state === "open" ? "closed" : "open",
    })
  );
  if (!result.ok) return;
  const updated = result.value;
  issues.value = issues.value.map((item) => item.number === updated.number ? updated : item);
}

function preparePullRequestDefaults() {
  if (!pullRequestHead.value.trim()) {
    pullRequestHead.value = currentBranchName.value;
  }
  if (!pullRequestBase.value.trim()) {
    pullRequestBase.value = settings.value?.defaultBranch ?? "";
  }
}

async function createPullRequest() {
  const repoFullName = props.repoFullName;
  if (!repoFullName || creatingPullRequest.value) return;
  preparePullRequestDefaults();
  const title = pullRequestTitle.value.trim();
  const head = pullRequestHead.value.trim();
  const base = pullRequestBase.value.trim();
  if (!title || !head || !base) return;
  const request = {
    title,
    body: pullRequestBody.value,
    head,
    base,
    draft: pullRequestDraft.value,
  };
  const result = await runGitHubMutation(repoFullName, pullCreateTracker, () =>
    createGitHubPullRequest(repoFullName, request)
  );
  if (!result.ok) return;
  const pull = result.value;
  pulls.value = [pull, ...pulls.value.filter((item) => item.number !== pull.number)];
  focusedPullRequestNumber.value = pull.number;
  pullRequestTitle.value = "";
  pullRequestBody.value = "";
  pullRequestDraft.value = false;
  pullState.value = "open";
  await loadPullRequestChecks(pull.number, true);
}

async function togglePullRequestState(pull: GitHubPullRequest) {
  const repoFullName = props.repoFullName;
  if (!repoFullName || updatingPullRequest.value) return;
  const result = await runGitHubMutation(repoFullName, pullUpdateTracker, () =>
    updateGitHubPullRequest(repoFullName, pull.number, {
      state: pull.state === "open" ? "closed" : "open",
    })
  );
  if (!result.ok) return;
  const updated = result.value;
  pulls.value = pulls.value.map((item) => item.number === updated.number ? updated : item);
}

async function mergePullRequest(pull: GitHubPullRequest) {
  const repoFullName = props.repoFullName;
  if (!repoFullName || updatingPullRequest.value) return;
  const method = pullRequestMergeMethod.value;
  const result = await runGitHubMutation(repoFullName, pullUpdateTracker, () =>
    mergeGitHubPullRequest(repoFullName, pull.number, {
      method,
    })
  );
  if (!result.ok) return;
  const updated = result.value;
  pulls.value = pulls.value.map((item) => item.number === updated.number ? updated : item);
  focusedPullRequestNumber.value = updated.number;
  await loadPullRequestChecks(updated.number, true);
}

async function focusPullRequestRow(pull: GitHubPullRequest) {
  focusedPullRequestNumber.value = pull.number;
  await loadPullRequestChecks(pull.number);
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
  activeSection.value = tab;
  if (canUseLaunchWorkflow.value && props.launchTerminalVisible) {
    emit("hideTerminal");
  }
  void ensureSectionData(tab);
}

function activateProjectSection(tab: ProjectSectionConfig["key"]) {
  activateProjectTab(tab);
}

function selectReadme(path: string) {
  activeReadmePath.value = path;
  activateProjectTab("readme");
}

</script>

<template>
  <section class="project-panel">
    <div
      class="project-layout"
      :class="{
        'project-layout--with-commit-detail': showCommitDetail,
        'project-layout--full': !showProjectSidebar,
      }"
    >
      <main ref="projectMainRef" class="project-main">
        <section v-if="canUseLaunchWorkflow && activeSection === 'launch'" class="project-terminal-card">
          <div ref="terminalBody" class="project-terminal__body" aria-label="启动终端">
            <div v-if="launchError" class="project-terminal__line project-terminal__line--error">{{ launchError }}</div>
            <pre v-if="launchLogs.length" class="project-terminal__output"><code v-html="terminalHtml"></code></pre>
            <div v-else class="project-terminal__line project-terminal__line--muted">暂无输出。</div>
          </div>
        </section>

        <RepoChangesPanel
          v-else-if="!remoteOnly && activeSection === 'changes'"
          :commit-message="commitMessage"
          :changes="changes"
          :has-conflicts="hasConflicts"
          :can-commit="canCommit"
          :action-running="actionRunning"
          :preview-change="previewChange"
          @stage-unstaged-changes="emit('stageUnstagedChanges', $event)"
          @unstage-staged-changes="emit('unstageStagedChanges', $event)"
          @change-action="(action, change, paths) => emit('changeAction', action, change, paths)"
          @focus-change="emit('focusChange', $event)"
          @commit="emit('commit', $event)"
          @update:commit-message="emit('updateCommitMessage', $event)"
        />

        <RepoHistoryPanel
          v-else-if="activeSection === 'history'"
          :commits="statusCommits"
          :commit-meta-title="commitMetaTitle"
          :selected-commit-hash="selectedCommitHash"
          :read-only="remoteOnly"
          @open-commit="emit('openCommit', $event)"
          @cherry-pick-commit="emit('cherryPickCommit', $event)"
          @revert-commit="emit('revertCommit', $event)"
          @reset-commit="emit('resetCommit', $event.hash, $event.mode)"
          @create-branch-from-commit="emit('createBranchFromCommit', $event)"
        />

        <section v-else-if="activeSection === 'launch'" class="project-section">
          <p class="muted repo-empty project-empty">命令运行仅支持本地仓库。</p>
        </section>

        <section v-else-if="activeSection === 'readme'" class="project-readme-card">
          <p v-if="readmeError" class="error-line">{{ readmeError }}</p>
          <p v-else-if="readmeLoading" class="muted repo-empty project-empty">正在读取 README。</p>
          <p v-else-if="!activeReadme" class="muted repo-empty project-empty">
            {{ remoteOnly ? "当前远程仓库没有 README。" : "当前仓库没有本地 README。" }}
          </p>
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

        <section v-else-if="githubUnavailableMessage && activeSection !== 'settings'" class="project-section">
          <p class="muted repo-empty project-empty">{{ githubUnavailableMessage }}</p>
        </section>

        <section v-else-if="activeSection === 'issues'" class="project-section project-github-section">
          <div class="project-section__head project-section__head--compact">
            <div class="project-section__title">
              <h3>Issues</h3>
              <span>{{ issues.length }} items</span>
            </div>
            <div class="project-toolbar" aria-label="Issue filters">
              <ListFilter :size="14" aria-hidden="true" />
              <div class="ui-segmented project-segmented" role="group" aria-label="Issue 状态">
                <button
                  v-for="filter in githubStateFilters"
                  :key="filter.value"
                  type="button"
                  :class="{ 'is-active': issueState === filter.value }"
                  :aria-pressed="issueState === filter.value"
                  @click="issueState = filter.value"
                >
                  {{ filter.label }}
                </button>
              </div>
            </div>
          </div>
          <RepoGitHubUnavailableNotice
            v-if="issuesAccessUnavailable"
            :title="issuesAccessUnavailable.title"
            :reason="issuesAccessUnavailable.reason"
            :loading="githubAuthLoading"
            @rebind="rebindGitHub"
          />
          <p v-else-if="githubError" class="error-line">{{ githubError }}</p>
          <form v-if="!issuesAccessUnavailable" class="project-compact-form" @submit.prevent="createIssue">
            <div class="project-compact-form__line">
              <input v-model="issueTitle" class="project-compact-form__title" type="text" placeholder="Issue 标题" />
              <input v-model="issueLabels" type="text" placeholder="labels" />
              <input v-model="issueAssignees" type="text" placeholder="assignees" />
              <button
                type="submit"
                class="primary project-icon-action project-icon-action--primary"
                :disabled="creatingIssue || !issueTitle.trim()"
                aria-label="新建 Issue"
                title="新建 Issue"
              >
                <LoaderCircle v-if="creatingIssue" :size="14" aria-hidden="true" class="sb-spin" />
                <Plus v-else :size="14" aria-hidden="true" />
              </button>
            </div>
            <textarea v-model="issueBody" rows="2" placeholder="Issue 内容"></textarea>
          </form>
          <div v-if="!issuesAccessUnavailable" class="project-list project-dense-list">
            <div
              v-for="issue in issues"
              :key="issue.number"
              class="project-row project-row--issue"
              :class="{ 'is-target': isIssueRowFocused(issue.number) }"
              :data-issue-number="issue.number"
            >
              <template v-if="!isEditingIssue(issue.number)">
                <span class="project-row__status" :class="{ 'is-closed': issue.state !== 'open' }" :title="issue.state">
                  <CircleDot v-if="issue.state === 'open'" :size="14" aria-hidden="true" />
                  <CircleOff v-else :size="14" aria-hidden="true" />
                </span>
                <div class="project-row__content">
                  <strong>#{{ issue.number }} {{ issue.title }}</strong>
                  <span>{{ issue.labels.join(", ") || "无标签" }} · {{ issue.assignees.join(", ") || "未分配" }}</span>
                </div>
                <div class="project-row__actions">
                  <button
                    type="button"
                    class="ghost project-icon-action"
                    aria-label="编辑"
                    title="编辑"
                    @click="startEditIssue(issue)"
                  >
                    <Pencil :size="14" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class="ghost project-icon-action"
                    :aria-label="issue.state === 'open' ? '关闭' : '重开'"
                    :title="issue.state === 'open' ? '关闭' : '重开'"
                    @click="toggleIssue(issue)"
                  >
                    <CircleOff v-if="issue.state === 'open'" :size="14" aria-hidden="true" />
                    <RotateCcw v-else :size="14" aria-hidden="true" />
                  </button>
                </div>
              </template>
              <form
                v-else
                class="project-issue-edit-form project-compact-form"
                @submit.prevent="saveIssueEdit(issue)"
              >
                <div class="project-compact-form__line">
                  <input v-model="editingIssueTitle" class="project-compact-form__title" type="text" placeholder="Issue 标题" />
                  <input v-model="editingIssueLabels" type="text" placeholder="labels, comma separated" />
                  <input v-model="editingIssueAssignees" type="text" placeholder="assignees" />
                  <button
                    type="submit"
                    class="primary project-icon-action project-icon-action--primary"
                    :disabled="updatingIssue || !editingIssueTitle.trim()"
                    aria-label="保存"
                    title="保存"
                  >
                    <LoaderCircle v-if="updatingIssue" :size="14" aria-hidden="true" class="sb-spin" />
                    <Check v-else :size="14" aria-hidden="true" />
                  </button>
                  <button type="button" class="ghost project-icon-action" aria-label="取消" title="取消" @click="cancelEditIssue">
                    <X :size="14" aria-hidden="true" />
                  </button>
                </div>
                <textarea v-model="editingIssueBody" rows="2" placeholder="Issue 内容"></textarea>
              </form>
            </div>
            <p v-if="!issues.length && !githubLoading" class="muted repo-empty">没有匹配的 Issue。</p>
          </div>
        </section>

        <section v-else-if="activeSection === 'pulls'" class="project-section project-github-section">
          <div class="project-section__head project-section__head--compact">
            <div class="project-section__title">
              <h3>Pull Requests</h3>
              <span>{{ pulls.length }} items</span>
            </div>
            <div class="project-toolbar" aria-label="Pull Request filters">
              <ListFilter :size="14" aria-hidden="true" />
              <div class="ui-segmented project-segmented" role="group" aria-label="Pull Request 状态">
                <button
                  v-for="filter in githubStateFilters"
                  :key="filter.value"
                  type="button"
                  :class="{ 'is-active': pullState === filter.value }"
                  :aria-pressed="pullState === filter.value"
                  @click="pullState = filter.value"
                >
                  {{ filter.label }}
                </button>
              </div>
            </div>
          </div>
          <RepoGitHubUnavailableNotice
            v-if="pullsAccessUnavailable"
            :title="pullsAccessUnavailable.title"
            :reason="pullsAccessUnavailable.reason"
            :loading="githubAuthLoading"
            @rebind="rebindGitHub"
          />
          <p v-else-if="githubError" class="error-line">{{ githubError }}</p>
          <form v-if="!pullsAccessUnavailable" class="project-compact-form" @submit.prevent="createPullRequest">
            <div class="project-compact-form__line">
              <input v-model="pullRequestTitle" class="project-compact-form__title" type="text" placeholder="PR 标题" />
              <input v-model="pullRequestHead" type="text" placeholder="head 分支" />
              <input v-model="pullRequestBase" type="text" placeholder="base 分支" />
              <label class="project-check project-check--inline">
                <input v-model="pullRequestDraft" type="checkbox" />
                <span>Draft</span>
              </label>
              <button
                type="submit"
                class="primary project-icon-action project-icon-action--primary"
                :disabled="creatingPullRequest || !pullRequestTitle.trim() || !pullRequestHead.trim() || !pullRequestBase.trim()"
                aria-label="新建 PR"
                title="新建 PR"
              >
                <LoaderCircle v-if="creatingPullRequest" :size="14" aria-hidden="true" class="sb-spin" />
                <GitPullRequest v-else :size="14" aria-hidden="true" />
              </button>
            </div>
            <textarea v-model="pullRequestBody" rows="2" placeholder="PR 描述"></textarea>
          </form>
          <p v-if="!pullsAccessUnavailable && pullsLoading && !pulls.length" class="muted repo-empty">正在读取 Pull Requests。</p>
          <div v-if="!pullsAccessUnavailable" class="project-list project-dense-list">
            <div
              v-for="pull in pulls"
              :key="pull.number"
              class="project-row project-row--pull"
              :class="{ 'is-target': isPullRequestRowFocused(pull.number) }"
              :data-pull-number="pull.number"
              @click="focusPullRequestRow(pull)"
            >
              <span class="project-row__status" :class="{ 'is-closed': pull.state !== 'open' || pull.merged }" :title="pull.merged ? 'merged' : pull.state">
                <GitMerge v-if="pull.merged" :size="14" aria-hidden="true" />
                <GitPullRequest v-else-if="pull.state === 'open'" :size="14" aria-hidden="true" />
                <CircleOff v-else :size="14" aria-hidden="true" />
              </span>
              <div class="project-row__content">
                <strong>#{{ pull.number }} {{ pull.title }}</strong>
                <span>
                  {{ pull.author }} · {{ pull.headBranch }} -> {{ pull.baseBranch }} ·
                  {{ pull.merged ? "merged" : pull.state }}
                  <template v-if="pull.draft"> · draft</template>
                  <template v-if="pull.mergeableState"> · {{ pull.mergeableState }}</template>
                </span>
                <div v-if="focusedPullRequest?.number === pull.number" class="project-pull-checks">
                  <p class="muted">
                    {{
                      pullChecksLoading
                        ? "正在读取 checks..."
                        : focusedPullChecks.length
                          ? `${focusedPullChecks.length} 个 checks`
                          : "没有 checks"
                    }}
                  </p>
                  <ul v-if="focusedPullChecks.length" class="project-pull-check-list">
                    <li v-for="check in focusedPullChecks" :key="check.id">
                      <span>{{ check.name }}</span>
                      <em>{{ check.conclusion ?? check.status }}</em>
                    </li>
                  </ul>
                </div>
              </div>
              <div class="project-row__actions project-row__actions--pull">
                <div class="ui-segmented project-segmented project-segmented--merge" role="group" aria-label="合并方式">
                  <button
                    v-for="method in mergeMethodOptions"
                    :key="method.value"
                    type="button"
                    :class="{ 'is-active': pullRequestMergeMethod === method.value }"
                    :aria-pressed="pullRequestMergeMethod === method.value"
                    @click.stop="pullRequestMergeMethod = method.value"
                  >
                    {{ method.label }}
                  </button>
                </div>
                <button type="button" class="ghost project-icon-action" aria-label="打开" title="打开" @click.stop="openUrl(pull.htmlUrl)">
                  <ExternalLink :size="14" aria-hidden="true" />
                </button>
                <button
                  v-if="pull.state === 'open' && !pull.merged"
                  type="button"
                  class="ghost project-icon-action"
                  :disabled="updatingPullRequest"
                  aria-label="关闭"
                  title="关闭"
                  @click.stop="togglePullRequestState(pull)"
                >
                  <CircleOff :size="14" aria-hidden="true" />
                </button>
                <button
                  v-if="pull.state === 'open' && !pull.merged"
                  type="button"
                  class="primary project-icon-action project-icon-action--primary"
                  :disabled="updatingPullRequest"
                  aria-label="合并"
                  title="合并"
                  @click.stop="mergePullRequest(pull)"
                >
                  <GitMerge :size="14" aria-hidden="true" />
                </button>
                <button
                  v-else-if="pull.state === 'closed' && !pull.merged"
                  type="button"
                  class="ghost project-icon-action"
                  :disabled="updatingPullRequest"
                  aria-label="重开"
                  title="重开"
                  @click.stop="togglePullRequestState(pull)"
                >
                  <RotateCcw :size="14" aria-hidden="true" />
                </button>
              </div>
            </div>
            <p v-if="!pulls.length && !pullsLoading" class="muted repo-empty">没有匹配的 Pull Request。</p>
          </div>
        </section>

        <section v-else-if="activeSection === 'actions'" class="project-section project-github-section">
          <div class="project-section__head project-section__head--compact">
            <div class="project-section__title">
              <h3>Actions</h3>
              <span>{{ workflowRuns.length }} runs</span>
            </div>
          </div>
          <RepoGitHubUnavailableNotice
            v-if="actionsAccessUnavailable"
            :title="actionsAccessUnavailable.title"
            :reason="actionsAccessUnavailable.reason"
            :loading="githubAuthLoading"
            @rebind="rebindGitHub"
          />
          <p v-else-if="actionsError" class="error-line">{{ actionsError }}</p>
          <p v-else-if="actionsLoading" class="muted repo-empty">正在读取 GitHub Actions。</p>
          <div v-if="!actionsAccessUnavailable" class="project-list project-dense-list">
            <div
              v-for="run in workflowRuns"
              :key="run.id"
              class="project-row project-row--action"
              :class="{ 'is-target': isRunRowFocused(run.id) }"
              :data-run-id="run.id"
            >
              <span
                class="project-action-status"
                :class="`project-action-status--${workflowRunStatusTone(run)}`"
                :title="workflowRunStatusText(run)"
                :aria-label="workflowRunStatusText(run)"
              >
                <X v-if="isWorkflowRunFailure(run)" :size="14" aria-hidden="true" />
                <CircleDot v-else :size="14" aria-hidden="true" />
              </span>
              <div class="project-row__content">
                <strong>{{ run.displayTitle }}</strong>
                <span>{{ run.name }} · {{ run.branch }} · {{ run.event }}</span>
              </div>
              <button type="button" class="ghost project-icon-action" aria-label="打开" title="打开" @click="openUrl(run.htmlUrl)">
                <ExternalLink :size="14" aria-hidden="true" />
              </button>
            </div>
            <p v-if="!workflowRuns.length && !actionsLoading" class="muted repo-empty">没有 GitHub Actions 运行记录。</p>
          </div>
        </section>

        <form v-else-if="activeSection === 'settings'" class="project-section project-settings project-github-section" @submit.prevent="saveSettings()">
          <div class="project-section__head project-section__head--compact">
            <div class="project-section__title">
              <h3>仓库设置</h3>
              <span>{{ settings ? settings.fullName : "GitHub Settings" }}</span>
            </div>
            <div class="project-toolbar">
              <Settings2 :size="14" aria-hidden="true" />
              <button
                v-if="settings"
                type="submit"
                class="primary project-icon-action project-icon-action--primary"
                :disabled="savingSettings || deletingRepo || deletingLocalRepo || githubLoading"
                aria-label="保存"
                title="保存"
              >
                <LoaderCircle v-if="savingSettings" :size="14" aria-hidden="true" class="sb-spin" />
                <Save v-else :size="14" aria-hidden="true" />
              </button>
            </div>
          </div>
          <p v-if="githubUnavailableMessage" class="muted repo-empty project-empty">{{ githubUnavailableMessage }}</p>
          <RepoGitHubUnavailableNotice
            v-if="settingsAccessUnavailable"
            :title="settingsAccessUnavailable.title"
            :reason="settingsAccessUnavailable.reason"
            :loading="githubAuthLoading"
            @rebind="rebindGitHub"
          />
          <p v-else-if="githubError" class="error-line">{{ githubError }}</p>
          <template v-if="settings">
            <section class="project-settings-group" aria-labelledby="project-settings-general-title">
              <div class="project-settings-group__head">
                <h4 id="project-settings-general-title">基础设置</h4>
              </div>
              <div class="project-settings-fields">
                <label class="project-settings-field">
                  <span>描述</span>
                  <input v-model="settingsForm.description" type="text" />
                </label>
                <label class="project-settings-field">
                  <span>Homepage</span>
                  <input v-model="settingsForm.homepage" type="url" />
                </label>
                <label class="project-settings-field project-settings-field--topics">
                  <span>Topics</span>
                  <RepoTopicEditor v-model="settingsForm.topics" v-model:draft="settingsTopicDraft" />
                </label>
              </div>
            </section>
            <section class="project-settings-group" aria-labelledby="project-settings-features-title">
              <div class="project-settings-group__head">
                <h4 id="project-settings-features-title">功能开关</h4>
              </div>
              <div class="project-settings-switches">
                <label
                  v-for="switchItem in featureSettingSwitches"
                  :key="switchItem.key"
                  class="project-settings-switch ui-switch"
                >
                  <span class="project-settings-switch__content">
                    <strong>{{ switchItem.label }}</strong>
                    <em>{{ switchItem.hint }}</em>
                  </span>
                  <input v-model="settingsForm[switchItem.key]" class="ui-switch__input" type="checkbox" />
                  <span class="ui-switch__track" aria-hidden="true"></span>
                </label>
              </div>
            </section>
            <section class="project-settings-group" aria-labelledby="project-settings-merge-title">
              <div class="project-settings-group__head">
                <h4 id="project-settings-merge-title">Pull Request / Merge</h4>
              </div>
              <div class="project-settings-switches">
                <label
                  v-for="switchItem in mergeSettingSwitches"
                  :key="switchItem.key"
                  class="project-settings-switch ui-switch"
                >
                  <span class="project-settings-switch__content">
                    <strong>{{ switchItem.label }}</strong>
                    <em>{{ switchItem.hint }}</em>
                  </span>
                  <input v-model="settingsForm[switchItem.key]" class="ui-switch__input" type="checkbox" />
                  <span class="ui-switch__track" aria-hidden="true"></span>
                </label>
              </div>
            </section>
          </template>
          <div v-if="(!remoteOnly && repoPath) || settings" class="project-settings-danger-list">
            <section v-if="!remoteOnly && repoPath" class="project-danger-zone" aria-label="本地危险操作">
              <div>
                <strong>{{ linkedWorktree ? "删除工作树" : "删除本地仓库" }}</strong>
                <span>
                  {{
                    linkedWorktree
                      ? "从当前共享仓库移除该工作树，并从工作区仓库列表移除。"
                      : "删除工作区内的本地目录，并从本地仓库列表移除。"
                  }}
                </span>
              </div>
              <button
                type="button"
                class="ghost danger project-icon-action"
                :disabled="deletingLocalRepo"
                :aria-label="linkedWorktree ? '删除工作树' : '删除本地'"
                :title="linkedWorktree ? '删除工作树' : '删除本地'"
                @click="openDeleteDialog('local')"
              >
                <LoaderCircle v-if="deletingLocalRepo" :size="14" aria-hidden="true" class="sb-spin" />
                <Trash2 v-else :size="14" aria-hidden="true" />
              </button>
            </section>
            <section v-if="settings" class="project-danger-zone" aria-label="远端危险操作">
              <div>
                <strong>删除 GitHub 远端仓库</strong>
                <span>只删除 GitHub 上的远端仓库，不删除本地目录。</span>
              </div>
              <button
                type="button"
                class="ghost danger project-icon-action"
                :disabled="deletingRepo || githubLoading || !settings || !repoFullName"
                aria-label="删除仓库"
                title="删除仓库"
                @click="openDeleteDialog('remote')"
              >
                <LoaderCircle v-if="deletingRepo" :size="14" aria-hidden="true" class="sb-spin" />
                <Trash2 v-else :size="14" aria-hidden="true" />
              </button>
            </section>
          </div>
          <Teleport to="body">
            <Transition name="modal">
              <div
                v-if="deleteDialogTarget"
                class="project-delete-overlay"
                role="dialog"
                aria-modal="true"
                :aria-label="deleteDialogTitle"
                @click.self="closeDeleteDialog"
              >
                <div class="project-delete-dialog">
                  <div class="project-delete-dialog__head">
                    <Trash2 :size="15" aria-hidden="true" />
                    <strong>{{ deleteDialogTitle }}</strong>
                  </div>
                  <p v-if="deleteDialogTarget === 'remote'">
                    这会永久删除远端仓库 <strong>{{ repoFullName }}</strong>。本地目录会保留，但 GitHub
                    Issues、Actions 和 Settings 将不可用。
                  </p>
                  <p v-else>
                    <template v-if="linkedWorktree">
                      这会从当前共享仓库移除工作树 <strong>{{ repoPath }}</strong>，并从工作区仓库列表移除。GitHub
                      远端仓库不会被删除。
                    </template>
                    <template v-else>
                      这会删除本地目录 <strong>{{ repoPath }}</strong>，并从工作区仓库列表移除。GitHub
                      远端仓库不会被删除。
                    </template>
                  </p>
                  <p v-if="deleteError" class="error-line">{{ deleteError }}</p>
                  <label>
                    <span>{{ deleteDialogTarget === "remote" ? "输入完整仓库名以确认" : "输入仓库 ID 以确认" }}</span>
                    <input
                      v-model="deleteConfirmInput"
                      type="text"
                      :placeholder="deleteExpectedInput ?? ''"
                      :disabled="deletingAnything"
                    />
                  </label>
                  <div class="project-delete-dialog__actions">
                    <button type="button" class="ghost" :disabled="deletingAnything" @click="closeDeleteDialog">
                      取消
                    </button>
                    <button
                      type="button"
                      class="ghost danger"
                      :disabled="deletingAnything || !deleteConfirmMatches"
                      @click="confirmDeleteDialog"
                    >
                      <LoaderCircle v-if="deletingAnything" :size="14" aria-hidden="true" class="sb-spin" />
                      <Trash2 v-else :size="14" aria-hidden="true" />
                      确认删除
                    </button>
                  </div>
                </div>
              </div>
            </Transition>
          </Teleport>
        </form>
      </main>

      <CommitDetailCard
        v-if="showCommitDetail && selectedCommitHash"
        class="project-commit-detail-card"
        :repo-id="repoId"
        :repo-title="repoTitle || repoId"
        :hash="selectedCommitHash"
        embedded
        closable
        @close="emit('closeCommit')"
      />

      <aside v-if="showProjectSidebar" class="project-sidebar">
        <section v-if="repoFullName" class="project-about-card" aria-label="仓库描述">
          <button
            v-if="!aboutEditing"
            type="button"
            class="ghost project-icon-action project-about-edit"
            :disabled="githubLoading || savingSettings"
            aria-label="编辑仓库描述"
            title="编辑"
            @click="startEditAbout"
          >
            <LoaderCircle v-if="githubLoading && !settings" :size="14" aria-hidden="true" class="sb-spin" />
            <Pencil v-else :size="14" aria-hidden="true" />
          </button>
          <form v-if="aboutEditing" class="project-about-form" @submit.prevent="saveSettings(true)">
            <textarea v-model="settingsForm.description" rows="3" placeholder="Description"></textarea>
            <input v-model="settingsForm.homepage" type="url" placeholder="Homepage" />
            <RepoTopicEditor v-model="settingsForm.topics" v-model:draft="aboutTopicDraft" />
            <p v-if="githubError" class="error-line">{{ githubError }}</p>
            <div class="project-about-form__actions">
              <button type="button" class="ghost project-icon-action" :disabled="savingSettings" aria-label="取消" title="取消" @click="cancelEditAbout">
                <X :size="14" aria-hidden="true" />
              </button>
              <button type="submit" class="primary project-icon-action project-icon-action--primary" :disabled="savingSettings" aria-label="保存" title="保存">
                <LoaderCircle v-if="savingSettings" :size="14" aria-hidden="true" class="sb-spin" />
                <Save v-else :size="14" aria-hidden="true" />
              </button>
            </div>
          </form>
          <div v-else class="project-about-summary">
            <p v-if="githubLoading && !settings" class="muted">正在读取仓库描述。</p>
            <p v-else-if="githubError && !settings" class="error-line">{{ githubError }}</p>
            <template v-else>
              <p :class="{ 'is-empty': !aboutDescription }">{{ aboutDescription || "No description provided." }}</p>
              <a v-if="aboutHomepage" :href="aboutHomepageHref" target="_blank" rel="noreferrer">
                <ExternalLink :size="13" aria-hidden="true" />
                <span>{{ aboutHomepage }}</span>
              </a>
              <div v-if="aboutTopics.length" class="project-topic-list" aria-label="Topics">
                <span v-for="topic in aboutTopics" :key="topic" class="project-topic-pill">{{ topic }}</span>
              </div>
              <div v-if="aboutStats.length" class="project-about-stats" aria-label="GitHub 仓库指标">
                <div
                  v-for="stat in aboutStats"
                  :key="stat.key"
                  class="project-about-stat"
                  :aria-label="stat.text"
                  :title="stat.text"
                >
                  <component :is="stat.icon" :size="14" aria-hidden="true" />
                  <span><strong>{{ stat.count }}</strong>{{ stat.label }}</span>
                </div>
              </div>
            </template>
          </div>
        </section>

        <div class="project-sidebar__card" role="tablist" aria-label="README 列表">
          <button
            v-for="item in readmes"
            :key="item.path"
            type="button"
            class="project-sidebar__item"
            :class="{ 'is-active': isProjectSectionActive('readme', { readmePath: item.path }) }"
            role="tab"
            :aria-selected="isProjectSectionActive('readme', { readmePath: item.path })"
            @click="selectReadme(item.path)"
          >
            <strong>{{ item.path }}</strong>
            <span aria-hidden="true">{{ item.format === "text" ? "text" : item.format }}</span>
          </button>
          <p v-if="!readmes.length && !readmeLoading" class="project-sidebar__empty">未找到 README</p>
        </div>

        <div class="project-sidebar__card" role="tablist" aria-label="项目信息视图">
          <button
            v-for="tab in projectSections"
            :key="tab.key"
            type="button"
            class="project-sidebar__item"
            :class="{ 'is-active': isProjectSectionActive(tab.key) }"
            role="tab"
            :aria-selected="isProjectSectionActive(tab.key)"
            @click="activateProjectSection(tab.key)"
          >
            <strong>{{ tab.label }}</strong>
          </button>
        </div>

        <RepoLanguageStatsCard
          :repo="repoSummary ?? null"
          :remote-only="remoteOnly"
          :loading="languageStatsLoading"
        />

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
.project-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.project-section__head {
  justify-content: space-between;
}

.project-section__head--compact {
  min-height: 34px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-soft);
}

.project-section__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.project-section h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.project-section__title span,
.project-toolbar {
  color: var(--text-muted);
  font-size: 12px;
}

.project-section__title h3,
.project-section__title span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-toolbar {
  justify-content: flex-end;
  min-width: 0;
  flex-shrink: 0;
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
  overflow: auto;
}

.project-layout--with-commit-detail {
  grid-template-rows: minmax(0, 1fr) auto;
}

.project-layout--full {
  grid-template-columns: minmax(0, 1fr);
}

.project-main {
  display: grid;
  grid-column: 1;
  grid-row: 1;
  grid-template-rows: minmax(0, 1fr);
  align-content: start;
  align-self: stretch;
  min-width: 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
}

.project-commit-detail-card {
  grid-column: 1;
  grid-row: 2;
  align-self: start;
  min-width: 0;
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
  border: 0;
  border-radius: 0;
  background: transparent;
}

.project-terminal-card {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  align-self: stretch;
  min-width: 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: #0a0d12;
}

.project-terminal__body {
  display: grid;
  align-content: start;
  min-height: 0;
  height: 100%;
  overflow: auto;
  padding: 14px 16px;
  background: #0a0d12;
  color: #d6deeb;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.project-terminal__line {
  margin: 0;
}

.project-terminal__line--error {
  color: #ff8a8a;
}

.project-terminal__line--muted {
  color: #8b949e;
}

.project-terminal__output {
  max-height: none;
  margin: 0;
  border: 0;
  border-radius: 0;
  padding: 0;
  color: inherit;
  font: inherit;
}

.project-terminal__output code {
  font: inherit;
}

.launch-log {
  display: inline;
}

.launch-log--stderr {
  color: #ff8a8a;
}

.launch-log--system {
  color: #8b949e;
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
  grid-column: 2;
  grid-row: 1;
  gap: 14px;
  min-width: 0;
  min-height: 0;
  align-content: start;
  align-self: start;
}

.project-about-card {
  position: relative;
  display: grid;
  gap: 9px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
}

.project-about-edit {
  position: absolute;
  top: 6px;
  right: 6px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.project-about-card:hover .project-about-edit,
.project-about-card:focus-within .project-about-edit {
  opacity: 1;
  pointer-events: auto;
}

.project-about-summary,
.project-about-form {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.project-about-summary p {
  margin: 0;
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.42;
  overflow-wrap: anywhere;
}

.project-about-summary p.is-empty {
  color: var(--text-muted);
}

.project-about-stats {
  display: grid;
  gap: 9px;
  min-width: 0;
  padding-top: 5px;
}

.project-about-stat {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.25;
}

.project-about-stat span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-about-stat strong {
  margin-right: 3px;
  color: var(--text-muted);
  font-weight: 600;
}

.project-about-summary a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--accent);
  font-size: 12px;
  line-height: 1.3;
  text-decoration: none;
}

.project-about-summary a span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-about-form textarea {
  min-height: 72px;
  resize: vertical;
}

.project-about-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.project-topic-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-top: 1px;
}

.project-topic-pill {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-height: 20px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  padding: 0 7px;
}

.project-layout--with-commit-detail .project-sidebar {
  grid-row: 1 / span 2;
}

.project-sidebar__card {
  display: grid;
  gap: 6px;
  min-width: 0;
  max-height: min(420px, 100%);
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
}

.project-sidebar__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 7px 8px;
  border-radius: var(--radius-sm);
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

.project-github-section {
  gap: 10px;
}

.project-segmented {
  height: 30px;
  padding: 2px;
  background: var(--bg-subtle);
}

.project-segmented button {
  height: 24px;
  min-width: 42px;
  padding: 0 9px;
  font-size: 12px;
}

.project-segmented--merge button {
  min-width: 52px;
}

.project-compact-form {
  display: grid;
  gap: 8px;
  padding: 4px 0 10px;
  border-bottom: 1px solid var(--border-soft);
  background: transparent;
}

.project-compact-form__line {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(110px, 160px) minmax(110px, 160px) auto auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.project-compact-form__title {
  min-width: 0;
}

.project-compact-form textarea {
  min-height: 54px;
  resize: vertical;
}

.project-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.project-check input {
  width: auto;
}

.project-check--inline {
  justify-content: center;
  height: 32px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
}

.project-list {
  gap: 0;
}

.project-dense-list {
  overflow: visible;
  border-top: 1px solid var(--border-soft);
  background: transparent;
}

.project-row {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 7px 0;
  border-top: 1px solid var(--border-soft);
}

.project-row:first-child {
  border-top: 0;
}

.project-row:hover {
  background: var(--bg-hover);
}

.project-row__status,
.project-action-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: var(--ok);
}

.project-row__status.is-closed {
  color: var(--text-muted);
}

.project-row__content {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  min-width: 0;
}

.project-row__content strong,
.project-row__content span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-row__content strong {
  flex: 0 1 auto;
  max-width: min(58%, 100%);
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.project-row__content span {
  flex: 1 1 120px;
  color: var(--text-muted);
  font-size: 12px;
}

.project-row__actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  min-width: 0;
}

.project-row__actions--pull {
  gap: 6px;
}

.project-icon-action {
  width: 28px;
  min-width: 28px;
  height: 28px;
  padding: 0;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  flex-shrink: 0;
}

.project-icon-action:hover {
  color: var(--text);
}

.project-icon-action--primary {
  color: var(--accent);
}

.project-row--issue {
  align-items: center;
}

.project-issue-edit-form {
  width: 100%;
  display: grid;
  grid-column: 1 / -1;
  gap: 8px;
  padding: 0;
  border: 0;
  background: transparent;
}

.project-row--action {
  grid-template-columns: 22px minmax(0, 1fr) auto;
}

.project-row--pull {
  align-items: start;
}

.project-pull-checks {
  display: grid;
  flex: 0 0 100%;
  gap: 6px;
  margin-top: 8px;
}

.project-pull-check-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.project-pull-check-list li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.project-row.is-target {
  box-shadow: inset 3px 0 0 var(--accent);
  background: color-mix(in srgb, var(--accent-soft) 28%, transparent);
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

.project-settings-group {
  display: grid;
  gap: 8px;
  padding: 10px 0;
  border-top: 1px solid var(--border-soft);
}

.project-settings-group:first-of-type {
  padding-top: 0;
  border-top: 0;
}

.project-settings-group__head {
  display: flex;
  align-items: center;
  min-height: 24px;
}

.project-settings-group__head h4 {
  margin: 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.project-settings-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(180px, 260px);
  gap: 8px;
}

.project-settings-field {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.project-settings-field input {
  width: 100%;
}

.project-settings-field--topics {
  grid-column: 1 / -1;
  align-items: start;
}

.project-settings-switches {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0 16px;
  border-top: 1px solid var(--border-soft);
}

.project-settings-switch {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 30px;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 36px;
  padding: 5px 0;
  color: var(--text);
  border-bottom: 1px solid var(--border-soft);
}

.project-settings-switch__content {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.project-settings-switch strong {
  flex: 0 0 auto;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.project-settings-switch em {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 12px;
  font-style: normal;
}

.project-settings-switch em::before {
  content: "· ";
}

.project-settings-danger-list {
  display: grid;
  gap: 6px;
  padding-top: 2px;
  border-top: 1px solid var(--border-soft);
}

.project-danger-zone {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border-soft);
}

.project-danger-zone div {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.project-danger-zone strong {
  flex: 0 0 auto;
  color: var(--err);
  font-size: 13px;
}

.project-danger-zone span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 12px;
}

.project-danger-zone span::before {
  content: "· ";
}

.project-danger-zone button,
.project-delete-dialog__actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.project-delete-overlay {
  position: fixed;
  inset: 0;
  z-index: 1800;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
}

.project-delete-dialog {
  display: grid;
  gap: 12px;
  width: min(520px, 92vw);
  padding: 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
}

.project-delete-dialog__head {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--err);
}

.project-delete-dialog p {
  margin: 0;
  color: var(--text);
  font-size: 13px;
  line-height: 1.5;
}

.project-delete-dialog label {
  display: grid;
  gap: 5px;
  color: var(--text-muted);
  font-size: 12px;
}

.project-delete-dialog input {
  width: 100%;
}

.project-delete-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.16s ease;
}

.modal-enter-active .project-delete-dialog,
.modal-leave-active .project-delete-dialog {
  transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.16s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .project-delete-dialog,
.modal-leave-to .project-delete-dialog {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}

@media (max-width: 900px) {
  .project-layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  .project-main,
  .project-commit-detail-card,
  .project-sidebar {
    grid-column: auto;
    grid-row: auto;
  }

  .project-sidebar {
    order: -1;
  }

  .project-section__head--compact,
  .project-toolbar,
  .project-row__actions {
    flex-wrap: wrap;
  }

  .project-compact-form__line,
  .project-settings-fields,
  .project-row {
    grid-template-columns: 1fr;
  }

  .project-row__status,
  .project-action-status {
    display: none;
  }

  .project-danger-zone {
    grid-template-columns: 1fr;
  }
}
</style>

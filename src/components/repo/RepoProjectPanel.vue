<script setup lang="ts">
import { AnsiUp } from "ansi_up";
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  CircleDot,
  CircleOff,
  ExternalLink,
  LoaderCircle,
  Save,
  Trash2,
  X,
} from "@lucide/vue";
import CommitDetailCard from "./CommitDetailCard.vue";
import MarkdownReadme from "./MarkdownReadme.vue";
import RepoChangesPanel from "./RepoChangesPanel.vue";
import RepoHistoryPanel from "./RepoHistoryPanel.vue";
import { useWorkspace } from "../../composables/useWorkspace";
import { clearHomeGitHubOverviewSnapshot } from "../../pages/homeOverviewCache";
import {
  createGitHubIssue,
  getGitHubRepoManagement,
  listGitHubRepoReadmes,
  listRepoReadmes,
  listGitHubIssues,
  listGitHubWorkflowRuns,
  updateGitHubIssue,
  updateGitHubRepoSettings,
  deleteGitHubRepo,
  openPath,
  openUrl,
} from "../../services/workspace/client";
import type {
  CommitSummary,
  GitHubIssue,
  GitHubRepoManagement,
  GitHubUpdateRepoSettingsRequest,
  GitHubWorkflowRun,
  ProjectLaunchConfig,
  ProjectLaunchLog,
  RepoChange,
  RepoConflictFile,
  RepoConflictState,
  RepoReadme,
} from "../../services/workspace/types";
import { isWorkflowRunFailure, workflowRunStatusText, workflowRunStatusTone } from "../../utils/repoDisplay";
import { isLinkedWorktree } from "../../utils/repoWorktree";
import type { ReadmeLinkTarget } from "../../utils/readmeLinks";
import { parseRemoteRepoId, remoteRepoRoute } from "../../utils/remoteRepo";
import type { RepoRouteTab } from "../../utils/repoRoutes";

type GitTab = Exclude<RepoRouteTab, "repo" | "run">;
type ProjectTab = "readme" | "issues" | "actions" | "settings";
type ProjectContentMode = "launch" | ProjectTab | GitTab;
type ProjectSectionConfig = {
  key: Exclude<ProjectTab, "readme">;
  label: string;
};
type HistoryCommit = CommitSummary;
type DeleteTarget = "local" | "remote";
type MarkdownReadmeInstance = InstanceType<typeof MarkdownReadme>;

const props = defineProps<{
  repoId: string;
  repoTitle?: string;
  repoFullName: string | null | undefined;
  repoPath: string | null | undefined;
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
  projectRunId?: number | null;
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
const actionsLoading = ref(false);
const actionsError = ref<string | null>(null);
const savingSettings = ref(false);
const deletingRepo = ref(false);
const deletingLocalRepo = ref(false);
const creatingIssue = ref(false);
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
const updatingIssue = ref(false);
const focusedIssueNumber = ref<number | null>(null);
const focusedRunId = ref<number | null>(null);
let githubLoadRunId = 0;
let issueLoadRunId = 0;
let actionsLoadRunId = 0;
let suppressIssueStateReload = false;
let readmeLoadPromise: Promise<void> | null = null;
let settingsLoadPromise: Promise<void> | null = null;
let issuesLoadPromise: Promise<void> | null = null;
let issuesLoadState: "open" | "closed" | "all" | null = null;
let actionsLoadPromise: Promise<void> | null = null;

const settingsForm = reactive({
  description: "",
  homepage: "",
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

const githubUnavailableMessage = computed(() => {
  if (remoteDeleted.value) return "GitHub 远端仓库已删除，本地目录仍保留。";
  if (isSystemGitBlocked.value) return "系统 Git 下暂不获取 GitHub 权限内容。";
  if (!props.repoFullName) return "当前仓库没有 GitHub 远端，Issues、Actions 和 Settings 不可用。";
  return null;
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
const readmePaths = computed(() => readmes.value.map((item) => item.path));
const projectSections: readonly ProjectSectionConfig[] = [
  { key: "issues", label: "Issues" },
  { key: "actions", label: "Actions" },
  { key: "settings", label: "Settings" },
];
const canUseLaunchWorkflow = computed(() => !props.remoteOnly);
const showCommitDetail = computed(() =>
  !props.remoteOnly && activeSection.value === "history" && Boolean(props.selectedCommitHash),
);
const showProjectSidebar = computed(() =>
  activeSection.value === "readme" ||
  activeSection.value === "issues" ||
  activeSection.value === "actions" ||
  activeSection.value === "settings",
);
const terminalHtml = computed(() => renderTerminalHtml(props.launchLogs));

function isProjectSectionActive(section: ProjectContentMode, options?: { readmePath?: string }) {
  if (section === "readme") {
    return activeSection.value === "readme" && activeReadmePath.value === options?.readmePath;
  }
  return activeSection.value === section;
}
const projectTab = computed<ProjectTab>(() => normalizeProjectTab(props.projectTab) ?? "readme");
const routedProjectTab = computed(() => normalizeProjectTab(route.query.projectTab));

onMounted(() => {
  void applyProjectRouteState();
});

watch(() => props.repoId, () => {
  resetProjectSectionState();
  closeDeleteDialog();
  void applyProjectRouteState();
});

watch(() => props.repoFullName, () => {
  remoteDeleted.value = false;
  resetGitHubSectionState();
  closeDeleteDialog();
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
    void loadIssues(true);
  }
});

watch(
  [routedProjectTab, () => props.projectIssueNumber, () => props.projectRunId],
  () => {
    void applyProjectRouteState();
  },
);

watch(() => props.activeGitTab, (tab) => {
  activeSection.value = routeTabToSection(tab);
  if (tab !== "repo" || !routedProjectTab.value) {
    void ensureSectionData(activeSection.value);
  }
});

function normalizeProjectTab(value: unknown): ProjectTab | null {
  if (value === "readme" || value === "issues" || value === "actions" || value === "settings") return value;
  return null;
}

function routeTabToSection(tab: RepoRouteTab): ProjectContentMode {
  if (tab === "repo") return normalizeProjectTab(props.projectTab) ?? "readme";
  if (tab === "run") return "launch";
  return tab;
}

function hasIssue(issueNumber: number) {
  return issues.value.some((issue) => issue.number === issueNumber);
}

function hasRun(runId: number) {
  return workflowRuns.value.some((run) => run.id === runId);
}

function clearProjectTargets() {
  focusedIssueNumber.value = null;
  focusedRunId.value = null;
  cancelEditIssue();
}

function renderTerminalHtml(logs: readonly ProjectLaunchLog[]) {
  const ansiUp = new AnsiUp();
  return logs
    .map((entry) => `<span class="launch-log launch-log--${entry.stream}">${ansiUp.ansi_to_html(entry.line)}</span>`)
    .join("\n");
}

async function focusIssue(issueNumber: number | null | undefined) {
  focusedRunId.value = null;
  if (!issueNumber) {
    clearProjectTargets();
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
  if (!runId) {
    clearProjectTargets();
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

function isIssueRowFocused(issueNumber: number) {
  return focusedIssueNumber.value === issueNumber && activeSection.value === "issues";
}

function isRunRowFocused(runId: number) {
  return focusedRunId.value === runId && activeSection.value === "actions";
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
  if (targetTab === "actions") {
    await focusRun(props.projectRunId);
    return;
  }
  await ensureSectionData(targetTab);
}

function applySettingsForm(next: GitHubRepoManagement) {
  settingsForm.description = next.description ?? "";
  settingsForm.homepage = next.homepage ?? "";
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

async function loadReadme() {
  if (!props.repoId) return;
  if (readmesLoaded.value) return;
  if (readmeLoadPromise) {
    await readmeLoadPromise;
    return;
  }
  readmeLoadPromise = (async () => {
    readmeLoading.value = true;
    readmeError.value = null;
    const previousPath = activeReadmePath.value;
    try {
      const nextReadmes = props.remoteOnly && props.repoFullName
        ? await listGitHubRepoReadmes(props.repoFullName)
        : await listRepoReadmes(props.repoId);
      readmes.value = nextReadmes;
      activeReadmePath.value = nextReadmes.some((item) => item.path === previousPath)
        ? previousPath
        : nextReadmes[0]?.path ?? null;
      readmesLoaded.value = true;
    } catch (err) {
      readmeError.value = String(err);
    } finally {
      readmeLoading.value = false;
      readmeLoadPromise = null;
    }
  })();
  await readmeLoadPromise;
}

async function loadSettings() {
  const runId = ++githubLoadRunId;
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
  if (settingsLoaded.value) return;
  if (settingsLoadPromise) {
    await settingsLoadPromise;
    return;
  }
  settingsLoadPromise = (async () => {
    githubLoading.value = true;
    githubError.value = null;
    try {
      const nextSettings = await getGitHubRepoManagement(repoFullName);
      if (runId !== githubLoadRunId || repoFullName !== props.repoFullName || remoteDeleted.value) return;
      settings.value = nextSettings;
      applySettingsForm(nextSettings);
      settingsLoaded.value = true;
    } catch (err) {
      githubError.value = String(err);
    } finally {
      githubLoading.value = false;
      settingsLoadPromise = null;
    }
  })();
  await settingsLoadPromise;
}

async function loadIssues(force = false) {
  const runId = ++issueLoadRunId;
  const repoFullName = props.repoFullName;
  if (isSystemGitBlocked.value) {
    clearBlockedGitHubState();
    return;
  }
  if (!repoFullName || remoteDeleted.value) return;
  if (!force && issuesLoadedState.value === issueState.value) return;
  if (!force && issuesLoadPromise && issuesLoadState === issueState.value) {
    await issuesLoadPromise;
    return;
  }
  githubError.value = null;
  issuesLoadState = issueState.value;
  issuesLoadPromise = (async () => {
    try {
      const nextIssues = await listGitHubIssues(repoFullName, issueState.value);
      if (runId !== issueLoadRunId || repoFullName !== props.repoFullName || remoteDeleted.value) return;
      issues.value = nextIssues;
      issuesLoadedState.value = issueState.value;
      syncEditingIssue();
    } catch (err) {
      githubError.value = String(err);
    } finally {
      issuesLoadPromise = null;
      issuesLoadState = null;
    }
  })();
  await issuesLoadPromise;
}

async function loadActions(force = false) {
  const runId = ++actionsLoadRunId;
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
  if (!force && actionsLoadPromise) {
    await actionsLoadPromise;
    return;
  }
  actionsLoadPromise = (async () => {
    actionsLoading.value = true;
    actionsError.value = null;
    try {
      const nextRuns = await listGitHubWorkflowRuns(repoFullName, 20);
      if (runId !== actionsLoadRunId || repoFullName !== props.repoFullName || remoteDeleted.value) return;
      workflowRuns.value = nextRuns;
      actionsLoaded.value = true;
    } catch (err) {
      actionsError.value = String(err);
    } finally {
      actionsLoading.value = false;
      actionsLoadPromise = null;
    }
  })();
  await actionsLoadPromise;
}

async function ensureSectionData(section: ProjectContentMode) {
  if (section === "readme") {
    await loadReadme();
    return;
  }
  if (section === "issues") {
    await loadIssues();
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
  readmes.value = [];
  activeReadmePath.value = null;
  readmesLoaded.value = false;
  readmeLoading.value = false;
  readmeError.value = null;
  readmeLoadPromise = null;
  resetGitHubSectionState();
}

function resetGitHubSectionState() {
  settings.value = null;
  settingsLoaded.value = false;
  issues.value = [];
  issuesLoadedState.value = null;
  workflowRuns.value = [];
  actionsLoaded.value = false;
  githubError.value = null;
  actionsError.value = null;
  settingsLoadPromise = null;
  issuesLoadPromise = null;
  issuesLoadState = null;
  actionsLoadPromise = null;
  cancelEditIssue();
  focusedIssueNumber.value = null;
  focusedRunId.value = null;
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
  if (props.remoteOnly || !deleteConfirmMatches.value || deletingLocalRepo.value) return;
  deletingLocalRepo.value = true;
  deleteError.value = null;
  try {
    await workspace.deleteLocalRepo(props.repoId);
    deleteDialogTarget.value = null;
    deleteConfirmInput.value = "";
    workspace.refreshRepoStatusList();
    await router.push("/");
  } catch (err) {
    deleteError.value = String(err);
  } finally {
    deletingLocalRepo.value = false;
  }
}

async function confirmDeleteRepo() {
  if (!props.repoFullName || !deleteConfirmMatches.value || deletingRepo.value) return;
  deletingRepo.value = true;
  deleteError.value = null;
  githubError.value = null;
  try {
    await deleteGitHubRepo(props.repoFullName);
    await workspace.forgetRemoteRepo(props.repoFullName);
    clearHomeGitHubOverviewSnapshot();
    workspace.refreshRepoStatusList();
    remoteDeleted.value = true;
    settings.value = null;
    issues.value = [];
    workflowRuns.value = [];
    deleteDialogTarget.value = null;
    deleteConfirmInput.value = "";
    const targetRoute = remoteRepoRoute(props.repoFullName);
    const currentRemoteFullName = parseRemoteRepoId(String(route.params.repoId ?? ""));
    if (
      props.remoteOnly &&
      currentRemoteFullName && props.repoFullName.toLowerCase() === currentRemoteFullName.toLowerCase()
      && route.fullPath.startsWith(targetRoute)
    ) {
      await router.push("/");
    }
  } catch (err) {
    deleteError.value = String(err);
  } finally {
    deletingRepo.value = false;
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
  if (!props.repoFullName || updatingIssue.value) return;
  const nextTitle = editingIssueTitle.value.trim();
  if (!nextTitle) return;
  updatingIssue.value = true;
  githubError.value = null;
  try {
    const updated = await updateGitHubIssue(props.repoFullName, issue.number, {
      title: nextTitle,
      body: editingIssueBody.value,
      labels: splitList(editingIssueLabels.value),
      assignees: splitList(editingIssueAssignees.value),
    });
    issues.value = issues.value.map((item) => item.number === updated.number ? updated : item);
    cancelEditIssue();
  } catch (err) {
    githubError.value = String(err);
  } finally {
    updatingIssue.value = false;
  }
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
          v-else-if="!remoteOnly && activeSection === 'history'"
          :commits="statusCommits"
          :commit-meta-title="commitMetaTitle"
          :selected-commit-hash="selectedCommitHash"
          @open-commit="emit('openCommit', $event)"
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

        <section v-else-if="activeSection === 'issues'" class="project-section">
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
            <div
              v-for="issue in issues"
              :key="issue.number"
              class="project-row project-row--issue"
              :class="{ 'is-target': isIssueRowFocused(issue.number) }"
              :data-issue-number="issue.number"
            >
              <template v-if="!isEditingIssue(issue.number)">
                <div>
                  <strong>#{{ issue.number }} {{ issue.title }}</strong>
                  <span>{{ issue.labels.join(", ") || "无标签" }} · {{ issue.assignees.join(", ") || "未分配" }}</span>
                </div>
                <div class="project-inline-form">
                  <button type="button" class="ghost" @click="startEditIssue(issue)">
                    编辑
                  </button>
                  <button type="button" class="ghost" @click="toggleIssue(issue)">
                    <CircleOff v-if="issue.state === 'open'" :size="14" aria-hidden="true" />
                    <CircleDot v-else :size="14" aria-hidden="true" />
                    {{ issue.state === "open" ? "关闭" : "重开" }}
                  </button>
                </div>
              </template>
              <form
                v-else
                class="project-issue-edit-form"
                @submit.prevent="saveIssueEdit(issue)"
              >
                <input v-model="editingIssueTitle" type="text" placeholder="Issue 标题" />
                <textarea v-model="editingIssueBody" rows="3" placeholder="Issue 内容"></textarea>
                <div class="project-inline-form">
                  <input v-model="editingIssueLabels" type="text" placeholder="labels, comma separated" />
                  <input v-model="editingIssueAssignees" type="text" placeholder="assignees" />
                  <button type="submit" class="primary" :disabled="updatingIssue || !editingIssueTitle.trim()">保存</button>
                  <button type="button" class="ghost" @click="cancelEditIssue">取消</button>
                </div>
              </form>
            </div>
            <p v-if="!issues.length && !githubLoading" class="muted repo-empty">没有匹配的 Issue。</p>
          </div>
        </section>

        <section v-else-if="activeSection === 'actions'" class="project-section">
          <div class="project-section__head">
            <h3>Actions</h3>
            <span class="muted">{{ workflowRuns.length }} 条运行记录</span>
          </div>
          <p v-if="actionsError" class="error-line">{{ actionsError }}</p>
          <p v-else-if="actionsLoading" class="muted repo-empty">正在读取 GitHub Actions。</p>
          <div class="project-list">
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

        <form v-else-if="activeSection === 'settings'" class="project-section project-settings" @submit.prevent="saveSettings">
          <div class="project-section__head">
            <h3>仓库设置</h3>
            <button
              v-if="settings"
              type="submit"
              class="primary"
              :disabled="savingSettings || deletingRepo || deletingLocalRepo || githubLoading"
            >
              <LoaderCircle v-if="savingSettings" :size="14" aria-hidden="true" class="sb-spin" />
              <Save v-else :size="14" aria-hidden="true" />
              保存
            </button>
          </div>
          <p v-if="githubUnavailableMessage" class="muted repo-empty project-empty">{{ githubUnavailableMessage }}</p>
          <p v-if="githubError" class="error-line">{{ githubError }}</p>
          <template v-if="settings">
            <section class="project-settings-group" aria-labelledby="project-settings-general-title">
              <div class="project-settings-group__head">
                <h4 id="project-settings-general-title">基础设置</h4>
                <p>编辑仓库的公开描述和项目主页。</p>
              </div>
              <label class="project-settings-field">
                <span>描述</span>
                <input v-model="settingsForm.description" type="text" />
              </label>
              <label class="project-settings-field">
                <span>Homepage</span>
                <input v-model="settingsForm.homepage" type="url" />
              </label>
            </section>
            <section class="project-settings-group" aria-labelledby="project-settings-features-title">
              <div class="project-settings-group__head">
                <h4 id="project-settings-features-title">功能开关</h4>
                <p>控制仓库可见性和协作功能。</p>
              </div>
              <div class="project-settings-switches">
                <label
                  v-for="switchItem in featureSettingSwitches"
                  :key="switchItem.key"
                  class="project-settings-switch"
                >
                  <input v-model="settingsForm[switchItem.key]" type="checkbox" />
                  <span>
                    <strong>{{ switchItem.label }}</strong>
                    <em>{{ switchItem.hint }}</em>
                  </span>
                </label>
              </div>
            </section>
            <section class="project-settings-group" aria-labelledby="project-settings-merge-title">
              <div class="project-settings-group__head">
                <h4 id="project-settings-merge-title">Pull Request / Merge</h4>
                <p>配置 Pull Request 合并方式。</p>
              </div>
              <div class="project-settings-switches">
                <label
                  v-for="switchItem in mergeSettingSwitches"
                  :key="switchItem.key"
                  class="project-settings-switch"
                >
                  <input v-model="settingsForm[switchItem.key]" type="checkbox" />
                  <span>
                    <strong>{{ switchItem.label }}</strong>
                    <em>{{ switchItem.hint }}</em>
                  </span>
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
              class="ghost danger"
              :disabled="deletingLocalRepo"
              @click="openDeleteDialog('local')"
            >
              <LoaderCircle v-if="deletingLocalRepo" :size="14" aria-hidden="true" class="sb-spin" />
              <Trash2 v-else :size="14" aria-hidden="true" />
              {{ linkedWorktree ? "删除工作树" : "删除本地" }}
            </button>
          </section>
          <section v-if="settings" class="project-danger-zone" aria-label="远端危险操作">
            <div>
              <strong>删除 GitHub 远端仓库</strong>
              <span>只删除 GitHub 上的远端仓库，不删除本地目录。</span>
            </div>
            <button
              type="button"
              class="ghost danger"
              :disabled="deletingRepo || githubLoading || !settings || !repoFullName"
              @click="openDeleteDialog('remote')"
            >
              <LoaderCircle v-if="deletingRepo" :size="14" aria-hidden="true" class="sb-spin" />
              <Trash2 v-else :size="14" aria-hidden="true" />
              删除仓库
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
.project-inline-form {
  display: flex;
  align-items: center;
  gap: 8px;
}

.project-section__head,
.project-row {
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

.project-issue-edit-form {
  width: 100%;
  display: grid;
  gap: 10px;
}

.project-row--action {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
}

.project-row.is-target {
  border-left: 3px solid var(--accent);
  background: color-mix(in srgb, var(--accent-soft) 38%, transparent);
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

.project-settings-group {
  display: grid;
  gap: 10px;
  padding: 12px 0;
  border-top: 1px solid var(--border-soft);
}

.project-settings-group:first-of-type {
  padding-top: 0;
  border-top: 0;
}

.project-settings-group__head {
  display: grid;
  gap: 2px;
}

.project-settings-group__head h4 {
  margin: 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.project-settings-group__head p {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.project-settings-field {
  display: grid;
  gap: 5px;
  color: var(--text-muted);
  font-size: 12px;
}

.project-settings-field input {
  width: 100%;
}

.project-settings-switches {
  display: grid;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
  overflow: hidden;
}

.project-settings-switch {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  min-width: 0;
  padding: 10px 12px;
  color: var(--text);
  border-bottom: 1px solid var(--border-soft);
}

.project-settings-switch:last-child {
  border-bottom: 0;
}

.project-settings-switch input {
  width: 14px;
  height: 14px;
  margin: 2px 0 0;
  padding: 0;
}

.project-settings-switch span {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.project-settings-switch strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.project-settings-switch em {
  color: var(--text-muted);
  font-size: 12px;
  font-style: normal;
  overflow-wrap: anywhere;
}

.project-settings-danger-list {
  display: grid;
  gap: 10px;
  padding-top: 4px;
  border-top: 1px solid var(--border-soft);
}

.project-danger-zone {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--err-soft);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--err-soft) 52%, var(--bg-subtle));
}

.project-danger-zone div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.project-danger-zone strong {
  color: var(--err);
  font-size: 13px;
}

.project-danger-zone span {
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
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

  .project-danger-zone {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>

<script setup lang="ts">
import { AnsiUp } from "ansi_up";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRef, watch, type Component } from "vue";
import { useRoute, useRouter, type LocationQueryRaw } from "vue-router";
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  CircleDot,
  FolderTree,
  ExternalLink,
  GitFork,
  GitPullRequest,
  LayoutDashboard,
  LoaderCircle,
  Monitor,
  Package,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Save,
  Scale,
  Settings2,
  Star,
  Trash2,
  X,
} from "@lucide/vue";
import CommitDetailCard from "./CommitDetailCard.vue";
import Dropdown from "../Dropdown.vue";
import MarkdownReadme from "./MarkdownReadme.vue";
import RepoChangesPanel from "./RepoChangesPanel.vue";
import RepoFilePreviewPane from "./RepoFilePreviewPane.vue";
import RepoFileTreeCard from "./RepoFileTreeCard.vue";
import RepoGitHubDetailSidebar from "./RepoGitHubDetailSidebar.vue";
import RepoGitHubUnavailableNotice from "./RepoGitHubUnavailableNotice.vue";
import RepoHistoryPanel from "./RepoHistoryPanel.vue";
import RepoIssuesPanel from "./RepoIssuesPanel.vue";
import RepoTopicEditor from "./RepoTopicEditor.vue";
import { useRepoFileBrowser } from "./useRepoFileBrowser";
import {
  ALL_PROJECTS_ID,
  useRepoProjectsBoard,
  type RepoProjectsBoardProjectFilter,
  type RepoProjectsBoardStateFilter,
  type RepoProjectsBoardTypeFilter,
} from "./useRepoProjectsBoard";
import {
  blankPullRequestPanelFilters,
  type PullRequestPanelFilters,
  type PullRequestState,
} from "./pullRequestPanelTypes";
import { useComponentEpoch } from "../../composables/useComponentEpoch";
import { invalidateSessionContextSnapshot } from "../../composables/sessionContext";
import { createLatestAsyncLoader } from "../../composables/useLatestAsyncLoader";
import { createPendingTaskTracker } from "../../composables/usePendingTaskTracker";
import { useWorkspace } from "../../composables/useWorkspace";
import { clearHomeGitHubOverviewSnapshot } from "../../pages/homeOverviewCache";
import {
  createGitHubIssue,
  createGitHubPullRequest,
  createGitHubRelease,
  deleteGitHubRelease,
  deleteGitHubReleaseAsset,
  attachGitHubWorkflowArtifactAsset,
  getGitHubIssueDiscussion,
  getRepoFilePreview,
  getGitHubIssueFilterMetadata,
  getGitHubPullRequestDiscussion,
  getGitHubRepoManagement,
  listRepoFiles,
  listGitHubIssues,
  listGitHubReleases,
  listGitHubPullRequestChecks,
  listGitHubPullRequests,
  listGitHubWorkflowRuns,
  listGitHubIssueAssignees,
  listGitHubIssueLabels,
  mergeGitHubPullRequest,
  pickFiles,
  updateGitHubIssue,
  updateGitHubPullRequest,
  updateGitHubRelease,
  updateGitHubRepoSettings,
  uploadGitHubReleaseAsset,
  deleteGitHubRepo,
  openUrl,
  isGitHubBindingExpiredError,
} from "../../services/workspace/client";
import type {
  CommitSummary,
  GitHubAttachWorkflowArtifactAssetRequest,
  GitHubDiscussionTimelineItem,
  GitHubIssue,
  GitHubIssueDiscussion,
  GitHubIssueFilterMetadata,
  GitHubIssueListOptions,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubPullRequestDiscussion,
  GitHubPullRequestListOptions,
  GitHubCreateReleaseRequest,
  GitHubRelease,
  GitHubReleaseAsset,
  GitHubRepoManagement,
  GitHubUpdateReleaseRequest,
  GitHubUpdateRepoSettingsRequest,
  GitHubWorkflowRun,
  ProjectLaunchConfig,
  ProjectLaunchLog,
  RepoChange,
  RepoFilePreview,
  RepoSummary,
} from "../../services/workspace/types";
import {
  hasRepoTag,
  type RepoCapability,
  type RepoContext,
} from "../../utils/repoContext";
import type { ReadmeLinkTarget } from "../../utils/readmeLinks";
import { parseRemoteRepoId, remoteRepoRoute } from "../../utils/remoteRepo";
import { recoveryGuidanceForMessage, type RecoveryGuidance } from "../../utils/recoveryGuidance";
import { repoRoute, type RepoProjectTab, type RepoRouteTab } from "../../utils/repoRoutes";
import { createCachedAsyncComponent } from "../../utils/asyncComponent";
import {
  blankIssueTemplate,
  blankPullRequestTemplate,
  buildIssueTemplateBody,
  createIssueTemplateAnswers,
  issueTemplateRequiredFieldsSatisfied,
  loadGitHubIssueTemplates,
  loadGitHubPullRequestTemplates,
} from "../../utils/githubTemplates";
import type {
  GitHubIssueTemplate,
  GitHubIssueTemplateAnswers,
  GitHubIssueTemplateField,
  GitHubPullRequestTemplate,
} from "../../utils/githubTemplates";

type GitTab = Exclude<RepoRouteTab, "repo" | "run">;
type ProjectTab = RepoProjectTab;
type ProjectContentMode = "launch" | ProjectTab | GitTab;
type IssueState = "open" | "closed" | "all";
type ProjectSectionConfig = {
  key: Exclude<ProjectTab, "readme">;
  label: string;
  icon: Component;
};
type ProjectSidebarMode = "repo" | "files" | Exclude<ProjectTab, "readme">;
type ProjectSidebarButtonMode = "repo" | Exclude<ProjectTab, "readme">;
type ProjectSidebarButtonConfig = {
  key: ProjectSidebarButtonMode;
  label: string;
  icon: Component;
  disabled?: boolean;
};
type PendingTaskTracker = ReturnType<typeof createPendingTaskTracker>;
type GitHubMutationResult<T> = { ok: true; value: T } | { ok: false };
type GitHubAccessSection = "Issues" | "Pull Requests" | "Projects" | "Actions" | "Release" | "Settings";
type ReleaseTypeFilter = "all" | "stable" | "latest" | "prerelease" | "draft";
type GitHubAccessUnavailable = {
  title: string;
  reason: string;
};
type ProjectSidebarError = {
  key: string;
  title: string;
  message: string;
  retry?: "sync";
  retrying?: boolean;
  guidance: RecoveryGuidance;
};
type IssuePanelFilters = {
  creator: string | null;
  assignee: string | null;
  labels: string[];
  milestone: string | number | null;
  project: string | null;
  sort: "created" | "updated" | "comments";
  direction: "asc" | "desc";
  query: string;
};
type HistoryCommit = CommitSummary;
type DeleteTarget = "local" | "remote";
type MarkdownReadmeInstance = InstanceType<typeof MarkdownReadme>;
type SharedPanelFilters = Pick<
  IssuePanelFilters,
  "creator" | "assignee" | "labels" | "milestone" | "project" | "sort" | "direction" | "query"
>;
type RouteFilterKeys = {
  state: string;
  query: string;
  creator: string;
  assignee: string;
  labels: string;
  milestone: string;
  project: string;
  sort: string;
  direction: string;
  review?: string;
};

const emptyIssueFilterMetadata = (): GitHubIssueFilterMetadata => ({
  authors: [],
  labels: [],
  assignees: [],
  milestones: [],
  projects: [],
});

const issueStates = ["open", "closed", "all"] as const;
const pullRequestStates = ["open", "closed", "merged"] as const;
const listSorts = ["created", "updated", "comments"] as const;
const listDirections = ["asc", "desc"] as const;
const pullRequestReviews = ["none", "required", "approved", "changes_requested"] as const;
const releaseTypeFilters: readonly { value: ReleaseTypeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "stable", label: "Stable" },
  { value: "latest", label: "Latest" },
  { value: "prerelease", label: "Pre-release" },
  { value: "draft", label: "Draft" },
];
const issueRouteKeys: RouteFilterKeys = {
  state: "issueState",
  query: "issueQ",
  creator: "issueCreator",
  assignee: "issueAssignee",
  labels: "issueLabels",
  milestone: "issueMilestone",
  project: "issueProject",
  sort: "issueSort",
  direction: "issueDirection",
};
const pullRequestRouteKeys: RouteFilterKeys = {
  state: "pullState",
  query: "pullQ",
  creator: "pullCreator",
  assignee: "pullAssignee",
  labels: "pullLabels",
  milestone: "pullMilestone",
  project: "pullProject",
  sort: "pullSort",
  direction: "pullDirection",
  review: "pullReview",
};

const blankIssuePanelFilters = (): IssuePanelFilters => ({
  creator: null,
  assignee: null,
  labels: [],
  milestone: null,
  project: null,
  sort: "created",
  direction: "desc",
  query: "",
});

const ABOUT_TOPIC_COLLAPSED_LINE_LIMIT = 2;
const README_PATH = "README.md";
const repoLanguageStatsCardModule = createCachedAsyncComponent(() => import("./RepoLanguageStatsCard.vue"));
const repoActionsPanelModule = createCachedAsyncComponent(() => import("./RepoActionsPanel.vue"));
const repoProjectsBoardModule = createCachedAsyncComponent(() => import("./RepoProjectsBoard.vue"));
const repoProjectsBoardSidebarModule = createCachedAsyncComponent(() => import("./RepoProjectsBoardSidebar.vue"));
const repoPullRequestsPanelModule = createCachedAsyncComponent(() => import("./RepoPullRequestsPanel.vue"));
const repoReleasesPanelModule = createCachedAsyncComponent(() => import("./RepoReleasesPanel.vue"));
const RepoLanguageStatsCard = repoLanguageStatsCardModule.component;
const RepoActionsPanel = repoActionsPanelModule.component;
const RepoProjectsBoard = repoProjectsBoardModule.component;
const RepoProjectsBoardSidebar = repoProjectsBoardSidebarModule.component;
const RepoPullRequestsPanel = repoPullRequestsPanelModule.component;
const RepoReleasesPanel = repoReleasesPanelModule.component;

const props = defineProps<{
  repoId: string;
  repoTitle?: string;
  repoFullName: string | null | undefined;
  repoPath: string | null | undefined;
  repoSummary?: RepoSummary | null;
  repoContext: RepoContext;
  launchConfig: ProjectLaunchConfig | null;
  launchLogs: readonly ProjectLaunchLog[];
  launchError?: string | null;
  actionError?: string | null;
  repoActionError?: string | null;
  recentSyncError?: { message: string; retrying: boolean } | null;
  launchTerminalVisible: boolean;
  actionRunning: boolean;
  launchRunning: boolean;
  activeGitTab: RepoRouteTab;
  changes: readonly RepoChange[];
  discardingChangePaths: readonly string[];
  previewChange: RepoChange | null;
  commitMessage: string;
  hasConflicts: boolean;
  canCommit: boolean;
  statusCommits: readonly CommitSummary[];
  selectedCommitHash?: string | null;
  canLoadFiles?: boolean;
  fileRepoRef?: string | null;
  filesUnavailableMessage?: string | null;
  fileTargetPath?: string | null;
  fileTargetHash?: string | null;
  commitMetaTitle: (commit: CommitSummary) => string;
  projectTab?: ProjectTab;
  projectIssueNumber?: number | null;
  projectPullRequestNumber?: number | null;
  projectRunId?: number | null;
  projectJobId?: number | null;
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
  retrySync: [];
}>();
const workspace = useWorkspace();
const route = useRoute();
const router = useRouter();
const resolvedRepoContext = computed(() => props.repoContext);
const linkedWorktree = computed(() => hasRepoTag(resolvedRepoContext.value, "linked-worktree"));

const activeSection = ref<ProjectContentMode>(routeTabToSection(props.activeGitTab));
const canBrowseFiles = computed(() => props.canLoadFiles ?? resolvedRepoContext.value.capabilities.files.available);
const fileUnavailableMessage = computed(() =>
  props.filesUnavailableMessage ?? resolvedRepoContext.value.capabilities.files.reason ?? "文件树暂不可用。"
);
const fileBrowserEnabled = computed(() => activeSection.value === "files" && canBrowseFiles.value);
const fileBrowser = useRepoFileBrowser({
  repoId: toRef(props, "repoId"),
  repoPath: toRef(props, "repoPath"),
  repoRef: toRef(props, "fileRepoRef"),
  changes: toRef(props, "changes"),
  targetPath: toRef(props, "fileTargetPath"),
  targetHash: toRef(props, "fileTargetHash"),
  enabled: fileBrowserEnabled,
});
const markdownReadme = ref<MarkdownReadmeInstance | null>(null);
const terminalBody = ref<HTMLElement | null>(null);
const projectMainRef = ref<HTMLElement | null>(null);
const readmePreview = ref<RepoFilePreview | null>(null);
const readmeLoaded = ref(false);
const readmeLoading = ref(false);
const readmeError = ref<string | null>(null);
const githubLoading = ref(false);
const githubError = ref<string | null>(null);
const pulls = ref<GitHubPullRequest[]>([]);
const pullRequestDiscussion = ref<GitHubPullRequestDiscussion | null>(null);
const pullRequestDiscussionLoading = ref(false);
const pullRequestDiscussionError = ref<string | null>(null);
const pullChecks = ref<Record<number, GitHubPullRequestCheck[]>>({});
const pullsLoading = ref(false);
const pullChecksLoading = ref(false);
const pullsLoadedKey = ref<string | null>(null);
const focusedPullRequestNumber = ref<number | null>(null);
const pullRequestTitle = ref("");
const pullRequestBody = ref("");
const pullRequestBase = ref("");
const pullRequestHead = ref("");
const pullRequestDraft = ref(false);
const pullCreateView = ref(false);
const pullRequestTemplates = ref<GitHubPullRequestTemplate[]>([]);
const pullRequestTemplateKey = ref(blankPullRequestTemplate().key);
const pullRequestTemplatesLoading = ref(false);
const pullRequestTemplatesLoadedRepo = ref<string | null>(null);
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
const boardIssues = ref<GitHubIssue[]>([]);
const boardPulls = ref<GitHubPullRequest[]>([]);
const boardLoadedRepo = ref<string | null>(null);
const boardLoading = ref(false);
const boardTypeFilter = ref<RepoProjectsBoardTypeFilter>("all");
const boardStateFilter = ref<RepoProjectsBoardStateFilter>("open");
const boardProjectFilter = ref<RepoProjectsBoardProjectFilter>(ALL_PROJECTS_ID);
const boardQuery = ref("");
const issueDiscussion = ref<GitHubIssueDiscussion | null>(null);
const issueDiscussionLoading = ref(false);
const issueDiscussionError = ref<string | null>(null);
const issuesLoadedKey = ref<string | null>(null);
const workflowRuns = ref<GitHubWorkflowRun[]>([]);
const actionsLoaded = ref(false);
const releases = ref<GitHubRelease[]>([]);
const releasesLoading = ref(false);
const releasesLoaded = ref(false);
const releasesError = ref<string | null>(null);
const focusedReleaseTag = ref<string | null>(null);
const releaseTypeFilter = ref<ReleaseTypeFilter>("all");
const aboutEditing = ref(false);
const aboutTopicDraft = ref("");
const aboutTopicList = ref<HTMLElement | null>(null);
const aboutTopicMeasureList = ref<HTMLElement | null>(null);
const repoReleasesPanel = ref<{ openCreate: () => void } | null>(null);
const aboutTopicsExpanded = ref(false);
const collapsedAboutTopicCount = ref(0);
const issueState = ref<IssueState>(issueStateFromRoute());
const issueTitle = ref("");
const issueBody = ref("");
const issueLabels = ref<string[]>([]);
const issueAssignees = ref<string[]>([]);
const issueCreateView = ref(false);
const issueTemplates = ref<GitHubIssueTemplate[]>([]);
const issueTemplateKey = ref(blankIssueTemplate().key);
const issueTemplateAnswers = ref<GitHubIssueTemplateAnswers>({});
const issueTemplatesLoading = ref(false);
const issueTemplatesLoadedRepo = ref<string | null>(null);
const remoteIssueLabels = ref<string[]>([]);
const remoteIssueAssignees = ref<string[]>([]);
const issueMetadataLoading = ref(false);
const issueMetadataLoadedRepo = ref<string | null>(null);
const issueFilterMetadata = ref<GitHubIssueFilterMetadata>(emptyIssueFilterMetadata());
const issueFilterMetadataLoading = ref(false);
const issueFilterMetadataLoadedRepo = ref<string | null>(null);
const boardMetadataProjects = computed(() => issueFilterMetadata.value.projects);
const {
  baseFilteredItems: boardBaseFilteredItems,
  issueCount: boardIssueCount,
  projectCountTotal: boardProjectCountTotal,
  projectFilterOptions: boardProjectFilterOptions,
  pullCount: boardPullCount,
  visibleItems: boardVisibleItems,
} = useRepoProjectsBoard({
  issues: boardIssues,
  pulls: boardPulls,
  projects: boardMetadataProjects,
  typeFilter: boardTypeFilter,
  stateFilter: boardStateFilter,
  projectFilter: boardProjectFilter,
  query: boardQuery,
});
const boardLoadingText = computed(() => boardLoading.value || issueFilterMetadataLoading.value ? "读取中" : "已同步");
const boardEmptyText = computed(() => boardLoading.value ? "正在读取项目事项。" : "没有匹配的项目事项。");
const issuePanelFilters = ref<IssuePanelFilters>(issuePanelFiltersFromRoute());
const pullRequestPanelFilters = ref<PullRequestPanelFilters>(pullRequestPanelFiltersFromRoute());
const pullState = ref<PullRequestState>(pullRequestStateFromRoute());
const editingIssueNumber = ref<number | null>(null);
const editingIssueTitle = ref("");
const editingIssueBody = ref("");
const editingIssueLabels = ref("");
const editingIssueAssignees = ref("");
const focusedIssueNumber = ref<number | null>(null);
const focusedRunId = ref<number | null>(null);
const focusedJobId = ref<number | null>(null);
let suppressIssueStateReload = false;
let suppressPullStateReload = false;
const componentEpoch = useComponentEpoch();
const readmeLoader = createLatestAsyncLoader({ componentEpoch });
const settingsLoader = createLatestAsyncLoader({ componentEpoch });
const issuesLoader = createLatestAsyncLoader({ componentEpoch });
const boardLoader = createLatestAsyncLoader({ componentEpoch });
const issueDiscussionLoader = createLatestAsyncLoader({ componentEpoch });
const pullsLoader = createLatestAsyncLoader({ componentEpoch });
const pullRequestDiscussionLoader = createLatestAsyncLoader({ componentEpoch });
const pullChecksLoader = createLatestAsyncLoader({ componentEpoch });
const actionsLoader = createLatestAsyncLoader({ componentEpoch });
const releasesLoader = createLatestAsyncLoader({ componentEpoch });
const settingsSaveTracker = createPendingTaskTracker();
const issueCreateTracker = createPendingTaskTracker();
const issueUpdateTracker = createPendingTaskTracker();
const pullCreateTracker = createPendingTaskTracker();
const pullUpdateTracker = createPendingTaskTracker();
const releaseCreateTracker = createPendingTaskTracker();
const releaseUpdateTracker = createPendingTaskTracker();
const releaseDeleteTracker = createPendingTaskTracker();
const releaseAssetUploadTracker = createPendingTaskTracker();
const releaseAssetDeleteTracker = createPendingTaskTracker();
const remoteDeleteTracker = createPendingTaskTracker();
const localDeleteTracker = createPendingTaskTracker();
const savingSettings = settingsSaveTracker.running;
const creatingIssue = issueCreateTracker.running;
const updatingIssue = issueUpdateTracker.running;
const creatingPullRequest = pullCreateTracker.running;
const updatingPullRequest = pullUpdateTracker.running;
const releaseMutating = computed(() =>
  releaseCreateTracker.running.value ||
  releaseUpdateTracker.running.value ||
  releaseDeleteTracker.running.value ||
  releaseAssetUploadTracker.running.value ||
  releaseAssetDeleteTracker.running.value
);
const draftReleases = computed(() => releases.value.filter((release) => release.draft));
const releaseFilterTags = computed(() =>
  [...releases.value]
    .sort((left, right) => releaseTimestamp(right) - releaseTimestamp(left))
    .map((release) => ({
      id: release.id,
      tagName: release.tagName,
      type: releaseTypeForFilter(release),
    }))
);
const activeReleaseFilterCount = computed(() =>
  (focusedReleaseTag.value ? 1 : 0) + (releaseTypeFilter.value !== "all" ? 1 : 0)
);
const deletingRepo = remoteDeleteTracker.running;
const deletingLocalRepo = localDeleteTracker.running;
let repoMutationGeneration = 0;
let githubMutationGeneration = 0;
let aboutTopicResizeObserver: ResizeObserver | null = null;

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

const githubAuthLoading = computed(() => workspace.state.authLoading);

const githubUnavailableMessage = computed(() => {
  if (remoteDeleted.value) return "GitHub 远端仓库已删除，本地目录仍保留。";
  if (!resolvedRepoContext.value.capabilities.issues.available) {
    return resolvedRepoContext.value.capabilities.issues.reason ?? "GitHub 功能暂不可用。";
  }
  return null;
});
const issuesAccessUnavailable = computed(() =>
  githubAccessUnavailable("Issues", githubError.value, resolvedRepoContext.value.capabilities.issues)
);
const pullsAccessUnavailable = computed(() =>
  githubAccessUnavailable("Pull Requests", githubError.value, resolvedRepoContext.value.capabilities.pulls)
);
const projectsAccessUnavailable = computed(() =>
  githubAccessUnavailable("Projects", githubError.value, resolvedRepoContext.value.capabilities.issues)
);
const actionsAccessUnavailable = computed(() =>
  githubAccessUnavailable("Actions", actionsError.value, resolvedRepoContext.value.capabilities.actions)
);
const releasesAccessUnavailable = computed(() =>
  githubAccessUnavailable("Release", releasesError.value, resolvedRepoContext.value.capabilities.issues)
);
const settingsAccessUnavailable = computed(() =>
  githubAccessUnavailable("Settings", githubError.value, resolvedRepoContext.value.capabilities.settings)
);
const aboutDescription = computed(() => settings.value?.description?.trim() ?? "");
const aboutHomepage = computed(() => settings.value?.homepage?.trim() ?? "");
const aboutHomepageHref = computed(() => normalizedExternalUrl(aboutHomepage.value));
const aboutTopics = computed(() => settings.value?.topics ?? []);
const aboutTopicsOverflowing = computed(() =>
  collapsedAboutTopicCount.value > 0 && collapsedAboutTopicCount.value < aboutTopics.value.length
);
const displayedAboutTopics = computed(() => {
  if (!aboutTopicsOverflowing.value || aboutTopicsExpanded.value) return aboutTopics.value;
  return aboutTopics.value.slice(0, collapsedAboutTopicCount.value || aboutTopics.value.length);
});
const aboutLicenseText = computed(() => {
  const license = settings.value?.license;
  if (!license) return "";
  const spdxId = license.spdxId?.trim();
  if (spdxId && spdxId !== "NOASSERTION") return `${spdxId} license`;
  return license.name.trim();
});
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
const languageStatsLoading = computed(() => workspace.state.languageStatsLoadingRepoIds.includes(props.repoId));
const currentBranchName = computed(() => workspace.repoById(props.repoId)?.currentBranch ?? "");
const projectSections: readonly ProjectSectionConfig[] = [
  { key: "board", label: "Board", icon: LayoutDashboard },
  { key: "issues", label: "Issues", icon: CircleDot },
  { key: "pulls", label: "Pull Requests", icon: GitPullRequest },
  { key: "actions", label: "Actions", icon: Play },
  { key: "release", label: "Release", icon: Package },
  { key: "settings", label: "Settings", icon: Settings2 },
];
const projectSidebarButtons = computed<ProjectSidebarButtonConfig[]>(() => [
  { key: "repo", label: "Repo", icon: Monitor },
  ...projectSections.map((section) => ({
    key: section.key,
    label: section.label,
    icon: section.icon,
  })),
]);
const canUseLaunchWorkflow = computed(() => resolvedRepoContext.value.capabilities.launch.available);
const canShowChanges = computed(() => resolvedRepoContext.value.capabilities.changes.available);
const historyReadOnly = computed(() => !resolvedRepoContext.value.capabilities.commit.available);
const canDeleteLocal = computed(() => resolvedRepoContext.value.capabilities.deleteLocal.available);
const canDeleteRemote = computed(() => resolvedRepoContext.value.capabilities.deleteRemote.available);
const showCommitDetail = computed(() =>
  activeSection.value === "history" && Boolean(props.selectedCommitHash),
);
const projectSidebarErrors = computed<ProjectSidebarError[]>(() => {
  const errors: ProjectSidebarError[] = [];
  const addError = (
    key: string,
    title: string,
    message: string | null | undefined,
    options: Pick<ProjectSidebarError, "retry" | "retrying"> = {},
  ) => {
    if (!message) return;
    errors.push({
      key,
      title,
      message,
      ...options,
      guidance: recoveryGuidanceForMessage(message),
    });
  };
  if (props.recentSyncError) {
    addError("recent-sync", "最近同步失败", props.recentSyncError.message, {
      retry: "sync",
      retrying: props.recentSyncError.retrying,
    });
  }
  addError("action", "操作失败", props.actionError);
  addError("repo-action", "仓库错误", props.repoActionError);
  addError("readme", "README 读取失败", readmeError.value);
  addError("github", "GitHub 请求失败", githubError.value);
  addError("actions", "Actions 读取失败", actionsError.value);
  addError("releases", "Releases 读取失败", releasesError.value);
  return errors;
});
const hasProjectSidebarErrors = computed(() => projectSidebarErrors.value.length > 0);
const showProjectSidebar = computed(() =>
  hasProjectSidebarErrors.value ||
  activeSection.value === "files" ||
  activeSection.value === "readme" ||
  activeSection.value === "board" ||
  activeSection.value === "issues" ||
  activeSection.value === "pulls" ||
  activeSection.value === "actions" ||
  activeSection.value === "release" ||
  activeSection.value === "settings",
);
const terminalHtml = computed(() => renderTerminalHtml(props.launchLogs));
const displayedIssueTemplates = computed(() => [blankIssueTemplate(), ...issueTemplates.value]);
const issueTemplateOptions = computed(() =>
  displayedIssueTemplates.value.map((template) => ({
    value: template.key,
    label: template.name,
    hint: template.kind === "blank" ? undefined : template.description,
  }))
);
const selectedIssueTemplate = computed(() =>
  displayedIssueTemplates.value.find((template) => template.key === issueTemplateKey.value) ??
  displayedIssueTemplates.value[0]
);
const issueTemplateFields = computed(() =>
  selectedIssueTemplate.value.fields.filter((field) => field.type !== "markdown")
);
const issueTemplateMarkdownFields = computed(() =>
  selectedIssueTemplate.value.fields.filter((field) => field.type === "markdown")
);
const issueLabelOptions = computed(() =>
  uniqueSorted([
    ...remoteIssueLabels.value,
    ...issueLabels.value,
  ])
);
const issueAssigneeOptions = computed(() =>
  uniqueSorted([
    ...remoteIssueAssignees.value,
    ...issueAssignees.value,
  ])
);
const issueLabelSummary = computed(() => multiSelectSummary(issueLabels.value, "无标签"));
const issueAssigneeSummary = computed(() => multiSelectSummary(issueAssignees.value, "未分配"));
const issueLabelDropdownOptions = computed(() => stringOptions(issueLabelOptions.value));
const issueAssigneeDropdownOptions = computed(() => stringOptions(issueAssigneeOptions.value));
const issueListOptions = computed<GitHubIssueListOptions>(() => ({
  state: issueState.value,
  perPage: 100,
  sort: issuePanelFilters.value.sort,
  direction: issuePanelFilters.value.direction,
  creator: issuePanelFilters.value.creator,
  assignee: issuePanelFilters.value.assignee,
  labels: issuePanelFilters.value.labels,
  milestone: issuePanelFilters.value.milestone,
  project: issuePanelFilters.value.project,
  query: issuePanelFilters.value.query,
}));
const issueListKey = computed(() => JSON.stringify(issueListOptions.value));
const pullListOptions = computed<GitHubPullRequestListOptions>(() => ({
  state: pullState.value,
  perPage: 100,
  sort: pullRequestPanelFilters.value.sort,
  direction: pullRequestPanelFilters.value.direction,
  creator: pullRequestPanelFilters.value.creator,
  assignee: pullRequestPanelFilters.value.assignee,
  labels: pullRequestPanelFilters.value.labels,
  milestone: pullRequestPanelFilters.value.milestone,
  project: pullRequestPanelFilters.value.project,
  review: pullRequestPanelFilters.value.review,
  query: pullRequestPanelFilters.value.query,
}));
const pullListKey = computed(() => JSON.stringify(pullListOptions.value));
const focusedIssueDetail = computed(() => {
  const issueNumber = focusedIssueNumber.value;
  if (issueNumber == null) return null;
  if (issueDiscussion.value?.issue.number === issueNumber) return issueDiscussion.value.issue;
  return issues.value.find((issue) => issue.number === issueNumber) ?? null;
});
const focusedPullRequestDetail = computed(() => {
  const pullNumber = focusedPullRequestNumber.value;
  if (pullNumber == null) return null;
  if (pullRequestDiscussion.value?.pullRequest.number === pullNumber) {
    return pullRequestDiscussion.value.pullRequest;
  }
  return pulls.value.find((pull) => pull.number === pullNumber) ?? null;
});
const canSubmitIssueCreate = computed(() =>
  Boolean(props.repoFullName) &&
  !creatingIssue.value &&
  issueTitle.value.trim().length > 0 &&
  issueTemplateRequiredFieldsSatisfied(selectedIssueTemplate.value, issueTemplateAnswers.value)
);
const displayedPullRequestTemplates = computed(() => [blankPullRequestTemplate(), ...pullRequestTemplates.value]);
const pullRequestTemplateOptions = computed(() =>
  displayedPullRequestTemplates.value.map((template) => ({
    value: template.key,
    label: template.name,
    hint: template.kind === "blank" ? undefined : template.description,
  }))
);
const selectedPullRequestTemplate = computed(() =>
  displayedPullRequestTemplates.value.find((template) => template.key === pullRequestTemplateKey.value) ??
  displayedPullRequestTemplates.value[0]
);
const canSubmitPullRequestCreate = computed(() =>
  Boolean(props.repoFullName) &&
  !creatingPullRequest.value &&
  pullRequestTitle.value.trim().length > 0 &&
  pullRequestHead.value.trim().length > 0 &&
  pullRequestBase.value.trim().length > 0
);

function isProjectSidebarButtonActive(section: ProjectSidebarMode) {
  return projectSidebarMode.value === section;
}

const projectSidebarMode = computed<ProjectSidebarMode>(() => {
  if (activeSection.value === "files") return "files";
  if (
    activeSection.value === "board" ||
    activeSection.value === "issues" ||
    activeSection.value === "pulls" ||
    activeSection.value === "actions" ||
    activeSection.value === "release" ||
    activeSection.value === "settings"
  ) {
    return activeSection.value;
  }
  return "repo";
});
const routedProjectTab = computed(() => normalizeProjectTab(route.query.projectTab));
const projectTab = computed<ProjectTab>(() => routedProjectTab.value ?? normalizeProjectTab(props.projectTab) ?? "readme");
const routedReleaseTag = computed(() => routeStringValue(route.query.releaseTag));
const routedReleaseType = computed(() => releaseTypeFilterFromRoute());
const routedProjectIssue = computed(() => normalizePositiveNumber(route.query.issue));
const routedProjectPullRequest = computed(() => normalizePositiveNumber(route.query.pr));
const routedIssueFilterState = computed(() => JSON.stringify({
  state: issueStateFromRoute(),
  filters: issuePanelFiltersFromRoute(),
}));
const routedPullRequestFilterState = computed(() => JSON.stringify({
  state: pullRequestStateFromRoute(),
  filters: pullRequestPanelFiltersFromRoute(),
}));

onMounted(() => {
  void applyProjectRouteState();
  prefetchGitHubProjectMetadata();
  measureAboutTopicOverflow();
  window.addEventListener("resize", measureAboutTopicOverflow);
});

onBeforeUnmount(() => {
  aboutTopicResizeObserver?.disconnect();
  aboutTopicResizeObserver = null;
  window.removeEventListener("resize", measureAboutTopicOverflow);
});

watch(aboutTopicMeasureList, (measureList) => {
  aboutTopicResizeObserver?.disconnect();
  aboutTopicResizeObserver = null;
  if (measureList && typeof ResizeObserver !== "undefined") {
    aboutTopicResizeObserver = new ResizeObserver(measureAboutTopicOverflow);
    aboutTopicResizeObserver.observe(measureList);
  }
  measureAboutTopicOverflow();
}, { flush: "post" });

watch([aboutTopics, () => props.repoFullName], () => {
  aboutTopicsExpanded.value = false;
  measureAboutTopicOverflow();
}, { flush: "post" });

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
  prefetchGitHubProjectMetadata();
  if (props.activeGitTab === "repo" && !routedProjectTab.value && isGitHubProjectSection(currentSection)) {
    activeSection.value = currentSection;
    void ensureSectionData(currentSection);
    return;
  }
  void applyProjectRouteState();
});

watch(() => resolvedRepoContext.value.capabilities.issues.available, (githubAvailable) => {
  if (!githubAvailable) {
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

watch([routedIssueFilterState, routedPullRequestFilterState], () => {
  applyRoutedListFilters();
});

watch(
    [
      routedProjectTab,
      routedReleaseTag,
      routedReleaseType,
      routedProjectIssue,
      () => props.projectIssueNumber,
      routedProjectPullRequest,
      () => props.projectRunId,
      () => props.projectJobId,
    ],
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
  if (
    value === "readme" ||
    value === "board" ||
    value === "issues" ||
    value === "pulls" ||
    value === "actions" ||
    value === "release" ||
    value === "settings"
  ) return value;
  return null;
}

function routeStringValue(value: unknown) {
  const next = Array.isArray(value) ? value[0] : value;
  if (typeof next !== "string") return null;
  const trimmed = next.trim();
  return trimmed || null;
}

function routeStringList(value: unknown) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function routeEnum<T extends string>(value: unknown, allowed: readonly T[]) {
  const next = routeStringValue(value);
  return next && (allowed as readonly string[]).includes(next) ? next as T : null;
}

function issueStateFromRoute(): IssueState {
  return routeEnum(route.query[issueRouteKeys.state], issueStates) ?? "open";
}

function pullRequestStateFromRoute(): PullRequestState {
  return routeEnum(route.query[pullRequestRouteKeys.state], pullRequestStates) ?? "open";
}

function releaseTypeFilterFromRoute(): ReleaseTypeFilter {
  return routeEnum(route.query.releaseType, releaseTypeFilters.map((item) => item.value)) ?? "all";
}

function sharedPanelFiltersFromRoute<T extends SharedPanelFilters>(
  keys: RouteFilterKeys,
  defaults: T,
): T {
  return {
    ...defaults,
    creator: routeStringValue(route.query[keys.creator]),
    assignee: routeStringValue(route.query[keys.assignee]),
    labels: routeStringList(route.query[keys.labels]),
    milestone: routeStringValue(route.query[keys.milestone]),
    project: routeStringValue(route.query[keys.project]),
    sort: routeEnum(route.query[keys.sort], listSorts) ?? defaults.sort,
    direction: routeEnum(route.query[keys.direction], listDirections) ?? defaults.direction,
    query: routeStringValue(route.query[keys.query]) ?? "",
  };
}

function issuePanelFiltersFromRoute(): IssuePanelFilters {
  return sharedPanelFiltersFromRoute(issueRouteKeys, blankIssuePanelFilters());
}

function pullRequestPanelFiltersFromRoute(): PullRequestPanelFilters {
  return {
    ...sharedPanelFiltersFromRoute(pullRequestRouteKeys, blankPullRequestPanelFilters()),
    review: routeEnum(route.query[pullRequestRouteKeys.review ?? ""], pullRequestReviews),
  };
}

function normalizePositiveNumber(value: unknown) {
  const next = Array.isArray(value) ? value[0] : value;
  if (typeof next !== "string") return null;
  const parsed = Number.parseInt(next, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

function routeTabToSection(tab: RepoRouteTab): ProjectContentMode {
  if (tab === "repo") {
    if (route.path.endsWith("/files")) return "files";
    return normalizeProjectTab(route.query.projectTab) ?? normalizeProjectTab(props.projectTab) ?? "readme";
  }
  if (tab === "run") return "launch";
  return tab;
}

function isGitHubProjectSection(section: ProjectContentMode) {
  return section === "board" ||
    section === "issues" ||
    section === "pulls" ||
    section === "actions" ||
    section === "release" ||
    section === "settings";
}

function hasIssue(issueNumber: number) {
  return issues.value.some((issue) => issue.number === issueNumber);
}

function setIssueState(value: "open" | "closed" | "all") {
  if (issueState.value === value) return;
  issueState.value = value;
  void pushProjectTabRoute("issues");
}

function setIssuePanelFilters(filters: IssuePanelFilters) {
  if (sameIssuePanelFilters(issuePanelFilters.value, filters)) return;
  issuePanelFilters.value = {
    ...filters,
    labels: [...filters.labels],
  };
  if (activeSection.value === "issues") {
    void loadIssues();
  }
  void pushProjectTabRoute("issues");
}

function setPullRequestState(value: PullRequestState) {
  if (pullState.value === value) return;
  pullState.value = value;
  void pushProjectTabRoute("pulls");
}

function setPullRequestPanelFilters(filters: PullRequestPanelFilters) {
  if (samePullRequestPanelFilters(pullRequestPanelFilters.value, filters)) return;
  pullRequestPanelFilters.value = {
    ...filters,
    labels: [...filters.labels],
  };
  if (activeSection.value === "pulls") {
    void loadPullRequests();
  }
  void pushProjectTabRoute("pulls");
}

function applyRoutedListFilters() {
  const nextIssueState = issueStateFromRoute();
  const nextIssueFilters = issuePanelFiltersFromRoute();
  const issueChanged = issueState.value !== nextIssueState ||
    !sameIssuePanelFilters(issuePanelFilters.value, nextIssueFilters);
  if (issueChanged) {
    if (issueState.value !== nextIssueState) suppressIssueStateReload = true;
    issueState.value = nextIssueState;
    issuePanelFilters.value = {
      ...nextIssueFilters,
      labels: [...nextIssueFilters.labels],
    };
    if (activeSection.value === "issues") {
      void loadIssues();
    }
  }

  const nextPullState = pullRequestStateFromRoute();
  const nextPullFilters = pullRequestPanelFiltersFromRoute();
  const pullChanged = pullState.value !== nextPullState ||
    !samePullRequestPanelFilters(pullRequestPanelFilters.value, nextPullFilters);
  if (pullChanged) {
    if (pullState.value !== nextPullState) suppressPullStateReload = true;
    pullState.value = nextPullState;
    pullRequestPanelFilters.value = {
      ...nextPullFilters,
      labels: [...nextPullFilters.labels],
    };
    if (activeSection.value === "pulls") {
      void loadPullRequests();
    }
  }
}

function sameIssuePanelFilters(left: IssuePanelFilters, right: IssuePanelFilters) {
  return sameSharedPanelFilters(left, right);
}

function samePullRequestPanelFilters(left: PullRequestPanelFilters, right: PullRequestPanelFilters) {
  return sameSharedPanelFilters(left, right) && left.review === right.review;
}

function sameSharedPanelFilters(left: SharedPanelFilters, right: SharedPanelFilters) {
  return left.creator === right.creator &&
    left.assignee === right.assignee &&
    left.milestone === right.milestone &&
    left.project === right.project &&
    left.sort === right.sort &&
    left.direction === right.direction &&
    left.query === right.query &&
    sameStringList(left.labels, right.labels);
}

function pushProjectTabRoute(tab: ProjectTab) {
  const nextQuery = projectTabRouteQuery(tab);
  const nextPath = repoRoute(props.repoId);
  if (route.path === nextPath && sameRouteQuery(route.query, nextQuery)) return Promise.resolve();
  return router.push({ path: nextPath, query: nextQuery }).then(() => undefined);
}

function projectTabRouteQuery(tab: ProjectTab): LocationQueryRaw {
  const query: LocationQueryRaw = { ...route.query };
  delete query.issue;
  delete query.pr;
  delete query.run;
  delete query.job;
  delete query.releaseTag;
  delete query.releaseType;
  clearRouteFilters(query, issueRouteKeys);
  clearRouteFilters(query, pullRequestRouteKeys);

  if (tab === "readme") {
    delete query.projectTab;
    return query;
  }

  query.projectTab = tab;
  if (tab === "issues") {
    applyRouteFilters(query, issueRouteKeys, issueState.value, "open", issuePanelFilters.value, blankIssuePanelFilters());
    if (focusedIssueNumber.value) query.issue = String(focusedIssueNumber.value);
  } else if (tab === "pulls") {
    applyRouteFilters(
      query,
      pullRequestRouteKeys,
      pullState.value,
      "open",
      pullRequestPanelFilters.value,
      blankPullRequestPanelFilters(),
    );
    if (focusedPullRequestNumber.value) query.pr = String(focusedPullRequestNumber.value);
  } else if (tab === "actions") {
    if (focusedRunId.value) query.run = String(focusedRunId.value);
    if (focusedJobId.value) query.job = String(focusedJobId.value);
  } else if (tab === "release") {
    if (focusedReleaseTag.value) query.releaseTag = focusedReleaseTag.value;
    if (releaseTypeFilter.value !== "all") query.releaseType = releaseTypeFilter.value;
  }
  return query;
}

function clearRouteFilters(query: LocationQueryRaw, keys: RouteFilterKeys) {
  for (const key of Object.values(keys)) delete query[key];
}

function applyRouteFilters<T extends SharedPanelFilters>(
  query: LocationQueryRaw,
  keys: RouteFilterKeys,
  state: string,
  defaultState: string,
  filters: T,
  defaults: T,
) {
  setRouteString(query, keys.state, state === defaultState ? null : state);
  setRouteString(query, keys.query, filters.query);
  setRouteString(query, keys.creator, filters.creator);
  setRouteString(query, keys.assignee, filters.assignee);
  setRouteList(query, keys.labels, filters.labels);
  setRouteString(query, keys.milestone, filters.milestone);
  setRouteString(query, keys.project, filters.project);
  setRouteString(query, keys.sort, filters.sort === defaults.sort ? null : filters.sort);
  setRouteString(query, keys.direction, filters.direction === defaults.direction ? null : filters.direction);
  if (keys.review && "review" in filters) {
    setRouteString(query, keys.review, filters.review as string | null);
  }
}

function setRouteString(query: LocationQueryRaw, key: string, value: string | number | null | undefined) {
  const next = typeof value === "number" ? String(value) : value?.trim();
  if (next) {
    query[key] = next;
  } else {
    delete query[key];
  }
}

function setRouteList(query: LocationQueryRaw, key: string, values: readonly string[]) {
  const next = values.map((value) => value.trim()).filter(Boolean);
  if (next.length) {
    query[key] = next;
  } else {
    delete query[key];
  }
}

function sameRouteQuery(current: typeof route.query, next: LocationQueryRaw) {
  return normalizedQueryEntries(current) === normalizedQueryEntries(next);
}

function normalizedQueryEntries(query: typeof route.query | LocationQueryRaw) {
  return JSON.stringify(
    Object.entries(query)
      .flatMap(([key, value]) => {
        if (value == null) return [];
        const values = Array.isArray(value) ? value : [value];
        return values
          .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
          .map((item) => [key, String(item)] as const);
      })
      .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
      ),
  );
}

function hasPullRequest(pullNumber: number) {
  return pulls.value.some((pull) => pull.number === pullNumber);
}

function hasRun(runId: number) {
  return workflowRuns.value.some((run) => run.id === runId);
}

function hasReleaseTag(tag: string) {
  return releases.value.some((release) => release.tagName === tag);
}

function releaseTimestamp(release: GitHubRelease) {
  const parsed = Date.parse(release.publishedAt ?? release.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function releaseTypeForFilter(release: GitHubRelease): Exclude<ReleaseTypeFilter, "all"> {
  if (release.draft) return "draft";
  if (release.prerelease) return "prerelease";
  if (release.makeLatest === "true") return "latest";
  return "stable";
}

function releaseTagSelector(tag: string) {
  const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(tag)
    : tag.replace(/["\\]/g, "\\$&");
  return `.release-card[data-release-tag="${escaped}"]`;
}

function clearProjectTargets() {
  focusedIssueNumber.value = null;
  focusedPullRequestNumber.value = null;
  issueDiscussion.value = null;
  issueDiscussionError.value = null;
  pullRequestDiscussion.value = null;
  pullRequestDiscussionError.value = null;
  focusedRunId.value = null;
  focusedJobId.value = null;
  focusedReleaseTag.value = null;
  releaseTypeFilter.value = "all";
  cancelEditIssue();
  closeIssueCreateView(false);
  closePullRequestCreateView(false);
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

function measureAboutTopicOverflow() {
  void nextTick(() => {
    const list = aboutTopicMeasureList.value;
    if (!list || !aboutTopics.value.length) {
      aboutTopicsExpanded.value = false;
      collapsedAboutTopicCount.value = 0;
      return;
    }

    const pills = Array.from(list.querySelectorAll<HTMLElement>(".project-topic-pill"));
    const lineTops = collectLineTops(pills);
    if (lineTops.length <= ABOUT_TOPIC_COLLAPSED_LINE_LIMIT) {
      aboutTopicsExpanded.value = false;
      collapsedAboutTopicCount.value = aboutTopics.value.length;
      return;
    }

    const lastVisibleTop = lineTops[ABOUT_TOPIC_COLLAPSED_LINE_LIMIT - 1];
    collapsedAboutTopicCount.value = Math.max(
      1,
      pills.filter((pill) => Math.round(pill.offsetTop) <= lastVisibleTop + 1).length,
    );
    alignAboutTopicToggle();
  });
}

function collectLineTops(elements: readonly HTMLElement[]) {
  return elements.reduce<number[]>((tops, element) => {
    const top = Math.round(element.offsetTop);
    if (!tops.some((existing) => Math.abs(existing - top) <= 1)) tops.push(top);
    return tops;
  }, []).sort((a, b) => a - b);
}

function alignAboutTopicToggle() {
  void nextTick(() => {
    if (!aboutTopicsOverflowing.value || aboutTopicsExpanded.value || collapsedAboutTopicCount.value <= 1) return;
    const list = aboutTopicList.value;
    const toggle = list?.querySelector<HTMLElement>(".project-topic-toggle");
    if (!list || !toggle) return;
    const elements = Array.from(list.querySelectorAll<HTMLElement>(".project-topic-pill, .project-topic-toggle"));
    const lineTops = collectLineTops(elements);
    const toggleTop = Math.round(toggle.offsetTop);
    const toggleLineIndex = lineTops.findIndex((top) => Math.abs(top - toggleTop) <= 1);
    if (toggleLineIndex >= ABOUT_TOPIC_COLLAPSED_LINE_LIMIT) {
      collapsedAboutTopicCount.value -= 1;
      alignAboutTopicToggle();
    }
  });
}

function toggleAboutTopicsExpanded() {
  aboutTopicsExpanded.value = !aboutTopicsExpanded.value;
}

function githubAccessUnavailable(
  section: GitHubAccessSection,
  error: string | null,
  capability: RepoCapability,
): GitHubAccessUnavailable | null {
  if (!capability.available) {
    return {
      title: `${section} 暂不可用`,
      reason: capability.reason ?? "GitHub 功能暂不可用。",
    };
  }
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
  pullRequestDiscussion.value = null;
  focusedRunId.value = null;
  focusedJobId.value = null;
  focusedReleaseTag.value = null;
  if (!issueNumber) {
    issueDiscussion.value = null;
    issueDiscussionError.value = null;
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
    issueDiscussion.value = null;
    return;
  }
  focusedIssueNumber.value = issueNumber;
  await loadIssueDiscussion(issueNumber);
  await nextTick();
  const row = projectMainRef.value?.querySelector<HTMLElement>(
    `.project-row--issue[data-issue-number="${issueNumber}"]`,
  );
  row?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
}

async function focusRun(runId: number | null | undefined) {
  focusedIssueNumber.value = null;
  focusedPullRequestNumber.value = null;
  focusedJobId.value = props.projectJobId ?? null;
  focusedReleaseTag.value = null;
  if (!runId) {
    clearProjectTargets();
    await Promise.all([
      loadActions(),
      loadReleases(),
    ]);
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
  await loadReleases();
  await nextTick();
  const row = projectMainRef.value?.querySelector<HTMLElement>(
    `.actions-run[data-run-id="${runId}"]`,
  );
  row?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
}

async function focusPullRequest(pullNumber: number | null | undefined) {
  focusedIssueNumber.value = null;
  issueDiscussion.value = null;
  focusedRunId.value = null;
  focusedJobId.value = null;
  focusedReleaseTag.value = null;
  if (!pullNumber) {
    await loadPullRequests();
    focusedPullRequestNumber.value = null;
    pullRequestDiscussion.value = null;
    pullRequestDiscussionError.value = null;
    return;
  }
  await loadPullRequests();
  if (!hasPullRequest(pullNumber)) {
    for (const state of ["closed", "merged"] as const) {
      suppressPullStateReload = true;
      pullState.value = state;
      await loadPullRequests();
      if (hasPullRequest(pullNumber)) break;
    }
  }
  if (!hasPullRequest(pullNumber)) {
    focusedPullRequestNumber.value = null;
    pullRequestDiscussion.value = null;
    return;
  }
  focusedPullRequestNumber.value = pullNumber;
  await Promise.all([
    loadPullRequestChecks(pullNumber),
    loadPullRequestDiscussion(pullNumber),
  ]);
  await nextTick();
  const row = projectMainRef.value?.querySelector<HTMLElement>(
    `.project-row--pull[data-pull-number="${pullNumber}"]`,
  );
  row?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
}

async function focusReleaseTag(tag: string | null | undefined, updateRoute = false) {
  focusedIssueNumber.value = null;
  focusedPullRequestNumber.value = null;
  focusedRunId.value = null;
  focusedJobId.value = null;
  await loadReleases();
  const normalized = tag?.trim() || null;
  focusedReleaseTag.value = normalized && hasReleaseTag(normalized) ? normalized : null;
  if (updateRoute && activeSection.value === "release") await pushProjectTabRoute("release");
  if (!focusedReleaseTag.value) return;
  await nextTick();
  const row = projectMainRef.value?.querySelector<HTMLElement>(releaseTagSelector(focusedReleaseTag.value));
  row?.scrollIntoView?.({ block: "start", inline: "nearest", behavior: "smooth" });
}

function setReleaseTypeFilter(value: ReleaseTypeFilter) {
  if (releaseTypeFilter.value === value) return;
  releaseTypeFilter.value = value;
  if (activeSection.value === "release") void pushProjectTabRoute("release");
}

function clearReleaseFilters() {
  const hadFilters = Boolean(focusedReleaseTag.value) || releaseTypeFilter.value !== "all";
  focusedReleaseTag.value = null;
  releaseTypeFilter.value = "all";
  if (hadFilters && activeSection.value === "release") void pushProjectTabRoute("release");
}

function isIssueRowFocused(issueNumber: number) {
  return focusedIssueNumber.value === issueNumber && activeSection.value === "issues";
}

function isPullRequestRowFocused(pullNumber: number) {
  return focusedPullRequestNumber.value === pullNumber && activeSection.value === "pulls";
}

async function applyProjectRouteState() {
  applyRoutedListFilters();
  activeSection.value = routeTabToSection(props.activeGitTab);
  if (props.activeGitTab !== "repo") {
    clearProjectTargets();
    return;
  }
  const targetTab = projectTab.value;
  await nextTick();
  clearProjectTargets();
  if (targetTab === "issues") {
    await focusIssue(props.projectIssueNumber ?? routedProjectIssue.value);
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
  if (targetTab === "release") {
    releaseTypeFilter.value = routedReleaseType.value;
    await focusReleaseTag(routedReleaseTag.value);
    return;
  }
  await ensureSectionData(targetTab);
}

function prefetchGitHubProjectMetadata() {
  const repoFullName = props.repoFullName;
  if (!repoFullName || remoteDeleted.value) return;
  const canUseIssues = resolvedRepoContext.value.capabilities.issues.available;
  const canUsePulls = resolvedRepoContext.value.capabilities.pulls.available;
  if (!canUseIssues && !canUsePulls) return;
  void Promise.allSettled([
    loadIssueFilterMetadata(false, false),
    ...(canUseIssues ? [loadIssueMetadata(), loadIssueTemplates()] : []),
    ...(canUsePulls ? [loadPullRequestTemplates()] : []),
  ]);
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
  if (!force && readmeLoaded.value) return;
  const repoId = props.repoId;
  const fileProvider = resolvedRepoContext.value.capabilities.files.provider;
  await readmeLoader.run(null, async (runId) => {
    readmeLoading.value = true;
    readmeError.value = null;
    try {
      if (!resolvedRepoContext.value.capabilities.files.available) {
        readmePreview.value = null;
        readmeLoaded.value = true;
        return;
      }
      const rootEntries = await listRepoFiles(repoId, null);
      if (
        !readmeLoader.isCurrent(runId) ||
        repoId !== props.repoId ||
        fileProvider !== resolvedRepoContext.value.capabilities.files.provider
      ) return;
      const readme = rootEntries.find((entry) => entry.kind === "file" && entry.path === README_PATH);
      const nextPreview = readme ? await getRepoFilePreview(repoId, README_PATH) : null;
      if (
        !readmeLoader.isCurrent(runId) ||
        repoId !== props.repoId ||
        fileProvider !== resolvedRepoContext.value.capabilities.files.provider
      ) return;
      readmePreview.value = nextPreview;
      readmeLoaded.value = true;
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
  if (!resolvedRepoContext.value.capabilities.settings.available) {
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
  if (!resolvedRepoContext.value.capabilities.issues.available) {
    clearBlockedGitHubState();
    return;
  }
  if (!repoFullName || remoteDeleted.value) return;
  const loadKey = issueListKey.value;
  if (!force && issuesLoadedKey.value === loadKey) return;
  const options = { ...issueListOptions.value, labels: [...(issueListOptions.value.labels ?? [])] };
  githubError.value = null;
  await issuesLoader.run(loadKey, async (runId) => {
    try {
      const nextIssues = force
        ? await listGitHubIssues(repoFullName, options, { forceRefresh: true })
        : await listGitHubIssues(repoFullName, options);
      if (!issuesLoader.isCurrent(runId) || repoFullName !== props.repoFullName || remoteDeleted.value) return;
      issues.value = nextIssues;
      issuesLoadedKey.value = loadKey;
      syncEditingIssue();
    } catch (err) {
      githubError.value = String(err);
    }
  }, { reusePending: !force });
}

async function loadIssueDiscussion(issueNumber: number, force = false) {
  const repoFullName = props.repoFullName;
  if (!repoFullName || remoteDeleted.value) return;
  if (!force && issueDiscussion.value?.issue.number === issueNumber) return;
  issueDiscussionError.value = null;
  issueDiscussionLoading.value = true;
  await issueDiscussionLoader.run(issueNumber, async (runId) => {
    try {
      const discussion = force
        ? await getGitHubIssueDiscussion(repoFullName, issueNumber, { forceRefresh: true })
        : await getGitHubIssueDiscussion(repoFullName, issueNumber);
      if (!issueDiscussionLoader.isCurrent(runId) || repoFullName !== props.repoFullName || remoteDeleted.value) return;
      issueDiscussion.value = discussion;
      issues.value = issues.value.map((issue) => issue.number === discussion.issue.number ? discussion.issue : issue);
    } catch (err) {
      if (issueDiscussionLoader.isCurrent(runId)) issueDiscussionError.value = String(err);
    } finally {
      if (issueDiscussionLoader.isCurrent(runId)) issueDiscussionLoading.value = false;
    }
  });
}

async function loadPullRequests(force = false) {
  const repoFullName = props.repoFullName;
  if (!resolvedRepoContext.value.capabilities.pulls.available) {
    clearBlockedGitHubState();
    return;
  }
  if (!repoFullName || remoteDeleted.value) return;
  const loadKey = pullListKey.value;
  if (!force && pullsLoadedKey.value === loadKey) return;
  const options = { ...pullListOptions.value, labels: [...(pullListOptions.value.labels ?? [])] };
  githubError.value = null;
  pullsLoading.value = true;
  await pullsLoader.run(loadKey, async (runId) => {
    try {
      const nextPulls = force
        ? await listGitHubPullRequests(repoFullName, options, { forceRefresh: true })
        : await listGitHubPullRequests(repoFullName, options);
      if (!pullsLoader.isCurrent(runId) || repoFullName !== props.repoFullName || remoteDeleted.value) return;
      pulls.value = nextPulls;
      pullsLoadedKey.value = loadKey;
      const current = focusedPullRequestNumber.value;
      if (current && nextPulls.some((pull) => pull.number === current)) {
        await loadPullRequestChecks(current, force);
      } else {
        focusedPullRequestNumber.value = null;
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

async function loadBoardItems(force = false) {
  const repoFullName = props.repoFullName;
  if (!repoFullName || remoteDeleted.value) return;
  const canUseIssues = resolvedRepoContext.value.capabilities.issues.available;
  const canUsePulls = resolvedRepoContext.value.capabilities.pulls.available;
  if (!canUseIssues && !canUsePulls) {
    clearBlockedGitHubState();
    return;
  }
  if (!force && boardLoadedRepo.value === repoFullName) return;
  githubError.value = null;
  boardLoading.value = true;
  await boardLoader.run(repoFullName, async (runId) => {
    try {
      const [nextIssues, nextPulls] = await Promise.all([
        canUseIssues
          ? listGitHubIssues(repoFullName, {
              state: "all",
              perPage: 100,
              sort: "updated",
              direction: "desc",
            }, { forceRefresh: force })
          : Promise.resolve([]),
        canUsePulls
          ? listGitHubPullRequests(repoFullName, {
              state: "all",
              perPage: 100,
              sort: "updated",
              direction: "desc",
            }, { forceRefresh: force })
          : Promise.resolve([]),
      ]);
      if (!boardLoader.isCurrent(runId) || repoFullName !== props.repoFullName || remoteDeleted.value) return;
      boardIssues.value = nextIssues;
      boardPulls.value = nextPulls;
      boardLoadedRepo.value = repoFullName;
    } catch (err) {
      githubError.value = String(err);
    } finally {
      if (boardLoader.isCurrent(runId)) {
        boardLoading.value = false;
      }
    }
  }, { reusePending: !force });
}

async function loadPullRequestDiscussion(pullNumber: number, force = false) {
  const repoFullName = props.repoFullName;
  if (!repoFullName || remoteDeleted.value) return;
  if (!force && pullRequestDiscussion.value?.pullRequest.number === pullNumber) return;
  pullRequestDiscussionError.value = null;
  pullRequestDiscussionLoading.value = true;
  await pullRequestDiscussionLoader.run(pullNumber, async (runId) => {
    try {
      const discussion = force
        ? await getGitHubPullRequestDiscussion(repoFullName, pullNumber, { forceRefresh: true })
        : await getGitHubPullRequestDiscussion(repoFullName, pullNumber);
      if (!pullRequestDiscussionLoader.isCurrent(runId) || repoFullName !== props.repoFullName || remoteDeleted.value) return;
      pullRequestDiscussion.value = discussion;
      pulls.value = pulls.value.map((pull) => pull.number === discussion.pullRequest.number ? discussion.pullRequest : pull);
    } catch (err) {
      if (pullRequestDiscussionLoader.isCurrent(runId)) pullRequestDiscussionError.value = String(err);
    } finally {
      if (pullRequestDiscussionLoader.isCurrent(runId)) pullRequestDiscussionLoading.value = false;
    }
  });
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
  if (!resolvedRepoContext.value.capabilities.actions.available) {
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

async function loadReleases(force = false) {
  const repoFullName = props.repoFullName;
  if (!resolvedRepoContext.value.capabilities.issues.available) {
    clearBlockedGitHubState();
    releasesLoading.value = false;
    return;
  }
  if (!repoFullName || remoteDeleted.value) {
    releases.value = [];
    releasesError.value = null;
    return;
  }
  if (!force && releasesLoaded.value) return;
  await releasesLoader.run(null, async (runId) => {
    releasesLoading.value = true;
    releasesError.value = null;
    try {
      const nextReleases = force
        ? await listGitHubReleases(repoFullName, { forceRefresh: true })
        : await listGitHubReleases(repoFullName);
      if (!releasesLoader.isCurrent(runId) || repoFullName !== props.repoFullName || remoteDeleted.value) return;
      releases.value = nextReleases;
      releasesLoaded.value = true;
      if (focusedReleaseTag.value && !hasReleaseTag(focusedReleaseTag.value)) focusedReleaseTag.value = null;
    } catch (err) {
      releasesError.value = String(err);
    } finally {
      if (releasesLoader.isCurrent(runId)) releasesLoading.value = false;
    }
  }, { reusePending: !force });
}

async function refreshActionsPanel() {
  await Promise.all([
    loadActions(true),
    loadReleases(true),
  ]);
}

async function ensureSectionData(section: ProjectContentMode) {
  if (section === "readme") {
    await Promise.all([
      loadReadme(),
      resolvedRepoContext.value.capabilities.settings.available ? loadSettings() : Promise.resolve(),
    ]);
    return;
  }
  if (section === "issues") {
    await Promise.all([
      loadIssues(),
      loadIssueFilterMetadata(),
    ]);
    return;
  }
  if (section === "board") {
    await Promise.all([
      loadBoardItems(),
      loadIssueFilterMetadata(),
    ]);
    return;
  }
  if (section === "pulls") {
    await Promise.all([
      loadPullRequests(),
      loadIssueFilterMetadata(),
    ]);
    return;
  }
  if (section === "actions") {
    await Promise.all([
      loadActions(),
      loadReleases(),
    ]);
    return;
  }
  if (section === "release") {
    await loadReleases();
    return;
  }
  if (section === "settings") {
    await loadSettings();
  }
}

async function refreshLoadedSectionData() {
  if (activeSection.value === "readme") {
    if (readmeLoaded.value || settingsLoaded.value) {
      await Promise.all([
        readmeLoaded.value ? loadReadme(true) : Promise.resolve(),
        resolvedRepoContext.value.capabilities.settings.available && settingsLoaded.value
          ? loadSettings(true)
          : Promise.resolve(),
      ]);
    }
    return;
  }
  if (activeSection.value === "issues" && issuesLoadedKey.value) {
    await Promise.all([
      loadIssues(true),
      issueFilterMetadataLoadedRepo.value ? loadIssueFilterMetadata(true) : Promise.resolve(),
      focusedIssueNumber.value ? loadIssueDiscussion(focusedIssueNumber.value, true) : Promise.resolve(),
    ]);
    return;
  }
  if (activeSection.value === "board" && boardLoadedRepo.value) {
    await Promise.all([
      loadBoardItems(true),
      issueFilterMetadataLoadedRepo.value ? loadIssueFilterMetadata(true) : Promise.resolve(),
    ]);
    return;
  }
  if (activeSection.value === "pulls" && pullsLoadedKey.value) {
    await Promise.all([
      loadPullRequests(true),
      issueFilterMetadataLoadedRepo.value ? loadIssueFilterMetadata(true) : Promise.resolve(),
      focusedPullRequestNumber.value ? loadPullRequestDiscussion(focusedPullRequestNumber.value, true) : Promise.resolve(),
    ]);
    return;
  }
  if (activeSection.value === "actions" && actionsLoaded.value) {
    await Promise.all([
      loadActions(true),
      releasesLoaded.value ? loadReleases(true) : Promise.resolve(),
    ]);
    return;
  }
  if (activeSection.value === "release" && releasesLoaded.value) {
    await loadReleases(true);
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
  releasesLoading.value = false;
}

function resetProjectSectionState() {
  activeSection.value = routeTabToSection(props.activeGitTab);
  readmeLoader.invalidate();
  invalidateRepoMutations();
  readmePreview.value = null;
  readmeLoaded.value = false;
  readmeLoading.value = false;
  readmeError.value = null;
  resetGitHubSectionState();
}

function resetGitHubSectionState() {
  settingsLoader.invalidate();
  issuesLoader.invalidate();
  boardLoader.invalidate();
  issueDiscussionLoader.invalidate();
  pullsLoader.invalidate();
  pullRequestDiscussionLoader.invalidate();
  pullChecksLoader.invalidate();
  actionsLoader.invalidate();
  releasesLoader.invalidate();
  invalidateGitHubMutations();
  settings.value = null;
  settingsLoaded.value = false;
  issues.value = [];
  boardIssues.value = [];
  boardPulls.value = [];
  boardLoadedRepo.value = null;
  boardLoading.value = false;
  issueDiscussion.value = null;
  issueDiscussionLoading.value = false;
  issueDiscussionError.value = null;
  issuesLoadedKey.value = null;
  issueState.value = issueStateFromRoute();
  issuePanelFilters.value = issuePanelFiltersFromRoute();
  issueFilterMetadata.value = emptyIssueFilterMetadata();
  issueFilterMetadataLoading.value = false;
  issueFilterMetadataLoadedRepo.value = null;
  pulls.value = [];
  pullRequestDiscussion.value = null;
  pullRequestDiscussionLoading.value = false;
  pullRequestDiscussionError.value = null;
  pullChecks.value = {};
  pullsLoadedKey.value = null;
  pullState.value = pullRequestStateFromRoute();
  pullRequestPanelFilters.value = pullRequestPanelFiltersFromRoute();
  pullsLoading.value = false;
  pullChecksLoading.value = false;
  focusedPullRequestNumber.value = null;
  pullRequestTitle.value = "";
  pullRequestBody.value = "";
  pullRequestBase.value = "";
  pullRequestHead.value = "";
  pullRequestDraft.value = false;
  pullCreateView.value = false;
  pullRequestTemplates.value = [];
  pullRequestTemplateKey.value = blankPullRequestTemplate().key;
  pullRequestTemplatesLoading.value = false;
  pullRequestTemplatesLoadedRepo.value = null;
  pullRequestMergeMethod.value = "merge";
  workflowRuns.value = [];
  actionsLoaded.value = false;
  releases.value = [];
  releasesLoading.value = false;
  releasesLoaded.value = false;
  releasesError.value = null;
  focusedReleaseTag.value = null;
  releaseTypeFilter.value = "all";
  githubError.value = null;
  actionsError.value = null;
  aboutEditing.value = false;
  aboutTopicDraft.value = "";
  cancelEditIssue();
  closeIssueCreateView(false);
  remoteIssueLabels.value = [];
  remoteIssueAssignees.value = [];
  issueMetadataLoading.value = false;
  issueMetadataLoadedRepo.value = null;
  focusedIssueNumber.value = null;
  focusedRunId.value = null;
  focusedJobId.value = null;
}

function invalidateGitHubMutations() {
  githubMutationGeneration += 1;
  settingsSaveTracker.reset();
  issueCreateTracker.reset();
  issueUpdateTracker.reset();
  pullCreateTracker.reset();
  pullUpdateTracker.reset();
  releaseCreateTracker.reset();
  releaseUpdateTracker.reset();
  releaseDeleteTracker.reset();
  releaseAssetUploadTracker.reset();
  releaseAssetDeleteTracker.reset();
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
  if (target === "remote" && (!canDeleteRemote.value || !props.repoFullName || deletingRepo.value)) return;
  if (target === "local" && (!canDeleteLocal.value || !props.repoPath || deletingLocalRepo.value)) return;
  deleteDialogTarget.value = target;
  deleteConfirmInput.value = "";
  deleteError.value = null;
}

function closeDeleteDialog() {
  if (deletingAnything.value) return;
  if (deleteDialogTarget.value) invalidateSessionContextSnapshot();
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
  if (!repoId || !canDeleteLocal.value || !deleteConfirmMatches.value || deletingLocalRepo.value) return;
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
  if (!repoFullName || !canDeleteRemote.value || !deleteConfirmMatches.value || deletingRepo.value) return;
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
      hasRepoTag(resolvedRepoContext.value, "github-remote") &&
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

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function stringOptions(values: readonly string[]) {
  return values.map((value) => ({ value, label: value }));
}

function multiSelectSummary(values: readonly string[], emptyText: string) {
  if (!values.length) return emptyText;
  if (values.length <= 2) return values.join(", ");
  return `${values.slice(0, 2).join(", ")} +${values.length - 2}`;
}

function targetValue(event: Event) {
  const target = event.target;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
    ? target.value
    : "";
}

function targetChecked(event: Event) {
  const target = event.target;
  return target instanceof HTMLInputElement ? target.checked : false;
}

function dropdownOptions(options: readonly string[]) {
  return [
    { value: "", label: "Select an option" },
    ...options.map((option) => ({ value: option, label: option })),
  ];
}

async function openIssueCreateView() {
  issueCreateView.value = true;
  cancelEditIssue();
  applyIssueTemplate(selectedIssueTemplate.value);
  await Promise.all([
    loadIssueTemplates(),
    loadIssueMetadata(),
  ]);
}

function closeIssueCreateView(resetDraft = true) {
  if (issueCreateView.value) invalidateSessionContextSnapshot();
  issueCreateView.value = false;
  if (!resetDraft) return;
  issueTitle.value = "";
  issueBody.value = "";
  issueLabels.value = [];
  issueAssignees.value = [];
  issueTemplateKey.value = blankIssueTemplate().key;
  issueTemplateAnswers.value = {};
}

async function loadIssueTemplates(force = false) {
  const repoFullName = props.repoFullName;
  if (!repoFullName || issueTemplatesLoading.value) return;
  if (!force && issueTemplatesLoadedRepo.value === repoFullName) return;
  issueTemplatesLoading.value = true;
  try {
    const nextTemplates = await loadGitHubIssueTemplates(repoFullName);
    if (repoFullName !== props.repoFullName || remoteDeleted.value) return;
    issueTemplates.value = nextTemplates;
    issueTemplatesLoadedRepo.value = repoFullName;
    if (!displayedIssueTemplates.value.some((template) => template.key === issueTemplateKey.value)) {
      issueTemplateKey.value = blankIssueTemplate().key;
      applyIssueTemplate(selectedIssueTemplate.value);
    }
  } finally {
    if (repoFullName === props.repoFullName) issueTemplatesLoading.value = false;
  }
}

function selectIssueTemplate(key: string) {
  issueTemplateKey.value = key;
  applyIssueTemplate(selectedIssueTemplate.value);
}

function applyIssueTemplate(template: GitHubIssueTemplate) {
  issueTitle.value = template.titlePrefix;
  issueBody.value = template.body;
  issueLabels.value = [...template.labels];
  issueAssignees.value = [...template.assignees];
  issueTemplateAnswers.value = createIssueTemplateAnswers(template);
}

async function loadIssueMetadata(force = false) {
  const repoFullName = props.repoFullName;
  if (!repoFullName || issueMetadataLoading.value) return;
  if (!force && issueMetadataLoadedRepo.value === repoFullName) return;
  issueMetadataLoading.value = true;
  try {
    const [labelsResult, assigneesResult] = await Promise.allSettled([
      listGitHubIssueLabels(repoFullName, { forceRefresh: force }),
      listGitHubIssueAssignees(repoFullName, { forceRefresh: force }),
    ]);
    if (repoFullName !== props.repoFullName || remoteDeleted.value) return;
    remoteIssueLabels.value = labelsResult.status === "fulfilled" ? labelsResult.value : [];
    remoteIssueAssignees.value = assigneesResult.status === "fulfilled" ? assigneesResult.value : [];
    issueMetadataLoadedRepo.value = repoFullName;
  } finally {
    if (repoFullName === props.repoFullName) issueMetadataLoading.value = false;
  }
}

async function loadIssueFilterMetadata(force = false, reportError = true) {
  const repoFullName = props.repoFullName;
  if (!repoFullName || issueFilterMetadataLoading.value) return;
  if (!force && issueFilterMetadataLoadedRepo.value === repoFullName) return;
  issueFilterMetadataLoading.value = true;
  try {
    const metadata = await getGitHubIssueFilterMetadata(repoFullName, { forceRefresh: force });
    if (repoFullName !== props.repoFullName || remoteDeleted.value) return;
    issueFilterMetadata.value = metadata;
    issueFilterMetadataLoadedRepo.value = repoFullName;
  } catch (err) {
    if (reportError && repoFullName === props.repoFullName) githubError.value = String(err);
  } finally {
    if (repoFullName === props.repoFullName) issueFilterMetadataLoading.value = false;
  }
}

function issueFieldValue(field: GitHubIssueTemplateField) {
  const value = issueTemplateAnswers.value[field.id];
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}

function setIssueFieldValue(fieldId: string, value: string) {
  issueTemplateAnswers.value = {
    ...issueTemplateAnswers.value,
    [fieldId]: value,
  };
}

function issueCheckboxChecked(fieldId: string, optionLabel: string) {
  const value = issueTemplateAnswers.value[fieldId];
  return Array.isArray(value) && value.includes(optionLabel);
}

function toggleIssueCheckbox(fieldId: string, optionLabel: string, checked: boolean) {
  const current = issueTemplateAnswers.value[fieldId];
  const values = Array.isArray(current) ? current : [];
  issueTemplateAnswers.value = {
    ...issueTemplateAnswers.value,
    [fieldId]: checked
      ? [...new Set([...values, optionLabel])]
      : values.filter((item) => item !== optionLabel),
  };
}

async function openPullRequestCreateView() {
  pullCreateView.value = true;
  preparePullRequestDefaults();
  await Promise.all([
    settingsLoaded.value ? Promise.resolve() : loadSettings(),
    loadPullRequestTemplates(),
  ]);
  preparePullRequestDefaults();
}

function closePullRequestCreateView(resetDraft = true) {
  if (pullCreateView.value) invalidateSessionContextSnapshot();
  pullCreateView.value = false;
  if (!resetDraft) return;
  pullRequestTitle.value = "";
  pullRequestBody.value = "";
  pullRequestBase.value = "";
  pullRequestHead.value = "";
  pullRequestDraft.value = false;
  pullRequestTemplateKey.value = blankPullRequestTemplate().key;
}

async function loadPullRequestTemplates(force = false) {
  const repoFullName = props.repoFullName;
  if (!repoFullName || pullRequestTemplatesLoading.value) return;
  if (!force && pullRequestTemplatesLoadedRepo.value === repoFullName) return;
  pullRequestTemplatesLoading.value = true;
  try {
    const nextTemplates = await loadGitHubPullRequestTemplates(repoFullName);
    if (repoFullName !== props.repoFullName || remoteDeleted.value) return;
    pullRequestTemplates.value = nextTemplates;
    pullRequestTemplatesLoadedRepo.value = repoFullName;
    if (!displayedPullRequestTemplates.value.some((template) => template.key === pullRequestTemplateKey.value)) {
      pullRequestTemplateKey.value = blankPullRequestTemplate().key;
      applyPullRequestTemplate(selectedPullRequestTemplate.value);
    }
  } finally {
    if (repoFullName === props.repoFullName) pullRequestTemplatesLoading.value = false;
  }
}

function selectPullRequestTemplate(key: string) {
  pullRequestTemplateKey.value = key;
  applyPullRequestTemplate(selectedPullRequestTemplate.value);
}

function applyPullRequestTemplate(template: GitHubPullRequestTemplate) {
  pullRequestBody.value = template.body;
}

function syncEditingIssue() {
  if (!hasIssue(editingIssueNumber.value ?? -1)) {
    cancelEditIssue();
  }
}

function startEditIssue(issue: GitHubIssue) {
  focusedIssueNumber.value = null;
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
  const title = issueTitle.value.trim();
  if (!title || !issueTemplateRequiredFieldsSatisfied(selectedIssueTemplate.value, issueTemplateAnswers.value)) return;
  const body = buildIssueTemplateBody(selectedIssueTemplate.value, issueTemplateAnswers.value, issueBody.value);
  const request = {
    title,
    body,
    labels: [...issueLabels.value],
    assignees: [...issueAssignees.value],
  };
  const result = await runGitHubMutation(repoFullName, issueCreateTracker, () =>
    createGitHubIssue(repoFullName, request)
  );
  if (!result.ok) return;
  const issue = result.value;
  issues.value = [issue, ...issues.value];
  issueTitle.value = "";
  issueBody.value = "";
  issueLabels.value = [];
  issueAssignees.value = [];
  issueTemplateAnswers.value = {};
  issueTemplateKey.value = blankIssueTemplate().key;
  issueCreateView.value = false;
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
  if (issueDiscussion.value?.issue.number === updated.number) {
    await loadIssueDiscussion(updated.number, true);
  }
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
  pullRequestTemplateKey.value = blankPullRequestTemplate().key;
  pullCreateView.value = false;
  pullState.value = "open";
  await Promise.all([
    loadPullRequestChecks(pull.number, true),
    loadPullRequestDiscussion(pull.number, true),
  ]);
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
  if (pullRequestDiscussion.value?.pullRequest.number === updated.number) {
    await loadPullRequestDiscussion(updated.number, true);
  }
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
  await Promise.all([
    loadPullRequestChecks(updated.number, true),
    loadPullRequestDiscussion(updated.number, true),
  ]);
}

async function focusIssueRow(issue: GitHubIssue) {
  const issueNumber = issue.number;
  focusedIssueNumber.value = issueNumber;
  await loadIssueDiscussion(issueNumber);
  if (activeSection.value === "issues") {
    focusedIssueNumber.value = issueNumber;
    void pushProjectTabRoute("issues");
  }
}

async function openIssueFromBoard(issue: GitHubIssue) {
  activeSection.value = "issues";
  await focusIssue(issue.number);
  void pushProjectTabRoute("issues");
}

function closeIssueDetail() {
  if (focusedIssueNumber.value || issueDiscussion.value) invalidateSessionContextSnapshot();
  focusedIssueNumber.value = null;
  issueDiscussion.value = null;
  issueDiscussionError.value = null;
  if (activeSection.value === "issues") void pushProjectTabRoute("issues");
}

async function focusPullRequestRow(pull: GitHubPullRequest) {
  const pullNumber = pull.number;
  focusedPullRequestNumber.value = pullNumber;
  await Promise.all([
    loadPullRequestChecks(pullNumber),
    loadPullRequestDiscussion(pullNumber),
  ]);
  if (activeSection.value === "pulls") {
    focusedPullRequestNumber.value = pullNumber;
    void pushProjectTabRoute("pulls");
  }
}

async function openPullRequestFromBoard(pull: GitHubPullRequest) {
  activeSection.value = "pulls";
  await focusPullRequest(pull.number);
  void pushProjectTabRoute("pulls");
}

function closePullRequestDetail() {
  if (focusedPullRequestNumber.value || pullRequestDiscussion.value) invalidateSessionContextSnapshot();
  focusedPullRequestNumber.value = null;
  pullRequestDiscussion.value = null;
  pullRequestDiscussionError.value = null;
  if (activeSection.value === "pulls") void pushProjectTabRoute("pulls");
}

async function openDiscussionTimelineItem(item: GitHubDiscussionTimelineItem) {
  const path = item.path?.trim();
  const line = item.line ?? item.originalLine ?? null;
  if (!path || !line || !canBrowseFiles.value) {
    if (item.url) void openUrl(item.url);
    return;
  }

  try {
    const repoRef = props.fileRepoRef ?? null;
    if (repoRef) await getRepoFilePreview(props.repoId, path, repoRef);
    else await getRepoFilePreview(props.repoId, path);
  } catch {
    if (item.url) void openUrl(item.url);
    return;
  }

  await router.push({
    path: repoRoute(props.repoId, "files"),
    query: {
      file: path,
      hash: `L${line}`,
    },
  });
}

async function openReadmeLink(target: ReadmeLinkTarget) {
  if (target.kind === "external") {
    void openUrl(target.href);
    return;
  }

  if (target.kind === "anchor") {
    await nextTick();
    markdownReadme.value?.scrollToAnchor(target.hash);
    return;
  }

  if (target.kind === "readme" && target.path === README_PATH) {
    if (target.hash) {
      await nextTick();
      markdownReadme.value?.scrollToAnchor(target.hash);
    }
    return;
  }

  if (target.kind === "readme" || target.kind === "file") {
    await router.push({
      path: repoRoute(props.repoId, "files"),
      query: {
        file: target.kind === "file" ? target.relativePath : target.path,
        ...(target.hash ? { hash: target.hash } : {}),
      },
    });
  }
}

async function scrollTerminalToEnd() {
  await nextTick();
  const body = terminalBody.value;
  if (!body) return;
  body.scrollTop = body.scrollHeight;
}

async function activateProjectTab(tab: ProjectTab) {
  activeSection.value = tab;
  if (canUseLaunchWorkflow.value && props.launchTerminalVisible) {
    emit("hideTerminal");
  }
  await pushProjectTabRoute(tab);
  await ensureSectionData(tab);
}

async function activateProjectSidebarButton(tab: ProjectSidebarButtonMode) {
  if (tab === "repo") {
    await activateProjectTab("readme");
    return;
  }
  await activateProjectTab(tab);
}

function focusActionRun(runId: number | null) {
  focusedRunId.value = runId;
  focusedJobId.value = null;
  if (activeSection.value === "actions") void pushProjectTabRoute("actions");
}

function focusActionJob(jobId: number | null) {
  focusedJobId.value = jobId;
  if (activeSection.value === "actions") void pushProjectTabRoute("actions");
}

function upsertReleaseInView(release: GitHubRelease) {
  releases.value = [
    release,
    ...releases.value.filter((item) => item.id !== release.id),
  ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function updateReleaseAssetsInView(releaseId: number, update: (assets: GitHubReleaseAsset[]) => GitHubReleaseAsset[]) {
  releases.value = releases.value.map((release) =>
    release.id === releaseId ? { ...release, assets: update(release.assets) } : release
  );
}

async function createRelease(request: GitHubCreateReleaseRequest) {
  const repoFullName = props.repoFullName;
  if (!repoFullName || releaseCreateTracker.running.value) return;
  const result = await runGitHubMutation(repoFullName, releaseCreateTracker, () =>
    createGitHubRelease(repoFullName, request)
  );
  if (!result.ok) return;
  upsertReleaseInView(result.value);
  releasesLoaded.value = true;
  await focusReleaseTag(result.value.tagName, true);
  clearHomeGitHubOverviewSnapshot();
}

async function updateRelease(releaseId: number, request: GitHubUpdateReleaseRequest) {
  const repoFullName = props.repoFullName;
  if (!repoFullName || releaseUpdateTracker.running.value) return;
  const result = await runGitHubMutation(repoFullName, releaseUpdateTracker, () =>
    updateGitHubRelease(repoFullName, releaseId, request)
  );
  if (!result.ok) return;
  upsertReleaseInView(result.value);
  await focusReleaseTag(result.value.tagName, true);
  clearHomeGitHubOverviewSnapshot();
}

async function removeRelease(release: GitHubRelease) {
  const repoFullName = props.repoFullName;
  if (!repoFullName || releaseDeleteTracker.running.value) return;
  const result = await runGitHubMutation(repoFullName, releaseDeleteTracker, () =>
    deleteGitHubRelease(repoFullName, release.id)
  );
  if (!result.ok) return;
  releases.value = releases.value.filter((item) => item.id !== release.id);
  if (focusedReleaseTag.value === release.tagName) focusedReleaseTag.value = null;
  clearHomeGitHubOverviewSnapshot();
}

async function uploadReleaseAssets(release: GitHubRelease) {
  const repoFullName = props.repoFullName;
  if (!repoFullName || releaseAssetUploadTracker.running.value) return;
  const paths = await pickFiles();
  for (const filePath of paths) {
    const result = await runGitHubMutation(repoFullName, releaseAssetUploadTracker, () =>
      uploadGitHubReleaseAsset(repoFullName, release.id, filePath)
    );
    if (!result.ok) return;
    updateReleaseAssetsInView(release.id, (assets) => [
      result.value,
      ...assets.filter((asset) => asset.id !== result.value.id),
    ]);
  }
}

async function attachWorkflowArtifactAsset(request: GitHubAttachWorkflowArtifactAssetRequest) {
  const repoFullName = props.repoFullName;
  if (!repoFullName || releaseAssetUploadTracker.running.value) return;
  const result = await runGitHubMutation(repoFullName, releaseAssetUploadTracker, () =>
    attachGitHubWorkflowArtifactAsset(repoFullName, request)
  );
  if (!result.ok) return;
  updateReleaseAssetsInView(request.releaseId, (assets) => [
    result.value,
    ...assets.filter((asset) => asset.id !== result.value.id),
  ]);
  clearHomeGitHubOverviewSnapshot();
}

async function removeReleaseAsset(release: GitHubRelease, asset: GitHubReleaseAsset) {
  const repoFullName = props.repoFullName;
  if (!repoFullName || releaseAssetDeleteTracker.running.value) return;
  const result = await runGitHubMutation(repoFullName, releaseAssetDeleteTracker, () =>
    deleteGitHubReleaseAsset(repoFullName, release.id, asset.id)
  );
  if (!result.ok) return;
  updateReleaseAssetsInView(release.id, (assets) => assets.filter((candidate) => candidate.id !== asset.id));
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
      <main
        ref="projectMainRef"
        class="project-main"
        :class="{ 'project-main--plain': activeSection === 'files' || activeSection === 'release' }"
      >
        <section v-if="canUseLaunchWorkflow && activeSection === 'launch'" class="project-terminal-card">
          <div ref="terminalBody" class="project-terminal__body" aria-label="启动终端">
            <div v-if="launchError" class="project-terminal__line project-terminal__line--error">{{ launchError }}</div>
            <pre v-if="launchLogs.length" class="project-terminal__output"><code v-html="terminalHtml"></code></pre>
            <div v-else class="project-terminal__line project-terminal__line--muted">暂无输出。</div>
          </div>
        </section>

        <RepoChangesPanel
          v-else-if="canShowChanges && activeSection === 'changes'"
          :commit-message="commitMessage"
          :changes="changes"
          :discarding-change-paths="discardingChangePaths"
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
          :read-only="historyReadOnly"
          @open-commit="emit('openCommit', $event)"
          @cherry-pick-commit="emit('cherryPickCommit', $event)"
          @revert-commit="emit('revertCommit', $event)"
          @reset-commit="emit('resetCommit', $event.hash, $event.mode)"
          @create-branch-from-commit="emit('createBranchFromCommit', $event)"
        />

        <section v-else-if="activeSection === 'launch'" class="project-section">
          <p class="muted repo-empty project-empty">命令运行仅支持本地仓库。</p>
        </section>

        <RepoFilePreviewPane
          v-else-if="activeSection === 'files' && canBrowseFiles"
          :browser="fileBrowser"
        />

        <section v-else-if="activeSection === 'files'" class="project-section">
          <p class="muted repo-empty project-empty">{{ fileUnavailableMessage }}</p>
        </section>

        <section v-else-if="activeSection === 'readme'" class="project-readme-card">
          <p v-if="readmeLoading" class="muted repo-empty project-empty">正在读取 README。</p>
          <p v-else-if="!readmePreview" class="muted repo-empty project-empty">
            当前仓库没有 README.md。
          </p>
          <MarkdownReadme
            v-else
            ref="markdownReadme"
            :content="readmePreview.content ?? ''"
            :images="readmePreview.images ?? {}"
            :repo-root-path="repoPath"
            :current-readme-path="readmePreview.path"
            :readme-paths="[README_PATH]"
            @open-link="openReadmeLink"
          />
        </section>

        <section v-else-if="githubUnavailableMessage && activeSection !== 'settings'" class="project-section">
          <p class="muted repo-empty project-empty">{{ githubUnavailableMessage }}</p>
        </section>

        <section
          v-else-if="activeSection === 'board'"
          class="project-section project-github-section"
          :class="{ 'project-section--flush': !projectsAccessUnavailable }"
        >
          <RepoGitHubUnavailableNotice
            v-if="projectsAccessUnavailable"
            :title="projectsAccessUnavailable.title"
            :reason="projectsAccessUnavailable.reason"
            :loading="githubAuthLoading"
            @rebind="rebindGitHub"
          />
          <RepoProjectsBoard
            v-else
            v-model:query="boardQuery"
            :items="boardVisibleItems"
            :project-count-total="boardProjectCountTotal"
            :loading-text="boardLoadingText"
            :empty-text="boardEmptyText"
            @open-issue="openIssueFromBoard"
            @open-pull-request="openPullRequestFromBoard"
          />
        </section>

        <section v-else-if="activeSection === 'issues'" class="project-section project-github-section">
          <RepoGitHubUnavailableNotice
            v-if="issuesAccessUnavailable"
            :title="issuesAccessUnavailable.title"
            :reason="issuesAccessUnavailable.reason"
            :loading="githubAuthLoading"
            @rebind="rebindGitHub"
          />
          <form
            v-if="!issuesAccessUnavailable && issueCreateView"
            class="project-create-form"
            aria-label="新建 Issue"
            data-agent-id="repo.issues.form"
            @submit.prevent="createIssue"
          >
            <div class="project-create-form__head">
              <button type="button" class="ghost project-create-back" data-agent-id="repo.issues.form.back" @click="() => closeIssueCreateView()">
                <ArrowLeft :size="14" aria-hidden="true" />
                Issues
              </button>
              <div class="project-create-form__actions">
                <button type="button" class="ghost" data-agent-id="repo.issues.form.cancel" :disabled="creatingIssue" @click="() => closeIssueCreateView()">取消</button>
                <button type="submit" class="primary" data-agent-id="repo.issues.form.save" :disabled="!canSubmitIssueCreate">
                  <LoaderCircle v-if="creatingIssue" :size="14" aria-hidden="true" class="sb-spin" />
                  <Plus v-else :size="14" aria-hidden="true" />
                  创建 Issue
                </button>
              </div>
            </div>
            <div class="project-template-picker">
              <div class="project-template-picker__control">
                <span>模板</span>
                <Dropdown
                  :model-value="issueTemplateKey"
                  :options="issueTemplateOptions"
                  :disabled="issueTemplatesLoading"
                  button-class="project-template-dropdown"
                  menu-width="260px"
                  menu-label="Issue 模板"
                  placement="bottom"
                  agent-id="repo.issues.form.template"
                  @update:model-value="selectIssueTemplate"
                />
              </div>
              <p class="muted">
                {{ issueTemplatesLoading ? "正在读取模板..." : selectedIssueTemplate.description }}
              </p>
            </div>
            <div class="project-create-grid">
              <label class="project-create-field project-create-field--wide">
                <span>标题</span>
                <input v-model="issueTitle" type="text" placeholder="Issue 标题" data-agent-id="repo.issues.form.title" />
              </label>
              <div class="project-create-field">
                <span>标签</span>
                <Dropdown
                  v-model="issueLabels"
                  multiple
                  :options="issueLabelDropdownOptions"
                  :display-label="issueLabelSummary"
                  :placeholder="issueMetadataLoading ? '正在读取标签...' : '无标签'"
                  button-class="project-template-dropdown"
                  menu-width="220px"
                  menu-label="标签"
                  placement="bottom"
                  agent-id="repo.issues.form.labels"
                  :disabled="issueMetadataLoading && !issueLabelOptions.length"
                />
              </div>
              <div class="project-create-field">
                <span>负责人</span>
                <Dropdown
                  v-model="issueAssignees"
                  multiple
                  :options="issueAssigneeDropdownOptions"
                  :display-label="issueAssigneeSummary"
                  :placeholder="issueMetadataLoading ? '正在读取负责人...' : '未分配'"
                  button-class="project-template-dropdown"
                  menu-width="220px"
                  menu-label="负责人"
                  placement="bottom"
                  agent-id="repo.issues.form.assignees"
                  :disabled="issueMetadataLoading && !issueAssigneeOptions.length"
                />
              </div>
            </div>
            <div v-if="selectedIssueTemplate.kind === 'form'" class="project-template-fields">
              <p v-for="field in issueTemplateMarkdownFields" :key="field.id" class="project-template-note">
                {{ field.value }}
              </p>
              <label
                v-for="field in issueTemplateFields"
                :key="field.id"
                class="project-create-field project-create-field--wide"
              >
                <span>{{ field.label }}<em v-if="'required' in field && field.required">*</em></span>
                <small v-if="'description' in field && field.description">{{ field.description }}</small>
                <textarea
                  v-if="field.type === 'textarea'"
                  :value="issueFieldValue(field)"
                  rows="5"
                  :placeholder="field.placeholder"
                  :data-agent-id="`repo.issues.form.field.${field.id}`"
                  @input="setIssueFieldValue(field.id, targetValue($event))"
                ></textarea>
                <Dropdown
                  v-else-if="field.type === 'dropdown'"
                  :model-value="issueFieldValue(field)"
                  :options="dropdownOptions(field.options)"
                  button-class="project-template-dropdown"
                  menu-width="220px"
                  :menu-label="field.label"
                  placement="bottom"
                  :agent-id="`repo.issues.form.field.${field.id}`"
                  @update:model-value="(value) => setIssueFieldValue(field.id, value)"
                />
                <div v-else-if="field.type === 'checkboxes'" class="project-checkbox-list">
                  <label v-for="option in field.options" :key="option.label" class="project-check">
                    <input
                      type="checkbox"
                      :checked="issueCheckboxChecked(field.id, option.label)"
                      :data-agent-id="`repo.issues.form.field.${field.id}.${option.label}`"
                      @change="toggleIssueCheckbox(field.id, option.label, targetChecked($event))"
                    />
                    <span>{{ option.label }}<em v-if="option.required">*</em></span>
                  </label>
                </div>
                <input
                  v-else
                  type="text"
                  :value="issueFieldValue(field)"
                  :placeholder="field.placeholder"
                  :data-agent-id="`repo.issues.form.field.${field.id}`"
                  @input="setIssueFieldValue(field.id, targetValue($event))"
                />
              </label>
            </div>
            <label v-else class="project-create-field project-create-field--wide">
              <span>内容</span>
              <textarea v-model="issueBody" rows="7" placeholder="填写 Issue 内容" data-agent-id="repo.issues.form.body"></textarea>
            </label>
          </form>
          <RepoIssuesPanel
            v-if="!issuesAccessUnavailable && !issueCreateView"
            :issues="issues"
            :state="issueState"
            :filters="issuePanelFilters"
            :metadata="issueFilterMetadata"
            :metadata-loading="issueFilterMetadataLoading"
            :loading="githubLoading"
            :updating="updatingIssue"
            :editing-issue-number="editingIssueNumber"
            v-model:editing-title="editingIssueTitle"
            v-model:editing-labels="editingIssueLabels"
            v-model:editing-assignees="editingIssueAssignees"
            v-model:editing-body="editingIssueBody"
            :focused-issue-number="focusedIssueNumber"
            :issue-timeline="issueDiscussion?.timeline ?? []"
            :issue-discussion-loading="issueDiscussionLoading"
            :issue-discussion-error="issueDiscussionError"
            :repo-full-name="repoFullName ?? ''"
            :is-focused="isIssueRowFocused"
            :timeline-item-opener="openDiscussionTimelineItem"
            @update:state="setIssueState"
            @update:filters="setIssuePanelFilters"
            @create="openIssueCreateView"
            @edit="startEditIssue"
            @focus="focusIssueRow"
            @back="closeIssueDetail"
            @cancel-edit="cancelEditIssue"
            @save-edit="saveIssueEdit"
            @toggle="toggleIssue"
          />
        </section>

        <section v-else-if="activeSection === 'pulls'" class="project-section project-github-section">
          <RepoGitHubUnavailableNotice
            v-if="pullsAccessUnavailable"
            :title="pullsAccessUnavailable.title"
            :reason="pullsAccessUnavailable.reason"
            :loading="githubAuthLoading"
            @rebind="rebindGitHub"
          />
          <form
            v-if="!pullsAccessUnavailable && pullCreateView"
            class="project-create-form"
            aria-label="新建 PR"
            data-agent-id="repo.pulls.form"
            @submit.prevent="createPullRequest"
          >
            <div class="project-create-form__head">
              <button type="button" class="ghost project-create-back" data-agent-id="repo.pulls.form.back" @click="() => closePullRequestCreateView()">
                <ArrowLeft :size="14" aria-hidden="true" />
                Pull Requests
              </button>
              <div class="project-create-form__actions">
                <button type="button" class="ghost" data-agent-id="repo.pulls.form.cancel" :disabled="creatingPullRequest" @click="() => closePullRequestCreateView()">
                  取消
                </button>
                <button type="submit" class="primary" data-agent-id="repo.pulls.form.save" :disabled="!canSubmitPullRequestCreate">
                  <LoaderCircle v-if="creatingPullRequest" :size="14" aria-hidden="true" class="sb-spin" />
                  <GitPullRequest v-else :size="14" aria-hidden="true" />
                  创建 PR
                </button>
              </div>
            </div>
            <div class="project-template-picker">
              <div class="project-template-picker__control">
                <span>模板</span>
                <Dropdown
                  :model-value="pullRequestTemplateKey"
                  :options="pullRequestTemplateOptions"
                  :disabled="pullRequestTemplatesLoading"
                  button-class="project-template-dropdown"
                  menu-width="260px"
                  menu-label="PR 模板"
                  placement="bottom"
                  agent-id="repo.pulls.form.template"
                  @update:model-value="selectPullRequestTemplate"
                />
              </div>
              <p class="muted">
                {{ pullRequestTemplatesLoading ? "正在读取模板..." : selectedPullRequestTemplate.description }}
              </p>
            </div>
            <div class="project-create-grid">
              <label class="project-create-field project-create-field--wide">
                <span>标题</span>
                <input v-model="pullRequestTitle" type="text" placeholder="PR 标题" data-agent-id="repo.pulls.form.title" />
              </label>
              <label class="project-create-field">
                <span>来源分支</span>
                <input v-model="pullRequestHead" type="text" placeholder="feature/my-change" data-agent-id="repo.pulls.form.head" />
              </label>
              <label class="project-create-field">
                <span>目标分支</span>
                <input v-model="pullRequestBase" type="text" placeholder="main" data-agent-id="repo.pulls.form.base" />
              </label>
              <label class="project-create-switch ui-switch">
                <span class="project-create-switch__content">
                  <strong>草稿</strong>
                </span>
                <input v-model="pullRequestDraft" class="ui-switch__input" type="checkbox" data-agent-id="repo.pulls.form.draft" />
                <span class="ui-switch__track" aria-hidden="true"></span>
              </label>
            </div>
            <label class="project-create-field project-create-field--wide">
              <span>描述</span>
              <textarea v-model="pullRequestBody" rows="7" placeholder="描述本次变更" data-agent-id="repo.pulls.form.body"></textarea>
            </label>
          </form>
          <RepoPullRequestsPanel
            v-if="!pullsAccessUnavailable && !pullCreateView"
            :pulls="pulls"
            :state="pullState"
            :filters="pullRequestPanelFilters"
            :metadata="issueFilterMetadata"
            :metadata-loading="issueFilterMetadataLoading"
            :loading="pullsLoading"
            :checks-loading="pullChecksLoading"
            :discussion-loading="pullRequestDiscussionLoading"
            :discussion-error="pullRequestDiscussionError"
            :discussion-timeline="pullRequestDiscussion?.timeline ?? []"
            :updating="updatingPullRequest"
            :focused-pull-request-number="focusedPullRequestNumber"
            :focused-pull-request-detail="pullRequestDiscussion?.pullRequest ?? null"
            :pull-checks="pullChecks"
            :repo-full-name="repoFullName ?? ''"
            v-model:merge-method="pullRequestMergeMethod"
            :is-focused="isPullRequestRowFocused"
            :timeline-item-opener="openDiscussionTimelineItem"
            @update:state="setPullRequestState"
            @update:filters="setPullRequestPanelFilters"
            @create="openPullRequestCreateView"
            @back="closePullRequestDetail"
            @focus="focusPullRequestRow"
            @merge="mergePullRequest"
          />
        </section>

        <section v-else-if="activeSection === 'actions'" class="project-section project-github-section">
          <RepoGitHubUnavailableNotice
            v-if="actionsAccessUnavailable"
            :title="actionsAccessUnavailable.title"
            :reason="actionsAccessUnavailable.reason"
            :loading="githubAuthLoading"
            @rebind="rebindGitHub"
          />
          <RepoActionsPanel
            v-else-if="repoFullName"
            :repo-full-name="repoFullName"
            :runs="workflowRuns"
            :loading="actionsLoading"
            :focused-run-id="focusedRunId"
            :focused-job-id="focusedJobId"
            :draft-releases="draftReleases"
            :attach-asset-mutating="releaseAssetUploadTracker.running.value"
            @focus-run="focusActionRun"
            @focus-job="focusActionJob"
            @refresh="refreshActionsPanel"
            @attach-artifact-asset="attachWorkflowArtifactAsset"
          />
        </section>

        <section v-else-if="activeSection === 'release'" class="project-section project-github-section project-section--flush">
          <RepoGitHubUnavailableNotice
            v-if="releasesAccessUnavailable"
            :title="releasesAccessUnavailable.title"
            :reason="releasesAccessUnavailable.reason"
            :loading="githubAuthLoading"
            @rebind="rebindGitHub"
          />
          <RepoReleasesPanel
            v-else-if="repoFullName"
            ref="repoReleasesPanel"
            :repo-full-name="repoFullName"
            :releases="releases"
            :loading="releasesLoading"
            :mutating="releaseMutating"
            :focused-tag="focusedReleaseTag"
            :release-type-filter="releaseTypeFilter"
            @create="createRelease"
            @update="updateRelease"
            @delete="removeRelease"
            @upload-assets="uploadReleaseAssets"
            @delete-asset="removeReleaseAsset"
            @open-url="openUrl"
          />
        </section>

        <form v-else-if="activeSection === 'settings'" class="project-section project-settings project-github-section" data-agent-id="repo.settings.form" @submit.prevent="saveSettings()">
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
                data-agent-id="repo.settings.save"
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
          <template v-if="settings">
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
                  <input v-model="settingsForm[switchItem.key]" class="ui-switch__input" type="checkbox" :data-agent-id="`repo.settings.feature.${switchItem.key}`" />
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
                  <input v-model="settingsForm[switchItem.key]" class="ui-switch__input" type="checkbox" :data-agent-id="`repo.settings.merge.${switchItem.key}`" />
                  <span class="ui-switch__track" aria-hidden="true"></span>
                </label>
              </div>
            </section>
          </template>
          <div v-if="(canDeleteLocal && repoPath) || (canDeleteRemote && settings)" class="project-settings-danger-list">
            <section v-if="canDeleteLocal && repoPath" class="project-danger-zone" aria-label="本地危险操作">
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
                :data-agent-id="linkedWorktree ? 'repo.settings.delete-worktree' : 'repo.settings.delete-local'"
                :disabled="deletingLocalRepo"
                :aria-label="linkedWorktree ? '删除工作树' : '删除本地'"
                :title="linkedWorktree ? '删除工作树' : '删除本地'"
                @click="openDeleteDialog('local')"
              >
                <LoaderCircle v-if="deletingLocalRepo" :size="14" aria-hidden="true" class="sb-spin" />
                <Trash2 v-else :size="14" aria-hidden="true" />
              </button>
            </section>
            <section v-if="canDeleteRemote && settings" class="project-danger-zone" aria-label="远端危险操作">
              <div>
                <strong>删除 GitHub 远端仓库</strong>
                <span>只删除 GitHub 上的远端仓库，不删除本地目录。</span>
              </div>
              <button
                type="button"
                class="ghost danger project-icon-action"
                data-agent-id="repo.settings.delete-remote"
                :disabled="deletingRepo || githubLoading || !settings || !repoFullName || !canDeleteRemote"
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
                      data-agent-id="repo.delete.confirm-input"
                      :placeholder="deleteExpectedInput ?? ''"
                      :disabled="deletingAnything"
                    />
                  </label>
                  <div class="project-delete-dialog__actions">
                    <button type="button" class="ghost" data-agent-id="repo.delete.cancel" :disabled="deletingAnything" @click="closeDeleteDialog">
                      取消
                    </button>
                    <button
                      type="button"
                      class="ghost danger"
                      data-agent-id="repo.delete.confirm"
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

      <aside
        v-if="showProjectSidebar"
        class="project-sidebar"
        :class="{ 'project-sidebar--fill': projectSidebarMode === 'files' && !hasProjectSidebarErrors }"
      >
        <div
          v-if="projectSidebarMode !== 'files'"
          class="project-sidebar-switcher"
          role="tablist"
          aria-label="右侧面板"
        >
          <button
            v-for="tab in projectSidebarButtons"
            :key="tab.key"
            type="button"
            class="project-sidebar-switcher__button"
            :class="{ 'is-active': isProjectSidebarButtonActive(tab.key) }"
            role="tab"
            :data-agent-id="`repo.project.sidebar.${tab.key}`"
            :aria-selected="isProjectSidebarButtonActive(tab.key)"
            :aria-label="tab.label"
            :title="tab.label"
            :disabled="tab.disabled"
            @click="activateProjectSidebarButton(tab.key)"
          >
            <component :is="tab.icon" :size="15" aria-hidden="true" />
          </button>
        </div>

        <section
          v-if="hasProjectSidebarErrors"
          class="project-sidebar-error-card"
          aria-label="仓库错误"
        >
          <div
            v-for="error in projectSidebarErrors"
            :key="error.key"
            class="project-sidebar-error-card__item"
          >
            <AlertCircle :size="15" aria-hidden="true" />
            <div>
              <strong>{{ error.title }}</strong>
              <p>{{ error.message }}</p>
              <p class="project-sidebar-error-card__guidance">
                {{ error.guidance.title }}：{{ error.guidance.steps.join(" / ") }}
              </p>
            </div>
            <button
              v-if="error.retry === 'sync'"
              type="button"
              class="ghost project-icon-action project-sidebar-error-card__retry"
              :disabled="error.retrying || actionRunning"
              aria-label="重试"
              title="重试"
              @click="emit('retrySync')"
            >
              <LoaderCircle v-if="error.retrying" :size="14" aria-hidden="true" class="sb-spin" />
              <RotateCw v-else :size="14" aria-hidden="true" />
            </button>
          </div>
        </section>

        <section v-if="repoFullName && !hasProjectSidebarErrors && projectSidebarMode === 'repo'" class="project-about-card" aria-label="仓库描述">
          <button
            v-if="!aboutEditing"
            type="button"
            class="ghost project-icon-action project-about-edit"
            data-agent-id="repo.about.edit"
            :disabled="githubLoading || savingSettings"
            aria-label="编辑仓库描述"
            title="编辑"
            @click="startEditAbout"
          >
            <LoaderCircle v-if="githubLoading && !settings" :size="14" aria-hidden="true" class="sb-spin" />
            <Pencil v-else :size="14" aria-hidden="true" />
          </button>
          <form v-if="aboutEditing" class="project-about-form" data-agent-id="repo.about.form" @submit.prevent="saveSettings(true)">
            <textarea v-model="settingsForm.description" rows="3" placeholder="Description" data-agent-id="repo.about.form.description"></textarea>
            <input v-model="settingsForm.homepage" type="url" placeholder="Homepage" data-agent-id="repo.about.form.homepage" />
            <RepoTopicEditor v-model="settingsForm.topics" v-model:draft="aboutTopicDraft" agent-id-prefix="repo.about.form.topics" />
            <div class="project-about-form__actions">
              <button type="button" class="ghost project-icon-action" data-agent-id="repo.about.form.cancel" :disabled="savingSettings" aria-label="取消" title="取消" @click="cancelEditAbout">
                <X :size="14" aria-hidden="true" />
              </button>
              <button type="submit" class="primary project-icon-action project-icon-action--primary" data-agent-id="repo.about.form.save" :disabled="savingSettings" aria-label="保存" title="保存">
                <LoaderCircle v-if="savingSettings" :size="14" aria-hidden="true" class="sb-spin" />
                <Save v-else :size="14" aria-hidden="true" />
              </button>
            </div>
          </form>
          <div v-else class="project-about-summary">
            <p v-if="githubLoading && !settings" class="muted">正在读取仓库描述。</p>
            <template v-else>
              <p :class="{ 'is-empty': !aboutDescription }">{{ aboutDescription || "No description provided." }}</p>
              <a v-if="aboutHomepage" :href="aboutHomepageHref" target="_blank" rel="noreferrer">
                <ExternalLink :size="13" aria-hidden="true" />
                <span>{{ aboutHomepage }}</span>
              </a>
              <div v-if="aboutTopics.length" class="project-topic-block">
                <div
                  ref="aboutTopicList"
                  class="project-topic-list"
                  :class="{ 'is-collapsed': aboutTopicsOverflowing && !aboutTopicsExpanded }"
                  aria-label="Topics"
                >
                  <span v-for="topic in displayedAboutTopics" :key="topic" class="project-topic-pill">{{ topic }}</span>
                  <button
                    v-if="aboutTopicsOverflowing"
                    type="button"
                    class="project-topic-toggle"
                    :aria-expanded="aboutTopicsExpanded"
                    @click="toggleAboutTopicsExpanded"
                  >
                    {{ aboutTopicsExpanded ? "收起" : "展开" }}
                  </button>
                </div>
                <div
                  ref="aboutTopicMeasureList"
                  class="project-topic-list project-topic-list--measure"
                  aria-hidden="true"
                >
                  <span v-for="topic in aboutTopics" :key="topic" class="project-topic-pill">{{ topic }}</span>
                </div>
              </div>
              <div
                v-if="aboutLicenseText || aboutStats.length"
                class="project-about-stats"
                aria-label="GitHub 仓库信息"
              >
                <div
                  v-if="aboutLicenseText"
                  class="project-about-stat"
                  :title="aboutLicenseText"
                  :aria-label="aboutLicenseText"
                >
                  <Scale :size="14" aria-hidden="true" />
                  <span>{{ aboutLicenseText }}</span>
                </div>
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

        <RepoFileTreeCard
          v-if="!hasProjectSidebarErrors && projectSidebarMode === 'files' && canBrowseFiles"
          :browser="fileBrowser"
        />

        <section
          v-else-if="!hasProjectSidebarErrors && projectSidebarMode === 'files'"
          class="project-sidebar-summary-card"
          aria-label="文件树摘要"
        >
          <div class="project-sidebar-summary-card__head">
            <FolderTree :size="14" aria-hidden="true" />
            <strong>文件树</strong>
          </div>
          <p>{{ fileUnavailableMessage }}</p>
        </section>

        <RepoProjectsBoardSidebar
          v-if="!hasProjectSidebarErrors && projectSidebarMode === 'board'"
          v-model:type-filter="boardTypeFilter"
          v-model:state-filter="boardStateFilter"
          v-model:project-filter="boardProjectFilter"
          :project-filter-options="boardProjectFilterOptions"
          :base-item-count="boardBaseFilteredItems.length"
          :visible-item-count="boardVisibleItems.length"
          :issue-count="boardIssueCount"
          :pull-count="boardPullCount"
          :project-count-total="boardProjectCountTotal"
          :loading="boardLoading"
          :metadata-loading="issueFilterMetadataLoading"
          @refresh="refreshLoadedSectionData"
        />

        <RepoGitHubDetailSidebar
          v-if="!hasProjectSidebarErrors && projectSidebarMode === 'issues' && focusedIssueDetail"
          :issue="focusedIssueDetail"
          :updating-issue="updatingIssue"
          @open-issue="(issue) => openUrl(issue.htmlUrl)"
          @edit-issue="startEditIssue"
          @toggle-issue="toggleIssue"
        />

        <section
          v-else-if="!hasProjectSidebarErrors && projectSidebarMode === 'issues'"
          class="project-sidebar-summary-card"
          aria-label="Issues 摘要"
        >
          <div class="project-sidebar-summary-card__head">
            <CircleDot :size="14" aria-hidden="true" />
            <strong>Issues</strong>
          </div>
          <dl class="project-sidebar-summary-card__stats">
            <div>
              <dt>状态</dt>
              <dd>{{ issueState }}</dd>
            </div>
            <div>
              <dt>已加载</dt>
              <dd>{{ issues.length }}</dd>
            </div>
            <div v-if="issuePanelFilters.query">
              <dt>搜索</dt>
              <dd>{{ issuePanelFilters.query }}</dd>
            </div>
            <div v-if="issuePanelFilters.labels.length">
              <dt>标签</dt>
              <dd>{{ issuePanelFilters.labels.join(', ') }}</dd>
            </div>
          </dl>
          <button
            type="button"
            class="ghost project-sidebar-summary-card__action"
            aria-label="侧栏新建 Issue"
            data-agent-id="repo.issues.sidebar.create"
            :disabled="issueCreateView || creatingIssue || !!issuesAccessUnavailable"
            @click="openIssueCreateView"
          >
            <Plus :size="14" aria-hidden="true" />
            新建
          </button>
        </section>

        <RepoGitHubDetailSidebar
          v-if="!hasProjectSidebarErrors && projectSidebarMode === 'pulls' && focusedPullRequestDetail"
          :pull="focusedPullRequestDetail"
          :updating-pull-request="updatingPullRequest"
          @open-pull-request="(pull) => openUrl(pull.htmlUrl)"
          @toggle-pull-request="togglePullRequestState"
        />

        <section
          v-else-if="!hasProjectSidebarErrors && projectSidebarMode === 'pulls'"
          class="project-sidebar-summary-card"
          aria-label="Pull Requests 摘要"
        >
          <div class="project-sidebar-summary-card__head">
            <GitPullRequest :size="14" aria-hidden="true" />
            <strong>Pull Requests</strong>
          </div>
          <dl class="project-sidebar-summary-card__stats">
            <div>
              <dt>状态</dt>
              <dd>{{ pullState }}</dd>
            </div>
            <div>
              <dt>已加载</dt>
              <dd>{{ pulls.length }}</dd>
            </div>
            <div v-if="focusedPullRequestNumber">
              <dt>焦点</dt>
              <dd>#{{ focusedPullRequestNumber }}</dd>
            </div>
            <div v-if="pullRequestPanelFilters.query">
              <dt>搜索</dt>
              <dd>{{ pullRequestPanelFilters.query }}</dd>
            </div>
          </dl>
          <button
            type="button"
            class="ghost project-sidebar-summary-card__action"
            aria-label="侧栏新建 PR"
            data-agent-id="repo.pulls.sidebar.create"
            :disabled="pullCreateView || creatingPullRequest || !!pullsAccessUnavailable"
            @click="openPullRequestCreateView"
          >
            <GitPullRequest :size="14" aria-hidden="true" />
            新建
          </button>
        </section>

        <section
          v-if="!hasProjectSidebarErrors && projectSidebarMode === 'actions'"
          class="project-sidebar-summary-card"
          aria-label="Actions 摘要"
        >
          <div class="project-sidebar-summary-card__head">
            <Play :size="14" aria-hidden="true" />
            <strong>Actions</strong>
          </div>
          <dl class="project-sidebar-summary-card__stats">
            <div>
              <dt>已加载</dt>
              <dd>{{ workflowRuns.length }}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{{ actionsLoading ? "读取中" : actionsLoaded ? "已同步" : "未读取" }}</dd>
            </div>
            <div v-if="focusedRunId">
              <dt>Run</dt>
              <dd>#{{ focusedRunId }}</dd>
            </div>
          </dl>
          <button
            type="button"
            class="ghost project-sidebar-summary-card__action"
            data-agent-id="repo.actions.sidebar.refresh"
            :disabled="actionsLoading || !!actionsAccessUnavailable"
            @click="loadActions(true)"
          >
            <RotateCw :size="14" aria-hidden="true" />
            刷新 Actions
          </button>
        </section>

        <section
          v-if="!hasProjectSidebarErrors && projectSidebarMode === 'release'"
          class="project-sidebar-summary-card project-release-filters-card"
          aria-label="Release 筛选"
        >
          <div class="project-sidebar-summary-card__head">
            <Package :size="14" aria-hidden="true" />
            <strong>Release 筛选</strong>
          </div>
          <div class="project-sidebar-summary-card__actions">
            <button
              type="button"
              class="primary project-sidebar-summary-card__action"
              data-agent-id="repo.release.create"
              :disabled="releaseMutating || !!releasesAccessUnavailable"
              @click="repoReleasesPanel?.openCreate()"
            >
              <Plus :size="14" aria-hidden="true" />
              新建 Release
            </button>
            <button
              type="button"
              class="ghost project-sidebar-summary-card__action"
              data-agent-id="repo.release.refresh"
              :disabled="releasesLoading || !!releasesAccessUnavailable"
              @click="loadReleases(true)"
            >
              <LoaderCircle v-if="releasesLoading" :size="14" aria-hidden="true" class="sb-spin" />
              <RotateCw v-else :size="14" aria-hidden="true" />
              刷新 Release
            </button>
          </div>
          <button
            type="button"
            class="ghost project-release-filter-clear"
            data-agent-id="repo.release.filters.clear"
            :disabled="activeReleaseFilterCount === 0"
            @click="clearReleaseFilters"
          >
            清除筛选
            <span v-if="activeReleaseFilterCount">{{ activeReleaseFilterCount }}</span>
          </button>
          <p v-if="releasesLoading" class="project-sidebar-note">正在读取 releases。</p>
          <template v-else>
            <div class="project-release-filter-group">
              <h4>类型</h4>
              <div class="project-release-type-list" aria-label="Release 类型筛选">
                <button
                  v-for="filter in releaseTypeFilters"
                  :key="filter.value"
                  type="button"
                  class="project-release-type-filter"
                  :data-agent-id="`repo.release.filters.type.${filter.value}`"
                  :class="{ 'is-active': releaseTypeFilter === filter.value }"
                  @click="setReleaseTypeFilter(filter.value)"
                >
                  {{ filter.label }}
                </button>
              </div>
            </div>
            <div class="project-release-filter-group">
              <h4>Tag</h4>
              <p v-if="!releaseFilterTags.length" class="project-sidebar-note">暂无 release tag。</p>
              <nav v-else class="project-release-tag-list" aria-label="Release tag 筛选">
                <button
                  v-for="release in releaseFilterTags"
                  :key="release.id"
                  type="button"
                  class="project-release-tag"
                  :data-agent-id="`repo.release.filters.tag.${release.tagName}`"
                  :class="[`is-${release.type}`, { 'is-active': focusedReleaseTag === release.tagName }]"
                  @click="focusReleaseTag(release.tagName, true)"
                >
                  <span>{{ release.tagName }}</span>
                  <em>{{ release.type === "prerelease" ? "Pre" : release.type }}</em>
                </button>
              </nav>
            </div>
          </template>
        </section>

        <section
          v-if="!hasProjectSidebarErrors && projectSidebarMode === 'settings'"
          class="project-sidebar-summary-card"
          aria-label="Settings 摘要"
        >
          <div class="project-sidebar-summary-card__head">
            <Settings2 :size="14" aria-hidden="true" />
            <strong>Settings</strong>
          </div>
          <dl class="project-sidebar-summary-card__stats">
            <div>
              <dt>仓库</dt>
              <dd>{{ settings ? settings.fullName : repoFullName || repoId }}</dd>
            </div>
            <div v-if="settings">
              <dt>可见性</dt>
              <dd>{{ settings.private ? "Private" : "Public" }}</dd>
            </div>
            <div v-if="settings">
              <dt>Default</dt>
              <dd>{{ settings.defaultBranch }}</dd>
            </div>
          </dl>
        </section>

        <RepoLanguageStatsCard
          v-if="!hasProjectSidebarErrors && projectSidebarMode === 'repo'"
          :repo="repoSummary ?? null"
          :show-line-counts="resolvedRepoContext.capabilities.open.available"
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

.project-main--plain {
  border: 0;
  border-radius: 0;
  background: transparent;
}

.project-main :deep(.error-line) {
  display: none;
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

.project-section--flush {
  padding: 0;
}

.project-terminal-card {
  display: grid;
  align-self: stretch;
  min-width: 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-radius: 0;
}

.project-terminal__body {
  display: grid;
  align-content: start;
  min-height: 0;
  height: 100%;
  overflow: auto;
  padding: 14px 16px;
  color: var(--text);
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
  color: var(--err);
}

.project-terminal__line--muted {
  color: var(--text-muted);
}

.project-terminal__output {
  max-height: none;
  margin: 0;
  border: 0;
  border-radius: 0;
  padding: 0;
  background: transparent;
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
  grid-column: 2;
  grid-row: 1;
  gap: 14px;
  min-width: 0;
  min-height: 0;
  align-content: start;
  align-self: start;
}

.project-sidebar--fill {
  grid-template-rows: minmax(0, 1fr);
  align-content: stretch;
  align-self: stretch;
  height: 100%;
}

.project-sidebar-switcher {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  height: 36px;
  padding: 3px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
}

.project-sidebar-switcher__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 0;
  min-width: 0;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.project-sidebar-switcher__button:hover:not(:disabled),
.project-sidebar-switcher__button:focus-visible {
  background: var(--bg-hover);
  color: var(--text);
}

.project-sidebar-switcher__button.is-active {
  background: var(--accent-soft);
  color: var(--accent);
}

.project-sidebar-switcher__button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.project-sidebar-error-card {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--err-soft);
  border-radius: var(--radius-md);
  background: var(--err-soft);
}

.project-sidebar-error-card__item {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: start;
  gap: 8px;
  min-width: 0;
  color: var(--err);
}

.project-sidebar-error-card__item > div {
  min-width: 0;
}

.project-sidebar-error-card__item strong,
.project-sidebar-error-card__item p {
  display: block;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.project-sidebar-error-card__item strong {
  color: var(--err);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.25;
}

.project-sidebar-error-card__item p {
  margin-top: 3px;
  color: var(--err);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
}

.project-sidebar-error-card__guidance {
  color: var(--text-muted) !important;
  font-weight: 500;
}

.project-sidebar-error-card__retry {
  color: var(--err);
}

.project-sidebar-error-card__retry:hover:not(:disabled) {
  background: color-mix(in srgb, var(--err) 16%, transparent);
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
  opacity: 0.62;
  pointer-events: auto;
  transition: opacity 0.12s ease;
}

.project-about-card:hover .project-about-edit,
.project-about-card:focus-within .project-about-edit {
  opacity: 1;
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

.project-topic-block {
  position: relative;
  display: grid;
  gap: 6px;
  min-width: 0;
}

.project-topic-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-top: 1px;
}

.project-topic-list.is-collapsed {
  max-height: 46px;
  overflow: hidden;
}

.project-topic-list--measure {
  position: absolute;
  inset: 0 0 auto;
  visibility: hidden;
  pointer-events: none;
  z-index: -1;
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

.project-topic-toggle {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  height: 22px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  line-height: 22px;
}

.project-topic-toggle:hover,
.project-topic-toggle:focus-visible {
  background: var(--accent-soft);
}

.project-layout--with-commit-detail .project-sidebar {
  grid-row: 1 / span 2;
}

.project-sidebar-summary-card {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
}

.project-sidebar-summary-card__head {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--text);
  font-size: 12px;
}

.project-sidebar-summary-card__head strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 700;
}

.project-sidebar-summary-card p {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.project-sidebar-summary-card__stats {
  display: grid;
  gap: 7px;
  min-width: 0;
  margin: 0;
}

.project-sidebar-summary-card__stats div {
  display: grid;
  grid-template-columns: minmax(58px, max-content) minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.project-sidebar-summary-card__stats dt,
.project-sidebar-summary-card__stats dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-sidebar-summary-card__stats dt {
  color: var(--text-muted);
}

.project-sidebar-summary-card__stats dd {
  color: var(--text);
  font-weight: 600;
}

.project-sidebar-summary-card__action {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 9px;
  font-size: 12px;
}

.project-sidebar-summary-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.project-release-tag-list {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.project-release-filter-clear {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
  padding: 0 8px;
  border-color: var(--border-soft);
  color: var(--text-muted);
  font-size: 12px;
}

.project-release-filter-clear span {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
}

.project-release-filter-group {
  display: grid;
  gap: 7px;
  min-width: 0;
  padding-top: 10px;
  border-top: 1px solid var(--border-soft);
}

.project-release-filter-group h4 {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.project-release-type-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.project-release-type-filter {
  min-height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}

.project-release-type-filter:hover,
.project-release-type-filter:focus-visible,
.project-release-type-filter.is-active {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent-soft) 42%, transparent);
  color: var(--accent);
}

.project-release-tag {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 28px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  text-align: left;
}

.project-release-tag:hover,
.project-release-tag:focus-visible,
.project-release-tag.is-active {
  border-color: color-mix(in srgb, var(--release-filter-color, var(--accent)) 45%, var(--border));
  background: var(--bg-hover);
  color: var(--text);
}

.project-release-tag.is-stable {
  --release-filter-color: var(--ok);
}

.project-release-tag.is-latest {
  --release-filter-color: var(--accent);
}

.project-release-tag.is-prerelease {
  --release-filter-color: var(--warn);
}

.project-release-tag.is-draft {
  --release-filter-color: var(--text-muted);
}

.project-release-tag span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.project-release-tag em {
  color: var(--text-muted);
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
  text-transform: uppercase;
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

.project-create-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 10px;
  font-size: 12px;
}

.project-create-form {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 0 0 10px;
}

.project-create-form__head,
.project-create-form__actions,
.project-create-back {
  display: flex;
  align-items: center;
  gap: 8px;
}

.project-create-form__head {
  justify-content: space-between;
}

.project-create-form__actions button,
.project-create-back {
  min-height: 30px;
  padding: 0 10px;
  font-size: 12px;
}

.project-create-form__actions .primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.project-template-picker {
  display: grid;
  grid-template-columns: minmax(180px, 260px) minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-soft);
}

.project-template-picker__control {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.project-template-picker__control > span {
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.project-template-picker p {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.project-template-picker :deep(.dd),
.project-create-field :deep(.dd) {
  width: 100%;
}

.project-template-picker :deep(.project-template-dropdown),
.project-create-field :deep(.project-template-dropdown) {
  width: 100%;
  height: 30px;
  justify-content: space-between;
  border-color: var(--border-strong);
  color: var(--text);
}

.project-template-picker :deep(.project-template-dropdown .chat-chip__label),
.project-create-field :deep(.project-template-dropdown .chat-chip__label) {
  max-width: none;
}

.project-create-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(140px, 180px) minmax(140px, 180px);
  align-items: end;
  gap: 8px;
  min-width: 0;
}

.project-create-field {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.project-create-field--wide {
  grid-column: 1 / -1;
}

.project-create-field span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.project-create-field em {
  color: var(--err);
  font-style: normal;
}

.project-create-field small {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.4;
}

.project-create-field textarea {
  min-height: 112px;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text);
  font: inherit;
  line-height: 1.5;
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  resize: vertical;
}

.project-create-field textarea:focus {
  outline: none;
  border-color: var(--border-strong);
  background: var(--bg);
}

.project-create-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  align-self: end;
  min-height: 32px;
  padding: 6px 10px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
}

.project-create-switch__content {
  min-width: 0;
}

.project-create-switch__content strong {
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.project-template-fields {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.project-template-note {
  margin: 0;
  padding: 8px 10px;
  border-left: 3px solid var(--accent);
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.project-checkbox-list {
  display: grid;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
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

.project-row__status {
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

.project-row.is-target {
  box-shadow: inset 3px 0 0 var(--accent);
  background: color-mix(in srgb, var(--accent-soft) 28%, transparent);
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
  .project-template-picker,
  .project-create-grid,
  .project-settings-fields,
  .project-row {
    grid-template-columns: 1fr;
  }

  .project-row__status {
    display: none;
  }

  .project-danger-zone {
    grid-template-columns: 1fr;
  }
}
</style>

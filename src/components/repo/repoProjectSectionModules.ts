import { createCachedAsyncComponent } from "../../utils/asyncComponent";

export type RepoProjectSectionKey =
  | "launch"
  | "changes"
  | "history"
  | "files"
  | "readme"
  | "issues"
  | "pulls"
  | "discussions"
  | "actions"
  | "release"
  | "settings";

const commitDetailCardModule = createCachedAsyncComponent(() => import("./CommitDetailCard.vue"));
const repoLaunchTerminalPanelModule = createCachedAsyncComponent(() => import("./RepoLaunchTerminalPanel.vue"));
const markdownReadmeModule = createCachedAsyncComponent(() => import("./MarkdownReadme.vue"));
const repoChangesPanelModule = createCachedAsyncComponent(() => import("./RepoChangesPanel.vue"));
const repoFilePreviewPaneModule = createCachedAsyncComponent(() => import("./RepoFilePreviewPane.vue"));
const repoFileTreeCardModule = createCachedAsyncComponent(() => import("./RepoFileTreeCard.vue"));
const repoGitHubDetailSidebarModule = createCachedAsyncComponent(() => import("./RepoGitHubDetailSidebar.vue"));
const repoHistoryPanelModule = createCachedAsyncComponent(() => import("./RepoHistoryPanel.vue"));
const repoIssuesPanelModule = createCachedAsyncComponent(() => import("./RepoIssuesPanel.vue"));
const repoIssuesSidebarControlsModule = createCachedAsyncComponent(() => import("./RepoIssuesSidebarControls.vue"));
const repoTopicEditorModule = createCachedAsyncComponent(() => import("./RepoTopicEditor.vue"));
const repoLanguageStatsCardModule = createCachedAsyncComponent(() => import("./RepoLanguageStatsCard.vue"));
const repoActionsPanelModule = createCachedAsyncComponent(() => import("./RepoActionsPanel.vue"));
const repoActionsInfoSidebarModule = createCachedAsyncComponent(() => import("./RepoActionsInfoSidebar.vue"));
const repoActionsSidebarControlsModule = createCachedAsyncComponent(() => import("./RepoActionsSidebarControls.vue"));
const repoPullRequestsPanelModule = createCachedAsyncComponent(() => import("./RepoPullRequestsPanel.vue"));
const repoPullRequestsSidebarControlsModule = createCachedAsyncComponent(() => import("./RepoPullRequestsSidebarControls.vue"));
const repoDiscussionsPanelModule = createCachedAsyncComponent(() => import("./discussions/RepoDiscussionsPanel.vue"));
const repoDiscussionsSidebarControlsModule = createCachedAsyncComponent(() => import("./discussions/RepoDiscussionsSidebarControls.vue"));
const repoReleasesPanelModule = createCachedAsyncComponent(() => import("./RepoReleasesPanel.vue"));

export const CommitDetailCard = commitDetailCardModule.component;
export const RepoLaunchTerminalPanel = repoLaunchTerminalPanelModule.component;
export const MarkdownReadme = markdownReadmeModule.component;
export const RepoChangesPanel = repoChangesPanelModule.component;
export const RepoFilePreviewPane = repoFilePreviewPaneModule.component;
export const RepoFileTreeCard = repoFileTreeCardModule.component;
export const RepoGitHubDetailSidebar = repoGitHubDetailSidebarModule.component;
export const RepoHistoryPanel = repoHistoryPanelModule.component;
export const RepoIssuesPanel = repoIssuesPanelModule.component;
export const RepoIssuesSidebarControls = repoIssuesSidebarControlsModule.component;
export const RepoTopicEditor = repoTopicEditorModule.component;
export const RepoLanguageStatsCard = repoLanguageStatsCardModule.component;
export const RepoActionsPanel = repoActionsPanelModule.component;
export const RepoActionsInfoSidebar = repoActionsInfoSidebarModule.component;
export const RepoActionsSidebarControls = repoActionsSidebarControlsModule.component;
export const RepoPullRequestsPanel = repoPullRequestsPanelModule.component;
export const RepoPullRequestsSidebarControls = repoPullRequestsSidebarControlsModule.component;
export const RepoDiscussionsPanel = repoDiscussionsPanelModule.component;
export const RepoDiscussionsSidebarControls = repoDiscussionsSidebarControlsModule.component;
export const RepoReleasesPanel = repoReleasesPanelModule.component;

export function preloadRepoProjectSection(section: string) {
  if (section === "launch") return repoLaunchTerminalPanelModule.load();
  if (section === "changes") return repoChangesPanelModule.load();
  if (section === "history") return Promise.all([repoHistoryPanelModule.load(), commitDetailCardModule.load()]);
  if (section === "files") return Promise.all([repoFilePreviewPaneModule.load(), repoFileTreeCardModule.load()]);
  if (section === "readme") return Promise.all([markdownReadmeModule.load(), repoLanguageStatsCardModule.load()]);
  if (section === "issues") return Promise.all([
    repoIssuesPanelModule.load(),
    repoIssuesSidebarControlsModule.load(),
    repoGitHubDetailSidebarModule.load(),
  ]);
  if (section === "pulls") return Promise.all([
    repoPullRequestsPanelModule.load(),
    repoPullRequestsSidebarControlsModule.load(),
    repoGitHubDetailSidebarModule.load(),
  ]);
  if (section === "discussions") return Promise.all([
    repoDiscussionsPanelModule.load(),
    repoDiscussionsSidebarControlsModule.load(),
  ]);
  if (section === "actions") return Promise.all([
    repoActionsPanelModule.load(),
    repoActionsInfoSidebarModule.load(),
    repoActionsSidebarControlsModule.load(),
  ]);
  if (section === "release") return repoReleasesPanelModule.load();
  if (section === "settings") return repoTopicEditorModule.load();
  return Promise.resolve();
}

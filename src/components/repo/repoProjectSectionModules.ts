import { createCachedAsyncComponent } from "../../utils/asyncComponent";

export type RepoProjectSectionKey =
  | "launch"
  | "changes"
  | "history"
  | "files"
  | "readme"
  | "board"
  | "issues"
  | "pulls"
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
const repoTopicEditorModule = createCachedAsyncComponent(() => import("./RepoTopicEditor.vue"));
const repoLanguageStatsCardModule = createCachedAsyncComponent(() => import("./RepoLanguageStatsCard.vue"));
const repoActionsPanelModule = createCachedAsyncComponent(() => import("./RepoActionsPanel.vue"));
const repoProjectsBoardModule = createCachedAsyncComponent(() => import("./RepoProjectsBoard.vue"));
const repoProjectsBoardSidebarModule = createCachedAsyncComponent(() => import("./RepoProjectsBoardSidebar.vue"));
const repoPullRequestsPanelModule = createCachedAsyncComponent(() => import("./RepoPullRequestsPanel.vue"));
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
export const RepoTopicEditor = repoTopicEditorModule.component;
export const RepoLanguageStatsCard = repoLanguageStatsCardModule.component;
export const RepoActionsPanel = repoActionsPanelModule.component;
export const RepoProjectsBoard = repoProjectsBoardModule.component;
export const RepoProjectsBoardSidebar = repoProjectsBoardSidebarModule.component;
export const RepoPullRequestsPanel = repoPullRequestsPanelModule.component;
export const RepoReleasesPanel = repoReleasesPanelModule.component;

export function preloadRepoProjectSection(section: string) {
  if (section === "launch") return repoLaunchTerminalPanelModule.load();
  if (section === "changes") return repoChangesPanelModule.load();
  if (section === "history") return Promise.all([repoHistoryPanelModule.load(), commitDetailCardModule.load()]);
  if (section === "files") return Promise.all([repoFilePreviewPaneModule.load(), repoFileTreeCardModule.load()]);
  if (section === "readme") return Promise.all([markdownReadmeModule.load(), repoLanguageStatsCardModule.load()]);
  if (section === "board") return Promise.all([repoProjectsBoardModule.load(), repoProjectsBoardSidebarModule.load()]);
  if (section === "issues") return Promise.all([repoIssuesPanelModule.load(), repoGitHubDetailSidebarModule.load()]);
  if (section === "pulls") return Promise.all([repoPullRequestsPanelModule.load(), repoGitHubDetailSidebarModule.load()]);
  if (section === "actions") return repoActionsPanelModule.load();
  if (section === "release") return repoReleasesPanelModule.load();
  if (section === "settings") return repoTopicEditorModule.load();
  return Promise.resolve();
}

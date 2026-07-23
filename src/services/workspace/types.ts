export type SystemOpenTarget = "folder" | "terminal" | "vscode" | "liliacode";

export interface WorkspaceRoot {
  id: string;
  path: string;
  available: boolean;
  unavailableReason: string | null;
}

export interface WorkspaceViewPreferences {
  sidebarRepositorySort: string;
  collapsedGroupIds: string[];
  homeRepositoryStatusSort: string;
}

export interface WorkspaceRecentContextV1 {
  version: 1;
  route: string;
}

export interface WorkspaceScopedSettings {
  roots: WorkspaceRoot[];
  primaryRootId: string | null;
  viewPreferences: WorkspaceViewPreferences;
  projectLaunchConfigs: Record<string, ProjectLaunchConfig>;
  repoSyncPreferences: Record<string, RepoSyncPreference>;
  repoRemoteSyncPolicies: Record<string, RepoRemoteSyncPolicy>;
  hiddenRepoIds: string[];
  managedRepoIds: string[];
  systemGitRepoIds: string[];
  repoBindings: Record<string, WorkspaceRepositoryBinding>;
  favoriteRepoIds: string[];
  repoGroups: WorkspaceRepoGroup[];
  organizationGroupingResolvedRepoIds: string[];
  remoteRepoShortcuts: RemoteRepoShortcut[];
  recentLocalRepos: RecentLocalRepoVisit[];
  localContributionCache: Record<string, Record<string, LocalContributionDayCache>>;
  contributionIdentities: ContributionIdentity[];
}

export interface NamedWorkspace extends WorkspaceScopedSettings {
  id: string;
  name: string;
  recentContext: WorkspaceRecentContextV1 | null;
}

export interface WorkspaceCatalogEntry {
  id: string;
  name: string;
  roots: WorkspaceRoot[];
  primaryRootId: string | null;
}

export interface WorkspaceSettings {
  /** Compatibility alias for the active workspace's primary root path. */
  workspaceRoot: string | null;
  githubBinding: GitHubBindingMetadata | null;
  accountPreferences: AccountPreferences;
  projectLaunchConfigs: Record<string, ProjectLaunchConfig>;
  repoSyncPreferences: Record<string, RepoSyncPreference>;
  repoRemoteSyncPolicies: Record<string, RepoRemoteSyncPolicy>;
  hiddenRepoIds: string[];
  managedRepoIds: string[];
  systemGitRepoIds: string[];
  repoBindings: Record<string, WorkspaceRepositoryBinding>;
  favoriteRepoIds: string[];
  repoGroups: WorkspaceRepoGroup[];
  organizationGroupingResolvedRepoIds: string[];
  remoteRepoShortcuts: RemoteRepoShortcut[];
  recentLocalRepos: RecentLocalRepoVisit[];
  localContributionCache: Record<string, Record<string, LocalContributionDayCache>>;
  contributionIdentities: ContributionIdentity[];
  workspaceCatalog: WorkspaceCatalogEntry[];
  activeWorkspaceId: string | null;
  activeWorkspace: NamedWorkspace | null;
}

export interface RecentLocalRepoVisit {
  repoId: string;
  openedAt: number;
}

export type AccountPreferenceDirection = "asc" | "desc";

export interface AccountPreferences {
  repositoryScope: GitHubRepositoryScope;
  repositorySort: {
    key: "name" | "created" | "updated";
    direction: AccountPreferenceDirection;
  };
  issues: {
    state: "open" | "closed" | "all";
    sort: "created" | "updated" | "comments";
    direction: AccountPreferenceDirection;
  };
  pullRequests: {
    state: "open" | "closed" | "merged";
    sort: "created" | "updated" | "comments";
    direction: AccountPreferenceDirection;
  };
  actions: {
    state: "all" | "active" | "completed";
    sort: "updated" | "created" | "run-number";
    direction: AccountPreferenceDirection;
  };
}

export interface GitHubAccountProfile {
  login: string;
  avatarUrl: string | null;
  name: string | null;
  email: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  twitterUsername: string | null;
  hireable: boolean | null;
}

export interface GitHubUpdateAccountProfileRequest {
  name: string | null;
  email: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  twitterUsername: string | null;
  hireable: boolean | null;
}

export interface WorkspaceRepositoryBinding {
  repositoryId: number | null;
  remoteFullName: string;
  canonicalRemoteUrl: string;
  localPath: string;
}

export interface WorkspaceStartupCache {
  workspaceId: string | null;
  rootsFingerprint: string;
  workspaceRoot: string | null;
  bindingLogin: string | null;
  reposById: Record<string, CachedRepoSummary>;
  contributions: CachedContributionResult | null;
}

export interface WorkspaceBootstrap {
  settings: WorkspaceSettings;
  startupCache: WorkspaceStartupCache | null;
  contextRevision: number;
}

export interface CachedRepoSummary {
  summary: RepoSummary;
  cachedAt: number;
  remoteCheckedAt?: number | null;
}

export interface CachedContributionResult {
  days: GitHubContributionDay[];
  meta: GitHubContributionMeta;
  cachedAt: number;
}

export interface WorkspaceStartupContributions {
  days: GitHubContributionDay[];
  meta: GitHubContributionMeta;
}

export interface RepoSyncPreference {
  autoSync?: boolean;
  includeInHomeCodeStats?: boolean;
  includeInHomeContributionStats?: boolean;
  calculateHomeTimeline?: boolean;
}

export interface RepoRemoteSyncPolicy {
  primaryRemote: string;
  pullRemotes: string[];
  pushRemotes: string[];
}

export interface WorkspaceRepoGroup {
  id: string;
  name: string;
  repoIds: string[];
  organizationLogin?: string | null;
}

export interface LocalContributionDayCache {
  count: number;
  updatedAt: number;
}

export interface ContributionIdentity {
  name?: string | null;
  email?: string | null;
}

export interface ContributionIdentityRecommendationResult {
  scannedRepoCount: number;
  skippedRepoCount: number;
  recommendations: ContributionIdentityRecommendation[];
}

export interface ContributionIdentityRecommendation {
  identity: ContributionIdentity;
  confidence: ContributionIdentityRecommendationConfidence;
  missedCommitCount: number;
  repoCount: number;
  latestCommitAt: number | null;
  repos: ContributionIdentityRecommendationRepo[];
}

export type ContributionIdentityRecommendationConfidence = "gitConfig" | "relatedAuthor" | "singleAuthor";

export interface ContributionIdentityRecommendationRepo {
  repoId: string;
  repoName: string;
  source: ContributionIdentityRecommendationSource;
  commitCount: number;
  latestCommitAt: number | null;
}

export type ContributionIdentityRecommendationSource = "gitConfig" | "recentAuthor";

export interface ProjectLaunchConfig {
  command: string;
  cwd: string | null;
  source: "inferred" | "manual";
  updatedAt: number | null;
}

export interface ProjectLaunchCandidate {
  command: string;
  label: string;
  hint: string | null;
  kind: "package" | "cargo" | "script" | "current" | string;
  cwd: string | null;
}

export type ProjectLaunchState = "idle" | "running" | "exited" | "error";

export interface ProjectLaunchStatus {
  repoId: string;
  state: ProjectLaunchState;
  pid: number | null;
  command: string | null;
  startedAt: number | null;
  exitCode: number | null;
  error: string | null;
  workspaceId: string | null;
  contextRevision: number;
}

export interface ProjectLaunchLog {
  index: number;
  repoId: string;
  stream: "stdout" | "stderr" | "system";
  line: string;
  writeMode?: "append" | "replace";
  timestamp: number;
}

export interface ProjectLaunchHistoryEntry {
  id: string;
  repoId: string;
  command: string;
  cwd: string | null;
  startedAt: number;
  finishedAt: number | null;
  state: ProjectLaunchState;
  exitCode: number | null;
  error: string | null;
  lastOutput: string | null;
}

export interface GitHubBindingMetadata {
  login: string;
  avatarUrl: string | null;
  boundAt: number;
  scopes: string[];
  clientIdSource: "bundled" | "custom" | string;
}

export interface GitHubBindingStatus {
  state: "bound" | "unbound";
  clientIdConfigured: boolean;
  clientIdSource: "bundled" | "none" | string;
  binding: GitHubBindingMetadata | null;
}

export interface GitHubDeviceFlowStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalSeconds: number;
}

export interface GitHubDeviceFlowPollResult {
  status: "pending" | "authorized" | "expired";
  intervalSeconds: number;
  bindingStatus: GitHubBindingStatus | null;
  error: string | null;
}

export interface GitHubContributionDay {
  date: string;
  count: number;
  repositories?: readonly GitHubContributionRepository[];
}

export interface GitHubContributionRepository {
  repoId: string;
  repoName: string;
  repoFullName: string | null;
  count: number;
}

export interface GitHubContributionMeta {
  repoCount: number;
  requestedRepoCount: number;
  repoLimit: number;
  truncated: boolean;
  skippedRepoCount: number;
  refreshedAt: number;
}

export interface GitHubContributionResult {
  days: GitHubContributionDay[];
  meta: GitHubContributionMeta;
}

export interface GitHubRepoSummary {
  id: number;
  name: string;
  fullName: string;
  /** @deprecated Prefer owner.login. Kept for persisted data compatibility. */
  ownerLogin: string;
  private: boolean;
  visibility?: "public" | "private" | "internal" | string | null;
  disabled: boolean;
  archived: boolean;
  description: string | null;
  defaultBranch: string | null;
  createdAt: string;
  updatedAt: string;
  cloneUrl: string;
  htmlUrl: string;
  fork?: boolean;
  isTemplate?: boolean;
  language?: string | null;
  topics?: string[];
  stargazersCount?: number;
  forksCount?: number;
  licenseSpdxId?: string | null;
  owner?: GitHubRepositoryOwner | null;
  permissions?: GitHubRepositoryPermissions | null;
}

export type GitHubOrganizationProfileView = "public" | "member";
export type GitHubReadmeSectionStatus = "ready" | "empty" | "unavailable";
export type GitHubOrganizationSectionStatus = "ready" | "empty" | "unavailable";

export interface GitHubOrganizationProfile {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  description: string | null;
  htmlUrl: string;
  location: string | null;
  websiteUrl: string | null;
  email: string | null;
  twitterUsername: string | null;
  followers: number;
  publicRepoCount: number;
  totalRepoCount: number | null;
  isVerified: boolean;
}

export interface GitHubOrganizationMember {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  htmlUrl: string;
}

export interface GitHubProfileReadmeSection {
  status: GitHubReadmeSectionStatus;
  preview: RepoFilePreview | null;
  sourceRepo: string | null;
  htmlUrl: string | null;
  error: string | null;
}

export interface GitHubOrganizationFeaturedSection {
  status: GitHubOrganizationSectionStatus;
  source: "pinned" | "popular" | null;
  items: GitHubRepoSummary[];
  error: string | null;
}

export interface GitHubOrganizationRepositorySection {
  status: GitHubOrganizationSectionStatus;
  items: GitHubRepoSummary[];
  error: string | null;
}

export interface GitHubOrganizationMembersSection {
  status: GitHubOrganizationSectionStatus;
  items: GitHubOrganizationMember[];
  totalCount: number;
  error: string | null;
}

export interface GitHubOrganizationOverview {
  effectiveView: GitHubOrganizationProfileView;
  memberViewAvailable: boolean;
  readme: GitHubProfileReadmeSection;
  featured: GitHubOrganizationFeaturedSection;
  recent: GitHubOrganizationRepositorySection;
  members: GitHubOrganizationMembersSection;
}

export interface GitHubRepoPage {
  items: GitHubRepoSummary[];
  nextPage: number | null;
  scope?: GitHubRepositoryScope;
}

export type GitHubRepositorySubscriptionMode = "watching" | "participating" | "ignored";

export interface GitHubRepositorySubscription {
  mode: GitHubRepositorySubscriptionMode;
}

export interface GitHubWatchedRepoPage {
  items: GitHubRepoSummary[];
  nextPage: number | null;
}

export type GitHubOwnerKind = "user" | "organization";

export interface GitHubRepositoryOwner {
  login: string;
  kind: GitHubOwnerKind;
  avatarUrl: string | null;
}

export interface GitHubRepositoryPermissions {
  pull: boolean;
  push: boolean;
  admin: boolean;
}

export type GitHubRepositoryScope =
  | { kind: "all" }
  | { kind: "personal"; login: string }
  | { kind: "organization"; login: string };

export type GitHubOrganizationSource = "membership" | "repository_access" | "both";

export interface GitHubOrganizationSummary {
  login: string;
  avatarUrl: string | null;
  membershipVisible: boolean;
  membershipComplete: boolean;
  repositoryAccessVisible: boolean;
  source: GitHubOrganizationSource;
}

export interface GitHubCommitListOptions {
  perPage?: number | null;
  sha?: string | null;
}

export interface RemoteRepoShortcut {
  accountLogin?: string | null;
  repositoryId?: number | null;
  fullName: string;
  name: string;
  private: boolean;
  archived: boolean;
  defaultBranch: string | null;
  htmlUrl: string;
  cloneUrl: string;
  canonicalRemoteUrl?: string | null;
  favorite?: boolean;
  openedAt: number;
}

export interface GitHubRepoOwner {
  login: string;
  kind: GitHubOwnerKind;
  avatarUrl: string | null;
  membershipVisible: boolean;
  membershipComplete: boolean;
  membershipRestriction?: "scope_missing" | "sso_required" | "forbidden" | null;
  membershipRecoveryUrl?: string | null;
  repositoryAccessVisible: boolean;
  source: "authenticated_user" | GitHubOrganizationSource;
}

export interface GitHubRepoTemplate {
  id: number;
  name: string;
  fullName: string;
  ownerLogin: string;
  private: boolean;
  description: string | null;
}

export interface WorkspaceCreateLocalRepoRequest {
  name: string;
  rootId?: string | null;
  description?: string | null;
  addReadme: boolean;
  gitignoreTemplate?: string | null;
  licenseTemplate?: string | null;
}

export interface WorkspaceCloneRepositoryRef {
  id: number | null;
  fullName: string;
  cloneUrl: string;
  defaultBranch?: string | null;
  owner?: GitHubRepositoryOwner | null;
}

export type WorkspaceCloneTarget =
  | { kind: "default" }
  | { kind: "root"; rootId: string }
  | { kind: "custom"; path: string };

export type WorkspaceRepoPlacement =
  | { kind: "automatic" }
  | { kind: "ungrouped" }
  | { kind: "group"; groupId: string };

export interface WorkspaceCloneRepoRequest {
  remoteUrl: string;
  repository?: WorkspaceCloneRepositoryRef | null;
  target: WorkspaceCloneTarget;
  placement: WorkspaceRepoPlacement;
}

export interface WorkspaceCloneResult {
  repo: RepoSummary;
  settings: WorkspaceSettings;
}

export type WorkspaceRepoPathMode = "keep" | "move" | "link";

export interface WorkspaceRepoRelocationResult {
  settings: WorkspaceSettings;
  previousRepoId: string;
  repo: RepoSummary;
  pathChanged: boolean;
  pathMode: WorkspaceRepoPathMode;
}

export interface GitHubCreateRepoRequest {
  owner: string;
  ownerKind: GitHubOwnerKind | "org" | string;
  name: string;
  description?: string | null;
  private: boolean;
  autoInit: boolean;
  gitignoreTemplate?: string | null;
  licenseTemplate?: string | null;
  hasIssues: boolean;
  hasWiki: boolean;
  templateFullName?: string | null;
  includeAllBranches?: boolean;
}

export interface GitHubRepoLicense {
  key: string;
  name: string;
  spdxId: string | null;
  url?: string | null;
}

export interface GitHubRepoManagement {
  fullName: string;
  name: string;
  description: string | null;
  homepage: string | null;
  topics: string[];
  private: boolean;
  visibility?: "public" | "private" | string;
  defaultBranch: string;
  viewerCanAdminister?: boolean;
  archived?: boolean;
  isTemplate?: boolean;
  hasIssues: boolean;
  hasWiki: boolean;
  hasProjects: boolean;
  hasDiscussions: boolean;
  hasPullRequests?: boolean;
  pullRequestCreationPolicy?: "all" | "collaborators_only" | string | null;
  allowMergeCommit: boolean;
  allowSquashMerge: boolean;
  allowRebaseMerge: boolean;
  allowAutoMerge: boolean;
  deleteBranchOnMerge: boolean;
  allowUpdateBranch?: boolean;
  allowForking: boolean;
  webCommitSignoffRequired: boolean;
  squashMergeCommitTitle?: "PR_TITLE" | "COMMIT_OR_PR_TITLE" | string | null;
  squashMergeCommitMessage?: "PR_BODY" | "COMMIT_MESSAGES" | "BLANK" | string | null;
  mergeCommitTitle?: "PR_TITLE" | "MERGE_MESSAGE" | string | null;
  mergeCommitMessage?: "PR_BODY" | "PR_TITLE" | "BLANK" | string | null;
  securityAndAnalysis?: Record<string, unknown> | null;
  stargazersCount: number;
  watchersCount: number;
  forksCount: number;
  htmlUrl: string;
  license: GitHubRepoLicense | null;
}

export type GitHubBranchProtection = Record<string, unknown>;
export type GitHubRuleset = Record<string, unknown>;

export interface GitHubRulesetSummary {
  id: number;
  name: string;
  target: string;
  enforcement: string;
  sourceType: string;
  source: string;
  repositoryOwned: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type GitHubUpdateRepoSettingsRequest = Partial<Omit<GitHubRepoManagement, "fullName" | "htmlUrl" | "license">>;

export type GitHubRepoSettingsSectionKey =
  | "collaborators"
  | "moderation"
  | "security"
  | "branches"
  | "tags"
  | "rules"
  | "actions"
  | "copilot"
  | "environments"
  | "codespaces"
  | "pages"
  | "webhooks"
  | "deployKeys"
  | "secretsVariables"
  | "githubApps"
  | "emailNotifications";

export interface GitHubRepoSettingsEndpointItem {
  key: string;
  label: string;
  method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE" | string;
  path: string;
  value: unknown | null;
  error: string | null;
  mutable: boolean;
  dangerous: boolean;
}

export interface GitHubRepoSettingsSection {
  key: GitHubRepoSettingsSectionKey;
  title: string;
  fetchedAt: number;
  items: GitHubRepoSettingsEndpointItem[];
}

export interface GitHubRepoActionsPermissionsRequest {
  enabled: boolean;
  allowedActions?: "all" | "local_only" | "selected" | string | null;
  shaPinningRequired?: boolean | null;
}

export interface GitHubRepoWorkflowPermissionsRequest {
  defaultWorkflowPermissions: "read" | "write" | string;
  canApprovePullRequestReviews?: boolean | null;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: "open" | "closed" | string;
  body: string | null;
  labels: string[];
  assignees: string[];
  author?: string | null;
  milestone?: GitHubIssueMilestone | null;
  comments?: number;
  projectItems?: GitHubIssueProjectItem[];
  developmentItems?: GitHubDevelopmentItem[];
  htmlUrl: string;
  updatedAt: string;
  createdAt: string;
}

export interface GitHubAccountIssueItem {
  repoFullName: string;
  issue: GitHubIssue;
  pullRequest: boolean;
}

export type GitHubDiscussionTimelineItemKind = "body" | "comment" | "event" | "review" | "reviewComment";

export interface GitHubDiscussionTimelineItem {
  id: string;
  databaseId?: number | null;
  kind: GitHubDiscussionTimelineItemKind;
  actor?: string | null;
  body?: string | null;
  url?: string | null;
  event?: string | null;
  state?: string | null;
  title?: string | null;
  path?: string | null;
  line?: number | null;
  originalLine?: number | null;
  commitId?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface GitHubIssueDiscussion {
  issue: GitHubIssue;
  timeline: GitHubDiscussionTimelineItem[];
}

export interface GitHubPullRequestDiscussion {
  pullRequest: GitHubPullRequest;
  timeline: GitHubDiscussionTimelineItem[];
}

export interface GitHubIssueMilestone {
  number: number;
  title: string;
  state?: string | null;
}

export interface GitHubIssueProjectItem {
  id: string;
  title: string;
}

export interface GitHubDevelopmentItem {
  id: string;
  kind: "issue" | "pullRequest" | "branch" | "commit" | string;
  label: string;
  url?: string | null;
  number?: number | null;
  state?: string | null;
  repositoryFullName?: string | null;
  refName?: string | null;
  sha?: string | null;
}

export interface GitHubIssueFilterMetadata {
  authors: string[];
  labels: string[];
  assignees: string[];
  milestones: GitHubIssueMilestone[];
  projects: GitHubIssueProjectItem[];
}

export interface GitHubPullRequestReviewer {
  login: string;
  kind: "user" | "team" | string;
  state: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: "open" | "closed" | string;
  draft: boolean;
  body: string | null;
  labels: string[];
  assignees: string[];
  milestone?: GitHubIssueMilestone | null;
  comments?: number;
  projectItems?: GitHubIssueProjectItem[];
  reviewers?: GitHubPullRequestReviewer[];
  developmentItems?: GitHubDevelopmentItem[];
  commitCount?: number | null;
  htmlUrl: string;
  updatedAt: string;
  createdAt: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  merged: boolean;
  mergeable: boolean | null;
  mergeableState: string | null;
}

export interface GitHubPullRequestCheck {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  htmlUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface GitHubCreatePullRequestRequest {
  title: string;
  body?: string | null;
  head: string;
  base: string;
  draft?: boolean;
}

export interface GitHubUpdatePullRequestRequest {
  title?: string | null;
  body?: string | null;
  state?: "open" | "closed" | string | null;
  base?: string | null;
  labels?: string[];
  assignees?: string[];
  milestone?: number | null;
}

export interface GitHubMergePullRequestRequest {
  method?: "merge" | "squash" | "rebase" | string | null;
  commitTitle?: string | null;
  commitMessage?: string | null;
  sha?: string | null;
}

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  displayTitle: string;
  status: string;
  conclusion: string | null;
  branch: string;
  event: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  actor?: string | null;
  headSha?: string | null;
  runNumber?: number | null;
  runAttempt?: number | null;
  workflowId?: number | null;
  runStartedAt?: string | null;
}

export interface GitHubActionNotification {
  id: string;
  repoFullName: string;
  title: string;
  reason: string;
  subjectType: string;
  subjectUrl: string | null;
  latestCommentUrl: string | null;
  updatedAt: string;
  unread: boolean;
}

export interface GitHubWorkflowJobStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  startedAt: string | null;
  completedAt: string | null;
}

export interface GitHubWorkflowJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  htmlUrl: string | null;
  runnerName: string | null;
  steps: GitHubWorkflowJobStep[];
}

export interface GitHubWorkflowArtifact {
  id: number;
  name: string;
  sizeInBytes: number;
  expired: boolean;
  createdAt: string;
  expiresAt: string | null;
}

export interface GitHubWorkflowDefinition {
  id: number;
  path: string;
  refName: string;
  content: string;
}

export interface GitHubWorkflowRunDetail {
  run: GitHubWorkflowRun;
  jobs: GitHubWorkflowJob[];
  artifacts: GitHubWorkflowArtifact[];
  workflow: GitHubWorkflowDefinition | null;
}

export interface GitHubWorkflowJobLog {
  jobId: number;
  content: string;
}

export interface GitHubWorkflowArtifactEntry {
  path: string;
  name: string;
  kind: "dir" | "file" | string;
  size: number;
}

export interface GitHubReleaseAsset {
  id: number;
  name: string;
  label: string | null;
  contentType: string;
  size: number;
  downloadCount: number;
  state: string;
  browserDownloadUrl: string;
  createdAt: string;
  updatedAt: string;
  uploader: string | null;
}

export interface GitHubRelease {
  id: number;
  tagName: string;
  targetCommitish: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  immutable: boolean;
  makeLatest: string | null;
  htmlUrl: string;
  uploadUrl: string;
  tarballUrl: string | null;
  zipballUrl: string | null;
  createdAt: string;
  publishedAt: string | null;
  author: string | null;
  assets: GitHubReleaseAsset[];
}

export interface GitHubCreateReleaseRequest {
  tagName: string;
  targetCommitish?: string | null;
  name?: string | null;
  body?: string | null;
  draft?: boolean | null;
  prerelease?: boolean | null;
  generateReleaseNotes?: boolean | null;
  makeLatest?: string | null;
}

export interface GitHubUpdateReleaseRequest {
  tagName?: string | null;
  targetCommitish?: string | null;
  name?: string | null;
  body?: string | null;
  draft?: boolean | null;
  prerelease?: boolean | null;
  makeLatest?: string | null;
}

export interface GitHubAttachWorkflowArtifactAssetRequest {
  runId: number;
  artifactId: number;
  artifactName?: string | null;
  artifactPath: string;
  releaseId: number;
  expectedTagName: string;
  label?: string | null;
}

export interface GitHubIssueListOptions {
  state?: "open" | "closed" | "all" | string | null;
  perPage?: number | null;
  sort?: "created" | "updated" | "comments" | string | null;
  direction?: "asc" | "desc" | string | null;
  since?: string | null;
  creator?: string | null;
  assignee?: string | null;
  labels?: string[] | null;
  milestone?: string | number | null;
  project?: string | null;
  query?: string | null;
}

export interface GitHubPullRequestListOptions extends GitHubIssueListOptions {
  state?: "open" | "closed" | "merged" | "all" | string | null;
  review?: "none" | "required" | "approved" | "changes_requested" | string | null;
}

export interface GitHubCreateIssueRequest {
  title: string;
  body?: string | null;
  labels: string[];
  assignees: string[];
}

export interface GitHubUpdateIssueRequest {
  title?: string;
  body?: string | null;
  state?: "open" | "closed";
  stateReason?: "completed" | "not_planned" | null;
  labels?: string[];
  assignees?: string[];
  milestone?: number | null;
}

export type GitHubReactionContent = "+1" | "-1" | "laugh" | "hooray" | "confused" | "heart" | "rocket" | "eyes";

export interface GitHubIssueCommentRequest {
  body: string;
}

export interface GitHubIssueCommentReactionRequest {
  content: GitHubReactionContent;
}

export interface LanguageStat {
  language: string;
  bytes: number;
  lines: number;
}

export type RepoWorktreeRole = "standalone" | "main" | "linked";

export interface RepoWorktree {
  role: RepoWorktreeRole;
  sharedRepoKey: string;
  mainRepoId: string | null;
}

export interface RepoSummary {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  currentBranch: string | null;
  remoteUrl: string | null;
  githubFullName: string | null;
  githubRepositoryId?: number | null;
  canonicalRemoteUrl?: string | null;
  ahead: number;
  behind: number;
  remoteBranchStates: readonly RepoRemoteBranchState[];
  remotesNeedingPull: number;
  remotesNeedingPush: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictCount: number;
  lastCommitAt: number | null;
  lastCommitMessage: string | null;
  languageStats: readonly LanguageStat[];
  languageStatsUpdatedAt: number;
  worktree: RepoWorktree;
}

export interface RepoRemoteBranchState {
  remote: string;
  remoteBranch: string;
  exists: boolean;
  ahead: number;
  behind: number;
  needsPull: boolean;
  needsPush: boolean;
  upstream: boolean;
}

export interface RepoStorageStats {
  logicalBytes: number | null;
}

export interface RepoRefreshSummaryOptions {
  fetchRemote?: boolean;
}

export interface RepoDetailPatchRequest {
  includeCommits?: boolean;
  includeBranches?: boolean;
}

export interface RepoChange {
  path: string;
  oldPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
  diff: string;
}

export interface RepoConflictState {
  operation: "none" | "merge" | "rebase" | "cherry-pick" | string;
  files: RepoConflictFile[];
  allResolved: boolean;
}

export interface RepoConflictFile {
  path: string;
  status: string;
  resolved: boolean;
  binary: boolean;
  hunks: RepoConflictHunk[];
}

export interface RepoConflictHunk {
  id: string;
  startLine: number;
  endLine: number;
  oursLabel: string;
  theirsLabel: string;
  oursLines: string[];
  theirsLines: string[];
}

export interface RepoConflictChoice {
  hunkId: string;
  side: "ours" | "theirs";
}

export interface RepoMergePullResult {
  status: "success" | "conflicts";
  message: string;
  summary: RepoSummary;
  conflicts: RepoConflictState;
}

export interface RepoRemoteSyncConfig {
  remotes: RepoRemote[];
  policy: RepoRemoteSyncPolicy | null;
  resolvedPolicy: RepoRemoteSyncPolicy;
  validationErrors: string[];
}

export type RepoRemoteOperation = "fetch" | "merge" | "push" | "restore";
export type RepoRemoteOperationStatus = "success" | "skipped" | "conflicts" | "error";

export interface RepoRemoteOperationStep {
  remote: string;
  operation: RepoRemoteOperation;
  status: RepoRemoteOperationStatus;
  message: string;
  targetBranch?: string | null;
}

export interface RepoSyncOperationResult {
  status: "success" | "partial" | "conflicts" | "error";
  message: string;
  summary: RepoSummary;
  conflicts: RepoConflictState;
  steps: RepoRemoteOperationStep[];
}

export interface RepoCommitResult {
  summary: RepoSummary;
  pushResult: RepoSyncOperationResult | null;
}

export interface RepoOperationResult {
  status: "success" | "conflicts";
  message: string;
  summary: RepoSummary;
  conflicts: RepoConflictState;
}

export interface CommitSummary {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail?: string | null;
  timestamp: number;
  subject: string;
  parents: string[];
  refs: string[];
}

export interface CommitFileChange {
  path: string;
  oldPath: string | null;
  status: string;
  additions: number;
  deletions: number;
  patch: string;
  hunks: CommitDiffHunk[];
}

export interface CommitDiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: CommitDiffLine[];
}

export interface CommitDiffLine {
  kind: "context" | "added" | "deleted" | "meta";
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface CommitDetail {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail?: string | null;
  committer: string;
  committerEmail?: string | null;
  timestamp: number;
  subject: string;
  body: string;
  parents: string[];
  refs: string[];
  files: CommitFileChange[];
}

export interface RepoStashEntry {
  id: string;
  index: number;
  branch: string | null;
  message: string;
}

export interface RepoStashDetail {
  entry: RepoStashEntry;
  files: CommitFileChange[];
}

export interface RepoRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string | null;
  current: boolean;
}

export interface BranchSummary {
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  protected: boolean;
  tipTimestamp: number | null;
  checkedOutWorktreePaths: string[];
}

export interface RepoDetail {
  summary: RepoSummary;
  changes: RepoChange[];
  commits: CommitSummary[];
  branches: BranchSummary[];
  conflicts: RepoConflictState;
}

export interface RepoDetailPatch {
  summary: RepoSummary;
  changes: RepoChange[];
  conflicts: RepoConflictState;
  commits?: CommitSummary[] | null;
  branches?: BranchSummary[] | null;
}

export interface RepoFileTreeEntry {
  path: string;
  name: string;
  kind: "dir" | "file";
  hasChildren: boolean;
}

export type RepoFilePreviewKind = "text" | "markdown" | "image" | "binary" | "tooLarge";

export interface RepoFilePreview {
  path: string;
  name: string;
  previewKind: RepoFilePreviewKind;
  content?: string;
  dataUrl?: string | null;
  images?: Record<string, string>;
  size: number;
  mimeType?: string | null;
  truncated: boolean;
}

export type BulkOperation = "pull" | "push" | "sync";

export interface BulkSyncRepo {
  repo: RepoSummary;
  reason: string;
}

export interface BulkSyncPreview {
  operation: BulkOperation;
  eligible: BulkSyncRepo[];
  blocked: BulkSyncRepo[];
  warnings: BulkSyncRepo[];
}

export interface BulkSyncResult {
  repoId: string;
  status: "success" | "partial" | "conflicts" | "error";
  message: string;
  summary: RepoSummary | null;
  steps: RepoRemoteOperationStep[];
}

export interface HiddenRepo {
  id: string;
  name: string;
}

export type RepoResetMode = "soft" | "mixed" | "hard";
export type RepoPullStrategy = "pull" | "merge" | "rebase";
export type RepoPullLocalChangesMode = "reject" | "stash" | "discard";
export type WorkspaceTaskPriority = "high" | "normal" | "low";
export type WorkspaceTaskStatus = "pending" | "running" | "success" | "error" | "cancelled";
export type WorkspaceTaskKind =
  | "repoStatus"
  | "repoRemote"
  | "repoDetail"
  | "discoverRepos"
  | "languageStats"
  | "contributions"
  | "git"
  | "sync"
  | "github"
  | "launch"
  | "workspace";

export type RepoRefreshMode = "local" | "remote";
export type RepoRefreshDetailScope = "auto" | "summary" | "detail";

export interface WorkspaceRepoRefreshRequest {
  repoId: string;
  mode: RepoRefreshMode;
  priority: WorkspaceTaskPriority;
  force?: boolean;
  detailScope?: RepoRefreshDetailScope;
  includeCommits?: boolean;
  includeBranches?: boolean;
  trigger: string;
}

export interface WorkspaceRepoRefreshedEvent {
  workspaceId: string | null;
  contextRevision: number;
  repoId: string;
  mode: RepoRefreshMode;
  summary: RepoSummary;
  detailPatch?: RepoDetailPatch | null;
  remoteCheckedAt?: number | null;
}

export interface WorkspaceTask {
  id: string;
  kind: WorkspaceTaskKind;
  title: string;
  priority: WorkspaceTaskPriority;
  repoId: string | null;
  status: WorkspaceTaskStatus;
  message: string | null;
  createdAt: number;
  updatedAt: number;
  cancellable: boolean;
  workspaceId: string | null;
  contextRevision: number;
}

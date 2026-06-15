
export interface WorkspaceSettings {
  workspaceRoot: string | null;
  githubBinding: GitHubBindingMetadata | null;
  projectLaunchConfigs: Record<string, ProjectLaunchConfig>;
  hiddenRepoIds: string[];
  managedRepoIds: string[];
  remoteRepoShortcuts: RemoteRepoShortcut[];
}

export interface ProjectLaunchConfig {
  command: string;
  cwd: string | null;
  source: "inferred" | "manual";
  updatedAt: number | null;
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
}

export interface ProjectLaunchLog {
  index: number;
  repoId: string;
  stream: "stdout" | "stderr" | "system";
  line: string;
  timestamp: number;
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
  ownerLogin: string;
  private: boolean;
  disabled: boolean;
  archived: boolean;
  description: string | null;
  defaultBranch: string | null;
  createdAt: string;
  updatedAt: string;
  cloneUrl: string;
  htmlUrl: string;
}

export interface GitHubRepoPage {
  items: GitHubRepoSummary[];
  nextPage: number | null;
}

export interface RemoteRepoShortcut {
  fullName: string;
  name: string;
  private: boolean;
  archived: boolean;
  defaultBranch: string | null;
  htmlUrl: string;
  cloneUrl: string;
  openedAt: number;
}

export interface GitHubRepoOwner {
  login: string;
  kind: "user" | "org" | string;
}

export interface GitHubCreateRepoRequest {
  owner: string;
  ownerKind: "user" | "org" | string;
  name: string;
  description?: string | null;
  private: boolean;
  autoInit: boolean;
  gitignoreTemplate?: string | null;
  licenseTemplate?: string | null;
  hasIssues: boolean;
  hasWiki: boolean;
}

export interface GitHubRepoManagement {
  fullName: string;
  name: string;
  description: string | null;
  homepage: string | null;
  private: boolean;
  defaultBranch: string;
  hasIssues: boolean;
  hasWiki: boolean;
  hasProjects: boolean;
  hasDiscussions: boolean;
  allowMergeCommit: boolean;
  allowSquashMerge: boolean;
  allowRebaseMerge: boolean;
  allowAutoMerge: boolean;
  deleteBranchOnMerge: boolean;
  allowForking: boolean;
  webCommitSignoffRequired: boolean;
  htmlUrl: string;
}

export type GitHubUpdateRepoSettingsRequest = Partial<Omit<GitHubRepoManagement, "fullName" | "name" | "htmlUrl">>;

export interface GitHubIssue {
  number: number;
  title: string;
  state: "open" | "closed" | string;
  body: string | null;
  labels: string[];
  assignees: string[];
  htmlUrl: string;
  updatedAt: string;
  createdAt: string;
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
}

export interface GitHubIssueListOptions {
  state?: "open" | "closed" | "all" | string | null;
  perPage?: number | null;
  sort?: "created" | "updated" | "comments" | string | null;
  direction?: "asc" | "desc" | string | null;
  since?: string | null;
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
  labels?: string[];
  assignees?: string[];
}

export interface LanguageStat {
  language: string;
  bytes: number;
}

export interface RepoSummary {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  currentBranch: string | null;
  remoteUrl: string | null;
  githubFullName: string | null;
  ahead: number;
  behind: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictCount: number;
  lastCommitAt: number | null;
  lastCommitMessage: string | null;
  languageStats: readonly LanguageStat[];
  workingTreeLanguageStats: readonly LanguageStat[];
  languageStatsUpdatedAt: number;
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

export interface BranchSummary {
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface RepoDetail {
  summary: RepoSummary;
  changes: RepoChange[];
  commits: CommitSummary[];
  branches: BranchSummary[];
  conflicts: RepoConflictState;
}

export interface RepoReadme {
  repoId: string;
  path: string;
  images: Record<string, string>;
  content: string;
  format: string;
  updatedAt: number | null;
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
  status: "success" | "error";
  message: string;
  summary: RepoSummary | null;
}

export interface HiddenRepo {
  id: string;
  name: string;
}

export type WorkspaceTaskPriority = "high" | "normal" | "low";
export type WorkspaceTaskStatus = "pending" | "running" | "success" | "error" | "cancelled";
export type WorkspaceTaskKind = "repoStatus" | "repoDetail" | "discoverRepos" | "languageStats" | "contributions";

export interface WorkspaceTask {
  id: string;
  kind: WorkspaceTaskKind;
  priority: WorkspaceTaskPriority;
  repoId: string | null;
  status: WorkspaceTaskStatus;
  message: string | null;
  updatedAt: number;
}

import type {
  DiscoveryRepositoryInput,
  DiscoveryScanResult,
} from "../discovery/types";
import type {
  GitHubAccountIssueItem,
  RepoSummary,
  WorkspaceTask,
} from "../workspace/types";

export type WorkItemKind =
  | "pull_request"
  | "issue"
  | "review"
  | "workflow"
  | "release"
  | "sync_conflict"
  | "local_changes";

export type WorkItemBucket = "attention" | "today";
export type WorkItemPriority = "critical" | "high" | "normal" | "low";

export interface WorkItemAction {
  label: string;
  route: string;
}

export interface WorkItem {
  id: string;
  kind: WorkItemKind;
  bucket: WorkItemBucket;
  priority: WorkItemPriority;
  prioritySource: string;
  title: string;
  repository: string;
  repoId: string | null;
  reason: string;
  nextAction: WorkItemAction;
  updatedAt: number;
  sourceRevision?: string;
  pinned: boolean;
}

export type WorkItemDispositionState = "active" | "ignored" | "snoozed" | "completed";

export interface WorkItemDisposition {
  state: WorkItemDispositionState;
  pinned: boolean;
  updatedAt: number;
  snoozedUntil: number | null;
  sourceRevision: string | null;
}

export interface WorkItemDispositionSnapshot {
  version: 1;
  items: Record<string, WorkItemDisposition>;
}

export interface ControlCenterInput {
  repositories: readonly DiscoveryRepositoryInput[];
  localRepositories: readonly RepoSummary[];
  scan: DiscoveryScanResult | null;
  accountItems?: readonly GitHubAccountIssueItem[];
  tasks?: readonly WorkspaceTask[];
  now?: number;
}

export type ProjectMomentumState = "healthy" | "attention" | "blocked" | "inactive";

export interface ProjectMomentumReason {
  id: string;
  label: string;
  tone: "normal" | "warning" | "danger";
}

export interface ProjectMomentum {
  repository: string;
  repoId: string;
  state: ProjectMomentumState;
  reasons: ProjectMomentumReason[];
  nextAction: WorkItemAction;
  updatedAt: number;
}

export type ContinueContextKind =
  | "repository"
  | "branch"
  | "file"
  | "commit"
  | "issue"
  | "pull_request"
  | "actions_job"
  | "task";

export interface ContinueContext {
  id: string;
  kind: ContinueContextKind;
  title: string;
  detail: string;
  route: string;
  repositoryId: string | null;
  branch: string | null;
  objectId: string | null;
  updatedAt: number;
}

export interface ContinueContextSnapshot {
  version: 1;
  items: ContinueContext[];
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

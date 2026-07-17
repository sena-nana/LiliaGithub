import type { GitHubRepoSummary, RepoSummary } from "../../services/workspace";

export interface DiscoveryRepositoryInput {
  fullName: string;
  remote: GitHubRepoSummary | null;
  localRepo: RepoSummary | null;
}

export interface DiscoverySectionResult<T> {
  items: T[];
  failures: readonly unknown[];
  truncated: boolean;
  requestedRepositoryCount?: number;
  successfulRepositoryCount?: number;
}

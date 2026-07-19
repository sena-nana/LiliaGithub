import type {
  DiscoveryCommandOptions,
  DiscoveryPullRequestReviewRequest,
  DiscoveryRepositoryStatus,
  DiscoveryScanResult,
} from "./types";
import { getGitHubRepoManagement, listGitHubRepos } from "../workspace/client";
import type { GitHubAccountIssueItem } from "../workspace/types";
import { loadDiscoveryAssignedIssues } from "./issues";
import { loadDiscoveryPendingPullRequests } from "./pullRequests";
import { loadDiscoveryRecentReleases } from "./releases";
import { loadDiscoveryRepositoryStatuses } from "./repositoryStatus";
import { loadDiscoveryFailedWorkflowRuns } from "./workflows";

let assignedWorkFallback: GitHubAccountIssueItem[] = [];

export function listAssignedWorkFallback(perPage = 50) {
  return Promise.resolve(structuredClone(assignedWorkFallback.slice(0, perPage)));
}

export function setAssignedWorkFallbackForTests(items: readonly GitHubAccountIssueItem[]) {
  assignedWorkFallback = structuredClone([...items]);
}

export function resetAssignedWorkFallbackForTests() {
  assignedWorkFallback = [];
}

export async function scanDiscoveryFallback(
  repoFullNames: readonly string[],
  options: DiscoveryCommandOptions = {},
): Promise<DiscoveryScanResult> {
  const [pendingPullRequests, assignedIssues, failedWorkflows, recentReleases, repositoryStatuses] =
    await Promise.all([
      loadDiscoveryPendingPullRequests(repoFullNames, options),
      loadDiscoveryAssignedIssues(repoFullNames, options),
      loadDiscoveryFailedWorkflowRuns(repoFullNames, options),
      loadDiscoveryRecentReleases(repoFullNames, options),
      loadDiscoveryRepositoryStatuses(repoFullNames, options),
    ]);
  return { pendingPullRequests, assignedIssues, failedWorkflows, recentReleases, repositoryStatuses };
}

export async function getRepositoryStatusFallback(repoFullName: string): Promise<DiscoveryRepositoryStatus> {
  const [repository, management] = await Promise.all([
    findRepository(repoFullName),
    getGitHubRepoManagement(repoFullName),
  ]);
  return {
    fullName: repoFullName,
    updatedAt: repository.updatedAt,
    private: repository.private,
    archived: repository.archived,
    disabled: repository.disabled,
    htmlUrl: repository.htmlUrl,
    permissions: repository.permissions ?? { pull: false, push: false, admin: false },
    allowMergeCommit: management.allowMergeCommit,
    allowSquashMerge: management.allowSquashMerge,
    allowRebaseMerge: management.allowRebaseMerge,
  };
}

export async function submitPullRequestReviewFallback(
  _repoFullName: string,
  _pullNumber: number,
  _request: DiscoveryPullRequestReviewRequest,
): Promise<void> {
  throw new Error("Pull Request 审查需要在桌面应用中完成");
}

async function findRepository(repoFullName: string) {
  let pageNumber = 1;
  for (;;) {
    const page = await listGitHubRepos({ kind: "all" }, pageNumber);
    const repository = page.items.find((item) =>
      item.fullName.toLocaleLowerCase() === repoFullName.toLocaleLowerCase());
    if (repository) return repository;
    if (page.nextPage == null) throw new Error("未找到该仓库");
    pageNumber = page.nextPage;
  }
}

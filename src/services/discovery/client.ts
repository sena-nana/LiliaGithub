import { createCachedAsyncModule } from "../../utils/asyncModule";
import { call } from "../workspace/client";
import type {
  DiscoveryCommandOptions,
  DiscoveryPullRequestReviewRequest,
  DiscoveryRepositoryStatus,
  DiscoveryScanResult,
} from "./types";

const fallbackModule = createCachedAsyncModule(() => import("./fallback"));

export function scanGitHubDiscovery(
  repoFullNames: readonly string[],
  options: DiscoveryCommandOptions = {},
): Promise<DiscoveryScanResult> {
  const request = {
    repoFullNames: normalizeRepoFullNames(repoFullNames),
    forceRefresh: options.forceRefresh ?? null,
  };
  return call(
    "github_discovery_scan",
    { request },
    async () => (await fallbackModule.load()).scanDiscoveryFallback(request.repoFullNames, options),
  );
}

export async function getGitHubDiscoveryRepositoryStatus(
  repoFullName: string,
  options: DiscoveryCommandOptions = {},
): Promise<DiscoveryRepositoryStatus> {
  const normalizedRepo = requireRepoFullName(repoFullName);
  return call(
    "github_discovery_get_repository_status",
    { repoFullName: normalizedRepo, forceRefresh: options.forceRefresh ?? null },
    async () => (await fallbackModule.load()).getRepositoryStatusFallback(normalizedRepo),
  );
}

export async function submitGitHubDiscoveryPullRequestReview(
  repoFullName: string,
  pullNumber: number,
  request: DiscoveryPullRequestReviewRequest,
): Promise<void> {
  const normalizedRepo = requireRepoFullName(repoFullName);
  const normalizedRequest = normalizeReviewRequest(request);
  if (!Number.isInteger(pullNumber) || pullNumber <= 0) throw new Error("Pull Request 编号无效");
  return call(
    "github_discovery_submit_pull_request_review",
    { repoFullName: normalizedRepo, pullNumber, request: normalizedRequest },
    async () => (await fallbackModule.load()).submitPullRequestReviewFallback(
      normalizedRepo,
      pullNumber,
      normalizedRequest,
    ),
  );
}

function requireRepoFullName(repoFullName: string): string {
  const normalized = repoFullName.trim();
  if (!normalized || normalized.split("/").length !== 2) throw new Error("仓库名称无效");
  return normalized;
}

function normalizeRepoFullNames(repoFullNames: readonly string[]): string[] {
  const seen = new Set<string>();
  return repoFullNames.flatMap((value) => {
    const repoFullName = requireRepoFullName(value);
    const key = repoFullName.toLocaleLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [repoFullName];
  });
}

function normalizeReviewRequest(request: DiscoveryPullRequestReviewRequest): DiscoveryPullRequestReviewRequest {
  if (!["approve", "request_changes", "comment"].includes(request.event)) {
    throw new Error("Review 类型无效");
  }
  const body = request.body?.trim() || null;
  if (request.event !== "approve" && !body) throw new Error("提交此 Review 时必须填写内容");
  return { event: request.event, body };
}

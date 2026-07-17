import { invoke } from "../../tauri/runtime";
import { createCachedAsyncModule } from "../../utils/asyncModule";
import { resolveWorkspaceRuntimeForTests } from "../workspace/client";
import type {
  WorkspaceCommandArgs,
  WorkspaceCommandName,
  WorkspaceCommandResult,
} from "../workspace/contracts";
import type {
  DiscoveryCommandOptions,
  DiscoveryPullRequestReviewRequest,
  DiscoveryRepositoryStatus,
} from "./types";

const isTest = typeof import.meta !== "undefined" && import.meta.env?.MODE === "test";
const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV === true;
const fallbackModule = createCachedAsyncModule(() => import("./fallback"));

export async function getGitHubDiscoveryRepositoryStatus(
  repoFullName: string,
  options: DiscoveryCommandOptions = {},
): Promise<DiscoveryRepositoryStatus> {
  const normalizedRepo = requireRepoFullName(repoFullName);
  return callDiscoveryCommand(
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
  return callDiscoveryCommand(
    "github_discovery_submit_pull_request_review",
    { repoFullName: normalizedRepo, pullNumber, request: normalizedRequest },
    async () => (await fallbackModule.load()).submitPullRequestReviewFallback(
      normalizedRepo,
      pullNumber,
      normalizedRequest,
    ),
  );
}

async function callDiscoveryCommand<TCommand extends WorkspaceCommandName>(
  command: TCommand,
  args: WorkspaceCommandArgs<TCommand>,
  fallback: () => Promise<WorkspaceCommandResult<TCommand>>,
): Promise<WorkspaceCommandResult<TCommand>> {
  const hasWindow = typeof window !== "undefined";
  const runtime = resolveWorkspaceRuntimeForTests({
    hasWindow,
    hasTauriInternals: hasWindow && "__TAURI_INTERNALS__" in window,
    isDev,
    isTest,
  });
  if (runtime === "tauri") return invoke<WorkspaceCommandResult<TCommand>>(command, args);
  if (runtime === "mock") return fallback();
  throw new Error("此操作需要在桌面应用中完成");
}

function requireRepoFullName(repoFullName: string): string {
  const normalized = repoFullName.trim();
  if (!normalized || normalized.split("/").length !== 2) throw new Error("仓库名称无效");
  return normalized;
}

function normalizeReviewRequest(request: DiscoveryPullRequestReviewRequest): DiscoveryPullRequestReviewRequest {
  if (!["approve", "request_changes", "comment"].includes(request.event)) {
    throw new Error("Review 类型无效");
  }
  const body = request.body?.trim() || null;
  if (request.event !== "approve" && !body) throw new Error("提交此 Review 时必须填写内容");
  return { event: request.event, body };
}

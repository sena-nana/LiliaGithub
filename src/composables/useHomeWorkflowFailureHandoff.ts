import { reactive } from "vue";
import {
  buildWorkflowFailureHandoff,
  createLiliaCodeTaskHandoff,
  openLiliaCodeTaskHandoffResult,
  waitForLiliaCodeTaskHandoff,
  type LiliaCodeTaskHandoff,
  type LiliaCodeTaskHandoffStatus,
} from "../services/liliaCodeHandoff";
import {
  getGitHubWorkflowJobLog,
  getGitHubWorkflowRunDetail,
  type GitHubWorkflowRun,
  type GitHubWorkflowRunDetail,
  type RepoSummary,
} from "../services/workspace";
import { githubRepositoryIdentityKey, normalizeRemoteRepoFullName } from "../utils/remoteRepo";
import { representativeReposByGitHubFullName } from "../utils/repoWorktree";
import { errorExcerptFromLog, workflowFailureSummary } from "../utils/workflowDiagnostics";

const HANDOFF_POLL_OPTIONS = { attempts: 4, intervalMs: 250 } as const;
const MAX_LOG_EXCERPT_LINES = 8;
const MAX_LOG_LINE_LENGTH = 500;
const MAX_LOG_SUMMARY_LENGTH = 12_000;
const FAILURE_CONCLUSIONS = new Set(["failure", "timed_out", "action_required", "startup_failure"]);

export interface WorkflowFailureHandoffSession {
  draft: LiliaCodeTaskHandoff | null;
  status: LiliaCodeTaskHandoffStatus | null;
  busy: "diagnostics" | "handoff" | "open" | null;
  error: string | null;
}

interface HomeWorkflowFailureHandoffInput {
  itemId: string;
  repoFullName: string;
  run: GitHubWorkflowRun;
  worktree: RepoSummary;
  sourceRoute: string;
}

export function isWorkflowFailureHandoffRun(run: GitHubWorkflowRun) {
  return run.status === "completed" && FAILURE_CONCLUSIONS.has(run.conclusion ?? "");
}

export function findWorkflowFailureWorktree(
  repos: readonly RepoSummary[],
  repoFullName: string,
  runBranch: string,
): RepoSummary | null {
  const normalizedFullName = normalizeRemoteRepoFullName(repoFullName);
  if (!normalizedFullName || !runBranch.trim()) return null;
  const identity = githubRepositoryIdentityKey(normalizedFullName);
  const candidates = repos.filter((repo) =>
    repo.path.trim().length > 0
    && repo.currentBranch === runBranch
    && repo.githubFullName != null
    && githubRepositoryIdentityKey(repo.githubFullName) === identity
  );
  return representativeReposByGitHubFullName(candidates).get(identity) ?? null;
}

export function useHomeWorkflowFailureHandoff() {
  const sessions = new Map<string, WorkflowFailureHandoffSession>();

  function getSession(itemId: string): WorkflowFailureHandoffSession {
    const current = sessions.get(itemId);
    if (current) return current;
    const session = reactive({
      draft: null as LiliaCodeTaskHandoff | null,
      status: null as LiliaCodeTaskHandoffStatus | null,
      busy: null,
      error: null as string | null,
    }) as WorkflowFailureHandoffSession;
    sessions.set(itemId, session);
    return session;
  }

  async function handoff(input: HomeWorkflowFailureHandoffInput): Promise<void> {
    const session = getSession(input.itemId);
    if (session.busy || session.status?.status === "accepted") return;
    session.error = null;
    try {
      if (!session.draft) {
        session.busy = "diagnostics";
        session.draft = await buildHandoffDraft(input);
      }

      session.busy = "handoff";
      let status = session.status;
      if (status?.status === "pending") {
        status = await waitForLiliaCodeTaskHandoff(session.draft.id, HANDOFF_POLL_OPTIONS);
      } else {
        status = await createLiliaCodeTaskHandoff(session.draft);
        if (status.status === "pending") {
          status = await waitForLiliaCodeTaskHandoff(session.draft.id, HANDOFF_POLL_OPTIONS);
        }
      }
      session.status = status;
      session.error = handoffStatusError(status);
    } catch (reason) {
      session.error = cleanError(reason);
    } finally {
      session.busy = null;
    }
  }

  async function openResult(itemId: string): Promise<void> {
    const session = getSession(itemId);
    const status = session.status;
    if (session.busy || status?.status !== "accepted" || !status.resultRoute) return;
    session.busy = "open";
    session.error = null;
    try {
      await openLiliaCodeTaskHandoffResult(status.handoffId);
    } catch (reason) {
      session.error = cleanError(reason);
    } finally {
      session.busy = null;
    }
  }

  return { getSession, handoff, openResult };
}

async function buildHandoffDraft(input: HomeWorkflowFailureHandoffInput) {
  assertHandoffInput(input);
  const detail = await getGitHubWorkflowRunDetail(input.repoFullName, input.run.id);
  assertCurrentWorkflowDetail(input, detail);
  const logSummary = await buildLogSummary(input.repoFullName, detail);
  const workflowPath = detail.workflow?.path.trim();
  return buildWorkflowFailureHandoff({
    repository: {
      fullName: normalizeRemoteRepoFullName(input.repoFullName),
      worktreePath: input.worktree.path,
      branch: detail.run.branch,
      remoteUrl: input.worktree.canonicalRemoteUrl ?? input.worktree.remoteUrl,
    },
    run: detail.run,
    sourceRoute: input.sourceRoute,
    logSummary,
    relatedFiles: workflowPath ? [workflowPath] : [],
  });
}

function assertCurrentWorkflowDetail(
  input: HomeWorkflowFailureHandoffInput,
  detail: GitHubWorkflowRunDetail,
) {
  if (
    detail.run.id !== input.run.id
    || detail.run.branch !== input.run.branch
    || detail.run.branch !== input.worktree.currentBranch
    || !isWorkflowFailureHandoffRun(detail.run)
  ) {
    throw new Error("Workflow 状态或分支已变化，请刷新后重试。");
  }
}

function assertHandoffInput(input: HomeWorkflowFailureHandoffInput) {
  const normalizedFullName = normalizeRemoteRepoFullName(input.repoFullName);
  if (!isWorkflowFailureHandoffRun(input.run)) {
    throw new Error("只有已完成且失败的 Workflow 才能交给 LiliaCode。");
  }
  if (!normalizedFullName || !input.run.branch.trim()) {
    throw new Error("失败 Workflow 缺少仓库或分支信息，无法创建任务交接。");
  }
  if (
    !input.worktree.path.trim()
    || input.worktree.currentBranch !== input.run.branch
    || !input.worktree.githubFullName
    || githubRepositoryIdentityKey(input.worktree.githubFullName) !== githubRepositoryIdentityKey(normalizedFullName)
  ) {
    throw new Error("未找到失败分支对应的本地 worktree，无法创建任务交接。");
  }
}

async function buildLogSummary(repoFullName: string, detail: GitHubWorkflowRunDetail) {
  const failure = workflowFailureSummary(detail.jobs);
  const lines = [`Run 结论：${detail.run.conclusion ?? detail.run.status}`];
  if (!failure.failedJobs.length) {
    lines.push(
      "GitHub 未提供失败 job，Workflow 可能在 job 启动前失败；请从 run 级状态继续诊断。",
    );
    return boundSummary(lines.join("\n"));
  }

  const logResults = await Promise.allSettled(
    failure.failedJobs.map((job) => getGitHubWorkflowJobLog(repoFullName, job.id)),
  );
  if (logResults.every((result) => result.status === "rejected")) {
    throw new Error("失败 Workflow 的诊断日志暂时无法读取，请稍后重试。");
  }

  failure.failedJobs.forEach((job, index) => {
    const failedSteps = failure.failedSteps
      .filter((item) => item.job.id === job.id)
      .map((item) => `${item.step.name} (${item.step.conclusion ?? item.step.status})`);
    lines.push("", `失败 job：${job.name} (${job.conclusion ?? job.status})`);
    if (failedSteps.length) lines.push(`失败 step：${failedSteps.join("；")}`);

    const result = logResults[index];
    if (result?.status === "fulfilled") {
      lines.push("日志摘录：", logExcerpt(result.value.content));
    } else {
      const reason = result?.status === "rejected" ? `：${cleanError(result.reason)}` : "";
      lines.push(`该 job 的诊断日志未能读取${reason}`);
    }
  });
  return boundSummary(lines.join("\n"));
}

function logExcerpt(log: string) {
  const excerpt = errorExcerptFromLog(log, MAX_LOG_EXCERPT_LINES) || boundedLogTail(log);
  return excerpt
    .split(/\r?\n/)
    .map((line) => line.slice(0, MAX_LOG_LINE_LENGTH))
    .join("\n")
    .trim() || "日志内容为空。";
}

function boundedLogTail(log: string) {
  return log.split(/\r?\n/).slice(-MAX_LOG_EXCERPT_LINES).join("\n").trim();
}

function boundSummary(summary: string) {
  if (summary.length <= MAX_LOG_SUMMARY_LENGTH) return summary;
  return `${summary.slice(0, MAX_LOG_SUMMARY_LENGTH - 16).trimEnd()}\n…摘录已截断`;
}

function handoffStatusError(status: LiliaCodeTaskHandoffStatus) {
  if (status.status === "incompatible") {
    return status.error?.trim() || "LiliaCode 版本暂不支持此任务，任务草稿已保留。";
  }
  if (status.status === "failed") {
    return status.error?.trim() || "LiliaCode 未能接收任务，任务草稿已保留。";
  }
  return null;
}

function cleanError(reason: unknown) {
  return String(reason).replace(/^Error:\s*/, "");
}

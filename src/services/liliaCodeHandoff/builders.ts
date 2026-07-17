import type { GitHubPullRequest, GitHubWorkflowRun } from "../workspace/types";
import {
  LILIA_CODE_TASK_HANDOFF_PROTOCOL,
  LILIA_CODE_TASK_HANDOFF_VERSION,
  type LiliaCodeTaskHandoff,
} from "./types";

type RepositoryContext = {
  fullName: string;
  worktreePath: string;
  branch: string;
  remoteUrl?: string | null;
};

function handoffId() {
  return globalThis.crypto?.randomUUID?.() ??
    `handoff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function baseHandoff(input: {
  title: string;
  kind: LiliaCodeTaskHandoff["kind"];
  repository: RepositoryContext;
  sourceRoute: string;
  objectUrl?: string | null;
  problem: string;
  relatedFiles?: string[];
  logSummary?: string | null;
  acceptanceCriteria: string[];
}): LiliaCodeTaskHandoff {
  return {
    protocol: LILIA_CODE_TASK_HANDOFF_PROTOCOL,
    version: LILIA_CODE_TASK_HANDOFF_VERSION,
    id: handoffId(),
    createdAt: new Date().toISOString(),
    title: input.title.trim(),
    kind: input.kind,
    repository: input.repository,
    source: {
      application: "LiliaGithub",
      route: input.sourceRoute,
      objectUrl: input.objectUrl ?? null,
    },
    problem: input.problem.trim(),
    relatedFiles: [...new Set(input.relatedFiles ?? [])],
    logSummary: input.logSummary?.trim() || null,
    acceptanceCriteria: input.acceptanceCriteria.map((item) => item.trim()).filter(Boolean),
  };
}

export function buildPullRequestReviewHandoff(input: {
  repository: RepositoryContext;
  pull: GitHubPullRequest;
  sourceRoute: string;
  reviewRequirements: string[];
  relatedFiles?: string[];
  baseSha?: string | null;
  headSha?: string | null;
}): LiliaCodeTaskHandoff {
  const reviewRequirements = input.reviewRequirements
    .map((item) => item.trim())
    .filter(Boolean);
  if (!reviewRequirements.length) {
    reviewRequirements.push(`检查并处理 ${input.pull.title} 的审查要求。`);
  }
  return {
    ...baseHandoff({
      title: `处理 PR #${input.pull.number} 审查意见`,
      kind: "pullRequestReview",
      repository: input.repository,
      sourceRoute: input.sourceRoute,
      objectUrl: input.pull.htmlUrl,
      problem: reviewRequirements.join("\n"),
      relatedFiles: input.relatedFiles,
      acceptanceCriteria: [
        "逐项处理审查要求并保留可验证的修改",
        "运行与改动范围匹配的测试或检查",
        "确认分支可用于继续 Pull Request review",
      ],
    }),
    pullRequest: {
      number: input.pull.number,
      baseBranch: input.pull.baseBranch,
      headBranch: input.pull.headBranch,
      baseSha: input.baseSha ?? null,
      headSha: input.headSha ?? null,
      reviewRequirements,
    },
  };
}

export function buildWorkflowFailureHandoff(input: {
  repository: RepositoryContext;
  run: GitHubWorkflowRun;
  sourceRoute: string;
  logSummary: string;
  relatedFiles?: string[];
}): LiliaCodeTaskHandoff {
  return {
    ...baseHandoff({
      title: `修复 ${input.run.name} 失败`,
      kind: "workflowFailure",
      repository: input.repository,
      sourceRoute: input.sourceRoute,
      objectUrl: input.run.htmlUrl,
      problem: `Workflow ${input.run.name} 的 run #${input.run.runNumber ?? input.run.id} 失败，需要定位根因并修复。`,
      relatedFiles: input.relatedFiles,
      logSummary: input.logSummary,
      acceptanceCriteria: [
        "定位失败的根本原因而不是绕过检查",
        "修复后运行对应的本地验证",
        "保留能证明原失败已消失的结果",
      ],
    }),
    workflow: {
      runId: input.run.id,
      runUrl: input.run.htmlUrl,
      workflowName: input.run.name,
    },
  };
}

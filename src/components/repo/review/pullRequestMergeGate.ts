import type { PullRequestCodeReviewDetail } from "../../../services/codeReview";
import type { GitHubPullRequest, GitHubPullRequestCheck } from "../../../services/workspace/types";

export type PullRequestMergeGate = {
  allowed: boolean;
  reasons: string[];
  warnings: string[];
};

const successfulConclusions = new Set(["success", "neutral", "skipped"]);

function normalized(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() ?? "";
}

export function evaluatePullRequestMergeGate(
  pull: Pick<GitHubPullRequest, "state" | "merged" | "draft">,
  checks: readonly GitHubPullRequestCheck[],
  detail: PullRequestCodeReviewDetail | null,
): PullRequestMergeGate {
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (pull.state !== "open" || pull.merged) reasons.push("Pull Request 当前不是可合并的开启状态。");
  if (pull.draft) reasons.push("Draft Pull Request 需要先标记为 Ready for review。");
  if (!detail) reasons.push("正在确认合并条件。");
  if (detail?.mergeable === false) reasons.push("分支存在冲突，当前无法合并。");
  if (detail?.mergeable == null) reasons.push("GitHub 尚未完成 mergeability 计算。");

  const mergeState = normalized(detail?.mergeStateStatus);
  if (detail && !mergeState) reasons.push("GitHub 尚未返回完整的合并状态。");
  if (["blocked", "dirty", "draft", "unknown", "behind", "unstable"].includes(mergeState)) {
    reasons.push(`GitHub 合并状态为 ${detail?.mergeStateStatus ?? "UNKNOWN"}。`);
  }

  const reviewDecision = normalized(detail?.reviewDecision);
  if (reviewDecision === "changes_requested") reasons.push("仍有 reviewer 请求修改。");
  if (reviewDecision === "review_required") reasons.push("仍缺少必需的 review。");
  if ((detail?.branchProtection.requiredApprovals ?? 0) > 0 && reviewDecision !== "approved") {
    reasons.push(`分支保护要求 ${detail?.branchProtection.requiredApprovals} 个批准。`);
  }
  if (detail?.branchProtection.requireCodeOwnerReviews && reviewDecision !== "approved") {
    reasons.push("分支保护要求 Code Owner 批准。");
  }

  const requiredChecks = detail?.branchProtection.requiredStatusChecks ?? [];
  for (const requiredName of requiredChecks) {
    const check = checks.find((item) => normalized(item.name) === normalized(requiredName));
    if (!check) {
      reasons.push(`必需检查 ${requiredName} 尚未报告结果。`);
      continue;
    }
    if (normalized(check.status) !== "completed") {
      reasons.push(`必需检查 ${requiredName} 仍在运行。`);
      continue;
    }
    if (!successfulConclusions.has(normalized(check.conclusion))) {
      reasons.push(`必需检查 ${requiredName} 未通过。`);
    }
  }

  if (detail?.branchProtection.requireConversationResolution) {
    const unresolvedCount = detail.threads.filter((thread) => !thread.isResolved).length;
    if (unresolvedCount) reasons.push(`分支保护要求先解决 ${unresolvedCount} 个 review thread。`);
  }
  if (detail && !detail.branchProtection.available) {
    reasons.push("无法确认目标分支的保护规则，请刷新后重试。");
    warnings.push("在分支保护规则可验证前不会执行合并。");
  }

  return {
    allowed: reasons.length === 0,
    reasons: [...new Set(reasons)],
    warnings: [...new Set(warnings)],
  };
}

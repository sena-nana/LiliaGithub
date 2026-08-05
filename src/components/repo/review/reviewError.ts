import { errorMessage, workspaceErrorCategory } from "../../../services/workspace/errors";

export function codeReviewErrorMessage(reason: unknown, options: { draftPreserved?: boolean } = {}) {
  const message = errorMessage(reason) || "操作失败，请重试。";
  const category = workspaceErrorCategory(reason);
  const preserved = options.draftPreserved ? "草稿已保留；" : "";
  if (category === "authentication" || category === "authorization") {
    return `当前 GitHub 授权不允许此操作，${preserved}请重新绑定并授予仓库写入权限。`;
  }
  if (category === "network" || category === "rate-limit") {
    return `暂时无法连接 GitHub，${preserved}请检查网络后重试。`;
  }
  if (category === "not-found" || category === "conflict" || category === "validation") {
    return `Review 上下文已经变化或不存在，${preserved}请刷新后重试。`;
  }
  return message;
}

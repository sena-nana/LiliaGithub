export function isGitHubBindingExpiredError(err: unknown): boolean {
  const message = String(err);
  return message.includes("GitHub 绑定已失效") ||
    message.includes("HTTP 401") ||
    message.toLowerCase().includes("bad credentials");
}

export function githubErrorCode(error: unknown): string | null {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/^Error:\s*/, "")
    .trim();
  return message.match(/^(github_[a-z0-9_]+)\s*[:：]/i)?.[1]?.toLocaleLowerCase() ?? null;
}

export function isGitHubPermissionError(error: unknown): boolean {
  const code = githubErrorCode(error);
  return code === "github_forbidden"
    || code === "github_org_sso_required"
    || code === "github_notifications_scope_required";
}

export function isConfirmedMissingResource(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = githubErrorCode(error);
  if (code === "github_repository_not_accessible") return true;
  if (
    code === "github_authentication_required" ||
    code === "github_forbidden" ||
    code === "github_org_sso_required" ||
    code === "github_rate_limited" ||
    /连接失败|网络|代理|证书|timed?\s*out|connection|dns|host not found/i.test(message) ||
    /未找到 GitHub (?:绑定|凭证|token)/i.test(message)
  ) return false;
  return /\bHTTP\s+404\b|\b404\s+not[ -]?found\b|不存在|已删除|未找到/i.test(message);
}

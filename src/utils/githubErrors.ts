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

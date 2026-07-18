export const REQUIRED_GITHUB_AUTH_SCOPES = [
  "repo",
  "workflow",
  "user",
  "read:org",
  "delete_repo",
  "read:project",
  "notifications",
] as const;

export function hasCompleteGitHubAuthorization(scopes: readonly string[] | null | undefined) {
  return REQUIRED_GITHUB_AUTH_SCOPES.every((scope) => scopes?.includes(scope) === true);
}

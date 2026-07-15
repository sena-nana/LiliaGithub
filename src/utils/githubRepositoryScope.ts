import type {
  GitHubRepoOwner,
  GitHubRepositoryPermissions,
  GitHubRepositoryScope,
} from "../services/workspace";

export const ALL_GITHUB_REPOSITORIES: GitHubRepositoryScope = { kind: "all" };

export function githubRepositoryScopeKey(scope: GitHubRepositoryScope) {
  return scope.kind === "all" ? "all" : `${scope.kind}:${scope.login.toLocaleLowerCase()}`;
}

export function githubRepositoryScopeQuery(scope: GitHubRepositoryScope) {
  return scope.kind === "all"
    ? { githubScope: "all", githubOwner: undefined }
    : { githubScope: scope.kind, githubOwner: scope.login };
}

export function githubRepositoryScopeFromQuery(
  scopeValue: unknown,
  ownerValue: unknown,
  personalLogin: string,
  owners: readonly GitHubRepoOwner[],
): GitHubRepositoryScope {
  const scope = Array.isArray(scopeValue) ? scopeValue[0] : scopeValue;
  const owner = String(Array.isArray(ownerValue) ? ownerValue[0] ?? "" : ownerValue ?? "").trim();
  if (scope === "personal" && personalLogin && owner.toLocaleLowerCase() === personalLogin.toLocaleLowerCase()) {
    return { kind: "personal", login: personalLogin };
  }
  if (scope === "organization" && owner) {
    const organization = owners.find((item) =>
      item.kind === "organization" && item.login.toLocaleLowerCase() === owner.toLocaleLowerCase()
    );
    if (organization) return { kind: "organization", login: organization.login };
  }
  return ALL_GITHUB_REPOSITORIES;
}

export function githubOrganizationOwners(owners: readonly GitHubRepoOwner[]) {
  return owners
    .filter((owner) => owner.kind === "organization")
    .sort((left, right) => left.login.localeCompare(right.login));
}

export function githubOrganizationAccessLimited(
  scopes: readonly string[] | null | undefined,
  owners: readonly GitHubRepoOwner[] = [],
) {
  return Boolean(
    (scopes && !scopes.includes("read:org"))
    || owners.some((owner) => !owner.membershipComplete),
  );
}

export function githubOrganizationAccessRecovery(owners: readonly GitHubRepoOwner[] = []) {
  const restricted = owners.find((owner) => !owner.membershipComplete && owner.membershipRestriction);
  return {
    restriction: restricted?.membershipRestriction ?? null,
    url: restricted?.membershipRecoveryUrl ?? null,
  };
}

export function githubOrganizationAccessMessage(owners: readonly GitHubRepoOwner[] = []) {
  const { restriction } = githubOrganizationAccessRecovery(owners);
  if (restriction === "sso_required") {
    return "组织要求额外的 SSO 授权；完成授权后可刷新组织成员关系，现有仓库仍可使用。";
  }
  if (restriction === "forbidden") {
    return "当前授权无法读取完整组织成员关系；请检查组织权限，现有仓库仍可使用。";
  }
  return "组织信息可能不完整，现有仓库仍可继续使用。";
}

export function githubRepositoryPermissionLabel(
  permissions: GitHubRepositoryPermissions | null | undefined,
) {
  if (!permissions) return null;
  if (permissions.admin) return "管理";
  if (permissions.push) return "可推送";
  if (permissions.pull) return "只读";
  return "无访问权限";
}

export function githubUserFacingError(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/^Error:\s*/, "")
    .trim();
  const code = message.match(/^((?:github|workspace)_[a-z_]+)\s*[:：]/i)?.[1]?.toLocaleLowerCase();
  const knownMessages: Record<string, string> = {
    github_org_sso_required: "组织要求额外的 SSO 授权，请在 GitHub 完成授权后重试。",
    github_org_membership_forbidden: "当前授权无法在该组织创建仓库，请检查组织权限或重新授权。",
    github_repository_policy_restricted: "组织策略不允许当前操作，请联系组织管理员或调整目标设置。",
    github_owner_not_found: "未找到目标账号或组织，请确认仓库归属。",
    github_repository_name_conflict: "该账号或组织中已存在同名仓库，请更换名称。",
    github_repository_invalid: "仓库设置无效，请检查名称和创建选项后重试。",
  };
  return (code && knownMessages[code])
    || message.replace(/^(?:github|workspace)_[a-z_]+\s*[:：]\s*/i, "");
}

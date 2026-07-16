import type {
  GitHubRepoOwner,
  GitHubRepoSummary,
  WorkspaceRepoPlacement,
} from "../services/workspace";

type RepoGroupPlacementTarget = {
  readonly id: string;
  readonly name: string;
  readonly repoIds: readonly string[];
  readonly organizationLogin?: string | null;
};

export const AUTOMATIC_REPO_GROUP_VALUE = "__automatic__";
export const UNGROUPED_REPO_GROUP_VALUE = "__ungrouped__";

export function organizationLoginForRepo(
  repo: GitHubRepoSummary | null,
  organizations: readonly GitHubRepoOwner[],
) {
  if (repo?.owner?.kind === "organization") return repo.owner.login;
  return organizationLoginForFullName(repo?.fullName ?? null, organizations);
}

export function organizationLoginForFullName(
  fullName: string | null,
  organizations: readonly GitHubRepoOwner[],
) {
  const owner = fullName?.split("/", 1)[0]?.trim();
  if (!owner) return null;
  return organizations.find((organization) =>
    organization.login.localeCompare(owner, undefined, { sensitivity: "accent" }) === 0
  )?.login ?? null;
}

export function organizationGroup(
  groups: readonly RepoGroupPlacementTarget[],
  organizationLogin: string | null,
) {
  if (!organizationLogin) return null;
  return groups.find((group) =>
    group.organizationLogin?.localeCompare(organizationLogin, undefined, { sensitivity: "accent" }) === 0
  ) ?? null;
}

export function repoPlacementValue(placement: WorkspaceRepoPlacement) {
  if (placement.kind === "automatic") return AUTOMATIC_REPO_GROUP_VALUE;
  if (placement.kind === "ungrouped") return UNGROUPED_REPO_GROUP_VALUE;
  return placement.groupId;
}

export function repoPlacementFromValue(value: string): WorkspaceRepoPlacement {
  if (value === AUTOMATIC_REPO_GROUP_VALUE) return { kind: "automatic" };
  if (value === UNGROUPED_REPO_GROUP_VALUE) return { kind: "ungrouped" };
  return { kind: "group", groupId: value };
}

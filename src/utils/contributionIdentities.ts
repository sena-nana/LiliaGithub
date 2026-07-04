import type { ContributionIdentity } from "../services/workspace";

export function normalizeContributionIdentity(identity: ContributionIdentity): ContributionIdentity | null {
  const name = identity.name?.trim() || null;
  const email = identity.email?.trim().toLowerCase() || null;
  if (!name && !email) return null;
  return { name, email };
}

export function normalizeContributionIdentities(
  identities: readonly ContributionIdentity[],
): ContributionIdentity[] {
  const normalized: ContributionIdentity[] = [];
  const seen = new Set<string>();
  for (const identity of identities) {
    const next = normalizeContributionIdentity(identity);
    if (!next) continue;
    const key = contributionIdentityKey(next);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(next);
  }
  return normalized;
}

export function mergeContributionIdentity(
  identities: readonly ContributionIdentity[],
  identity: ContributionIdentity,
): ContributionIdentity[] {
  return normalizeContributionIdentities([...identities, identity]);
}

export function contributionIdentityKey(identity: ContributionIdentity): string {
  return `${identity.name?.trim().toLowerCase() ?? ""}\u001f${identity.email?.trim().toLowerCase() ?? ""}`;
}

export function isLocalRepositoryConfirmedMissing(input: {
  repoId: string;
  remoteRepo: boolean;
  loading: boolean;
  scanning: boolean;
  activeWorkspaceId: string | null;
  rootsAvailable: boolean;
  verifiedWorkspaceId: string | null;
  repoPresent: boolean;
}) {
  return Boolean(
    input.repoId &&
    !input.remoteRepo &&
    !input.loading &&
    !input.scanning &&
    input.rootsAvailable &&
    input.activeWorkspaceId &&
    input.verifiedWorkspaceId === input.activeWorkspaceId &&
    !input.repoPresent
  );
}

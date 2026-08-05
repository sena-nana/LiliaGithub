import { computed, onUnmounted, ref, watch } from "vue";
import {
  githubOrganizationAccessLimited,
  githubOrganizationAccessMessage,
  githubOrganizationAccessRecovery,
  githubOrganizationOwners,
  githubUserFacingError,
} from "../../utils/githubRepositoryScope";
import type { ComponentEpoch } from "../useComponentEpoch";
import { createLatestAsyncLoader } from "../useLatestAsyncLoader";
import type { WorkspaceStore } from "../workspace/store";
import type { GitHubRepoOwner } from "../../services/workspace";

export function useSecondaryPanelOrganizationsController(
  workspace: WorkspaceStore,
  componentEpoch: Pick<ComponentEpoch, "assertAlive">,
) {
  const ownersLoader = createLatestAsyncLoader({ componentEpoch, trackSessionContext: false });
  const groupsLoader = createLatestAsyncLoader({ componentEpoch, trackSessionContext: false });
  const owners = ref<GitHubRepoOwner[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const organizations = computed(() => githubOrganizationOwners(owners.value));
  const organizationLogins = computed(() => organizations.value.map((owner) => owner.login));
  const visibilityLimited = computed(() =>
    githubOrganizationAccessLimited(workspace.githubBinding.value?.scopes, owners.value),
  );
  const recovery = computed(() => githubOrganizationAccessRecovery(owners.value));
  const visibilityMessage = computed(() => githubOrganizationAccessMessage(owners.value));

  async function reconcileGroups() {
    if (!organizationLogins.value.length || !workspace.state.settings?.managedRepoIds.length) return;
    await groupsLoader.run("organization-repo-groups", async () => {
      await workspace.reconcileOrganizationRepoGroups([...organizationLogins.value]);
    });
  }

  async function load(options: { force?: boolean } = {}) {
    if (!workspace.isAuthorized.value) return;
    await ownersLoader.run(`sidebar-github-owners:${options.force ? "force" : "cache"}`, async (runId) => {
      loading.value = true;
      error.value = null;
      try {
        const value = await workspace.getAccountRepositoryOwners(options);
        if (ownersLoader.isCurrent(runId)) owners.value = value;
      } catch (cause) {
        if (ownersLoader.isCurrent(runId)) error.value = `账号与组织加载失败：${githubUserFacingError(cause)}`;
      } finally {
        if (ownersLoader.isCurrent(runId)) loading.value = false;
      }
    });
  }

  function reset() {
    ownersLoader.invalidate();
    owners.value = [];
    error.value = null;
    loading.value = false;
  }

  watch(
    () => [
      workspace.isAuthorized.value,
      workspace.githubBinding.value?.login,
      workspace.githubBinding.value?.boundAt,
      [...(workspace.githubBinding.value?.scopes ?? [])].sort().join(" "),
    ] as const,
    ([authorized]) => {
      reset();
      if (authorized) void load();
    },
    { immediate: true },
  );

  watch(
    () => [
      organizationLogins.value.map((login) => login.toLocaleLowerCase()).sort().join("\n"),
      workspace.state.repoListChange.revision,
    ] as const,
    ([organizationKey]) => {
      if (organizationKey) void reconcileGroups().catch(() => undefined);
    },
    { immediate: true },
  );

  onUnmounted(() => {
    ownersLoader.invalidate();
    groupsLoader.invalidate();
  });

  return {
    owners,
    loading,
    error,
    organizations,
    organizationLogins,
    visibilityLimited,
    recovery,
    visibilityMessage,
    load,
  };
}

import { computed, nextTick, ref, shallowRef, watch } from "vue";
import { buildCalendarHeatmapModel } from "@lilia/ui/calendar";
import type {
  ContributionIdentityRecommendation,
  ContributionIdentityRecommendationResult,
} from "../../services/workspace";
import { contributionIdentityKey, mergeContributionIdentity } from "../../utils/contributionIdentities";
import type { ComponentEpoch } from "../useComponentEpoch";
import type { GitHubContributionsState } from "../workspace/state";
import type { WorkspaceStore } from "../workspace/store";

export function useHomeContributionController(
  workspace: WorkspaceStore,
  componentEpoch: Pick<ComponentEpoch, "assertAlive">,
) {
  const snapshot = shallowRef<GitHubContributionsState | null>(null);
  const recommendations = ref<ContributionIdentityRecommendationResult | null>(null);
  const scanning = ref(false);
  const savingKey = ref<string | null>(null);
  const error = ref<string | null>(null);
  const panelOpen = ref(false);
  let refreshGeneration = 0;

  const view = computed(() => snapshot.value ?? {
    ...workspace.state.githubContributions,
    loading: workspace.state.loading || workspace.state.githubContributions.loading,
  });
  const chartModel = computed(() => buildCalendarHeatmapModel(
    view.value.days.map((day) => ({ date: day.date, value: day.count })),
    {
      cellSize: 13,
      cellGap: 3,
      cellRadius: 3,
      titleFormatter: (day) => `${day.date}：${day.value} 次提交`,
    },
  ));
  const total = computed(() => view.value.days.reduce((sum, day) => sum + day.count, 0));
  const hasDays = computed(() => view.value.days.length > 0);
  const skippedRepoCount = computed(() => view.value.meta?.skippedRepoCount ?? 0);
  const identityPanelVisible = computed(() => panelOpen.value && (
    scanning.value || error.value !== null || recommendations.value !== null
  ));

  function cloneCurrent(): GitHubContributionsState {
    const contributions = workspace.state.githubContributions;
    return {
      days: contributions.days.map((day) => ({
        ...day,
        repositories: day.repositories?.map((repo) => ({ ...repo })) ?? [],
      })),
      meta: contributions.meta ? { ...contributions.meta } : null,
      loading: contributions.loading,
      error: contributions.error,
    };
  }

  function commit() {
    snapshot.value = cloneCurrent();
  }

  function refreshSettled() {
    const contributions = workspace.state.githubContributions;
    return !contributions.loading && (
      contributions.days.length > 0 || contributions.meta !== null || contributions.error !== null
    );
  }

  function commitInitial() {
    if (!workspace.isReady.value || snapshot.value || !refreshSettled()) return;
    commit();
  }

  async function waitForRefresh() {
    if (!workspace.state.githubContributions.loading) return;
    await new Promise<void>((resolve) => {
      const stop = watch(
        () => workspace.state.githubContributions.loading,
        (loading) => {
          if (loading) return;
          stop();
          resolve();
        },
      );
    });
  }

  async function refresh(options: { requireReady?: boolean } = {}) {
    const generation = ++refreshGeneration;
    await workspace.refreshRepoContributions();
    await nextTick();
    await waitForRefresh();
    if (generation !== refreshGeneration || !componentEpoch.assertAlive()) return;
    if (options.requireReady !== false && !workspace.isReady.value) return;
    commit();
  }

  function invalidate() {
    refreshGeneration += 1;
  }

  function resetSnapshot() {
    invalidate();
    snapshot.value = null;
  }

  async function scanIdentities() {
    if (scanning.value || savingKey.value) return;
    panelOpen.value = true;
    scanning.value = true;
    error.value = null;
    try {
      const result = await workspace.scanContributionIdentities();
      if (componentEpoch.assertAlive()) recommendations.value = result;
    } catch (cause) {
      if (componentEpoch.assertAlive()) error.value = String(cause);
    } finally {
      if (componentEpoch.assertAlive()) scanning.value = false;
    }
  }

  async function adoptIdentity(recommendation: ContributionIdentityRecommendation) {
    const key = contributionIdentityKey(recommendation.identity);
    if (scanning.value || savingKey.value) return;
    savingKey.value = key;
    error.value = null;
    try {
      const current = workspace.state.settings?.contributionIdentities ?? [];
      await workspace.setContributionIdentities(mergeContributionIdentity(current, recommendation.identity));
      if (!componentEpoch.assertAlive()) return;
      if (recommendations.value) {
        recommendations.value = {
          ...recommendations.value,
          recommendations: recommendations.value.recommendations.filter(
            (item) => contributionIdentityKey(item.identity) !== key,
          ),
        };
      }
      if (!workspace.state.repos.length) await workspace.refreshRepos();
      await refresh({ requireReady: false });
    } catch (cause) {
      if (componentEpoch.assertAlive()) error.value = String(cause);
    } finally {
      if (componentEpoch.assertAlive()) savingKey.value = null;
    }
  }

  return {
    snapshot,
    recommendations,
    scanning,
    savingKey,
    error,
    panelOpen,
    view,
    chartModel,
    total,
    hasDays,
    skippedRepoCount,
    identityPanelVisible,
    commit,
    commitInitial,
    refresh,
    invalidate,
    resetSnapshot,
    scanIdentities,
    adoptIdentity,
  };
}

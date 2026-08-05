import { computed, onMounted, onUnmounted, ref, watch, type ComputedRef } from "vue";
import type { ProjectLaunchCandidate } from "../../services/workspace";
import { createLatestAsyncLoader } from "../useLatestAsyncLoader";
import type { WorkspaceStore } from "../workspace/store";

export function useRepoLaunchController(
  workspace: WorkspaceStore,
  repoId: ComputedRef<string>,
  available: ComputedRef<boolean>,
) {
  const error = ref<string | null>(null);
  const terminalVisible = ref(false);
  const refreshLoader = createLatestAsyncLoader();
  let logTimer: number | null = null;
  let logRefreshPending = false;

  const config = computed(() => workspace.state.launchConfigs[repoId.value] ?? null);
  const candidates = computed(() => workspace.state.launchCandidates[repoId.value] ?? []);
  const status = computed(() => workspace.state.launchStatuses[repoId.value] ?? null);
  const logs = computed(() => workspace.state.launchLogs[repoId.value] ?? []);
  const running = computed(() => status.value?.state === "running");
  const commandOptions = computed(() => {
    const values = [...candidates.value];
    const current = config.value?.command.trim()
      ? values.find((item) => item.command === config.value?.command && item.cwd === config.value?.cwd)
      : null;
    const options = current || !config.value?.command.trim()
      ? values
      : [{
          command: config.value.command,
          label: "当前指令",
          hint: config.value.cwd || null,
          kind: "current",
          cwd: config.value.cwd,
        } satisfies ProjectLaunchCandidate, ...values];
    return options.map((candidate) => ({
      value: launchOptionValue(candidate.command, candidate.cwd),
      label: candidate.label || candidate.command,
      command: candidate.command,
      hint: [candidate.kind, candidate.hint, candidate.cwd].filter(Boolean).join(" · "),
      candidate,
    }));
  });
  const activeValue = computed(() => launchOptionValue(config.value?.command ?? "", config.value?.cwd ?? null));

  async function validateStatus() {
    const targetRepoId = repoId.value;
    if (!targetRepoId || !available.value) return;
    await refreshLoader.run(targetRepoId, async (runId) => {
      try {
        await workspace.refreshLaunchStatus(targetRepoId);
        if (!refreshLoader.isCurrent(runId) || repoId.value !== targetRepoId || !available.value) return;
      } catch {
        // Explicit launch actions own user-facing errors; focus validation remains silent.
      }
    }, { reusePending: true });
  }

  function pollingActive() {
    return running.value && terminalVisible.value && document.visibilityState === "visible" && document.hasFocus();
  }

  function stopLogPolling() {
    if (logTimer === null) return;
    window.clearTimeout(logTimer);
    logTimer = null;
  }

  function syncLogPolling() {
    if (!pollingActive()) {
      stopLogPolling();
      return;
    }
    if (logTimer !== null || logRefreshPending) return;
    logTimer = window.setTimeout(() => {
      logTimer = null;
      void refreshLogs();
    }, 1500);
  }

  async function refreshLogs() {
    const targetRepoId = repoId.value;
    if (!targetRepoId || !pollingActive()) return;
    logRefreshPending = true;
    try {
      await workspace.refreshLaunchLogs(targetRepoId);
    } catch {
      // Explicit launch actions own user-facing errors; polling remains silent.
    } finally {
      logRefreshPending = false;
      if (repoId.value === targetRepoId) syncLogPolling();
    }
  }

  function reset() {
    error.value = null;
    terminalVisible.value = false;
    refreshLoader.invalidate();
    stopLogPolling();
  }

  function handleFocus() {
    void validateStatus();
    syncLogPolling();
  }

  function handleBlur() {
    stopLogPolling();
  }

  function handleVisibilityChange() {
    if (document.visibilityState !== "visible") {
      stopLogPolling();
      return;
    }
    if (document.hasFocus()) void validateStatus();
    syncLogPolling();
  }

  watch([running, terminalVisible], syncLogPolling);
  onMounted(() => {
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  });
  onUnmounted(() => {
    refreshLoader.invalidate();
    stopLogPolling();
    window.removeEventListener("focus", handleFocus);
    window.removeEventListener("blur", handleBlur);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  });

  return {
    error,
    terminalVisible,
    config,
    candidates,
    status,
    logs,
    running,
    commandOptions,
    activeValue,
    validateStatus,
    syncLogPolling,
    stopLogPolling,
    reset,
  };
}

function launchOptionValue(command: string, cwd: string | null) {
  return JSON.stringify([command, cwd ?? null]);
}

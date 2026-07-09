import { state } from "./state";
import { loadWorkspaceService } from "./serviceLoader";

let launchLoadCount = 0;
let launchStateGenerations = new Map<string, number>();
type LaunchSnapshot = {
  config: (typeof state.launchConfigs)[string];
  candidates: NonNullable<(typeof state.launchCandidates)[string]>;
  status: NonNullable<(typeof state.launchStatuses)[string]>;
  logs: NonNullable<(typeof state.launchLogs)[string]>;
  history: NonNullable<(typeof state.launchHistory)[string]>;
};
let pendingLaunchLoads = new Map<string, Promise<LaunchSnapshot>>();

function beginLaunchLoad() {
  launchLoadCount += 1;
  state.launchLoading = true;
}

function finishLaunchLoad() {
  launchLoadCount = Math.max(0, launchLoadCount - 1);
  state.launchLoading = launchLoadCount > 0;
}

function currentLaunchGeneration(repoId: string) {
  return launchStateGenerations.get(repoId) ?? 0;
}

function bumpLaunchGeneration(repoId: string) {
  const generation = currentLaunchGeneration(repoId) + 1;
  launchStateGenerations.set(repoId, generation);
  return generation;
}

function isCurrentLaunchGeneration(repoId: string, generation: number) {
  return currentLaunchGeneration(repoId) === generation;
}

function mergeLaunchLogs(
  current: NonNullable<(typeof state.launchLogs)[string]>,
  next: NonNullable<(typeof state.launchLogs)[string]>,
) {
  const byIndex = new Map(current.map((log) => [log.index, log]));
  for (const log of next) {
    byIndex.set(log.index, log);
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index).slice(-500);
}

export async function loadLaunch(repoId: string) {
  const pending = pendingLaunchLoads.get(repoId);
  if (pending) return pending;
  beginLaunchLoad();
  state.error = null;
  const generation = currentLaunchGeneration(repoId);
  const load = (async () => {
    const service = await loadWorkspaceService();
    const [config, candidates, status, logs, history] = await Promise.all([
      service.getRepoLaunchConfig(repoId),
      service.listRepoLaunchCandidates(repoId),
      service.getRepoLaunchStatus(repoId),
      service.getRepoLaunchLogs(repoId),
      service.listRepoLaunchHistory(repoId),
    ]);
    if (isCurrentLaunchGeneration(repoId, generation)) {
      state.launchConfigs[repoId] = config;
      state.launchCandidates[repoId] = candidates;
      state.launchStatuses[repoId] = status;
      state.launchLogs[repoId] = logs;
      state.launchHistory[repoId] = history;
    }
    return { config, candidates, status, logs, history };
  })();
  pendingLaunchLoads.set(repoId, load);
  try {
    return await load;
  } catch (err) {
    state.error = String(err);
    throw err;
  } finally {
    if (pendingLaunchLoads.get(repoId) === load) {
      pendingLaunchLoads.delete(repoId);
    }
    finishLaunchLoad();
  }
}

export async function saveLaunchConfig(repoId: string, command: string, cwd?: string | null) {
  const generation = bumpLaunchGeneration(repoId);
  const service = await loadWorkspaceService();
  const config = await service.saveRepoLaunchConfig(repoId, command, cwd);
  if (isCurrentLaunchGeneration(repoId, generation)) {
    state.launchConfigs[repoId] = config;
  }
  const candidates = await service.listRepoLaunchCandidates(repoId);
  if (isCurrentLaunchGeneration(repoId, generation)) {
    state.launchCandidates[repoId] = candidates;
  }
  return config;
}

export async function refreshLaunchStatus(repoId: string) {
  const generation = currentLaunchGeneration(repoId);
  const service = await loadWorkspaceService();
  const status = await service.getRepoLaunchStatus(repoId);
  if (isCurrentLaunchGeneration(repoId, generation)) {
    state.launchStatuses[repoId] = status;
  }
  return status;
}

export async function refreshLaunchLogs(repoId: string) {
  const generation = currentLaunchGeneration(repoId);
  const service = await loadWorkspaceService();
  const current = state.launchLogs[repoId] ?? [];
  const since = current.length ? current[current.length - 1].index : null;
  const next = await service.getRepoLaunchLogs(repoId, since);
  if (!isCurrentLaunchGeneration(repoId, generation)) {
    return state.launchLogs[repoId] ?? [];
  }
  if (next.length) {
    state.launchLogs[repoId] = mergeLaunchLogs(state.launchLogs[repoId] ?? [], next);
  } else {
    state.launchLogs[repoId] = state.launchLogs[repoId] ?? [];
  }
  return state.launchLogs[repoId] ?? [];
}

export async function refreshLaunchHistory(repoId: string) {
  const generation = currentLaunchGeneration(repoId);
  const service = await loadWorkspaceService();
  const history = await service.listRepoLaunchHistory(repoId);
  if (isCurrentLaunchGeneration(repoId, generation)) {
    state.launchHistory[repoId] = history;
  }
  return history;
}

export async function startLaunch(repoId: string) {
  const generation = bumpLaunchGeneration(repoId);
  const service = await loadWorkspaceService();
  state.launchLogs[repoId] = [];
  const status = await service.startRepoLaunch(repoId);
  if (isCurrentLaunchGeneration(repoId, generation)) {
    state.launchStatuses[repoId] = status;
    await refreshLaunchLogs(repoId);
    await refreshLaunchHistory(repoId);
  }
  return status;
}

export async function stopLaunch(repoId: string) {
  const generation = bumpLaunchGeneration(repoId);
  const service = await loadWorkspaceService();
  const status = await service.stopRepoLaunch(repoId);
  if (isCurrentLaunchGeneration(repoId, generation)) {
    state.launchStatuses[repoId] = status;
    await refreshLaunchLogs(repoId);
    await refreshLaunchHistory(repoId);
  }
  return status;
}

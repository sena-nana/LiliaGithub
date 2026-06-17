import { state } from "./state";
import { loadWorkspaceService } from "./serviceLoader";

export async function loadLaunch(repoId: string) {
  state.launchLoading = true;
  state.error = null;
  try {
    const service = await loadWorkspaceService();
    const [config, candidates, status, logs] = await Promise.all([
      service.getRepoLaunchConfig(repoId),
      service.listRepoLaunchCandidates(repoId),
      service.getRepoLaunchStatus(repoId),
      service.getRepoLaunchLogs(repoId),
    ]);
    state.launchConfigs[repoId] = config;
    state.launchCandidates[repoId] = candidates;
    state.launchStatuses[repoId] = status;
    state.launchLogs[repoId] = logs;
    return { config, candidates, status, logs };
  } catch (err) {
    state.error = String(err);
    throw err;
  } finally {
    state.launchLoading = false;
  }
}

export async function saveLaunchConfig(repoId: string, command: string, cwd?: string | null) {
  const service = await loadWorkspaceService();
  const config = await service.saveRepoLaunchConfig(repoId, command, cwd);
  state.launchConfigs[repoId] = config;
  state.launchCandidates[repoId] = await service.listRepoLaunchCandidates(repoId);
  return config;
}

export async function refreshLaunchStatus(repoId: string) {
  const service = await loadWorkspaceService();
  const status = await service.getRepoLaunchStatus(repoId);
  state.launchStatuses[repoId] = status;
  return status;
}

export async function refreshLaunchLogs(repoId: string) {
  const service = await loadWorkspaceService();
  const current = state.launchLogs[repoId] ?? [];
  const since = current.length ? current[current.length - 1].index : null;
  const next = await service.getRepoLaunchLogs(repoId, since);
  if (next.length) {
    state.launchLogs[repoId] = [...current, ...next].slice(-500);
  } else {
    state.launchLogs[repoId] = current;
  }
  return state.launchLogs[repoId] ?? [];
}

export async function startLaunch(repoId: string) {
  const service = await loadWorkspaceService();
  state.launchLogs[repoId] = [];
  const status = await service.startRepoLaunch(repoId);
  state.launchStatuses[repoId] = status;
  await refreshLaunchLogs(repoId);
  return status;
}

export async function stopLaunch(repoId: string) {
  const service = await loadWorkspaceService();
  const status = await service.stopRepoLaunch(repoId);
  state.launchStatuses[repoId] = status;
  await refreshLaunchLogs(repoId);
  return status;
}

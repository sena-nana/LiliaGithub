import { state, upsertRepo } from "./state";
import { loadWorkspaceService } from "./serviceLoader";

export async function refreshRepos() {
  state.scanning = true;
  state.error = null;
  try {
    const service = await loadWorkspaceService();
    state.repos = await service.scanRepos();
  } catch (err) {
    state.error = String(err);
  } finally {
    state.scanning = false;
  }
}

export async function hideRepo(repoId: string) {
  const service = await loadWorkspaceService();
  state.settings = await service.hideRepo(repoId);
  state.repos = state.repos.filter((repo) => repo.id !== repoId);
  delete state.repoDetails[repoId];
  delete state.launchConfigs[repoId];
  delete state.launchStatuses[repoId];
  delete state.launchLogs[repoId];
}

export async function unhideRepo(repoId: string) {
  const service = await loadWorkspaceService();
  state.settings = await service.unhideRepo(repoId);
  upsertRepo(await service.getRepoSummary(repoId));
}

export async function listHiddenRepos() {
  const service = await loadWorkspaceService();
  return service.listHiddenRepos();
}

export async function loadRepoDetail(repoId: string) {
  state.error = null;
  const service = await loadWorkspaceService();
  const detail = await service.getRepoDetail(repoId);
  state.repoDetails[repoId] = detail;
  upsertRepo(detail.summary);
  return detail;
}

export async function stage(repoId: string, files: string[]) {
  const service = await loadWorkspaceService();
  await service.stageFiles(repoId, files);
  await loadRepoDetail(repoId);
}

export async function unstage(repoId: string, files: string[]) {
  const service = await loadWorkspaceService();
  await service.unstageFiles(repoId, files);
  await loadRepoDetail(repoId);
}

export async function commit(repoId: string, files: string[], message: string, pushAfter: boolean) {
  const service = await loadWorkspaceService();
  const summary = await service.commitRepo(repoId, files, message, pushAfter);
  upsertRepo(summary);
  await loadRepoDetail(repoId);
}

export async function pull(repoId: string) {
  const service = await loadWorkspaceService();
  const summary = await service.pullRepo(repoId);
  upsertRepo(summary);
  await loadRepoDetail(repoId);
}

export async function push(repoId: string) {
  const service = await loadWorkspaceService();
  const summary = await service.pushRepo(repoId);
  upsertRepo(summary);
  await loadRepoDetail(repoId);
}

export async function checkout(repoId: string, branch: string) {
  const service = await loadWorkspaceService();
  const summary = await service.checkoutBranch(repoId, branch);
  upsertRepo(summary);
  await loadRepoDetail(repoId);
}

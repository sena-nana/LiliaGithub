import {
  beginRecentPushRetry,
  finishRecentPushRetry,
  setRepoDetail,
  state,
  upsertRepo,
} from "./state";
import { loadWorkspaceService } from "./serviceLoader";
import type { RepoConflictChoice } from "../../services/workspace";

async function applyRepoMutation(repoId: string, loadSummary: () => Promise<import("../../services/workspace").RepoSummary>) {
  upsertRepo(await loadSummary());
  await loadRepoDetail(repoId);
}

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

export async function cloneRepo(remoteUrl: string, directoryName?: string | null) {
  state.error = null;
  const service = await loadWorkspaceService();
  const summary = await service.cloneRepo(remoteUrl, directoryName);
  upsertRepo(summary);
  return summary;
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
  setRepoDetail(detail);
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
  await applyRepoMutation(repoId, () => service.commitRepo(repoId, files, message, pushAfter));
}

export async function pull(repoId: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.pullRepo(repoId));
}

export async function mergePull(repoId: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, async () => {
    const result = await service.mergePullRepo(repoId);
    return result.summary;
  });
}

export async function push(repoId: string) {
  const service = await loadWorkspaceService();
  const updateRecentPush = beginRecentPushRetry(repoId);
  try {
    await applyRepoMutation(repoId, async () => {
      const summary = await service.pushRepo(repoId);
      if (updateRecentPush) {
        finishRecentPushRetry({
          repoId,
          status: "success",
          message: "完成",
          summary,
        });
      }
      return summary;
    });
  } catch (err) {
    if (updateRecentPush) {
      finishRecentPushRetry({
        repoId,
        status: "error",
        message: String(err),
        summary: null,
      });
    }
    throw err;
  }
}

export async function checkout(repoId: string, branch: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.checkoutBranch(repoId, branch));
}

export async function acceptConflictFile(
  repoId: string,
  path: string,
  side: "ours" | "theirs",
  stage = true,
) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.acceptConflictFile(repoId, path, side, stage));
}

export async function resolveConflictFile(
  repoId: string,
  path: string,
  choices: RepoConflictChoice[],
  stage = true,
) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.resolveConflictFile(repoId, path, choices, stage));
}

export async function markConflictFileResolved(repoId: string, path: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.markFileResolved(repoId, path));
}

export async function abortConflictOperation(repoId: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.abortConflictOperation(repoId));
}

export async function continueConflictOperation(repoId: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.continueConflictOperation(repoId));
}

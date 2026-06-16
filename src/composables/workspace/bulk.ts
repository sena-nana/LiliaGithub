import type { BulkOperation } from "../../services/workspace";
import { bulkSyncRepoIds, rememberRecentSync, state, upsertRepo } from "./state";
import { loadWorkspaceService } from "./serviceLoader";
import { refreshLanguageStatsForRepos } from "./repositories";

export async function previewBulk(operation: BulkOperation) {
  const service = await loadWorkspaceService();
  applyBulkPreview(await service.bulkSyncPreview(operation, state.repos));
}

function bulkExecutionRepoIds() {
  if (!state.bulkPreview) return;
  if (state.bulkPreview.operation === "push" || state.bulkPreview.operation === "sync") {
    return Array.from(bulkSyncRepoIds(state.bulkPreview));
  }
  return state.bulkPreview.eligible.map((item) => item.repo.id);
}

export async function executeBulk(repoIds = bulkExecutionRepoIds()) {
  if (!state.bulkPreview || !repoIds) return;
  state.bulkRunning = true;
  try {
    const service = await loadWorkspaceService();
    applyBulkResults(await service.bulkSyncExecute(state.bulkPreview.operation, repoIds));
    if (state.bulkPreview.operation === "push" || state.bulkPreview.operation === "sync") {
      state.settings = await service.getWorkspaceSettings();
    }
  } finally {
    state.bulkRunning = false;
  }
}

export async function syncAll() {
  if (state.bulkRunning) return;
  state.bulkRunning = true;
  try {
    const service = await loadWorkspaceService();
    applyBulkPreview(await service.bulkSyncPreview("sync", state.repos));
    applyBulkResults(await service.bulkSyncExecute("sync", bulkExecutionRepoIds() ?? []));
    state.settings = await service.getWorkspaceSettings();
  } finally {
    state.bulkRunning = false;
  }
}

export function closeBulkPreview() {
  state.bulkPreview = null;
}

function applyBulkPreview(preview: NonNullable<typeof state.bulkPreview>) {
  state.bulkPreview = preview;
  state.bulkResults = [];
  rememberRecentSync(preview, []);
}

function applyBulkResults(results: typeof state.bulkResults) {
  state.bulkResults = results;
  const refreshedRepoIds: string[] = [];
  for (const result of results) {
    if (result.summary) {
      upsertRepo(result.summary);
      refreshedRepoIds.push(result.repoId);
    }
  }
  if (refreshedRepoIds.length) void refreshLanguageStatsForRepos(refreshedRepoIds);
  if (state.bulkPreview) {
    rememberRecentSync(state.bulkPreview, results);
  }
}

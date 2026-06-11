import type { BulkOperation } from "../../services/workspace";
import { bulkPushRepoIds, rememberRecentPush, state, upsertRepo } from "./state";
import { loadWorkspaceService } from "./serviceLoader";

export async function previewBulk(operation: BulkOperation) {
  const service = await loadWorkspaceService();
  applyBulkPreview(await service.bulkSyncPreview(operation));
}

function bulkExecutionRepoIds() {
  if (!state.bulkPreview) return;
  if (state.bulkPreview.operation === "push") {
    return Array.from(bulkPushRepoIds(state.bulkPreview));
  }
  return state.bulkPreview.eligible.map((item) => item.repo.id);
}

export async function executeBulk(repoIds = bulkExecutionRepoIds()) {
  if (!state.bulkPreview || !repoIds) return;
  state.bulkRunning = true;
  try {
    const service = await loadWorkspaceService();
    applyBulkResults(await service.bulkSyncExecute(state.bulkPreview.operation, repoIds));
  } finally {
    state.bulkRunning = false;
  }
}

export async function pushAll() {
  if (state.bulkRunning) return;
  state.bulkRunning = true;
  try {
    const service = await loadWorkspaceService();
    applyBulkPreview(await service.bulkSyncPreview("push"));
    applyBulkResults(await service.bulkSyncExecute("push", bulkExecutionRepoIds() ?? []));
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
  rememberRecentPush(preview, []);
}

function applyBulkResults(results: typeof state.bulkResults) {
  state.bulkResults = results;
  for (const result of results) {
    if (result.summary) {
      upsertRepo(result.summary);
    }
  }
  if (state.bulkPreview) {
    rememberRecentPush(state.bulkPreview, results);
  }
}

import type { BulkOperation } from "../../services/workspace";
import { rememberRecentPush, state, upsertRepo } from "./state";
import { loadWorkspaceService } from "./serviceLoader";

export async function previewBulk(operation: BulkOperation) {
  const service = await loadWorkspaceService();
  state.bulkPreview = await service.bulkSyncPreview(operation);
  state.bulkResults = [];
  rememberRecentPush(state.bulkPreview, []);
}

function bulkExecutionRepoIds() {
  if (!state.bulkPreview) return;
  if (state.bulkPreview.operation === "push") {
    const ids = new Set<string>();
    for (const item of [...state.bulkPreview.eligible, ...state.bulkPreview.blocked]) {
      if (item.repo.ahead > 0) ids.add(item.repo.id);
    }
    return Array.from(ids);
  }
  return state.bulkPreview.eligible.map((item) => item.repo.id);
}

export async function executeBulk(repoIds = bulkExecutionRepoIds()) {
  if (!state.bulkPreview || !repoIds) return;
  state.bulkRunning = true;
  try {
    const service = await loadWorkspaceService();
    state.bulkResults = await service.bulkSyncExecute(state.bulkPreview.operation, repoIds);
    for (const result of state.bulkResults) {
      if (result.summary) {
        upsertRepo(result.summary);
      }
    }
    rememberRecentPush(state.bulkPreview, state.bulkResults);
  } finally {
    state.bulkRunning = false;
  }
}

export async function pushAll() {
  if (state.bulkRunning) return;
  const service = await loadWorkspaceService();
  state.bulkRunning = true;
  try {
    state.bulkPreview = await service.bulkSyncPreview("push");
    state.bulkResults = [];
    rememberRecentPush(state.bulkPreview, []);
    const ids = bulkExecutionRepoIds() ?? [];
    state.bulkResults = await service.bulkSyncExecute("push", ids);
    for (const result of state.bulkResults) {
      if (result.summary) {
        upsertRepo(result.summary);
      }
    }
    rememberRecentPush(state.bulkPreview, state.bulkResults);
  } finally {
    state.bulkRunning = false;
  }
}

export function closeBulkPreview() {
  state.bulkPreview = null;
}

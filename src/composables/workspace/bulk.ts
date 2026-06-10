import type { BulkOperation } from "../../services/workspace";
import { state, upsertRepo } from "./state";
import { loadWorkspaceService } from "./serviceLoader";

export async function previewBulk(operation: BulkOperation) {
  const service = await loadWorkspaceService();
  state.bulkPreview = await service.bulkSyncPreview(operation);
  state.bulkResults = [];
}

export async function executeBulk() {
  if (!state.bulkPreview) return;
  state.bulkRunning = true;
  try {
    const service = await loadWorkspaceService();
    const ids = state.bulkPreview.eligible.map((item) => item.repo.id);
    state.bulkResults = await service.bulkSyncExecute(state.bulkPreview.operation, ids);
    for (const result of state.bulkResults) {
      if (result.summary) {
        upsertRepo(result.summary);
      }
    }
  } finally {
    state.bulkRunning = false;
  }
}

export async function pushAll() {
  if (state.bulkRunning) return;
  await previewBulk("push");
}

export function closeBulkPreview() {
  state.bulkPreview = null;
  state.bulkResults = [];
}

import type { BulkOperation } from "../../services/workspace";
import { state } from "./state";
import { refreshRepos } from "./repositories";
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
    await refreshRepos();
  } finally {
    state.bulkRunning = false;
  }
}

export function closeBulkPreview() {
  state.bulkPreview = null;
  state.bulkResults = [];
}

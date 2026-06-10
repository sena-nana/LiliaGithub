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
  if (state.bulkPushRunning) return;

  const targets = state.repos.filter((repo) => repo.ahead > 0);
  state.bulkPreview = null;
  state.bulkResults = [];
  state.bulkPushStatuses = {};
  if (!targets.length) return;

  state.bulkPushRunning = true;
  for (const repo of targets) {
    state.bulkPushStatuses[repo.id] = { state: "running" };
  }

  try {
    const service = await loadWorkspaceService();
    await Promise.all(
      targets.map(async (repo) => {
        try {
          const summary = await service.pushRepo(repo.id);
          upsertRepo(summary);
          delete state.bulkPushStatuses[repo.id];
        } catch (err) {
          state.bulkPushStatuses[repo.id] = {
            state: "error",
            message: String(err),
          };
        }
      }),
    );
  } catch (err) {
    for (const repo of targets) {
      state.bulkPushStatuses[repo.id] = {
        state: "error",
        message: String(err),
      };
    }
  } finally {
    state.bulkPushRunning = false;
    for (const repo of targets) {
      if (state.bulkPushStatuses[repo.id]?.state === "running") {
        delete state.bulkPushStatuses[repo.id];
      }
    }
  }
}

export function closeBulkPreview() {
  state.bulkPreview = null;
  state.bulkResults = [];
}

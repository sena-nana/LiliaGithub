import type { BulkOperation, RepoPullLocalChangesMode } from "../../services/workspace";
import { invalidateSessionContextSnapshot } from "../sessionContext";
import { runBackgroundTask } from "../useBackgroundTasks";
import { bulkSyncRepoIds, rememberRecentSync, state, upsertRepo } from "./state";
import { loadWorkspaceService } from "./serviceLoader";
import { refreshLanguageStatsForRepos } from "./repositories";

let bulkPreviewGeneration = 0;
let bulkExecutionGeneration = 0;

function bulkTaskTitle(operation: BulkOperation) {
  if (operation === "push") return "批量推送仓库";
  if (operation === "pull") return "批量拉取仓库";
  return "批量同步仓库";
}

export async function previewBulk(
  operation: BulkOperation,
  localChangesMode: RepoPullLocalChangesMode = "reject",
) {
  if (state.bulkRunning) return;
  const generation = ++bulkPreviewGeneration;
  const service = await loadWorkspaceService();
  const preview = await service.bulkSyncPreview(operation, state.repos, localChangesMode);
  if (generation !== bulkPreviewGeneration) return;
  applyBulkPreview(preview);
}

function bulkExecutionRepoIds(preview = state.bulkPreview) {
  if (!preview) return;
  if (preview.operation === "push" || preview.operation === "sync") {
    return Array.from(bulkSyncRepoIds(preview));
  }
  return preview.eligible.map((item) => item.repo.id);
}

export async function executeBulk(
  repoIds?: string[],
  localChangesMode: RepoPullLocalChangesMode = "reject",
) {
  const preview = state.bulkPreview;
  const targetRepoIds = repoIds ?? bulkExecutionRepoIds(preview);
  if (!preview || !targetRepoIds || state.bulkRunning) return;
  bulkPreviewGeneration += 1;
  const generation = ++bulkExecutionGeneration;
  state.bulkRunning = true;
  try {
    await runBackgroundTask(
      {
        kind: "sync",
        title: bulkTaskTitle(preview.operation),
        detail: `${targetRepoIds.length} 个仓库`,
        priority: "high",
      },
      async () => {
        const service = await loadWorkspaceService();
        const results = await service.bulkSyncExecute(preview.operation, targetRepoIds, localChangesMode);
        if (generation !== bulkExecutionGeneration) return;
        applyBulkResults(preview, results);
        if (preview.operation === "push" || preview.operation === "sync") {
          state.settings = await service.getWorkspaceSettings();
        }
      },
    );
  } finally {
    if (generation === bulkExecutionGeneration) {
      state.bulkRunning = false;
    }
  }
}

export async function syncAll(localChangesMode: RepoPullLocalChangesMode = "reject") {
  if (state.bulkRunning) return;
  bulkPreviewGeneration += 1;
  const generation = ++bulkExecutionGeneration;
  state.bulkRunning = true;
  try {
    await runBackgroundTask(
      {
        kind: "sync",
        title: "同步全部仓库",
        priority: "high",
      },
      async () => {
        const service = await loadWorkspaceService();
        const preview = await service.bulkSyncPreview("sync", state.repos, localChangesMode);
        if (generation !== bulkExecutionGeneration) return;
        applyBulkPreview(preview);
        const targetRepoIds = bulkExecutionRepoIds(preview) ?? [];
        const results = await service.bulkSyncExecute("sync", targetRepoIds, localChangesMode);
        if (generation !== bulkExecutionGeneration) return;
        applyBulkResults(preview, results);
        state.settings = await service.getWorkspaceSettings();
      },
    );
  } finally {
    if (generation === bulkExecutionGeneration) {
      state.bulkRunning = false;
    }
  }
}

export function closeBulkPreview() {
  if (state.bulkPreview) invalidateSessionContextSnapshot();
  bulkPreviewGeneration += 1;
  state.bulkPreview = null;
}

function applyBulkPreview(preview: NonNullable<typeof state.bulkPreview>) {
  state.bulkPreview = preview;
  state.bulkResults = [];
  rememberRecentSync(preview, []);
}

function applyBulkResults(preview: NonNullable<typeof state.bulkPreview>, results: typeof state.bulkResults) {
  state.bulkResults = results;
  const refreshedRepoIds: string[] = [];
  for (const result of results) {
    if (result.summary) {
      upsertRepo(result.summary);
      refreshedRepoIds.push(result.repoId);
    }
  }
  if (refreshedRepoIds.length) void refreshLanguageStatsForRepos(refreshedRepoIds);
  rememberRecentSync(preview, results);
}

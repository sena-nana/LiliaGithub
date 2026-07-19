import type { BulkOperation, RepoPullLocalChangesMode } from "../../services/workspace";
import { invalidateSessionContextSnapshot } from "../sessionContext";
import { bulkSyncRepoIds, rememberRecentSync, state, upsertRepo } from "./state";
import { loadWorkspaceService } from "./serviceLoader";
import { refreshLanguageStatsForRepos } from "./repositories";

let bulkPreviewGeneration = 0;
let bulkExecutionGeneration = 0;

export async function previewBulk(
  operation: BulkOperation,
  localChangesMode: RepoPullLocalChangesMode = "reject",
) {
  if (state.bulkRunning) return;
  const generation = ++bulkPreviewGeneration;
  const service = await loadWorkspaceService();
  const preview = await service.bulkSyncPreview(operation, state.repos.map((repo) => repo.id), localChangesMode);
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
    const service = await loadWorkspaceService();
    const results = await service.bulkSyncExecute(preview.operation, targetRepoIds, localChangesMode, "manual");
    if (generation !== bulkExecutionGeneration) return;
    applyBulkResults(preview, results);
    if (preview.operation === "push" || preview.operation === "sync") {
      state.settings = await service.getWorkspaceSettings();
    }
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
    const service = await loadWorkspaceService();
    const preview = await service.bulkSyncPreview("sync", state.repos.map((repo) => repo.id), localChangesMode);
    if (generation !== bulkExecutionGeneration) return;
    applyBulkPreview(preview);
    const targetRepoIds = bulkExecutionRepoIds(preview) ?? [];
    const results = await service.bulkSyncExecute("sync", targetRepoIds, localChangesMode, "syncAll");
    if (generation !== bulkExecutionGeneration) return;
    applyBulkResults(preview, results);
    state.settings = await service.getWorkspaceSettings();
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

export function resetBulkRuntime() {
  bulkPreviewGeneration += 1;
  bulkExecutionGeneration += 1;
  state.bulkPreview = null;
  state.bulkResults = [];
  state.bulkRunning = false;
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

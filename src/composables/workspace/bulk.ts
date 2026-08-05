import type { BulkOperation, RepoPullLocalChangesMode } from "../../services/workspace";
import type { SessionContext } from "../sessionContext";
import type { WorkspaceStateFeature } from "./state";
import type { WorkspaceServiceLoader } from "./system";
import type { WorkspaceRepositoriesFeature } from "./repositories";

export function createWorkspaceBulkFeature(
  {
    bulkSyncRepoIds,
    rememberRecentSync,
    state,
    upsertRepo,
  }: Pick<WorkspaceStateFeature, "bulkSyncRepoIds" | "rememberRecentSync" | "state" | "upsertRepo">,
  { refreshLanguageStatsForRepos }: Pick<WorkspaceRepositoriesFeature, "refreshLanguageStatsForRepos">,
  loadWorkspaceService: WorkspaceServiceLoader,
  sessionContext: Pick<SessionContext, "invalidate">,
) {

let bulkPreviewGeneration = 0;
let bulkExecutionGeneration = 0;

async function previewBulk(
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

async function executeBulk(
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

async function syncAll(localChangesMode: RepoPullLocalChangesMode = "reject") {
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

function closeBulkPreview() {
  if (state.bulkPreview) sessionContext.invalidate();
  bulkPreviewGeneration += 1;
  state.bulkPreview = null;
}

function resetBulkRuntime() {
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

return { previewBulk, executeBulk, syncAll, closeBulkPreview, resetBulkRuntime };
}

export type WorkspaceBulkFeature = ReturnType<typeof createWorkspaceBulkFeature>;

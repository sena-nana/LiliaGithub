export type WorkspaceService = typeof import("../../services/workspace");

let servicePromise: Promise<WorkspaceService> | null = null;

export function loadWorkspaceService() {
  servicePromise ??= import("../../services/workspace");
  return servicePromise;
}

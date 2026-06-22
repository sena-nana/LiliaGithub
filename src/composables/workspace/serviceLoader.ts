import { createCachedAsyncModule } from "../../utils/asyncModule";

export type WorkspaceService = typeof import("../../services/workspace");

const serviceModule = createCachedAsyncModule<WorkspaceService>(() => import("../../services/workspace"));

export function loadWorkspaceService() {
  return serviceModule.load();
}

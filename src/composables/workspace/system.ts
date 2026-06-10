import { loadWorkspaceService } from "./serviceLoader";

export async function openPath(path: string) {
  const service = await loadWorkspaceService();
  return service.openPath(path);
}

export async function openUrl(url: string) {
  const service = await loadWorkspaceService();
  return service.openUrl(url);
}

import type { SystemOpenTarget } from "../../services/workspace";
import type { WorkspaceService } from "./serviceLoader";

export type WorkspaceServiceLoader = () => Promise<WorkspaceService>;

export function createWorkspaceSystemFeature(loadWorkspaceService: WorkspaceServiceLoader) {
  async function copyText(text: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      throw new Error("当前环境不支持复制到剪贴板");
    }
    return navigator.clipboard.writeText(text);
  }

  async function openPath(path: string) {
    const service = await loadWorkspaceService();
    return service.openPath(path);
  }

  async function openPathTarget(path: string, target: SystemOpenTarget) {
    const service = await loadWorkspaceService();
    return service.openPathTarget(path, target);
  }

  async function openUrl(url: string) {
    const service = await loadWorkspaceService();
    return service.openUrl(url);
  }

  return { copyText, openPath, openPathTarget, openUrl };
}

export type WorkspaceSystemFeature = ReturnType<typeof createWorkspaceSystemFeature>;

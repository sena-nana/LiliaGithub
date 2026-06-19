import { loadWorkspaceService } from "./serviceLoader";
import type { SystemOpenTarget } from "../../services/workspace";

export async function copyText(text: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    throw new Error("当前环境不支持复制到剪贴板");
  }
  return navigator.clipboard.writeText(text);
}

export async function openPath(path: string) {
  const service = await loadWorkspaceService();
  return service.openPath(path);
}

export async function openPathTarget(path: string, target: SystemOpenTarget) {
  const service = await loadWorkspaceService();
  return service.openPathTarget(path, target);
}

export async function openUrl(url: string) {
  const service = await loadWorkspaceService();
  return service.openUrl(url);
}

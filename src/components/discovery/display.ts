import { remoteRepoId } from "../../utils/remoteRepo";
import { repoProjectRoute } from "../../utils/repoRoutes";

export function discoveryDate(value: string | null | undefined) {
  if (!value) return "时间未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}

export function discoveryProjectRoute(
  repoFullName: string,
  tab: "issues" | "pulls" | "actions" | "release",
  focus?: number,
  releaseTag?: string,
) {
  return repoProjectRoute(remoteRepoId(repoFullName), tab, focus, null, releaseTag);
}

export function cleanDiscoveryError(reason: unknown) {
  return (reason instanceof Error ? reason.message : String(reason)).replace(/^Error:\s*/, "");
}

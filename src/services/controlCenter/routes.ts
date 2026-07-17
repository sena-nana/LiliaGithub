import { remoteRepoId } from "../../utils/remoteRepo";
import { repoConflictRoute, repoProjectRoute, repoRoute } from "../../utils/repoRoutes";

export function repositoryRoute(repoId: string | null, repoFullName: string, tab: "repo" | "changes" = "repo") {
  return repoRoute(repoId ?? remoteRepoId(repoFullName), tab);
}

export function conflictRoute(repoId: string) {
  return repoConflictRoute(repoId);
}

export function issueRoute(repoId: string | null, repoFullName: string, issueNumber: number) {
  return repoProjectRoute(repoId ?? remoteRepoId(repoFullName), "issues", issueNumber);
}

export function pullRequestRoute(repoId: string | null, repoFullName: string, pullNumber: number) {
  return repoProjectRoute(repoId ?? remoteRepoId(repoFullName), "pulls", pullNumber);
}

export function workflowRoute(repoId: string | null, repoFullName: string, runId: number) {
  return repoProjectRoute(repoId ?? remoteRepoId(repoFullName), "actions", runId);
}

export function releaseRoute(repoId: string | null, repoFullName: string, tagName: string) {
  return repoProjectRoute(repoId ?? remoteRepoId(repoFullName), "release", null, null, tagName);
}

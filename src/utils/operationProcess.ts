import type { RepoRemoteOperation, RepoRemoteOperationStep } from "../services/workspace/types";

export const GIT_PROCESS_MARKER = "\n<!--lilia-git-process-->\n";

export function splitGitProcessMessage(raw: string): { message: string; process: string | null } {
  const index = raw.indexOf(GIT_PROCESS_MARKER);
  if (index < 0) return { message: raw, process: null };
  const message = raw.slice(0, index);
  const process = raw.slice(index + GIT_PROCESS_MARKER.length).trim();
  return { message, process: process || null };
}

export function formatOperationProcess(
  steps?: readonly RepoRemoteOperationStep[] | null,
  process?: string | null,
): string {
  const attached = process?.trim() ?? "";
  if (attached) return attached;
  if (!steps?.length) return "";
  return steps.map(formatOperationStepProcess).filter(Boolean).join("\n\n");
}

function formatOperationStepProcess(step: RepoRemoteOperationStep): string {
  const title = [
    operationLabel(step.operation),
    step.remote.trim() || null,
    step.targetBranch?.trim() || null,
  ].filter(Boolean).join(" · ");
  const body = [step.command?.trim(), (step.output || step.message).trim()]
    .filter(Boolean)
    .join("\n");
  return [title, body].filter(Boolean).join("\n");
}

function operationLabel(operation: RepoRemoteOperation | string): string {
  if (operation === "fetch") return "抓取";
  if (operation === "merge") return "合并";
  if (operation === "restore") return "还原";
  if (operation === "push") return "推送";
  return operation;
}

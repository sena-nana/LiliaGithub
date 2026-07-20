import { call } from "../workspace/client";
import {
  LILIA_CODE_TASK_HANDOFF_PROTOCOL,
  LILIA_CODE_TASK_HANDOFF_VERSION,
  type LiliaCodeTaskHandoff,
  type LiliaCodeTaskHandoffStatus,
} from "./types";

const agentDebugMockWorkspace = typeof import.meta !== "undefined"
  && import.meta.env?.DEV === true
  && import.meta.env?.VITE_LILIA_GITHUB_AGENT_DEBUG_MOCK_WORKSPACE === "1";
const agentDebugRealHandoff = agentDebugMockWorkspace
  && import.meta.env?.VITE_LILIA_GITHUB_AGENT_DEBUG_REAL_HANDOFF === "1";

export function createLiliaCodeTaskHandoff(
  handoff: LiliaCodeTaskHandoff,
): Promise<LiliaCodeTaskHandoffStatus> {
  return call("lilia_code_create_task_handoff", { handoff }, async () => ({
    protocol: LILIA_CODE_TASK_HANDOFF_PROTOCOL,
    version: LILIA_CODE_TASK_HANDOFF_VERSION,
    handoffId: handoff.id,
    status: agentDebugMockWorkspace ? "accepted" : "pending",
    taskId: agentDebugMockWorkspace ? `agent-debug-${handoff.id}` : null,
    resultRoute: agentDebugMockWorkspace ? `liliacode://tasks/agent-debug-${handoff.id}` : null,
    updatedAt: new Date().toISOString(),
  }), { requireTauri: agentDebugRealHandoff });
}

export function getLiliaCodeTaskHandoffStatus(
  handoffId: string,
): Promise<LiliaCodeTaskHandoffStatus> {
  return call("lilia_code_get_task_handoff_status", { handoffId }, async () => ({
    protocol: LILIA_CODE_TASK_HANDOFF_PROTOCOL,
    version: LILIA_CODE_TASK_HANDOFF_VERSION,
    handoffId,
    status: agentDebugMockWorkspace ? "accepted" : "pending",
    taskId: agentDebugMockWorkspace ? `agent-debug-${handoffId}` : null,
    resultRoute: agentDebugMockWorkspace ? `liliacode://tasks/agent-debug-${handoffId}` : null,
    updatedAt: new Date().toISOString(),
  }), { requireTauri: agentDebugRealHandoff });
}

export function openLiliaCodeTaskHandoffResult(handoffId: string): Promise<void> {
  return call(
    "lilia_code_open_task_handoff_result",
    { handoffId },
    async () => undefined,
    { requireTauri: agentDebugRealHandoff },
  );
}

export async function waitForLiliaCodeTaskHandoff(
  handoffId: string,
  options: { attempts?: number; intervalMs?: number } = {},
) {
  const attempts = Math.max(1, options.attempts ?? 20);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await getLiliaCodeTaskHandoffStatus(handoffId);
    if (status.status !== "pending") return status;
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 500));
    }
  }
  return getLiliaCodeTaskHandoffStatus(handoffId);
}

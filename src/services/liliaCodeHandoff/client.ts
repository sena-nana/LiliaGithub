import type { WorkspaceClient } from "../workspace/client";
import {
  type LiliaCodeTaskHandoff,
  type LiliaCodeTaskHandoffStatus,
} from "./types";

export function createLiliaCodeTaskHandoff(
  client: WorkspaceClient,
  handoff: LiliaCodeTaskHandoff,
): Promise<LiliaCodeTaskHandoffStatus> {
  return client.createLiliaCodeTaskHandoff(handoff);
}

export function getLiliaCodeTaskHandoffStatus(
  client: WorkspaceClient,
  handoffId: string,
): Promise<LiliaCodeTaskHandoffStatus> {
  return client.getLiliaCodeTaskHandoffStatus(handoffId);
}

export function openLiliaCodeTaskHandoffResult(client: WorkspaceClient, handoffId: string): Promise<void> {
  return client.openLiliaCodeTaskHandoffResult(handoffId);
}

export async function waitForLiliaCodeTaskHandoff(
  client: WorkspaceClient,
  handoffId: string,
  options: { attempts?: number; intervalMs?: number } = {},
) {
  return client.waitForLiliaCodeTaskHandoff(handoffId, options);
}

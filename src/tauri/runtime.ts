import { convertFileSrc, invoke as rawInvoke } from "@tauri-apps/api/core";
import {
  recordAgentDebugInvokeEnd,
  recordAgentDebugInvokeStart,
} from "../agentDebug/compat";
import type {
  WorkspaceCommandArgs,
  WorkspaceCommandName,
  WorkspaceCommandResult,
} from "../services/workspace/contracts";
import { normalizeWorkspaceCommandError } from "../services/workspace/errors";

export { convertFileSrc };

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const trace = recordAgentDebugInvokeStart(cmd, args ?? {});
  try {
    const result = await rawInvoke<T>(cmd, args);
    recordAgentDebugInvokeEnd(trace, "success", result);
    return result;
  } catch (err) {
    recordAgentDebugInvokeEnd(trace, "error", err);
    throw normalizeWorkspaceCommandError(err);
  }
}

export function invokeWorkspace<TCommand extends WorkspaceCommandName>(
  command: TCommand,
  args: WorkspaceCommandArgs<TCommand>,
): Promise<WorkspaceCommandResult<TCommand>> {
  return invoke<WorkspaceCommandResult<TCommand>>(
    command,
    args as Record<string, unknown> | undefined,
  );
}

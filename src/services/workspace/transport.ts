import { invokeWorkspace } from "../../tauri/runtime";
import type {
  WorkspaceCommandArgs,
  WorkspaceCommandName,
  WorkspaceCommandResult,
} from "./contracts";

export interface WorkspaceTransport {
  invoke<TCommand extends WorkspaceCommandName>(
    command: TCommand,
    args: WorkspaceCommandArgs<TCommand>,
    options?: WorkspaceInvokeOptions,
  ): Promise<WorkspaceCommandResult<TCommand>>;
}

export interface WorkspaceInvokeOptions {
  requireTauri?: boolean;
}

export type WorkspaceRuntime = "tauri" | "mock" | "unavailable";

export interface WorkspaceRuntimeProbe {
  hasWindow: boolean;
  hasTauriInternals: boolean;
  isDev: boolean;
  isTest: boolean;
  agentDebugMockWorkspace?: boolean;
}

export function resolveWorkspaceRuntime(probe: WorkspaceRuntimeProbe): WorkspaceRuntime {
  if (probe.agentDebugMockWorkspace && probe.hasWindow && probe.isDev) return "mock";
  if (probe.hasTauriInternals && !probe.isTest) return "tauri";
  if (probe.isTest || (probe.hasWindow && probe.isDev)) return "mock";
  return "unavailable";
}

export type WorkspaceCommandHandler<TCommand extends WorkspaceCommandName> = (
  args: WorkspaceCommandArgs<TCommand>,
) => WorkspaceCommandResult<TCommand> | Promise<WorkspaceCommandResult<TCommand>>;

export type WorkspaceCommandHandlers = {
  [TCommand in WorkspaceCommandName]: WorkspaceCommandHandler<TCommand>;
};

export const tauriWorkspaceTransport: WorkspaceTransport = {
  invoke: invokeWorkspace,
};

export function createRuntimeWorkspaceTransport(options: {
  probe: () => WorkspaceRuntimeProbe;
  loadMockTransport: () => Promise<WorkspaceTransport>;
  tauriTransport?: WorkspaceTransport;
}): WorkspaceTransport {
  const tauriTransport = options.tauriTransport ?? tauriWorkspaceTransport;
  let mockTransportPromise: Promise<WorkspaceTransport> | null = null;

  return {
    async invoke<TCommand extends WorkspaceCommandName>(
      command: TCommand,
      args: WorkspaceCommandArgs<TCommand>,
      invokeOptions: WorkspaceInvokeOptions = {},
    ): Promise<WorkspaceCommandResult<TCommand>> {
      const probe = options.probe();
      if (invokeOptions.requireTauri) {
        if (probe.hasWindow && probe.hasTauriInternals && probe.isDev && !probe.isTest) {
          return tauriTransport.invoke(command, args);
        }
        throw new Error(
          `Tauri command ${command} is required by the focused Agent debug scenario.`,
        );
      }

      const runtime = resolveWorkspaceRuntime(probe);
      if (runtime === "tauri") return tauriTransport.invoke(command, args);
      if (runtime === "mock") {
        mockTransportPromise ??= options.loadMockTransport();
        return (await mockTransportPromise).invoke(command, args);
      }
      throw new Error(
        `Tauri command ${command} is unavailable outside Tauri. Use yarn tauri:dev, or yarn dev for the development mock mode.`,
      );
    },
  };
}

export function createWorkspaceHandlerTransport(
  handlers: Partial<WorkspaceCommandHandlers>,
): WorkspaceTransport {
  return {
    async invoke<TCommand extends WorkspaceCommandName>(
      command: TCommand,
      args: WorkspaceCommandArgs<TCommand>,
    ): Promise<WorkspaceCommandResult<TCommand>> {
      const handler = handlers[command] as WorkspaceCommandHandler<TCommand> | undefined;
      if (!handler) {
        throw new Error(`Workspace transport does not implement ${command}.`);
      }
      return handler(args);
    },
  };
}

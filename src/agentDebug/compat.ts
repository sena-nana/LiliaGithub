import {
  recordAgentDebugLog,
  type LiliaAgentDebugApi,
} from "@lilia/ui";

type LiliaGithubAgentDebugWindow = Window & {
  __liliaAgentDebug?: LiliaAgentDebugApi;
  __liliaGithubAgentDebug?: LiliaAgentDebugApi;
};

interface InvokeTrace {
  argsSummary: string;
  command: string;
  startedAt: number;
}

const MAX_SUMMARY_LENGTH = 500;

export function installLiliaGithubAgentDebugCompat(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const debugWindow = window as LiliaGithubAgentDebugWindow;
  let disposed = false;
  let timer: number | null = null;

  const install = () => {
    if (disposed) return;
    const sharedApi = debugWindow.__liliaAgentDebug;
    if (sharedApi) {
      debugWindow.__liliaGithubAgentDebug = sharedApi;
      return;
    }
    timer = window.setTimeout(install, 50);
  };

  install();

  return () => {
    disposed = true;
    if (timer !== null) window.clearTimeout(timer);
    if (debugWindow.__liliaGithubAgentDebug === debugWindow.__liliaAgentDebug) {
      delete debugWindow.__liliaGithubAgentDebug;
    }
  };
}

export function recordAgentDebugInvokeStart(command: string, args: unknown): InvokeTrace | null {
  if (typeof window === "undefined" || command.startsWith("agent_debug_")) return null;
  const trace: InvokeTrace = {
    argsSummary: summarize(args),
    command,
    startedAt: Date.now(),
  };
  const recorded = recordAgentDebugLog({
    data: { kind: "invoke", status: "started", ...trace },
    message: `invoke:${command}:start`,
    type: "action",
  });
  return recorded ? trace : null;
}

export function recordAgentDebugInvokeEnd(
  trace: InvokeTrace | null,
  status: "success" | "error",
  value: unknown,
): void {
  if (!trace) return;
  const finishedAt = Date.now();
  recordAgentDebugLog({
    data: {
      kind: "invoke",
      ...trace,
      durationMs: finishedAt - trace.startedAt,
      error: status === "error" ? errorMessage(value) : null,
      finishedAt,
      resultSummary: status === "success" ? summarize(value) : null,
      status,
    },
    message: `invoke:${trace.command}:${status}`,
    type: status === "success" ? "action" : "error",
  });
}

function summarize(value: unknown): string {
  try {
    return JSON.stringify(value)?.slice(0, MAX_SUMMARY_LENGTH) ?? "";
  } catch {
    return String(value).slice(0, MAX_SUMMARY_LENGTH);
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

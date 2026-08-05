import {
  recordAgentDebugLog,
  summarizeAgentDebugValue,
  type AgentDebugRedactionPolicy,
  type LiliaAgentDebugApi,
} from "@lilia/ui/diagnostics";

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
const MAX_SUMMARY_DEPTH = 6;
const SENSITIVE_FIELDS = new Set([
  "authorization",
  "body",
  "cookie",
  "devicecode",
  "diff",
  "log",
  "logs",
  "output",
  "password",
  "patch",
  "privatekey",
  "stderr",
  "stdout",
  "text",
]);

function isSensitiveField(key: string): boolean {
  const normalized = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return SENSITIVE_FIELDS.has(normalized) ||
    normalized.endsWith("content") ||
    normalized.endsWith("path") ||
    normalized.endsWith("root") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("token") ||
    normalized.endsWith("url");
}

const workspaceInvokeRedactionPolicy: AgentDebugRedactionPolicy = ({ key, value }) => {
  if (typeof value === "string" && (key === null || /^\d+$/.test(key))) return "redact";
  return key !== null && isSensitiveField(key) ? "redact" : undefined;
};

export function installLiliaGithubAgentDebugCompat(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const debugWindow = window as LiliaGithubAgentDebugWindow;
  const sharedApi = debugWindow.__liliaAgentDebug;
  if (sharedApi) {
    debugWindow.__liliaGithubAgentDebug = sharedApi;
  }

  return () => {
    if (debugWindow.__liliaGithubAgentDebug === sharedApi) {
      delete debugWindow.__liliaGithubAgentDebug;
    }
  };
}

export function recordAgentDebugInvokeStart(command: string, args: unknown): InvokeTrace | null {
  if (typeof window === "undefined" || command.startsWith("agent_debug_")) return null;
  if (!(window as LiliaGithubAgentDebugWindow).__liliaAgentDebug) return null;
  const trace: InvokeTrace = {
    argsSummary: summarizeWorkspaceInvoke(args),
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
      error: status === "error" ? summarizeWorkspaceInvoke(value) : null,
      finishedAt,
      resultSummary: status === "success" ? summarizeWorkspaceInvoke(value) : null,
      status,
    },
    message: `invoke:${trace.command}:${status}`,
    type: status === "success" ? "action" : "error",
  });
}

function summarizeWorkspaceInvoke(value: unknown): string {
  return summarizeAgentDebugValue(value, {
    maxDepth: MAX_SUMMARY_DEPTH,
    maxEntries: 100,
    maxLength: MAX_SUMMARY_LENGTH,
    policy: workspaceInvokeRedactionPolicy,
  });
}

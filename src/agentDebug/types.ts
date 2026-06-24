export const AGENT_DEBUG_RECORD_ACTION_COMMAND = "agent_debug_record_action";

export type AgentDebugElementRole =
  | "button"
  | "link"
  | "input"
  | "textarea"
  | "select"
  | "menuitem"
  | "menuitemradio"
  | "menuitemcheckbox"
  | "tab"
  | "checkbox"
  | "radio"
  | "switch"
  | "region"
  | "unknown";

export interface AgentDebugRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AgentDebugElement {
  id: string;
  role: AgentDebugElementRole;
  text: string;
  tagName: string;
  selector: string;
  rect: AgentDebugRect;
  visible: boolean;
  enabled: boolean;
  checked: boolean | null;
  expanded: boolean | null;
}

export interface AgentDebugMissingElement {
  role: AgentDebugElementRole;
  text: string;
  tagName: string;
  selector: string;
  rect: AgentDebugRect;
  nearestAgentId: string | null;
}

export interface AgentDebugErrorEntry {
  id: string;
  kind: "console" | "error" | "unhandledrejection";
  message: string;
  stack: string | null;
  createdAt: number;
}

export interface AgentDebugInvokeEntry {
  id: string;
  command: string;
  actionId: string;
  status: "started" | "success" | "error";
  argsSummary: unknown;
  resultSummary: unknown;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
}

export type AgentDebugAction =
  | { type: "click"; target: string; actionId?: string }
  | { type: "focus"; target: string; actionId?: string }
  | { type: "type"; target: string; text: string; clear?: boolean; actionId?: string }
  | { type: "hotkey"; keys: string[]; actionId?: string }
  | { type: "mark"; label: string; data?: unknown; actionId?: string };

export interface AgentDebugSnapshot {
  enabled: boolean;
  route: string;
  title: string;
  capturedAt: number;
  viewport: AgentDebugRect;
  activeElement: string | null;
  visibleText: string;
  elements: AgentDebugElement[];
  missingAgentIds: AgentDebugMissingElement[];
  errors: AgentDebugErrorEntry[];
  invokes: AgentDebugInvokeEntry[];
}

export interface AgentDebugLogEntry {
  id: string;
  actionId: string | null;
  kind: "frontend" | "invoke" | "backend" | "mark" | "system";
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data: unknown;
  createdAt: number;
}

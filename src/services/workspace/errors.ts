export type AppErrorCategory =
  | "authentication"
  | "authorization"
  | "cancelled"
  | "conflict"
  | "network"
  | "not-found"
  | "persistence"
  | "rate-limit"
  | "validation"
  | "unknown";

export interface AppErrorPayload {
  code: string;
  category: AppErrorCategory;
  message: string;
  retryable: boolean;
  httpStatus?: number | null;
  retryAfter?: number | null;
  details?: unknown;
}

export class WorkspaceCommandError extends Error implements AppErrorPayload {
  readonly code: string;
  readonly category: AppErrorCategory;
  readonly retryable: boolean;
  readonly httpStatus?: number | null;
  readonly retryAfter?: number | null;
  readonly details?: unknown;

  constructor(payload: AppErrorPayload) {
    super(payload.message);
    this.name = "Error";
    this.code = payload.code;
    this.category = payload.category;
    this.retryable = payload.retryable;
    this.httpStatus = payload.httpStatus;
    this.retryAfter = payload.retryAfter;
    this.details = payload.details;
  }
}

export function normalizeWorkspaceCommandError(error: unknown): WorkspaceCommandError {
  if (error instanceof WorkspaceCommandError) return error;

  const payload = structuredErrorPayload(error);
  if (payload) {
    return new WorkspaceCommandError(payload);
  }

  const message = errorMessage(error);
  const legacyCode = legacyErrorCode(message);
  const httpStatus = legacyHttpStatus(message);
  const category = categoryForLegacy(legacyCode, httpStatus, message);
  return new WorkspaceCommandError({
    code: legacyCode ?? "unknown",
    category,
    message,
    retryable: defaultRetryable(category),
    ...(httpStatus == null ? {} : { httpStatus }),
  });
}

export function workspaceErrorCode(error: unknown): string | null {
  if (error instanceof WorkspaceCommandError) return error.code === "unknown" ? null : error.code;
  const payload = structuredErrorPayload(error);
  if (payload) return payload.code;
  return legacyErrorCode(errorMessage(error));
}

export function workspaceErrorCategory(error: unknown): AppErrorCategory | null {
  if (error instanceof WorkspaceCommandError) return error.category;
  const payload = structuredErrorPayload(error);
  if (payload) return payload.category;
  const message = errorMessage(error);
  const category = categoryForLegacy(legacyErrorCode(message), legacyHttpStatus(message), message);
  return category === "unknown" ? null : category;
}

export function isWorkspaceCommandCancelled(error: unknown): boolean {
  return workspaceErrorCategory(error) === "cancelled"
    || workspaceErrorCode(error) === "operation_cancelled";
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return String(error).replace(/^Error:\s*/, "").trim();
}

function structuredErrorPayload(error: unknown): AppErrorPayload | null {
  if (!isRecord(error) || typeof error.message !== "string" || typeof error.code !== "string") {
    return null;
  }

  const httpStatus = nullableFiniteNumber(error.httpStatus);
  const retryAfter = nullableFiniteNumber(error.retryAfter);
  const category = isAppErrorCategory(error.category)
    ? error.category
    : categoryFor(error.code, httpStatus ?? null);

  return {
    code: error.code.trim() || "unknown",
    category,
    message: error.message,
    retryable: typeof error.retryable === "boolean" ? error.retryable : defaultRetryable(category),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(retryAfter === undefined ? {} : { retryAfter }),
    ...("details" in error ? { details: error.details } : {}),
  };
}

function legacyErrorCode(message: string): string | null {
  return message.match(/^(github_[a-z0-9_]+|workspace_[a-z0-9_]+|repo_[a-z0-9_]+)\s*[:：]/i)?.[1]?.toLowerCase() ?? null;
}

function legacyHttpStatus(message: string): number | null {
  const match = message.match(/\bHTTP\s+(\d{3})\b/i) ?? message.match(/^\s*(\d{3})\b/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : null;
}

function categoryForLegacy(code: string | null, httpStatus: number | null, message: string): AppErrorCategory {
  const category = categoryFor(code, httpStatus);
  if (category !== "unknown") return category;
  if (/\bcancel(?:led|ed)\b|已取消|取消选择/i.test(message)) return "cancelled";
  if (/无法认证\s*GitHub\s*仓库|authentication failed|could not read username|permission denied\s*\(publickey\)/i.test(message)) {
    return "authentication";
  }
  if (/当前\s*GitHub\s*绑定无权限/i.test(message)) return "authorization";
  if (isRetryableLegacyMessage(message)) return "network";
  if (httpStatus === 422 || /\bvalidation\b|\binvalid\b|校验|格式/i.test(message)) return "validation";
  return "unknown";
}

function categoryFor(code: string | null, httpStatus: number | null): AppErrorCategory {
  if (code === "operation_cancelled") return "cancelled";
  if (code === "workspace_store_corrupt") return "validation";
  if (code?.startsWith("workspace_store_")) return "persistence";
  if (httpStatus === 401 || code === "github_authentication_required") return "authentication";
  if (httpStatus === 403 || code === "github_forbidden" || code === "github_org_sso_required") return "authorization";
  if (httpStatus === 404 || code === "github_repository_not_accessible") return "not-found";
  if (httpStatus === 409) return "conflict";
  if (httpStatus === 429 || code === "github_rate_limited") return "rate-limit";
  return "unknown";
}

function defaultRetryable(category: AppErrorCategory): boolean {
  return category === "network" || category === "rate-limit";
}

function isRetryableLegacyMessage(message: string): boolean {
  return /连接失败|网络|代理|证书|timed?\s*out|connection|dns|host not found|rate.?limit/i.test(message);
}

function nullableFiniteNumber(value: unknown): number | null | undefined {
  if (value == null) return value === null ? null : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isAppErrorCategory(value: unknown): value is AppErrorCategory {
  return value === "authentication"
    || value === "authorization"
    || value === "cancelled"
    || value === "conflict"
    || value === "network"
    || value === "not-found"
    || value === "persistence"
    || value === "rate-limit"
    || value === "validation"
    || value === "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

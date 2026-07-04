import type {
  GitHubRepoSettingsEndpointItem,
  GitHubRepoSettingsSection,
} from "../../../services/workspace/types";

export type RepoSettingsDetailKind =
  | "security"
  | "branches"
  | "actions"
  | "environments"
  | "webhooks"
  | "access";

export interface RepoSettingsBranchRow {
  name: string;
  protected: boolean;
  defaultBranch: boolean;
}

export function sectionItem(section: GitHubRepoSettingsSection | null, key: string) {
  return section?.items.find((item) => item.key === key) ?? null;
}

export function itemRecord(item: GitHubRepoSettingsEndpointItem | null): Record<string, unknown> {
  return asRecord(item?.value);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  for (const key of ["items", "environments", "hooks", "secrets", "variables", "workflows", "codespaces"]) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

export function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (["enabled", "active", "true", "all"].includes(normalized)) return true;
    if (["disabled", "inactive", "false", "none"].includes(normalized)) return false;
  }
  return null;
}

export function statusLabel(enabled: boolean | null) {
  if (enabled === true) return "已启用";
  if (enabled === false) return "已关闭";
  return "未返回";
}

export function countLabel(value: number, unit: string) {
  return `${value} ${unit}`;
}

export function namedRecords(value: unknown): Array<Record<string, unknown>> {
  return asArray(value).map(asRecord).filter((record) => Object.keys(record).length > 0);
}

export function branchFromRecord(record: Record<string, unknown>, defaultBranch: string): RepoSettingsBranchRow {
  const name = String(record.name ?? "");
  return {
    name,
    defaultBranch: name === defaultBranch || record.defaultBranch === true || record.default === true,
    protected: record.protected === true,
  };
}

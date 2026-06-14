export type ReadmeLinkTarget =
  | { kind: "external"; href: string }
  | { kind: "anchor"; hash: string }
  | { kind: "readme"; path: string; hash: string | null }
  | { kind: "file"; relativePath: string; absolutePath: string; hash: string | null };

export interface ResolveReadmeLinkOptions {
  href: string;
  repoRootPath?: string | null;
  currentReadmePath?: string | null;
  readmePaths?: readonly string[];
}

const EXTERNAL_LINK_RE = /^https?:\/\//i;
const PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:/i;

export function resolveReadmeLink(options: ResolveReadmeLinkOptions): ReadmeLinkTarget | null {
  const href = options.href.trim();
  if (!href) return null;
  if (EXTERNAL_LINK_RE.test(href)) return { kind: "external", href };
  if (PROTOCOL_RE.test(href) || href.startsWith("//")) return null;

  const { pathPart, hash } = splitHref(href);
  if (!pathPart) return hash ? { kind: "anchor", hash } : null;

  const relativePath = normalizeRepoRelativePath(pathPart, options.currentReadmePath);
  if (!relativePath) return null;

  const readmePath = options.readmePaths?.find((path) => normalizePath(path) === relativePath);
  if (readmePath) return { kind: "readme", path: readmePath, hash };

  const absolutePath = repoAbsolutePath(options.repoRootPath, relativePath);
  if (!absolutePath) return null;
  return { kind: "file", relativePath, absolutePath, hash };
}

export function readmeHeadingId(text: string, existing = new Set<string>()): string {
  const base = slugifyHeading(text) || "section";
  let id = base;
  let index = 1;
  while (existing.has(id)) {
    index += 1;
    id = `${base}-${index}`;
  }
  existing.add(id);
  return id;
}

function splitHref(href: string): { pathPart: string; hash: string | null } {
  const hashIndex = href.indexOf("#");
  if (hashIndex < 0) return { pathPart: href, hash: null };

  const rawHash = href.slice(hashIndex + 1).trim();
  return {
    pathPart: href.slice(0, hashIndex),
    hash: rawHash ? decodeFragment(rawHash) : null,
  };
}

function normalizeRepoRelativePath(pathPart: string, currentReadmePath?: string | null): string | null {
  const path = normalizePath(pathPart, false);
  if (!path || isUnsafePath(path)) return null;

  const base = path.startsWith("/")
    ? ""
    : dirname(normalizePath(currentReadmePath ?? ""));
  const parts = [...base.split("/"), ...path.replace(/^\/+/, "").split("/")].filter(Boolean);
  const normalized: string[] = [];

  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") return null;
    normalized.push(part);
  }

  return normalized.length ? normalized.join("/") : null;
}

function repoAbsolutePath(repoRootPath: string | null | undefined, relativePath: string): string | null {
  const root = repoRootPath?.trim();
  if (!root) return null;
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${relativePath.replace(/\//g, separator)}`;
}

function isUnsafePath(path: string): boolean {
  return path.startsWith("//") ||
    path.startsWith("~") ||
    /^[a-z]:\//i.test(path) ||
    PROTOCOL_RE.test(path);
}

function normalizePath(path: string, trimLeadingSlash = true): string {
  const normalized = decodeFragment(path).trim().replace(/\\/g, "/");
  return trimLeadingSlash ? normalized.replace(/^\/+/, "") : normalized;
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function decodeFragment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z0-9#]+;/gi, "")
    .replace(/[^\p{L}\p{N}\s_-]+/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

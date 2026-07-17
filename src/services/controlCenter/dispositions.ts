import type {
  KeyValueStorage,
  WorkItem,
  WorkItemDisposition,
  WorkItemDispositionSnapshot,
} from "./types";

const STORAGE_PREFIX = "lilia-github.control-center.dispositions.v1";
const DEFAULT_DISPOSITION: WorkItemDisposition = {
  state: "active",
  pinned: false,
  updatedAt: 0,
  snoozedUntil: null,
  sourceRevision: null,
};

export function dispositionStorageKey(scope: string) {
  return `${STORAGE_PREFIX}:${scope.trim() || "default"}`;
}

export function readWorkItemDispositions(
  storage: KeyValueStorage | null = browserStorage(),
  scope = "default",
): WorkItemDispositionSnapshot {
  if (!storage) return emptySnapshot();
  try {
    const parsed = JSON.parse(storage.getItem(dispositionStorageKey(scope)) ?? "null") as unknown;
    return normalizeSnapshot(parsed);
  } catch {
    return emptySnapshot();
  }
}

export function writeWorkItemDisposition(
  itemId: string,
  patch: Partial<Pick<WorkItemDisposition, "state" | "pinned" | "snoozedUntil">>,
  options: { storage?: KeyValueStorage | null; scope?: string; now?: number; sourceRevision?: string | null } = {},
) {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const scope = options.scope ?? "default";
  const snapshot = readWorkItemDispositions(storage, scope);
  const previous = snapshot.items[itemId] ?? DEFAULT_DISPOSITION;
  snapshot.items[itemId] = {
    ...previous,
    ...patch,
    snoozedUntil: patch.state === "snoozed" ? patch.snoozedUntil ?? previous.snoozedUntil : null,
    updatedAt: options.now ?? Date.now(),
    sourceRevision: options.sourceRevision ?? null,
  };
  persist(storage, scope, snapshot);
  return snapshot;
}

export function restoreHiddenWorkItems(
  itemIds: readonly string[],
  options: { storage?: KeyValueStorage | null; scope?: string; now?: number } = {},
) {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const scope = options.scope ?? "default";
  const snapshot = readWorkItemDispositions(storage, scope);
  const updatedAt = options.now ?? Date.now();
  for (const id of itemIds) {
    const current = snapshot.items[id];
    if (!current) continue;
    snapshot.items[id] = { ...current, state: "active", snoozedUntil: null, updatedAt };
  }
  persist(storage, scope, snapshot);
  return snapshot;
}

export function applyWorkItemDispositions(
  items: readonly WorkItem[],
  snapshot: WorkItemDispositionSnapshot,
  now = Date.now(),
) {
  const visible: WorkItem[] = [];
  const hidden: WorkItem[] = [];
  for (const item of items) {
    const disposition = snapshot.items[item.id];
    const stillApplies = Boolean(disposition && (
      item.sourceRevision
        ? disposition.sourceRevision === item.sourceRevision
        : disposition.updatedAt >= item.updatedAt
    ));
    const pinned = stillApplies ? disposition?.pinned === true : false;
    const resolved = { ...item, pinned };
    const hiddenByState = stillApplies && (
      disposition?.state === "ignored" ||
      disposition?.state === "completed" ||
      (disposition?.state === "snoozed" && (disposition.snoozedUntil ?? 0) > now)
    );
    (hiddenByState ? hidden : visible).push(resolved);
  }
  return { visible, hidden };
}

function emptySnapshot(): WorkItemDispositionSnapshot {
  return { version: 1, items: {} };
}

function normalizeSnapshot(value: unknown): WorkItemDispositionSnapshot {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.items)) return emptySnapshot();
  const items: Record<string, WorkItemDisposition> = {};
  for (const [id, entry] of Object.entries(value.items)) {
    if (!isRecord(entry)) continue;
    const state = entry.state;
    if (state !== "active" && state !== "ignored" && state !== "snoozed" && state !== "completed") continue;
    items[id] = {
      state,
      pinned: entry.pinned === true,
      updatedAt: finiteNumber(entry.updatedAt),
      snoozedUntil: entry.snoozedUntil == null ? null : finiteNumber(entry.snoozedUntil),
      sourceRevision: typeof entry.sourceRevision === "string" ? entry.sourceRevision : null,
    };
  }
  return { version: 1, items };
}

function persist(storage: KeyValueStorage | null, scope: string, snapshot: WorkItemDispositionSnapshot) {
  storage?.setItem(dispositionStorageKey(scope), JSON.stringify(snapshot));
}

function browserStorage(): KeyValueStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

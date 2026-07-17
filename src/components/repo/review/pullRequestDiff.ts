import type { PullRequestChangedFile, PullRequestDiffSide } from "../../../services/codeReview";

export type UnifiedDiffRow = {
  key: string;
  kind: "hunk" | "context" | "addition" | "deletion" | "meta";
  oldLine: number | null;
  newLine: number | null;
  content: string;
  raw: string;
};

export type SplitDiffCell = {
  line: number | null;
  content: string;
  side: PullRequestDiffSide;
  kind: "context" | "addition" | "deletion" | "empty";
};

export type SplitDiffRow = {
  key: string;
  hunk: string | null;
  left: SplitDiffCell | null;
  right: SplitDiffCell | null;
};

const hunkPattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedPatch(file: Pick<PullRequestChangedFile, "filename" | "patch">): UnifiedDiffRow[] {
  if (!file.patch) return [];
  let oldLine = 0;
  let newLine = 0;
  let rowIndex = 0;
  return file.patch.split("\n").map((raw): UnifiedDiffRow => {
    const key = `${file.filename}:${rowIndex++}`;
    const hunk = raw.match(hunkPattern);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { key, kind: "hunk", oldLine: null, newLine: null, content: raw, raw };
    }
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      const row = { key, kind: "addition" as const, oldLine: null, newLine, content: raw.slice(1), raw };
      newLine += 1;
      return row;
    }
    if (raw.startsWith("-") && !raw.startsWith("---")) {
      const row = { key, kind: "deletion" as const, oldLine, newLine: null, content: raw.slice(1), raw };
      oldLine += 1;
      return row;
    }
    if (raw.startsWith(" ")) {
      const row = { key, kind: "context" as const, oldLine, newLine, content: raw.slice(1), raw };
      oldLine += 1;
      newLine += 1;
      return row;
    }
    return { key, kind: "meta", oldLine: null, newLine: null, content: raw, raw };
  });
}

function cell(row: UnifiedDiffRow, side: PullRequestDiffSide): SplitDiffCell {
  const line = side === "LEFT" ? row.oldLine : row.newLine;
  return {
    line,
    content: row.content,
    side,
    kind: row.kind === "context" ? "context" : row.kind,
  } as SplitDiffCell;
}

export function toSplitDiffRows(rows: readonly UnifiedDiffRow[]): SplitDiffRow[] {
  const result: SplitDiffRow[] = [];
  let index = 0;
  while (index < rows.length) {
    const row = rows[index];
    if (!row) break;
    if (row.kind === "hunk" || row.kind === "meta") {
      result.push({ key: row.key, hunk: row.content, left: null, right: null });
      index += 1;
      continue;
    }
    if (row.kind === "context") {
      result.push({ key: row.key, hunk: null, left: cell(row, "LEFT"), right: cell(row, "RIGHT") });
      index += 1;
      continue;
    }

    const deletions: UnifiedDiffRow[] = [];
    const additions: UnifiedDiffRow[] = [];
    while (rows[index]?.kind === "deletion") deletions.push(rows[index++]!);
    while (rows[index]?.kind === "addition") additions.push(rows[index++]!);
    const count = Math.max(deletions.length, additions.length);
    for (let pairIndex = 0; pairIndex < count; pairIndex += 1) {
      const deletion = deletions[pairIndex];
      const addition = additions[pairIndex];
      result.push({
        key: `${deletion?.key ?? addition?.key}:split`,
        hunk: null,
        left: deletion ? cell(deletion, "LEFT") : { line: null, content: "", side: "LEFT", kind: "empty" },
        right: addition ? cell(addition, "RIGHT") : { line: null, content: "", side: "RIGHT", kind: "empty" },
      });
    }
  }
  return result;
}

export function commentLocation(row: UnifiedDiffRow) {
  if (row.kind === "addition" || row.kind === "context") {
    return row.newLine == null ? null : { line: row.newLine, side: "RIGHT" as const };
  }
  if (row.kind === "deletion") {
    return row.oldLine == null ? null : { line: row.oldLine, side: "LEFT" as const };
  }
  return null;
}

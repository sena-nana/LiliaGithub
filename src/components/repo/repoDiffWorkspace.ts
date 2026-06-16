import type { CommitDiffHunk, CommitDiffLine } from "../../services/workspace";

export type RepoDiffWorkspaceMode = "hunks" | "raw";

export interface RepoDiffWorkspaceFile {
  key: string;
  path: string;
  oldPath?: string | null;
  statusLabel: string;
  statusClass?: string;
  statusLetter: string;
  statText?: string;
  additions?: number | null;
  deletions?: number | null;
  patch?: string;
  hunks?: readonly CommitDiffHunk[];
}

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseRepoDiffHunks(patch: string): CommitDiffHunk[] {
  const hunks: CommitDiffHunk[] = [];
  let current: CommitDiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of patch.split("\n")) {
    const hunkMatch = line.match(HUNK_HEADER_PATTERN);
    if (hunkMatch) {
      current = {
        header: line,
        oldStart: Number(hunkMatch[1]),
        oldLines: Number(hunkMatch[2] ?? "1"),
        newStart: Number(hunkMatch[3]),
        newLines: Number(hunkMatch[4] ?? "1"),
        lines: [],
      };
      oldLine = current.oldStart;
      newLine = current.newStart;
      hunks.push(current);
      continue;
    }

    if (!current || isDiffMetadataLine(line)) continue;
    const parsedLine = parseHunkLine(line, oldLine, newLine);
    current.lines.push(parsedLine.line);
    oldLine = parsedLine.nextOldLine;
    newLine = parsedLine.nextNewLine;
  }

  return hunks;
}

function parseHunkLine(line: string, oldLine: number, newLine: number) {
  const prefix = line.slice(0, 1);
  const content = line.slice(1);

  if (prefix === "+") {
    return {
      line: { kind: "added", content, oldLine: null, newLine } satisfies CommitDiffLine,
      nextOldLine: oldLine,
      nextNewLine: newLine + 1,
    };
  }

  if (prefix === "-") {
    return {
      line: { kind: "deleted", content, oldLine, newLine: null } satisfies CommitDiffLine,
      nextOldLine: oldLine + 1,
      nextNewLine: newLine,
    };
  }

  if (prefix === "\\") {
    return {
      line: { kind: "meta", content: line, oldLine: null, newLine: null } satisfies CommitDiffLine,
      nextOldLine: oldLine,
      nextNewLine: newLine,
    };
  }

  return {
    line: { kind: "context", content: prefix === " " ? content : line, oldLine, newLine } satisfies CommitDiffLine,
    nextOldLine: oldLine + 1,
    nextNewLine: newLine + 1,
  };
}

function isDiffMetadataLine(line: string) {
  return (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("---") ||
    line.startsWith("+++")
  );
}

import type { RepoConflictChoice, RepoConflictHunk } from "../../services/workspace";

type ConflictSide = RepoConflictChoice["side"];

export function applyConflictChoices(
  content: string,
  hunks: readonly Pick<RepoConflictHunk, "id">[],
  choices: Readonly<Record<string, ConflictSide>>,
): string {
  const lines = content.split("\n");
  const output: string[] = [];
  let index = 0;
  let hunkIndex = 0;

  while (index < lines.length) {
    if (!lines[index].startsWith("<<<<<<<")) {
      output.push(lines[index]);
      index += 1;
      continue;
    }

    const start = index;
    const separator = findMarkerLine(lines, start + 1, "=======");
    const end = separator < 0 ? -1 : findMarkerLine(lines, separator + 1, ">>>>>>>");
    if (separator < 0 || end < 0) {
      output.push(...lines.slice(start));
      break;
    }

    const hunk = hunks[hunkIndex];
    const choice = hunk ? choices[hunk.id] : undefined;
    hunkIndex += 1;
    if (choice === "ours") output.push(...lines.slice(start + 1, separator));
    else if (choice === "theirs") output.push(...lines.slice(separator + 1, end));
    else output.push(...lines.slice(start, end + 1));
    index = end + 1;
  }

  return output.join("\n");
}

export function conflictMarkerCount(content: string) {
  const starts = content.match(/^<<<<<<<.*$/gm)?.length ?? 0;
  const separators = content.match(/^=======.*$/gm)?.length ?? 0;
  const ends = content.match(/^>>>>>>>.*$/gm)?.length ?? 0;
  return Math.max(starts, separators, ends);
}

function findMarkerLine(lines: readonly string[], start: number, marker: string) {
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index].startsWith(marker)) return index;
  }
  return -1;
}

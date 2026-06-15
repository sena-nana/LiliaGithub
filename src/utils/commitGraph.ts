import type { CommitSummary } from "../services/workspace";

export type CommitGraphLineRole = "top" | "bottom";
export type CommitGraphNodeIconType = "commit" | "merge" | "root";

export interface CommitGraphLine {
  id: string;
  hidden: boolean;
  lane: number;
  targetLanes: number[];
  color: string;
  role: CommitGraphLineRole;
}

export interface CommitGraphNode {
  lane: number;
  color: string;
  iconType: CommitGraphNodeIconType;
}

export interface CommitGraphRow {
  commit: CommitSummary;
  rowIndex: number;
  laneCount: number;
  maxLaneCount: number;
  nodeLane: number;
  node: CommitGraphNode;
  topLine: CommitGraphLine[];
  bottomLine: CommitGraphLine[];
}

interface LaneState {
  hash: string;
  color: string;
}

interface MutableRow extends Omit<CommitGraphRow, "maxLaneCount"> {
  maxLaneCount?: number;
}

const laneColors = [
  "#3b82f6",
  "#22a06b",
  "#d97706",
  "#8b5cf6",
  "#e11d48",
  "#0891b2",
  "#65a30d",
  "#c026d3",
] as const;

function colorAt(index: number) {
  return laneColors[index % laneColors.length];
}

function uniqueHashes(hashes: readonly string[]) {
  const seen = new Set<string>();
  return hashes.filter((hash) => {
    const normalized = hash.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function colorForHash(hash: string, colorByHash: Map<string, string>) {
  const existing = colorByHash.get(hash);
  if (existing) return existing;
  const next = colorAt(colorByHash.size);
  colorByHash.set(hash, next);
  return next;
}

function removeLaneAt(lanes: LaneState[], index: number) {
  if (index >= 0 && index < lanes.length) lanes.splice(index, 1);
}

function nodeIconType(parentCount: number): CommitGraphNodeIconType {
  if (parentCount === 0) return "root";
  if (parentCount > 1) return "merge";
  return "commit";
}

function uniqueLanes(lanes: readonly number[]) {
  return Array.from(new Set(lanes)).sort((left, right) => left - right);
}

function makeLine(
  rowIndex: number,
  role: CommitGraphLineRole,
  lane: number,
  color: string,
  targetLanes: readonly number[] = [],
  hidden = false,
): CommitGraphLine {
  const targets = uniqueLanes(targetLanes);
  return {
    id: `${rowIndex}:${role}:${lane}:${targets.join(",")}`,
    hidden,
    lane,
    targetLanes: targets,
    color,
    role,
  };
}

function mergeLines(lines: CommitGraphLine[]) {
  const merged = new Map<string, CommitGraphLine>();
  lines.forEach((line) => {
    const key = `${line.role}:${line.lane}:${line.color}:${line.hidden}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...line, targetLanes: [...line.targetLanes] });
      return;
    }
    existing.targetLanes = uniqueLanes([...existing.targetLanes, ...line.targetLanes]);
    existing.id = `${existing.id.split(":").slice(0, 3).join(":")}:${existing.targetLanes.join(",")}`;
  });
  return Array.from(merged.values());
}

function normalizeAdjacentNodeConnections(rows: MutableRow[]) {
  rows.forEach((row) => {
    const lanesConnectedToNode = new Set(row.topLine.flatMap((line) => line.targetLanes));
    if (!lanesConnectedToNode.size) return;
    row.topLine = row.topLine.filter((line) => line.targetLanes.length || !lanesConnectedToNode.has(line.lane));
    row.topLine = mergeLines(row.topLine);
  });
}

export function buildCommitGraph(commits: readonly CommitSummary[]): CommitGraphRow[] {
  const knownHashes = new Set(commits.map((commit) => commit.hash));
  const colorByHash = new Map<string, string>();
  const rows: MutableRow[] = [];
  let lanes: LaneState[] = [];
  let maxLaneCount = 1;

  commits.forEach((commit, rowIndex) => {
    let nodeLane = lanes.findIndex((lane) => lane.hash === commit.hash);
    const isHeadNode = nodeLane < 0;
    if (nodeLane < 0) {
      nodeLane = lanes.length;
      lanes.push({ hash: commit.hash, color: colorByHash.get(commit.hash) ?? colorAt(colorByHash.size) });
    }

    const before = lanes.map((lane) => ({ ...lane }));
    const after = before.map((lane) => ({ ...lane }));
    const nodeColor = before[nodeLane]?.color ?? colorByHash.get(commit.hash) ?? colorAt(colorByHash.size);
    const topJoins: CommitGraphLine[] = [];
    const bottomJoins: CommitGraphLine[] = [];
    const bottomJoinTargets = new Set<number>();
    const danglingBottom = new Map<number, string>();
    const parents = uniqueHashes(commit.parents);
    const duplicateLanes = before
      .map((lane, index) => (lane.hash === commit.hash && index !== nodeLane ? index : -1))
      .filter((index) => index >= 0);

    duplicateLanes.forEach((lane) => {
      topJoins.push(makeLine(rowIndex, "top", nodeLane, before[lane]?.color ?? nodeColor, [lane]));
    });
    [...duplicateLanes].sort((left, right) => right - left).forEach((lane) => removeLaneAt(after, lane));

    if (!parents.length) {
      removeLaneAt(after, nodeLane);
    } else {
      const firstParent = parents[0];
      if (knownHashes.has(firstParent)) {
        after[nodeLane] = { hash: firstParent, color: nodeColor };
        if (!colorByHash.has(firstParent)) colorByHash.set(firstParent, nodeColor);
      } else {
        danglingBottom.set(nodeLane, nodeColor);
        removeLaneAt(after, nodeLane);
      }

      let insertedParents = 0;
      parents.slice(1).forEach((parent) => {
        const fallbackLane = nodeLane + 1 + insertedParents;
        const parentColor = colorForHash(parent, colorByHash);

        if (!knownHashes.has(parent)) {
          danglingBottom.set(fallbackLane, parentColor);
          bottomJoins.push(makeLine(rowIndex, "bottom", nodeLane, nodeColor, [fallbackLane]));
          bottomJoinTargets.add(fallbackLane);
          insertedParents += 1;
          return;
        }

        const existingLane = after.findIndex((lane) => lane.hash === parent);
        if (existingLane >= 0) {
          bottomJoins.push(makeLine(rowIndex, "bottom", nodeLane, nodeColor, [existingLane]));
          bottomJoinTargets.add(existingLane);
          return;
        }

        const targetLane = Math.min(fallbackLane, after.length);
        after.splice(targetLane, 0, { hash: parent, color: parentColor });
        bottomJoins.push(makeLine(rowIndex, "bottom", nodeLane, parentColor, [targetLane]));
        bottomJoinTargets.add(targetLane);
        insertedParents += 1;
      });
    }

    const laneCount = Math.max(
      1,
      before.length,
      after.length,
      nodeLane + 1,
      ...topJoins.flatMap((line) => [line.lane + 1, ...line.targetLanes.map((lane) => lane + 1)]),
      ...bottomJoins.flatMap((line) => [line.lane + 1, ...line.targetLanes.map((lane) => lane + 1)]),
      ...Array.from(danglingBottom.keys(), (lane) => lane + 1),
    );
    maxLaneCount = Math.max(maxLaneCount, laneCount);
    const linesForRow = Array.from({ length: laneCount }, (_, index) => ({
      index,
      color: before[index]?.color ?? after[index]?.color ?? danglingBottom.get(index) ?? colorAt(index),
      top: Boolean(before[index]),
      bottom: (Boolean(after[index]) || danglingBottom.has(index)) && !bottomJoinTargets.has(index),
    }));
    const topLine = mergeLines([
      ...linesForRow
        .filter((line) => line.top)
        .map((line) => makeLine(rowIndex, "top", line.index, line.color, [], isHeadNode && line.index === nodeLane)),
      ...topJoins,
    ]);
    const bottomLine = mergeLines([
      ...linesForRow.filter((line) => line.bottom).map((line) => makeLine(rowIndex, "bottom", line.index, line.color)),
      ...bottomJoins,
    ]);

    lanes = after;
    rows.push({
      commit,
      rowIndex,
      laneCount,
      nodeLane,
      node: { lane: nodeLane, color: nodeColor, iconType: nodeIconType(parents.length) },
      topLine,
      bottomLine,
    });
  });

  normalizeAdjacentNodeConnections(rows);

  return rows.map((row) => ({ ...row, maxLaneCount }));
}

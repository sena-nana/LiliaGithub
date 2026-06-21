import { parse as parseYaml } from "yaml";
import type { GitHubWorkflowJob, GitHubWorkflowRunDetail } from "../services/workspace/types";
import { workflowRunStatusTone, type WorkflowRunTone } from "./repoDisplay";

export interface WorkflowGraphNode {
  id: string;
  job: GitHubWorkflowJob;
  tone: WorkflowRunTone;
  column: number;
  x: number;
  y: number;
}

export interface WorkflowGraphEdge {
  id: string;
  color: string;
  path: string;
}

export interface WorkflowGraph {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  width: number;
  height: number;
  nodeWidth: number;
  nodeHeight: number;
}

interface WorkflowJobDefinition {
  key: string;
  name: string | null;
  needs: string[];
}

type LayoutNode = WorkflowGraphNode & {
  workflowKey?: string;
  needs: string[];
};

const nodeWidth = 220;
const nodeHeight = 66;
const columnGap = 76;
const rowGap = 18;
const paddingX = 14;
const paddingY = 12;

const toneColors: Record<WorkflowRunTone, string> = {
  ok: "var(--ok)",
  error: "var(--err)",
  warn: "var(--warn)",
  muted: "var(--text-muted)",
};

export function buildWorkflowGraph(detail: GitHubWorkflowRunDetail | null): WorkflowGraph {
  const jobs = detail?.jobs ?? [];
  if (!jobs.length) return emptyGraph();

  const definitions = parseWorkflowJobDefinitions(detail?.workflow?.content ?? null);
  const matchByJobId = matchWorkflowJobs(jobs, definitions);
  const nodes: LayoutNode[] = jobs.map((job) => {
    const definition = matchByJobId.get(job.id) ?? null;
    const tone = workflowRunStatusTone(job);
    return {
      id: String(job.id),
      job,
      workflowKey: definition?.key,
      needs: definition?.needs ?? [],
      tone,
      column: 0,
      x: 0,
      y: 0,
    };
  });

  const matchedNodeByWorkflowKey = new Map(
    nodes
      .filter((node) => node.workflowKey)
      .map((node) => [node.workflowKey, node] as const),
  );

  const rawEdges: Array<{ from: LayoutNode; to: LayoutNode }> = [];
  for (const node of nodes) {
    for (const need of node.needs) {
      const source = matchedNodeByWorkflowKey.get(need);
      if (source) rawEdges.push({ from: source, to: node });
    }
  }

  const acyclic = assignLayoutColumns(nodes, rawEdges);
  const layoutEdges = acyclic ? rawEdges : [];
  assignNodeCoordinates(nodes);

  const edges = layoutEdges.map(({ from, to }) => ({
    id: `${from.id}->${to.id}`,
    color: toneColors[from.tone],
    path: connectorPath(from, to),
  }));

  const width = Math.max(
    nodeWidth + paddingX * 2,
    Math.max(...nodes.map((node) => node.x + nodeWidth), nodeWidth) + paddingX,
  );
  const height = Math.max(
    nodeHeight + paddingY * 2,
    Math.max(...nodes.map((node) => node.y + nodeHeight), nodeHeight) + paddingY,
  );

  return { nodes, edges, width, height, nodeWidth, nodeHeight };
}

function emptyGraph(): WorkflowGraph {
  return { nodes: [], edges: [], width: nodeWidth + paddingX * 2, height: nodeHeight + paddingY * 2, nodeWidth, nodeHeight };
}

function parseWorkflowJobDefinitions(content: string | null): WorkflowJobDefinition[] {
  if (!content) return [];
  try {
    const parsed: unknown = parseYaml(content);
    if (!isRecord(parsed) || !isRecord(parsed.jobs)) return [];
    return Object.entries(parsed.jobs).flatMap(([key, rawJob]) => {
      if (!isRecord(rawJob)) return [];
      return [{
        key,
        name: readString(rawJob.name),
        needs: readNeeds(rawJob.needs),
      }];
    });
  } catch {
    return [];
  }
}

function matchWorkflowJobs(
  jobs: readonly GitHubWorkflowJob[],
  definitions: readonly WorkflowJobDefinition[],
) {
  const candidates = new Map<string, WorkflowJobDefinition[]>();
  for (const definition of definitions) {
    addCandidate(candidates, definition.key, definition);
    if (definition.name) addCandidate(candidates, definition.name, definition);
  }

  const usedKeys = new Set<string>();
  const matchByJobId = new Map<number, WorkflowJobDefinition>();
  for (const job of jobs) {
    const normalizedName = normalizeLabel(job.name);
    const matches = normalizedName ? candidates.get(normalizedName) ?? [] : [];
    if (matches.length !== 1 || usedKeys.has(matches[0].key)) continue;
    usedKeys.add(matches[0].key);
    matchByJobId.set(job.id, matches[0]);
  }
  return matchByJobId;
}

function addCandidate(
  candidates: Map<string, WorkflowJobDefinition[]>,
  value: string,
  definition: WorkflowJobDefinition,
) {
  const normalized = normalizeLabel(value);
  if (!normalized) return;
  const existing = candidates.get(normalized) ?? [];
  if (existing.some((candidate) => candidate.key === definition.key)) return;
  candidates.set(normalized, [...existing, definition]);
}

function assignLayoutColumns(
  nodes: LayoutNode[],
  edges: Array<{ from: LayoutNode; to: LayoutNode }>,
) {
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, LayoutNode[]>();
  for (const edge of edges) {
    incomingCount.set(edge.to.id, (incomingCount.get(edge.to.id) ?? 0) + 1);
    outgoing.set(edge.from.id, [...(outgoing.get(edge.from.id) ?? []), edge.to]);
  }

  const queue = nodes.filter((node) => incomingCount.get(node.id) === 0);
  let visited = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index];
    visited += 1;
    for (const target of outgoing.get(node.id) ?? []) {
      target.column = Math.max(target.column, node.column + 1);
      incomingCount.set(target.id, (incomingCount.get(target.id) ?? 0) - 1);
      if (incomingCount.get(target.id) === 0) queue.push(target);
    }
  }

  if (visited !== nodes.length) {
    for (const node of nodes) node.column = 0;
    return false;
  }
  return true;
}

function assignNodeCoordinates(nodes: WorkflowGraphNode[]) {
  const rowsByColumn = new Map<number, WorkflowGraphNode[]>();
  for (const node of nodes) {
    const columnNodes = rowsByColumn.get(node.column) ?? [];
    columnNodes.push(node);
    rowsByColumn.set(node.column, columnNodes);
  }
  for (const [column, columnNodes] of rowsByColumn) {
    columnNodes.forEach((node, row) => {
      node.x = paddingX + column * (nodeWidth + columnGap);
      node.y = paddingY + row * (nodeHeight + rowGap);
    });
  }
}

function connectorPath(from: WorkflowGraphNode, to: WorkflowGraphNode) {
  const startX = from.x + nodeWidth;
  const startY = from.y + nodeHeight / 2;
  const endX = to.x;
  const endY = to.y + nodeHeight / 2;
  const handle = Math.max(32, Math.abs(endX - startX) * 0.42);
  return `M ${startX} ${startY} C ${startX + handle} ${startY}, ${endX - handle} ${endY}, ${endX} ${endY}`;
}

function readNeeds(value: unknown): string[] {
  if (typeof value === "string") return [value].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeLabel(value: string) {
  return value.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

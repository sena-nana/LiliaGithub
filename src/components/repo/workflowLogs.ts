import type { GitHubWorkflowJob, GitHubWorkflowJobStep } from "../../services/workspace/types";

export interface WorkflowStepLogSection {
  step: GitHubWorkflowJobStep;
  content: string;
  matched: boolean;
}

type LogGroup = {
  title: string;
  lines: string[];
};

const GROUP_MARKER = "##[group]";
const END_GROUP_MARKER = "##[endgroup]";

export function parseWorkflowJobLogSections(
  job: GitHubWorkflowJob,
  log: string,
): WorkflowStepLogSection[] {
  const groups = parseLogGroups(log);
  const usedGroups = new Set<number>();
  return job.steps.map((step) => {
    const groupIndex = groups.findIndex((group, index) =>
      !usedGroups.has(index) && logTitleMatchesStep(group.title, step.name)
    );
    if (groupIndex >= 0) {
      usedGroups.add(groupIndex);
      return {
        step,
        content: groups[groupIndex].lines.join("\n").trimEnd(),
        matched: true,
      };
    }
    return {
      step,
      content: log.trimEnd(),
      matched: false,
    };
  });
}

export function parseLogGroups(log: string): LogGroup[] {
  const groups: LogGroup[] = [];
  let active: LogGroup | null = null;
  for (const line of log.split(/\r?\n/)) {
    const groupTitle = groupTitleFromLine(line);
    if (groupTitle != null) {
      if (active) groups.push(active);
      active = { title: groupTitle, lines: [] };
      continue;
    }
    if (line.includes(END_GROUP_MARKER)) {
      if (active) {
        groups.push(active);
        active = null;
      }
      continue;
    }
    active?.lines.push(line);
  }
  if (active) groups.push(active);
  return groups;
}

function groupTitleFromLine(line: string) {
  const markerIndex = line.indexOf(GROUP_MARKER);
  if (markerIndex < 0) return null;
  return line.slice(markerIndex + GROUP_MARKER.length).trim();
}

function logTitleMatchesStep(title: string, stepName: string) {
  const normalizedTitle = normalizeLogTitle(title);
  const normalizedStep = normalizeLogTitle(stepName);
  return normalizedTitle === normalizedStep ||
    normalizedTitle.includes(normalizedStep) ||
    normalizedStep.includes(normalizedTitle);
}

function normalizeLogTitle(value: string) {
  return value
    .replace(/^run\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

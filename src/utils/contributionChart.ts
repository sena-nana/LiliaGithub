import type { GitHubContributionDay } from "../services/workspace";

type ContributionCell = {
  date: string;
  level: number;
  weekStart: string;
  title: string;
  x: number;
  y: number;
};

export type ContributionActiveCell = Pick<ContributionCell, "date" | "title">;

export type ContributionMonthLabel = {
  key: string;
  label: string;
  x: number;
};

export type ContributionLevelPath = {
  level: number;
  d: string;
};

export type ContributionDayLabel = {
  label: string;
  x: number;
  y: number;
};

export type ContributionChartModel = {
  activeCells: ContributionActiveCell[];
  monthLabels: ContributionMonthLabel[];
  dayLabels: ContributionDayLabel[];
  levelPaths: ContributionLevelPath[];
  width: number;
  height: number;
  viewBox: string;
};

const CELL_SIZE = 11;
const CELL_GAP = 3;
const CELL_RADIUS = 2;
const LABEL_WIDTH = 42;
const MONTH_LABEL_HEIGHT = 14;
const WEEK_DAY_LABELS: readonly { label: string; dayIndex: number }[] = [
  { label: "Mon", dayIndex: 1 },
  { label: "Wed", dayIndex: 3 },
  { label: "Fri", dayIndex: 5 },
];

export function buildContributionChartModel(days: readonly GitHubContributionDay[]) {
  const cells = buildContributionCells(days);
  const weekCount = Math.ceil(cells.length / 7);
  const width = chartWidth(weekCount);
  const height = chartHeight();
  return {
    activeCells: cells
      .filter((cell) => cell.level > 0)
      .map(({ date, title }) => ({ date, title })),
    monthLabels: buildContributionMonthLabels(cells, days),
    dayLabels: buildDayLabels(),
    levelPaths: buildContributionLevelPaths(cells),
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
  };
}

function buildContributionCells(days: readonly GitHubContributionDay[]) {
  if (!days.length) return [];
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const maxCount = Math.max(1, ...sorted.map((day) => day.count));
  const start = parseDateOnly(sorted[0].date);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = parseDateOnly(sorted[sorted.length - 1].date);
  end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));
  const byDate = new Map(sorted.map((day) => [day.date, day]));
  const cells: ContributionCell[] = [];
  let weekIndex = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(cursor);
      date.setUTCDate(cursor.getUTCDate() + offset);
      const key = date.toISOString().slice(0, 10);
      const day = byDate.get(key) ?? { date: key, count: 0 };
      const title = contributionTitle(day);
      cells.push({
        date: day.date,
        level: contributionLevel(day.count, maxCount),
        weekStart: cursor.toISOString().slice(0, 10),
        title,
        x: contributionCellX(weekIndex),
        y: contributionCellY(offset),
      });
    }
    weekIndex += 1;
  }
  return cells;
}

function buildContributionMonthLabels(
  cells: readonly ContributionCell[],
  days: readonly GitHubContributionDay[],
): ContributionMonthLabel[] {
  let lastMonth = "";
  const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const start = sortedDays[0]?.date ?? "";
  const end = sortedDays[sortedDays.length - 1]?.date ?? "";
  const isInRange = (date: string) => start !== "" && date >= start && date <= end;
  const labels: ContributionMonthLabel[] = [];
  for (let index = 0; index < cells.length; index += 7) {
    const week = cells.slice(index, index + 7);
    const weekIndex = index / 7;
    const weekStart = week[0]?.weekStart ?? String(weekIndex);
    const month = week
      .filter((day) => isInRange(day.date))
      .map((day) => day.date.slice(0, 7))
      .find((value) => value && value !== lastMonth) ?? "";
    const label = month && month !== lastMonth ? formatContributionMonth(month) : "";
    if (month) lastMonth = month;
    labels.push({
      key: weekStart,
      label,
      x: contributionCellX(weekIndex),
    });
  }
  return labels;
}

function buildDayLabels(): ContributionDayLabel[] {
  return WEEK_DAY_LABELS.map(({ label, dayIndex }) => ({
    label,
    x: 0,
    y: contributionCellY(dayIndex) + CELL_SIZE - 1,
  }));
}

function buildContributionLevelPaths(cells: readonly ContributionCell[]): ContributionLevelPath[] {
  const pathsByLevel = new Map<number, string[]>();
  for (const cell of cells) {
    const level = Math.min(4, Math.max(0, Math.floor(cell.level)));
    const paths = pathsByLevel.get(level) ?? [];
    paths.push(roundedRectPath(cell.x, cell.y, CELL_SIZE, CELL_SIZE, CELL_RADIUS));
    pathsByLevel.set(level, paths);
  }
  return [...pathsByLevel.entries()]
    .sort(([left], [right]) => left - right)
    .map(([level, paths]) => ({ level, d: paths.join("") }));
}

function contributionCellX(weekIndex: number) {
  return LABEL_WIDTH + weekIndex * (CELL_SIZE + CELL_GAP);
}

function contributionCellY(dayIndex: number) {
  return MONTH_LABEL_HEIGHT + dayIndex * (CELL_SIZE + CELL_GAP);
}

function chartWidth(weekCount: number) {
  return LABEL_WIDTH + Math.max(0, weekCount * (CELL_SIZE + CELL_GAP) - CELL_GAP);
}

function chartHeight() {
  return MONTH_LABEL_HEIGHT + 7 * CELL_SIZE + 6 * CELL_GAP;
}

function roundedRectPath(x: number, y: number, width: number, height: number, radius: number) {
  const right = x + width;
  const bottom = y + height;
  return [
    `M${x + radius} ${y}`,
    `H${right - radius}`,
    `Q${right} ${y} ${right} ${y + radius}`,
    `V${bottom - radius}`,
    `Q${right} ${bottom} ${right - radius} ${bottom}`,
    `H${x + radius}`,
    `Q${x} ${bottom} ${x} ${bottom - radius}`,
    `V${y + radius}`,
    `Q${x} ${y} ${x + radius} ${y}`,
    "Z",
  ].join("");
}

function formatContributionMonth(month: string) {
  const [, rawMonth] = month.split("-");
  return `${Number(rawMonth)}月`;
}

function parseDateOnly(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

function contributionLevel(count: number, maxCount: number) {
  if (count <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / maxCount) * 4)));
}

function contributionTitle(day: Pick<GitHubContributionDay, "date" | "count">) {
  return `${day.date}：${day.count} 次提交`;
}

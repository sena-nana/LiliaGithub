import type { GitHubContributionDay } from "../services/workspace";

export type ContributionCell = {
  date: string;
  level: number;
  weekStart: string;
  title: string;
};

export type ContributionMonthLabel = {
  key: string;
  label: string;
};

export function buildContributionChartModel(days: readonly GitHubContributionDay[]) {
  const weeks = buildContributionWeeks(days);
  return {
    html: buildContributionChartHtml(weeks, buildContributionMonthLabels(weeks, days)),
  };
}

function buildContributionWeeks(days: readonly GitHubContributionDay[]) {
  if (!days.length) return [];
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const maxCount = Math.max(1, ...sorted.map((day) => day.count));
  const start = parseDateOnly(sorted[0].date);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = parseDateOnly(sorted[sorted.length - 1].date);
  end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));
  const byDate = new Map(sorted.map((day) => [day.date, day]));
  const weeks: ContributionCell[][] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
    const week: ContributionCell[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(cursor);
      date.setUTCDate(cursor.getUTCDate() + offset);
      const key = date.toISOString().slice(0, 10);
      const day = byDate.get(key) ?? { date: key, count: 0 };
      const title = contributionTitle(day);
      week.push({
        date: day.date,
        level: contributionLevel(day.count, maxCount),
        weekStart: cursor.toISOString().slice(0, 10),
        title,
      });
    }
    weeks.push(week);
  }
  return weeks;
}

function buildContributionMonthLabels(
  weeks: readonly ContributionCell[][],
  days: readonly GitHubContributionDay[],
): ContributionMonthLabel[] {
  let lastMonth = "";
  const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const start = sortedDays[0]?.date ?? "";
  const end = sortedDays[sortedDays.length - 1]?.date ?? "";
  const isInRange = (date: string) => start !== "" && date >= start && date <= end;
  return weeks.map((week, index) => {
    const weekStart = week[0]?.weekStart ?? String(index);
    const month = week
      .filter((day) => isInRange(day.date))
      .map((day) => day.date.slice(0, 7))
      .find((value) => value && value !== lastMonth) ?? "";
    const label = month && month !== lastMonth ? formatContributionMonth(month) : "";
    if (month) lastMonth = month;
    return {
      key: weekStart,
      label,
    };
  });
}

export function buildContributionChartHtml(
  weeks: readonly (readonly ContributionCell[])[],
  monthLabels: readonly ContributionMonthLabel[],
) {
  const months = monthLabels
    .map((month) =>
      `<span class="contribution-month" data-key="${escapeHtmlAttribute(month.key)}">${escapeHtmlText(month.label)}</span>`
    )
    .join("");
  const weekHtml = weeks
    .map((week) => {
      const days = week
        .map((day) => {
          const level = Math.min(4, Math.max(0, Math.floor(day.level)));
          const title = escapeHtmlAttribute(day.title);
          return `<span class="contribution-day contribution-day--${level}" title="${title}" aria-label="${title}"></span>`;
        })
        .join("");
      return `<div class="contribution-week">${days}</div>`;
    })
    .join("");
  return `<div class="contribution-grid"><div class="contribution-months" aria-hidden="true">${months}</div><div class="contribution-weeks" role="img" aria-label="本地提交贡献图">${weekHtml}</div></div>`;
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

function escapeHtmlText(value: string) {
  return value.replace(/[&<>]/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    return "&gt;";
  });
}

function escapeHtmlAttribute(value: string) {
  return escapeHtmlText(value).replace(/["']/g, (char) => char === "\"" ? "&quot;" : "&#39;");
}

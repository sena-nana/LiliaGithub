import type { LanguageStat, RepoSummary } from "../services/workspace";
import { githubLanguageColor } from "./githubLanguageColors";

export type LanguageSlice = {
  language: string;
  bytes: number;
  lines: number;
  percent: number;
  color: string;
  offset: number;
  title: string;
};

export type LanguageOverview = {
  totalBytes: number;
  totalLines: number;
  slices: LanguageSlice[];
};

type ProjectCodeSlice = {
  repoId: string | null;
  repoName: string;
  bytes: number;
  lines: number;
  percent: number;
  color: string;
  offset: number;
  title: string;
};

type ProjectCodeOverview = {
  totalBytes: number;
  totalLines: number;
  slices: ProjectCodeSlice[];
};

type LanguageTotal = {
  language: string;
  bytes: number;
  lines: number;
};

type ProjectCodeTotal = {
  repoId: string | null;
  repoName: string;
  bytes: number;
  lines: number;
};

const DEFAULT_LANGUAGE_SLICE_LIMIT = 6;
const DEFAULT_PROJECT_SLICE_LIMIT = 6;
const PROJECT_CODE_COLORS = [
  "#61a8fa",
  "#48be88",
  "#ce9676",
  "#ba89f6",
  "#b8a700",
  "#69be27",
] as const;
const OTHER_COLOR = "#9ca6b0";

export function buildLanguageOverviewFromRepos(
  repos: readonly RepoSummary[],
  sliceLimit = DEFAULT_LANGUAGE_SLICE_LIMIT,
): LanguageOverview {
  const totals = new Map<string, Omit<LanguageTotal, "language">>();
  for (const repo of repos) {
    for (const stat of repo.languageStats) {
      const total = totals.get(stat.language) ?? { bytes: 0, lines: 0 };
      total.bytes += stat.bytes;
      total.lines += stat.lines;
      totals.set(stat.language, total);
    }
  }
  return buildLanguageOverviewFromTotals(
    [...totals.entries()].map(([language, value]) => ({ language, ...value })),
    sliceLimit,
  );
}

export function buildProjectCodeOverviewFromRepos(
  repos: readonly RepoSummary[],
  sliceLimit = DEFAULT_PROJECT_SLICE_LIMIT,
): ProjectCodeOverview {
  const sorted = repos
    .map((repo) => {
      const totals = repo.languageStats.reduce(
        (total, stat) => ({
          bytes: total.bytes + stat.bytes,
          lines: total.lines + stat.lines,
        }),
        { bytes: 0, lines: 0 },
      );
      return {
        repoId: repo.id,
        repoName: repo.name || repo.relativePath || repo.id,
        bytes: totals.bytes,
        lines: totals.lines,
      };
    })
    .filter((item) => item.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes || a.repoName.localeCompare(b.repoName) || a.repoId.localeCompare(b.repoId));
  const remainder = sorted.slice(sliceLimit);
  const items: ProjectCodeTotal[] = sorted.slice(0, sliceLimit);
  if (remainder.length) {
    items.push({
      repoId: null,
      repoName: "Other",
      bytes: remainder.reduce((total, item) => total + item.bytes, 0),
      lines: remainder.reduce((total, item) => total + item.lines, 0),
    });
  }
  const totalBytes = items.reduce((total, item) => total + item.bytes, 0);
  const totalLines = items.reduce((total, item) => total + item.lines, 0);
  let offset = 0;
  const slices = items.map((item, index) => {
    const percent = totalBytes > 0 ? item.bytes / totalBytes * 100 : 0;
    const slice = {
      repoId: item.repoId,
      repoName: item.repoName,
      bytes: item.bytes,
      lines: item.lines,
      percent,
      color: item.repoId ? PROJECT_CODE_COLORS[index % PROJECT_CODE_COLORS.length] : OTHER_COLOR,
      offset,
      title: `${item.repoName}：${formatPercent(percent)}，${formatBytes(item.bytes)}`,
    };
    offset += percent;
    return slice;
  });
  return { totalBytes, totalLines, slices };
}

export function buildLanguageOverviewFromStats(
  stats: readonly LanguageStat[],
  sliceLimit = DEFAULT_LANGUAGE_SLICE_LIMIT,
): LanguageOverview {
  const totals = stats.map((stat) => ({
    language: stat.language,
    bytes: stat.bytes,
    lines: stat.lines,
  }));
  return buildLanguageOverviewFromTotals(totals, sliceLimit);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const units = ["MB", "GB", "TB", "PB"];
  let value = bytes / 1024 / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatLines(lines: number) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(lines));
}

export function formatPercent(percent: number) {
  return `${Math.round(percent)}%`;
}

function buildLanguageOverviewFromTotals(totals: LanguageTotal[], sliceLimit: number): LanguageOverview {
  const sorted = totals
    .filter((item) => item.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes || a.language.localeCompare(b.language));
  const top = sorted.slice(0, sliceLimit);
  const other = mergeLanguageTotals(sorted.slice(sliceLimit));
  const items = other ? [...top, other] : top;
  const totalBytes = items.reduce((total, item) => total + item.bytes, 0);
  const totalLines = items.reduce((total, item) => total + item.lines, 0);
  let offset = 0;
  const slices = items.map((item) => {
    const percent = totalBytes > 0 ? (item.bytes / totalBytes) * 100 : 0;
    const slice = buildLanguageSlice(item, percent, offset);
    offset += percent;
    return slice;
  });
  return { totalBytes, totalLines, slices };
}

function mergeLanguageTotals(totals: LanguageTotal[]) {
  if (!totals.length) return null;
  let bytes = 0;
  let lines = 0;
  for (const total of totals) {
    bytes += total.bytes;
    lines += total.lines;
  }
  return { language: "Other", bytes, lines };
}

function buildLanguageSlice(
  total: LanguageTotal,
  percent: number,
  offset: number,
): LanguageSlice {
  const title = `${total.language}：${formatPercent(percent)}，${formatBytes(total.bytes)}`;
  return {
    language: total.language,
    bytes: total.bytes,
    lines: total.lines,
    percent,
    color: githubLanguageColor(total.language),
    offset,
    title,
  };
}

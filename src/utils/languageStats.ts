import type { LanguageStat, RepoSummary } from "../services/workspace";
import { githubLanguageColor } from "./githubLanguageColors";

export type LanguageScope = "head" | "workingTree";

export type LanguageSlice = {
  language: string;
  bytes: number;
  lines: number;
  percent: number;
  color: string;
  offset: number;
  repoIds: string[];
  title: string;
};

export type LanguageOverview = {
  totalBytes: number;
  totalLines: number;
  slices: LanguageSlice[];
};

type LanguageTotal = {
  language: string;
  bytes: number;
  lines: number;
  repoBytes: Map<string, number>;
};

const DEFAULT_LANGUAGE_SLICE_LIMIT = 6;

export function buildLanguageOverviewFromRepos(
  repos: readonly RepoSummary[],
  scope: LanguageScope,
  sliceLimit = DEFAULT_LANGUAGE_SLICE_LIMIT,
): LanguageOverview {
  const totals = new Map<string, Omit<LanguageTotal, "language">>();
  for (const repo of repos) {
    const stats = scope === "workingTree" ? repo.workingTreeLanguageStats : repo.languageStats;
    for (const stat of stats) {
      const total = totals.get(stat.language) ?? { bytes: 0, lines: 0, repoBytes: new Map<string, number>() };
      total.bytes += stat.bytes;
      total.lines += stat.lines;
      total.repoBytes.set(repo.id, (total.repoBytes.get(repo.id) ?? 0) + stat.bytes);
      totals.set(stat.language, total);
    }
  }
  return buildLanguageOverviewFromTotals(
    [...totals.entries()].map(([language, value]) => ({ language, ...value })),
    sliceLimit,
  );
}

export function buildLanguageOverviewFromStats(
  stats: readonly LanguageStat[],
  sliceLimit = DEFAULT_LANGUAGE_SLICE_LIMIT,
): LanguageOverview {
  const totals = stats.map((stat) => ({
    language: stat.language,
    bytes: stat.bytes,
    lines: stat.lines,
    repoBytes: new Map<string, number>(),
  }));
  return buildLanguageOverviewFromTotals(totals, sliceLimit);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
  const repoBytes = new Map<string, number>();
  let bytes = 0;
  let lines = 0;
  for (const total of totals) {
    bytes += total.bytes;
    lines += total.lines;
    for (const [repoId, repoSliceBytes] of total.repoBytes) {
      repoBytes.set(repoId, (repoBytes.get(repoId) ?? 0) + repoSliceBytes);
    }
  }
  return { language: "Other", bytes, lines, repoBytes };
}

function buildLanguageSlice(
  total: LanguageTotal,
  percent: number,
  offset: number,
): LanguageSlice {
  const repoIds = [...total.repoBytes.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([repoId]) => repoId);
  const title = `${total.language}：${formatPercent(percent)}，${formatBytes(total.bytes)}`;
  return {
    language: total.language,
    bytes: total.bytes,
    lines: total.lines,
    percent,
    color: githubLanguageColor(total.language),
    offset,
    repoIds,
    title,
  };
}

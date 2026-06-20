import type { LanguageStat, RepoSummary } from "../services/workspace";

export type LanguageScope = "head" | "workingTree";

export type LanguageSlice = {
  language: string;
  bytes: number;
  lines: number;
  percent: number;
  color: string;
  offset: number;
  visualOffsetY: number;
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
const MAX_WARM_VISUAL_OFFSET_Y = 0.28;
const WARM_HUE_CENTER = 35;
const WARM_HUE_RANGE = 60;

export const LANGUAGE_COLORS = ["#2f81f7", "#3fb950", "#d29922", "#f85149", "#a371f7", "#db6d28", "#6e7681"];

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
  const slices = items.map((item, index) => {
    const percent = totalBytes > 0 ? (item.bytes / totalBytes) * 100 : 0;
    const slice = buildLanguageSlice(item, percent, LANGUAGE_COLORS[index % LANGUAGE_COLORS.length], offset);
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
  color: string,
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
    color,
    offset,
    visualOffsetY: languageVisualOffsetY(color),
    repoIds,
    title,
  };
}

function languageVisualOffsetY(color: string) {
  const hue = parseHexColorHue(color);
  if (hue === null) return 0;

  const distance = Math.min(Math.abs(hue - WARM_HUE_CENTER), 360 - Math.abs(hue - WARM_HUE_CENTER));
  const warmWeight = Math.max(0, 1 - distance / WARM_HUE_RANGE);
  return roundOffset(MAX_WARM_VISUAL_OFFSET_Y * warmWeight);
}

function parseHexColorHue(color: string) {
  const match = color.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return null;

  const value = match[1];
  const red = Number.parseInt(value.slice(0, 2), 16) / 255;
  const green = Number.parseInt(value.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) return null;
  if (max === red) return normalizeHue(60 * (((green - blue) / delta) % 6));
  if (max === green) return normalizeHue(60 * ((blue - red) / delta + 2));
  return normalizeHue(60 * ((red - green) / delta + 4));
}

function normalizeHue(hue: number) {
  return (hue + 360) % 360;
}

function roundOffset(value: number) {
  return Math.round(value * 100) / 100;
}

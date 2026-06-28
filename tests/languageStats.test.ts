import { describe, expect, it } from "vitest";
import {
  buildLanguageOverviewFromStats,
  buildProjectCodeOverviewFromRepos,
  formatBytes,
  formatLines,
  formatPercent,
} from "../src/utils/languageStats";
import { githubLanguageColor } from "../src/utils/githubLanguageColors";
import { repoSummary } from "./fixtures/workspace";

describe("languageStats", () => {
  it("builds top language slices and merges the remainder", () => {
    const overview = buildLanguageOverviewFromStats([
      { language: "TypeScript", bytes: 600, lines: 60 },
      { language: "Vue", bytes: 200, lines: 30 },
      { language: "Rust", bytes: 100, lines: 20 },
      { language: "CSS", bytes: 50, lines: 10 },
    ], 2);

    expect(overview.totalBytes).toBe(950);
    expect(overview.totalLines).toBe(120);
    expect(overview.slices.map((slice) => slice.language)).toEqual(["TypeScript", "Vue", "Other"]);
    expect(overview.slices[0]).toMatchObject({
      bytes: 600,
      lines: 60,
      percent: 600 / 950 * 100,
    });
    expect(overview.slices[0].color).toBe(githubLanguageColor("TypeScript"));
    expect(overview.slices[2]).toMatchObject({ bytes: 150, lines: 30 });
    expect(overview.slices[2].color).toBe(githubLanguageColor("Other"));
  });

  it("assigns language colors by normalized language name", () => {
    const overview = buildLanguageOverviewFromStats([
      { language: "Vue", bytes: 700, lines: 70 },
      { language: "TypeScript", bytes: 600, lines: 60 },
      { language: "Rust", bytes: 500, lines: 50 },
      { language: "CSS", bytes: 400, lines: 40 },
      { language: "UnknownLang", bytes: 300, lines: 30 },
    ], 5);

    const colors = Object.fromEntries(overview.slices.map((slice) => [slice.language, slice.color]));

    expect(colors.Vue).toBe(githubLanguageColor(" vue "));
    expect(colors.TypeScript).toBe(githubLanguageColor("typescript"));
    expect(colors.UnknownLang).toBe(githubLanguageColor("UnknownLang"));
    expect(colors.Vue).not.toBe(colors.TypeScript);
  });

  it("builds top project code slices and merges the remainder", () => {
    const overview = buildProjectCodeOverviewFromRepos([
      repoSummary("RepoA", { languageStats: [{ language: "TypeScript", bytes: 1000, lines: 10 }] }),
      repoSummary("RepoB", { languageStats: [{ language: "Vue", bytes: 900, lines: 9 }] }),
      repoSummary("RepoC", { languageStats: [{ language: "Rust", bytes: 800, lines: 8 }] }),
      repoSummary("RepoD", { languageStats: [{ language: "CSS", bytes: 700, lines: 7 }] }),
      repoSummary("RepoE", { languageStats: [{ language: "Go", bytes: 600, lines: 6 }] }),
      repoSummary("RepoF", { languageStats: [{ language: "Python", bytes: 500, lines: 5 }] }),
      repoSummary("RepoG", { languageStats: [{ language: "Shell", bytes: 400, lines: 4 }] }),
      repoSummary("RepoZero", { languageStats: [{ language: "Markdown", bytes: 0, lines: 100 }] }),
    ]);

    expect(overview.totalBytes).toBe(4900);
    expect(overview.totalLines).toBe(49);
    expect(overview.slices.map((slice) => slice.repoName)).toEqual([
      "RepoA",
      "RepoB",
      "RepoC",
      "RepoD",
      "RepoE",
      "RepoF",
      "Other",
    ]);
    expect(overview.slices[0]).toMatchObject({
      repoId: "RepoA",
      bytes: 1000,
      lines: 10,
    });
    expect(overview.slices[0].percent).toBeCloseTo(1000 / 4900 * 100);
    expect(overview.slices[6]).toMatchObject({
      repoId: null,
      bytes: 400,
      lines: 4,
    });
  });

  it("keeps the same language color when rank changes", () => {
    const first = buildLanguageOverviewFromStats([
      { language: "TypeScript", bytes: 100, lines: 10 },
      { language: "Vue", bytes: 50, lines: 5 },
    ]);
    const second = buildLanguageOverviewFromStats([
      { language: "Vue", bytes: 100, lines: 10 },
      { language: "TypeScript", bytes: 50, lines: 5 },
    ]);

    const firstColor = first.slices.find((slice) => slice.language === "TypeScript")?.color;
    const secondColor = second.slices.find((slice) => slice.language === "TypeScript")?.color;

    expect(firstColor).toBe(secondColor);
    expect(firstColor).toBe(githubLanguageColor("TypeScript"));
  });

  it("formats code totals consistently", () => {
    expect(formatBytes(1000)).toBe("1000 B");
    expect(formatBytes(4096)).toBe("4 KB");
    expect(formatPercent(66.6)).toBe("67%");
    expect(formatLines(12345)).toBe("12,345");
  });
});

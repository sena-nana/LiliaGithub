import { describe, expect, it } from "vitest";
import {
  buildLanguageOverviewFromStats,
  formatBytes,
  formatLines,
  formatPercent,
} from "../src/utils/languageStats";

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
      color: "#3178c6",
    });
    expect(overview.slices[2]).toMatchObject({ bytes: 150, lines: 30, color: "#6e7781" });
  });

  it("uses GitHub Linguist colors by language name", () => {
    const overview = buildLanguageOverviewFromStats([
      { language: "Vue", bytes: 700, lines: 70 },
      { language: "TypeScript", bytes: 600, lines: 60 },
      { language: "Rust", bytes: 500, lines: 50 },
      { language: "CSS", bytes: 400, lines: 40 },
      { language: "UnknownLang", bytes: 300, lines: 30 },
    ], 5);

    expect(overview.slices.map((slice) => slice.color)).toEqual([
      "#41b883",
      "#3178c6",
      "#dea584",
      "#663399",
      "#6e7781",
    ]);
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

    expect(first.slices.find((slice) => slice.language === "TypeScript")?.color).toBe("#3178c6");
    expect(second.slices.find((slice) => slice.language === "TypeScript")?.color).toBe("#3178c6");
  });

  it("formats code totals consistently", () => {
    expect(formatBytes(1000)).toBe("1000 B");
    expect(formatBytes(4096)).toBe("4 KB");
    expect(formatPercent(66.6)).toBe("67%");
    expect(formatLines(12345)).toBe("12,345");
  });
});

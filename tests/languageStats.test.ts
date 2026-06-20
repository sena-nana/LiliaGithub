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
    expect(overview.slices[0]).toMatchObject({ bytes: 600, lines: 60, percent: 600 / 950 * 100 });
    expect(overview.slices[2]).toMatchObject({ bytes: 150, lines: 30 });
  });

  it("formats code totals consistently", () => {
    expect(formatBytes(1000)).toBe("1000 B");
    expect(formatBytes(4096)).toBe("4 KB");
    expect(formatPercent(66.6)).toBe("67%");
    expect(formatLines(12345)).toBe("12,345");
  });
});

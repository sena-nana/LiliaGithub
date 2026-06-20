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
      visualOffsetY: expect.any(Number),
    });
    expect(overview.slices[2]).toMatchObject({ bytes: 150, lines: 30 });
  });

  it("adds small hue-based visual offsets for language color slices", () => {
    const overview = buildLanguageOverviewFromStats([
      { language: "Blue", bytes: 700, lines: 70 },
      { language: "Green", bytes: 600, lines: 60 },
      { language: "Yellow", bytes: 500, lines: 50 },
      { language: "Red", bytes: 400, lines: 40 },
      { language: "Purple", bytes: 300, lines: 30 },
      { language: "Orange", bytes: 200, lines: 20 },
      { language: "Gray", bytes: 100, lines: 10 },
    ], 7);
    const offsetsByColor = new Map(overview.slices.map((slice) => [slice.color, slice.visualOffsetY]));

    expect(offsetsByColor.get("#d29922")).toBeGreaterThan(0);
    expect(offsetsByColor.get("#d29922")).toBeLessThanOrEqual(0.28);
    expect(offsetsByColor.get("#db6d28")).toBeGreaterThan(0);
    expect(offsetsByColor.get("#db6d28")).toBeLessThanOrEqual(0.28);
    expect(offsetsByColor.get("#2f81f7")).toBe(0);
    expect(offsetsByColor.get("#3fb950")).toBe(0);
    expect(offsetsByColor.get("#6e7681")).toBe(0);
  });

  it("formats code totals consistently", () => {
    expect(formatBytes(1000)).toBe("1000 B");
    expect(formatBytes(4096)).toBe("4 KB");
    expect(formatPercent(66.6)).toBe("67%");
    expect(formatLines(12345)).toBe("12,345");
  });
});

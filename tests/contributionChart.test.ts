import { describe, expect, it } from "vitest";
import type { GitHubContributionDay } from "../src/services/workspace";
import { buildContributionChartModel } from "../src/utils/contributionChart";

describe("contributionChart", () => {
  it("builds day cells, levels and month labels from contribution days", () => {
    const days: GitHubContributionDay[] = [
      {
        date: "2026-06-01",
        count: 2,
        repositories: [{ repoId: "bad", repoName: "<unsafe>", repoFullName: "org/<unsafe>", count: 2 }],
      },
      { date: "2026-06-03", count: 8 },
    ];
    const model = buildContributionChartModel(days);

    expect("html" in model).toBe(false);
    expect(model.activeCells).toEqual([
      {
        date: "2026-06-01",
        title: "2026-06-01：2 次提交",
      },
      {
        date: "2026-06-03",
        title: "2026-06-03：8 次提交",
      },
    ]);
    expect(model.monthLabels.find((label) => label.label === "6月")).toMatchObject({
      key: "2026-05-31",
    });
    expect(model.levelPaths.map((path) => path.level)).toEqual([0, 1, 4]);
    expect(model.levelPaths.every((path) => path.d.length > 0)).toBe(true);
    expect(JSON.stringify(model)).not.toContain("<unsafe>");
  });

  it("returns stable svg dimensions and weekday labels", () => {
    const model = buildContributionChartModel([
      { date: "2026-06-01", count: 1 },
    ]);

    expect(model.viewBox).toBe(`0 0 ${model.width} ${model.height}`);
    expect(model.dayLabels.map((label) => label.label)).toEqual(["Mon", "Wed", "Fri"]);
    expect(model.activeCells).toEqual([
      {
        date: "2026-06-01",
        title: "2026-06-01：1 次提交",
      },
    ]);
    expect(model.levelPaths.every((path) => path.d.length > 0)).toBe(true);
  });
});
